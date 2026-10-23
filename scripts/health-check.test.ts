import { describe, expect, it } from 'vitest'
import { readinessChecks, printReadiness } from './health-check.js'

function status(mode = 'obs', connection = 'connected') {
  return {
    mode,
    camera: { connection: 'disconnected', preset: 'Wide' },
    audio: { connection: 'disconnected', muted: false },
    obs: { connection, recording: false },
    broadcast: { connection, state: 'idle', destination: 'OBS output' },
  }
}

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { url: string; method: string }[] = []
  const bodies: Record<string, unknown> = {
    'http://127.0.0.1:5173': '<html>dashboard</html>',
    'http://127.0.0.1:3001/api/status': status(),
    'http://127.0.0.1:5173/api/status': status(),
    'http://127.0.0.1:8889/live': '<html>MediaMTX player</html>',
    'http://practice-mac.local:5173': '<html>dashboard</html>',
    'http://practice-mac.local:8889/live': '<html>MediaMTX player</html>',
    'http://127.0.0.1:5173/api/obs/audio-meters': [
      { inputName: 'Mic', level: 0.5, peakDb: -20, sampledAt: Date.now() },
    ],
    ...overrides,
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    const body = bodies[url]
    if (body === undefined)
      throw new Error('secret password must not reach report')
    return new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      {
        status: 200,
        headers: {
          'content-type':
            typeof body === 'string' ? 'text/html' : 'application/json',
        },
      },
    )
  }
  return {
    calls,
    options: {
      fetcher,
      savedDashboardUrl: 'http://practice-mac.local:5173',
      udpListener: async () => true,
    },
  }
}

