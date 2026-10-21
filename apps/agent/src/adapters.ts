import { EventSubscription, OBSWebSocket } from 'obs-websocket-js'
import {
  audioMetersSchema,
  type AudioMeter,
  type BroadcastState,
  type Preset,
  type RuntimeMode,
  type Status,
} from '@kidane/shared'
import { z } from 'zod'

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
        return { connection: 'connected', recording: false }
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
        const multiplierPeak = multipliers.length
          ? Math.max(...multipliers)
          : 0
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
      .then(() => true, () => false)
      .finally(() => {
        connectionAttempt = undefined
      })
    return connectionAttempt
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
      const state: BroadcastState = stream.outputReconnecting || startRequestedAt
        ? 'starting'
        : stream.outputActive
          ? 'streaming'
          : prepared
            ? 'prepared'
            : 'idle'
      return {
        obs: { connection: 'connected' as const, recording: recording.outputActive },
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
    obs: {
      async getStatus() {
        return (await readLiveStatus()).obs
      },
      async getBroadcastStatus() {
        return (await readLiveStatus()).broadcast
      },
      async getAudioMeters() {
        if (!(await ensureConnected())) return []
        return audioMeters.map((meter) => ({ ...meter }))
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
  if (!url && !password) return createMockAdapters()
  if (!password) {
    throw new Error('OBS_WEBSOCKET_PASSWORD is required when OBS is configured')
  }
  return createObsAdapters(url || 'ws://127.0.0.1:4455', password)
}
