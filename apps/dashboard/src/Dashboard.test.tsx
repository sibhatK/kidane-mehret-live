import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioMeter, Status } from '@kidane/shared'
import { CameraPreview } from './CameraPreview'
import { Dashboard } from './Dashboard'
import { ManualCameraControls } from './ManualCameraControls'
import { requestCameraStop, requestObsAudioMeters, requestStatus } from './api'

const status: Status = {
  mode: 'simulated',
  camera: { connection: 'connected', preset: 'Altar' },
  audio: { connection: 'connected', muted: false },
  obs: { connection: 'connected', recording: false },
  broadcast: {
    connection: 'connected',
    state: 'idle',
    destination: 'YouTube (simulation only)',
  },
}
const obsStatus: Status = {
  ...status,
  mode: 'obs',
  obs: { connection: 'connected', recording: true },
  broadcast: {
    connection: 'connected',
    state: 'streaming',
    destination: 'OBS output',
  },
}
function render(
  current: Status | null,
  busy = false,
  error: string | null = null,
  audioMeters: AudioMeter[] = [],
) {
  return renderToStaticMarkup(
    createElement(Dashboard, {
      status: current,
      busy,
      loading: false,
      error,
      audioMeters,
      onCommand: vi.fn(),
    }),
  )
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('MediaMTX preview', () => {
  it('shows an unavailable state when no valid preview URL is configured', () => {
    for (const url of [undefined, 'not a URL', 'javascript:alert(1)']) {
      const html = renderToStaticMarkup(createElement(CameraPreview, { url }))
      expect(html).toContain('Picture unavailable')
      expect(html).not.toContain('<iframe')
    }
  })

  it('embeds the MediaMTX player with muted inline autoplay enabled', () => {
    const html = renderToStaticMarkup(
      createElement(CameraPreview, { url: 'http://192.168.1.206:8889/live' }),
    )
    const encodedSrc = html.match(/src="([^"]+)"/)?.[1]
    expect(encodedSrc).toBeDefined()
    const src = new URL(encodedSrc!.replaceAll('&amp;', '&'))
    expect(src.origin).toBe('http://192.168.1.206:8889')
    expect(src.pathname).toBe('/live')
    expect(src.searchParams.get('autoplay')).toBe('true')
    expect(src.searchParams.get('muted')).toBe('true')
    expect(src.searchParams.get('playsinline')).toBe('true')
    expect(html).toContain('allow="autoplay; fullscreen; picture-in-picture"')
  })
})

