const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { db, nowSql } = require('../db/connection');
const { listOrders } = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const {
  CUSTOMER_SESSION_COOKIE,
  getCustomerSessionToken,
  hashToken: hashCustomerToken,
  requireCustomer
} = require('../middleware/customerAuth');
const { ADMIN_SESSION_COOKIE, getSessionToken, hashToken, requireAdmin } = require('../middleware/adminAuth');
const { hasEmailConfig, sendPasswordResetEmail } = require('../services/email');
const { numberFromEnv } = require('../utils/env');

const router = express.Router();

const ADMIN_SESSION_HOURS = numberFromEnv('ADMIN_SESSION_HOURS', 12, { min: 1 });
const CUSTOMER_SESSION_DAYS = numberFromEnv('CUSTOMER_SESSION_DAYS', 30, { min: 1 });
const PASSWORD_RESET_MINUTES = numberFromEnv('PASSWORD_RESET_MINUTES', 30, { min: 1 });

const nextCustomerId = () => 'CUST' + Date.now() + Math.floor(Math.random() * 1000);
const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: ADMIN_SESSION_HOURS * 60 * 60 * 1000
});

function publicAdmin(admin) {
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.display_name || admin.displayName || 'Business Admin',
    role: admin.role || 'owner'
  };
}

async function clearExpiredAdminSessions() {
  await db.run('DELETE FROM admin_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', [Date.now()]);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicCustomer(customer) {
  return {
    id: customer.id,
    firstName: customer.first_name || customer.firstName || '',
    lastName: customer.last_name || customer.lastName || '',
    email: customer.email,
    mobile: customer.mobile || ''
  };
}

const customerSessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000
});

async function clearExpiredCustomerSecurityRows() {
  const now = Date.now();
  await db.run('DELETE FROM customer_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', [now]);
  await db.run('DELETE FROM customer_password_resets WHERE expires_at <= ? OR used_at IS NOT NULL', [now]);
}

async function createCustomerSession(res, req, customer) {
  await clearExpiredCustomerSecurityRows();

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashCustomerToken(token);
  const expiresAt = Date.now() + CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000;

  await db.run(`
    INSERT INTO customer_sessions (token_hash, customer_id, expires_at, user_agent)
    VALUES (?, ?, ?, ?)
  `, [tokenHash, customer.id, expiresAt, String(req.headers['user-agent'] || '').slice(0, 240)]);

  res.cookie(CUSTOMER_SESSION_COOKIE, token, customerSessionCookieOptions());
  return tokenHash;
}

function resetUrlForRequest(req, token) {
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/account.html?resetToken=${encodeURIComponent(token)}`;
}

router.post('/admin/login', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const admin = await db.get('SELECT * FROM admin_users WHERE lower(username) = ? AND is_active = 1', [username]);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Invalid admin username or password.' });
  }

  const isMatch = await bcrypt.compare(password, admin.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid admin username or password.' });
  }

  await clearExpiredAdminSessions();

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + ADMIN_SESSION_HOURS * 60 * 60 * 1000;

  await db.run(`
    INSERT INTO admin_sessions (token_hash, admin_user_id, expires_at, user_agent)
    VALUES (?, ?, ?, ?)
  `, [tokenHash, admin.id, expiresAt, String(req.headers['user-agent'] || '').slice(0, 240)]);
  await db.run(`UPDATE admin_users SET last_login_at = ${nowSql}, updated_at = ${nowSql} WHERE id = ?`, [admin.id]);

  res.cookie(ADMIN_SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ success: true, message: 'Admin login successful.', admin: publicAdmin(admin) });
}));

router.post('/admin/logout', asyncHandler(async (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    await db.run(`UPDATE admin_sessions SET revoked_at = ${nowSql} WHERE token_hash = ?`, [hashToken(token)]);
  }
  res.clearCookie(ADMIN_SESSION_COOKIE, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ success: true, message: 'Logged out.' });
}));

router.get('/admin/me', requireAdmin, asyncHandler(async (req, res) => {
  res.json({ success: true, admin: publicAdmin(req.admin) });
}));

router.post('/admin/password', requireAdmin, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: 'Choose a new password that is different from the current password.' });
  }

  const admin = await db.get('SELECT * FROM admin_users WHERE id = ? AND is_active = 1', [req.admin.id]);
  if (!admin) return res.status(404).json({ success: false, message: 'Admin user not found.' });

  const isMatch = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.run(`UPDATE admin_users SET password_hash = ?, updated_at = ${nowSql} WHERE id = ?`, [passwordHash, admin.id]);
  await db.run(`
    UPDATE admin_sessions
    SET revoked_at = ${nowSql}
    WHERE admin_user_id = ?
      AND token_hash != ?
      AND revoked_at IS NULL
  `, [admin.id, req.admin.tokenHash]);

  res.json({ success: true, message: 'Admin password updated. Other admin sessions were signed out.' });
}));

router.post('/register', asyncHandler(async (req, res) => {
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const email = normalizeEmail(req.body.email);
  const mobile = String(req.body.mobile || '').trim();
  const password = String(req.body.password || '');

  if (!firstName || !email || !password) {
    return res.status(400).json({ success: false, message: 'First name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  const existingUser = await db.get('SELECT id FROM customers WHERE lower(email) = ?', [email]);
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = nextCustomerId();

  await db.run(`
    INSERT INTO customers (id, first_name, last_name, email, mobile, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [id, firstName, lastName, email, mobile, passwordHash]);

  const customer = await db.get('SELECT id, first_name, last_name, email, mobile FROM customers WHERE id = ?', [id]);
  await createCustomerSession(res, req, customer);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    customer: publicCustomer(customer)
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const customer = await db.get('SELECT * FROM customers WHERE lower(email) = ?', [email]);
  if (!customer) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const isMatch = await bcrypt.compare(password, customer.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  await createCustomerSession(res, req, customer);

  res.json({
    success: true,
    message: 'Login successful',
    customer: publicCustomer(customer)
  });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = getCustomerSessionToken(req);
  if (token) {
    await db.run(`UPDATE customer_sessions SET revoked_at = ${nowSql} WHERE token_hash = ?`, [hashCustomerToken(token)]);
  }

  res.clearCookie(CUSTOMER_SESSION_COOKIE, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ success: true, message: 'Logged out.' });
}));

