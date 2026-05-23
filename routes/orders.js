// routes/orders.js
const { sendCustomerReceipt, sendAdminNotification } = require('../services/email');
const express = require('express');
const { cancelPaidOrder, createOrderFromCart, getOrder, listOrders, markOrderPaid } = require('../db');
const { db, nowSql } = require('../db/connection'); // Direct database access!
const { requireAdmin } = require('../middleware/adminAuth');
const { optionalCustomer } = require('../middleware/customerAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// 1. Customer Checkout Endpoint (Public)
router.post('/checkout', asyncHandler(async (req, res) => {
  const { cart, customer } = req.body;

  if (!cart || !Array.isArray(cart) || cart.length === 0) {
    return res.status(400).json({ success: false, message: 'Cart is empty.' });
  }
  if (!customer || !customer.firstName || !customer.email) {
    return res.status(400).json({ success: false, message: 'Customer details missing.' });
  }

  const subtotal = cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const shipping = subtotal >= 999 ? 0 : 99;
  const order = createOrderFromCart(cart, customer, { shipping });
  const paidOrder = markOrderPaid(order.id, 'sim_' + Date.now(), { simulated: true });

  // ==========================================
  // FIRE EMAIL NOTIFICATIONS (New!)
  // We don't 'await' these because we don't want the customer
  // to stare at a loading spinner while the email server connects.
  // Let them send in the background!
  // ==========================================
  sendCustomerReceipt(customer, paidOrder.items, paidOrder.id, paidOrder.total);
  sendAdminNotification(customer, paidOrder.id, paidOrder.total);

  res.json({ success: true, orderId: paidOrder.id, order: paidOrder });

	
}));

// 2. Admin Endpoint: Get all orders
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const orders = listOrders({ limit });
  res.json({ success: true, orders });
}));

router.get('/track/:id', optionalCustomer, asyncHandler(async (req, res) => {
  const order = getOrder(req.params.id);
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

// ==========================================
// 3. Admin Endpoint: Get Sales Summary (THE FIX)
// ==========================================
router.get('/sales/summary', requireAdmin, asyncHandler(async (req, res) => {
  
  // DIRECT SQL: Bypassing the buggy helper function to guarantee accuracy
  const stats = db.prepare(`
    SELECT
      COUNT(id) as orderCount,
      COALESCE(SUM(total), 0) as revenue,
      COALESCE(SUM(subtotal), 0) as productRevenue
    FROM orders
    WHERE payment_status IN ('PAID', 'PAYMENT_SUCCESS')
  `).get();

  // Fetch low stock items directly
  const lowStock = db.prepare(`
    SELECT id, name, stock 
    FROM products 
    WHERE stock <= 5 AND is_active = 1
  `).all();

  const topProducts = db.prepare(`
    SELECT product_id AS productId, name_snapshot AS name, SUM(qty) AS unitsSold, SUM(line_total) AS revenue
    FROM order_items
    WHERE order_id IN (SELECT id FROM orders WHERE payment_status IN ('PAID', 'PAYMENT_SUCCESS'))
    GROUP BY product_id, name_snapshot
    ORDER BY unitsSold DESC, revenue DESC
    LIMIT 5
  `).all();

  res.json({
    success: true,
    summary: {
      orderCount: stats.orderCount,
      revenue: stats.revenue,
      productRevenue: stats.productRevenue,
      lowStock,
      topProducts
    }
  });
}));

// 4. Admin Endpoint: Update Order Status (Fulfillment/Logistics)
router.patch('/:id/status', requireAdmin, asyncHandler(async (req, res) => {
  const { fulfillmentStatus, logisticsStatus } = req.body;
  const existing = getOrder(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Order not found.' });

  if (fulfillmentStatus === 'CANCELLED') {
    const order = cancelPaidOrder(req.params.id, 'Cancelled from admin dashboard');
    return res.json({ success: true, message: 'Order cancelled and stock restored when applicable.', order });
  }
  
  db.prepare(`
    UPDATE orders 
    SET fulfillment_status = COALESCE(?, fulfillment_status),
        logistics_status = COALESCE(?, logistics_status),
        updated_at = ${nowSql}
    WHERE id = ?
  `).run(fulfillmentStatus, logisticsStatus, req.params.id);

  res.json({ success: true, message: 'Status updated' });
}));

module.exports = router;
