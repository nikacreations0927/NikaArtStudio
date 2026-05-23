// middleware/errorHandler.js

/**
 * Centralized error handling middleware.
 * Captures all unhandled errors from routes and formats them predictably.
 * * @param {Error} err - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function errorHandler(err, req, res, next) {
  console.error(`[Error] ${err.name}: ${err.message}`);
  
  // Distinguish between client errors (400) and server errors (500)
  const statusCode = err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
  
  res.status(statusCode).json({
    success: false,
    message: err.message || 'An unexpected internal server error occurred.',
    details: err.shiprocket,
    // Only send stack traces in development mode for easier AI debugging
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}

module.exports = errorHandler;
