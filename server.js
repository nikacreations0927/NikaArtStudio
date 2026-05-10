// ─────────────────────────────────────────────────────────
//  Nika Arts Studio — Backend Server
//  Node.js + Express
//
//  SETUP:
//    1. npm install
//    2. Copy .env.example to .env and fill in your keys
//    3. node server.js  (or: npm start)
// ─────────────────────────────────────────────────────────

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const paymentRoutes    = require('./routes/payment');
const shiprocketRoutes = require('./routes/shiprocket');
const orderRoutes      = require('./routes/orders');
const productRoutes    = require('./routes/products');
const categoryRoutes   = require('./routes/categories');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes
app.use('/api/payment',    paymentRoutes);
app.use('/api/shiprocket', shiprocketRoutes);
app.use('/api/orders',     orderRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/categories', categoryRoutes);

// ── Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', store: 'Nika Arts Studio' });
});

// ── Catch-all: serve index.html for any unknown route (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅  Nika Arts Studio server running at http://localhost:${PORT}\n`);
});
