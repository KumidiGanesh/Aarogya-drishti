function errorMessage(error) {
  if (error?.message) return error.message;
  if (Array.isArray(error?.errors)) {
    const details = error.errors
      .map((item) => [item.code, item.message].filter(Boolean).join(': '))
      .filter(Boolean);
    if (details.length) return details.join('; ');
  }
  return error?.code || error?.name || 'Unknown error';
}

module.exports = errorMessage;
