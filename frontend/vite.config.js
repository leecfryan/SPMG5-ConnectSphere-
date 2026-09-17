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
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
  },
})
