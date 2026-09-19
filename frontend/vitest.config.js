import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    env: { TZ: 'Asia/Singapore' },
    coverage: { provider: 'v8', include: ['src/**/*.{js,jsx}'] },
    reporters: ['default', ['html', { singleFile: true }]],
  },
}))
