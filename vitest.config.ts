import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'], environment: 'node',
    // Unit fixtures choose their own origins; do not inherit operator/CI runtime settings.
    env: { CAMPUSPAY_LOCAL_HTTP: 'false', APP_ORIGIN: '', STAFF_ORIGIN: '', STORE_ORIGIN: '', VERCEL: '0', DATABASE_URL_UNPOOLED: '' },
    coverage: { reporter: ['text', 'html'] },
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
