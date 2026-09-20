const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { frontendPort, backendURL } = require('./settings.cjs');

async function main() {
  // Use the actual Vite config and source, with isolated host/port/proxy settings.
  process.env.API_PROXY_TARGET = backendURL;
  const viteEntry = require.resolve('vite', { paths: [path.resolve(__dirname, '../../../frontend')] });
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const root = path.resolve(__dirname, '../../../frontend');
  const server = await createServer({ root, server: { host: '127.0.0.1', port: frontendPort, strictPort: true } });
  await server.listen();
  server.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
}
main().catch((error) => { console.error(error); process.exit(1); });
