// db/connection.js
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.SQLITE_DB_PATH || path.join(dataDir, 'store.sqlite');
const db = new DatabaseSync(dbPath);

// Optimize SQLite for performance
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const nowSql = "datetime('now')";
const cloudinaryProductCsvPath = path.join(dataDir, 'keychain-cloudinary-products.csv');

/**
 * Initializes the database tables if they do not exist.
 */


function initSchema() {

  db.exec(`
	CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT UNIQUE NOT NULL,
  mobile TEXT,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      revoked_at TEXT,
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      last_seen_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS customer_password_resets (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );


    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      revoked_at TEXT,
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      last_seen_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      category TEXT NOT NULL,
      image TEXT DEFAULT '',
      description TEXT DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      is_active INTEGER NOT NULL DEFAULT 1,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_json TEXT NOT NULL,
      subtotal INTEGER NOT NULL DEFAULT 0,
      shipping INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      fulfillment_status TEXT NOT NULL DEFAULT 'PENDING',
      logistics_status TEXT NOT NULL DEFAULT 'NOT_CREATED',
      payment_provider TEXT DEFAULT 'PhonePe',
      provider_transaction_id TEXT,
      shiprocket_order_id TEXT,
      shiprocket_shipment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (${nowSql}),
      updated_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      name_snapshot TEXT NOT NULL,
      price_snapshot INTEGER NOT NULL,
      qty INTEGER NOT NULL CHECK (qty > 0),
      line_total INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL REFERENCES products(id),
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'PhonePe',
      provider_transaction_id TEXT,
      status TEXT NOT NULL,
      raw_json TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );

    CREATE TABLE IF NOT EXISTS logistics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'Shiprocket',
      status TEXT NOT NULL,
      tracking_id TEXT,
      raw_json TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${nowSql})
    );
  `);

  const productColumns = db.prepare('PRAGMA table_info(products)').all().map(column => column.name);
  if (!productColumns.includes('is_deleted')) {
    db.exec('ALTER TABLE products ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * Seeds initial products, categories, and site settings.
 */
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
    description: indexOf('Description')
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
      stock: Number(cells[indexes.stock] || 0)
    };
  }).filter(Boolean);
}

function seedProductRows(products, { replaceExisting = false } = {}) {
  if (!products.length) return 0;

  const insertProduct = replaceExisting
    ? db.prepare(`INSERT OR REPLACE INTO products (id, name, price, category, image, description, stock, is_active, is_deleted, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ${nowSql})`)
    : db.prepare(`INSERT OR IGNORE INTO products (id, name, price, category, image, description, stock) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertEvent = db.prepare(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'SEED', ?, ?)`);
  const insertCat = db.prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`);

  let added = 0;
  db.exec('BEGIN');
  try {
    for (const p of products) {
      const result = insertProduct.run(p.id, p.name, p.price, p.category, p.image, p.description, p.stock);
      if (result.changes > 0) {
        insertEvent.run(p.id, p.stock, 'Seeded from catalog');
        added += 1;
      }
      insertCat.run(p.category);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return added;
}

function hasOnlyDefaultPlaceholderProducts() {
  const row = db.prepare('SELECT COUNT(*) AS count, SUM(CASE WHEN id IN (?, ?, ?, ?, ?, ?) AND image = ? THEN 1 ELSE 0 END) AS placeholder_count FROM products')
    .get('p001', 'p002', 'p003', 'p004', 'p005', 'p006', '');
  return row.count === 6 && row.placeholder_count === 6;
}

function seedDatabase() {
  // 1. SEED CONTENT (This runs first. "INSERT OR IGNORE" ensures it doesn't overwrite if you already saved custom changes)
  try {
    const defaultContent = {
      hero: { eyebrow: "Handcrafted with love", title: "Art that <em>speaks</em><br>to your soul", subtitle: "Unique paintings, prints, and handmade pieces from our studio in India." },
      about: { eyebrow: "Our story", title: "Where art meets intention", paragraph1: "Every piece from Nika Arts Studio is created with care.", paragraph2: "Based in India, we ship across the country and beyond." },
      contact: { title: "Get in touch", description: "Questions about a piece? Custom order requests? We'd love to hear from you.", email: "nika.creations0927@gmail.com", phoneDisplay: "+91 98765 43210", phoneLink: "+919876543210" },
      assets: { logoImage: "", heroImage: "images/hero.jpg", artistImage: "images/ArtistPhoto.jpeg" }
    };
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('site_content', ?)`).run(JSON.stringify(defaultContent));
  } catch (err) {
    console.error("Failed to seed default content:", err);
  }

  try {
    const adminUsername = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');
    const existingAdminCount = db.prepare('SELECT COUNT(*) AS count FROM admin_users').get().count;

    if (adminUsername && adminPassword && existingAdminCount === 0) {
      const passwordHash = bcrypt.hashSync(adminPassword, 12);
      db.prepare(`
        INSERT INTO admin_users (id, username, display_name, password_hash, role)
        VALUES (?, ?, ?, ?, 'owner')
      `).run(`ADMIN${Date.now()}`, adminUsername, 'Business Admin', passwordHash);
      console.log(`Seeded admin user "${adminUsername}" from environment variables.`);
    }
  } catch (err) {
    console.error('Failed to seed admin user:', err);
  }

  // 2. SEED PRODUCTS (If products exist, stop here!)
  const cloudinaryProducts = loadCloudinaryProductsFromCsv();
  const row = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  const shouldSeedCloudinaryCatalog = cloudinaryProducts.length > 0 && (row.count === 0 || hasOnlyDefaultPlaceholderProducts());

  if (shouldSeedCloudinaryCatalog) {
    try {
      if (hasOnlyDefaultPlaceholderProducts()) {
        db.prepare('DELETE FROM inventory_events WHERE product_id IN (?, ?, ?, ?, ?, ?)').run('p001', 'p002', 'p003', 'p004', 'p005', 'p006');
        db.prepare('DELETE FROM products WHERE id IN (?, ?, ?, ?, ?, ?)').run('p001', 'p002', 'p003', 'p004', 'p005', 'p006');
      }
      const added = seedProductRows(cloudinaryProducts);
      if (added > 0) console.log(`Seeded ${added} Cloudinary catalog products from CSV.`);
    } catch (err) {
      console.error('Failed to seed Cloudinary products:', err);
    }
  }

  const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get();
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
    seedProductRows(defaultProducts);
  } catch (err) {
    console.error("Failed to seed database:", err);
  }
}


// Run setup
initSchema();
seedDatabase();

module.exports = { db, nowSql };
