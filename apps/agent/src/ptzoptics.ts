import DigestClient from 'digest-fetch'
import { z } from 'zod'
import { presetSchema, type Preset, type Status } from '@kidane/shared'
import type { CameraAdapter } from './adapters.js'

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
    return {
      origin: url.origin,
      presets,
      confirmed,
      username,
      password,
      algorithm,
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

  async function request(path: string) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await send(`${origin}${path}`, {
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
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
        'Camera request could not be confirmed. Verify the picture before retrying a recall.',
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

  return {
    async getStatus(): Promise<Status['camera']> {
      const reachable = await checkConnection()
      return {
        connection: reachable ? 'connected' : 'disconnected',
        control: 'ptzoptics',
        preset: null,
        availablePresets: [...availablePresets],
        lastRequestedPreset,
      }
    },
    async selectPreset(preset) {
      const number = presets[preset]
      if (!availablePresets.includes(preset) || number === undefined)
        throw new Error('This camera preset mapping has not been confirmed')
      if (!(await checkConnection(true)))
        throw new Error('The camera control API is unavailable')
      await request(`/cgi-bin/ptzctrl.cgi?ptzcmd&poscall&${number}`)
      lastRequestedPreset = preset
    },
  }
}
