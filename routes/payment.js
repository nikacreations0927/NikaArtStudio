// routes/payment.js
const express = require('express');
const { createOrderFromCart, getOrder, recordPayment } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { sendAdminNotification, sendCustomerReceipt } = require('../services/email');

const router = express.Router();

// PhonePe gateway integration is intentionally inactive until the merchant
// account is approved. The checkout currently uses manual UPI verification.

function normalizeReference(value) {
  return String(value || '').trim().slice(0, 80);
}

router.post('/initiate', asyncHandler(async (req, res) => {
  const { customer, items, cart, upiReference } = req.body;
  const orderItems = items || cart;
  const reference = normalizeReference(upiReference);

  if (!customer || !orderItems) {
    return res.status(400).json({ success: false, message: 'Missing required order fields.' });
  }
  if (!reference) {
    return res.status(400).json({ success: false, message: 'Enter the UPI transaction/reference ID after payment.' });
  }

  const orderId = 'NIKA' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const order = await createOrderFromCart(orderItems, customer, {
    id: orderId,
    paymentStatus: 'UPI_PENDING_VERIFICATION',
    paymentProvider: 'Manual UPI'
  });

  await recordPayment({
    orderId,
    status: 'UPI_PENDING_VERIFICATION',
    provider: 'Manual UPI',
    providerTransactionId: reference,
    raw: {
      submittedByCustomer: true,
      upiReference: reference,
      note: 'Customer submitted manual UPI reference. Admin must verify before fulfillment.'
    }
  });

  sendAdminNotification(customer, orderId, order.total, {
    statusLabel: 'Manual UPI payment pending verification',
    paymentReference: reference
  });
  sendCustomerReceipt(customer, order.items, orderId, order.total, {
    statusLabel: 'Your order has been received. We will verify your UPI payment reference and confirm it before packing.'
  });

  res.json({
    success: true,
    manual: true,
    orderId,
    status: 'UPI_PENDING_VERIFICATION',
    order: await getOrder(orderId)
  });
}));

router.get('/status/:txnId', asyncHandler(async (req, res) => {
  const order = await getOrder(req.params.txnId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  res.json({
    success: true,
    status: order.paymentStatus,
    manual: order.paymentProvider === 'Manual UPI'
  });
}));

module.exports = router;
