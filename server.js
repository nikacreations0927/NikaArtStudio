// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Route Imports
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const shiprocketRoutes = require('./routes/shiprocket');
const orderRoutes = require('./routes/orders');
const productRoutes = require('./routes/products');
const categoryRoutes = require('./routes/categories');
const contentRoutes = require('./routes/content');

// Middleware Imports
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * 1. Global Middleware Setup
 */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * 2. Static File Serving
 * Serves the frontend HTML/CSS/JS from the 'public' directory.
 */
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 3. API Route Definitions
 */
app.use('/api/auth', authRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/shiprocket', shiprocketRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/content', contentRoutes);

/**
 * 4. Health Check Endpoint
 * Useful for automated monitoring tools or deployment platforms.
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', store: 'Nika Arts Studio', timestamp: new Date() });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found.' });
});

/**
 * 5. Catch-All Route (SPA Fallback)
 * If a route isn't recognized, serve the frontend index.html.
 */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * 6. Centralized Error Handling
 * MUST be placed after all other routes and middleware.
 */
app.use(errorHandler);

/**
 * 7. Server Initialization
 */
const server = app.listen(PORT, () => {
  console.log(`\n✅ Nika Arts Studio server running at http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

/**
 * 8. Graceful Shutdown (Best Practice)
 * Ensures DB connections or ongoing requests finish before shutting down.
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    // If you add DB close logic later, it goes here.
  });
});
