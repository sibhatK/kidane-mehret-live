import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OBSWebSocket } from 'obs-websocket-js'
import { request as httpRequest } from 'node:http'
import {
  statusSchema,
  type BroadcastAction,
  type BroadcastState,
  type CameraSource,
} from '@kidane/shared'
import { buildApp } from './app.js'
import {
  createConfiguredAdapters,
  createMockAdapters,
  createObsAdapters,
} from './adapters.js'
import { createPtzOpticsAdapter } from './ptzoptics.js'

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
  it('allows camera Stop immediately while a normal command is busy and does not query OBS', async () => {
    const adapters = createMockAdapters()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    adapters.obs.prepare = async () => {
      entered()
      await gate
    }
    const stop = vi.spyOn(adapters.camera, 'stop')
    const status = vi.spyOn(adapters.obs, 'getStatus')
    const app = createApp(adapters)
    const first = app
      .inject({
        method: 'POST',
        url: '/api/commands',
        payload: { type: 'broadcast', action: 'prepare' },
      })
      .then((response) => response)
    await started
    const count = status.mock.calls.length
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands',
        payload: { type: 'ptz', action: 'stop' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ acknowledged: true })
      expect(status).toHaveBeenCalledTimes(count)
      expect(stop).toHaveBeenCalledTimes(1)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/commands',
            payload: { type: 'ptz', action: 'left', confirmed: true },
          })
        ).statusCode,
      ).toBe(409)
    } finally {
      release()
    }
    await first
  })

  it('cancels camera movement still waiting on API preflight when Stop arrives', async () => {
    const adapters = createMockAdapters()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = adapters.camera.getStatus
    adapters.camera.getStatus = async () => {
      entered()
      await gate
      return original()
    }
    const nudge = vi.spyOn(adapters.camera, 'nudge')
    const app = createApp(adapters)
    const first = app
      .inject({
        method: 'POST',
        url: '/api/commands',
        payload: { type: 'ptz', action: 'left', confirmed: true },
      })
      .then((response) => response)
    await started
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/commands',
            payload: { type: 'ptz', action: 'stop' },
          })
        ).statusCode,
      ).toBe(200)
    } finally {
      release()
    }
    expect((await first).statusCode).toBe(409)
    expect(nudge).not.toHaveBeenCalled()
  })

  it('reports failed Stop as an error instead of acknowledging it', async () => {
    const adapters = createMockAdapters()
    vi.spyOn(adapters.camera, 'stop').mockRejectedValue(
      new Error('private-stop-error'),
    )
    const response = await createApp(adapters).inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'ptz', action: 'stop' },
    })
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('acknowledged')
    expect(response.body).not.toContain('private-stop-error')
  })

  it('attempts camera Stop when a client disconnects during an adjustment', async () => {
    const adapters = createMockAdapters()
    let entered!: () => void
    let release!: () => void
    let stopped!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stopReceived = new Promise<void>((resolve) => {
      stopped = resolve
    })
    adapters.camera.nudge = async () => {
      entered()
      await gate
    }
    const stop = vi
      .spyOn(adapters.camera, 'stop')
      .mockImplementation(async () => {
        stopped()
        release()
      })
    const app = createApp(adapters)
    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const client = httpRequest(`${address}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    client.on('error', () => undefined)
    client.end(JSON.stringify({ type: 'ptz', action: 'left', confirmed: true }))
    await started
    client.destroy()
    await stopReceived
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('switches simulated camera sources without starting or stopping any stream', async () => {
    const adapters = createMockAdapters()
    const start = vi.spyOn(adapters.obs, 'startStream')
    const stop = vi.spyOn(adapters.obs, 'end')
    const app = createApp(adapters)
    expect((await app.inject('/api/status')).json().obs.scenes.active).toBe(
      'main',
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'scene', source: 'congregation' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().obs.scenes.active).toBe('congregation')
    expect(response.json().broadcast.state).toBe('idle')
    expect(start).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('keeps physical preset recall opt-in and rejects camera configuration without OBS mode', () => {
    expect(createConfiguredAdapters({}).mode).toBe('simulated')
    expect(() =>
      createConfiguredAdapters({ PTZ_CAMERA_URL: 'http://192.168.100.76' }),
    ).toThrow('Configure OBS WebSocket')
    const configured = createConfiguredAdapters({
      OBS_WEBSOCKET_URL: 'ws://127.0.0.1:4455',
      OBS_WEBSOCKET_PASSWORD: 'fixture-password',
    })
    expect(configured.mode).toBe('obs')
  })

  it('requires confirmed mapped recalls at the API boundary without touching broadcast controls', async () => {
    const send = vi.fn(
      async (url: string) =>
        new Response(
          url.includes('get_device_conf')
            ? JSON.stringify({
                status: 200,
                data: { devname: 'ptzopticsmove4k' },
              })
            : 'OK',
        ),
    )
    const adapters = createMockAdapters()
    adapters.mode = 'obs'
    adapters.camera = createPtzOpticsAdapter(
      {
        origin: 'http://192.168.100.76',
        presets: { Wide: 7 },
        confirmed: true,
        algorithm: 'SHA-256',
      },
      send,
    )
    const startStream = vi.spyOn(adapters.obs, 'startStream')
    const stopStream = vi.spyOn(adapters.obs, 'end')
    const app = createApp(adapters)
    for (const payload of [
      { type: 'preset', preset: 'Wide' },
      { type: 'preset', preset: 'Wide', confirmed: false },
      { type: 'preset', preset: 'Reader', confirmed: true },
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: '/api/commands', payload }))
          .statusCode,
      ).toBe(409)
    }
    expect(send.mock.calls.every((call) => !call[0].includes('poscall'))).toBe(
      true,
    )
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: {
            type: 'preset',
            preset: 'Wide',
            confirmed: true,
            presetNumber: 90,
          },
        })
      ).statusCode,
    ).toBe(400)
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'preset', preset: 'Wide', confirmed: true },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().camera).toMatchObject({
      preset: null,
      lastRequestedPreset: 'Wide',
    })
    expect(
      send.mock.calls.filter((call) => call[0].includes('poscall')),
    ).toHaveLength(1)
    expect(startStream).not.toHaveBeenCalled()
    expect(stopStream).not.toHaveBeenCalled()
    expect(response.body).not.toContain('192.168.100.76')
  })

  it('redacts camera errors and serializes overlapping real recall commands', async () => {
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const send = vi.fn(async (url: string) => {
      if (url.includes('get_device_conf'))
        return new Response(
          JSON.stringify({ status: 200, data: { devname: 'ptzopticsmove4k' } }),
        )
      entered()
      await gate
      throw new Error('private-camera-password')
    })
    const adapters = createMockAdapters()
    adapters.mode = 'obs'
    adapters.camera = createPtzOpticsAdapter(
      {
        origin: 'http://192.168.100.76',
        presets: { Wide: 7 },
        confirmed: true,
        algorithm: 'SHA-256',
      },
      send,
    )
    const app = createApp(adapters)
    const request = {
      method: 'POST' as const,
      url: '/api/commands',
      payload: { type: 'preset', preset: 'Wide', confirmed: true },
    }
    const first = app.inject(request).then((response) => response)
    await started
    try {
      expect((await app.inject(request)).statusCode).toBe(409)
    } finally {
      release()
    }
    const response = await first
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('private-camera-password')
    expect(
      send.mock.calls.filter((call) => call[0].includes('poscall')),
    ).toHaveLength(1)
  })

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
    if (state === 'simulating') await adapters.obs.startStream()
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

  it('does not expose OBS media endpoints in simulation mode', async () => {
    const app = createApp()
    expect((await app.inject('/api/obs/audio-meters')).statusCode).toBe(404)
    expect((await app.inject('/api/obs/preview')).statusCode).toBe(404)
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

  it('controls OBS only after explicit confirmation and reports actual stream state', async () => {
    let connected = false
    let streamActive = false
    const calls: string[] = []
    const listeners = new Map<string, (event: unknown) => void>()
    const client = {
      get identified() {
        return connected
      },
      async connect() {
        connected = true
      },
      async disconnect() {
        connected = false
      },
      on(eventName: string, listener: (event: unknown) => void) {
        listeners.set(eventName, listener)
      },
      async call(request: string) {
        calls.push(request)
        if (request === 'GetStreamStatus') {
          return { outputActive: streamActive }
        }
        if (request === 'GetRecordStatus') {
          return { outputActive: true }
        }
        if (request === 'StartStream') streamActive = true
        if (request === 'StopStream') streamActive = false
        return {}
      },
    } as unknown as OBSWebSocket
    const adapters = createObsAdapters(
      'ws://127.0.0.1:4455',
      'test-password',
      client,
    )
    adapters.camera.getStatus = async () => ({
      connection: 'disconnected',
      preset: 'Wide',
    })
    adapters.audio.getStatus = async () => ({
      connection: 'disconnected',
      muted: true,
    })
    const app = createApp(adapters)

    const before = statusSchema.parse((await app.inject('/api/status')).json())
    expect(before.mode).toBe('obs')
    expect(before.obs.recording).toBe(true)
    expect(before.camera.connection).toBe('disconnected')

    listeners.get('InputVolumeMeters')?.({
      inputs: [
        {
          inputName: 'Mixer Input',
          inputLevelsDb: [
            [-18, -24],
            [-30, -40],
          ],
        },
      ],
    })
    const meters = await app.inject('/api/obs/audio-meters')
    expect(meters.json()).toMatchObject([
      { inputName: 'Mixer Input', level: 0.7, peakDb: -18 },
    ])

    listeners.get('InputVolumeMeters')?.({
      inputs: [
        {
          inputName: 'Silent Input',
          inputLevelsDb: [[Number.NEGATIVE_INFINITY]],
        },
      ],
    })
    const silentMeters = await app.inject('/api/obs/audio-meters')
    expect(silentMeters.json()).toMatchObject([
      { inputName: 'Silent Input', level: 0, peakDb: -60 },
    ])

    listeners.get('InputVolumeMeters')?.({
      inputs: [
        {
          inputName: 'Multiplier Input',
          inputLevelsDb: [[Number.NEGATIVE_INFINITY]],
          inputLevelsMul: { left: [0.5], right: [0.25] },
        },
      ],
    })
    const multiplierMeters = await app.inject('/api/obs/audio-meters')
    const multiplierMeter = multiplierMeters.json()[0]
    expect(multiplierMeter.inputName).toBe('Multiplier Input')
    expect(multiplierMeter.peakDb).toBeCloseTo(-6.02)
    expect(multiplierMeter.level).toBeGreaterThan(0.89)

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'broadcast', action: 'prepare' },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'broadcast', action: 'go-live' },
        })
      ).statusCode,
    ).toBe(409)
    expect(calls).not.toContain('StartStream')

    const started = await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: {
        type: 'broadcast',
        action: 'go-live',
        confirmed: true,
      },
    })
    expect(statusSchema.parse(started.json()).broadcast.state).toBe('streaming')
    expect(calls).toContain('StartStream')

    const ended = await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'broadcast', action: 'end', confirmed: true },
    })
    expect(statusSchema.parse(ended.json()).broadcast.state).toBe('idle')
    expect(calls).toContain('StopStream')
  })
})

describe('OBS program scene switching', () => {
  function fixture(
    names: Partial<Record<CameraSource, string>> = {
      main: 'Main Camera OBS',
      congregation: 'Congregation OBS',
    },
  ) {
    const state = {
      current: 'Main Camera OBS',
      preview: 'Congregation OBS',
      scenes: ['Main Camera OBS', 'Congregation OBS'],
      listFails: false,
      switchFails: false,
      noChange: false,
    }
    const calls: string[] = []
    const switched = vi.fn((sceneName: string) => {
      if (!state.noChange) state.current = sceneName
      if (state.switchFails) throw new Error('private-obs-scene-error')
    })
    const client = {
      identified: true,
      on() {},
      async connect() {},
      async disconnect() {},
      async call(request: string, data?: { sceneName: string }) {
        calls.push(request)
        if (request === 'GetStreamStatus') return { outputActive: true }
        if (request === 'GetRecordStatus') return { outputActive: true }
        if (request === 'GetSceneList') {
          if (state.listFails) throw new Error('private-scene-list-error')
          return {
            currentProgramSceneName: state.current,
            currentPreviewSceneName: state.preview,
            scenes: state.scenes.map((sceneName) => ({ sceneName })),
          }
        }
        if (request === 'SetCurrentProgramScene') {
          switched(data!.sceneName)
          return {}
        }
        throw new Error('Unexpected OBS request')
      },
    } as unknown as OBSWebSocket
    const adapters = createObsAdapters(
      'ws://127.0.0.1:4455',
      'fixture-password',
      client,
      names,
    )
    return { state, calls, switched, adapters, app: createApp(adapters) }
  }

  it('switches program output, not Studio Mode preview, and leaves streaming/recording unchanged', async () => {
    const { app, state, calls, switched } = fixture()
    const before = (await app.inject('/api/status')).json()
    expect(before.obs.scenes).toEqual({
      connection: 'connected',
      configured: ['main', 'congregation'],
      available: ['main', 'congregation'],
      active: 'main',
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/commands',
      payload: { type: 'scene', source: 'congregation', confirmed: true },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().obs.scenes.active).toBe('congregation')
    expect(response.json().broadcast.state).toBe('streaming')
    expect(response.json().obs.recording).toBe(true)
    expect(switched).toHaveBeenCalledExactlyOnceWith('Congregation OBS')
    expect(state.current).toBe('Congregation OBS')
    expect(calls.filter((call) => !call.startsWith('Get'))).toEqual([
      'SetCurrentProgramScene',
    ])
    state.current = 'Opening slide'
    expect(
      (await app.inject('/api/status')).json().obs.scenes.active,
    ).toBeNull()
  })

  it('rejects unconfirmed and arbitrary scene requests without switching', async () => {
    const { app, switched } = fixture()
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'scene', source: 'congregation' },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'scene', source: 'other', confirmed: true },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: {
            type: 'scene',
            source: 'main',
            sceneName: 'Other Scene',
            confirmed: true,
          },
        })
      ).statusCode,
    ).toBe(400)
    expect(switched).not.toHaveBeenCalled()
  })

  it('does not guess mappings or query scenes before they are configured', async () => {
    const { app, calls, switched } = fixture({})
    const status = (await app.inject('/api/status')).json()
    expect(status.obs.scenes.available).toEqual([])
    expect(status.obs.scenes.active).toBeNull()
    expect(calls).not.toContain('GetSceneList')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'scene', source: 'main', confirmed: true },
        })
      ).statusCode,
    ).toBe(409)
    expect(switched).not.toHaveBeenCalled()
  })

  it('disables missing scenes instead of creating them and avoids switching an already active scene', async () => {
    const { app, state, switched } = fixture()
    state.scenes = ['Main Camera OBS']
    expect(
      (await app.inject('/api/status')).json().obs.scenes.available,
    ).toEqual(['main'])
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'scene', source: 'congregation', confirmed: true },
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'scene', source: 'main', confirmed: true },
        })
      ).statusCode,
    ).toBe(200)
    expect(switched).not.toHaveBeenCalled()
  })

  it('treats scene-list failure separately from an otherwise connected OBS stream', async () => {
    const { app, state, switched } = fixture()
    state.listFails = true
    const response = await app.inject('/api/status')
    expect(response.statusCode).toBe(200)
    expect(response.json().obs.connection).toBe('connected')
    expect(response.json().obs.scenes).toMatchObject({
      connection: 'disconnected',
      active: null,
      available: [],
    })
    expect(response.body).not.toContain('private-scene-list-error')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/commands',
          payload: { type: 'scene', source: 'main', confirmed: true },
        })
      ).statusCode,
    ).toBe(409)
    expect(switched).not.toHaveBeenCalled()
  })

  it.each(['switchFails', 'noChange'] as const)(
    'does not optimistically select a scene or retry after %s',
    async (failure) => {
      const { app, state, switched } = fixture()
      state[failure] = true
      const response = await app.inject({
        method: 'POST',
        url: '/api/commands',
        payload: { type: 'scene', source: 'congregation', confirmed: true },
      })
      expect(response.statusCode).toBe(500)
      expect(response.body).not.toContain('private-obs-scene-error')
      expect(switched).toHaveBeenCalledTimes(1)
      expect((await app.inject('/api/status')).json().obs.scenes.active).toBe(
        failure === 'switchFails' ? 'congregation' : 'main',
      )
    },
  )

  it('rejects invalid or duplicate scene mappings without exposing values', () => {
    for (const mappings of [
      { OBS_SCENE_MAIN: '' },
      { OBS_SCENE_MAIN: 'Same', OBS_SCENE_CONGREGATION: 'Same' },
      { OBS_SCENE_MAIN: 'invalid\nname' },
    ]) {
      expect(() =>
        createConfiguredAdapters({
          OBS_WEBSOCKET_URL: 'ws://127.0.0.1:4455',
          OBS_WEBSOCKET_PASSWORD: 'fixture-password',
          ...mappings,
        }),
      ).toThrow()
    }
    expect(() =>
      createConfiguredAdapters({ OBS_SCENE_MAIN: 'Main Camera OBS' }),
    ).toThrow('Configure OBS WebSocket')
  })
})
