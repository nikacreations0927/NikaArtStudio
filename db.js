const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.SQLITE_DB_PATH || path.join(dataDir, 'store.sqlite');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const nowSql = "datetime('now')";

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (${nowSql}),
  updated_at TEXT NOT NULL DEFAULT (${nowSql})
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

const seedProducts = [
  {
    id: 'p001',
    name: 'Lily',
    price: 449,
    category: 'Crochet',
    image: '',
    description: 'Handmade crochet lily.',
    stock: 10
  },
  {
    id: 'p002',
    name: 'Sunflower',
    price: 549,
    category: 'Crochet',
    image: '',
    description: 'Handmade crochet sunflower.',
    stock: 10
  },
  {
    id: 'p003',
    name: 'Rose',
    price: 349,
    category: 'Crochet',
    image: '',
    description: 'Handmade crochet rose.',
    stock: 10
  },
  {
    id: 'p004',
    name: 'Flower Bouquet',
    price: 349,
    category: 'Keychains',
    image: '',
    description: 'Handmade flower bouquet keychain.',
    stock: 10
  },
  {
    id: 'p005',
    name: 'Long Neck',
    price: 549,
    category: 'Keychains',
    image: '',
    description: 'Handmade long neck keychain.',
    stock: 10
  },
  {
    id: 'p006',
    name: 'Bee Happy',
    price: 449,
    category: 'Keychains',
    image: '',
    description: 'Handmade Bee Happy keychain.',
    stock: 10
  }
];

function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (row.count > 0) return;

  const insert = db.prepare(`
    INSERT INTO products (id, name, price, category, image, description, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const product of seedProducts) {
      insert.run(
        product.id,
        product.name,
        product.price,
        product.category,
        product.image,
        product.description,
        product.stock
      );
      db.prepare(`
        INSERT INTO inventory_events (product_id, type, quantity_delta, note)
        VALUES (?, 'SEED', ?, 'Initial stock')
      `).run(product.id, product.stock);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

seedIfEmpty();
seedCategoriesFromProducts();

function seedCategoriesFromProducts() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO categories (name)
    VALUES (?)
  `);

  const categories = db.prepare(`
    SELECT DISTINCT category
    FROM products
    WHERE category IS NOT NULL AND trim(category) != ''
    ORDER BY category ASC
  `).all();

  for (const row of categories) {
    insert.run(row.category);
  }
}

function rowToCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getCategories({ includeInactive = false } = {}) {
  const rows = includeInactive
    ? db.prepare('SELECT * FROM categories ORDER BY name ASC').all()
    : db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY name ASC').all();
  return rows.map(rowToCategory);
}

function getCategoryByName(name) {
  return rowToCategory(db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?)').get(name));
}

function createCategory(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Category name is required.');

  db.prepare(`
    INSERT INTO categories (name)
    VALUES (?)
  `).run(cleanName);

  return getCategoryByName(cleanName);
}

function rowToProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    category: row.category,
    image: row.image || '',
    description: row.description || '',
    stock: row.stock,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getProducts({ includeInactive = false } = {}) {
  const rows = includeInactive
    ? db.prepare('SELECT * FROM products ORDER BY created_at ASC').all()
    : db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY created_at ASC').all();
  return rows.map(rowToProduct);
}

function getProduct(id) {
  return rowToProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(id);
  return {
    id: order.id,
    customer: JSON.parse(order.customer_json),
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    logisticsStatus: order.logistics_status,
    paymentProvider: order.payment_provider,
    providerTransactionId: order.provider_transaction_id,
    shiprocketOrderId: order.shiprocket_order_id,
    shiprocketShipmentId: order.shiprocket_shipment_id,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: items.map(item => ({
      productId: item.product_id,
      name: item.name_snapshot,
      price: item.price_snapshot,
      qty: item.qty,
      lineTotal: item.line_total
    }))
  };
}

function createOrderFromCart({ id, customer, items }) {
  if (!customer || !Array.isArray(items) || items.length === 0) {
    throw new Error('Customer and cart items are required.');
  }

  const normalizedItems = items.map(item => ({
    productId: String(item.id || item.productId || '').trim(),
    qty: Number(item.qty)
  }));

  if (normalizedItems.some(item => !item.productId || !Number.isInteger(item.qty) || item.qty <= 0)) {
    throw new Error('Every cart item needs a product id and positive quantity.');
  }

  const orderItems = [];
  for (const item of normalizedItems) {
    const product = getProduct(item.productId);
    if (!product || !product.isActive) throw new Error(`Product unavailable: ${item.productId}`);
    if (product.stock < item.qty) throw new Error(`Only ${product.stock} left for ${product.name}.`);

    orderItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      qty: item.qty,
      lineTotal: product.price * item.qty
    });
  }

  const subtotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const shipping = subtotal >= 999 ? 0 : 99;
  const total = subtotal + shipping;

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO orders (id, customer_json, subtotal, shipping, total)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, JSON.stringify(customer), subtotal, shipping, total);

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, name_snapshot, price_snapshot, qty, line_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of orderItems) {
      insertItem.run(id, item.productId, item.name, item.price, item.qty, item.lineTotal);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getOrder(id);
}

