const express = require('express');
const { getShippingConfig } = require('../services/shipping');

const router = express.Router();

router.get('/store', (req, res) => {
  res.json({
    success: true,
    config: {
      shipping: getShippingConfig(),
      payment: {
        mode: 'manual_upi',
        upiId: process.env.UPI_ID || '',
        upiPayeeName: process.env.UPI_PAYEE_NAME || process.env.STORE_NAME || 'Nika Arts Studio',
        upiQrImage: process.env.UPI_QR_IMAGE_URL || ''
      }
    }
  });
});

module.exports = router;
