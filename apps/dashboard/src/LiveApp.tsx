import { useEffect, useRef, useState } from 'react'
import type { AudioMeter, Command, Status } from '@kidane/shared'
import { requestCameraStop, requestObsAudioMeters, requestStatus } from './api'
import { Dashboard } from './Dashboard'

export default function LiveApp() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [audioMeters, setAudioMeters] = useState<AudioMeter[]>([])
  const [cameraNotice, setCameraNotice] = useState<string | null>(null)
  const pendingCommands = useRef(0)
  const commandVersion = useRef(0)
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
    const emergencyStop = command.type === 'ptz' && command.action === 'stop'
    if (pendingCommands.current > 0 && !emergencyStop) return
    const version = ++commandVersion.current
    pendingCommands.current++
    setBusy(true)
    setError(null)
    setCameraNotice(null)
    try {
      if (emergencyStop) {
        await requestCameraStop()
        if (version === commandVersion.current)
          setCameraNotice(
            'Stop request acknowledged. Check the camera picture.',
          )
      } else {
        const next = await requestStatus(command)
        if (version === commandVersion.current) setStatus(next)
      }
    } catch {
      if (version === commandVersion.current) {
        setStatus(null)
        setError(
          emergencyStop
            ? 'Camera Stop was not confirmed. Use the physical camera remote and check the picture before continuing.'
            : command.type === 'ptz'
              ? 'Camera movement could not be confirmed. Press Stop camera and check the picture before continuing.'
              : 'Could not confirm the change. Check the picture and broadcast status before trying again.',
        )
      }
    } finally {
      pendingCommands.current--
      if (pendingCommands.current === 0) setBusy(false)
    }
  }

  return (
    <Dashboard
      status={status}
      busy={busy}
      error={error}
      loading={loading}
      audioMeters={obsMode ? audioMeters : []}
      cameraNotice={cameraNotice}
      onCommand={(command) => {
        void send(command)
      }}
    />
  )
}