router.get('/me', requireCustomer, asyncHandler(async (req, res) => {
  const customer = await db.get('SELECT id, first_name, last_name, email, mobile, created_at FROM customers WHERE id = ?', [req.customer.id]);
  if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

  res.json({
    success: true,
    customer: {
      ...publicCustomer(customer),
      createdAt: customer.created_at
    }
  });
}));

router.post('/password', requireCustomer, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ success: false, message: 'Choose a new password that is different from the current password.' });
  }

  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [req.customer.id]);
  if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

  const isMatch = await bcrypt.compare(currentPassword, customer.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.run(`UPDATE customers SET password_hash = ? WHERE id = ?`, [passwordHash, customer.id]);
  await db.run(`
    UPDATE customer_sessions
    SET revoked_at = ${nowSql}
    WHERE customer_id = ?
      AND token_hash != ?
      AND revoked_at IS NULL
  `, [customer.id, req.customer.tokenHash]);

  res.json({ success: true, message: 'Password updated. Other customer sessions were signed out.' });
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const customer = email
    ? await db.get('SELECT id, first_name, email FROM customers WHERE lower(email) = ?', [email])
    : null;

  let devResetUrl = null;
  if (customer) {
    await clearExpiredCustomerSecurityRows();

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashCustomerToken(token);
    const expiresAt = Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000;

    await db.run(`UPDATE customer_password_resets SET used_at = ${nowSql} WHERE customer_id = ? AND used_at IS NULL`, [customer.id]);
    await db.run(`
      INSERT INTO customer_password_resets (token_hash, customer_id, expires_at)
      VALUES (?, ?, ?)
    `, [tokenHash, customer.id, expiresAt]);

    const resetUrl = resetUrlForRequest(req, token);
    let sent = false;
    try {
      sent = await sendPasswordResetEmail({ ...customer, firstName: customer.first_name }, resetUrl);
    } catch (err) {
      console.error('Password reset email failed:', err.message);
    }
    if (!sent && process.env.NODE_ENV !== 'production' && !hasEmailConfig()) {
      devResetUrl = resetUrl;
    }
  }

  res.json({
    success: true,
    message: 'If an account exists for that email, a password reset link has been sent.',
    ...(devResetUrl ? { resetUrl: devResetUrl } : {})
  });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const token = String(req.body.token || '');
  const newPassword = String(req.body.newPassword || '');

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
  }

  const tokenHash = hashCustomerToken(token);
  const reset = await db.get(`
    SELECT r.token_hash, r.customer_id, c.*
    FROM customer_password_resets r
    JOIN customers c ON c.id = r.customer_id
    WHERE r.token_hash = ?
      AND r.used_at IS NULL
      AND r.expires_at > ?
  `, [tokenHash, Date.now()]);

  if (!reset) {
    return res.status(400).json({ success: false, message: 'This reset link is invalid or expired.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.run('UPDATE customers SET password_hash = ? WHERE id = ?', [passwordHash, reset.customer_id]);
  await db.run(`UPDATE customer_password_resets SET used_at = ${nowSql} WHERE token_hash = ?`, [tokenHash]);
  await db.run(`UPDATE customer_sessions SET revoked_at = ${nowSql} WHERE customer_id = ? AND revoked_at IS NULL`, [reset.customer_id]);

  await createCustomerSession(res, req, reset);

  res.json({
    success: true,
    message: 'Password reset successful.',
    customer: publicCustomer(reset)
  });
}));

router.get('/orders', requireCustomer, asyncHandler(async (req, res) => {
  const orders = (await listOrders({ limit: 200 }))
    .filter(order => String(order.customer.email || '').toLowerCase() === String(req.customer.email || '').toLowerCase())
    .map(order => ({
      id: order.id,
      total: order.total,
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      logisticsStatus: order.logisticsStatus,
      createdAt: order.createdAt,
      items: order.items
    }));

  res.json({ success: true, orders });
}));

module.exports = router;
