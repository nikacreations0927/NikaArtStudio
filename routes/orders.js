const express = require('express');
const { sendCustomerReceipt, sendAdminNotification } = require('../services/email');
const { cancelPaidOrder, createOrderFromCart, getOrder, getSalesSummary, listOrders, markOrderPaid, nowSql, db } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const { optionalCustomer } = require('../middleware/customerAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/checkout', asyncHandler(async (req, res) => {
  const { cart, customer } = req.body;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ success: false, message: 'Cart is empty.' });
  }
  if (!customer || !customer.firstName || !customer.email) {
    return res.status(400).json({ success: false, message: 'Customer details missing.' });
  }

  const order = await createOrderFromCart(cart, customer);
  const paidOrder = await markOrderPaid(order.id, 'sim_' + Date.now(), { simulated: true });

  sendCustomerReceipt(customer, paidOrder.items, paidOrder.id, paidOrder.total);
  sendAdminNotification(customer, paidOrder.id, paidOrder.total);

  res.json({ success: true, orderId: paidOrder.id, order: paidOrder });
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
