const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { numberFromEnv } = require('../utils/env');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('Postgres connection string missing. Add DATABASE_URL from Supabase to your environment variables.');
}

function looksLikeSupabaseDirectUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.startsWith('db.') && url.hostname.endsWith('.supabase.co') && url.port === '5432';
  } catch {
    return false;
  }
}

if (looksLikeSupabaseDirectUrl(connectionString) && process.env.ALLOW_SUPABASE_DIRECT_URL !== 'true') {
  throw new Error('DATABASE_URL is using the Supabase direct database host, which is IPv6-only on many free projects. Use the Supabase Session pooler connection string in Render instead.');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: numberFromEnv('PG_POOL_MAX', 5, { min: 1 }),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('Postgres idle client error:', err.message);
});

const dataDir = path.join(__dirname, '..', 'data');
const cloudinaryProductCsvPath = path.join(dataDir, 'keychain-cloudinary-products.csv');
const nowSql = 'CURRENT_TIMESTAMP';
const DEFAULT_CATEGORIES = [
  'Crochet',
  'Keychains',
  'Forever Flowers',
  'Photo Magnets',
  'Dream Catchers',
  'Hair Accessories'
];

function withParams(sql, params = []) {
  let index = 0;
  return {
    text: sql.replace(/\?/g, () => `$${++index}`),
    values: params
  };
}

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
      async query(sql, params = []) {
        return client.query(sql, params);
      },
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

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function parseColorOptions(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[\n;]+/)
    .flatMap(part => (part.includes('|') ? [part] : part.split(',')))
    .map(item => {
      const text = String(item || '').trim();
      const [name, ...imageParts] = text.split('|');
      return { name: String(name || text).trim(), image: imageParts.join('|').trim() };
    })
    .filter(item => item.name)
    .filter(item => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function slugifyProductId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function loadCloudinaryProductsFromCsv() {
  if (!fs.existsSync(cloudinaryProductCsvPath)) return [];

  const lines = fs.readFileSync(cloudinaryProductCsvPath, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim());

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(header => header.trim().toLowerCase());
  const indexOf = (name) => headers.indexOf(name.toLowerCase());
  const indexes = {
    name: indexOf('Name'),
    category: indexOf('Category'),
    price: indexOf('Price'),
    stock: indexOf('Stock'),
    image: indexOf('Image'),
    description: indexOf('Description'),
    colors: indexOf('Colors')
  };

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const name = String(cells[indexes.name] || '').trim();
    if (!name) return null;
    return {
      id: `cloud-${slugifyProductId(name)}`,
      name,
      price: Number(cells[indexes.price] || 0),
      category: String(cells[indexes.category] || 'Keychains').trim() || 'Keychains',
      image: String(cells[indexes.image] || '').trim(),
      description: String(cells[indexes.description] || '').trim(),
      colorOptions: parseColorOptions(cells[indexes.colors]),
      stock: Number(cells[indexes.stock] || 0)
    };
  }).filter(Boolean);
}

