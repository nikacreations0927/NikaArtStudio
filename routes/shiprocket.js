// routes/shiprocket.js
const express = require('express');
const { db, recordLogistics } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const asyncHandler = require('../middleware/asyncHandler');
const shiprocket = require('../services/shiprocket');

const router = express.Router();

async function createOrderFromPayment(orderData) {
  if (orderData.shiprocketOrderId || orderData.logisticsStatus === 'CREATED') {
    return { order_id: orderData.shiprocketOrderId, shipment_id: orderData.shiprocketShipmentId, alreadyCreated: true };
  }

  const merchantTransactionId = orderData.id || orderData.merchantTransactionId;
  const response = await shiprocket.createOrder(orderData);

  await db.run(`
    UPDATE orders
    SET logistics_status = 'CREATED',
        shiprocket_order_id = ?,
        shiprocket_shipment_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [String(response.order_id || ''), String(response.shipment_id || ''), merchantTransactionId]);

  await recordLogistics({
    orderId: merchantTransactionId,
    status: 'CREATED',
    trackingId: response.awb_code || response.shipment_id || null,
    raw: response
  });

  console.log(`${shiprocket.isMockMode() ? 'Mock ' : ''}Shiprocket order created:`, response.order_id);
  return response;
}

router.get('/track/:orderId', requireAdmin, asyncHandler(async (req, res) => {
  const data = await shiprocket.trackOrder(req.params.orderId);
  res.json({ success: true, mode: shiprocket.getMode(), data });
}));

router.get('/serviceability', asyncHandler(async (req, res) => {
  const { pincode, weight = 0.5, declaredValue = 500 } = req.query;
  if (!pincode) throw new Error('Pincode is required.');

  const data = await shiprocket.serviceability({ pincode, weight, declaredValue });
  res.json({ success: true, mode: shiprocket.getMode(), data });
}));

module.exports = router;
module.exports.createOrderFromPayment = createOrderFromPayment;
