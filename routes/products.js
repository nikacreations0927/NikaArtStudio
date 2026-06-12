const express = require('express');
const crypto = require('crypto');
const { db, createCategory, getCategoryByName, getProduct, getProducts, nowSql } = require('../db');
const { isAuthorized, requireAdmin } = require('../middleware/adminAuth');
const asyncHandler = require('../middleware/asyncHandler');
const { deleteProductImage, hasCloudinaryConfig, uploadProductImage } = require('../services/storage');

const router = express.Router();

function cleanText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizeColorOptions(value) {
  const seen = new Set();
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n;]+/)
        .flatMap(part => (part.includes('|') ? [part] : part.split(',')));

  return raw
    .map(item => {
      if (item && typeof item === 'object') {
        return {
          name: cleanText(item.name || item.color || item.label),
          image: cleanText(item.image || item.imageUrl || item.url)
        };
      }

      const text = cleanText(item);
      const [name, ...imageParts] = text.split('|');
      return {
        name: cleanText(name || text),
        image: cleanText(imageParts.join('|'))
      };
    })
    .filter(item => item.name)
    .filter(Boolean)
    .filter(item => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function cleanProductPayload(body, { partial = false } = {}) {
  const product = {
    id: cleanText(body.id),
    name: cleanText(body.name),
    price: Number(body.price),
    category: cleanText(body.category),
    image: cleanText(body.image),
    description: cleanText(body.description),
    colorOptions: normalizeColorOptions(body.colorOptions ?? body.colors),
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

async function ensureCategory(name) {
  if (!name) return null;
  const existing = await getCategoryByName(name);
  if (existing) return existing;
  return createCategory(name);
}

async function permanentlyRemoveProduct(productId) {
  const existing = await getProduct(productId);
  if (!existing) return { status: 404, body: { success: false, message: 'Product not found.' } };

  const orderUsage = await db.get('SELECT COUNT(*)::int AS count FROM order_items WHERE product_id = ?', [productId]);
  if (orderUsage.count > 0) {
    await db.run(`UPDATE products SET is_active = 0, is_deleted = 1, updated_at = ${nowSql} WHERE id = ?`, [productId]);
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
    ? await db.get('SELECT COUNT(*)::int AS count FROM products WHERE image = ? AND id != ?', [existing.image, productId])
    : { count: 0 };

  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM inventory_events WHERE product_id = ?', [productId]);
    await tx.run('DELETE FROM products WHERE id = ?', [productId]);
  });

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
  if (includeInactive && !(await isAuthorized(req))) {
    return res.status(401).json({ success: false, message: 'Admin login required.' });
  }
  res.json({ success: true, products: await getProducts({ includeInactive }) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const product = await getProduct(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
  res.json({ success: true, product });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const product = cleanProductPayload(req.body);
  const id = product.id || nextProductId();
  await ensureCategory(product.category);

  await db.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO products (id, name, price, category, image, description, color_options, stock, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, product.name, product.price, product.category, product.image, product.description, JSON.stringify(product.colorOptions), product.stock, product.isActive ? 1 : 0]);
    await tx.run(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'CREATE_PRODUCT', ?, 'Initial product stock')`, [id, product.stock]);
  });

  res.status(201).json({ success: true, product: await getProduct(id) });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const existing = await getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const product = cleanProductPayload(req.body, { partial: true });
  const next = {
    name: product.name || existing.name,
    price: Number.isInteger(product.price) && product.price >= 0 ? product.price : existing.price,
    category: product.category || existing.category,
    image: product.image !== '' ? product.image : existing.image,
    description: product.description !== '' ? product.description : existing.description,
    colorOptions: req.body.colorOptions === undefined && req.body.colors === undefined ? existing.colorOptions : product.colorOptions,
    stock: Number.isInteger(product.stock) && product.stock >= 0 ? product.stock : existing.stock,
    isActive: req.body.isActive === undefined ? existing.isActive : product.isActive
  };
  await ensureCategory(next.category);

  await db.transaction(async (tx) => {
    await tx.run(`
      UPDATE products
      SET name = ?, price = ?, category = ?, image = ?, description = ?, color_options = ?, stock = ?, is_active = ?, updated_at = ${nowSql}
      WHERE id = ?
    `, [next.name, next.price, next.category, next.image, next.description, JSON.stringify(next.colorOptions), next.stock, next.isActive ? 1 : 0, req.params.id]);

    const stockDelta = next.stock - existing.stock;
    if (stockDelta !== 0) {
      await tx.run(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'MANUAL_STOCK_UPDATE', ?, 'Stock updated through product API')`, [req.params.id, stockDelta]);
    }
  });

  res.json({ success: true, product: await getProduct(req.params.id) });
}));

