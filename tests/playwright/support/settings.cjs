function port(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('Invalid test port: ' + name);
  return value;
}
const frontendPort = port('PW_FRONTEND_PORT', 43173);
const backendPort = port('PW_BACKEND_PORT', 43000);
const authPort = port('PW_AUTH_PORT', 43001);
if (new Set([frontendPort, backendPort, authPort]).size !== 3) throw new Error('Test ports must be distinct.');
module.exports = {
  frontendPort, backendPort, authPort,
  frontendURL: 'http://127.0.0.1:' + frontendPort,
  backendURL: 'http://127.0.0.1:' + backendPort,
  authURL: 'http://127.0.0.1:' + authPort,
  publicKey: 'sb_publishable_local_playwright_fixture',
};