describe('dashboard safety and controls', () => {
  it('starts manual adjustment locked with accessible icon labels and a usable emergency Stop', () => {
    const current: Status = {
      ...obsStatus,
      camera: {
        connection: 'connected',
        preset: null,
        control: 'ptzoptics',
        manualEnabled: true,
        manualState: 'idle',
      },
    }
    for (const state of [
      { status: current, busy: false },
      { status: current, busy: true },
      { status: null, busy: false },
    ]) {
      const html = renderToStaticMarkup(
        createElement(ManualCameraControls, {
          ...state,
          notice: null,
          onCommand: vi.fn(),
        }),
      )
      expect(html).toContain('Allow camera movement')
      expect(html).not.toContain('checked=""')
      for (const label of [
        'Pan left',
        'Pan right',
        'Tilt up',
        'Tilt down',
        'Zoom in',
        'Zoom out',
      ])
        expect(html).toMatch(
          new RegExp(`aria-label="${label}"[^>]*disabled=""`),
        )
      expect(html).toMatch(/<button[^>]*aria-label="Stop camera"[^>]*>/)
      expect(html).not.toMatch(
        /<button[^>]*aria-label="Stop camera"[^>]*disabled/,
      )
    }
  })

  it('shows failed Stop recovery as a danger state rather than movement ready', () => {
    const html = renderToStaticMarkup(
      createElement(ManualCameraControls, {
        status: {
          ...obsStatus,
          camera: {
            connection: 'disconnected',
            preset: null,
            control: 'ptzoptics',
            manualEnabled: true,
            manualState: 'stop-unconfirmed',
          },
        },
        busy: false,
        notice: null,
        onCommand: vi.fn(),
      }),
    )
    expect(html).toContain('Stop not confirmed. Use the physical camera remote')
    expect(html).toContain('data-tone="danger"')
  })
  it('shows the active program source, enables only available scenes, and keeps source controls before the picture', () => {
    const html = render({
      ...obsStatus,
      obs: {
        ...obsStatus.obs,
        scenes: {
          connection: 'connected',
          configured: ['main', 'congregation'],
          available: ['main'],
          active: 'main',
        },
      },
    })
    const group = html.match(
      /<div[^>]*aria-label="Picture source"[\s\S]*?<\/div>/,
    )?.[0]
    expect(group).toContain('Main camera')
    expect(group).toContain('Congregation (iPad)')
    expect(group).toMatch(/aria-pressed="true"[^>]*>Main camera/)
    expect(group).toMatch(/disabled=""[^>]*>Congregation \(iPad\)/)
    expect(html).toContain('Selected in OBS: Main camera')
    expect(html.indexOf('aria-label="Picture source"')).toBeLessThan(
      html.indexOf('class="preview-frame"'),
    )
  })

  it('does not guess a selected source when OBS is showing another scene or disconnects', () => {
    for (const connection of ['connected', 'disconnected'] as const) {
      const html = render({
        ...obsStatus,
        obs: {
          ...obsStatus.obs,
          connection,
          scenes: {
            connection,
            configured: ['main', 'congregation'],
            available:
              connection === 'connected' ? ['main', 'congregation'] : [],
            active: connection === 'connected' ? null : 'main',
          },
        },
      })
      const group = html.match(
        /<div[^>]*aria-label="Picture source"[\s\S]*?<\/div>/,
      )?.[0]
      expect(group).not.toContain('aria-pressed="true"')
      if (connection === 'connected')
        expect(html).toContain('OBS is showing another scene')
      else expect(group?.match(/disabled=""/g)).toHaveLength(2)
    }
  })

  it('leaves both source buttons disabled until scenes are configured', () => {
    const html = render(obsStatus)
    const group = html.match(
      /<div[^>]*aria-label="Picture source"[\s\S]*?<\/div>/,
    )?.[0]
    expect(group?.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('Camera switching needs setup by an operator')
  })

  it('uses semantic connection colors without marking practice or unknown delivery as success', () => {
    const connected = render(obsStatus)
    expect(connected).toMatch(
      /<span[^>]*class="status-badge[^>]*data-tone="success"[^>]*>OBS connected/,
    )
    const disconnected = render({
      ...obsStatus,
      obs: { ...obsStatus.obs, connection: 'disconnected' },
    })
    expect(disconnected).toMatch(
      /<span[^>]*class="status-badge[^>]*data-tone="danger"[^>]*>OBS not connected/,
    )
    expect(disconnected).toContain('Broadcast status unavailable')
    expect(disconnected).not.toContain('Stream stopped in OBS')
    expect(disconnected).toContain('Recording status unknown')
    expect(disconnected).not.toContain('Recording active')
    const offline = render(null, false, 'Connection lost')
    expect(offline).toMatch(
      /<span[^>]*class="status-badge[^>]*data-tone="danger"[^>]*>Connection lost/,
    )
    expect(offline).toMatch(/role="alert"[^>]*data-tone="danger"/)
    const practice = render(status)
    expect(practice).toMatch(
      /<span[^>]*class="status-badge[^>]*data-tone="warning"[^>]*>Practice mode/,
    )
    expect(practice).not.toContain('data-tone="success"')
    expect(connected).toContain('OBS status does not confirm YouTube delivery')
  })

  it.each([
    ['idle', 'neutral'],
    ['prepared', 'success'],
    ['starting', 'warning'],
    ['streaming', 'success'],
  ] as const)(
    'colors broadcast state %s as %s, not every stopped stream as a failure',
    (state, tone) => {
      const html = render({
        ...obsStatus,
        broadcast: { ...obsStatus.broadcast, state },
      })
      const controls = html.slice(
        html.indexOf('aria-labelledby="broadcast-heading"'),
        html.indexOf('<details'),
      )
      expect(
        controls.match(/<p[^>]*role="status"[^>]*data-tone="([^"]+)"/)?.[1],
      ).toBe(tone)
    },
  )

  it.each([
    { peak: undefined, tone: 'warning', text: 'Waiting for sound levels' },
    { peak: -60, tone: 'warning', text: 'No sound detected' },
    { peak: -24, tone: 'success', text: 'Sound detected' },
    { peak: -3, tone: 'warning', text: 'Sound level is high' },
    { peak: 0, tone: 'danger', text: 'Sound may be clipping' },
  ])('pairs sound color with a clear label: %j', ({ peak, tone, text }) => {
    const meters =
      peak === undefined
        ? []
        : [
            {
              inputName: 'Microphone',
              peakDb: peak,
              level: (peak + 60) / 60,
              sampledAt: Date.now(),
            },
          ]
    const html = render(obsStatus, false, null, meters)
    const sound = html.slice(
      html.indexOf('aria-label="Sound levels"'),
      html.indexOf('<details'),
    )
    expect(sound).toContain(text)
    expect(
      sound.match(/<p[^>]*role="status"[^>]*data-tone="([^"]+)"/)?.[1],
    ).toBe(tone)
    if (peak !== undefined && peak > -60)
      expect(sound).toMatch(
        new RegExp(`class="meter-fill" data-tone="${tone}"`),
      )
  })

  it('does not display a green meter from old samples when OBS is disconnected', () => {
    const html = render(
      { ...obsStatus, obs: { ...obsStatus.obs, connection: 'disconnected' } },
      false,
      null,
      [
        {
          inputName: 'Microphone',
          level: 0.6,
          peakDb: -24,
          sampledAt: Date.now(),
        },
      ],
    )
    expect(html).toContain('OBS not connected. Sound levels unavailable.')
    expect(html).not.toContain('class="meter-fill"')
  })

  it.each([
    {
      connection: 'connected' as const,
      presets: ['Wide' as const],
      tone: 'success',
    },
    { connection: 'connected' as const, presets: [], tone: 'warning' },
    {
      connection: 'disconnected' as const,
      presets: ['Wide' as const],
      tone: 'danger',
    },
  ])(
    'colors camera readiness without hiding setup requirements: %j',
    ({ connection, presets, tone }) => {
      const html = render({
        ...obsStatus,
        camera: {
          control: 'ptzoptics',
          connection,
          preset: null,
          availablePresets: presets,
        },
      })
      const card = html.match(
        /<article[^>]*><h2[^>]*>Camera<\/h2>[\s\S]*?<\/article>/,
      )?.[0]
      expect(card).toContain(`data-tone="${tone}"`)
    },
  )

  it.each([
    {
      camera: { connection: 'connected' as const, preset: null },
      expected: 'Camera controls need setup',
    },
    {
      camera: {
        connection: 'disconnected' as const,
        preset: null,
        control: 'ptzoptics' as const,
        availablePresets: [],
      },
      expected: 'Camera not connected',
    },
    {
      camera: {
        connection: 'connected' as const,
        preset: null,
        control: 'ptzoptics' as const,
        availablePresets: [],
      },
      expected: 'Camera connected · shots need setup',
    },
    {
      camera: {
        connection: 'connected' as const,
        preset: null,
        control: 'ptzoptics' as const,
        availablePresets: ['Wide' as const],
      },
      expected: 'Saved shots available',
    },
  ])(
    'distinguishes camera movement setup from video availability: %j',
    ({ camera, expected }) => {
      const html = render({ ...obsStatus, camera })
      const card = html.match(
        /<article[^>]*><h2[^>]*>Camera<\/h2>[\s\S]*?<\/article>/,
      )?.[0]
      expect(card).toBeDefined()
      expect(card).toContain(expected)
      expect(card).not.toContain('Not integrated')
      expect(card).not.toContain('Video connected')
      expect(card).not.toContain('PTZ control not integrated')
    },
  )

  it.each([
    {
      connection: 'connected' as const,
      level: 0.6,
      expected: 'Receiving sound levels',
    },
    {
      connection: 'connected' as const,
      level: 0,
      expected: 'Receiving sound levels',
    },
    {
      connection: 'connected' as const,
      level: undefined,
      expected: 'Waiting for sound levels',
    },
    {
      connection: 'disconnected' as const,
      level: 0.6,
      expected: 'OBS not connected',
    },
  ])(
    'reports OBS meter availability separately from microphone verification: %j',
    ({ connection, level, expected }) => {
      const meters =
        level === undefined
          ? []
          : [
              {
                inputName: 'Microphone',
                level,
                peakDb: level > 0 ? -24 : -60,
                sampledAt: Date.now(),
              },
            ]
      const html = render(
        { ...obsStatus, obs: { ...obsStatus.obs, connection } },
        false,
        null,
        meters,
      )
      const card = html.match(
        /<article[^>]*><h2[^>]*>Audio<\/h2>[\s\S]*?<\/article>/,
      )?.[0]
      expect(card).toBeDefined()
      expect(card).toContain(expected)
      expect(card).toContain('microphone not verified')
      expect(card).not.toContain('Not integrated')
      if (connection === 'disconnected')
        expect(card).not.toContain('Receiving sound levels')
    },
  )

  it.each([
    ['idle', 'Check connection', 1],
    ['prepared', 'Start livestream', 2],
    ['starting', 'Cancel start', 1],
    ['streaming', 'End livestream', 1],
  ] as const)(
    'shows the next real broadcast action in %s without unrelated buttons',
    (state, next, count) => {
      const html = render({
        ...obsStatus,
        broadcast: { ...obsStatus.broadcast, state },
      })
      const controls = html.slice(
        html.indexOf('aria-labelledby="broadcast-heading"'),
        html.indexOf('<details'),
      )
      expect(controls).toContain(next)
      expect(controls.match(/<button/g)).toHaveLength(count)
      expect(controls).not.toContain('Check simulated equipment')
      if (state === 'streaming')
        expect(controls).toContain(
          'Confirm viewers receive picture and sound in YouTube Studio',
        )
    },
  )

  it('does not offer streaming actions without an OBS connection', () => {
    const html = render({
      ...obsStatus,
      obs: { connection: 'disconnected', recording: null },
      broadcast: {
        ...obsStatus.broadcast,
        state: 'idle',
        connection: 'disconnected',
      },
    })
    expect(html).toContain('OBS not connected')
    expect(html).toContain('Open OBS on the Mac to reconnect')
    expect(html).toMatch(/disabled=""[^>]*>Check connection/)
    expect(html).not.toMatch(/<button[^>]*>Start livestream/)
  })

  it('keeps sound levels visible outside setup details', () => {
    const html = render(obsStatus, false, null, [
      {
        inputName: 'Microphone',
        level: 0.5,
        peakDb: -30,
        sampledAt: Date.now(),
      },
    ])
    expect(html).toContain('Sound detected. Confirm the intended microphone.')
    expect(html.indexOf('role="meter"')).toBeLessThan(html.indexOf('<details'))
    expect(html).not.toContain('<audio')
  })

  it('keeps technical device details collapsed by default', () => {
    const html = render(obsStatus)
    expect(html).toContain('Setup details</summary>')
    expect(html).toContain('<details')
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/)
    expect(html.indexOf('aria-labelledby="broadcast-heading"')).toBeLessThan(
      html.indexOf('<details'),
    )
  })

  it('places camera and broadcast controls before device status in both modes', () => {
    for (const current of [status, obsStatus]) {
      const html = render(current)
      const camera = html.indexOf('aria-labelledby="camera-heading"')
      const broadcast = html.indexOf('aria-labelledby="broadcast-heading"')
      const devices = html.indexOf(
        current.mode === 'obs'
          ? 'aria-label="OBS and device status"'
          : 'aria-label="Simulated connection status"',
      )
      expect(camera).toBeGreaterThan(-1)
      expect(broadcast).toBeGreaterThan(camera)
      expect(devices).toBeGreaterThan(broadcast)
    }
  })

  it('enables only mapped physical recalls and never marks an unverified position as selected', () => {
    const html = render({
      ...obsStatus,
      camera: {
        connection: 'connected',
        control: 'ptzoptics',
        preset: null,
        availablePresets: ['Wide'],
        lastRequestedPreset: 'Wide',
      },
    })
    expect(html).toContain('Main camera shots')
    expect(html).toContain('PTZOptics Move 4K · saved shots')
    expect(html).not.toContain('Not integrated')
    expect(html).toContain('Shot requested: Wide')
    expect(html).toContain('does not confirm arrival')
    expect(html).toMatch(/aria-pressed="false">Wide/)
    expect(html).toMatch(/disabled=""[^>]*>Altar/)
    expect(html).toMatch(/disabled=""[^>]*>Reader/)
  })

  it('keeps physical preset buttons disabled with no confirmed mappings or a disconnected camera', () => {
    for (const camera of [
      {
        connection: 'connected' as const,
        control: 'ptzoptics' as const,
        preset: null,
        availablePresets: [],
      },
      {
        connection: 'disconnected' as const,
        control: 'ptzoptics' as const,
        preset: null,
        availablePresets: ['Wide' as const],
      },
    ]) {
      const html = render({ ...obsStatus, camera })
      for (const label of ['Wide', 'Altar', 'Reader'])
        expect(html).toMatch(new RegExp(`disabled=""[^>]*>${label}`))
    }
  })

  it('labels controls as simulated and shows an unavailable preview without configuration', () => {
    const html = render(status)
    expect(html).toContain('Practice mode')
    expect(html.match(/Connected \(mock\)/g)).toHaveLength(4)
    for (const label of ['Wide', 'Altar', 'Reader', 'Check practice setup']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('aria-pressed="true">Altar')
    expect(html).toContain('Picture unavailable')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('<iframe')
  })

  it('shows the OBS snapshot and audio levels without implying mixer mapping or PTZ control', () => {
    vi.stubEnv('VITE_MEDIAMTX_WEBRTC_URL', 'http://192.168.1.206:8889/live')
    const html = render(obsStatus, false, null, [
      {
        inputName: 'Mixer Input',
        level: 0.7,
        peakDb: -18,
        sampledAt: Date.now(),
      },
    ])
    expect(html).toContain('OBS connected')
    expect(html).toContain('OBS is streaming')
    expect(html).toContain('Recording active')
    expect(html).toContain('Mixer Input')
    expect(html).toContain('70')
    expect(html).not.toContain('<audio')
    expect(html).toContain('Broadcast preview')
    expect(html).toContain('Sound levels from OBS · microphone not verified')
    expect(html).toContain('Receiving sound levels')
    expect(html).toContain('Camera movement · preview is separate')
    expect(html).toContain('Camera controls need setup')
    expect(html).toContain('OBS status does not confirm YouTube delivery')
    expect(html).toContain('Sound detected')
    expect(html.indexOf('Sound levels')).toBeLessThan(html.indexOf('<details'))
    expect(html).not.toContain('Connected (mock)')
    expect(html).not.toContain('SIMULATION ONLY')
  })

  it.each([
    ['idle', 'Check practice setup', 1],
    ['prepared', 'Start practice', 2],
    ['simulating', 'End practice', 1],
  ] as const)(
    'shows only relevant broadcast controls in %s',
    (state, next, count) => {
      const html = render({
        ...status,
        broadcast: { ...status.broadcast, state },
      })
      const broadcast = html.slice(
        html.indexOf('aria-labelledby="broadcast-heading"'),
        html.indexOf('<details'),
      )
      expect(broadcast).toContain(next)
      expect(broadcast.match(/<button/g)).toHaveLength(count)
      expect(broadcast).not.toContain('disabled=""')
      if (state === 'simulating') expect(html).toContain('NOT LIVE')
    },
  )

  it('disables all visible controls when offline or a command is pending', () => {
    for (const html of [
      render(null, false, 'Agent unavailable'),
      render(status, true),
    ]) {
      expect(html.match(/disabled=""/g)).toHaveLength(13)
    }
    expect(render(null, false, 'Agent unavailable')).toContain('role="alert"')
    expect(render(null)).toContain('Broadcast status unavailable')
    expect(render(null)).toContain('The broadcast may still be running')
    expect(render(null)).not.toContain('Practice broadcast')
    expect(render(null)).not.toContain('Check practice setup')
    expect(render(null)).toContain('Sound status unavailable')
    expect(render(null)).toContain('Camera status unavailable')
  })
})

