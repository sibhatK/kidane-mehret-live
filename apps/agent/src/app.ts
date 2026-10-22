import Fastify, { type FastifyError } from 'fastify'
import {
  canExecute,
  commandSchema,
  audioMetersSchema,
  statusSchema,
  type Status,
} from '@kidane/shared'
import { createMockAdapters, type Adapters } from './adapters.js'

export function buildApp(adapters: Adapters = createMockAdapters()) {
  const app = Fastify({ logger: false, bodyLimit: 4096 })
  let commandPending = false

  async function getStatus(): Promise<Status> {
    const [camera, audio, obs, broadcast] = await Promise.all([
      adapters.camera.getStatus(),
      adapters.audio.getStatus(),
      adapters.obs.getStatus(),
      adapters.obs.getBroadcastStatus(),
    ])
    return statusSchema.parse({
      mode: adapters.mode,
      camera,
      audio,
      obs,
      broadcast,
    })
  }

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
  })

  app.addHook('onClose', async () => adapters.obs.close())

  app.get<{ Reply: Status }>('/api/status', async () => getStatus())

  app.get('/api/obs/audio-meters', async (_request, reply) => {
    if (adapters.mode !== 'obs') {
      return reply.code(404).send({ error: 'OBS meters are unavailable' })
    }
    return audioMetersSchema.parse(await adapters.obs.getAudioMeters())
  })

  app.post('/api/commands', async (request, reply) => {
    const parsed = commandSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid command' })
    }
    if (commandPending) {
      return reply.code(409).send({ error: 'Another command is pending' })
    }
    commandPending = true
    try {
      const status = await getStatus()
      const command = parsed.data
      if (!canExecute(status, command)) {
        return reply.code(409).send({ error: 'Command is not available' })
      }
      if (command.type === 'preset') {
        await adapters.camera.selectPreset(command.preset)
      } else {
        switch (command.action) {
          case 'prepare':
            await adapters.obs.prepare()
            break
          case 'go-live':
            await adapters.obs.startStream()
            break
          case 'end':
            await adapters.obs.end()
            break
        }
      }
      return await getStatus()
    } finally {
      commandPending = false
    }
  })

  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    // Never send adapter errors (which may eventually contain credentials) to clients.
    const code =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500
    reply.code(code).send({ error: 'Agent could not complete the request' })
  })
  return app
}
