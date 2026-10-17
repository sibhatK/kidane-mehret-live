import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  statusSchema,
  type BroadcastAction,
  type BroadcastState,
} from '@kidane/shared'
import { buildApp } from './app.js'
import { createMockAdapters } from './adapters.js'

const apps: ReturnType<typeof buildApp>[] = []
function createApp(adapters = createMockAdapters()) {
  const app = buildApp(adapters)
  apps.push(app)
  return app
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('simulation API', () => {
  it('returns validated, non-cacheable mock status', async () => {
    const response = await createApp().inject('/api/status')
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const status = statusSchema.parse(response.json())
    expect(status.mode).toBe('simulated')
    expect(status.broadcast.state).toBe('idle')
    expect(status.camera.preset).toBe('Wide')
  })

  it('changes each camera preset and completes a simulated broadcast only', async () => {
    const app = createApp()
    for (const preset of ['Wide', 'Altar', 'Reader']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands',
        payload: { type: 'preset', preset },
      })
      expect(response.statusCode).toBe(200)
      expect(statusSchema.parse(response.json()).camera.preset).toBe(preset)
    }
    for (const [action, state] of [
      ['prepare', 'prepared'],
      ['go-live', 'simulating'],
      ['end', 'idle'],
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands',
        payload: { type: 'broadcast', action },
      })
      expect(response.statusCode).toBe(200)
      const status = statusSchema.parse(response.json())
      expect(status.mode).toBe('simulated')
      expect(status.broadcast.state).toBe(state)
    }
  })

  const invalidTransitions: [BroadcastState, BroadcastAction][] = [
    ['idle', 'go-live'],
    ['idle', 'end'],
    ['prepared', 'prepare'],
    ['simulating', 'prepare'],
    ['simulating', 'go-live'],
  ]
  it.each(invalidTransitions)('rejects %s → %s', async (state, action) => {
    const adapters = createMockAdapters()
    if (state !== 'idle') await adapters.obs.prepare()
    if (state === 'simulating') await adapters.obs.startSimulation()
    const response = await createApp(adapters).inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'broadcast', action },
    })
    expect(response.statusCode).toBe(409)
    expect((await adapters.obs.getBroadcastStatus()).state).toBe(state)
  })

  it('can cancel preparation', async () => {
    const adapters = createMockAdapters()
    await adapters.obs.prepare()
    const response = await createApp(adapters).inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'broadcast', action: 'end' },
    })
    expect(statusSchema.parse(response.json()).broadcast.state).toBe('idle')
  })

  it('rejects unknown commands without changing state', async () => {
    const response = await createApp().inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'preset', preset: 'Other' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('keeps malformed JSON and oversized requests as client errors', async () => {
    const app = createApp()
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    })
    expect(malformed.statusCode).toBe(400)
    const oversized = await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { data: 'x'.repeat(5000) },
    })
    expect(oversized.statusCode).toBe(413)
  })

  it('rejects overlapping commands rather than racing state transitions', async () => {
    const adapters = createMockAdapters()
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const prepare = adapters.obs.prepare
    adapters.obs.prepare = async () => {
      started()
      await gate
      await prepare()
    }
    const app = createApp(adapters)
    const request = {
      method: 'POST' as const,
      url: '/api/commands',
      payload: { type: 'broadcast', action: 'prepare' },
    }
    const first = app.inject(request).then((response) => response)
    await entered
    try {
      expect((await app.inject(request)).statusCode).toBe(409)
    } finally {
      release()
    }
    expect((await first).statusCode).toBe(200)
  })

  it('blocks preparation if hardware is unavailable', async () => {
    const adapters = createMockAdapters()
    adapters.camera.getStatus = async () => ({
      connection: 'disconnected',
      preset: 'Wide',
    })
    const prepare = vi.spyOn(adapters.obs, 'prepare')
    const response = await createApp(adapters).inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'broadcast', action: 'prepare' },
    })
    expect(response.statusCode).toBe(409)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('redacts adapter failures and releases the command lock', async () => {
    const adapters = createMockAdapters()
    const prepare = vi
      .spyOn(adapters.obs, 'prepare')
      .mockRejectedValueOnce(new Error('private-adapter-value'))
    const app = createApp(adapters)
    const request = {
      method: 'POST' as const,
      url: '/api/commands',
      payload: { type: 'broadcast', action: 'prepare' },
    }
    const response = await app.inject(request)
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('private-adapter-value')
    prepare.mockRestore()
    expect((await app.inject(request)).statusCode).toBe(200)
  })

  it('isolates state between agent instances', async () => {
    const app = createApp()
    await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'preset', preset: 'Reader' },
    })
    const other = await createApp().inject('/api/status')
    expect(statusSchema.parse(other.json()).camera.preset).toBe('Wide')
  })
})
