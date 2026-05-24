// db/index.js
const { db, nowSql, pool, ready } = require('./connection');
const queries = require('./queries');

// Combine and export both the database instance and all query functions.
// This ensures backwards compatibility with existing route files.
module.exports = {
  db,
  nowSql,
  pool,
  ready,
  ...queries
};
