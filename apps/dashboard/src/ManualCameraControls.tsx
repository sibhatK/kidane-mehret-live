import { useEffect, useEffectEvent, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  canExecute,
  type Command,
  type PtzAction,
  type Status,
} from '@kidane/shared'

interface Props {
  status: Status | null
  busy: boolean
  notice: string | null
  onCommand: (command: Command) => void
}

const directions = [
  {
    action: 'up',
    label: 'Tilt up',
    Icon: ArrowUp,
    position: 'col-start-2 row-start-1',
  },
  {
    action: 'left',
    label: 'Pan left',
    Icon: ArrowLeft,
    position: 'col-start-1 row-start-2',
  },
  {
    action: 'right',
    label: 'Pan right',
    Icon: ArrowRight,
    position: 'col-start-3 row-start-2',
  },
  {
    action: 'down',
    label: 'Tilt down',
    Icon: ArrowDown,
    position: 'col-start-2 row-start-3',
  },
] as const

export function ManualCameraControls({
  status,
  busy,
  notice,
  onCommand,
}: Props) {
  const [armed, setArmed] = useState(false)
  const ready = Boolean(
    status &&
    canExecute(status, { type: 'ptz', action: 'left', confirmed: true }),
  )
  const release = useEffectEvent(() => {
    if (armed) {
      setArmed(false)
      onCommand({ type: 'ptz', action: 'stop' })
    }
  })
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) release()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [])

  function stop() {
    setArmed(false)
    onCommand({ type: 'ptz', action: 'stop' })
  }
  function nudge(action: Exclude<PtzAction, 'stop'>) {
    if (!armed || !ready || busy) return
    onCommand({ type: 'ptz', action, confirmed: true })
  }
  const tone =
    status?.camera.manualState === 'stop-unconfirmed'
      ? 'danger'
      : armed && ready
        ? 'success'
        : 'warning'

  return (
    <section
      aria-labelledby="manual-camera-heading"
      className="divider mt-5 border-t pt-4"
    >
      <h3 id="manual-camera-heading" className="font-semibold">
        Adjust main camera
      </h3>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="size-5 accent-neutral-800"
          checked={armed}
          disabled={(!ready || busy) && !armed}
          onChange={(event) => {
            if (!event.target.checked) {
              stop()
              return
            }
            if (
              status?.mode === 'obs' &&
              !window.confirm(
                'Allow slow adjustments of the main camera? Auto-tracking must be off. The camera will move in short steps and viewers may see the movement.',
              )
            )
              return
            setArmed(true)
          }}
        />
        Allow camera movement
      </label>
      <div
        role="group"
        aria-label="Main camera movement"
        className="mt-3 flex flex-wrap items-start gap-4"
      >
        <div className="grid w-48 max-w-full grid-cols-3 auto-rows-14 gap-2">
          {directions.map(({ action, label, Icon, position }) => (
            <button
              key={action}
              className={`control flex items-center justify-center px-0 ${position}`}
              aria-label={label}
              title={`${label} (short slow step)`}
              disabled={!armed || !ready || busy}
              onKeyDown={(event) => {
                if (event.repeat) event.preventDefault()
              }}
              onClick={() => nudge(action)}
            >
              <Icon aria-hidden="true" size={22} />
            </button>
          ))}
          <button
            className="control control-danger col-start-2 row-start-2 flex flex-col items-center justify-center gap-1 px-0"
            aria-label="Stop camera"
            title="Stop camera movement and zoom"
            onClick={stop}
          >
            <Square aria-hidden="true" size={17} fill="currentColor" />
            <span className="text-xs">Stop</span>
          </button>
        </div>
        <div className="grid auto-rows-14 gap-2">
          <button
            className="control flex items-center justify-center"
            aria-label="Zoom in"
            title="Zoom in (short slow step)"
            disabled={!armed || !ready || busy}
            onKeyDown={(event) => {
              if (event.repeat) event.preventDefault()
            }}
            onClick={() => nudge('zoom-in')}
          >
            <ZoomIn aria-hidden="true" size={22} />
          </button>
          <button
            className="control flex items-center justify-center"
            aria-label="Zoom out"
            title="Zoom out (short slow step)"
            disabled={!armed || !ready || busy}
            onKeyDown={(event) => {
              if (event.repeat) event.preventDefault()
            }}
            onClick={() => nudge('zoom-out')}
          >
            <ZoomOut aria-hidden="true" size={22} />
          </button>
        </div>
      </div>
      <p role="status" className="status-copy mt-3 text-sm" data-tone={tone}>
        {!status
          ? 'Camera status unknown. Stop can still be attempted.'
          : status.camera.manualState === 'stop-unconfirmed'
            ? 'Stop not confirmed. Use the physical camera remote before continuing.'
            : status.mode === 'simulated'
              ? 'Practice movement only.'
              : !status.camera.manualEnabled
                ? 'Manual movement needs setup by an operator.'
                : status.camera.connection !== 'connected'
                  ? 'Camera not connected. Use the physical remote if it keeps moving.'
                  : status.camera.manualState === 'nudging'
                    ? 'Adjusting the main camera.'
                    : armed
                      ? 'Slow movement enabled. Check framing in the picture.'
                      : 'Camera movement locked.'}
      </p>
      {notice && (
        <p
          role="status"
          className="status-copy mt-2 text-sm"
          data-tone="warning"
        >
          {notice}
        </p>
      )}
    </section>
  )
}
