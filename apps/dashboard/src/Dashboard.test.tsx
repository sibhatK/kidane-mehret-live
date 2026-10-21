import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Status } from '@kidane/shared'
import { CameraPreview } from './CameraPreview'
import { Dashboard } from './Dashboard'
import { requestStatus } from './api'

const status: Status = {
  mode: 'simulated',
  camera: { connection: 'connected', preset: 'Altar' },
  audio: { connection: 'connected', muted: false },
  obs: { connection: 'connected' },
  broadcast: {
    connection: 'connected',
    state: 'idle',
    destination: 'YouTube (simulation only)',
  },
}
function render(
  current: Status | null,
  busy = false,
  error: string | null = null,
) {
  return renderToStaticMarkup(
    createElement(Dashboard, {
      status: current,
      busy,
      loading: false,
      error,
      onCommand: vi.fn(),
    }),
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MediaMTX preview', () => {
  it('shows an unavailable state when no valid preview URL is configured', () => {
    for (const url of [undefined, 'not a URL', 'javascript:alert(1)']) {
      const html = renderToStaticMarkup(createElement(CameraPreview, { url }))
      expect(html).toContain('Preview unavailable')
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
  it('labels all connections and controls as simulated, with no video element', () => {
    const html = render(status)
    expect(html).toContain('CONTROLS SIMULATED')
    expect(html.match(/Connected \(mock\)/g)).toHaveLength(4)
    for (const label of [
      'Wide',
      'Altar',
      'Reader',
      'Prepare',
      'Go Live',
      'End Broadcast',
    ]) {
      expect(html).toContain(label)
    }
    expect(html).toContain('aria-pressed="true">Altar')
    expect(html).toContain('Preview unavailable')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('<iframe')
  })

  it.each([
    ['idle', 2],
    ['prepared', 1],
    ['simulating', 2],
  ] as const)('enables only valid broadcast controls in %s', (state, count) => {
    const html = render({
      ...status,
      broadcast: { ...status.broadcast, state },
    })
    expect(html.match(/disabled=""/g)).toHaveLength(count)
    if (state === 'simulating') expect(html).toContain('NOT LIVE')
  })

  it('disables all six controls when offline or a command is pending', () => {
    for (const html of [
      render(null, false, 'Agent unavailable'),
      render(status, true),
    ]) {
      expect(html.match(/disabled=""/g)).toHaveLength(6)
    }
    expect(render(null, false, 'Agent unavailable')).toContain('role="alert"')
    expect(render(null)).toContain('Broadcast status unknown — NOT LIVE')
  })
})

describe('validated API client', () => {
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
