const express = require('express');
const { sendCustomerReceipt } = require('../services/email');
const { cancelPaidOrder, getOrder, getSalesSummary, listOrders, markOrderPaid, nowSql, db } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const { optionalCustomer } = require('../middleware/customerAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/checkout', asyncHandler(async (req, res) => {
  res.status(410).json({
    success: false,
    message: 'Checkout now uses manual UPI verification. Use /api/payment/initiate.'
  });
}));

router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const orders = await listOrders({ limit });
  res.json({ success: true, orders });
}));

router.get('/track/:id', optionalCustomer, asyncHandler(async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  const email = String(req.query.email || '').trim().toLowerCase();
  const phone = String(req.query.phone || '').trim();
  const customerEmail = String(order.customer.email || '').trim().toLowerCase();
  const customerPhone = String(order.customer.phone || order.customer.mobile || '').trim();
  const loggedInMatch = req.customer && String(req.customer.email || '').toLowerCase() === customerEmail;
  const canView = loggedInMatch || (email && email === customerEmail) || (phone && phone === customerPhone);

  if (!canView) {
    return res.status(401).json({ success: false, message: 'Log in with the order email, or enter the email/phone used for this order.' });
  }

  res.json({
    success: true,
    order: {
      id: order.id,
      total: order.total,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      logisticsStatus: order.logisticsStatus,
      shiprocketOrderId: order.shiprocketOrderId,
      shiprocketShipmentId: order.shiprocketShipmentId,
      createdAt: order.createdAt,
      items: order.items
    }
  });
}));

router.get('/sales/summary', requireAdmin, asyncHandler(async (req, res) => {
  const summary = await getSalesSummary();
  res.json({ success: true, summary });
}));

router.patch('/:id/payment', requireAdmin, asyncHandler(async (req, res) => {
  const existing = await getOrder(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Order not found.' });
  if (['PAID', 'PAYMENT_SUCCESS'].includes(existing.paymentStatus)) {
    return res.json({ success: true, message: 'Payment was already verified.', order: existing });
  }
  if (existing.fulfillmentStatus === 'CANCELLED') {
    return res.status(400).json({ success: false, message: 'Cancelled orders cannot be marked as paid.' });
  }

  const providerTransactionId = String(req.body?.providerTransactionId || existing.providerTransactionId || '').trim()
    || `manual_upi_${Date.now()}`;
  const order = await markOrderPaid(req.params.id, providerTransactionId, {
    adminVerified: true,
    verifiedBy: req.admin?.username || 'admin'
  }, { provider: 'Manual UPI' });

  sendCustomerReceipt(order.customer, order.items, order.id, order.total, {
    statusLabel: 'Your UPI payment has been verified. Your order is confirmed and will be prepared for shipping.'
  });

  const shiprocketModule = require('./shiprocket');
  getOrder(order.id)
    .then(createdOrder => shiprocketModule.createOrderFromPayment(createdOrder))
    .catch(err => console.error('Shiprocket order creation failed:', err.message));

  res.json({ success: true, message: 'Payment verified and order marked paid.', order });
}));

router.patch('/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { fulfillmentStatus, logisticsStatus } = req.body;
  const existing = await getOrder(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Order not found.' });

  if (fulfillmentStatus === 'CANCELLED') {
    const order = await cancelPaidOrder(req.params.id, 'Cancelled from admin dashboard');
    return res.json({ success: true, message: 'Order cancelled and stock restored when applicable.', order });
  }

  await db.run(`
    UPDATE orders
    SET fulfillment_status = COALESCE(?, fulfillment_status),
        logistics_status = COALESCE(?, logistics_status),
        updated_at = ${nowSql}
    WHERE id = ?
  `, [fulfillmentStatus, logisticsStatus, req.params.id]);

  res.json({ success: true, message: 'Status updated', order: await getOrder(req.params.id) });
}));

module.exports = router;
