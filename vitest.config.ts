import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
