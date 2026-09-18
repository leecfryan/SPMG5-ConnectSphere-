// Spawns the Vite dev server. Playwright passes API_PROXY_TARGET via webServer.env,
// which this process inherits, so vite.config.js picks it up automatically.
const { spawn } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '../../..')
const child = spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', code => process.exit(code ?? 0))
