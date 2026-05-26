const { db, nowSql } = require('./connection');
const { calculateShipping } = require('../services/shipping');

function rowToCategory(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at };
}

async function getCategories({ includeInactive = false } = {}) {
  const query = includeInactive
    ? 'SELECT * FROM categories ORDER BY name ASC'
    : 'SELECT * FROM categories WHERE is_active = 1 ORDER BY name ASC';
  return (await db.all(query)).map(rowToCategory);
}

async function getCategoryByName(name) {
  return rowToCategory(await db.get('SELECT * FROM categories WHERE lower(name) = lower(?)', [name]));
}

async function createCategory(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Category name is required.');
  await db.run('INSERT INTO categories (name) VALUES (?) ON CONFLICT (name) DO NOTHING', [cleanName]);
  return getCategoryByName(cleanName);
}

function rowToProduct(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, price: row.price, category: row.category, image: row.image || '', description: row.description || '', stock: row.stock, isActive: Boolean(row.is_active), isDeleted: Boolean(row.is_deleted), createdAt: row.created_at, updatedAt: row.updated_at };
}

async function getProducts({ includeInactive = false } = {}) {
  const query = includeInactive
    ? 'SELECT * FROM products WHERE is_deleted = 0 ORDER BY created_at ASC'
    : 'SELECT * FROM products WHERE is_active = 1 AND is_deleted = 0 ORDER BY created_at ASC';
  return (await db.all(query)).map(rowToProduct);
}

async function getProduct(id) {
  return rowToProduct(await db.get('SELECT * FROM products WHERE id = ?', [id]));
}

async function getOrder(id) {
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [id]);

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
    items: items.map(item => ({ productId: item.product_id, name: item.name_snapshot, price: item.price_snapshot, qty: item.qty, lineTotal: item.line_total }))
  };
}

async function createOrderFromCart(cart, customer, options = {}) {
  if (!cart || !cart.length || !customer) {
    throw new Error('Customer and cart items are required');
  }

  const orderId = options.id || 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

  await db.transaction(async (tx) => {
    const validatedItems = [];
    for (const item of cart) {
      const productId = item.productId || item.id;
      const qty = Number(item.qty);
      if (!productId || !Number.isInteger(qty) || qty <= 0) {
        throw new Error('Invalid cart item.');
      }

      const product = rowToProduct(await tx.get('SELECT * FROM products WHERE id = ?', [productId]));
      if (!product || !product.isActive) {
        throw new Error(`Product is unavailable: ${productId}`);
      }
      if (product.stock < qty) {
        throw new Error(`Only ${product.stock} left in stock for ${product.name}.`);
      }

      validatedItems.push({
        productId,
        name: product.name,
        price: product.price,
        qty,
        lineTotal: product.price * qty
      });
    }

    const subtotal = validatedItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const shipping = calculateShipping(subtotal);
    const total = subtotal + shipping;

    await tx.run(`
      INSERT INTO orders (id, customer_json, subtotal, shipping, total, payment_status, fulfillment_status, logistics_status, payment_provider)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'NOT_CREATED', ?)
    `, [
      orderId,
      JSON.stringify(customer),
      subtotal,
      shipping,
      total,
      options.paymentStatus || 'PENDING',
      options.paymentProvider || 'Manual UPI'
    ]);

    for (const item of validatedItems) {
      await tx.run(
        'INSERT INTO order_items (order_id, product_id, name_snapshot, price_snapshot, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, item.productId, item.name, item.price, item.qty, item.lineTotal]
      );
    }

  });

  return getOrder(orderId);
}

async function listOrders({ limit = 100 } = {}) {
  if (typeof arguments[0] === 'number') limit = arguments[0];
  const rows = await db.all('SELECT id FROM orders ORDER BY created_at DESC LIMIT ?', [limit]);
  return Promise.all(rows.map(row => getOrder(row.id)));
}

