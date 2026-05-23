// routes/auth.js
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { db } = require('../db/connection'); // Adjust path if your DB connection is elsewhere
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

const router = express.Router();

const ADMIN_SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 12);
const CUSTOMER_SESSION_DAYS = Number(process.env.CUSTOMER_SESSION_DAYS || 30);
const PASSWORD_RESET_MINUTES = Number(process.env.PASSWORD_RESET_MINUTES || 30);

// Generate unique customer ID
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

function clearExpiredAdminSessions() {
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(Date.now());
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

function clearExpiredCustomerSecurityRows() {
  const now = Date.now();
  db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(now);
  db.prepare('DELETE FROM customer_password_resets WHERE expires_at <= ? OR used_at IS NOT NULL').run(now);
}

function createCustomerSession(res, req, customer) {
  clearExpiredCustomerSecurityRows();

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashCustomerToken(token);
  const expiresAt = Date.now() + CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000;

  db.prepare(`
    INSERT INTO customer_sessions (token_hash, customer_id, expires_at, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, customer.id, expiresAt, String(req.headers['user-agent'] || '').slice(0, 240));

  res.cookie(CUSTOMER_SESSION_COOKIE, token, customerSessionCookieOptions());
  return tokenHash;
}

function resetUrlForRequest(req, token) {
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/account.html?resetToken=${encodeURIComponent(token)}`;
}

// --- Admin Login ---
router.post('/admin/login', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const admin = db.prepare('SELECT * FROM admin_users WHERE lower(username) = ? AND is_active = 1').get(username);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Invalid admin username or password.' });
  }

  const isMatch = await bcrypt.compare(password, admin.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid admin username or password.' });
  }

  clearExpiredAdminSessions();

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + ADMIN_SESSION_HOURS * 60 * 60 * 1000;

  db.prepare(`
    INSERT INTO admin_sessions (token_hash, admin_user_id, expires_at, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, admin.id, expiresAt, String(req.headers['user-agent'] || '').slice(0, 240));
  db.prepare(`UPDATE admin_users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(admin.id);

  res.cookie(ADMIN_SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ success: true, message: 'Admin login successful.', admin: publicAdmin(admin) });
}));

router.post('/admin/logout', asyncHandler(async (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    db.prepare(`UPDATE admin_sessions SET revoked_at = datetime('now') WHERE token_hash = ?`).run(hashToken(token));
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

  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ? AND is_active = 1').get(req.admin.id);
  if (!admin) return res.status(404).json({ success: false, message: 'Admin user not found.' });

  const isMatch = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare(`UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(passwordHash, admin.id);
  db.prepare(`
    UPDATE admin_sessions
    SET revoked_at = datetime('now')
    WHERE admin_user_id = ?
      AND token_hash != ?
      AND revoked_at IS NULL
  `).run(admin.id, req.admin.tokenHash);

  res.json({ success: true, message: 'Admin password updated. Other admin sessions were signed out.' });
}));

// --- Customer Registration ---
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

  const existingUser = db.prepare('SELECT id FROM customers WHERE lower(email) = ?').get(email);
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const id = nextCustomerId();

  db.prepare(`
    INSERT INTO customers (id, first_name, last_name, email, mobile, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, firstName, lastName, email, mobile, passwordHash);

  const customer = db.prepare('SELECT id, first_name, last_name, email, mobile FROM customers WHERE id = ?').get(id);
  createCustomerSession(res, req, customer);

  res.status(201).json({
    success: true,
    message: 'Registration successful',
    customer: publicCustomer(customer)
  });
}));

// --- Customer Login ---
router.post('/login', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const customer = db.prepare('SELECT * FROM customers WHERE lower(email) = ?').get(email);
  if (!customer) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const isMatch = await bcrypt.compare(password, customer.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  createCustomerSession(res, req, customer);

  res.json({
    success: true,
    message: 'Login successful',
    customer: publicCustomer(customer)
  });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = getCustomerSessionToken(req);
  if (token) {
    db.prepare(`UPDATE customer_sessions SET revoked_at = datetime('now') WHERE token_hash = ?`).run(hashCustomerToken(token));
  }

  res.clearCookie(CUSTOMER_SESSION_COOKIE, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.json({ success: true, message: 'Logged out.' });
}));

router.get('/me', requireCustomer, asyncHandler(async (req, res) => {
  const customer = db.prepare('SELECT id, first_name, last_name, email, mobile, created_at FROM customers WHERE id = ?').get(req.customer.id);
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

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.customer.id);
  if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

  const isMatch = await bcrypt.compare(currentPassword, customer.password_hash);
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').run(passwordHash, customer.id);
  db.prepare(`
    UPDATE customer_sessions
    SET revoked_at = datetime('now')
    WHERE customer_id = ?
      AND token_hash != ?
      AND revoked_at IS NULL
  `).run(customer.id, req.customer.tokenHash);

  res.json({ success: true, message: 'Password updated. Other customer sessions were signed out.' });
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const customer = email
    ? db.prepare('SELECT id, first_name AS firstName, email FROM customers WHERE lower(email) = ?').get(email)
    : null;

  let devResetUrl = null;
  if (customer) {
    clearExpiredCustomerSecurityRows();

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashCustomerToken(token);
    const expiresAt = Date.now() + PASSWORD_RESET_MINUTES * 60 * 1000;

    db.prepare(`UPDATE customer_password_resets SET used_at = datetime('now') WHERE customer_id = ? AND used_at IS NULL`).run(customer.id);
    db.prepare(`
      INSERT INTO customer_password_resets (token_hash, customer_id, expires_at)
      VALUES (?, ?, ?)
    `).run(tokenHash, customer.id, expiresAt);

    const resetUrl = resetUrlForRequest(req, token);
    let sent = false;
    try {
      sent = await sendPasswordResetEmail(customer, resetUrl);
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
  const reset = db.prepare(`
    SELECT r.token_hash, r.customer_id, c.*
    FROM customer_password_resets r
    JOIN customers c ON c.id = r.customer_id
    WHERE r.token_hash = ?
      AND r.used_at IS NULL
      AND r.expires_at > ?
  `).get(tokenHash, Date.now());

  if (!reset) {
    return res.status(400).json({ success: false, message: 'This reset link is invalid or expired.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').run(passwordHash, reset.customer_id);
  db.prepare(`UPDATE customer_password_resets SET used_at = datetime('now') WHERE token_hash = ?`).run(tokenHash);
  db.prepare(`UPDATE customer_sessions SET revoked_at = datetime('now') WHERE customer_id = ? AND revoked_at IS NULL`).run(reset.customer_id);

  createCustomerSession(res, req, reset);

  res.json({
    success: true,
    message: 'Password reset successful.',
    customer: publicCustomer(reset)
  });
}));

router.get('/orders', requireCustomer, asyncHandler(async (req, res) => {
  const orders = listOrders({ limit: 200 })
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
