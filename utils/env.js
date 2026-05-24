function numberFromEnv(name, fallback, { min = Number.NEGATIVE_INFINITY } = {}) {
  const rawValue = process.env[name];
  const value = rawValue === undefined || rawValue === null || String(rawValue).trim() === ''
    ? fallback
    : Number(rawValue);

  if (!Number.isFinite(value) || value < min) {
    return fallback;
  }

  return value;
}

module.exports = {
  numberFromEnv
};
