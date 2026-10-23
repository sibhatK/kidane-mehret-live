import { EventSubscription, OBSWebSocket } from 'obs-websocket-js'
import {
  audioMetersSchema,
  cameraSourceSchema,
  type AudioMeter,
  type CameraSource,
  type BroadcastState,
  type Preset,
  type RuntimeMode,
  type Status,
} from '@kidane/shared'
import { z } from 'zod'
import { cameraConfig, createPtzOpticsAdapter } from './ptzoptics.js'

const meterEventSchema = z.object({
  inputs: z.array(
    z.object({
      inputName: z.string(),
      inputLevelsDb: z.unknown().optional(),
      inputLevelsMul: z.unknown().optional(),
    }),
  ),
})

function collectNumbers(value: unknown): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value]
  if (Array.isArray(value)) return value.flatMap(collectNumbers)
  if (typeof value === 'object' && value !== null)
    return Object.values(value).flatMap(collectNumbers)
  return []
}

// Integration boundaries live only in the agent; credentials never belong in Status.
export interface CameraAdapter {
  getStatus(): Promise<Status['camera']>
  selectPreset(preset: Preset): Promise<void>
}

export interface AudioAdapter {
  getStatus(): Promise<Status['audio']>
}

export interface ObsAdapter {
  getStatus(): Promise<Status['obs']>
  getBroadcastStatus(): Promise<Status['broadcast']>
  getAudioMeters(): Promise<AudioMeter[]>
  selectScene(source: CameraSource): Promise<void>
  prepare(): Promise<void>
  startStream(): Promise<void>
  end(): Promise<void>
  close(): Promise<void>
}

export interface Adapters {
  mode: RuntimeMode
  camera: CameraAdapter
  audio: AudioAdapter
  obs: ObsAdapter
}

export function createMockAdapters(): Adapters {
  let preset: Preset = 'Wide'
  let state: BroadcastState = 'idle'
  let activeSource: CameraSource = 'main'
  return {
    mode: 'simulated',
    camera: {
      async getStatus() {
        return { connection: 'connected', preset }
      },
      async selectPreset(value) {
        preset = value
      },
    },
    audio: {
      async getStatus() {
        return { connection: 'connected', muted: false }
      },
    },
    obs: {
      async getStatus() {
        return {
          connection: 'connected',
          recording: false,
          scenes: {
            connection: 'connected',
            configured: ['main', 'congregation'],
            available: ['main', 'congregation'],
            active: activeSource,
          },
        }
      },
      async getBroadcastStatus() {
        return {
          connection: 'connected',
          state,
          destination: 'YouTube (simulation only)',
        }
      },
      async getAudioMeters() {
        return []
      },
      async selectScene(source) {
        activeSource = source
      },
      async prepare() {
        state = 'prepared'
      },
      async startStream() {
        state = 'simulating'
      },
      async end() {
        state = 'idle'
      },
      async close() {},
    },
  }
}

