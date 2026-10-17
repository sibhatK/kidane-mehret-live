import { z } from 'zod'

export const presetSchema = z.enum(['Wide', 'Altar', 'Reader'])
export type Preset = z.infer<typeof presetSchema>
export const broadcastStateSchema = z.enum(['idle', 'prepared', 'simulating'])
export type BroadcastState = z.infer<typeof broadcastStateSchema>
export const actionSchema = z.enum(['prepare', 'go-live', 'end'])
export type BroadcastAction = z.infer<typeof actionSchema>
export const connectionSchema = z.enum(['connected', 'disconnected'])

// This MVP has no real/live mode. Every status describes mock equipment only.
export const statusSchema = z.object({
  mode: z.literal('simulated'),
  camera: z.object({
    connection: connectionSchema,
    preset: presetSchema,
  }),
  audio: z.object({
    connection: connectionSchema,
    muted: z.boolean(),
  }),
  obs: z.object({ connection: connectionSchema }),
  broadcast: z.object({
    connection: connectionSchema,
    state: broadcastStateSchema,
    destination: z.literal('YouTube (simulation only)'),
  }),
})
export type Status = z.infer<typeof statusSchema>

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('preset'), preset: presetSchema }).strict(),
  z.object({ type: z.literal('broadcast'), action: actionSchema }).strict(),
])
export type Command = z.infer<typeof commandSchema>

export const allowedActions: Readonly<
  Record<BroadcastState, readonly BroadcastAction[]>
> = {
  idle: ['prepare'],
  prepared: ['go-live', 'end'],
  simulating: ['end'],
}

export function canExecute(status: Status, command: Command): boolean {
  if (command.type === 'preset') return status.camera.connection === 'connected'
  if (!allowedActions[status.broadcast.state].includes(command.action))
    return false
  if (command.action === 'end') return true
  return (
    [
      status.camera.connection,
      status.audio.connection,
      status.obs.connection,
      status.broadcast.connection,
    ].every((connection) => connection === 'connected') && !status.audio.muted
  )
}
