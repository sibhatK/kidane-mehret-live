import {
  audioMetersSchema,
  cameraStopSchema,
  commandSchema,
  statusSchema,
  type AudioMeter,
  type Command,
  type Status,
} from '@kidane/shared'

export async function requestStatus(
  command?: Command,
  signal?: AbortSignal,
): Promise<Status> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    abort,
    (command?.type === 'preset' ||
      command?.type === 'scene' ||
      command?.type === 'ptz') &&
      command.confirmed
      ? 15000
      : 5000,
  )
  try {
    const response = await fetch(command ? '/api/commands' : '/api/status', {
      method: command ? 'POST' : 'GET',
      ...(command
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(commandSchema.parse(command)),
          }
        : {}),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Simulation agent request failed')
    return statusSchema.parse(await response.json())
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export async function requestObsAudioMeters(): Promise<AudioMeter[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  try {
    const response = await fetch('/api/obs/audio-meters', {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('OBS audio meters are unavailable')
    return audioMetersSchema.parse(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

export async function requestCameraStop(): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ptz', action: 'stop' }),
      signal: controller.signal,
      cache: 'no-store',
      keepalive: true,
    })
    if (!response.ok) throw new Error('Camera Stop unavailable')
    cameraStopSchema.parse(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}
