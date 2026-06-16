const { db } = require('../db/connection');

const DISCOUNT_CODES = {
  NIKA5: { code: 'NIKA5', percent: 5, type: 'FIRST_PURCHASE' },
  NIKA8: { code: 'NIKA8', percent: 8, type: 'RETURNING_CUSTOMER' }
};

function normalizeDiscountCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function rupees(value) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN')}`;
}

async function customerOrderProfile({ customer, checkoutCustomer = {} } = {}) {
  const accountEmail = normalizeEmail(customer?.email);
  const checkoutEmail = normalizeEmail(checkoutCustomer.email);
  const email = checkoutEmail || accountEmail;
  const phone = normalizePhone(checkoutCustomer.phone || checkoutCustomer.mobile || customer?.mobile);

  if (!email && !phone) {
    return { priorOrders: 0, paidOrders: 0, email, phone };
  }

  const rows = await db.all(`
    SELECT payment_status
    FROM orders
    WHERE fulfillment_status <> 'CANCELLED'
      AND (
        lower(customer_json::jsonb ->> 'email') = lower(?)
        OR regexp_replace(COALESCE(customer_json::jsonb ->> 'phone', customer_json::jsonb ->> 'mobile', ''), '\\D', '', 'g') = ?
      )
  `, [email || '__no_email__', phone || '__no_phone__']);

  const paidStatuses = new Set(['PAID', 'PAYMENT_SUCCESS']);
  return {
    priorOrders: rows.length,
    paidOrders: rows.filter(row => paidStatuses.has(row.payment_status)).length,
    email,
    phone
  };
}

async function evaluateDiscount({ code, subtotal, customer, checkoutCustomer, orderType = 'STANDARD' } = {}) {
  const normalizedCode = normalizeDiscountCode(code);
  const amount = Number(subtotal || 0);

  if (!normalizedCode) {
    return {
      code: '',
      eligible: false,
      percent: 0,
      amount: 0,
      message: 'Enter a discount code if you have one.'
    };
  }

  const rule = DISCOUNT_CODES[normalizedCode];
  if (!rule) {
    return {
      code: normalizedCode,
      eligible: false,
      percent: 0,
      amount: 0,
      message: 'Invalid discount code. Only NIKA5 and NIKA8 are accepted.'
    };
  }

  if (!customer) {
    return {
      code: normalizedCode,
      eligible: false,
      percent: 0,
      amount: 0,
      message: 'Please create an account or log in to use this discount code.'
    };
  }

  const accountEmail = normalizeEmail(customer.email);
  const checkoutEmail = normalizeEmail(checkoutCustomer?.email);
  if (checkoutEmail && accountEmail && checkoutEmail !== accountEmail) {
    return {
      code: normalizedCode,
      eligible: false,
      percent: 0,
      amount: 0,
      message: 'Use the same email as your logged-in account to apply a discount.'
    };
  }

  const profile = await customerOrderProfile({ customer, checkoutCustomer });

  if (rule.type === 'FIRST_PURCHASE' && profile.priorOrders > 0) {
    return {
      code: normalizedCode,
      eligible: false,
      percent: 0,
      amount: 0,
      message: 'NIKA5 is only for your first order. Use NIKA8 after a completed purchase.'
    };
  }

  if (rule.type === 'RETURNING_CUSTOMER' && profile.paidOrders === 0) {
    return {
      code: normalizedCode,
      eligible: false,
      percent: 0,
      amount: 0,
      message: 'NIKA8 unlocks after your first completed purchase.'
    };
  }

  const discountAmount = Math.floor(amount * rule.percent / 100);
  return {
    code: normalizedCode,
    eligible: true,
    percent: rule.percent,
    amount: discountAmount,
    message: `${normalizedCode} applied. You saved ${rupees(discountAmount)}.`
  };
}

function nextDiscountMessage(order = {}) {
  const customer = order.customer || {};
  if (order.discountCode === 'NIKA5') {
    return 'Your first-order discount was applied. For your next purchases, use NIKA8 to get 8% off.';
  }
  if (customer.customerId || customer.accountEmail) {
    return 'For your next purchases, use NIKA8 to get 8% off as a returning customer.';
  }
  return '';
}

module.exports = {
  DISCOUNT_CODES,
  evaluateDiscount,
  nextDiscountMessage,
  normalizeDiscountCode
};
