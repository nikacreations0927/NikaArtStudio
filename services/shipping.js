const { numberFromEnv } = require('../utils/env');

const STANDARD_SHIPPING_FEE = numberFromEnv('SHIPPING_FEE', 99, { min: 0 });
const FREE_SHIPPING_MINIMUM = numberFromEnv('FREE_SHIPPING_MINIMUM', 2000, { min: 0 });

function calculateShipping(subtotal) {
  const amount = Number(subtotal || 0);
  return amount >= FREE_SHIPPING_MINIMUM ? 0 : STANDARD_SHIPPING_FEE;
}

function calculateTotals(items) {
  const subtotal = (items || []).reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.qty || 0);
  }, 0);
  const shipping = calculateShipping(subtotal);
  return {
    subtotal,
    shipping,
    total: subtotal + shipping
  };
}

function getShippingConfig() {
  return {
    fee: STANDARD_SHIPPING_FEE,
    freeShippingMinimum: FREE_SHIPPING_MINIMUM
  };
}

module.exports = {
  calculateShipping,
  calculateTotals,
  getShippingConfig
};
