// routes/products.js
const express = require('express');
const crypto = require('crypto');
const { db, createCategory, getCategoryByName, getProduct, getProducts } = require('../db');
const { isAuthorized, requireAdmin } = require('../middleware/adminAuth');
const asyncHandler = require('../middleware/asyncHandler');
const { deleteProductImage, hasCloudinaryConfig, uploadProductImage } = require('../services/storage');

const router = express.Router();
const nowSql = "datetime('now')";

// --- Helper Functions ---
function cleanText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function cleanProductPayload(body, { partial = false } = {}) {
  const product = {
    id: cleanText(body.id),
    name: cleanText(body.name),
    price: Number(body.price),
    category: cleanText(body.category),
    image: cleanText(body.image),
    description: cleanText(body.description),
    stock: Number(body.stock),
    isActive: body.isActive === undefined ? true : Boolean(body.isActive)
  };

  if (!partial) {
    if (!product.name) throw new Error('Product name is required.');
    if (!product.category) throw new Error('Product category is required.');
    if (!Number.isInteger(product.price) || product.price < 0) throw new Error('Price must be a positive integer.');
    if (!Number.isInteger(product.stock) || product.stock < 0) throw new Error('Stock must be a positive integer.');
  }

  return product;
}

function nextProductId() {
  return 'p' + crypto.randomBytes(5).toString('hex');
}

function ensureCategory(name) {
  if (!name) return null;
  const existing = getCategoryByName(name);
  if (existing) return existing;
  return createCategory(name);
}

async function permanentlyRemoveProduct(productId) {
  const existing = getProduct(productId);
  if (!existing) return { status: 404, body: { success: false, message: 'Product not found.' } };

  const orderUsage = db.prepare('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?').get(productId);
  if (orderUsage.count > 0) {
    db.prepare(`UPDATE products SET is_active = 0, is_deleted = 1, updated_at = ${nowSql} WHERE id = ?`).run(productId);
    return {
      status: 200,
      body: {
        success: true,
        message: 'Product removed from admin and storefront. Past order history was preserved.',
        archived: true,
        imageCleanup: { provider: 'archived', deleted: false }
      }
    };
  }

  const imageUsage = existing.image
    ? db.prepare('SELECT COUNT(*) AS count FROM products WHERE image = ? AND id != ?').get(existing.image, productId)
    : { count: 0 };

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM inventory_events WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  let imageCleanup = { provider: 'shared', deleted: false };
  if (imageUsage.count === 0) {
    try {
      imageCleanup = await deleteProductImage(existing.image);
    } catch (err) {
      imageCleanup = { provider: 'unknown', deleted: false, error: err.message || 'Image cleanup failed.' };
    }
  }

  return { status: 200, body: { success: true, message: 'Product permanently removed.', imageCleanup } };
}

// --- API Routes ---

