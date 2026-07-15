// db/seed.js
// Handles all startup seed logic: default content, category migration,
// admin user seeding, and product catalog seeding from CSV.
// Extracted from db/connection.js to keep each file single-responsibility.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { db } = require('./connection');

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

  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const indexOf = name => headers.indexOf(name.toLowerCase());
  const indexes = {
    name: indexOf('Name'),
    category: indexOf('Category'),
    price: indexOf('Price'),
    stock: indexOf('Stock'),
    image: indexOf('Image'),
    description: indexOf('Description'),
    colors: indexOf('Colors')
  };

  return lines.slice(1).map(line => {
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

  return db.transaction(async tx => {
    let added = 0;
    for (const p of products) {
      const result = await tx.run(`
        INSERT INTO products (id, name, price, category, image, description, color_options, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING
      `, [p.id, p.name, p.price, p.category, p.image, p.description, JSON.stringify(p.colorOptions || []), p.stock]);
      if (result.changes > 0) {
        await tx.run(
          "INSERT INTO inventory_events (product_id, type, quantity_delta, note) VALUES (?, 'SEED', ?, ?)",
          [p.id, p.stock, 'Seeded from catalog']
        );
        added += 1;
      }
      await tx.run('INSERT INTO categories (name) VALUES (?) ON CONFLICT (name) DO NOTHING', [p.category]);
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
  // Default site content
  try {
    const defaultContent = {
      hero: { eyebrow: 'Handcrafted with love', title: 'Art that <em>speaks</em><br>to your soul', subtitle: 'Unique paintings, prints, and handmade pieces from our studio in India.' },
      about: { eyebrow: 'Our story', title: 'Where art meets intention', paragraph1: 'Every piece from Nika Arts Studio is created with care.', paragraph2: 'Based in India, we ship across the country and beyond.' },
      contact: { title: 'Get in touch', description: "Questions about a piece? Custom order requests? We'd love to hear from you.", email: 'nika.creations0927@gmail.com', phoneDisplay: '+91 98765 43210', phoneLink: '+919876543210' },
      assets: { logoImage: '', heroImage: 'images/hero.jpg', artistImage: 'images/ArtistPhoto.jpeg' }
    };
    await db.run("INSERT INTO settings (key, value) VALUES ('site_content', ?) ON CONFLICT (key) DO NOTHING", [JSON.stringify(defaultContent)]);
  } catch (err) {
    console.error('Failed to seed default content:', err);
  }

  // Migrate legacy 'Flowers' category to 'Forever Flowers'
  try {
    await db.run(`UPDATE products SET category = 'Forever Flowers', updated_at = ${nowSql} WHERE lower(category) = 'flowers'`);
    const foreverFlowers = await db.get('SELECT id FROM categories WHERE lower(name) = lower(?)', ['Forever Flowers']);
    const legacyFlowers  = await db.get('SELECT id FROM categories WHERE lower(name) = lower(?)', ['Flowers']);
    if (legacyFlowers && !foreverFlowers) {
      await db.run(`UPDATE categories SET name = 'Forever Flowers', is_active = 1, updated_at = ${nowSql} WHERE id = ?`, [legacyFlowers.id]);
    } else if (legacyFlowers && foreverFlowers) {
      await db.run(`UPDATE categories SET is_active = 0, updated_at = ${nowSql} WHERE id = ?`, [legacyFlowers.id]);
      await db.run(`UPDATE categories SET is_active = 1, updated_at = ${nowSql} WHERE id = ?`, [foreverFlowers.id]);
    }
  } catch (err) {
    console.error('Failed to migrate Flowers category name:', err);
  }

  // Seed first admin user from environment variables
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

  // Seed products from Cloudinary CSV catalog if DB is empty
  const cloudinaryProducts = loadCloudinaryProductsFromCsv();
  const row = await db.get('SELECT COUNT(*)::int AS count FROM products');
  const shouldSeedCloudinaryCatalog =
    cloudinaryProducts.length > 0 &&
    (row.count === 0 || await hasOnlyDefaultPlaceholderProducts());

  if (shouldSeedCloudinaryCatalog) {
    try {
      if (await hasOnlyDefaultPlaceholderProducts()) {
        await db.transaction(async tx => {
          await tx.run('DELETE FROM inventory_events WHERE product_id IN (?, ?, ?, ?, ?, ?)', ['p001', 'p002', 'p003', 'p004', 'p005', 'p006']);
          await tx.run('DELETE FROM products WHERE id IN (?, ?, ?, ?, ?, ?)',               ['p001', 'p002', 'p003', 'p004', 'p005', 'p006']);
        });
      }
      const added = await seedProductRows(cloudinaryProducts);
      if (added > 0) console.log(`Seeded ${added} Cloudinary catalog products from CSV.`);
    } catch (err) {
      console.error('Failed to seed Cloudinary products:', err);
    }
  }

  // Ensure default categories exist
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

  // Seed minimal placeholder products only when DB is completely empty
  const productCount = await db.get('SELECT COUNT(*)::int AS count FROM products');
  if (productCount.count > 0) return;

  const defaultProducts = [
    { id: 'p001', name: 'Lily',          price: 449, category: 'Crochet',   image: '', description: 'Handmade crochet lily.',                 stock: 10 },
    { id: 'p002', name: 'Sunflower',     price: 549, category: 'Crochet',   image: '', description: 'Handmade crochet sunflower.',             stock: 10 },
    { id: 'p003', name: 'Rose',          price: 349, category: 'Crochet',   image: '', description: 'Handmade crochet rose.',                  stock: 10 },
    { id: 'p004', name: 'Flower Bouquet',price: 349, category: 'Keychains', image: '', description: 'Handmade flower bouquet keychain.',       stock: 10 },
    { id: 'p005', name: 'Long Neck',     price: 549, category: 'Keychains', image: '', description: 'Handmade long neck keychain.',            stock: 10 },
    { id: 'p006', name: 'Bee Happy',     price: 449, category: 'Keychains', image: '', description: 'Handmade Bee Happy keychain.',            stock: 10 }
  ];

  try {
    await seedProductRows(defaultProducts);
  } catch (err) {
    console.error('Failed to seed default products:', err);
  }
}

module.exports = { seedDatabase };
