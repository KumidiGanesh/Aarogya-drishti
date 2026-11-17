'use strict';
const express = require('express');
const { z } = require('zod');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const service = require('./service');

const router = express.Router();
router.use(authenticate);
const uuid = z.string().uuid();
const language = z.enum(['en', 'te', 'hi', 'or']);
const bodySchema = (body, params = z.object({}).passthrough()) =>
  z.object({ body, params }).passthrough();
const researchConsentSchema = bodySchema(z.object({
  research_ai_training: z.literal(true),
  language,
}).strict());
const withdrawSchema = bodySchema(z.object({}).strict());
const createSchema = bodySchema(
  z
    .object({
      name: z.string().trim().min(2).max(120),
      version: z.string().trim().min(1).max(60),
      description: z.string().trim().max(1000).default(''),
    })
    .strict(),
);
const addSchema = bodySchema(
  z
    .object({
      image_id: uuid,
      consent_record_id: uuid,
      split: z.enum(['train', 'validation', 'test']),
    })
    .strict(),
  z.object({ id: uuid }),
);
const annotationSchema = bodySchema(
  z
    .object({
      labels: z
        .array(
          z.enum([
            'normal_appearing',
            'white_area',
            'red_area',
            'ulcer_like_area',
            'surface_change',
            'other_visible_feature',
          ]),
        )
        .min(1)
        .max(30),
      anatomical_region: z.enum(['inner_cheek', 'tongue', 'gum', 'palate', 'lip', 'other']),
    })
    .strict(),
  z.object({ itemId: uuid }),
);
const idSchema = z.object({ params: z.object({ id: uuid }) }).passthrough();

router.get(
  '/consent',
  authorize('patient'),
  requirePermission('patients:self:manage'),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        message: 'Research consent status loaded',
        data: await service.getResearchConsent(req.user),
        meta: {},
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/consent',
  authorize('patient'),
  requirePermission('patients:self:manage'),
  validate(researchConsentSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        message: 'Research consent recorded',
        data: await service.grantResearchConsent(req.validated.body, req.user),
        meta: {},
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/consent/withdraw',
  authorize('patient'),
  requirePermission('patients:self:manage'),
  validate(withdrawSchema),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        message: 'Research consent withdrawn',
        data: await service.withdrawResearchConsent(req.user),
        meta: {},
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/datasets',
  authorize('admin', 'super_admin'),
  requirePermission('research:datasets:manage'),
  async (req, res, next) => {
  try {
    res.json({ success: true, data: { datasets: await service.listDatasets(req.user) } });
  } catch (error) {
    next(error);
  }
  },
);
router.get(
  '/datasets/:id/items',
  authorize('admin', 'super_admin', 'doctor', 'specialist'),
  requirePermission('research:datasets:manage', 'research:annotations:review'),
  validate(idSchema),
  async (req, res, next) => {
    try {
      const result = await service.listItems(req.validated.params.id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/datasets',
  authorize('admin', 'super_admin'),
  requirePermission('research:datasets:manage'),
  validate(createSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        data: { dataset: await service.createDataset(req.validated.body, req.user) },
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/datasets/:id/items',
  authorize('admin', 'super_admin'),
  requirePermission('research:datasets:manage'),
  validate(addSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        data: {
          item: await service.addImage(req.validated.params.id, req.validated.body, req.user),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/items/:itemId/annotation',
  authorize('doctor', 'specialist'),
  requirePermission('research:annotations:review'),
  validate(annotationSchema),
  async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        data: {
          annotation: await service.annotate(
            req.validated.params.itemId,
            req.validated.body,
            req.user,
          ),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  '/datasets/:id/seal',
  authorize('admin', 'super_admin'),
  requirePermission('research:datasets:manage'),
  validate(idSchema),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: { dataset: await service.sealDataset(req.validated.params.id, req.user) },
      });
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;
