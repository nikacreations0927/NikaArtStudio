require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { db, pool, ready } = require('../db');

const sqlitePath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'store.sqlite');

const migrations = [
  {
    table: 'settings',
    columns: ['key', 'value', 'updated_at'],
    conflict: 'key'
  },
  {
    table: 'categories',
    columns: ['id', 'name', 'is_active', 'created_at', 'updated_at'],
    conflict: 'id'
  },
  {
    table: 'admin_users',
    columns: ['id', 'username', 'display_name', 'password_hash', 'role', 'is_active', 'last_login_at', 'created_at', 'updated_at'],
    conflict: 'id'
  },
  {
    table: 'customers',
    columns: ['id', 'first_name', 'last_name', 'email', 'mobile', 'password_hash', 'created_at'],
    conflict: 'id'
  },
  {
    table: 'products',
    columns: ['id', 'name', 'price', 'category', 'image', 'description', 'stock', 'is_active', 'is_deleted', 'created_at', 'updated_at'],
    conflict: 'id'
  },
  {
    table: 'orders',
    columns: ['id', 'customer_json', 'subtotal', 'shipping', 'total', 'payment_status', 'fulfillment_status', 'logistics_status', 'payment_provider', 'provider_transaction_id', 'shiprocket_order_id', 'shiprocket_shipment_id', 'created_at', 'updated_at'],
    conflict: 'id'
  },
  {
    table: 'order_items',
    columns: ['id', 'order_id', 'product_id', 'name_snapshot', 'price_snapshot', 'qty', 'line_total'],
    conflict: 'id'
  },
  {
    table: 'inventory_events',
    columns: ['id', 'product_id', 'order_id', 'type', 'quantity_delta', 'note', 'created_at'],
    conflict: 'id'
  },
  {
    table: 'payments',
    columns: ['id', 'order_id', 'provider', 'provider_transaction_id', 'status', 'raw_json', 'created_at'],
    conflict: 'id'
  },
  {
    table: 'logistics_events',
    columns: ['id', 'order_id', 'provider', 'status', 'tracking_id', 'raw_json', 'created_at'],
    conflict: 'id'
  }
];

function sqliteTableExists(sqlite, table) {
  return Boolean(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function syncSequence(table, idColumn = 'id') {
  await db.query(`
    SELECT setval(
      pg_get_serial_sequence($1, $2),
      COALESCE((SELECT MAX(${idColumn}) FROM ${table}), 1),
      COALESCE((SELECT MAX(${idColumn}) FROM ${table}), 0) > 0
    )
  `, [table, idColumn]);
}

async function main() {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite file not found: ${sqlitePath}`);
  }

  await ready;
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });

  try {
    for (const migration of migrations) {
      if (!sqliteTableExists(sqlite, migration.table)) {
        console.log(`Skipped ${migration.table}: table not found in SQLite.`);
        continue;
      }

      const sqliteColumns = new Set(sqlite.prepare(`PRAGMA table_info(${migration.table})`).all().map(column => column.name));
      const columns = migration.columns.filter(column => sqliteColumns.has(column));
      if (!columns.includes(migration.conflict)) {
        console.log(`Skipped ${migration.table}: conflict key ${migration.conflict} not found in SQLite.`);
        continue;
      }

      const rows = sqlite.prepare(`SELECT ${columns.join(', ')} FROM ${migration.table}`).all();
      if (!rows.length) {
        console.log(`Skipped ${migration.table}: no rows.`);
        continue;
      }

      await db.transaction(async (tx) => {
        for (const row of rows) {
          const values = columns.map(column => row[column]);
          await tx.run(`
            INSERT INTO ${migration.table} (${columns.join(', ')})
            VALUES (${placeholders(columns.length)})
            ON CONFLICT (${migration.conflict}) DO NOTHING
          `, values);
        }
      });

      if (['categories', 'order_items', 'inventory_events', 'payments', 'logistics_events'].includes(migration.table)) {
        await syncSequence(migration.table);
      }

      console.log(`Migrated ${rows.length} row(s) from ${migration.table}.`);
    }
  } finally {
    sqlite.close();
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
