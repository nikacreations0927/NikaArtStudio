// ─────────────────────────────────────────────────────────
//  routes/shiprocket.js — Shiprocket Logistics Integration
//
//  Shiprocket API Docs: https://apidocs.shiprocket.in
//
//  Flow:
//    1. Authenticate → get JWT token (valid 24h)
//    2. Create order on Shiprocket
//    3. Assign courier (AWB)
//    4. Schedule pickup
//    5. Track via order ID
// ─────────────────────────────────────────────────────────

const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { db, recordLogistics } = require('../db');

const {
  SHIPROCKET_EMAIL,
  SHIPROCKET_PASSWORD,
  SHIPROCKET_PICKUP_LOCATION,  // Name of your pickup location in Shiprocket dashboard
  SHIPROCKET_PICKUP_PINCODE,
  STORE_NAME,
} = process.env;

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

// Token cache — Shiprocket tokens are valid for 24 hours
let cachedToken = null;
let tokenExpiry = null;

/* ──────────────────────────────────────────
   Authenticate with Shiprocket
────────────────────────────────────────── */
async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const res = await axios.post(`${SHIPROCKET_BASE}/auth/login`, {
    email: SHIPROCKET_EMAIL,
    password: SHIPROCKET_PASSWORD
  });

  cachedToken = res.data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23h to be safe
  return cachedToken;
}

/* ──────────────────────────────────────────
   Create a Shiprocket order after payment
   Called internally from payment.js callback
────────────────────────────────────────── */
async function createOrderFromPayment(orderData) {
  if (orderData.shiprocketOrderId || orderData.logisticsStatus === 'CREATED') {
    return {
      order_id: orderData.shiprocketOrderId,
      shipment_id: orderData.shiprocketShipmentId,
      alreadyCreated: true
    };
  }

  const token = await getToken();
  const { customer, items, total, shipping } = orderData;
  const merchantTransactionId = orderData.id || orderData.merchantTransactionId;

  // Build Shiprocket order payload
  const payload = {
    order_id: merchantTransactionId,
    order_date: new Date().toISOString().split('T')[0],
    pickup_location: SHIPROCKET_PICKUP_LOCATION || 'Primary',
    channel_id: '',                     // leave blank for custom store
    comment: 'Order from Nika Arts Studio website',
    billing_customer_name: customer.firstName + ' ' + customer.lastName,
    billing_last_name: customer.lastName,
    billing_address: customer.address,
    billing_city: customer.city,
    billing_pincode: customer.pincode,
    billing_state: customer.state,
    billing_country: 'India',
    billing_email: customer.email,
    billing_phone: customer.phone,
    shipping_is_billing: true,
    order_items: items.map(item => ({
      name: item.name,
      sku: item.productId || item.id,
      units: item.qty,
      selling_price: item.price,
      discount: 0,
      tax: '',
      hsn: ''
    })),
    payment_method: 'Prepaid',
    shipping_charges: shipping || 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: items.reduce((s, i) => s + i.price * i.qty, 0),
    length: 20,    // cm — update with your actual package dimensions
    breadth: 15,
    height: 10,
    weight: 0.5    // kg — update with actual weight
  };

  const response = await axios.post(
    `${SHIPROCKET_BASE}/orders/create/adhoc`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  db.prepare(`
    UPDATE orders
    SET logistics_status = 'CREATED',
        shiprocket_order_id = ?,
        shiprocket_shipment_id = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    String(response.data.order_id || ''),
    String(response.data.shipment_id || ''),
    merchantTransactionId
  );

  recordLogistics({
    orderId: merchantTransactionId,
    status: 'CREATED',
    trackingId: response.data.awb_code || response.data.shipment_id || null,
    raw: response.data
  });

  console.log('Shiprocket order created:', response.data.order_id, '| Shipment ID:', response.data.shipment_id);
  return response.data;
}

/* ──────────────────────────────────────────
   GET /api/shiprocket/track/:orderId
────────────────────────────────────────── */
router.get('/track/:orderId', async (req, res) => {
  try {
    const token = await getToken();
    const response = await axios.get(
      `${SHIPROCKET_BASE}/orders/show/${req.params.orderId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
});

/* ──────────────────────────────────────────
   GET /api/shiprocket/serviceability
   Check if a pincode is serviceable
   Query: ?pincode=560001&weight=0.5
────────────────────────────────────────── */
router.get('/serviceability', async (req, res) => {
  try {
    const { pincode, weight = 0.5 } = req.query;
    if (!pincode) return res.status(400).json({ success: false, message: 'pincode required' });

    const token = await getToken();
    const response = await axios.get(
      `${SHIPROCKET_BASE}/courier/serviceability/?pickup_postcode=${SHIPROCKET_PICKUP_PINCODE}&delivery_postcode=${pincode}&cod=0&weight=${weight}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
module.exports.createOrderFromPayment = createOrderFromPayment;
