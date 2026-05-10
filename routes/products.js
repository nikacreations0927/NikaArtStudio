const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createCategory, db, getCategoryByName, getProduct, getProducts } = require('../db');
const { isAuthorized, requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();
const nowSql = "datetime('now')";
const productImagesDir = path.join(__dirname, '..', 'public', 'images', 'products');

fs.mkdirSync(productImagesDir, { recursive: true });

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

function safeFilePart(value) {
  return String(value || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'product';
}

function parseImageData(imageData) {
  const match = String(imageData || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw new Error('Upload a JPEG, PNG, or WEBP image.');

  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const extByMime = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  const buffer = Buffer.from(match[2], 'base64');
  const maxBytes = 4 * 1024 * 1024;

  if (buffer.length === 0) throw new Error('Image file is empty.');
  if (buffer.length > maxBytes) throw new Error('Image must be 4 MB or smaller.');

  return { buffer, ext: extByMime[mime] };
}

router.get('/', (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  if (includeInactive && !isAuthorized(req)) {
    return res.status(401).json({ success: false, message: 'Admin login required.' });
  }
  res.json({ success: true, products: getProducts({ includeInactive }) });
});

router.get('/:id', (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
  res.json({ success: true, product });
});

router.post('/', requireAdmin, (req, res) => {
  try {
    const product = cleanProductPayload(req.body);
    const id = product.id || nextProductId();
    ensureCategory(product.category);

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO products (id, name, price, category, image, description, stock, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        product.name,
        product.price,
        product.category,
        product.image,
        product.description,
        product.stock,
        product.isActive ? 1 : 0
      );

      db.prepare(`
        INSERT INTO inventory_events (product_id, type, quantity_delta, note)
        VALUES (?, 'CREATE_PRODUCT', ?, 'Initial product stock')
      `).run(id, product.stock);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({ success: true, product: getProduct(id) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/:id', requireAdmin, (req, res) => {
  try {
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
      db.prepare(`
        UPDATE products
        SET name = ?, price = ?, category = ?, image = ?, description = ?, stock = ?, is_active = ?, updated_at = ${nowSql}
        WHERE id = ?
      `).run(
        next.name,
        next.price,
        next.category,
        next.image,
        next.description,
        next.stock,
        next.isActive ? 1 : 0,
        req.params.id
      );

      const stockDelta = next.stock - existing.stock;
      if (stockDelta !== 0) {
        db.prepare(`
          INSERT INTO inventory_events (product_id, type, quantity_delta, note)
          VALUES (?, 'MANUAL_STOCK_UPDATE', ?, 'Stock updated through product API')
        `).run(req.params.id, stockDelta);
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.json({ success: true, product: getProduct(req.params.id) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.patch('/:id/stock', requireAdmin, (req, res) => {
  try {
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
      db.prepare(`
        UPDATE products
        SET stock = ?, updated_at = ${nowSql}
        WHERE id = ?
      `).run(nextStock, req.params.id);

      if (delta !== 0) {
        db.prepare(`
          INSERT INTO inventory_events (product_id, type, quantity_delta, note)
          VALUES (?, 'MANUAL_STOCK_UPDATE', ?, ?)
        `).run(req.params.id, delta, note);
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.json({ success: true, product: getProduct(req.params.id) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/image', requireAdmin, (req, res) => {
  try {
    const existing = getProduct(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

    const { buffer, ext } = parseImageData(req.body.imageData);
    const fileName = `${safeFilePart(existing.name)}-${req.params.id}-${Date.now()}.${ext}`;
    const absolutePath = path.join(productImagesDir, fileName);
    const relativePath = `images/products/${fileName}`;

    fs.writeFileSync(absolutePath, buffer);

    db.prepare(`
      UPDATE products
      SET image = ?, updated_at = ${nowSql}
      WHERE id = ?
    `).run(relativePath, req.params.id);

    res.json({ success: true, image: relativePath, product: getProduct(req.params.id) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  db.prepare(`
    UPDATE products
    SET is_active = 0, updated_at = ${nowSql}
    WHERE id = ?
  `).run(req.params.id);

  res.json({ success: true, product: getProduct(req.params.id) });
});

router.get('/:id/inventory-events', requireAdmin, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const events = db.prepare(`
    SELECT * FROM inventory_events
    WHERE product_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.params.id);

  res.json({ success: true, events });
});

module.exports = router;
