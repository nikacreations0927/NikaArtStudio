require('dotenv').config();

const bcrypt = require('bcrypt');
const { db, nowSql, pool, ready } = require('../db');

const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const displayName = String(process.env.ADMIN_DISPLAY_NAME || 'Business Admin').trim() || 'Business Admin';

async function main() {
  if (!username || !password) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD in .env before running this script.');
  }

  await ready;

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await db.get('SELECT id FROM admin_users WHERE lower(username) = ?', [username]);

  if (existing) {
    await db.run(`
      UPDATE admin_users
      SET display_name = ?, password_hash = ?, is_active = 1, updated_at = ${nowSql}
      WHERE id = ?
    `, [displayName, passwordHash, existing.id]);
    await db.run(`UPDATE admin_sessions SET revoked_at = ${nowSql} WHERE admin_user_id = ?`, [existing.id]);
    console.log(`Updated admin user "${username}" and revoked old sessions.`);
  } else {
    await db.run(`
      INSERT INTO admin_users (id, username, display_name, password_hash, role)
      VALUES (?, ?, ?, ?, 'owner')
    `, [`ADMIN${Date.now()}`, username, displayName, passwordHash]);
    console.log(`Created admin user "${username}".`);
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
