import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    clearMocks: true,
    restoreMocks: true,
  },
})
