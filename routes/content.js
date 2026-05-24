// routes/content.js
const express = require('express');
const { getSiteContent, updateSiteContent } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const asyncHandler = require('../middleware/asyncHandler');
const { uploadSiteAsset } = require('../services/storage');

const router = express.Router();

// GET: Publicly accessible route for your storefront to load the text
router.get('/', asyncHandler(async (req, res) => {
  const content = await getSiteContent();
  res.json({ success: true, content });
}));

// PUT: Protected route for your Admin Dashboard to save new text
router.put('/', requireAdmin, asyncHandler(async (req, res) => {
  if (!req.body.content) throw new Error("Content object is required");
  const updatedContent = await updateSiteContent(req.body.content);
  res.json({ success: true, content: updatedContent });
}));

router.post('/assets/:assetKey', requireAdmin, asyncHandler(async (req, res) => {
  const allowedAssets = new Set(['logoImage', 'heroImage', 'artistImage']);
  const assetKey = req.params.assetKey;
  if (!allowedAssets.has(assetKey)) {
    return res.status(400).json({ success: false, message: 'Unknown site asset.' });
  }
  if (!req.body.imageData) throw new Error('Choose an image first.');

  const uploaded = await uploadSiteAsset({
    imageData: req.body.imageData,
    assetName: assetKey.replace(/Image$/, '')
  });

  const currentContent = await getSiteContent();
  const updatedContent = await updateSiteContent({
    ...currentContent,
    assets: {
      ...(currentContent.assets || {}),
      [assetKey]: uploaded.url
    }
  });

  res.status(201).json({ success: true, assetKey, url: uploaded.url, storage: uploaded, content: updatedContent });
}));

module.exports = router;
