import {
  commandSchema,
  statusSchema,
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
  const timeout = setTimeout(abort, 5000)
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
