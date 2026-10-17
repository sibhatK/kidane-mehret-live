import { buildApp } from './app.js'

const app = buildApp()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1
    })
  })
}

try {
  await app.listen({ port: 3001, host: '127.0.0.1' })
  console.info('Simulation agent listening at http://127.0.0.1:3001')
} catch {
  console.error('Unable to start simulation agent on port 3001')
  process.exitCode = 1
}
