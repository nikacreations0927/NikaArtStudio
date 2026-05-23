const crypto = require('crypto');
const { db } = require('../db/connection');

const CUSTOMER_SESSION_COOKIE = 'nika_customer_session';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseCookies(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map(cookie => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, cookie) => {
      const separator = cookie.indexOf('=');
      if (separator === -1) return cookies;

      const key = decodeURIComponent(cookie.slice(0, separator));
      const value = decodeURIComponent(cookie.slice(separator + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function getCustomerSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[CUSTOMER_SESSION_COOKIE] || '';
}

function getCustomerFromSession(req) {
  const token = getCustomerSessionToken(req);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = db.prepare(`
    SELECT
      s.token_hash,
      s.expires_at,
      c.id,
      c.first_name,
      c.last_name,
      c.email,
      c.mobile
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
  `).get(tokenHash, Date.now());

  if (!session) return null;

  db.prepare("UPDATE customer_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?").run(tokenHash);
  return {
    id: session.id,
    firstName: session.first_name,
    lastName: session.last_name,
    email: session.email,
    mobile: session.mobile,
    tokenHash: session.token_hash,
    expiresAt: session.expires_at
  };
}

function optionalCustomer(req, res, next) {
  req.customer = getCustomerFromSession(req);
  next();
}

function requireCustomer(req, res, next) {
  const customer = getCustomerFromSession(req);
  if (!customer) {
    return res.status(401).json({ success: false, message: 'Please log in.' });
  }

  req.customer = customer;
  next();
}

module.exports = {
  CUSTOMER_SESSION_COOKIE,
  getCustomerSessionToken,
  hashToken,
  optionalCustomer,
  requireCustomer
};
