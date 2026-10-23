import { fileURLToPath } from 'node:url'
import { buildApp } from './app.js'
import { createConfiguredAdapters } from './adapters.js'

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const adapters = createConfiguredAdapters()
const app = buildApp(adapters)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1
    })
  })
}

try {
  await app.listen({ port: 3001, host: '127.0.0.1' })
  console.info(
    `${adapters.mode === 'obs' ? 'OBS control' : 'Simulation'} agent listening at http://127.0.0.1:3001`,
  )
} catch {
  console.error('Unable to start simulation agent on port 3001')
  process.exitCode = 1
}
