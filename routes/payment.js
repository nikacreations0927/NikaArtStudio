// routes/payment.js
const express = require('express');
const { createOrderFromCart, getOrder, recordPayment, submitPrebookBalanceReference } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { sendOrderPlacedAdminEmail, sendOrderPlacedCustomerEmail } = require('../services/email');
const { optionalCustomer } = require('../middleware/customerAuth');

const router = express.Router();

// PhonePe gateway integration is intentionally inactive until the merchant
// account is approved. The checkout currently uses manual UPI verification.

function normalizeReference(value) {
  return String(value || '').trim().slice(0, 80);
}

function sendOrderPlacedEmails(customer, order, options = {}) {
  return Promise.allSettled([
    sendOrderPlacedAdminEmail(customer, order, options),
    sendOrderPlacedCustomerEmail(customer, order, options)
  ]).then(([adminResult, customerResult]) => {
    const status = {
      admin: adminResult.status === 'fulfilled' && adminResult.value === true,
      customer: customerResult.status === 'fulfilled' && customerResult.value === true
    };

    if (!status.admin || !status.customer) {
      console.error('Order email notification incomplete:', {
        orderId: order.id,
        status,
        adminError: adminResult.status === 'rejected' ? adminResult.reason?.message : null,
        customerError: customerResult.status === 'rejected' ? customerResult.reason?.message : null
      });
    }

    return status;
  }).catch(err => {
    console.error('Order email notification failed:', { orderId: order.id, error: err.message });
    return { admin: false, customer: false };
  });
}

router.post('/initiate', asyncHandler(async (req, res) => {
  const { customer, items, cart, upiReference } = req.body;
  const orderItems = items || cart;
  const reference = normalizeReference(upiReference);

  if (!customer || !orderItems) {
    return res.status(400).json({ success: false, message: 'Missing required order fields.' });
  }
  if (!reference) {
    return res.status(400).json({ success: false, message: 'Enter the UPI transaction/reference ID after payment.' });
  }

  const orderId = 'NIKA' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const isPrebook = orderItems.some(item => item.prebook === true || item.orderType === 'PREBOOK');
  const order = await createOrderFromCart(orderItems, customer, {
    id: orderId,
    paymentStatus: isPrebook ? 'PREBOOK_ADVANCE_PENDING' : 'UPI_PENDING_VERIFICATION',
    fulfillmentStatus: isPrebook ? 'PREBOOK_ADVANCE_PENDING' : 'PENDING',
    paymentProvider: 'Manual UPI'
  });

  await recordPayment({
    orderId,
    status: isPrebook ? 'PREBOOK_ADVANCE_PENDING' : 'UPI_PENDING_VERIFICATION',
    provider: 'Manual UPI',
    providerTransactionId: reference,
    raw: {
      submittedByCustomer: true,
      upiReference: reference,
      stage: isPrebook ? 'advance' : 'full',
      note: isPrebook
        ? 'Customer submitted pre-book advance UPI reference. Admin must verify before balance request.'
        : 'Customer submitted manual UPI reference. Admin must verify before fulfillment.'
    }
  });

  const emailOrder = await getOrder(orderId);
  sendOrderPlacedEmails(customer, emailOrder, { stage: isPrebook ? 'advance' : 'full' });

  res.json({
    success: true,
    manual: true,
    prebook: isPrebook,
    orderId,
    status: order.paymentStatus,
    emailQueued: true,
    order: await getOrder(orderId)
  });
}));

router.post('/prebook/:orderId/balance', optionalCustomer, asyncHandler(async (req, res) => {
  const reference = normalizeReference(req.body?.upiReference);
  if (!reference) {
    return res.status(400).json({ success: false, message: 'Enter the UPI transaction/reference ID after paying the balance amount.' });
  }

  const existingOrder = await getOrder(req.params.orderId);
  if (!existingOrder) return res.status(404).json({ success: false, message: 'Order not found.' });

  const contact = String(req.body?.contact || '').trim();
  const email = String(req.body?.email || (contact.includes('@') ? contact : '')).trim().toLowerCase();
  const phone = String(req.body?.phone || (!contact.includes('@') ? contact : '')).trim();
  const customerEmail = String(existingOrder.customer.email || '').trim().toLowerCase();
  const customerPhone = String(existingOrder.customer.phone || existingOrder.customer.mobile || '').trim();
  const loggedInMatch = req.customer && String(req.customer.email || '').toLowerCase() === customerEmail;
  const canSubmit = loggedInMatch || (email && email === customerEmail) || (phone && phone === customerPhone);

  if (!canSubmit) {
    return res.status(401).json({ success: false, message: 'Log in with the order email, or enter the email/phone used for this order before submitting balance payment.' });
  }

  const order = await submitPrebookBalanceReference(req.params.orderId, reference);

  sendOrderPlacedEmails(order.customer, order, { stage: 'balance' });

  res.json({
    success: true,
    manual: true,
    prebook: true,
    orderId: order.id,
    status: order.paymentStatus,
    emailQueued: true,
    order
  });
}));

router.get('/status/:txnId', asyncHandler(async (req, res) => {
  const order = await getOrder(req.params.txnId);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  res.json({
    success: true,
    status: order.paymentStatus,
    manual: order.paymentProvider === 'Manual UPI'
  });
}));

module.exports = router;
