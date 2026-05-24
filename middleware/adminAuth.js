const crypto = require('crypto');
const { db } = require('../db/connection');

const ADMIN_SESSION_COOKIE = 'nika_admin_session';

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

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[ADMIN_SESSION_COOKIE] || '';
}

async function getAdminFromSession(req) {
  const token = getSessionToken(req);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await db.get(`
    SELECT
      s.token_hash,
      s.expires_at,
      u.id,
      u.username,
      u.display_name,
      u.role,
      u.is_active
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.admin_user_id
    WHERE s.token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.is_active = 1
  `, [tokenHash, Date.now()]);

  if (!session) return null;

  await db.run('UPDATE admin_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?', [tokenHash]);
  return {
    id: session.id,
    username: session.username,
    displayName: session.display_name,
    role: session.role,
    tokenHash: session.token_hash,
    expiresAt: session.expires_at
  };
}

async function isAuthorized(req) {
  const apiKey = process.env.ADMIN_API_KEY;
  if (apiKey && req.headers['x-admin-key'] === apiKey) {
    req.admin = { id: 'api-key', username: 'api-key', role: 'automation' };
    return true;
  }

  const admin = await getAdminFromSession(req);
  if (!admin) return false;

  req.admin = admin;
  return true;
}

async function requireAdmin(req, res, next) {
  try {
    if (await isAuthorized(req)) return next();
    return res.status(401).json({ success: false, message: 'Admin login required.' });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  getSessionToken,
  hashToken,
  isAuthorized,
  requireAdmin
};
