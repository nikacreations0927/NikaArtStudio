const express = require('express');
const { sendCustomerReceipt, sendPrebookBalanceRequest } = require('../services/email');
const { cancelPaidOrder, getOrder, getSalesDashboard, getSalesSummary, listOrders, markOrderPaid, markPrebookAdvancePaid, markPrebookBalancePaid, requestPrebookBalance, nowSql, db, recordLogistics } = require('../db');
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
      orderType: order.orderType,
      advanceAmount: order.advanceAmount,
      balanceAmount: order.balanceAmount,
      balanceProviderTransactionId: order.balanceProviderTransactionId,
      balanceRequestedAt: order.balanceRequestedAt,
      balancePaidAt: order.balancePaidAt,
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

router.get('/sales/dashboard', requireAdmin, asyncHandler(async (req, res) => {
  const dashboard = await getSalesDashboard();
  res.json({ success: true, dashboard });
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
  let order;
  let shouldCreateShipment = true;
  let message = 'Payment verified and order marked paid.';

  if (existing.orderType === 'PREBOOK' && existing.paymentStatus === 'PREBOOK_ADVANCE_PENDING') {
    order = await markPrebookAdvancePaid(req.params.id, providerTransactionId, {
      adminVerified: true,
      verifiedBy: req.admin?.username || 'admin',
      stage: 'advance'
    }, { provider: 'Manual UPI' });
    shouldCreateShipment = false;
    message = 'Pre-book advance verified. Request the balance once stock is available.';
  } else if (existing.orderType === 'PREBOOK' && existing.paymentStatus === 'PREBOOK_BALANCE_PENDING') {
    const balanceReference = String(req.body?.providerTransactionId || existing.balanceProviderTransactionId || '').trim()
      || `manual_upi_balance_${Date.now()}`;
    order = await markPrebookBalancePaid(req.params.id, balanceReference, {
      adminVerified: true,
      verifiedBy: req.admin?.username || 'admin',
      stage: 'balance'
    }, { provider: 'Manual UPI' });
    message = 'Pre-book balance verified. Order is ready for shipping.';
  } else if (existing.orderType === 'PREBOOK') {
    return res.status(400).json({ success: false, message: 'This pre-book order is not ready for payment verification.' });
  } else {
    order = await markOrderPaid(req.params.id, providerTransactionId, {
      adminVerified: true,
      verifiedBy: req.admin?.username || 'admin'
    }, { provider: 'Manual UPI' });
  }

  sendCustomerReceipt(order.customer, order.items, order.id, order.total, {
    statusLabel: order.orderType === 'PREBOOK' && order.paymentStatus === 'PREBOOK_ADVANCE_PAID'
      ? 'Your pre-book advance payment has been verified. We will notify you when stock is ready for the remaining payment.'
      : 'Your UPI payment has been verified. Your order is confirmed and will be prepared for shipping.'
  });

  if (shouldCreateShipment) {
    const shiprocketModule = require('./shiprocket');
    getOrder(order.id)
      .then(createdOrder => shiprocketModule.createOrderFromPayment(createdOrder))
      .catch(err => console.error('Shiprocket order creation failed:', err.message));
  }

  res.json({ success: true, message, order });
}));

router.post('/:id/prebook/request-balance', requireAdmin, asyncHandler(async (req, res) => {
  const order = await requestPrebookBalance(req.params.id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  try {
    await sendPrebookBalanceRequest(order.customer, order);
  } catch (err) {
    console.error('Pre-book balance notification failed:', err.message);
  }
  res.json({
    success: true,
    message: 'Balance payment request sent to customer.',
    order
  });
}));

router.patch('/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { fulfillmentStatus, logisticsStatus } = req.body;
  const existing = await getOrder(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Order not found.' });
  const allowedFulfillmentStatuses = new Set(['PENDING', 'READY_FOR_SHIPPING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PREBOOK_ADVANCE_PENDING', 'PREBOOK_WAITING_STOCK', 'PREBOOK_READY_FOR_BALANCE']);
  const allowedLogisticsStatuses = new Set(['NOT_CREATED', 'CREATED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'FAILED', 'CANCELLED']);

  if (fulfillmentStatus !== undefined && !allowedFulfillmentStatuses.has(fulfillmentStatus)) {
    return res.status(400).json({ success: false, message: 'Unknown fulfillment status.' });
  }
  if (logisticsStatus !== undefined && !allowedLogisticsStatuses.has(logisticsStatus)) {
    return res.status(400).json({ success: false, message: 'Unknown logistics status.' });
  }

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

  if (logisticsStatus && logisticsStatus !== existing.logisticsStatus) {
    await recordLogistics({
      orderId: req.params.id,
      status: logisticsStatus,
      trackingId: existing.shiprocketShipmentId || existing.shiprocketOrderId || null,
      raw: {
        source: 'admin',
        updatedBy: req.admin?.username || 'admin',
        previousStatus: existing.logisticsStatus,
        newStatus: logisticsStatus
      }
    });
  }

  res.json({ success: true, message: 'Status updated', order: await getOrder(req.params.id) });
}));

module.exports = router;