router.get('/storage/status', requireAdmin, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    storage: hasCloudinaryConfig() ? 'cloudinary' : 'local',
    cloudinaryConfigured: hasCloudinaryConfig(),
    folder: process.env.CLOUDINARY_PRODUCT_FOLDER || 'nika-arts/products'
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  if (includeInactive && !isAuthorized(req)) {
    return res.status(401).json({ success: false, message: 'Admin login required.' });
  }
  res.json({ success: true, products: getProducts({ includeInactive }) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
  res.json({ success: true, product });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const product = cleanProductPayload(req.body);
  const id = product.id || nextProductId();
  ensureCategory(product.category);

  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO products (id, name, price, category, image, description, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, product.name, product.price, product.category, product.image, product.description, product.stock, product.isActive ? 1 : 0);
    db.prepare(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'CREATE_PRODUCT', ?, 'Initial product stock')`).run(id, product.stock);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.status(201).json({ success: true, product: getProduct(id) });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const product = cleanProductPayload(req.body, { partial: true });
  const next = {
    name: product.name || existing.name,
    price: Number.isInteger(product.price) && product.price >= 0 ? product.price : existing.price,
    category: product.category || existing.category,
    image: product.image !== '' ? product.image : existing.image,
    description: product.description !== '' ? product.description : existing.description,
    stock: Number.isInteger(product.stock) && product.stock >= 0 ? product.stock : existing.stock,
    isActive: req.body.isActive === undefined ? existing.isActive : product.isActive
  };
  ensureCategory(next.category);

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE products SET name = ?, price = ?, category = ?, image = ?, description = ?, stock = ?, is_active = ?, updated_at = ${nowSql} WHERE id = ?`).run(next.name, next.price, next.category, next.image, next.description, next.stock, next.isActive ? 1 : 0, req.params.id);

    const stockDelta = next.stock - existing.stock;
    if (stockDelta !== 0) {
      db.prepare(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'MANUAL_STOCK_UPDATE', ?, 'Stock updated through product API')`).run(req.params.id, stockDelta);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.json({ success: true, product: getProduct(req.params.id) });
}));

router.patch('/:id/stock', requireAdmin, asyncHandler(async (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const mode = cleanText(req.body.mode, 'set');
  const quantity = Number(req.body.quantity);
  const note = cleanText(req.body.note, 'Stock adjusted through product API');
  if (!Number.isInteger(quantity)) throw new Error('Quantity must be an integer.');

  const nextStock = mode === 'adjust' ? existing.stock + quantity : quantity;
  if (nextStock < 0) throw new Error('Stock cannot be negative.');
  const delta = nextStock - existing.stock;

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE products SET stock = ?, updated_at = ${nowSql} WHERE id = ?`).run(nextStock, req.params.id);
    if (delta !== 0) {
      db.prepare(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'MANUAL_STOCK_UPDATE', ?, ?)`).run(req.params.id, delta, note);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.json({ success: true, product: getProduct(req.params.id) });
}));

router.post('/:id/image', requireAdmin, asyncHandler(async (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const uploaded = await uploadProductImage({
    imageData: req.body.imageData,
    productName: existing.name,
    productId: req.params.id
  });
  db.prepare(`UPDATE products SET image = ?, updated_at = ${nowSql} WHERE id = ?`).run(uploaded.url, req.params.id);

  res.json({ success: true, image: uploaded.url, storage: uploaded, product: getProduct(req.params.id) });
}));

router.post('/images/bulk', requireAdmin, asyncHandler(async (req, res) => {
  const files = req.body.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No image files provided.');
  }
  if (files.length > 30) {
    throw new Error('Upload up to 30 images at a time.');
  }

  const uploaded = [];
  for (const file of files) {
    const result = await uploadProductImage({
      imageData: file.imageData,
      productName: file.name,
      productId: file.name
    });
    uploaded.push({
      name: file.name,
      url: result.url,
      provider: result.provider,
      publicId: result.publicId,
      bytes: result.bytes
    });
  }

  res.status(201).json({ success: true, uploaded, storage: hasCloudinaryConfig() ? 'cloudinary' : 'local' });
}));

router.delete('/permanent/:id', requireAdmin, asyncHandler(async (req, res) => {
  const result = await permanentlyRemoveProduct(req.params.id);
  res.status(result.status).json(result.body);
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  db.prepare(`UPDATE products SET is_active = 0, updated_at = ${nowSql} WHERE id = ?`).run(req.params.id);
  res.json({ success: true, product: getProduct(req.params.id) });
}));

router.delete('/:id/permanent', requireAdmin, asyncHandler(async (req, res) => {
  const result = await permanentlyRemoveProduct(req.params.id);
  res.status(result.status).json(result.body);
}));

router.get('/:id/inventory-events', requireAdmin, asyncHandler(async (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const events = db.prepare(`SELECT * FROM inventory_events WHERE product_id = ? ORDER BY created_at DESC, id DESC`).all(req.params.id);
  res.json({ success: true, events });
}));

// --- Bulk Operations ---
router.post('/bulk', requireAdmin, asyncHandler(async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products provided for bulk upload.');
  }

  let addedCount = 0;
  
  db.exec('BEGIN');
  try {
    for (const p of products) {
      // Basic validation
      if (!p.name || !p.category) continue; 
      
      const id = nextProductId();
      const price = Number.isInteger(Number(p.price)) ? Number(p.price) : 0;
      const stock = Number.isInteger(Number(p.stock)) ? Number(p.stock) : 0;
      
      // Ensure the category exists in the DB
      const existingCategory = db.prepare('SELECT * FROM categories WHERE lower(name) = lower(?)').get(p.category);
      if (!existingCategory) {
        db.prepare(`INSERT INTO categories (name) VALUES (?)`).run(p.category.trim());
      }

      // Insert the product
      db.prepare(`
        INSERT INTO products (id, name, price, category, image, description, stock, is_active) 
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(id, p.name.trim(), price, p.category.trim(), String(p.image || '').trim(), String(p.description || '').trim(), stock);
      
      db.prepare(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'BULK_CREATE', ?, 'Bulk CSV Upload')`).run(id, stock);
      addedCount++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res.status(201).json({ success: true, message: `Successfully added ${addedCount} products.` });
}));

module.exports = router;
