import {
  canExecute,
  cameraSourceSchema,
  presetSchema,
  type AudioMeter,
  type BroadcastAction,
  type Command,
  type CameraSource,
  type Preset,
  type Status,
} from '@kidane/shared'
import { CameraPreview } from './CameraPreview'

interface Props {
  status: Status | null
  busy: boolean
  loading: boolean
  error: string | null
  audioMeters: AudioMeter[]
  onCommand: (command: Command) => void
}

type StatusTone = 'success' | 'danger' | 'warning' | 'neutral'
const sourceLabels: Record<CameraSource, string> = {
  main: 'Main camera',
  congregation: 'Congregation (iPad)',
}

const simulationStateLabels = {
  idle: 'Practice is stopped',
  prepared: 'Ready to practice',
  starting: 'Starting practice',
  streaming: 'Practice running — NOT LIVE',
  simulating: 'Practice running — NOT LIVE',
}

const obsStateLabels = {
  idle: 'Stream stopped in OBS',
  prepared: 'Connection checked',
  starting: 'Starting stream in OBS',
  streaming: 'OBS is streaming',
  simulating: 'Broadcast status unavailable',
}

export function Dashboard({
  status,
  busy,
  loading,
  error,
  audioMeters,
  onCommand,
}: Props) {
  const obsMode = status?.mode === 'obs'
  const practiceMode = status?.mode === 'simulated'
  const physicalCamera = status?.camera.control === 'ptzoptics'
  const scenes = status?.obs.scenes
  const receivingAudio =
    obsMode && status.obs.connection === 'connected' && audioMeters.length > 0
  const disabled = (command: Command) =>
    busy ||
    !status ||
    !canExecute(
      status,
      (physicalCamera && command.type === 'preset') ||
        (obsMode && command.type === 'scene')
        ? { ...command, confirmed: true }
        : command,
    )
  const devices = [
    {
      name: 'Camera',
      detail: physicalCamera
        ? 'PTZOptics Move 4K · saved shots'
        : obsMode
          ? 'Camera movement · preview is separate'
          : 'PTZOptics Move 4K',
      connection: status?.camera.connection,
      mock: !obsMode,
    },
    {
      name: 'Audio',
      detail: obsMode
        ? 'Sound levels from OBS · microphone not verified'
        : 'Church audio mixer',
      connection: obsMode
        ? receivingAudio
          ? 'connected'
          : status.obs.connection === 'disconnected'
            ? 'disconnected'
            : undefined
        : status?.audio.connection,
      mock: !obsMode,
    },
    {
      name: 'OBS',
      detail: obsMode ? 'OBS WebSocket' : 'Mac mini · OBS Studio',
      connection: status?.obs.connection,
      mock: !obsMode,
    },
    {
      name: 'Broadcast',
      detail: obsMode
        ? 'OBS connection · stream status below'
        : 'YouTube · simulation only',
      connection: status?.broadcast.connection,
      mock: !obsMode,
    },
  ] as const
  const label = status
    ? obsMode && status.obs.connection !== 'connected'
      ? 'Broadcast status unavailable'
      : (obsMode ? obsStateLabels : simulationStateLabels)[
          status.broadcast.state
        ]
    : 'Broadcast status unavailable'
  const streamState = status?.broadcast.state ?? 'idle'
  const active = ['starting', 'streaming', 'simulating'].includes(streamState)
  const primaryAction: BroadcastAction = active
    ? 'end'
    : streamState === 'prepared'
      ? 'go-live'
      : 'prepare'
  const actions: BroadcastAction[] =
    primaryAction === 'go-live' ? ['go-live', 'end'] : [primaryAction]
  const soundDetected = audioMeters.some(
    (meter) => meter.level > 0 && meter.peakDb > -60,
  )
  const clippingAudio = audioMeters.some((meter) => meter.peakDb >= 0)
  const highAudio = audioMeters.some((meter) => meter.peakDb >= -6)
  const connectionTone: StatusTone = !status
    ? loading
      ? 'warning'
      : 'danger'
    : practiceMode
      ? 'warning'
      : status.obs.connection === 'connected'
        ? 'success'
        : 'danger'
  const broadcastTone: StatusTone = !status
    ? 'warning'
    : practiceMode
      ? 'warning'
      : status.obs.connection === 'disconnected'
        ? 'danger'
        : streamState === 'prepared' || streamState === 'streaming'
          ? 'success'
          : streamState === 'starting' || streamState === 'simulating'
            ? 'warning'
            : 'neutral'
  const cameraTone: StatusTone =
    !status || practiceMode || !physicalCamera
      ? 'warning'
      : status.camera.connection !== 'connected'
        ? 'danger'
        : status.camera.availablePresets?.length
          ? 'success'
          : 'warning'
  const soundTone: StatusTone =
    !status || practiceMode
      ? 'warning'
      : status.obs.connection === 'disconnected'
        ? 'danger'
        : receivingAudio && clippingAudio
          ? 'danger'
          : receivingAudio && highAudio
            ? 'warning'
            : receivingAudio && soundDetected
              ? 'success'
              : 'warning'

  function actionLabel(action: BroadcastAction) {
    if (action === 'prepare')
      return practiceMode ? 'Check practice setup' : 'Check connection'
    if (action === 'go-live')
      return practiceMode ? 'Start practice' : 'Start livestream'
    if (streamState === 'prepared') return 'Cancel setup'
    if (streamState === 'starting') return 'Cancel start'
    return practiceMode ? 'End practice' : 'End livestream'
  }

  function sendBroadcastCommand(command: Command) {
    if (
      obsMode &&
      command.type === 'broadcast' &&
      (command.action === 'go-live' || command.action === 'end')
    ) {
      const message =
        command.action === 'go-live'
          ? 'Start the broadcast now? This starts the output configured in OBS, and people may be able to watch immediately.'
          : 'Stop or cancel the broadcast configured in OBS? Viewers may lose the picture.'
      if (!window.confirm(message)) return
      onCommand({ ...command, confirmed: true })
      return
    }
    onCommand(command)
  }

  function recallPreset(preset: Preset) {
    const command = { type: 'preset', preset } as const
    if (physicalCamera) {
      if (
        !window.confirm(
          `Switch to the saved ${preset} shot? The physical camera will move, and viewers may see the movement.`,
        )
      )
        return
      onCommand({ ...command, confirmed: true })
      return
    }
    onCommand(command)
  }

  function selectSource(source: CameraSource) {
    if (scenes?.active === source) return
    const command = { type: 'scene', source } as const
    if (obsMode) {
      if (
        !window.confirm(
          `Switch the broadcast picture to ${sourceLabels[source]} now? Viewers may see the change immediately. The stream stays running; sound follows the scene's OBS setup.`,
        )
      )
        return
      onCommand({ ...command, confirmed: true })
      return
    }
    onCommand(command)
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Kidane Mehret Live</h1>
        </div>
        <span className="status-badge self-center" data-tone={connectionTone}>
          {!status
            ? loading
              ? 'Connecting'
              : 'Connection lost'
            : obsMode
              ? status.obs.connection === 'connected'
                ? 'OBS connected'
                : 'OBS not connected'
              : 'Practice mode'}
        </span>
      </header>

      {status?.mode === 'simulated' && (
        <aside className="status-callout text-sm" data-tone="warning">
          Practice only. These controls do not start a real broadcast.
        </aside>
      )}

      {(loading || busy || !status) && (
        <div
          role="status"
          aria-live="polite"
          className="status-copy text-sm"
          data-tone={!status && !loading ? 'danger' : 'neutral'}
        >
          {loading
            ? 'Connecting to the streaming computer…'
            : busy
              ? obsMode
                ? 'Making the change…'
                : 'Updating practice…'
              : 'Connection lost. The broadcast may still be running.'}
        </div>
      )}
      {error && (
        <p role="alert" className="status-callout" data-tone="danger">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <section className="min-w-0" aria-labelledby="camera-heading">
          <h2 id="camera-heading" className="text-xl font-semibold">
            Picture
          </h2>
          <div
            role="group"
            aria-label="Picture source"
            className="mt-3 grid grid-cols-2 gap-2"
          >
            {cameraSourceSchema.options.map((source) => {
              const command = { type: 'scene', source } as const
              return (
                <button
                  key={source}
                  className="control text-sm"
                  aria-pressed={Boolean(
                    status?.obs.connection === 'connected' &&
                    scenes?.connection === 'connected' &&
                    scenes.active === source,
                  )}
                  disabled={disabled(command)}
                  onClick={() => selectSource(source)}
                >
                  {sourceLabels[source]}
                </button>
              )
            })}
          </div>
          <p role="status" className="text-muted mt-2 text-sm">
            {!status
              ? 'Picture source unavailable.'
              : practiceMode
                ? 'Practice picture sources only.'
                : !scenes?.configured.length
                  ? 'Camera switching needs setup by an operator.'
                  : status.obs.connection !== 'connected' ||
                      scenes.connection !== 'connected'
                    ? 'Picture source unavailable. Check the OBS connection.'
                    : scenes.active
                      ? `Selected in OBS: ${sourceLabels[scenes.active]}`
                      : 'OBS is showing another scene. Neither camera is selected.'}
          </p>
          {obsMode &&
          scenes?.configured.length &&
          cameraSourceSchema.options.some(
            (source) => !scenes.available.includes(source),
          ) ? (
            <p className="status-copy mt-1 text-sm" data-tone="warning">
              Unavailable cameras need setup in OBS. A listed scene does not
              prove its video feed is working.
            </p>
          ) : null}
          <CameraPreview url={import.meta.env.VITE_MEDIAMTX_WEBRTC_URL} />
          <h3 className="mt-5 font-semibold">Main camera shots</h3>
          <div
            role="group"
            aria-label={
              !status
                ? 'Camera shots unavailable'
                : physicalCamera
                  ? 'Main camera shots'
                  : obsMode
                    ? 'Camera shots unavailable'
                    : 'Practice camera shots'
            }
            className="mt-3 grid grid-cols-3 gap-3"
          >
            {presetSchema.options.map((preset) => {
              const command = { type: 'preset', preset } as const
              return (
                <button
                  className="control"
                  key={preset}
                  aria-pressed={status?.camera.preset === preset}
                  disabled={disabled(command)}
                  onClick={() => recallPreset(preset)}
                >
                  {preset}
                </button>
              )
            })}
          </div>
          <p className="status-copy mt-4 text-sm" data-tone={cameraTone}>
            {!status
              ? 'Camera status unavailable.'
              : physicalCamera
                ? status?.camera.connection !== 'connected'
                  ? 'Camera not connected. Ask the operator to check it.'
                  : !status.camera.availablePresets?.length
                    ? 'Camera shots need setup by an operator.'
                    : 'Saved shots available. Changing shots moves the camera.'
                : obsMode
                  ? 'Camera shots need setup by an operator.'
                  : 'Practice camera shots only.'}
          </p>
          {physicalCamera && status?.camera.lastRequestedPreset && (
            <p role="status" className="text-muted mt-2 text-sm">
              Shot requested: {status.camera.lastRequestedPreset}. Check the
              picture.
            </p>
          )}
        </section>

        <section className="min-w-0" aria-labelledby="broadcast-heading">
          <h2 id="broadcast-heading" className="text-xl font-semibold">
            {practiceMode ? 'Practice broadcast' : 'Livestream'}
          </h2>
          <p
            className="status-callout mb-3 mt-4 text-lg font-semibold"
            role="status"
            data-tone={broadcastTone}
          >
            {label}
          </p>
          <p className="text-muted mb-4 text-sm">
            {!status
              ? 'Broadcast status is unknown.'
              : !obsMode
                ? 'No real broadcast starts in practice mode.'
                : status.obs.connection !== 'connected'
                  ? 'Open OBS on the Mac to reconnect.'
                  : streamState === 'prepared'
                    ? 'Connection checked. Confirm the picture and sound before starting.'
                    : active
                      ? 'Confirm viewers receive picture and sound in YouTube Studio.'
                      : 'Connection check needed before starting.'}
          </p>
          <div className="grid gap-3">
            {actions.map((action) => {
              const command = { type: 'broadcast', action } as const
              const availabilityCommand =
                obsMode && (action === 'go-live' || action === 'end')
                  ? { ...command, confirmed: true as const }
                  : command
              return (
                <button
                  className={`control text-base ${action === primaryAction ? (action === 'end' && active ? 'control-danger' : action === 'go-live' && obsMode ? 'control-success' : 'control-primary') : ''}`}
                  key={action}
                  disabled={disabled(availabilityCommand)}
                  onClick={() => sendBroadcastCommand(command)}
                >
                  {actionLabel(action)}
                </button>
              )
            })}
          </div>
          {obsMode && status && (
            <p
              className="status-copy mt-3 text-sm"
              data-tone={
                status.obs.connection !== 'connected' ||
                status.obs.recording === null
                  ? 'warning'
                  : status.obs.recording
                    ? 'success'
                    : 'neutral'
              }
            >
              {status.obs.connection !== 'connected' ||
              status.obs.recording === null
                ? 'Recording status unknown'
                : status.obs.recording
                  ? 'Recording active'
                  : 'Recording stopped'}
            </p>
          )}

          <div className="divider mt-6 border-t pt-4" aria-label="Sound levels">
            <h3 className="font-semibold">Sound</h3>
            <p
              role="status"
              className="status-copy mt-2 text-sm"
              data-tone={soundTone}
            >
              {!status
                ? 'Sound status unavailable.'
                : obsMode && status.obs.connection === 'disconnected'
                  ? 'OBS not connected. Sound levels unavailable.'
                  : !obsMode
                    ? 'Sound check unavailable in practice mode.'
                    : !audioMeters.length
                      ? 'Waiting for sound levels.'
                      : clippingAudio
                        ? 'Sound may be clipping. Ask the operator to lower it in OBS.'
                        : highAudio
                          ? 'Sound level is high. Check the microphone in OBS.'
                          : soundDetected
                            ? 'Sound detected. Confirm the intended microphone.'
                            : 'No sound detected. Check the microphone in OBS.'}
            </p>
            {receivingAudio &&
              audioMeters.map((meter) => (
                <div className="mt-3" key={meter.inputName}>
                  <p className="text-muted truncate text-sm">
                    {meter.inputName}
                  </p>
                  <div
                    className="meter-track"
                    role="meter"
                    aria-label={`${meter.inputName} OBS audio level`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(meter.level * 100)}
                  >
                    <div
                      className="meter-fill"
                      data-tone={
                        meter.peakDb >= 0
                          ? 'danger'
                          : meter.peakDb >= -6
                            ? 'warning'
                            : 'success'
                      }
                      style={{ width: `${meter.level * 100}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>

      <details className="divider border-t pt-4">
        <summary className="text-muted cursor-pointer py-2 font-semibold">
          Setup details
        </summary>
        <p className="text-muted mb-4 mt-2 text-sm">
          Picture, camera position, and microphone routing need operator
          verification. OBS status does not confirm YouTube delivery. Camera
          recall acknowledgement does not confirm arrival.
        </p>
        <section
          aria-label={
            obsMode ? 'OBS and device status' : 'Simulated connection status'
          }
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {devices.map(({ name, detail, connection, mock }) => {
            const cameraNeedsSetup =
              obsMode && name === 'Camera' && !physicalCamera
            const tone: StatusTone =
              mock || cameraNeedsSetup
                ? 'warning'
                : connection === 'disconnected'
                  ? 'danger'
                  : connection !== 'connected' ||
                      (name === 'Camera' &&
                        !status?.camera.availablePresets?.length)
                    ? 'warning'
                    : 'success'
            return (
              <article className="panel" key={name}>
                <h2 className="text-lg font-semibold">{name}</h2>
                <p className="text-muted mt-1 text-sm">{detail}</p>
                <p className="status-copy mt-4 font-medium" data-tone={tone}>
                  <span aria-hidden="true" className="status-dot" />
                  {name === 'Audio' && obsMode
                    ? status.obs.connection === 'disconnected'
                      ? 'OBS not connected'
                      : receivingAudio
                        ? 'Receiving sound levels'
                        : 'Waiting for sound levels'
                    : name === 'Camera' && obsMode
                      ? cameraNeedsSetup
                        ? 'Camera controls need setup'
                        : connection !== 'connected'
                          ? 'Camera not connected'
                          : status.camera.availablePresets?.length
                            ? 'Saved shots available'
                            : 'Camera connected · shots need setup'
                      : connection === 'connected'
                        ? mock
                          ? 'Connected (mock)'
                          : 'Connected'
                        : connection === 'disconnected'
                          ? mock
                            ? 'Disconnected (mock)'
                            : 'Disconnected'
                          : 'Unknown'}
                </p>
                {name === 'OBS' && obsMode && status && (
                  <p className="text-muted mt-1 text-sm">
                    Recording
                    {status.obs.connection !== 'connected' ||
                    status.obs.recording === null
                      ? ' unknown'
                      : status.obs.recording
                        ? ' active'
                        : ' inactive'}
                  </p>
                )}
                {name === 'Audio' && status && !obsMode && (
                  <p className="text-muted mt-1 text-sm">
                    {status.audio.muted
                      ? 'Muted (simulated)'
                      : 'Unmuted (simulated)'}
                  </p>
                )}
              </article>
            )
          })}
        </section>
      </details>
    </main>
  )
}
