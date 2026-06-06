const express = require('express');
const QRCode = require('qrcode');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAdmin } = require('../middleware/adminAuth');
const { hasEmailConfig, sendDiagnosticEmail } = require('../services/email');
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

router.get('/email', requireAdmin, asyncHandler(async (req, res) => {
  const emailUser = process.env.EMAIL_USER || '';
  const notificationEmail = process.env.ORDER_NOTIFICATION_EMAIL || 'nika.creations0927@gmail.com';

  res.json({
    success: true,
    email: {
      configured: hasEmailConfig(),
      emailUserPresent: Boolean(process.env.EMAIL_USER),
      emailPassPresent: Boolean(process.env.EMAIL_PASS),
      fromDomain: emailUser.includes('@') ? emailUser.split('@').pop() : '',
      notificationEmail
    }
  });
}));

router.post('/email/test', requireAdmin, asyncHandler(async (req, res) => {
  const requestedTo = String(req.body?.to || '').trim();
  const result = await sendDiagnosticEmail(requestedTo || undefined);
  res.status(result.success ? 200 : 502).json({
    success: result.success,
    result
  });
}));

module.exports = router;
