require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

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
