import { z } from 'zod'

export const presetSchema = z.enum(['Wide', 'Altar', 'Reader'])
export type Preset = z.infer<typeof presetSchema>
export const runtimeModeSchema = z.enum(['simulated', 'obs'])
export type RuntimeMode = z.infer<typeof runtimeModeSchema>
export const broadcastStateSchema = z.enum([
  'idle',
  'prepared',
  'starting',
  'streaming',
  'simulating',
])
export type BroadcastState = z.infer<typeof broadcastStateSchema>
export const actionSchema = z.enum(['prepare', 'go-live', 'end'])
export type BroadcastAction = z.infer<typeof actionSchema>
export const connectionSchema = z.enum(['connected', 'disconnected'])
export const audioMeterSchema = z.object({
  inputName: z.string(),
  level: z.number().min(0).max(1),
  peakDb: z.number(),
  sampledAt: z.number().int().nonnegative(),
})
export const audioMetersSchema = z.array(audioMeterSchema)
export type AudioMeter = z.infer<typeof audioMeterSchema>

export const statusSchema = z.object({
  mode: runtimeModeSchema,
  camera: z.object({
    connection: connectionSchema,
    preset: presetSchema,
  }),
  audio: z.object({
    connection: connectionSchema,
    muted: z.boolean(),
  }),
  obs: z.object({
    connection: connectionSchema,
    recording: z.boolean().nullable(),
  }),
  broadcast: z.object({
    connection: connectionSchema,
    state: broadcastStateSchema,
    destination: z.enum(['OBS output', 'YouTube (simulation only)']),
  }),
})
export type Status = z.infer<typeof statusSchema>

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('preset'), preset: presetSchema }).strict(),
  z
    .object({
      type: z.literal('broadcast'),
      action: actionSchema,
      confirmed: z.boolean().optional(),
    })
    .strict(),
])
export type Command = z.infer<typeof commandSchema>

export const allowedActions: Readonly<
  Record<BroadcastState, readonly BroadcastAction[]>
> = {
  idle: ['prepare'],
  prepared: ['go-live', 'end'],
  starting: ['end'],
  streaming: ['end'],
  simulating: ['end'],
}

export function canExecute(status: Status, command: Command): boolean {
  if (command.type === 'preset')
    return (
      status.mode === 'simulated' && status.camera.connection === 'connected'
    )
  if (!allowedActions[status.broadcast.state].includes(command.action))
    return false
  if (status.mode === 'obs') {
    if (status.obs.connection !== 'connected') return false
    if (command.action === 'prepare') return true
    if (command.action === 'go-live')
      return status.broadcast.state === 'prepared' && command.confirmed === true
    return command.confirmed === true
  }
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
