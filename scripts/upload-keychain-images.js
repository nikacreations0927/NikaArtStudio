require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { uploadProductImage } = require('../services/storage');

const SUPPORTED_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.webp']);

function parseArgs(argv) {
  const options = {
    folder: argv[2],
    category: 'Keychains',
    price: '0',
    stock: '0',
    output: path.join(__dirname, '..', 'data', 'keychain-cloudinary-products.csv')
  };

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--category' && next) {
      options.category = next;
      i += 1;
    } else if (arg === '--price' && next) {
      options.price = next;
      i += 1;
    } else if (arg === '--stock' && next) {
      options.stock = next;
      i += 1;
    } else if (arg === '--output' && next) {
      options.output = path.resolve(next);
      i += 1;
    }
  }

  return options;
}

function productNameFromFile(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .split('-')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function toDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (!options.folder) {
    throw new Error('Usage: node scripts/upload-keychain-images.js "<image-folder>" --category Keychains --price 249 --stock 5');
  }

  const folder = path.resolve(options.folder);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(`Image folder not found: ${folder}`);
  }

  const files = fs.readdirSync(folder)
    .filter(file => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No supported images found in: ${folder}`);
  }

  const rows = [['Name', 'Category', 'Price', 'Stock', 'Image', 'Description']];
  for (const file of files) {
    const filePath = path.join(folder, file);
    const name = productNameFromFile(file);
    const uploaded = await uploadProductImage({
      imageData: toDataUrl(filePath),
      productName: name,
      productId: path.basename(file, path.extname(file))
    });

    rows.push([
      name,
      options.category,
      options.price,
      options.stock,
      uploaded.url,
      `Handmade crochet ${name.toLowerCase()}.`
    ]);
    console.log(`Uploaded ${file} -> ${uploaded.url}`);
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, rows.map(row => row.map(csvCell).join(',')).join('\n'));
  console.log(`\nCSV ready: ${options.output}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
