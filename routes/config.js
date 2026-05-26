const express = require('express');
const QRCode = require('qrcode');
const asyncHandler = require('../middleware/asyncHandler');
const { getShippingConfig } = require('../services/shipping');

const router = express.Router();

function buildUpiIntent({ upiId, payeeName, amount }) {
  if (!upiId) return '';
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName || 'Nika Arts Studio',
    cu: 'INR',
    tn: 'Nika Arts Studio order'
  });
  if (amount) params.set('am', String(amount));
  return `upi://pay?${params.toString()}`;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return amount.toFixed(2);
}

router.get('/store', asyncHandler(async (req, res) => {
  const upiId = process.env.UPI_ID || '';
  const upiPayeeName = process.env.UPI_PAYEE_NAME || process.env.STORE_NAME || 'Nika Arts Studio';
  const upiAmount = normalizeAmount(req.query.amount);
  const upiIntentUrl = buildUpiIntent({ upiId, payeeName: upiPayeeName, amount: upiAmount });
  const upiQrImage = process.env.UPI_QR_IMAGE_URL || (
    upiIntentUrl
      ? await QRCode.toDataURL(upiIntentUrl, { errorCorrectionLevel: 'M', margin: 2, width: 260 })
      : ''
  );

  res.json({
    success: true,
    config: {
      shipping: getShippingConfig(),
      payment: {
        mode: 'manual_upi',
        upiId,
        upiPayeeName,
        upiIntentUrl,
        upiQrImage
      }
    }
  });
}));

module.exports = router;
