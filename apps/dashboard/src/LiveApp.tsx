import { useEffect, useState } from 'react'
import type { Command, Status } from '@kidane/shared'
import { requestStatus } from './api'
import { Dashboard } from './Dashboard'

export default function LiveApp() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
            'Agent unavailable or invalid status. Controls are disabled; retrying automatically.',
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

  async function send(command: Command) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setStatus(await requestStatus(command))
    } catch {
      setStatus(null)
      setError('Simulation command failed. Waiting for a fresh agent status.')
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
      onCommand={(command) => {
        void send(command)
      }}
    />
  )
}
