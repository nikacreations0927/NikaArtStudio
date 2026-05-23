// db/queries.js
const { db, nowSql } = require('./connection');
const { calculateShipping } = require('../services/shipping');

// ==========================================
// CATEGORY OPERATIONS
// ==========================================

function rowToCategory(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at };
}

/** @returns {Array} List of all categories */
function getCategories({ includeInactive = false } = {}) {
  const query = includeInactive 
    ? 'SELECT * FROM categories ORDER BY name ASC'
    : 'SELECT * FROM categories WHERE is_active = 1 ORDER BY name ASC';
  return db.prepare(query).all().map(rowToCategory);
}

/** @param {string} name */
function getCategoryByName(name) {
  return rowToCategory(db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?)').get(name));
}

/** @param {string} name */
function createCategory(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Category name is required.');
  db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(cleanName);
  return getCategoryByName(cleanName);
}

// ==========================================
// PRODUCT OPERATIONS
// ==========================================

function rowToProduct(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, price: row.price, category: row.category, image: row.image || '', description: row.description || '', stock: row.stock, isActive: Boolean(row.is_active), isDeleted: Boolean(row.is_deleted), createdAt: row.created_at, updatedAt: row.updated_at };
}

/** @returns {Array} List of all products */
function getProducts({ includeInactive = false } = {}) {
  const query = includeInactive
    ? 'SELECT * FROM products WHERE is_deleted = 0 ORDER BY created_at ASC'
    : 'SELECT * FROM products WHERE is_active = 1 AND is_deleted = 0 ORDER BY created_at ASC';
  return db.prepare(query).all().map(rowToProduct);
}

/** @param {string} id */
function getProduct(id) {
  return rowToProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
}

// ==========================================
// ORDER OPERATIONS
// ==========================================

/** @param {string} id */
function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(id);
  
  return {
    id: order.id, customer: JSON.parse(order.customer_json), subtotal: order.subtotal, shipping: order.shipping, total: order.total, paymentStatus: order.payment_status, fulfillmentStatus: order.fulfillment_status, logisticsStatus: order.logistics_status, paymentProvider: order.payment_provider, providerTransactionId: order.provider_transaction_id, shiprocketOrderId: order.shiprocket_order_id, shiprocketShipmentId: order.shiprocket_shipment_id, createdAt: order.created_at, updatedAt: order.updated_at,
    items: items.map(item => ({ productId: item.product_id, name: item.name_snapshot, price: item.price_snapshot, qty: item.qty, lineTotal: item.line_total }))
  };
}

/**
 * Creates an order by validating cart items against the database.
 * Browser-submitted prices are intentionally ignored.
 */
