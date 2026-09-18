import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vitest/config'
import process from 'node:process'

const proxy = {
  '/api': {
    target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  server: { proxy },
  preview: { proxy },
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    // No DOM here yet: eventsService is plain async code over fetch. Component
    // tests will need environment 'jsdom' and @testing-library/react.
    environment: 'node',
    // `withZonedTimes` converts using whatever zone the browser is in, so an
    // assertion on the ISO it produces only means something against a known
    // offset. Pinned here rather than as a `TZ=` prefix on the npm script so it
    // holds identically on every machine, in CI, and on Windows.
    env: { TZ: 'Asia/Singapore' },
    reporters: ['verbose'],
    coverage: { provider: 'v8', include: ['src/**/*.{js,jsx}'] },
  },
})
