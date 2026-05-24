require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getSiteContent, pool, ready, updateSiteContent } = require('../db');
const { hasCloudinaryConfig, uploadSiteAsset } = require('../services/storage');

const rootDir = path.join(__dirname, '..');

const assetsToUpload = [
  {
    key: 'logoImage',
    name: 'logo',
    filePath: path.join(rootDir, 'public', 'images', 'hero.jpg')
  },
  {
    key: 'artistImage',
    name: 'artist-photo',
    filePath: path.join(rootDir, 'public', 'images', 'ArtistPhoto.jpeg')
  }
];

function imageDataFromFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeByExtension = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp'
  };
  const mime = mimeByExtension[extension];
  if (!mime) throw new Error(`Unsupported image type: ${filePath}`);

  const buffer = fs.readFileSync(filePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function main() {
  if (!hasCloudinaryConfig()) {
    throw new Error('Cloudinary credentials are missing in .env.');
  }

  await ready;

  const currentContent = await getSiteContent();
  const nextAssets = { ...(currentContent.assets || {}) };

  for (const asset of assetsToUpload) {
    if (!fs.existsSync(asset.filePath)) {
      console.warn(`Skipped ${asset.name}: file not found at ${asset.filePath}`);
      continue;
    }

    const uploaded = await uploadSiteAsset({
      imageData: imageDataFromFile(asset.filePath),
      assetName: asset.name
    });

    nextAssets[asset.key] = uploaded.url;
    console.log(`${asset.key}: ${uploaded.url}`);
  }

  const updatedContent = await updateSiteContent({
    ...currentContent,
    assets: nextAssets
  });

  console.log('Updated site assets:');
  console.log(JSON.stringify(updatedContent.assets, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
