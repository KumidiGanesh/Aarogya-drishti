const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/app');

const expectedCount = 118;
const apiDocumentation = fs.readFileSync(path.resolve(__dirname, '../../docs/API.md'), 'utf8');

function normalize(routePath) {
  const cleanPath = `/${routePath}`.replace(/\/+/g, '/');
  return cleanPath.length > 1 ? cleanPath.replace(/\/$/, '') : cleanPath;
}

function mountPath(layer) {
  const source = layer.regexp?.source;
  if (!source || !source.startsWith('^')) return '';
  const lookahead = source.indexOf('(?=');
  if (lookahead < 0) return '';
  let fragment = source.slice(1, lookahead);
  if (fragment.endsWith('\\/?')) fragment = fragment.slice(0, -3);
  return fragment.replaceAll('\\/', '/');
}

function joinPath(prefix, child) {
  return normalize(`${prefix}/${child === '/' ? '' : child}`);
}

function enumerate(stack, prefix = '', result = new Set()) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (!enabled) continue;
          const fullPath = joinPath(prefix, routePath);
          if (fullPath.startsWith('/api/')) result.add(`${method.toUpperCase()} ${fullPath}`);
        }
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      enumerate(layer.handle.stack, joinPath(prefix, mountPath(layer)), result);
    }
  }
  return result;
}

const expected = new Set(
  apiDocumentation
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*`([^`]+)`/))
    .filter(Boolean)
    .map(([, method, routePath]) => `${method} ${normalize(routePath)}`),
);
const actual = enumerate(app._router.stack);
const missing = [...expected].filter((route) => !actual.has(route)).sort();
const undocumented = [...actual].filter((route) => !expected.has(route)).sort();

if (
  actual.size !== expectedCount ||
  expected.size !== expectedCount ||
  missing.length ||
  undocumented.length
) {
  console.error(
    `Route check failed: ${actual.size}/${expectedCount} registered; ${expected.size} documented in Appendix A.`,
  );
  if (missing.length) console.error(`Documented but unregistered:\n${missing.join('\n')}`);
  if (undocumented.length)
    console.error(`Registered but undocumented:\n${undocumented.join('\n')}`);
  if (expected.size !== expectedCount) {
    console.error(
      `Appendix A is missing ${expectedCount - expected.size} specified method/path entries.`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(`Route check passed: ${expectedCount}/${expectedCount} registered routes match Appendix A.`);
}