describe('validated API client', () => {
  it.each([{}, { acknowledged: false }])(
    'does not treat an invalid Stop reply as success: %j',
    async (body) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(body)))
      vi.stubGlobal('fetch', fetch)
      await expect(requestCameraStop()).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('sends a priority Stop once and validates its acknowledgement without waiting for full status', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ acknowledged: true })))
    vi.stubGlobal('fetch', fetch)
    await expect(requestCameraStop()).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/commands',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'ptz', action: 'stop' }),
        keepalive: true,
      }),
    )
  })

  it.each([
    { type: 'preset' as const, preset: 'Wide' as const, confirmed: true },
    {
      type: 'scene' as const,
      source: 'congregation' as const,
      confirmed: true,
    },
  ])(
    'gives confirmed picture changes a bounded acknowledgement window without retrying: %j',
    async (command) => {
      vi.useFakeTimers()
      const fetch = vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener(
              'abort',
              () => reject(new Error('request aborted')),
              { once: true },
            )
          }),
      )
      vi.stubGlobal('fetch', fetch)
      const request = requestStatus(command)
      const rejected = expect(request).rejects.toThrow('request aborted')
      await vi.advanceTimersByTimeAsync(5000)
      expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(10000)
      await rejected
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('fetches and validates OBS audio meter samples without caching', async () => {
    const meters: AudioMeter[] = [
      { inputName: 'Mixer Input', level: 0.6, peakDb: -24, sampledAt: 123 },
    ]
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(meters)))
    vi.stubGlobal('fetch', fetch)
    expect(await requestObsAudioMeters()).toEqual(meters)
    expect(fetch).toHaveBeenCalledWith(
      '/api/obs/audio-meters',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('fetches and validates status without caching', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(status)))
    vi.stubGlobal('fetch', fetch)
    expect(await requestStatus()).toEqual(status)
    expect(fetch).toHaveBeenCalledWith(
      '/api/status',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
      }),
    )
  })

  it('sends typed commands to the same-origin API', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(status)))
    vi.stubGlobal('fetch', fetch)
    await requestStatus({ type: 'preset', preset: 'Reader' })
    expect(fetch).toHaveBeenCalledWith(
      '/api/commands',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'preset', preset: 'Reader' }),
      }),
    )
  })

  it.each([
    new Response('{}'),
    new Response(JSON.stringify({ ...status, mode: 'live' })),
    new Response('private-adapter-value', { status: 500 }),
  ])('rejects invalid or unsuccessful responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(requestStatus()).rejects.toThrow()
  })

  it('aborts an unresponsive request after five seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new Error('Aborted')),
            )
          }),
      ),
    )
    try {
      const pending = expect(requestStatus()).rejects.toThrow('Aborted')
      await vi.advanceTimersByTimeAsync(5000)
      await pending
    } finally {
      vi.useRealTimers()
    }
  })
})
