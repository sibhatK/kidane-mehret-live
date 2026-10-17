import type { BroadcastState, Preset, Status } from '@kidane/shared'

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
  prepare(): Promise<void>
  startSimulation(): Promise<void>
  end(): Promise<void>
}

export interface Adapters {
  camera: CameraAdapter
  audio: AudioAdapter
  obs: ObsAdapter
}

export function createMockAdapters(): Adapters {
  let preset: Preset = 'Wide'
  let state: BroadcastState = 'idle'
  return {
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
        return { connection: 'connected' }
      },
      async getBroadcastStatus() {
        return {
          connection: 'connected',
          state,
          destination: 'YouTube (simulation only)',
        }
      },
      async prepare() {
        state = 'prepared'
      },
      async startSimulation() {
        state = 'simulating'
      },
      async end() {
        state = 'idle'
      },
    },
  }
}
