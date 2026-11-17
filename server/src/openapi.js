const fs = require('node:fs');
const path = require('node:path');

function documentedError(description) {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
    },
  };
}

const apiDocumentation = fs.readFileSync(
  path.resolve(__dirname, '../../docs/API.md'),
  'utf8',
);
const paths = {};

for (const line of apiDocumentation.split(/\r?\n/)) {
  const cells = line.split('|').map((cell) => cell.trim());
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(cells[1])) continue;
  const routePath = cells[2]?.match(/^`([^`]+)`$/)?.[1];
  if (!routePath) continue;

  const method = cells[1].toLowerCase();
  const access = cells[3] || 'Authenticated';
  const behavior = cells[4] || 'See API documentation.';
  const openApiPath = routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  const pathParameters = [...openApiPath.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  const operation = {
    tags: [routePath.split('/')[2] || 'API'],
    summary: `${cells[1]} ${routePath}`,
    description: `Access: ${access}\n\n${behavior}`,
    operationId: `${method}_${routePath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    parameters: pathParameters,
    responses: {
      '200': {
        description: 'Successful response',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } },
      },
      '201': {
        description: 'Resource created',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } },
      },
      '204': { description: 'Request completed without a response body' },
      '400': documentedError('Validation error'),
      '401': documentedError('Authentication required'),
      '403': documentedError('Role or ownership check failed'),
      '404': documentedError('Resource not found'),
      '409': documentedError('Conflict with current resource state'),
      '413': documentedError('Upload or request body exceeds the allowed size'),
      '422': documentedError('Request could not be processed'),
      '429': documentedError('Rate limit exceeded'),
      '502': documentedError('External verification provider failed'),
      '503': documentedError('Research governance or required service configuration is unavailable'),
      '500': documentedError('Internal server error'),
    },
  };
  if (
    !/\bpublic\b|\bunauthenticated\b/i.test(access)
    && routePath !== '/api/auth/refresh-token'
  ) {
    operation.security = [{ bearerAuth: [] }];
  }
  if (method !== 'get' && method !== 'delete') {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: true },
        },
        'multipart/form-data': {
          schema: { type: 'object', additionalProperties: true },
        },
      },
    };
  }
  paths[openApiPath] = { ...(paths[openApiPath] || {}), [method]: operation };
}

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Aarogya Drishti Demonstration API',
    version: '0.1.0',
    description: 'Generated from docs/API.md. See the documented route inventory before deployment.',
  },
  servers: [{ url: '/' }],
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      SuccessEnvelope: {
        type: 'object',
        required: ['success', 'message', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { description: 'Endpoint-specific response object' },
          meta: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['success', 'message', 'errors', 'code'],
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
          errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
          code: { type: 'string' },
        },
      },
    },
  },
};
