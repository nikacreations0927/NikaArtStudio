// db/connection.js
// Slim orchestrator: builds the db wrapper, then delegates schema and seed
// responsibilities to db/pool.js, db/schema.js, and db/seed.js.
// Kept for backwards compatibility - all existing imports of db/connection.js
// continue to work unchanged.

const { pool, withParams } = require('./pool');
const { initSchema }       = require('./schema');
const { seedDatabase }     = require('./seed');

const nowSql = 'CURRENT_TIMESTAMP';

const db = {
  async query(sql, params = []) {
    return pool.query(sql, params);
  },
  async get(sql, params = []) {
    const result = await pool.query(withParams(sql, params));
    return result.rows[0] || null;
  },
  async all(sql, params = []) {
    const result = await pool.query(withParams(sql, params));
    return result.rows;
  },
  async run(sql, params = []) {
    const result = await pool.query(withParams(sql, params));
    return { changes: result.rowCount };
  },
  async transaction(callback) {
    const client = await pool.connect();
    const tx = {
      async query(sql, params = []) { return client.query(sql, params); },
      async get(sql, params = []) {
        const result = await client.query(withParams(sql, params));
        return result.rows[0] || null;
      },
      async all(sql, params = []) {
        const result = await client.query(withParams(sql, params));
        return result.rows;
      },
      async run(sql, params = []) {
        const result = await client.query(withParams(sql, params));
        return { changes: result.rowCount };
      }
    };

    try {
      await client.query('BEGIN');
      const value = await callback(tx);
      await client.query('COMMIT');
      return value;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};

async function initDatabase() {
  await initSchema();
  await seedDatabase(db);
}

const ready = initDatabase();

module.exports = { db, nowSql, pool, ready };
