function getAllowedOrigins() {
  const configuredOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([
    ...configuredOrigins,
    ...(process.env.NODE_ENV === 'production'
      ? []
      : [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174',
      ]),
  ]);
}

module.exports = getAllowedOrigins;
