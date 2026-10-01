import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node', coverage: { reporter: ['text', 'html'] } },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
