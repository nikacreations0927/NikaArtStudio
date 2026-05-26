// routes/shiprocket.js
const express = require('express');
const axios   = require('axios');
const { db, recordLogistics } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router  = express.Router();
const { SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD, SHIPROCKET_PICKUP_LOCATION, SHIPROCKET_PICKUP_PINCODE } = process.env;
const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
    const err = new Error('Shiprocket credentials are missing. Add SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in .env.');
    err.statusCode = 500;
    throw err;
  }
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  const res = await axios.post(`${SHIPROCKET_BASE}/auth/login`, { email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD });
  cachedToken = res.data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken;
}

function shiprocketError(err) {
  const status = err.response?.status || 502;
  const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Shiprocket request failed.';
  const wrapped = new Error(message);
  wrapped.statusCode = status;
  wrapped.shiprocket = err.response?.data;
  return wrapped;
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

  await db.run(`UPDATE orders SET logistics_status = 'CREATED', shiprocket_order_id = ?, shiprocket_shipment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [String(response.data.order_id || ''), String(response.data.shipment_id || ''), merchantTransactionId]);

  await recordLogistics({ orderId: merchantTransactionId, status: 'CREATED', trackingId: response.data.awb_code || response.data.shipment_id || null, raw: response.data });
  console.log('Shiprocket order created:', response.data.order_id);
  return response.data;
}

router.get('/track/:orderId', requireAdmin, asyncHandler(async (req, res) => {
  const token = await getToken();
  const response = await axios.get(`${SHIPROCKET_BASE}/orders/show/${req.params.orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  res.json({ success: true, data: response.data });
}));

router.get('/serviceability', asyncHandler(async (req, res) => {
  const { pincode, weight = 0.5, declaredValue = 500 } = req.query;
  if (!pincode) throw new Error('Pincode is required.');
  if (!SHIPROCKET_PICKUP_PINCODE) {
    const err = new Error('Shiprocket pickup pincode is missing. Add SHIPROCKET_PICKUP_PINCODE in .env.');
    err.statusCode = 500;
    throw err;
  }

  const token = await getToken();
  try {
    const response = await axios.get(`${SHIPROCKET_BASE}/courier/serviceability/`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        pickup_postcode: Number(SHIPROCKET_PICKUP_PINCODE),
        delivery_postcode: Number(pincode),
        cod: 0,
        weight: Number(weight),
        declared_value: Number(declaredValue),
        is_return: 0
      }
    });
    if (Number(response.data?.status) >= 400) {
      return res.status(422).json({ success: false, message: response.data.message || 'Shiprocket serviceability check failed.', details: response.data });
    }
    res.json({ success: true, data: response.data });
  } catch (err) {
    throw shiprocketError(err);
  }
}));

module.exports = router;
module.exports.createOrderFromPayment = createOrderFromPayment;