async function getSalesSummary() {
  const paidWhere = "payment_status IN ('PAID', 'PAYMENT_SUCCESS')";
  const totals = await db.get(`SELECT COUNT(*)::int AS order_count, COALESCE(SUM(total), 0)::int AS revenue, COALESCE(SUM(subtotal), 0)::int AS product_revenue, COALESCE(SUM(shipping), 0)::int AS shipping_collected FROM orders WHERE ${paidWhere}`);
  const topProducts = await db.all(`SELECT product_id AS "productId", name_snapshot AS name, SUM(qty)::int AS "unitsSold", SUM(line_total)::int AS revenue FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE ${paidWhere}) GROUP BY product_id, name_snapshot ORDER BY "unitsSold" DESC, revenue DESC`);
  const lowStock = (await db.all('SELECT * FROM products WHERE is_active = 1 AND stock <= 3 ORDER BY stock ASC, name ASC')).map(rowToProduct);
  return { orderCount: totals.order_count, revenue: totals.revenue, productRevenue: totals.product_revenue, shippingCollected: totals.shipping_collected, topProducts, lowStock };
}

async function recordPayment({ orderId, status, providerTransactionId = null, provider = 'Manual UPI', raw = null }) {
  await db.run("INSERT INTO payments (order_id, provider, provider_transaction_id, status, raw_json) VALUES (?, ?, ?, ?, ?)", [orderId, provider, providerTransactionId, status, raw ? JSON.stringify(raw) : '']);
  await db.run(`UPDATE orders SET payment_status = ?, payment_provider = ?, provider_transaction_id = COALESCE(?, provider_transaction_id), updated_at = ${nowSql} WHERE id = ?`, [status, provider, providerTransactionId, orderId]);
}

async function markOrderPaid(orderId, providerTransactionId = null, raw = null, options = {}) {
  const order = await getOrder(orderId);
  if (!order) return null;
  const provider = options.provider || order.paymentProvider || 'Manual UPI';

  await db.transaction(async (tx) => {
    await tx.run("INSERT INTO payments (order_id, provider, provider_transaction_id, status, raw_json) VALUES (?, ?, ?, 'PAYMENT_SUCCESS', ?)", [orderId, provider, providerTransactionId, raw ? JSON.stringify(raw) : '']);
    if (!['PAID', 'PAYMENT_SUCCESS'].includes(order.paymentStatus)) {
      for (const item of order.items) {
        const product = rowToProduct(await tx.get('SELECT * FROM products WHERE id = ?', [item.productId]));
        if (!product || product.stock < item.qty) {
          throw new Error(`Insufficient stock for ${item.name}.`);
        }
        await tx.run(`UPDATE products SET stock = stock - ?, updated_at = ${nowSql} WHERE id = ?`, [item.qty, item.productId]);
        await tx.run("INSERT INTO inventory_events (product_id, order_id, type, quantity_delta, note) VALUES (?, ?, 'SALE', ?, 'Stock reduced after successful payment')", [item.productId, orderId, -item.qty]);
      }
      await tx.run(`UPDATE orders SET payment_status = 'PAID', payment_provider = ?, provider_transaction_id = COALESCE(?, provider_transaction_id), fulfillment_status = 'READY_FOR_SHIPPING', updated_at = ${nowSql} WHERE id = ?`, [provider, providerTransactionId, orderId]);
    } else {
      await tx.run(`UPDATE orders SET payment_status = 'PAID', payment_provider = ?, provider_transaction_id = COALESCE(?, provider_transaction_id), updated_at = ${nowSql} WHERE id = ?`, [provider, providerTransactionId, orderId]);
    }
  });

  return getOrder(orderId);
}

async function cancelPaidOrder(orderId, note = 'Order cancelled') {
  const order = await getOrder(orderId);
  if (!order) return null;
  if (order.fulfillmentStatus === 'CANCELLED') return order;

  await db.transaction(async (tx) => {
    if (['PAID', 'PAYMENT_SUCCESS'].includes(order.paymentStatus)) {
      for (const item of order.items) {
        await tx.run(`UPDATE products SET stock = stock + ?, updated_at = ${nowSql} WHERE id = ?`, [item.qty, item.productId]);
        await tx.run("INSERT INTO inventory_events (product_id, order_id, type, quantity_delta, note) VALUES (?, ?, 'ORDER_CANCELLED', ?, ?)", [item.productId, orderId, item.qty, note]);
      }
    }
    await tx.run(`UPDATE orders SET fulfillment_status = 'CANCELLED', logistics_status = 'CANCELLED', updated_at = ${nowSql} WHERE id = ?`, [orderId]);
  });

  return getOrder(orderId);
}

