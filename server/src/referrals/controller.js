const service = require('./service');

async function createOrAct(req, res, next) {
  try {
    const result = await service.referralAction(
      req.validated.body,
      req.files || [],
      req.user,
      req,
    );
    return res.status(req.validated.body.action === 'create' ? 201 : 200).json({
      success: true,
      message: req.validated.body.action === 'create' ? 'Referral created' : 'Referral updated',
      data: result,
      meta: {},
    });
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    const query = req.validated.query;
    if (query.download) {
      const { buffer, mimeType, filename } = await service.getReferralDocument(
        query.download,
        req.user,
        req,
      );
      res.set({
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${filename.replace(/["\\]/g, '_')}"`,
        'Content-Type': mimeType,
        'Content-Length': buffer.length,
      });
      return res.status(200).send(buffer);
    }
    const result = await service.listReferrals(query, req.user);
    return res.status(200).json({
      success: true,
      message: 'Referrals loaded',
      data: result.directory ? { items: result.items, directory: result.directory } : { items: result.items },
      meta: result.meta || {},
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { createOrAct, list };
