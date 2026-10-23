import { useEffect, useState } from 'react'
import type { AudioMeter, Command, Status } from '@kidane/shared'
import { requestObsAudioMeters, requestStatus } from './api'
import { Dashboard } from './Dashboard'

export default function LiveApp() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [audioMeters, setAudioMeters] = useState<AudioMeter[]>([])
  const obsMode = status?.mode === 'obs'

  useEffect(() => {
    if (busy) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next = await requestStatus(undefined, controller.signal)
        if (!controller.signal.aborted) {
          setStatus(next)
          setError(null)
        }
      } catch {
        if (!controller.signal.aborted) {
          setStatus(null)
          setError(
            'Cannot reach the streaming computer. Ask the operator to check the app on the Mac. Reconnecting automatically.',
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(() => {
            void refresh()
          }, 3000)
        }
      }
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [busy])

  useEffect(() => {
    if (!obsMode) return

    let stopped = false
    let meterTimer: ReturnType<typeof setTimeout>
    async function refreshMeters() {
      try {
        const next = await requestObsAudioMeters()
        const receivedAt = Date.now()
        if (!stopped)
          setAudioMeters(
            next.filter(
              (meter) =>
                receivedAt - meter.sampledAt >= 0 &&
                receivedAt - meter.sampledAt < 5000,
            ),
          )
      } catch {
        if (!stopped) setAudioMeters([])
      } finally {
        if (!stopped) meterTimer = setTimeout(() => void refreshMeters(), 250)
      }
    }
    void refreshMeters()
    return () => {
      stopped = true
      clearTimeout(meterTimer)
    }
  }, [obsMode])

  async function send(command: Command) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setStatus(await requestStatus(command))
    } catch {
      setStatus(null)
      setError(
        'Could not confirm the change. Check the picture and broadcast status before trying again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dashboard
      status={status}
      busy={busy}
      error={error}
      loading={loading}
      audioMeters={obsMode ? audioMeters : []}
      onCommand={(command) => {
        void send(command)
      }}
    />
  )
}
