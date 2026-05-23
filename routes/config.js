const express = require('express');
const { getShippingConfig } = require('../services/shipping');

const router = express.Router();

router.get('/store', (req, res) => {
  res.json({
    success: true,
    config: {
      shipping: getShippingConfig()
    }
  });
});

module.exports = router;
