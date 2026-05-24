const express = require('express');
const { db, createCategory, getCategories, getCategoryByName, nowSql } = require('../db');
const { isAuthorized, requireAdmin } = require('../middleware/adminAuth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

function cleanText(value) {
  return String(value || '').trim();
}

router.get('/', asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  if (includeInactive && !(await isAuthorized(req))) {
    return res.status(401).json({ success: false, message: 'Admin login required.' });
  }
  res.json({ success: true, categories: await getCategories({ includeInactive }) });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name);
  const existing = await getCategoryByName(name);

  if (existing) {
    if (!existing.isActive) {
      await db.run(`UPDATE categories SET is_active = 1, updated_at = ${nowSql} WHERE id = ?`, [existing.id]);
    }
    return res.status(200).json({ success: true, category: await getCategoryByName(name) });
  }

  res.status(201).json({ success: true, category: await createCategory(name) });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const name = cleanText(req.body.name);
  if (!name) throw new Error('Category name is required.');

  const existing = await db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Category not found.' });

  const nextActive = req.body.isActive === undefined ? Boolean(existing.is_active) : Boolean(req.body.isActive);

  await db.transaction(async (tx) => {
    await tx.run(`UPDATE products SET category = ?, updated_at = ${nowSql} WHERE category = ?`, [name, existing.name]);
    await tx.run(`UPDATE categories SET name = ?, is_active = ?, updated_at = ${nowSql} WHERE id = ?`, [name, nextActive ? 1 : 0, req.params.id]);
  });

  res.json({ success: true, category: await getCategoryByName(name) });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const existing = await db.get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Category not found.' });

  await db.run(`UPDATE categories SET is_active = 0, updated_at = ${nowSql} WHERE id = ?`, [req.params.id]);
  res.json({ success: true });
}));

module.exports = router;
