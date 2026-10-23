import { describe, expect, it } from 'vitest'
import {
  canExecute,
  commandSchema,
  statusSchema,
  type Status,
} from './index.js'

const status: Status = {
  mode: 'simulated',
  camera: { connection: 'connected', preset: 'Wide' },
  audio: { connection: 'connected', muted: false },
  obs: { connection: 'connected', recording: false },
  broadcast: {
    connection: 'connected',
    state: 'idle',
    destination: 'YouTube (simulation only)',
  },
}

describe('shared safety contracts', () => {
  it('requires opt-in, connection, and confirmation for nudges but permits emergency stop while disconnected', () => {
    const current: Status = {
      ...status,
      mode: 'obs',
      camera: {
        connection: 'connected',
        control: 'ptzoptics',
        preset: null,
        manualEnabled: true,
        manualState: 'idle',
      },
    }
    const move = { type: 'ptz', action: 'left', confirmed: true } as const
    expect(commandSchema.parse(move)).toEqual(move)
    expect(canExecute(current, move)).toBe(true)
    expect(canExecute(current, { type: 'ptz', action: 'left' })).toBe(false)
    expect(
      canExecute(
        { ...current, camera: { ...current.camera, manualEnabled: false } },
        move,
      ),
    ).toBe(false)
    expect(
      canExecute(
        {
          ...current,
          camera: { ...current.camera, connection: 'disconnected' },
        },
        move,
      ),
    ).toBe(false)
    for (const manualState of ['nudging', 'stop-unconfirmed'] as const)
      expect(
        canExecute(
          { ...current, camera: { ...current.camera, manualState } },
          move,
        ),
      ).toBe(false)
    expect(
      canExecute(
        {
          ...current,
          camera: {
            ...current.camera,
            connection: 'disconnected',
            manualEnabled: false,
            manualState: 'stop-unconfirmed',
          },
        },
        { type: 'ptz', action: 'stop' },
      ),
    ).toBe(true)
    expect(
      canExecute(
        { ...current, camera: { connection: 'disconnected', preset: null } },
        { type: 'ptz', action: 'stop' },
      ),
    ).toBe(false)
    expect(commandSchema.safeParse({ ...move, speed: 24 }).success).toBe(false)
    expect(
      commandSchema.safeParse({ ...move, durationMs: 60000 }).success,
    ).toBe(false)
    expect(
      commandSchema.safeParse({ type: 'ptz', action: 'home' }).success,
    ).toBe(false)
  })

  it('gates source switching on configured, available OBS scenes and explicit real confirmation', () => {
    const current: Status = {
      ...status,
      mode: 'obs',
      obs: {
        connection: 'connected',
        recording: false,
        scenes: {
          connection: 'connected',
          configured: ['main', 'congregation'],
          available: ['main'],
          active: null,
        },
      },
    }
    const command = { type: 'scene', source: 'main', confirmed: true } as const
    expect(commandSchema.parse(command)).toEqual(command)
    expect(canExecute(current, command)).toBe(true)
    expect(canExecute(current, { type: 'scene', source: 'main' })).toBe(false)
    expect(canExecute(current, { ...command, source: 'congregation' })).toBe(
      false,
    )
    expect(
      canExecute(
        { ...current, obs: { ...current.obs, connection: 'disconnected' } },
        command,
      ),
    ).toBe(false)
    expect(
      canExecute(
        {
          ...current,
          obs: {
            ...current.obs,
            scenes: { ...current.obs.scenes!, connection: 'disconnected' },
          },
        },
        command,
      ),
    ).toBe(false)
    expect(canExecute(status, command)).toBe(false)
    expect(
      canExecute(
        { ...current, mode: 'simulated' },
        { type: 'scene', source: 'main' },
      ),
    ).toBe(true)
    expect(
      commandSchema.safeParse({ ...command, sceneName: 'Any Scene' }).success,
    ).toBe(false)
    expect(
      commandSchema.safeParse({ type: 'scene', source: 'arbitrary' }).success,
    ).toBe(false)
    expect(statusSchema.parse(current).obs.scenes?.active).toBeNull()
  })

  it('requires configured mappings, connection, OBS mode, and confirmation for real camera recall', () => {
    const realCamera: Status = {
      ...status,
      mode: 'obs',
      camera: {
        connection: 'connected',
        preset: null,
        control: 'ptzoptics',
        availablePresets: ['Wide'],
        lastRequestedPreset: null,
      },
    }
    expect(statusSchema.parse(realCamera).camera.preset).toBeNull()
    const recall = { type: 'preset', preset: 'Wide', confirmed: true } as const
    expect(canExecute(realCamera, recall)).toBe(true)
    expect(canExecute(realCamera, { type: 'preset', preset: 'Wide' })).toBe(
      false,
    )
    expect(canExecute(realCamera, { ...recall, preset: 'Reader' })).toBe(false)
    expect(canExecute({ ...realCamera, mode: 'simulated' }, recall)).toBe(false)
    expect(
      canExecute(
        {
          ...realCamera,
          camera: { ...realCamera.camera, connection: 'disconnected' },
        },
        recall,
      ),
    ).toBe(false)
    expect(
      canExecute(
        {
          ...realCamera,
          camera: { ...realCamera.camera, availablePresets: [] },
        },
        recall,
      ),
    ).toBe(false)
    expect(commandSchema.parse(recall)).toEqual(recall)
  })

  it('accepts simulation or OBS mode but rejects unknown modes and states', () => {
    expect(statusSchema.parse(status)).toEqual(status)
    expect(
      statusSchema.parse({
        ...status,
        mode: 'obs',
        broadcast: { ...status.broadcast, destination: 'OBS output' },
      }).mode,
    ).toBe('obs')
    expect(statusSchema.safeParse({ ...status, mode: 'live' }).success).toBe(
      false,
    )
    expect(statusSchema.safeParse({ ...status, mode: undefined }).success).toBe(
      false,
    )
    expect(
      statusSchema.safeParse({
        ...status,
        broadcast: { ...status.broadcast, state: 'live' },
      }).success,
    ).toBe(false)
  })

  it.each([
    { type: 'preset', preset: 'Unknown' },
    { type: 'broadcast', action: 'start-stream' },
    { type: 'preset', preset: 'Altar', credentials: 'not-allowed' },
    {},
  ])('rejects unsupported commands: %j', (command) => {
    expect(commandSchema.safeParse(command).success).toBe(false)
  })

  it('strips unapproved adapter fields from the public status', () => {
    const result = statusSchema.parse({
      ...status,
      camera: { ...status.camera, credentials: 'private-adapter-value' },
      broadcast: { ...status.broadcast, streamKey: 'private-adapter-value' },
    })
    expect(result).toEqual(status)
  })

  it('blocks preparation when equipment is disconnected or audio is muted', () => {
    const command = { type: 'broadcast', action: 'prepare' } as const
    expect(canExecute(status, command)).toBe(true)
    for (const device of ['camera', 'audio', 'obs', 'broadcast'] as const) {
      expect(
        canExecute(
          {
            ...status,
            [device]: { ...status[device], connection: 'disconnected' },
          },
          command,
        ),
      ).toBe(false)
    }
    expect(
      canExecute(
        {
          ...status,
          audio: { ...status.audio, muted: true },
        },
        command,
      ),
    ).toBe(false)
  })

  it('allows ending a simulation even if equipment disconnects', () => {
    expect(
      canExecute(
        {
          ...status,
          obs: { connection: 'disconnected', recording: false },
          broadcast: { ...status.broadcast, state: 'simulating' },
        },
        { type: 'broadcast', action: 'end' },
      ),
    ).toBe(true)
  })

  it('requires OBS connection, prepared state, and confirmation for a real stream', () => {
    const obsStatus: Status = {
      ...status,
      mode: 'obs',
      camera: { connection: 'disconnected', preset: 'Wide' },
      audio: { connection: 'disconnected', muted: true },
      obs: { connection: 'connected', recording: false },
      broadcast: {
        connection: 'connected',
        state: 'prepared',
        destination: 'OBS output',
      },
    }
    expect(
      canExecute(obsStatus, { type: 'broadcast', action: 'go-live' }),
    ).toBe(false)
    expect(
      canExecute(obsStatus, {
        type: 'broadcast',
        action: 'go-live',
        confirmed: true,
      }),
    ).toBe(true)
    expect(
      canExecute(
        { ...obsStatus, obs: { connection: 'disconnected', recording: false } },
        {
          type: 'broadcast',
          action: 'go-live',
          confirmed: true,
        },
      ),
    ).toBe(false)
    expect(canExecute(obsStatus, { type: 'preset', preset: 'Altar' })).toBe(
      false,
    )
  })
})
