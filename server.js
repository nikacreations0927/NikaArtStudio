require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const shiprocketRoutes = require('./routes/shiprocket');
const orderRoutes = require('./routes/orders');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const contentRoutes = require('./routes/content');
const configRoutes = require('./routes/config');
const { ready: dbReady, pool } = require('./db');

const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

function originFromUrl(value) {
  try {
    return value ? new URL(value).origin : '';
  } catch {
    return '';
  }
}

function allowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const baseOrigin = originFromUrl(process.env.BASE_URL);
  const renderOrigin = originFromUrl(process.env.RENDER_EXTERNAL_URL);
  const development = process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://127.0.0.1:3000']
    : [];
  return new Set([...configured, baseOrigin, renderOrigin, ...development].filter(Boolean));
}

function requireProductionEnv() {
  if (process.env.RENDER && process.env.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be set to production on Render for secure cookies and production-only safeguards.');
  }
}

requireProductionEnv();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins().has(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));
app.use('/api/auth/admin/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/api/payment/initiate', rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false }));
app.use('/api/shiprocket/serviceability', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const pageRoutes = {
  '/': 'index.html',
  '/shop': 'products.html',
  '/product': 'product.html',
  '/cart': 'cart.html',
  '/checkout': 'checkout.html',
  '/success': 'success.html',
  '/track-order': 'track.html',
  '/trackOrder': 'track.html',
  '/account': 'account.html',
  '/admin': 'admin.html',
  '/privacy': 'privacy.html',
  '/shipping': 'shipping.html',
  '/returns': 'returns.html'
};

const legacyHtmlRedirects = {
  '/index.html': '/',
  '/products.html': '/shop',
  '/product.html': '/product',
  '/cart.html': '/cart',
  '/checkout.html': '/checkout',
  '/success.html': '/success',
  '/track.html': '/track-order',
  '/account.html': '/account',
  '/admin.html': '/admin',
  '/privacy.html': '/privacy',
  '/shipping.html': '/shipping',
  '/returns.html': '/returns'
};

Object.entries(legacyHtmlRedirects).forEach(([legacyPath, cleanPath]) => {
  app.get(legacyPath, (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(301, `${cleanPath}${query}`);
  });
});

Object.entries(pageRoutes).forEach(([routePath, fileName]) => {
  app.get(routePath, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', fileName));
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/shiprocket', shiprocketRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/config', configRoutes);

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', store: 'Nika Arts Studio', timestamp: new Date() });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(errorHandler);

let server;

dbReady
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`\nNika Arts Studio server running at http://localhost:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  if (!server) {
    process.exit(0);
  }

  server.close(async () => {
    console.log('HTTP server closed');
    await pool.end();
  });
});
