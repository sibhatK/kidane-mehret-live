import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cameraConfig,
  createPtzOpticsAdapter,
  type CameraConfig,
} from './ptzoptics.js'

const config: CameraConfig = {
  origin: 'http://192.168.100.76',
  presets: { Wide: 7 },
  confirmed: true,
  algorithm: 'SHA-256',
}
const info = () =>
  new Response(
    JSON.stringify({ status: 200, data: { devname: 'ptzopticsmove4k' } }),
  )

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PTZOptics preset recall', () => {
  it.each([
    ['left', 'left&1&1'],
    ['right', 'right&1&1'],
    ['up', 'up&1&1'],
    ['down', 'down&1&1'],
    ['zoom-in', 'zoomin&1'],
    ['zoom-out', 'zoomout&1'],
  ] as const)(
    'sends one slow %s nudge and automatically stops both motion types',
    async (action, path) => {
      const send = vi.fn(async (url: string) =>
        url.includes('get_device_conf') ? info() : new Response('OK'),
      )
      const adapter = createPtzOpticsAdapter(
        { ...config, manualEnabled: true },
        send,
      )
      await adapter.nudge(action)
      expect(send.mock.calls.map((call) => call[0])).toEqual([
        `${config.origin}/cgi-bin/param.cgi?get_device_conf`,
        `${config.origin}/cgi-bin/ptzctrl.cgi?ptzcmd&${path}`,
        `${config.origin}/cgi-bin/ptzctrl.cgi?ptzcmd&ptzstop&0&0`,
        `${config.origin}/cgi-bin/ptzctrl.cgi?ptzcmd&zoomstop`,
      ])
      expect(await adapter.getStatus()).toMatchObject({
        manualEnabled: true,
        manualState: 'idle',
        preset: null,
      })
    },
  )

  it('keeps manual movement opt-in but still permits Stop without a connectivity inquiry', async () => {
    const send = vi.fn(async () => new Response('OK'))
    const adapter = createPtzOpticsAdapter(config, send)
    await expect(adapter.nudge('left')).rejects.toThrow('not available')
    expect(send).not.toHaveBeenCalled()
    await adapter.stop()
    expect(send).toHaveBeenCalledTimes(2)
    expect(
      send.mock.calls.every(
        (call) => !String(call[0]).includes('get_device_conf'),
      ),
    ).toBe(true)
    expect(cameraConfig({ PTZ_CAMERA_URL: config.origin })?.manualEnabled).toBe(
      false,
    )
    expect(
      cameraConfig({
        PTZ_CAMERA_URL: config.origin,
        PTZ_MANUAL_ENABLED: 'true',
      })?.manualEnabled,
    ).toBe(true)
    expect(() =>
      cameraConfig({
        PTZ_CAMERA_URL: config.origin,
        PTZ_MANUAL_ENABLED: 'yes',
      }),
    ).toThrow()
  })

  it('cancels a nudge waiting on inquiry when emergency Stop arrives', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const send = vi.fn(async (url: string) => {
      if (url.includes('get_device_conf')) {
        entered()
        await gate
        return info()
      }
      return new Response('OK')
    })
    const adapter = createPtzOpticsAdapter(
      { ...config, manualEnabled: true },
      send,
    )
    const moving = adapter.nudge('left')
    const rejected = expect(moving).rejects.toThrow('cancelled')
    await started
    await adapter.stop()
    release()
    await rejected
    expect(send.mock.calls.some((call) => call[0].includes('left&'))).toBe(
      false,
    )
  })

  it('preempts an in-flight movement, sends Stop, and never retries the move', async () => {
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const send = vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes('get_device_conf')) return info()
      if (url.includes('zoomin')) {
        entered()
        return new Promise<Response>((_resolve, reject) =>
          options.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          ),
        )
      }
      return new Response('OK')
    })
    const adapter = createPtzOpticsAdapter(
      { ...config, manualEnabled: true },
      send,
    )
    const moving = adapter.nudge('zoom-in')
    const rejected = expect(moving).rejects.toThrow('could not be confirmed')
    await started
    await adapter.stop()
    await rejected
    expect(
      send.mock.calls.filter((call) => call[0].includes('zoomin')),
    ).toHaveLength(1)
    expect(send.mock.calls.some((call) => call[0].includes('zoomstop'))).toBe(
      true,
    )
    expect((await adapter.getStatus()).manualState).toBe('idle')
  })

  it('attempts automatic Stop when movement acknowledgement times out', async () => {
    const send = vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes('get_device_conf')) return info()
      if (url.includes('left&'))
        return new Promise<Response>((_resolve, reject) =>
          options.signal?.addEventListener(
            'abort',
            () => reject(new Error('timeout')),
            { once: true },
          ),
        )
      return new Response('OK')
    })
    const adapter = createPtzOpticsAdapter(
      { ...config, manualEnabled: true },
      send,
      20,
    )
    await expect(adapter.nudge('left')).rejects.toThrow(
      'could not be confirmed',
    )
    expect(
      send.mock.calls.filter((call) => call[0].includes('left&')),
    ).toHaveLength(1)
    expect(
      send.mock.calls.filter((call) => call[0].includes('stop')),
    ).toHaveLength(2)
  })

  it('blocks new movement after unconfirmed Stop and recovers only after Stop succeeds', async () => {
    let failStop = true
    const send = vi.fn(async (url: string) => {
      if (url.includes('get_device_conf')) return info()
      if (url.includes('stop') && failStop) throw new Error('camera offline')
      return new Response('OK')
    })
    const adapter = createPtzOpticsAdapter(
      { ...config, manualEnabled: true },
      send,
    )
    await expect(adapter.nudge('up')).rejects.toThrow('Stop was not confirmed')
    expect((await adapter.getStatus()).manualState).toBe('stop-unconfirmed')
    const count = send.mock.calls.length
    await expect(adapter.nudge('right')).rejects.toThrow('not available')
    await expect(adapter.selectPreset('Wide')).rejects.toThrow(
      'Stop the camera',
    )
    expect(send).toHaveBeenCalledTimes(count)
    failStop = false
    await adapter.stop()
    expect((await adapter.getStatus()).manualState).toBe('idle')
  })

  it('attempts Stop on shutdown during an active nudge and refuses later movement', async () => {
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const send = vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes('get_device_conf')) return info()
      if (url.includes('down&')) {
        entered()
        return new Promise<Response>((_resolve, reject) =>
          options.signal?.addEventListener(
            'abort',
            () => reject(new Error('shutdown')),
            { once: true },
          ),
        )
      }
      return new Response('OK')
    })
    const adapter = createPtzOpticsAdapter(
      { ...config, manualEnabled: true },
      send,
    )
    const moving = adapter.nudge('down')
    const rejected = expect(moving).rejects.toThrow()
    await started
    await adapter.close()
    await rejected
    await expect(adapter.nudge('down')).rejects.toThrow('not available')
    expect(send.mock.calls.some((call) => call[0].includes('ptzstop'))).toBe(
      true,
    )
  })

  it.each(['SHA-256', 'MD5'] as const)(
    'handles a %s Digest challenge without exposing camera credentials',
    async (algorithm) => {
      const requests = vi.fn(async (_url: string, options: RequestInit) => {
        const authorization = new Headers(options.headers).get('Authorization')
        if (!authorization)
          return new Response('', {
            status: 401,
            headers: {
              'WWW-Authenticate': `Digest realm="camera", nonce="fixture-nonce", qop="auth", algorithm=${algorithm}`,
            },
          })
        expect(authorization).toContain(`algorithm=${algorithm}`)
        expect(authorization).toContain(
          'uri="/cgi-bin/param.cgi?get_device_conf"',
        )
        expect(authorization).not.toContain('fixture-secret-password')
        return info()
      })
      vi.stubGlobal('fetch', requests)
      const adapter = createPtzOpticsAdapter({
        ...config,
        username: 'fixture-user',
        password: 'fixture-secret-password',
        algorithm,
      })
      const result = await adapter.getStatus()
      expect(result.connection).toBe('connected')
      expect(requests).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(result)).not.toContain('fixture-user')
      expect(JSON.stringify(result)).not.toContain('fixture-secret-password')
    },
  )

  it('does nothing until configured and validates preset mappings without guessing numbers', () => {
    expect(cameraConfig({})).toBeUndefined()
    expect(cameraConfig({ PTZ_CAMERA_URL: config.origin })).toMatchObject({
      presets: {},
      confirmed: false,
    })
    expect(() => cameraConfig({ PTZ_PRESETS_CONFIRMED: 'true' })).toThrow()
    for (const number of [-1, 90, 95, 99, 255, 1.5, '7']) {
      expect(() =>
        cameraConfig({
          PTZ_CAMERA_URL: config.origin,
          PTZ_PRESET_MAP: JSON.stringify({ Wide: number }),
        }),
      ).toThrow()
    }
    for (const number of [0, 89, 100, 254]) {
      expect(
        cameraConfig({
          PTZ_CAMERA_URL: config.origin,
          PTZ_PRESET_MAP: JSON.stringify({ Wide: number }),
        })?.presets.Wide,
      ).toBe(number)
    }
    expect(() =>
      cameraConfig({
        PTZ_CAMERA_URL: config.origin,
        PTZ_CAMERA_USERNAME: 'secret-user',
      }),
    ).toThrow('Invalid PTZ configuration')
    expect(() =>
      cameraConfig({ PTZ_CAMERA_URL: 'http://user:secret@camera/' }),
    ).toThrow('Invalid PTZ configuration')
    expect(() =>
      cameraConfig({ PTZ_CAMERA_URL: `${config.origin}/?command=move` }),
    ).toThrow()
  })

  it('polls only read-only device information and never claims a known camera position', async () => {
    const send = vi.fn().mockImplementation(async () => info())
    const adapter = createPtzOpticsAdapter(config, send)
    const status = await adapter.getStatus()
    expect(status).toEqual({
      connection: 'connected',
      control: 'ptzoptics',
      preset: null,
      availablePresets: ['Wide'],
      lastRequestedPreset: null,
      manualEnabled: false,
      manualState: 'idle',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toBe(
      `${config.origin}/cgi-bin/param.cgi?get_device_conf`,
    )
    expect(send.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    })
    await adapter.getStatus()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('requires confirmed mappings and rejects unmapped labels before any request', async () => {
    const send = vi.fn()
    const adapter = createPtzOpticsAdapter(
      { ...config, confirmed: false },
      send,
    )
    await expect(adapter.selectPreset('Wide')).rejects.toThrow(
      'not been confirmed',
    )
    await expect(
      createPtzOpticsAdapter(config, send).selectPreset('Reader'),
    ).rejects.toThrow('not been confirmed')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends only the mapped recall and records acknowledgement, not arrival', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(info())
      .mockResolvedValueOnce(new Response('OK'))
    const adapter = createPtzOpticsAdapter(config, send)
    await adapter.selectPreset('Wide')
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      `${config.origin}/cgi-bin/param.cgi?get_device_conf`,
      `${config.origin}/cgi-bin/ptzctrl.cgi?ptzcmd&poscall&7`,
    ])
    expect(await adapter.getStatus()).toMatchObject({
      preset: null,
      lastRequestedPreset: 'Wide',
    })
  })

  it.each([401, 404, 503])(
    'keeps control disconnected on HTTP %s and sends no movement',
    async (code) => {
      const send = vi
        .fn()
        .mockResolvedValue(
          new Response('secret-camera-error', { status: code }),
        )
      const adapter = createPtzOpticsAdapter(config, send)
      expect((await adapter.getStatus()).connection).toBe('disconnected')
      await expect(adapter.selectPreset('Wide')).rejects.toThrow('unavailable')
      expect(
        send.mock.calls.every((call) =>
          String(call[0]).includes('get_device_conf'),
        ),
      ).toBe(true)
    },
  )

  it('rejects HTML login pages and malformed device replies even with HTTP 200', async () => {
    for (const body of [
      '<html>login</html>',
      '{}',
      'OK',
      '{"status":401,"data":{}}',
    ]) {
      const send = vi.fn().mockResolvedValue(new Response(body))
      expect(
        (await createPtzOpticsAdapter(config, send).getStatus()).connection,
      ).toBe('disconnected')
    }
  })

  it('does not retry an uncertain movement or mark it completed', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(info())
      .mockRejectedValueOnce(new Error('private-network-error'))
    const adapter = createPtzOpticsAdapter(config, send)
    await expect(adapter.selectPreset('Wide')).rejects.toThrow(
      'could not be confirmed',
    )
    expect(send).toHaveBeenCalledTimes(2)
    expect(await adapter.getStatus()).toMatchObject({
      connection: 'disconnected',
      preset: null,
      lastRequestedPreset: null,
    })
  })

  it('aborts a slow camera query without any movement request', async () => {
    const send = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(new Error('timeout')),
            { once: true },
          )
        }),
    )
    const adapter = createPtzOpticsAdapter(config, send, 20)
    expect((await adapter.getStatus()).connection).toBe('disconnected')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
