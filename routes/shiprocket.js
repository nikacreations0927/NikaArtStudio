// routes/shiprocket.js
const express = require('express');
const axios   = require('axios');
const { db, recordLogistics } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router  = express.Router();
const { SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD, SHIPROCKET_PICKUP_LOCATION, SHIPROCKET_PICKUP_PINCODE } = process.env;
const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  const res = await axios.post(`${SHIPROCKET_BASE}/auth/login`, { email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD });
  cachedToken = res.data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken;
}

async function createOrderFromPayment(orderData) {
  if (orderData.shiprocketOrderId || orderData.logisticsStatus === 'CREATED') {
    return { order_id: orderData.shiprocketOrderId, shipment_id: orderData.shiprocketShipmentId, alreadyCreated: true };
  }

  const token = await getToken();
  const { customer, items, shipping } = orderData;
  const merchantTransactionId = orderData.id || orderData.merchantTransactionId;

  const payload = {
    order_id: merchantTransactionId,
    order_date: new Date().toISOString().split('T')[0],
    pickup_location: SHIPROCKET_PICKUP_LOCATION || 'Primary',
    channel_id: '',
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
    order_items: items.map(item => ({ name: item.name, sku: item.productId || item.id, units: item.qty, selling_price: item.price, discount: 0, tax: '', hsn: '' })),
    payment_method: 'Prepaid',
    shipping_charges: shipping || 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: items.reduce((s, i) => s + i.price * i.qty, 0),
    length: 20, breadth: 15, height: 10, weight: 0.5
  };

  const response = await axios.post(`${SHIPROCKET_BASE}/orders/create/adhoc`, payload, { headers: { Authorization: `Bearer ${token}` } });

  db.prepare(`UPDATE orders SET logistics_status = 'CREATED', shiprocket_order_id = ?, shiprocket_shipment_id = ?, updated_at = datetime('now') WHERE id = ?`).run(String(response.data.order_id || ''), String(response.data.shipment_id || ''), merchantTransactionId);

  recordLogistics({ orderId: merchantTransactionId, status: 'CREATED', trackingId: response.data.awb_code || response.data.shipment_id || null, raw: response.data });
  console.log('Shiprocket order created:', response.data.order_id);
  return response.data;
}

router.get('/track/:orderId', asyncHandler(async (req, res) => {
  const token = await getToken();
  const response = await axios.get(`${SHIPROCKET_BASE}/orders/show/${req.params.orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  res.json({ success: true, data: response.data });
}));

router.get('/serviceability', asyncHandler(async (req, res) => {
  const { pincode, weight = 0.5 } = req.query;
  if (!pincode) throw new Error('Pincode is required.');

  const token = await getToken();
  const response = await axios.get(`${SHIPROCKET_BASE}/courier/serviceability/?pickup_postcode=${SHIPROCKET_PICKUP_PINCODE}&delivery_postcode=${pincode}&cod=0&weight=${weight}`, { headers: { Authorization: `Bearer ${token}` } });
  res.json({ success: true, data: response.data });
}));

module.exports = router;
module.exports.createOrderFromPayment = createOrderFromPayment;