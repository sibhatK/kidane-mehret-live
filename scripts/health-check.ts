import process from 'node:process'
import { execFile, execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import type { AudioMeter, Status } from '@kidane/shared'

export interface Check {
  name: string
  state: 'PASS' | 'FAIL' | 'NOT VERIFIED'
  detail: string
  next?: string
}

interface Options {
  dashboardUrl?: string
  agentUrl?: string
  previewUrl?: string
  savedDashboardUrl?: string
  waitMs?: number
  requestMs?: number
  signal?: AbortSignal
  fetcher?: typeof fetch
  udpListener?: () => Promise<boolean>
}

type Probe<T> = { ok: true; value: T } | { ok: false }

export async function readinessChecks(options: Options = {}): Promise<Check[]> {
  const dashboardUrl = options.dashboardUrl ?? 'http://127.0.0.1:5173'
  const agentUrl = options.agentUrl ?? 'http://127.0.0.1:3001'
  const previewUrl = options.previewUrl ?? 'http://127.0.0.1:8889/live'
  let savedDashboardUrl = options.savedDashboardUrl
  if (!savedDashboardUrl) {
    try {
      const host =
        process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS ||
        `${execFileSync('scutil', ['--get', 'LocalHostName'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .trim()
          .toLowerCase()}.local`
      savedDashboardUrl = `http://${host}:5173`
    } catch {
      savedDashboardUrl = 'http://unavailable.local:5173'
    }
  }
  const hostnamePreviewUrl = new URL(previewUrl)
  hostnamePreviewUrl.hostname = new URL(savedDashboardUrl).hostname
  const deadline = Date.now() + (options.waitMs ?? 0)
  const fetcher = options.fetcher ?? fetch

  async function probe<T>(
    url: string,
    parse: (response: Response) => Promise<T>,
  ): Promise<Probe<T>> {
    do {
      if (options.signal?.aborted) return { ok: false }
      try {
        const timeout = AbortSignal.timeout(options.requestMs ?? 1500)
        const signal = options.signal
          ? AbortSignal.any([timeout, options.signal])
          : timeout
        const response = await fetcher(url, {
          method: 'GET',
          signal,
          redirect: 'follow',
          cache: 'no-store',
        })
        if (response.ok) return { ok: true, value: await parse(response) }
        await response.body?.cancel()
      } catch {
        if (options.signal?.aborted) return { ok: false }
      }
      if (Date.now() >= deadline || options.signal?.aborted) break
      await delay(Math.min(250, deadline - Date.now()), undefined, {
        signal: options.signal,
      }).catch(() => undefined)
    } while (Date.now() < deadline)
    return { ok: false }
  }

  async function html(response: Response) {
    const text = await response.text()
    if (
      !response.headers.get('content-type')?.includes('text/html') ||
      !text.includes('<')
    )
      throw new Error('Invalid page')
    return true
  }
  async function status(response: Response): Promise<Status> {
    const { statusSchema } = await import('../packages/shared/dist/index.js')
    return statusSchema.parse(await response.json())
  }

  const [dashboard, agent, proxy, preview, hostname, hostnamePreview] =
    await Promise.all([
      probe(dashboardUrl, html),
      probe(`${agentUrl}/api/status`, status),
      probe(`${dashboardUrl}/api/status`, status),
      probe(previewUrl, html),
      probe(savedDashboardUrl, html),
      probe(hostnamePreviewUrl.toString(), html),
    ])
  const checks: Check[] = []
  function result(
    name: string,
    ok: boolean,
    detail: string,
    failure: string,
    next: string,
  ) {
    checks.push({
      name,
      state: ok ? 'PASS' : 'FAIL',
      detail: ok ? detail : failure,
      ...(!ok ? { next } : {}),
    })
  }
  result(
    'Dashboard HTTP (5173)',
    dashboard.ok,
    'The dashboard page responds on this Mac.',
    'The dashboard page is unavailable.',
    'Check this terminal for the first dashboard error. Fix it, then restart npm run live.',
  )
  result(
    'Agent status (3001)',
    agent.ok,
    'The agent returns a valid status response.',
    'The agent is unavailable or returned invalid status.',
    'Check this terminal for the first agent error. Do not change OBS stream settings.',
  )
  result(
    'Dashboard API proxy',
    proxy.ok && agent.ok && proxy.value.mode === agent.value.mode,
    'The browser-facing status API returns the expected mode.',
    'The dashboard cannot obtain valid agent status.',
    agent.ok
      ? 'Restart npm run live to reload the dashboard proxy. If it still fails, check apps/dashboard/vite.config.ts for the /api proxy to port 3001.'
      : 'Fix the agent check first, then run npm run health again.',
  )
  const obsConnected =
    agent.ok &&
    agent.value.mode === 'obs' &&
    agent.value.obs.connection === 'connected'
  result(
    'OBS authenticated connection',
    obsConnected,
    'The agent connected to OBS and read its output status.',
    agent.ok && agent.value.mode === 'simulated'
      ? 'The agent is in simulation mode, not connected to real OBS.'
      : 'OBS is disconnected or its status is unavailable.',
    'Open OBS, then check Tools > WebSocket Server Settings. Match its URL and password in the local .env; never paste the password into chat. Restart npm run live after editing .env.',
  )

  if (obsConnected) {
    const meters = await probe<AudioMeter[]>(
      `${dashboardUrl}/api/obs/audio-meters`,
      async (response) => {
        const { audioMetersSchema } =
          await import('../packages/shared/dist/index.js')
        return audioMetersSchema.parse(await response.json())
      },
    )
    result(
      'Audio-meter endpoint',
      meters.ok,
      'The dashboard receives a valid meter response.',
      'The meter endpoint is unavailable or returned invalid data.',
      'Check the agent terminal output, then run npm run health again. Do not change mixer routing during a service.',
    )
    const fresh = meters.ok
      ? meters.value.filter(
          (meter) =>
            Date.now() - meter.sampledAt >= 0 &&
            Date.now() - meter.sampledAt < 5000,
        )
      : []
    checks.push({
      name: 'Audio activity',
      state: fresh.some((meter) => meter.level > 0 && meter.peakDb > -60)
        ? 'PASS'
        : 'NOT VERIFIED',
      detail: fresh.some((meter) => meter.level > 0 && meter.peakDb > -60)
        ? 'Recent non-silent samples received; correct source/routing is not proven.'
        : 'No recent non-silent samples. Check a known input in OBS; silence alone is not a service failure.',
    })
  } else {
    checks.push({
      name: 'Audio meters',
      state: 'NOT VERIFIED',
      detail: 'Requires a real OBS connection first.',
    })
  }
  result(
    'MediaMTX page (8889)',
    preview.ok,
    'The local player page responds; this does not prove video flow.',
    'The local preview page is unavailable.',
    'Read the preview log: npm run mediamtx:native:logs for native mode, or docker compose logs --tail=30 mediamtx for Docker. Then restart npm run live.',
  )
  result(
    'Saved hostname dashboard link',
    hostname.ok,
    'The saved hostname serves the dashboard from this Mac.',
    'The saved .local link does not respond from this Mac.',
    'Confirm Wi-Fi is connected and run scutil --get LocalHostName. Use that exact name with .local:5173; do not disable the firewall.',
  )
  result(
    'Saved hostname preview link',
    hostnamePreview.ok,
    'The player page responds using the same hostname.',
    'The player page cannot be reached by hostname.',
    'Fix the MediaMTX and saved hostname checks above, then run npm run health again.',
  )
  const udpListener =
    options.udpListener ??
    (() =>
      new Promise<boolean>((resolve) => {
        execFile(
          'lsof',
          ['-nP', '-iUDP:8189'],
          { timeout: 1500 },
          (error, stdout) => resolve(!error && /:8189\b/.test(stdout)),
        )
      }))
  const udpBound = await udpListener().catch(() => false)
  result(
    'Local UDP socket (8189)',
    udpBound,
    'A local UDP socket is bound; this does not prove ICE connectivity.',
    'No UDP 8189 socket could be confirmed on this Mac.',
    'Check the MediaMTX log for its UDP/ICE listener on 8189. Do not disable the firewall or change router settings.',
  )
  checks.push(
    {
      name: 'WebRTC media (UDP 8189)',
      state: 'NOT VERIFIED',
      detail:
        'An HTTP or open-port check cannot prove ICE connectivity or video decoding.',
    },
    {
      name: 'iPad playback and audio routing',
      state: 'NOT VERIFIED',
      detail:
        'Open the saved link on the iPad and check video plus the intended OBS audio meters.',
    },
    {
      name: 'YouTube delivery / recording / PTZ',
      state: 'NOT VERIFIED',
      detail: 'No broadcast or recording was started, and no camera was moved.',
    },
  )
  return checks
}

export function printReadiness(
  checks: Check[],
  write: (line: string) => void = console.log,
) {
  write('\nReadiness report (read-only checks)')
  for (const check of checks)
    write(`[${check.state}] ${check.name}: ${check.detail}`)
  const failure = checks.find((check) => check.state === 'FAIL')
  if (failure) {
    write(`\nFix this first: ${failure.name}`)
    write(`1. ${failure.next}`)
    write('2. Run npm run health again. Fix one reported failure at a time.')
    write(
      'The dashboard may remain open while you fix settings. Do not start a broadcast to test readiness.',
    )
  } else {
    write('\nService checks passed; end-to-end readiness is not yet confirmed.')
    write('1. In OBS, manually start only Local Preview.')
    write(
      '2. Open the saved iPad link and verify video and the intended audio meters.',
    )
    write(
      '3. Verify YouTube in YouTube Studio only when a real broadcast is intended.',
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const checks = await readinessChecks()
    printReadiness(checks)
    process.exitCode = checks.some((check) => check.state === 'FAIL') ? 1 : 0
  } catch {
    console.error(
      '[FAIL] Health checks could not complete. Next step: run npm run live from the project folder, then retry npm run health. Do not share credentials.',
    )
    process.exitCode = 1
  }
}
