// routes/payment.js
const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');
const { createOrderFromCart, getOrder, markOrderPaid, recordPayment } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router  = express.Router();

const { PHONEPE_MERCHANT_ID, PHONEPE_SALT_KEY, PHONEPE_SALT_INDEX, PHONEPE_ENV, BASE_URL } = process.env;
const PHONEPE_BASE = PHONEPE_ENV === 'production'
  ? 'https://api.phonepe.com/apis/hermes'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

function hasPhonePeConfig() {
  return [PHONEPE_MERCHANT_ID, PHONEPE_SALT_KEY, PHONEPE_SALT_INDEX, BASE_URL]
    .every(value => value && !String(value).startsWith('YOUR_'));
}

router.post('/initiate', asyncHandler(async (req, res) => {
  const { customer, items, cart } = req.body;
  const orderItems = items || cart;
  if (!customer || !orderItems) throw new Error('Missing required order fields.');
  if (!hasPhonePeConfig()) {
    return res.status(500).json({ success: false, message: 'PhonePe is not configured. Add payment credentials in .env.' });
  }

  const merchantTransactionId = 'NIKA' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const order = await createOrderFromCart(orderItems, customer, { id: merchantTransactionId });

  const payload = {
    merchantId: PHONEPE_MERCHANT_ID,
    merchantTransactionId,
    merchantUserId: 'NIKA_USER_' + (customer.phone || customer.mobile || 'guest'),
    amount: Math.round(order.total * 100),
    redirectUrl: `${BASE_URL}/success.html?transactionId=${merchantTransactionId}`,
    redirectMode: 'REDIRECT',
    callbackUrl: `${BASE_URL}/api/payment/callback`,
    mobileNumber: customer.phone || customer.mobile,
    paymentInstrument: { type: 'PAY_PAGE' }
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const checksum = crypto.createHash('sha256').update(base64Payload + '/pg/v1/pay' + PHONEPE_SALT_KEY).digest('hex') + '###' + PHONEPE_SALT_INDEX;

  const response = await axios.post(`${PHONEPE_BASE}/pg/v1/pay`, { request: base64Payload }, {
    headers: { 'Content-Type': 'application/json', 'X-VERIFY': checksum, 'X-MERCHANT-ID': PHONEPE_MERCHANT_ID }
  });

  const { data } = response;
  if (data.success && data.data?.instrumentResponse?.redirectInfo?.url) {
    return res.json({ success: true, redirectUrl: data.data.instrumentResponse.redirectInfo.url, transactionId: merchantTransactionId, order });
  } else {
    return res.status(502).json({ success: false, message: 'PhonePe initiation failed', raw: data });
  }
}));

router.post('/callback', asyncHandler(async (req, res) => {
  const { response: encodedResponse } = req.body;
  const xVerify = req.headers['x-verify'];

  if (!encodedResponse) return res.status(400).send('No response');

  const decoded = JSON.parse(Buffer.from(encodedResponse, 'base64').toString());
  const expectedHash = crypto.createHash('sha256').update(encodedResponse + PHONEPE_SALT_KEY).digest('hex') + '###' + PHONEPE_SALT_INDEX;

  if (xVerify !== expectedHash) {
    console.warn('Callback checksum mismatch!');
    return res.status(400).send('Checksum mismatch');
  }

  const { merchantTransactionId, transactionId, code } = decoded.data || decoded;
  const success = code === 'PAYMENT_SUCCESS';

  const order = await getOrder(merchantTransactionId);
  if (!order) return res.status(404).send('Order not found');

  if (success) {
    await markOrderPaid(merchantTransactionId, transactionId, decoded);
    // Trigger Shiprocket asynchronously (we don't await this so the callback can return quickly)
    const shiprocketModule = require('./shiprocket');
    getOrder(merchantTransactionId)
      .then(createdOrder => shiprocketModule.createOrderFromPayment(createdOrder))
      .catch(err => console.error('Shiprocket order creation failed:', err.message));
  } else {
    await recordPayment({ orderId: merchantTransactionId, status: code || 'PAYMENT_FAILED', providerTransactionId: transactionId, raw: decoded });
  }

  res.status(200).send('OK');
}));

router.get('/status/:txnId', asyncHandler(async (req, res) => {
  const { txnId } = req.params;
  const existingOrder = await getOrder(txnId);
  if (existingOrder && ['PAID', 'PAYMENT_SUCCESS'].includes(existingOrder.paymentStatus)) {
    return res.json({ success: true, status: 'PAYMENT_SUCCESS', order: existingOrder, raw: { cached: true } });
  }
  if (!hasPhonePeConfig()) {
    return res.status(500).json({ success: false, message: 'PhonePe is not configured.', order: existingOrder });
  }

  const checksum = crypto.createHash('sha256').update(`/pg/v1/status/${PHONEPE_MERCHANT_ID}/${txnId}` + PHONEPE_SALT_KEY).digest('hex') + '###' + PHONEPE_SALT_INDEX;

  const response = await axios.get(`${PHONEPE_BASE}/pg/v1/status/${PHONEPE_MERCHANT_ID}/${txnId}`, {
    headers: { 'X-VERIFY': checksum, 'X-MERCHANT-ID': PHONEPE_MERCHANT_ID }
  });

  const { data } = response;
  const status = data?.data?.responseCode || data?.code || (data.success ? 'PAYMENT_SUCCESS' : 'PAYMENT_PENDING');
  const providerTransactionId = data?.data?.transactionId || null;

  if (existingOrder) {
    if (status === 'PAYMENT_SUCCESS') {
      await markOrderPaid(txnId, providerTransactionId, data);
      const shiprocketModule = require('./shiprocket');
      getOrder(txnId)
        .then(createdOrder => shiprocketModule.createOrderFromPayment(createdOrder))
        .catch(err => console.error('Shiprocket order creation failed:', err.message));
    } else {
      await recordPayment({ orderId: txnId, status, providerTransactionId, raw: data });
    }
  }

  return res.json({ success: data.success, status, order: await getOrder(txnId), raw: data.data });
}));

module.exports = router;