describe('read-only readiness report', () => {
  it.each([true, false])(
    'checks configured picture-source availability without switching scenes: %j',
    async (available) => {
      const body = {
        ...status(),
        obs: {
          ...status().obs,
          scenes: {
            connection: 'connected',
            configured: ['main', 'congregation'],
            available: available ? ['main', 'congregation'] : ['main'],
            active: 'main',
          },
        },
      }
      const { options, calls } = fixture({
        'http://127.0.0.1:3001/api/status': body,
        'http://127.0.0.1:5173/api/status': body,
      })
      const checks = await readinessChecks(options)
      expect(
        checks.find((check) => check.name === 'Configured OBS picture sources')
          ?.state,
      ).toBe(available ? 'PASS' : 'FAIL')
      expect(
        calls.every(
          (call) => call.method === 'GET' && !call.url.includes('/commands'),
        ),
      ).toBe(true)
    },
  )

  it('reports camera control connectivity without recalling presets or assuming saved positions', async () => {
    const body = {
      ...status(),
      camera: {
        connection: 'connected',
        control: 'ptzoptics',
        preset: null,
        availablePresets: [],
        lastRequestedPreset: null,
      },
    }
    const { options, calls } = fixture({
      'http://127.0.0.1:3001/api/status': body,
      'http://127.0.0.1:5173/api/status': body,
    })
    const checks = await readinessChecks(options)
    expect(
      checks.find((check) => check.name === 'PTZOptics control API')?.state,
    ).toBe('PASS')
    expect(
      checks.find((check) => check.name === 'Camera preset mappings')?.state,
    ).toBe('NOT VERIFIED')
    expect(
      calls.every(
        (call) =>
          call.method === 'GET' &&
          !call.url.includes('ptzctrl') &&
          !call.url.includes('/commands'),
      ),
    ).toBe(true)
  })

  it('fails configured camera connectivity without hiding unavailable preset mappings', async () => {
    const body = {
      ...status(),
      camera: {
        connection: 'disconnected',
        control: 'ptzoptics',
        preset: null,
        availablePresets: [],
      },
    }
    const { options } = fixture({
      'http://127.0.0.1:3001/api/status': body,
      'http://127.0.0.1:5173/api/status': body,
    })
    const checks = await readinessChecks(options)
    expect(
      checks.find((check) => check.name === 'PTZOptics control API')?.state,
    ).toBe('FAIL')
  })

  it('validates services but never claims end-to-end readiness or sends commands', async () => {
    const { options, calls } = fixture()
    const checks = await readinessChecks(options)
    expect(checks.filter((check) => check.state === 'FAIL')).toEqual([])
    expect(
      checks.find((check) => check.name === 'OBS authenticated connection')
        ?.state,
    ).toBe('PASS')
    expect(checks.find((check) => check.name === 'Audio activity')?.state).toBe(
      'PASS',
    )
    expect(
      checks.find((check) => check.name === 'WebRTC media (UDP 8189)')?.state,
    ).toBe('NOT VERIFIED')
    expect(
      calls.every(
        (call) => call.method === 'GET' && !call.url.includes('/commands'),
      ),
    ).toBe(true)
    const lines: string[] = []
    printReadiness(checks, (line) => lines.push(line))
    expect(lines.join('\n')).toContain(
      'end-to-end readiness is not yet confirmed',
    )
  })

  it('shows only the first recovery instruction when several endpoints fail', async () => {
    const { options } = fixture({
      'http://127.0.0.1:5173': undefined,
      'http://127.0.0.1:3001/api/status': undefined,
      'http://127.0.0.1:8889/live': undefined,
    })
    const checks = await readinessChecks(options)
    expect(
      checks.filter((check) => check.state === 'FAIL').length,
    ).toBeGreaterThan(1)
    const lines: string[] = []
    printReadiness(checks, (line) => lines.push(line))
    expect(lines.filter((line) => line.startsWith('1.'))).toHaveLength(1)
    expect(lines.join('\n')).toContain('Fix this first: Dashboard HTTP (5173)')
    expect(lines.join('\n')).not.toContain('secret password')
  })

  it('rejects malformed status data instead of accepting HTTP 200 alone', async () => {
    const { options } = fixture({
      'http://127.0.0.1:3001/api/status': { mode: 'obs' },
    })
    const checks = await readinessChecks(options)
    expect(
      checks.find((check) => check.name === 'Agent status (3001)')?.state,
    ).toBe('FAIL')
  })

  it.each(['simulated', 'disconnected'])(
    'does not claim an OBS connection for %s',
    async (value) => {
      const body =
        value === 'simulated'
          ? status('simulated')
          : status('obs', 'disconnected')
      const { options, calls } = fixture({
        'http://127.0.0.1:3001/api/status': body,
        'http://127.0.0.1:5173/api/status': body,
      })
      const checks = await readinessChecks(options)
      expect(
        checks.find((check) => check.name === 'OBS authenticated connection')
          ?.state,
      ).toBe('FAIL')
      expect(calls.some((call) => call.url.includes('audio-meters'))).toBe(
        false,
      )
    },
  )

  it.each([
    { meters: [] },
    {
      meters: [
        { inputName: 'Mic', level: 0, peakDb: -60, sampledAt: Date.now() },
      ],
    },
    { meters: [{ inputName: 'Mic', level: 1, peakDb: -1, sampledAt: 0 }] },
  ])(
    'does not treat silent, missing, or stale samples as active audio: %j',
    async ({ meters }) => {
      const { options } = fixture({
        'http://127.0.0.1:5173/api/obs/audio-meters': meters,
      })
      const checks = await readinessChecks(options)
      expect(
        checks.find((check) => check.name === 'Audio-meter endpoint')?.state,
      ).toBe('PASS')
      expect(
        checks.find((check) => check.name === 'Audio activity')?.state,
      ).toBe('NOT VERIFIED')
    },
  )

  it('reports invalid meter payloads, hostname failure, and a missing UDP socket', async () => {
    const { options } = fixture({
      'http://127.0.0.1:5173/api/obs/audio-meters': [
        { password: 'never printed' },
      ],
      'http://practice-mac.local:5173': undefined,
    })
    const checks = await readinessChecks({
      ...options,
      udpListener: async () => false,
    })
    for (const name of [
      'Audio-meter endpoint',
      'Saved hostname dashboard link',
      'Local UDP socket (8189)',
    ]) {
      expect(checks.find((check) => check.name === name)?.state).toBe('FAIL')
    }
    expect(JSON.stringify(checks)).not.toContain('never printed')
  })

  it('retries delayed services within the startup deadline', async () => {
    const { options } = fixture()
    let attempts = 0
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input) === 'http://127.0.0.1:5173' && attempts++ === 0)
        throw new Error('starting')
      return options.fetcher(input, init)
    }
    const checks = await readinessChecks({ ...options, fetcher, waitMs: 1000 })
    expect(attempts).toBe(2)
    expect(
      checks.find((check) => check.name === 'Dashboard HTTP (5173)')?.state,
    ).toBe('PASS')
  })

  it('bounds a hanging request and returns a failure', async () => {
    const { options } = fixture()
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input) !== 'http://127.0.0.1:5173')
        return options.fetcher(input, init)
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('timed out')),
          { once: true },
        ),
      )
    }
    const checks = await readinessChecks({ ...options, fetcher, requestMs: 20 })
    expect(
      checks.find((check) => check.name === 'Dashboard HTTP (5173)')?.state,
    ).toBe('FAIL')
  })
})
