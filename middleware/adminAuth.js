function isAuthorized(req) {
  const apiKey = process.env.ADMIN_API_KEY;
  if (apiKey && req.headers['x-admin-key'] === apiKey) return true;

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return !apiKey;

  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return false;

    const providedUser = decoded.slice(0, separator);
    const providedPass = decoded.slice(separator + 1);
    return providedUser === username && providedPass === password;
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (isAuthorized(req)) return next();
  return res.status(401).json({ success: false, message: 'Admin login required.' });
}

module.exports = {
  isAuthorized,
  requireAdmin
};
