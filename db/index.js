// db/index.js
const { db } = require('./connection');
const queries = require('./queries');

// Combine and export both the database instance and all query functions.
// This ensures backwards compatibility with existing route files.
module.exports = {
  db,
  ...queries
};