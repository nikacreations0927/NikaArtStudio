// db/schema.js
// Responsible only for table/index creation and additive schema migrations.
// Called once on startup via db/connection.js -> initDatabase().

const { pool } = require('./pool');

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT,
      email TEXT UNIQUE NOT NULL,
      mobile TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      revoked_at TIMESTAMPTZ,
      user_agent TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_password_resets (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      revoked_at TIMESTAMPTZ,
      user_agent TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      category TEXT NOT NULL,
      image TEXT DEFAULT '',
      product_images TEXT NOT NULL DEFAULT '[]',
      description TEXT DEFAULT '',
      color_options TEXT NOT NULL DEFAULT '[]',
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      is_active INTEGER NOT NULL DEFAULT 1,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_json TEXT NOT NULL,
      subtotal INTEGER NOT NULL DEFAULT 0,
      shipping INTEGER NOT NULL DEFAULT 0,
      discount_code TEXT DEFAULT '',
      discount_percent INTEGER NOT NULL DEFAULT 0,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      order_type TEXT NOT NULL DEFAULT 'STANDARD',
      advance_amount INTEGER NOT NULL DEFAULT 0,
      balance_amount INTEGER NOT NULL DEFAULT 0,
      balance_provider_transaction_id TEXT,
      balance_requested_at TIMESTAMPTZ,
      balance_paid_at TIMESTAMPTZ,
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      fulfillment_status TEXT NOT NULL DEFAULT 'PENDING',
      logistics_status TEXT NOT NULL DEFAULT 'NOT_CREATED',
      payment_provider TEXT DEFAULT 'Manual UPI',
      provider_transaction_id TEXT,
      shiprocket_order_id TEXT,
      shiprocket_shipment_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      name_snapshot TEXT NOT NULL,
      color_snapshot TEXT DEFAULT '',
      price_snapshot INTEGER NOT NULL,
      qty INTEGER NOT NULL CHECK (qty > 0),
      line_total INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_events (
      id SERIAL PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'Manual UPI',
      provider_transaction_id TEXT,
      status TEXT NOT NULL,
      raw_json TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logistics_events (
      id SERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'Shiprocket',
      status TEXT NOT NULL,
      tracking_id TEXT,
      raw_json TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_active_deleted ON products (is_active, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions (expires_at);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions (expires_at);
  `);

  // Additive column migrations - safe to run every boot (idempotent)
  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'STANDARD';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS advance_amount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_amount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_percent INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_provider_transaction_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_requested_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS product_images TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS color_options TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS color_snapshot TEXT DEFAULT '';
  `);
}

module.exports = { initSchema };
