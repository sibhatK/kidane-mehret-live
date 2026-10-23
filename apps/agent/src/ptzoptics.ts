import DigestClient from 'digest-fetch'
import { z } from 'zod'
import { presetSchema, type Preset, type Status } from '@kidane/shared'
import type { CameraAdapter } from './adapters.js'
import { setTimeout as delay } from 'node:timers/promises'

const presetNumberSchema = z
  .number()
  .int()
  .min(0)
  .max(254)
  .refine((value) => value < 90 || value > 99)
const presetMapSchema = z
  .object({
    Wide: presetNumberSchema.optional(),
    Altar: presetNumberSchema.optional(),
    Reader: presetNumberSchema.optional(),
  })
  .strict()
const deviceSchema = z.object({
  status: z.literal(200),
  data: z.object({ devname: z.string().min(1) }),
})

export interface CameraConfig {
  origin: string
  presets: Partial<Record<Preset, number | undefined>>
  confirmed: boolean
  username?: string | undefined
  password?: string | undefined
  algorithm: 'SHA-256' | 'MD5'
  manualEnabled?: boolean
}

type CameraFetch = (
  url: string,
  options: RequestInit,
) => Promise<
  Pick<Response, 'status' | 'text'> & { headers: Pick<Headers, 'get'> }
>

export function cameraConfig(
  environment: NodeJS.ProcessEnv,
): CameraConfig | undefined {
  const value = environment.PTZ_CAMERA_URL
  const keys = [
    'PTZ_PRESET_MAP',
    'PTZ_PRESETS_CONFIRMED',
    'PTZ_CAMERA_USERNAME',
    'PTZ_CAMERA_PASSWORD',
    'PTZ_CAMERA_DIGEST_ALGORITHM',
    'PTZ_MANUAL_ENABLED',
  ]
  if (!value) {
    if (keys.some((key) => environment[key] !== undefined))
      throw new Error(
        'PTZ_CAMERA_URL is required when PTZ options are configured',
      )
    return undefined
  }
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid origin')
    const username = environment.PTZ_CAMERA_USERNAME
    const password = environment.PTZ_CAMERA_PASSWORD
    if (
      (username !== undefined || password !== undefined) &&
      (!username || !password)
    )
      throw new Error('Incomplete credentials')
    const presets = presetMapSchema.parse(
      JSON.parse(environment.PTZ_PRESET_MAP ?? '{}'),
    )
    const confirmed =
      z
        .enum(['true', 'false'])
        .parse(environment.PTZ_PRESETS_CONFIRMED ?? 'false') === 'true'
    const algorithm = z
      .enum(['SHA-256', 'MD5'])
      .parse(environment.PTZ_CAMERA_DIGEST_ALGORITHM ?? 'SHA-256')
    const manualEnabled =
      z
        .enum(['true', 'false'])
        .parse(environment.PTZ_MANUAL_ENABLED ?? 'false') === 'true'
    return {
      origin: url.origin,
      presets,
      confirmed,
      username,
      password,
      algorithm,
      manualEnabled,
    }
  } catch {
    throw new Error(
      'Invalid PTZ configuration. Use an origin-only PTZ_CAMERA_URL, paired credentials, SHA-256 or MD5 Digest, and a JSON preset map with verified numbers 0-89 or 100-254.',
    )
  }
}