router.patch('/:id/stock', requireAdmin, asyncHandler(async (req, res) => {
  const existing = await getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const mode = cleanText(req.body.mode, 'set');
  const quantity = Number(req.body.quantity);
  const note = cleanText(req.body.note, 'Stock adjusted through product API');
  if (!Number.isInteger(quantity)) throw new Error('Quantity must be an integer.');

  const nextStock = mode === 'adjust' ? existing.stock + quantity : quantity;
  if (nextStock < 0) throw new Error('Stock cannot be negative.');
  const delta = nextStock - existing.stock;

  await db.transaction(async (tx) => {
    await tx.run(`UPDATE products SET stock = ?, updated_at = ${nowSql} WHERE id = ?`, [nextStock, req.params.id]);
    if (delta !== 0) {
      await tx.run(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'MANUAL_STOCK_UPDATE', ?, ?)`, [req.params.id, delta, note]);
    }
  });

  res.json({ success: true, product: await getProduct(req.params.id) });
}));

router.post('/:id/image', requireAdmin, asyncHandler(async (req, res) => {
  const existing = await getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const uploaded = await uploadProductImage({
    imageData: req.body.imageData,
    productName: existing.name,
    productId: req.params.id
  });
  await db.run(`UPDATE products SET image = ?, updated_at = ${nowSql} WHERE id = ?`, [uploaded.url, req.params.id]);

  res.json({ success: true, image: uploaded.url, storage: uploaded, product: await getProduct(req.params.id) });
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
  const existing = await getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  await db.run(`UPDATE products SET is_active = 0, updated_at = ${nowSql} WHERE id = ?`, [req.params.id]);
  res.json({ success: true, product: await getProduct(req.params.id) });
}));

router.delete('/:id/permanent', requireAdmin, asyncHandler(async (req, res) => {
  const result = await permanentlyRemoveProduct(req.params.id);
  res.status(result.status).json(result.body);
}));

router.get('/:id/inventory-events', requireAdmin, asyncHandler(async (req, res) => {
  const existing = await getProduct(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Product not found.' });

  const events = await db.all('SELECT * FROM inventory_events WHERE product_id = ? ORDER BY created_at DESC, id DESC', [req.params.id]);
  res.json({ success: true, events });
}));

router.post('/bulk', requireAdmin, asyncHandler(async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('No products provided for bulk upload.');
  }

  let addedCount = 0;

  await db.transaction(async (tx) => {
    for (const p of products) {
      if (!p.name || !p.category) continue;

      const id = nextProductId();
      const price = Number.isInteger(Number(p.price)) ? Number(p.price) : 0;
      const stock = Number.isInteger(Number(p.stock)) ? Number(p.stock) : 0;
      const category = String(p.category || '').trim();
      const colorOptions = normalizeColorOptions(p.colorOptions ?? p.colors);

      const existingCategory = await tx.get('SELECT * FROM categories WHERE lower(name) = lower(?)', [category]);
      if (!existingCategory) {
        await tx.run('INSERT INTO categories (name) VALUES (?)', [category]);
      }

      await tx.run(`
        INSERT INTO products (id, name, price, category, image, description, color_options, stock, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [id, p.name.trim(), price, category, String(p.image || '').trim(), String(p.description || '').trim(), JSON.stringify(colorOptions), stock]);

      await tx.run(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'BULK_CREATE', ?, 'Bulk CSV Upload')`, [id, stock]);
      addedCount++;
    }
  });

  res.status(201).json({ success: true, message: `Successfully added ${addedCount} products.` });
}));

module.exports = router;
