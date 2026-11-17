import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

const languages = ['en', 'te', 'hi', 'or'];
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'silent',
});

try {
  const { resources } = await server.ssrLoadModule('/src/i18n/index.js');
  for (const language of languages) {
    const directory = join(process.cwd(), 'src', 'locales', language);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'translation.json'),
      `${JSON.stringify(resources[language].translation, null, 2)}\n`,
      'utf8',
    );
  }
} finally {
  await server.close();
}