async function recordLogistics({ orderId, status, trackingId = null, raw = null }) {
  await db.run("INSERT INTO logistics_events (order_id, provider, status, tracking_id, raw_json) VALUES (?, 'Shiprocket', ?, ?, ?)", [orderId, status, trackingId, raw ? JSON.stringify(raw) : '']);
  await db.run(`UPDATE orders SET logistics_status = ?, updated_at = ${nowSql} WHERE id = ?`, [status, orderId]);
}

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

function textValue(value, fallback = '') {
  return String(value === undefined || value === null ? fallback : value);
}

function sanitizeLimitedHtml(value) {
  return textValue(value)
    .replace(/<\s*br\s*\/?\s*>/gi, '[[BR]]')
    .replace(/<\s*em\s*>/gi, '[[EM]]')
    .replace(/<\s*\/\s*em\s*>/gi, '[[/EM]]')
    .replace(/<[^>]*>/g, '')
    .replace(/\[\[BR\]\]/g, '<br>')
    .replace(/\[\[EM\]\]/g, '<em>')
    .replace(/\[\[\/EM\]\]/g, '</em>');
}

function safeAssetUrl(value, fallback = '') {
  const url = textValue(value).trim();
  if (!url) return fallback;
  if (/^images\/[a-z0-9/_.,%+-]+\.(jpe?g|png|webp)$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.hostname.endsWith('res.cloudinary.com')) return url;
  } catch {
    return fallback;
  }
  return fallback;
}

function safeEmail(value, fallback = '') {
  const email = textValue(value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : fallback;
}

function safePhoneLink(value, fallback = '') {
  const phone = textValue(value).trim();
  return /^\+?[0-9]{7,15}$/.test(phone) ? phone : fallback;
}

function normalizeSiteContent(contentObj = {}) {
  const defaults = defaultSiteContent();
  return {
    hero: {
      eyebrow: textValue(contentObj.hero?.eyebrow, defaults.hero.eyebrow),
      title: sanitizeLimitedHtml(contentObj.hero?.title || defaults.hero.title),
      subtitle: textValue(contentObj.hero?.subtitle, defaults.hero.subtitle)
    },
    about: {
      eyebrow: textValue(contentObj.about?.eyebrow, defaults.about.eyebrow),
      title: textValue(contentObj.about?.title, defaults.about.title),
      paragraph1: textValue(contentObj.about?.paragraph1, defaults.about.paragraph1),
      paragraph2: textValue(contentObj.about?.paragraph2, defaults.about.paragraph2)
    },
    contact: {
      title: textValue(contentObj.contact?.title, defaults.contact.title),
      description: textValue(contentObj.contact?.description, defaults.contact.description),
      email: safeEmail(contentObj.contact?.email, defaults.contact.email),
      phoneDisplay: textValue(contentObj.contact?.phoneDisplay, defaults.contact.phoneDisplay),
      phoneLink: safePhoneLink(contentObj.contact?.phoneLink, defaults.contact.phoneLink)
    },
    assets: {
      logoImage: safeAssetUrl(contentObj.assets?.logoImage, defaults.assets.logoImage),
      heroImage: safeAssetUrl(contentObj.assets?.heroImage, defaults.assets.heroImage),
      artistImage: safeAssetUrl(contentObj.assets?.artistImage, defaults.assets.artistImage)
    }
  };
}

async function getSiteContent() {
  const row = await db.get("SELECT value FROM settings WHERE key = 'site_content'");
  return row ? normalizeSiteContent(JSON.parse(row.value)) : normalizeSiteContent();
}

async function updateSiteContent(contentObj) {
  const normalized = normalizeSiteContent(contentObj);
  await db.run(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('site_content', ?, ${nowSql})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `, [JSON.stringify(normalized)]);
  return getSiteContent();
}

module.exports = {
  createCategory,
  getCategories,
  getCategoryByName,
  getSalesSummary,
  getOrder,
  getProduct,
  getProducts,
  listOrders,
  createOrderFromCart,
  markOrderPaid,
  cancelPaidOrder,
  recordLogistics,
  recordPayment,
  rowToProduct,
  rowToCategory,
  getSiteContent,
  updateSiteContent
};
