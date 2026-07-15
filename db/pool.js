// db/pool.js
// Exports the shared pg.Pool instance and the withParams helper.
// Kept separate so schema.js and seed.js can import the pool
// without creating a circular dependency with db/connection.js.

const { Pool } = require('pg');
const { numberFromEnv } = require('../utils/env');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    'Postgres connection string missing. Add DATABASE_URL from Supabase to your environment variables.'
  );
}

function looksLikeSupabaseDirectUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.hostname.startsWith('db.') &&
      url.hostname.endsWith('.supabase.co') &&
      url.port === '5432'
    );
  } catch {
    return false;
  }
}

if (
  looksLikeSupabaseDirectUrl(connectionString) &&
  process.env.ALLOW_SUPABASE_DIRECT_URL !== 'true'
) {
  throw new Error(
    'DATABASE_URL is using the Supabase direct database host, which is IPv6-only on many free projects. ' +
    'Use the Supabase Session pooler connection string in Render instead.'
  );
}

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: numberFromEnv('PG_POOL_MAX', 5, { min: 1 }),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true
});

pool.on('error', (err) => {
  console.error('Postgres idle client error:', err.message);
});

function withParams(sql, params = []) {
  let index = 0;
  return {
    text: sql.replace(/\?/g, () => `$${++index}`),
    values: params
  };
}

module.exports = { pool, withParams };