export function createPtzOpticsAdapter(
  config: CameraConfig,
  transport?: CameraFetch,
  timeoutMs = 2500,
): CameraAdapter {
  const origin = new URL(config.origin).origin
  const presets = presetMapSchema.parse(config.presets)
  const availablePresets = config.confirmed
    ? presetSchema.options.filter((preset) => presets[preset] !== undefined)
    : []
  const send: CameraFetch =
    transport ??
    (async (url, options) => {
      if (!config.username || !config.password) return fetch(url, options)
      const client = new DigestClient(config.username, config.password, {
        algorithm: config.algorithm,
      })
      return client.fetch(url, options)
    })
  let lastRequestedPreset: Preset | null = null
  let connected = false
  let checkedAt = 0
  let checking: Promise<boolean> | undefined
  let manualState: 'idle' | 'nudging' | 'stop-unconfirmed' = 'idle'
  let generation = 0
  let movement: AbortController | undefined
  let stopping: Promise<void> | undefined
  let closed = false

  async function request(path: string, externalSignal?: AbortSignal) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await send(`${origin}${path}`, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: externalSignal
          ? AbortSignal.any([controller.signal, externalSignal])
          : controller.signal,
      })
      if (
        response.status !== 200 ||
        Number(response.headers.get('content-length')) > 32768
      )
        throw new Error('Camera did not acknowledge')
      const text = await response.text()
      if (
        text.length > 32768 ||
        /^\s*(?:<|error|fail|invalid|unsupported)/i.test(text)
      )
        throw new Error('Invalid camera response')
      if (text.trim().startsWith('{')) {
        const body = JSON.parse(text) as { status?: unknown }
        if (body.status !== undefined && body.status !== 200)
          throw new Error('Camera rejected request')
      }
      return text
    } catch {
      connected = false
      throw new Error(
        'Camera request could not be confirmed. Check the picture and camera controls before retrying.',
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async function checkConnection(force = false): Promise<boolean> {
    if (!force && Date.now() - checkedAt < 2000) return connected
    checking ??= (async () => {
      try {
        const text = await request('/cgi-bin/param.cgi?get_device_conf')
        deviceSchema.parse(JSON.parse(text))
        connected = true
      } catch {
        connected = false
      } finally {
        checkedAt = Date.now()
        checking = undefined
      }
      return connected
    })()
    return checking
  }

  async function stop(): Promise<void> {
    generation++
    movement?.abort()
    movement = undefined
    manualState = 'stop-unconfirmed'
    stopping ??= (async () => {
      let panStopped = false
      let zoomStopped = false
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const results: PromiseSettledResult<unknown>[] =
            await Promise.allSettled([
              panStopped
                ? Promise.resolve()
                : request('/cgi-bin/ptzctrl.cgi?ptzcmd&ptzstop&0&0'),
              zoomStopped
                ? Promise.resolve()
                : request('/cgi-bin/ptzctrl.cgi?ptzcmd&zoomstop'),
            ])
          panStopped ||= results[0]?.status === 'fulfilled'
          zoomStopped ||= results[1]?.status === 'fulfilled'
          if (panStopped && zoomStopped) {
            manualState = 'idle'
            return
          }
        }
        throw new Error(
          'Camera Stop was not confirmed. Use the physical camera remote and check the picture before continuing.',
        )
      } finally {
        stopping = undefined
      }
    })()
    return stopping
  }

  return {
    async getStatus(): Promise<Status['camera']> {
      const reachable = await checkConnection()
      return {
        connection: reachable ? 'connected' : 'disconnected',
        control: 'ptzoptics',
        preset: null,
        availablePresets: [...availablePresets],
        lastRequestedPreset,
        manualEnabled: config.manualEnabled === true && !closed,
        manualState,
      }
    },
    async selectPreset(preset) {
      if (closed || manualState !== 'idle')
        throw new Error('Stop the camera before recalling another shot')
      const number = presets[preset]
      if (!availablePresets.includes(preset) || number === undefined)
        throw new Error('This camera preset mapping has not been confirmed')
      const currentGeneration = generation
      const controller = new AbortController()
      movement = controller
      try {
        if (!(await checkConnection(true)))
          throw new Error('The camera control API is unavailable')
        if (
          controller.signal.aborted ||
          currentGeneration !== generation ||
          closed
        )
          throw new Error('Camera recall was cancelled by Stop')
        await request(
          `/cgi-bin/ptzctrl.cgi?ptzcmd&poscall&${number}`,
          controller.signal,
        )
        lastRequestedPreset = preset
      } finally {
        if (movement === controller) movement = undefined
      }
    },
    async nudge(action) {
      if (!config.manualEnabled || closed || manualState !== 'idle')
        throw new Error('Manual camera movement is not available')
      const currentGeneration = ++generation
      const controller = new AbortController()
      movement = controller
      manualState = 'nudging'
      lastRequestedPreset = null
      const deadline = setTimeout(() => controller.abort(), 4000)
      try {
        if (!(await checkConnection(true)))
          throw new Error('Camera is unavailable')
        if (controller.signal.aborted || currentGeneration !== generation)
          throw new Error('Camera movement was cancelled')
        const paths = {
          left: 'left&1&1',
          right: 'right&1&1',
          up: 'up&1&1',
          down: 'down&1&1',
          'zoom-in': 'zoomin&1',
          'zoom-out': 'zoomout&1',
        } as const
        await request(
          `/cgi-bin/ptzctrl.cgi?ptzcmd&${paths[action]}`,
          controller.signal,
        )
        await delay(400, undefined, { signal: controller.signal })
      } finally {
        clearTimeout(deadline)
        if (currentGeneration === generation) await stop()
      }
    },
    stop,
    async close() {
      closed = true
      if (movement || manualState !== 'idle') await stop()
    },
  }
}