export function createObsAdapters(
  url: string,
  password: string,
  client = new OBSWebSocket(),
  sceneNames: Partial<Record<CameraSource, string>> = {},
): Adapters {
  const mocks = createMockAdapters()
  let prepared = false
  let startRequestedAt: number | undefined
  let connectionAttempt: Promise<boolean> | undefined
  let audioMeters: AudioMeter[] = []

  client.on('InputVolumeMeters', (event) => {
    const parsed = meterEventSchema.safeParse(event)
    if (!parsed.success) return
    const sampledAt = Date.now()
    audioMeters = audioMetersSchema.parse(
      parsed.data.inputs.flatMap((input) => {
        const levels = collectNumbers(input.inputLevelsDb)
        const multipliers = collectNumbers(input.inputLevelsMul)
        const multiplierPeak = multipliers.length ? Math.max(...multipliers) : 0
        const peakDb =
          levels.length > 0
            ? Math.max(...levels)
            : multiplierPeak > 0
              ? 20 * Math.log10(multiplierPeak)
              : -60
        return [
          {
            inputName: input.inputName,
            peakDb,
            level: Math.max(0, Math.min(1, (peakDb + 60) / 60)),
            sampledAt,
          },
        ]
      }),
    )
  })

  client.on('ConnectionClosed', () => {
    audioMeters = []
    prepared = false
    startRequestedAt = undefined
  })

  async function ensureConnected() {
    if (client.identified) return true
    connectionAttempt ??= client
      .connect(url, password, {
        eventSubscriptions:
          EventSubscription.General | EventSubscription.InputVolumeMeters,
      })
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        connectionAttempt = undefined
      })
    return connectionAttempt
  }

  async function readScenes(): Promise<NonNullable<Status['obs']['scenes']>> {
    const configured = cameraSourceSchema.options.filter((source) =>
      Boolean(sceneNames[source]),
    )
    const unavailable = {
      connection: 'disconnected' as const,
      configured,
      available: [],
      active: null,
    }
    if (!configured.length || !(await ensureConnected())) return unavailable
    try {
      const list = await client.call('GetSceneList')
      const available = configured.filter((source) =>
        list.scenes.some((scene) => scene.sceneName === sceneNames[source]),
      )
      const active =
        available.find(
          (source) => sceneNames[source] === list.currentProgramSceneName,
        ) ?? null
      return { connection: 'connected', configured, available, active }
    } catch {
      return unavailable
    }
  }

  async function readLiveStatus() {
    if (!(await ensureConnected())) {
      prepared = false
      startRequestedAt = undefined
      return {
        obs: { connection: 'disconnected' as const, recording: null },
        broadcast: {
          connection: 'disconnected' as const,
          state: 'idle' as const,
          destination: 'OBS output' as const,
        },
      }
    }

    try {
      const [stream, recording] = await Promise.all([
        client.call('GetStreamStatus'),
        client.call('GetRecordStatus'),
      ])
      if (stream.outputActive) {
        prepared = false
        startRequestedAt = undefined
      } else if (
        startRequestedAt !== undefined &&
        Date.now() - startRequestedAt > 30_000
      ) {
        startRequestedAt = undefined
      }
      const state: BroadcastState =
        stream.outputReconnecting || startRequestedAt
          ? 'starting'
          : stream.outputActive
            ? 'streaming'
            : prepared
              ? 'prepared'
              : 'idle'
      return {
        obs: {
          connection: 'connected' as const,
          recording: recording.outputActive,
        },
        broadcast: {
          connection: 'connected' as const,
          state,
          destination: 'OBS output' as const,
        },
      }
    } catch {
      prepared = false
      startRequestedAt = undefined
      return {
        obs: { connection: 'disconnected' as const, recording: null },
        broadcast: {
          connection: 'disconnected' as const,
          state: 'idle' as const,
          destination: 'OBS output' as const,
        },
      }
    }
  }

  return {
    ...mocks,
    mode: 'obs',
    camera: {
      async getStatus() {
        return { connection: 'disconnected', preset: null }
      },
      async selectPreset() {
        throw new Error('Physical camera control is not configured')
      },
    },
    obs: {
      async getStatus() {
        const live = (await readLiveStatus()).obs
        return { ...live, scenes: await readScenes() }
      },
      async getBroadcastStatus() {
        return (await readLiveStatus()).broadcast
      },
      async getAudioMeters() {
        if (!(await ensureConnected())) return []
        return audioMeters.map((meter) => ({ ...meter }))
      },
      async selectScene(source) {
        const sceneName = sceneNames[source]
        if (!sceneName)
          throw new Error('This source has no configured OBS scene')
        const current = await readScenes()
        if (
          current.connection !== 'connected' ||
          !current.available.includes(source)
        )
          throw new Error('The configured OBS scene is unavailable')
        if (current.active === source) return
        await client.call('SetCurrentProgramScene', { sceneName })
        const after = await readScenes()
        if (after.connection !== 'connected' || after.active !== source)
          throw new Error('OBS did not confirm the requested program scene')
      },
      async prepare() {
        if (!(await ensureConnected())) throw new Error('OBS is unavailable')
        const { outputActive } = await client.call('GetStreamStatus')
        if (outputActive) throw new Error('OBS stream is already active')
        prepared = true
        startRequestedAt = undefined
      },
      async startStream() {
        if (!(await ensureConnected())) throw new Error('OBS is unavailable')
        if (!prepared) throw new Error('OBS preflight is required')
        const { outputActive } = await client.call('GetStreamStatus')
        if (outputActive) throw new Error('OBS stream is already active')
        await client.call('StartStream')
        prepared = false
        startRequestedAt = Date.now()
      },
      async end() {
        if (!(await ensureConnected())) throw new Error('OBS is unavailable')
        const { outputActive } = await client.call('GetStreamStatus')
        if (outputActive || startRequestedAt !== undefined) {
          await client.call('StopStream')
        }
        prepared = false
        startRequestedAt = undefined
      },
      async close() {
        if (client.identified) await client.disconnect()
      },
    },
  }
}

export function createConfiguredAdapters(
  environment: NodeJS.ProcessEnv = process.env,
): Adapters {
  const url = environment.OBS_WEBSOCKET_URL
  const password = environment.OBS_WEBSOCKET_PASSWORD
  const camera = cameraConfig(environment)
  const sceneNames: Partial<Record<CameraSource, string>> = {}
  for (const [source, key] of [
    ['main', 'OBS_SCENE_MAIN'],
    ['congregation', 'OBS_SCENE_CONGREGATION'],
  ] as const) {
    const value = environment[key]
    if (value !== undefined) {
      if (
        !value.trim() ||
        value.length > 256 ||
        Array.from(value).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new Error(
          'OBS scene mappings must be non-empty scene names without control characters',
        )
      sceneNames[source] = value
    }
  }
  if (sceneNames.main && sceneNames.main === sceneNames.congregation)
    throw new Error(
      'Main camera and Congregation must use different OBS scenes',
    )
  if (!url && !password) {
    if (camera || Object.keys(sceneNames).length)
      throw new Error(
        'Configure OBS WebSocket before enabling physical camera control or scene switching',
      )
    return createMockAdapters()
  }
  if (!password) {
    throw new Error('OBS_WEBSOCKET_PASSWORD is required when OBS is configured')
  }
  const adapters = createObsAdapters(
    url || 'ws://127.0.0.1:4455',
    password,
    undefined,
    sceneNames,
  )
  if (camera) adapters.camera = createPtzOpticsAdapter(camera)
  return adapters
}
