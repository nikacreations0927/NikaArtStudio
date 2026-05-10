const express = require('express');
const {
  db,
  createOrderFromCart,
  getOrder,
  getSalesSummary,
  listOrders,
  recordLogistics
} = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();
const nowSql = "datetime('now')";

function cleanText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

router.get('/', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ success: true, orders: listOrders({ limit }) });
});

router.post('/', requireAdmin, (req, res) => {
  try {
    const id = cleanText(req.body.id, 'NIKA' + Date.now());
    const order = createOrderFromCart({
      id,
      customer: req.body.customer,
      items: req.body.items
    });
    res.status(201).json({ success: true, order });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/sales/summary', requireAdmin, (req, res) => {
  res.json({ success: true, summary: getSalesSummary() });
});

router.get('/:txnId', (req, res) => {
  const order = getOrder(req.params.txnId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
  res.json({ success: true, order });
});

router.get('/:txnId/events', requireAdmin, (req, res) => {
  const order = getOrder(req.params.txnId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  const payments = db.prepare(`
    SELECT * FROM payments
    WHERE order_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.params.txnId);

  const logistics = db.prepare(`
    SELECT * FROM logistics_events
    WHERE order_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.params.txnId);

  const inventory = db.prepare(`
    SELECT * FROM inventory_events
    WHERE order_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.params.txnId);

  res.json({ success: true, payments, logistics, inventory });
});

router.patch('/:txnId/status', requireAdmin, (req, res) => {
  const order = getOrder(req.params.txnId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  const fulfillmentStatus = cleanText(req.body.fulfillmentStatus, order.fulfillmentStatus);
  const logisticsStatus = cleanText(req.body.logisticsStatus, order.logisticsStatus);

  db.prepare(`
    UPDATE orders
    SET fulfillment_status = ?, logistics_status = ?, updated_at = ${nowSql}
    WHERE id = ?
  `).run(fulfillmentStatus, logisticsStatus, req.params.txnId);

  if (logisticsStatus !== order.logisticsStatus) {
    recordLogistics({
      orderId: req.params.txnId,
      status: logisticsStatus,
      trackingId: cleanText(req.body.trackingId) || null,
      raw: req.body.raw || null
    });
  }

  res.json({ success: true, order: getOrder(req.params.txnId) });
});

module.exports = router;
