// ─────────────────────────────────────────────────────────
//  routes/payment.js — PhonePe Payment Gateway Integration
//
//  PhonePe PG Docs: https://developer.phonepe.com/v1/docs
//
//  Flow:
//    1. POST /api/payment/initiate  → create transaction, get redirect URL
//    2. User pays on PhonePe
//    3. PhonePe hits our callback → we verify → create Shiprocket order
//    4. GET  /api/payment/status/:txnId → frontend polls status
// ─────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const router  = express.Router();
const {
  createOrderFromCart,
  getOrder,
  markOrderPaid,
  recordPayment
} = require('../db');

const {
  PHONEPE_MERCHANT_ID,
  PHONEPE_SALT_KEY,
  PHONEPE_SALT_INDEX,
  PHONEPE_ENV,          // "sandbox" or "production"
  BASE_URL,             // e.g. https://yourdomain.com
} = process.env;

// PhonePe base URLs
const PHONEPE_BASE = PHONEPE_ENV === 'production'
  ? 'https://api.phonepe.com/apis/hermes'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

/* ──────────────────────────────────────────
   POST /api/payment/initiate
   Body: { customer, items, total, shipping }
────────────────────────────────────────── */
router.post('/initiate', async (req, res) => {
  try {
    const { customer, items } = req.body;

    if (!customer || !items) {
      return res.status(400).json({ success: false, message: 'Missing required order fields.' });
    }

    // Generate unique transaction ID
    const merchantTransactionId = 'NIKA' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();

    // Save order details in DB. Pricing is calculated from DB products, not browser totals.
    const order = createOrderFromCart({
      id: merchantTransactionId,
      customer,
      items
    });

    // Build PhonePe payload
    const payload = {
      merchantId: PHONEPE_MERCHANT_ID,
      merchantTransactionId,
      merchantUserId: 'NIKA_USER_' + customer.phone,
      amount: Math.round(order.total * 100),           // paise
      redirectUrl: `${BASE_URL}/success.html?transactionId=${merchantTransactionId}`,
      redirectMode: 'REDIRECT',
      callbackUrl: `${BASE_URL}/api/payment/callback`,
      mobileNumber: customer.phone,
      paymentInstrument: { type: 'PAY_PAGE' }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const checksum = crypto
      .createHash('sha256')
      .update(base64Payload + '/pg/v1/pay' + PHONEPE_SALT_KEY)
      .digest('hex') + '###' + PHONEPE_SALT_INDEX;

    const response = await axios.post(
      `${PHONEPE_BASE}/pg/v1/pay`,
      { request: base64Payload },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': PHONEPE_MERCHANT_ID
        }
      }
    );

    const { data } = response;

    if (data.success && data.data?.instrumentResponse?.redirectInfo?.url) {
      return res.json({
        success: true,
        redirectUrl: data.data.instrumentResponse.redirectInfo.url,
        transactionId: merchantTransactionId,
        order
      });
    } else {
      return res.status(502).json({ success: false, message: 'PhonePe initiation failed', raw: data });
    }

  } catch (err) {
    console.error('Payment initiate error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ──────────────────────────────────────────
   POST /api/payment/callback
   Called by PhonePe after payment
────────────────────────────────────────── */
router.post('/callback', async (req, res) => {
  try {
    const { response: encodedResponse } = req.body;
    const xVerify = req.headers['x-verify'];

    if (!encodedResponse) return res.status(400).send('No response');

    // Verify checksum
    const decoded = JSON.parse(Buffer.from(encodedResponse, 'base64').toString());
    const expectedHash = crypto
      .createHash('sha256')
      .update(encodedResponse + PHONEPE_SALT_KEY)
      .digest('hex') + '###' + PHONEPE_SALT_INDEX;

    if (xVerify !== expectedHash) {
      console.warn('Callback checksum mismatch!');
      return res.status(400).send('Checksum mismatch');
    }

    const { merchantTransactionId, transactionId, code } = decoded.data || decoded;
    const success = code === 'PAYMENT_SUCCESS';

    const order = getOrder(merchantTransactionId);
    if (!order) return res.status(404).send('Order not found');

    if (success) {
      markOrderPaid(merchantTransactionId, transactionId, decoded);
      // Trigger Shiprocket order creation
      try {
        const shiprocketModule = require('./shiprocket');
        await shiprocketModule.createOrderFromPayment(getOrder(merchantTransactionId));
        console.log(`✅ Shiprocket order created for ${merchantTransactionId}`);
      } catch (srErr) {
        console.error('Shiprocket order creation failed:', srErr.message);
        // Don't fail the callback — log and handle manually if needed
      }
    } else {
      recordPayment({
        orderId: merchantTransactionId,
        status: code || 'PAYMENT_FAILED',
        providerTransactionId: transactionId,
        raw: decoded
      });
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Callback error:', err.message);
    res.status(500).send('Error');
  }
});

/* ──────────────────────────────────────────
   GET /api/payment/status/:txnId
   Frontend polls this after redirect
────────────────────────────────────────── */
router.get('/status/:txnId', async (req, res) => {
  const { txnId } = req.params;

  try {
    const checksum = crypto
      .createHash('sha256')
      .update(`/pg/v1/status/${PHONEPE_MERCHANT_ID}/${txnId}` + PHONEPE_SALT_KEY)
      .digest('hex') + '###' + PHONEPE_SALT_INDEX;

    const response = await axios.get(
      `${PHONEPE_BASE}/pg/v1/status/${PHONEPE_MERCHANT_ID}/${txnId}`,
      {
        headers: {
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': PHONEPE_MERCHANT_ID
        }
      }
    );

    const { data } = response;
    const status = data?.data?.responseCode || data?.code || (data.success ? 'PAYMENT_SUCCESS' : 'PAYMENT_PENDING');
    const providerTransactionId = data?.data?.transactionId || null;

    if (getOrder(txnId)) {
      if (status === 'PAYMENT_SUCCESS') {
        markOrderPaid(txnId, providerTransactionId, data);

        try {
          const shiprocketModule = require('./shiprocket');
          await shiprocketModule.createOrderFromPayment(getOrder(txnId));
        } catch (srErr) {
          console.error('Shiprocket order creation failed:', srErr.message);
        }
      } else {
        recordPayment({
          orderId: txnId,
          status,
          providerTransactionId,
          raw: data
        });
      }
    }

    return res.json({ success: data.success, status, order: getOrder(txnId), raw: data.data });

  } catch (err) {
    console.error('Status check error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
