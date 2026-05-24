require('dotenv').config();

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const { numberFromEnv } = require('../utils/env');

const sqlitePath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'store.sqlite');
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required for Supabase migration.');
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: numberFromEnv('PG_POOL_MAX', 5, { min: 1 }),
  connectionTimeoutMillis: 15000
});

function tableExists(table) {
  return Boolean(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).get());
}

function readRows(table, columns = '*') {
  if (!tableExists(table)) return [];
  return sqlite.prepare(`SELECT ${columns} FROM ${table}`).all();
}

async function syncSequence(client, table, column = 'id') {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence($1, $2),
      COALESCE((SELECT MAX(${column}) FROM ${table}), 1),
      COALESCE((SELECT MAX(${column}) FROM ${table}), 0) > 0
    )
  `, [table, column]);
}

async function migrate() {
  const client = await pool.connect();
  const summary = {
    categoriesAdded: 0,
    customersAdded: 0,
    productsAddedActive: 0,
    productsAddedArchived: 0,
    productsSkippedExistingId: 0,
    ordersAdded: 0,
    orderItemsAdded: 0,
    inventoryEventsAdded: 0,
    paymentsAdded: 0,
    settingsSkippedExisting: 0
  };

  try {
    await client.query('BEGIN');

    for (const row of readRows('settings', 'key, value, updated_at')) {
      const result = await client.query(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ($1, $2, COALESCE($3::timestamptz, CURRENT_TIMESTAMP))
        ON CONFLICT (key) DO NOTHING
      `, [row.key, row.value, row.updated_at]);
      if (result.rowCount === 0) summary.settingsSkippedExisting += 1;
    }

    for (const row of readRows('categories', 'name, is_active, created_at, updated_at')) {
      const result = await client.query(`
        INSERT INTO categories (name, is_active, created_at, updated_at)
        VALUES ($1, $2, COALESCE($3::timestamptz, CURRENT_TIMESTAMP), COALESCE($4::timestamptz, CURRENT_TIMESTAMP))
        ON CONFLICT (name) DO NOTHING
      `, [row.name, row.is_active, row.created_at, row.updated_at]);
      summary.categoriesAdded += result.rowCount;
    }

    for (const row of readRows('customers', 'id, first_name, last_name, email, mobile, password_hash, created_at')) {
      const result = await client.query(`
        INSERT INTO customers (id, first_name, last_name, email, mobile, password_hash, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, CURRENT_TIMESTAMP))
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.first_name, row.last_name, row.email, row.mobile, row.password_hash, row.created_at]);
      summary.customersAdded += result.rowCount;
    }

    const pgProductsByName = new Map(
      (await client.query('SELECT id, lower(name) AS name_key FROM products')).rows.map(row => [row.name_key, row.id])
    );

    for (const row of readRows('products', 'id, name, price, category, image, description, stock, is_active, is_deleted, created_at, updated_at')) {
      const existingById = await client.query('SELECT id FROM products WHERE id = $1', [row.id]);
      if (existingById.rowCount > 0) {
        summary.productsSkippedExistingId += 1;
        continue;
      }

      const duplicateNameId = pgProductsByName.get(String(row.name || '').toLowerCase());
      const archiveDuplicate = Boolean(duplicateNameId && duplicateNameId !== row.id);
      const isActive = archiveDuplicate ? 0 : row.is_active;
      const isDeleted = archiveDuplicate ? 1 : row.is_deleted;
      const description = archiveDuplicate
        ? `${row.description || ''}\n\nArchived legacy product retained for migrated order history.`.trim()
        : row.description;

      const result = await client.query(`
        INSERT INTO products (id, name, price, category, image, description, stock, is_active, is_deleted, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, CURRENT_TIMESTAMP), COALESCE($11::timestamptz, CURRENT_TIMESTAMP))
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.name, row.price, row.category, row.image, description, row.stock, isActive, isDeleted, row.created_at, row.updated_at]);

      if (result.rowCount > 0 && archiveDuplicate) summary.productsAddedArchived += 1;
      if (result.rowCount > 0 && !archiveDuplicate) summary.productsAddedActive += 1;
    }

    for (const row of readRows('orders', 'id, customer_json, subtotal, shipping, total, payment_status, fulfillment_status, logistics_status, payment_provider, provider_transaction_id, shiprocket_order_id, shiprocket_shipment_id, created_at, updated_at')) {
      const result = await client.query(`
        INSERT INTO orders (id, customer_json, subtotal, shipping, total, payment_status, fulfillment_status, logistics_status, payment_provider, provider_transaction_id, shiprocket_order_id, shiprocket_shipment_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, CURRENT_TIMESTAMP), COALESCE($14::timestamptz, CURRENT_TIMESTAMP))
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.customer_json, row.subtotal, row.shipping, row.total, row.payment_status, row.fulfillment_status, row.logistics_status, row.payment_provider, row.provider_transaction_id, row.shiprocket_order_id, row.shiprocket_shipment_id, row.created_at, row.updated_at]);
      summary.ordersAdded += result.rowCount;
    }

    for (const row of readRows('order_items', 'id, order_id, product_id, name_snapshot, price_snapshot, qty, line_total')) {
      const result = await client.query(`
        INSERT INTO order_items (id, order_id, product_id, name_snapshot, price_snapshot, qty, line_total)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.order_id, row.product_id, row.name_snapshot, row.price_snapshot, row.qty, row.line_total]);
      summary.orderItemsAdded += result.rowCount;
    }

    for (const row of readRows('inventory_events', 'product_id, order_id, type, quantity_delta, note, created_at')) {
      const result = await client.query(`
        INSERT INTO inventory_events (product_id, order_id, type, quantity_delta, note, created_at)
        SELECT $1, $2, $3, $4, $5, COALESCE($6::timestamptz, CURRENT_TIMESTAMP)
        WHERE NOT EXISTS (
          SELECT 1 FROM inventory_events
          WHERE product_id = $1
            AND COALESCE(order_id, '') = COALESCE($2, '')
            AND type = $3
            AND quantity_delta = $4
            AND COALESCE(note, '') = COALESCE($5, '')
            AND created_at = COALESCE($6::timestamptz, CURRENT_TIMESTAMP)
        )
      `, [row.product_id, row.order_id, row.type, row.quantity_delta, row.note, row.created_at]);
      summary.inventoryEventsAdded += result.rowCount;
    }

    for (const row of readRows('payments', 'id, order_id, provider, provider_transaction_id, status, raw_json, created_at')) {
      const result = await client.query(`
        INSERT INTO payments (id, order_id, provider, provider_transaction_id, status, raw_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, CURRENT_TIMESTAMP))
        ON CONFLICT (id) DO NOTHING
      `, [row.id, row.order_id, row.provider, row.provider_transaction_id, row.status, row.raw_json, row.created_at]);
      summary.paymentsAdded += result.rowCount;
    }

    await syncSequence(client, 'categories');
    await syncSequence(client, 'order_items');
    await syncSequence(client, 'inventory_events');
    await syncSequence(client, 'payments');

    await client.query('COMMIT');
    return summary;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

migrate()
  .then(summary => {
    console.log('Safe Supabase migration completed.');
    console.table(summary);
  })
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    sqlite.close();
    await pool.end();
  });
