import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// The renderer imports shared code as @shared, the same as electron.vite.config.ts.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
})
