import process from 'node:process'
import { spawn } from 'node:child_process'
import { readinessChecks, printReadiness } from './health-check.js'

const controller = new AbortController()
const app = spawn('npm', ['run', 'dev'], { stdio: 'inherit', detached: true })
let stopping = false
let shutdownTimer: ReturnType<typeof setTimeout> | undefined

function signalApp(signal: NodeJS.Signals) {
  if (!app.pid) return
  try {
    process.kill(-app.pid, signal)
  } catch {
    return
  }
}

function stop(signal: NodeJS.Signals) {
  stopping = true
  controller.abort()
  signalApp(signal)
  shutdownTimer ??= setTimeout(() => signalApp('SIGKILL'), 5000)
  shutdownTimer.unref()
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

const exited = new Promise<number>((resolve) => {
  app.once('error', () => resolve(1))
  app.once('exit', (code) => resolve(stopping ? 0 : (code ?? 1)))
})

const checking = readinessChecks({ waitMs: 30_000, signal: controller.signal })
  .then((checks) => {
    if (!controller.signal.aborted) printReadiness(checks)
  })
  .catch(() => {
    if (!controller.signal.aborted)
      console.error(
        '[FAIL] Readiness checks could not complete. Next step: run npm run health in another project terminal. Do not start a broadcast to test it.',
      )
  })

const code = await exited
controller.abort()
signalApp('SIGTERM')
if (shutdownTimer) clearTimeout(shutdownTimer)
await checking
if (!stopping)
  console.error(
    '[FAIL] The app exited. Next step: fix the first error in the app logs above, then run npm run live again. No OBS/YouTube output was changed.',
  )
process.exitCode = stopping ? 0 : code || 1