function listOrders({ limit = 100 } = {}) {
  const rows = db.prepare(`
    SELECT id FROM orders
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);

  return rows.map(row => getOrder(row.id));
}

function getSalesSummary() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(total), 0) AS revenue,
      COALESCE(SUM(subtotal), 0) AS product_revenue,
      COALESCE(SUM(shipping), 0) AS shipping_collected
    FROM orders
    WHERE payment_status = 'PAYMENT_SUCCESS'
  `).get();

  const topProducts = db.prepare(`
    SELECT
      product_id AS productId,
      name_snapshot AS name,
      SUM(qty) AS unitsSold,
      SUM(line_total) AS revenue
    FROM order_items
    WHERE order_id IN (
      SELECT id FROM orders WHERE payment_status = 'PAYMENT_SUCCESS'
    )
    GROUP BY product_id, name_snapshot
    ORDER BY unitsSold DESC, revenue DESC
  `).all();

  const lowStock = db.prepare(`
    SELECT * FROM products
    WHERE is_active = 1 AND stock <= 3
    ORDER BY stock ASC, name ASC
  `).all().map(rowToProduct);

  return {
    orderCount: totals.order_count,
    revenue: totals.revenue,
    productRevenue: totals.product_revenue,
    shippingCollected: totals.shipping_collected,
    topProducts,
    lowStock
  };
}

function recordPayment({ orderId, status, providerTransactionId = null, raw = null }) {
  db.prepare(`
    INSERT INTO payments (order_id, provider, provider_transaction_id, status, raw_json)
    VALUES (?, 'PhonePe', ?, ?, ?)
  `).run(orderId, providerTransactionId, status, raw ? JSON.stringify(raw) : '');

  db.prepare(`
    UPDATE orders
    SET payment_status = ?, provider_transaction_id = COALESCE(?, provider_transaction_id), updated_at = ${nowSql}
    WHERE id = ?
  `).run(status, providerTransactionId, orderId);
}

function markOrderPaid(orderId, providerTransactionId = null, raw = null) {
  const order = getOrder(orderId);
  if (!order) return null;

  db.exec('BEGIN');
  try {
    recordPayment({ orderId, status: 'PAYMENT_SUCCESS', providerTransactionId, raw });

    if (order.paymentStatus !== 'PAYMENT_SUCCESS') {
      for (const item of order.items) {
        const product = getProduct(item.productId);
        if (!product) throw new Error(`Product not found: ${item.productId}`);
        if (product.stock < item.qty) throw new Error(`Insufficient stock for ${product.name}`);

        db.prepare(`
          UPDATE products
          SET stock = stock - ?, updated_at = ${nowSql}
          WHERE id = ?
        `).run(item.qty, item.productId);

        db.prepare(`
          INSERT INTO inventory_events (product_id, order_id, type, quantity_delta, note)
          VALUES (?, ?, 'SALE', ?, 'Stock reduced after successful payment')
        `).run(item.productId, orderId, -item.qty);
      }

      db.prepare(`
        UPDATE orders
        SET fulfillment_status = 'READY_FOR_SHIPPING', updated_at = ${nowSql}
        WHERE id = ?
      `).run(orderId);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getOrder(orderId);
}

function recordLogistics({ orderId, status, trackingId = null, raw = null }) {
  db.prepare(`
    INSERT INTO logistics_events (order_id, provider, status, tracking_id, raw_json)
    VALUES (?, 'Shiprocket', ?, ?, ?)
  `).run(orderId, status, trackingId, raw ? JSON.stringify(raw) : '');

  db.prepare(`
    UPDATE orders
    SET logistics_status = ?, updated_at = ${nowSql}
    WHERE id = ?
  `).run(status, orderId);
}

module.exports = {
  db,
  createOrderFromCart,
  createCategory,
  getCategories,
  getCategoryByName,
  getSalesSummary,
  getOrder,
  getProduct,
  getProducts,
  listOrders,
  markOrderPaid,
  recordLogistics,
  recordPayment,
  rowToProduct,
  rowToCategory
};