async function seedProductRows(products) {
  if (!products.length) return 0;

  return db.transaction(async (tx) => {
    let added = 0;
    for (const p of products) {
      const result = await tx.run(`
        INSERT INTO products (id, name, price, category, image, description, color_options, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING
      `, [p.id, p.name, p.price, p.category, p.image, p.description, JSON.stringify(p.colorOptions || []), p.stock]);
      if (result.changes > 0) {
        await tx.run(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'SEED', ?, ?)`, [p.id, p.stock, 'Seeded from catalog']);
        added += 1;
      }
      await tx.run(`INSERT INTO categories (name) VALUES (?) ON CONFLICT (name) DO NOTHING`, [p.category]);
    }
    return added;
  });
}

async function hasOnlyDefaultPlaceholderProducts() {
  const row = await db.get(`
    SELECT COUNT(*)::int AS count,
      SUM(CASE WHEN id IN (?, ?, ?, ?, ?, ?) AND image = ? THEN 1 ELSE 0 END)::int AS placeholder_count
    FROM products
  `, ['p001', 'p002', 'p003', 'p004', 'p005', 'p006', '']);
  return row.count === 6 && row.placeholder_count === 6;
}

async function seedDatabase() {
  try {
    const defaultContent = {
      hero: { eyebrow: 'Handcrafted with love', title: 'Art that <em>speaks</em><br>to your soul', subtitle: 'Unique paintings, prints, and handmade pieces from our studio in India.' },
      about: { eyebrow: 'Our story', title: 'Where art meets intention', paragraph1: 'Every piece from Nika Arts Studio is created with care.', paragraph2: 'Based in India, we ship across the country and beyond.' },
      contact: { title: 'Get in touch', description: "Questions about a piece? Custom order requests? We'd love to hear from you.", email: 'nika.creations0927@gmail.com', phoneDisplay: '+91 98765 43210', phoneLink: '+919876543210' },
      assets: { logoImage: '', heroImage: 'images/hero.jpg', artistImage: 'images/ArtistPhoto.jpeg' }
    };
    await db.run(`INSERT INTO settings (key, value) VALUES ('site_content', ?) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(defaultContent)]);
  } catch (err) {
    console.error('Failed to seed default content:', err);
  }

  try {
    await db.run(`UPDATE products SET category = 'Forever Flowers', updated_at = ${nowSql} WHERE lower(category) = 'flowers'`);
    const foreverFlowers = await db.get('SELECT id FROM categories WHERE lower(name) = lower(?)', ['Forever Flowers']);
    const legacyFlowers = await db.get('SELECT id FROM categories WHERE lower(name) = lower(?)', ['Flowers']);
    if (legacyFlowers && !foreverFlowers) {
      await db.run(`UPDATE categories SET name = 'Forever Flowers', is_active = 1, updated_at = ${nowSql} WHERE id = ?`, [legacyFlowers.id]);
    } else if (legacyFlowers && foreverFlowers) {
      await db.run(`UPDATE categories SET is_active = 0, updated_at = ${nowSql} WHERE id = ?`, [legacyFlowers.id]);
      await db.run(`UPDATE categories SET is_active = 1, updated_at = ${nowSql} WHERE id = ?`, [foreverFlowers.id]);
    }
  } catch (err) {
    console.error('Failed to migrate Flowers category name:', err);
  }

  try {
    const adminUsername = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');
    const existingAdminCount = await db.get('SELECT COUNT(*)::int AS count FROM admin_users');

    if (adminUsername && adminPassword && existingAdminCount.count === 0) {
      const passwordHash = bcrypt.hashSync(adminPassword, 12);
      await db.run(`
        INSERT INTO admin_users (id, username, display_name, password_hash, role)
        VALUES (?, ?, ?, ?, 'owner')
      `, [`ADMIN${Date.now()}`, adminUsername, process.env.ADMIN_DISPLAY_NAME || 'Business Admin', passwordHash]);
      console.log(`Seeded admin user "${adminUsername}" from environment variables.`);
    }
  } catch (err) {
    console.error('Failed to seed admin user:', err);
  }

  const cloudinaryProducts = loadCloudinaryProductsFromCsv();
  const row = await db.get('SELECT COUNT(*)::int AS count FROM products');
  const shouldSeedCloudinaryCatalog = cloudinaryProducts.length > 0 && (row.count === 0 || await hasOnlyDefaultPlaceholderProducts());

  if (shouldSeedCloudinaryCatalog) {
    try {
      if (await hasOnlyDefaultPlaceholderProducts()) {
        await db.transaction(async (tx) => {
          await tx.run('DELETE FROM inventory_events WHERE product_id IN (?, ?, ?, ?, ?, ?)', ['p001', 'p002', 'p003', 'p004', 'p005', 'p006']);
          await tx.run('DELETE FROM products WHERE id IN (?, ?, ?, ?, ?, ?)', ['p001', 'p002', 'p003', 'p004', 'p005', 'p006']);
        });
      }
      const added = await seedProductRows(cloudinaryProducts);
      if (added > 0) console.log(`Seeded ${added} Cloudinary catalog products from CSV.`);
    } catch (err) {
      console.error('Failed to seed Cloudinary products:', err);
    }
  }

  try {
    for (const category of DEFAULT_CATEGORIES) {
      await db.run(`
        INSERT INTO categories (name, is_active)
        VALUES (?, 1)
        ON CONFLICT (name) DO UPDATE SET is_active = 1, updated_at = ${nowSql}
      `, [category]);
    }
  } catch (err) {
    console.error('Failed to seed default categories:', err);
  }

  const productCount = await db.get('SELECT COUNT(*)::int AS count FROM products');
  if (productCount.count > 0) return;

  const defaultProducts = [
    { id: 'p001', name: 'Lily', price: 449, category: 'Crochet', image: '', description: 'Handmade crochet lily.', stock: 10 },
    { id: 'p002', name: 'Sunflower', price: 549, category: 'Crochet', image: '', description: 'Handmade crochet sunflower.', stock: 10 },
    { id: 'p003', name: 'Rose', price: 349, category: 'Crochet', image: '', description: 'Handmade crochet rose.', stock: 10 },
    { id: 'p004', name: 'Flower Bouquet', price: 349, category: 'Keychains', image: '', description: 'Handmade flower bouquet keychain.', stock: 10 },
    { id: 'p005', name: 'Long Neck', price: 549, category: 'Keychains', image: '', description: 'Handmade long neck keychain.', stock: 10 },
    { id: 'p006', name: 'Bee Happy', price: 449, category: 'Keychains', image: '', description: 'Handmade Bee Happy keychain.', stock: 10 }
  ];

  try {
    await seedProductRows(defaultProducts);
  } catch (err) {
    console.error('Failed to seed database:', err);
  }
}

async function initDatabase() {
  await initSchema();
  await seedDatabase();
}

const ready = initDatabase();

module.exports = { db, nowSql, pool, ready };
