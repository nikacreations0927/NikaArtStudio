require('dotenv').config();

const bcrypt = require('bcrypt');
const { db } = require('../db/connection');

const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const displayName = String(process.env.ADMIN_DISPLAY_NAME || 'Business Admin').trim() || 'Business Admin';

if (!username || !password) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD in .env before running this script.');
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 12);
const existing = db.prepare('SELECT id FROM admin_users WHERE lower(username) = ?').get(username);

if (existing) {
  db.prepare(`
    UPDATE admin_users
    SET display_name = ?, password_hash = ?, is_active = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(displayName, passwordHash, existing.id);
  db.prepare(`UPDATE admin_sessions SET revoked_at = datetime('now') WHERE admin_user_id = ?`).run(existing.id);
  console.log(`Updated admin user "${username}" and revoked old sessions.`);
} else {
  db.prepare(`
    INSERT INTO admin_users (id, username, display_name, password_hash, role)
    VALUES (?, ?, ?, ?, 'owner')
  `).run(`ADMIN${Date.now()}`, username, displayName, passwordHash);
  console.log(`Created admin user "${username}".`);
}
