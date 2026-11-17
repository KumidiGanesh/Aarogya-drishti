function parsePagination(req, res, next) {
  const rawPage = req.query.page ?? '1';
  const rawLimit = req.query.limit ?? '20';
  const validInteger = (value) => typeof value === 'string' && /^\d+$/.test(value);
  const page = validInteger(rawPage) ? Number(rawPage) : NaN;
  const limit = validInteger(rawLimit) ? Number(rawLimit) : NaN;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({
      success: false,
      message: 'page must be positive and limit must be between 1 and 100',
      errors: [],
      code: 'INVALID_PAGINATION',
    });
  }
  req.pagination = { page, limit, offset: (page - 1) * limit };
  return next();
}

module.exports = parsePagination;
