// routes/categories.js
const express = require('express');
const { db, createCategory, getCategories, getCategoryByName } = require('../db');
const { isAuthorized, requireAdmin } = require('../middleware/adminAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
const nowSql = "datetime('now')";

function cleanText(value) {
  return String(value || '').trim();
}

router.get('/', asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  if (includeInactive && !isAuthorized(req)) {
    return res.status(401).json({ success: false, message: 'Admin login required.' });
  }
  res.json({ success: true, categories: getCategories({ includeInactive }) });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name);
  const existing = getCategoryByName(name);
  
  if (existing) {
    if (!existing.isActive) {
      db.prepare(`UPDATE categories SET is_active = 1, updated_at = ${nowSql} WHERE id = ?`).run(existing.id);
    }
    return res.status(200).json({ success: true, category: getCategoryByName(name) });
  }

  res.status(201).json({ success: true, category: createCategory(name) });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name);
  if (!name) throw new Error('Category name is required.');

  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Category not found.' });

  const nextActive = req.body.isActive === undefined ? Boolean(existing.is_active) : Boolean(req.body.isActive);

  // We keep standard try/finally blocks ONLY for Database Transactions (BEGIN/COMMIT/ROLLBACK)
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE products SET category = ?, updated_at = ${nowSql} WHERE category = ?`).run(name, existing.name);
    db.prepare(`UPDATE categories SET name = ?, is_active = ?, updated_at = ${nowSql} WHERE id = ?`).run(name, nextActive ? 1 : 0, req.params.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err; // The asyncHandler will catch this!
  }

  res.json({ success: true, category: getCategoryByName(name) });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Category not found.' });

  db.prepare(`UPDATE categories SET is_active = 0, updated_at = ${nowSql} WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
}));

module.exports = router;