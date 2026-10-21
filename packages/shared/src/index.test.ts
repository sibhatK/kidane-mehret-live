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
