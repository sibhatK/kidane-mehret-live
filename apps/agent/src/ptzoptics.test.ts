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

afterEach(() => vi.unstubAllGlobals())

describe('PTZOptics preset recall', () => {
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
