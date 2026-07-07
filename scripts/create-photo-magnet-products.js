require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { uploadProductImage } = require('../services/storage');
const { db, createCategory, getCategoryByName, getProduct, nowSql } = require('../db');

const imagesDir = path.join(__dirname, '..', 'data', 'generated-products', 'photo-magnets');

function toDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

async function ensureCategory(name) {
  const existing = await getCategoryByName(name);
  if (existing) {
    if (!existing.isActive) {
      await db.run(`UPDATE categories SET is_active = 1, updated_at = ${nowSql} WHERE id = ?`, [existing.id]);
    }
    return existing;
  }
  return createCategory(name);
}

async function upsertProduct(product) {
  const existing = await getProduct(product.id);
  await ensureCategory(product.category);

  if (existing) {
    await db.run(`
      UPDATE products
      SET name = ?, price = ?, category = ?, image = ?, description = ?, color_options = '[]', stock = ?, is_active = 1, is_deleted = 0, updated_at = ${nowSql}
      WHERE id = ?
    `, [product.name, product.price, product.category, product.image, product.description, product.stock, product.id]);
    return 'updated';
  }

  await db.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO products (id, name, price, category, image, description, color_options, stock, is_active, is_deleted)
      VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 1, 0)
    `, [product.id, product.name, product.price, product.category, product.image, product.description, product.stock]);
    await tx.run(`INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'CREATE_PRODUCT', ?, 'Initial photo magnet stock')`, [product.id, product.stock]);
  });
  return 'created';
}

async function main() {
  const products = [
    {
      id: 'photo-magnet-9x6',
      name: 'Photo Magnet 9x6 cm',
      price: 140,
      stock: 10,
      file: 'photo-magnet-9x6.png',
      description: 'Custom acrylic photo magnet in 9x6 cm size. Bulk price shown per piece.'
    },
    {
      id: 'photo-magnet-10x7-5',
      name: 'Photo Magnet 10x7.5 cm',
      price: 165,
      stock: 10,
      file: 'photo-magnet-10x7-5.png',
      description: 'Custom acrylic photo magnet in 10x7.5 cm size. Bulk price shown per piece.'
    },
    {
      id: 'photo-magnet-8x8',
      name: 'Photo Magnet 8x8 cm',
      price: 165,
      stock: 10,
      file: 'photo-magnet-8x8.png',
      description: 'Custom square acrylic photo magnet in 8x8 cm size. Bulk price shown per piece.'
    }
  ];

  for (const product of products) {
    const filePath = path.join(imagesDir, product.file);
    if (!fs.existsSync(filePath)) throw new Error(`Missing generated image: ${filePath}`);

    const uploaded = await uploadProductImage({
      imageData: toDataUrl(filePath),
      productName: product.name,
      productId: product.id
    });

    const status = await upsertProduct({
      ...product,
      category: 'Photo Magnets',
      image: uploaded.url
    });

    console.log(`${status}: ${product.name} -> ${uploaded.url}`);
  }

  await db.query('SELECT 1');
  console.log('Photo Magnets category/products are ready.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
