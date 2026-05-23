const fs = require('fs');
const path = require('path');
const { v2: cloudinary } = require('cloudinary');

const productImagesDir = path.join(__dirname, '..', 'public', 'images', 'products');
const siteImagesDir = path.join(__dirname, '..', 'public', 'images', 'site');
fs.mkdirSync(productImagesDir, { recursive: true });
fs.mkdirSync(siteImagesDir, { recursive: true });

function hasCloudinaryConfig() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinary() {
  if (!hasCloudinaryConfig()) return false;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  return true;
}

function safeFilePart(value) {
  return String(value || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'product';
}

function parseImageData(imageData) {
  const match = String(imageData || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw new Error('Upload a JPEG, PNG, or WEBP image.');

  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const extByMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.length === 0) throw new Error('Image file is empty.');
  if (buffer.length > 4 * 1024 * 1024) throw new Error('Image must be 4 MB or smaller.');

  return { buffer, ext: extByMime[mime] };
}

async function uploadProductImage({ imageData, productName, productId }) {
  const { buffer, ext } = parseImageData(imageData);
  const baseName = `${safeFilePart(productName)}-${safeFilePart(productId)}-${Date.now()}`;

  if (configureCloudinary()) {
    const folder = process.env.CLOUDINARY_PRODUCT_FOLDER || 'nika-arts/products';
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: baseName,
          overwrite: false,
          resource_type: 'image',
          tags: ['nika-arts', 'product']
        },
        (error, result) => error ? reject(error) : resolve(result)
      );

      stream.end(buffer);
    });

    return {
      provider: 'cloudinary',
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      bytes: uploadResult.bytes,
      format: uploadResult.format
    };
  }

  const fileName = `${baseName}.${ext}`;
  const absolutePath = path.join(productImagesDir, fileName);
  const relativePath = `images/products/${fileName}`;
  fs.writeFileSync(absolutePath, buffer);

  return {
    provider: 'local',
    url: relativePath,
    publicId: null,
    bytes: buffer.length,
    format: ext
  };
}

async function uploadSiteAsset({ imageData, assetName }) {
  const { buffer, ext } = parseImageData(imageData);
  const baseName = `${safeFilePart(assetName)}-${Date.now()}`;

  if (configureCloudinary()) {
    const folder = process.env.CLOUDINARY_SITE_FOLDER || process.env.CLOUDINARY_ASSET_FOLDER || 'nika-arts/site';
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: baseName,
          overwrite: true,
          resource_type: 'image',
          tags: ['nika-arts', 'site-asset']
        },
        (error, result) => error ? reject(error) : resolve(result)
      );

      stream.end(buffer);
    });

    return {
      provider: 'cloudinary',
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      bytes: uploadResult.bytes,
      format: uploadResult.format
    };
  }

  const fileName = `${baseName}.${ext}`;
  const absolutePath = path.join(siteImagesDir, fileName);
  const relativePath = `images/site/${fileName}`;
  fs.writeFileSync(absolutePath, buffer);

  return {
    provider: 'local',
    url: relativePath,
    publicId: null,
    bytes: buffer.length,
    format: ext
  };
}

function cloudinaryPublicIdFromUrl(imageUrl) {
  try {
    const url = new URL(imageUrl);
    if (!url.hostname.endsWith('res.cloudinary.com')) return null;

    const uploadMarker = '/image/upload/';
    const markerIndex = url.pathname.indexOf(uploadMarker);
    if (markerIndex === -1) return null;

    const parts = url.pathname.slice(markerIndex + uploadMarker.length).split('/').filter(Boolean);
    const versionIndex = parts.findIndex(part => /^v\d+$/.test(part));
    const publicIdParts = versionIndex >= 0 ? parts.slice(versionIndex + 1) : parts;
    if (publicIdParts.length === 0) return null;

    const publicIdWithExtension = publicIdParts.join('/');
    return decodeURIComponent(publicIdWithExtension.replace(/\.[a-z0-9]+$/i, ''));
  } catch {
    return null;
  }
}

async function deleteProductImage(imageUrl) {
  if (!imageUrl) return { provider: 'none', deleted: false };

  const publicId = cloudinaryPublicIdFromUrl(imageUrl);
  if (publicId && configureCloudinary()) {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    return { provider: 'cloudinary', publicId, deleted: result.result === 'ok', result: result.result };
  }

  if (String(imageUrl).startsWith('images/products/')) {
    const absolutePath = path.resolve(path.join(__dirname, '..', 'public', imageUrl));
    const productDir = path.resolve(productImagesDir);
    if (absolutePath.startsWith(productDir) && fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
      return { provider: 'local', deleted: true };
    }
  }

  return { provider: 'unknown', deleted: false };
}

module.exports = {
  deleteProductImage,
  hasCloudinaryConfig,
  parseImageData,
  uploadProductImage,
  uploadSiteAsset
};