function createOrderFromCart(cart, customer, options = {}) {
  if (typeof options === 'number') {
    options = { subtotal: arguments[2], shipping: arguments[3], total: arguments[4] };
  }

  if (!cart || !cart.length || !customer) {
    throw new Error('Customer and cart items are required');
  }

  const validatedItems = cart.map(item => {
    const productId = item.productId || item.id;
    const qty = Number(item.qty);
    if (!productId || !Number.isInteger(qty) || qty <= 0) {
      throw new Error('Invalid cart item.');
    }

    const product = getProduct(productId);
    if (!product || !product.isActive) {
      throw new Error(`Product is unavailable: ${productId}`);
    }
    if (product.stock < qty) {
      throw new Error(`Only ${product.stock} left in stock for ${product.name}.`);
    }

    return {
      productId,
      name: product.name,
      price: product.price,
      qty,
      lineTotal: product.price * qty
    };
  });

  const subtotal = validatedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const shipping = calculateShipping(subtotal);
  const total = subtotal + shipping;
  const orderId = options.id || 'ORD' + Date.now() + Math.floor(Math.random() * 1000);
  
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO orders (id, customer_json, subtotal, shipping, total, payment_status, fulfillment_status, logistics_status)
      VALUES (?, ?, ?, ?, ?, 'PENDING', 'PENDING', 'NOT_CREATED')
    `).run(orderId, JSON.stringify(customer), subtotal, shipping, total);

    const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, name_snapshot, price_snapshot, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const item of validatedItems) {
      insertItem.run(orderId, item.productId, item.name, item.price, item.qty, item.lineTotal);
    }

    db.exec('COMMIT');
    return getOrder(orderId);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listOrders({ limit = 100 } = {}) {
  if (typeof arguments[0] === 'number') limit = arguments[0];
  return db.prepare(`SELECT id FROM orders ORDER BY created_at DESC LIMIT ?`).all(limit).map(row => getOrder(row.id));
}

function getSalesSummary() {
  const paidWhere = `payment_status IN ('PAID', 'PAYMENT_SUCCESS')`;
  const totals = db.prepare(`SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(subtotal), 0) AS product_revenue, COALESCE(SUM(shipping), 0) AS shipping_collected FROM orders WHERE ${paidWhere}`).get();
  const topProducts = db.prepare(`SELECT product_id AS productId, name_snapshot AS name, SUM(qty) AS unitsSold, SUM(line_total) AS revenue FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE ${paidWhere}) GROUP BY product_id, name_snapshot ORDER BY unitsSold DESC, revenue DESC`).all();
  const lowStock = db.prepare(`SELECT * FROM products WHERE is_active = 1 AND stock <= 3 ORDER BY stock ASC, name ASC`).all().map(rowToProduct);

  return { orderCount: totals.order_count, revenue: totals.revenue, productRevenue: totals.product_revenue, shippingCollected: totals.shipping_collected, topProducts, lowStock };
}

// ==========================================
// PAYMENT & LOGISTICS LOGIC
// ==========================================

function recordPayment({ orderId, status, providerTransactionId = null, raw = null }) {
  db.prepare(`INSERT INTO payments (order_id, provider, provider_transaction_id, status, raw_json) VALUES (?, 'PhonePe', ?, ?, ?)`).run(orderId, providerTransactionId, status, raw ? JSON.stringify(raw) : '');
  db.prepare(`UPDATE orders SET payment_status = ?, provider_transaction_id = COALESCE(?, provider_transaction_id), updated_at = ${nowSql} WHERE id = ?`).run(status, providerTransactionId, orderId);
}

function markOrderPaid(orderId, providerTransactionId = null, raw = null) {
  const order = getOrder(orderId);
  if (!order) return null;

  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO payments (order_id, provider, provider_transaction_id, status, raw_json) VALUES (?, 'PhonePe', ?, 'PAYMENT_SUCCESS', ?)`).run(orderId, providerTransactionId, raw ? JSON.stringify(raw) : '');
    if (!['PAID', 'PAYMENT_SUCCESS'].includes(order.paymentStatus)) {
      for (const item of order.items) {
        const product = getProduct(item.productId);
        if (!product || product.stock < item.qty) {
          throw new Error(`Insufficient stock for ${item.name}.`);
        }
        db.prepare(`UPDATE products SET stock = stock - ?, updated_at = ${nowSql} WHERE id = ?`).run(item.qty, item.productId);
        db.prepare(`INSERT INTO inventory_events (product_id, order_id, type, quantity_delta, note) VALUES (?, ?, 'SALE', ?, 'Stock reduced after successful payment')`).run(item.productId, orderId, -item.qty);
      }
      db.prepare(`UPDATE orders SET payment_status = 'PAID', provider_transaction_id = COALESCE(?, provider_transaction_id), fulfillment_status = 'READY_FOR_SHIPPING', updated_at = ${nowSql} WHERE id = ?`).run(providerTransactionId, orderId);
    } else {
      db.prepare(`UPDATE orders SET payment_status = 'PAID', provider_transaction_id = COALESCE(?, provider_transaction_id), updated_at = ${nowSql} WHERE id = ?`).run(providerTransactionId, orderId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getOrder(orderId);
}

function cancelPaidOrder(orderId, note = 'Order cancelled') {
  const order = getOrder(orderId);
  if (!order) return null;
  if (order.fulfillmentStatus === 'CANCELLED') return order;

  db.exec('BEGIN');
  try {
    if (['PAID', 'PAYMENT_SUCCESS'].includes(order.paymentStatus)) {
      for (const item of order.items) {
        db.prepare(`UPDATE products SET stock = stock + ?, updated_at = ${nowSql} WHERE id = ?`).run(item.qty, item.productId);
        db.prepare(`INSERT INTO inventory_events (product_id, order_id, type, quantity_delta, note) VALUES (?, ?, 'ORDER_CANCELLED', ?, ?)`).run(item.productId, orderId, item.qty, note);
      }
    }
    db.prepare(`UPDATE orders SET fulfillment_status = 'CANCELLED', logistics_status = 'CANCELLED', updated_at = ${nowSql} WHERE id = ?`).run(orderId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getOrder(orderId);
}

function recordLogistics({ orderId, status, trackingId = null, raw = null }) {
  db.prepare(`INSERT INTO logistics_events (order_id, provider, status, tracking_id, raw_json) VALUES (?, 'Shiprocket', ?, ?, ?)`).run(orderId, status, trackingId, raw ? JSON.stringify(raw) : '');
  db.prepare(`UPDATE orders SET logistics_status = ?, updated_at = ${nowSql} WHERE id = ?`).run(status, orderId);
}

// ==========================================
// SETTINGS & CONTENT OPERATIONS
// ==========================================

function defaultSiteContent() {
  return {
    hero: {
      eyebrow: 'Handcrafted with love',
      title: 'Art that <em>speaks</em><br>to your soul',
      subtitle: 'Unique paintings, prints, and handmade pieces from our studio in India.'
    },
    about: {
      eyebrow: 'Our story',
      title: 'Where art meets intention',
      paragraph1: 'Every piece from Nika Arts Studio is created with care.',
      paragraph2: 'Based in India, we ship across the country and beyond.'
    },
    contact: {
      title: 'Get in touch',
      description: "Questions about a piece? Custom order requests? We'd love to hear from you.",
      email: 'nika.creations0927@gmail.com',
      phoneDisplay: '+91 98765 43210',
      phoneLink: '+919876543210'
    },
    assets: {
      logoImage: '',
      heroImage: 'images/hero.jpg',
      artistImage: 'images/ArtistPhoto.jpeg'
    }
  };
}

function normalizeSiteContent(contentObj = {}) {
  const defaults = defaultSiteContent();
  return {
    hero: { ...defaults.hero, ...(contentObj.hero || {}) },
    about: { ...defaults.about, ...(contentObj.about || {}) },
    contact: { ...defaults.contact, ...(contentObj.contact || {}) },
    assets: { ...defaults.assets, ...(contentObj.assets || {}) }
  };
}

function getSiteContent() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'site_content'").get();
  return row ? normalizeSiteContent(JSON.parse(row.value)) : normalizeSiteContent();
}

function updateSiteContent(contentObj) {
  const normalized = normalizeSiteContent(contentObj);
  // Upsert the content (Update if exists, Insert if not)
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) 
    VALUES ('site_content', ?, ${nowSql}) 
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(normalized));
  return getSiteContent();
}

module.exports = { createCategory, getCategories, getCategoryByName, getSalesSummary, 
  getOrder, getProduct, getProducts, listOrders, createOrderFromCart, 
  markOrderPaid, cancelPaidOrder, recordLogistics, recordPayment, rowToProduct, rowToCategory, 
  getSiteContent, updateSiteContent};
