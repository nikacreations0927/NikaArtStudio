// middleware/asyncHandler.js

/**
 * Async Handler Middleware
 * Wraps async route handlers to automatically catch errors and pass them to our central errorHandler.
 * This eliminates the need for repetitive try/catch blocks in every route.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;