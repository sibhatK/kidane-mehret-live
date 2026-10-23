import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  rmSync,
} from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

describe('live app supervisor', () => {
  let directory: string
  let child: ChildProcess | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kidane-supervisor-'))
    mkdirSync(join(directory, 'bin'))
    mkdirSync(join(directory, 'scripts'))
    copyFileSync(
      new URL('../Start Kidane Mehret.command', import.meta.url),
      join(directory, 'Start Kidane Mehret.command'),
    )
    writeFileSync(join(directory, 'bin/uname'), '#!/bin/sh\necho Darwin\n', {
      mode: 0o755,
    })
    writeFileSync(
      join(directory, 'scripts/start-mac.sh'),
      'exec "$TEST_NODE" --import "$TEST_TSX" --import "$TEST_PRELOAD" "$TEST_SUPERVISOR"\n',
    )
    writeFileSync(
      join(directory, 'bin/npm'),
      '#!/bin/sh\nexec "$TEST_NODE" "$TEST_APP"\n',
      { mode: 0o755 },
    )
    writeFileSync(
      join(directory, 'preload.mjs'),
      `globalThis.fetch = async input => {
        if (!process.env.TEST_READY) throw new Error('fixture unavailable')
        const url = String(input)
        if (url.endsWith('/api/status')) return new Response(JSON.stringify({ mode: 'obs', camera: { connection: 'disconnected', preset: null }, audio: { connection: 'disconnected', muted: false }, obs: { connection: 'connected', recording: false }, broadcast: { connection: 'connected', state: 'idle', destination: 'OBS output' } }))
        if (url.endsWith('/audio-meters')) return new Response('[]')
        return new Response('<html>fixture dashboard</html>', { headers: { 'content-type': 'text/html' } })
      }\n`,
    )
    writeFileSync(
      join(directory, 'bin/open'),
      '#!/bin/sh\nprintf "%s\\n" "$1" >> "$TEST_OPENED"\n',
      { mode: 0o755 },
    )
    writeFileSync(
      join(directory, 'app.mjs'),
      `
      import fs from 'node:fs'
      fs.writeFileSync(process.env.TEST_PID, String(process.pid))
      if (process.env.TEST_EXIT) process.exit(Number(process.env.TEST_EXIT))
      process.on('SIGTERM', () => { fs.writeFileSync(process.env.TEST_STOPPED, 'SIGTERM'); process.exit(0) })
      process.on('SIGINT', () => { fs.writeFileSync(process.env.TEST_STOPPED, 'SIGINT'); process.exit(0) })
      console.log('fixture app ready')
      setInterval(() => {}, 1000)
    `,
    )
  })

  afterEach(() => {
    child?.kill('SIGKILL')
    const pidFile = join(directory, 'app.pid')
    if (existsSync(pidFile)) {
      try {
        process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGKILL')
      } catch {
        child = undefined
      }
    }
    rmSync(directory, { recursive: true, force: true })
  })

  function run(
    exit?: string,
    signal?: NodeJS.Signals,
    openBrowser = false,
    launcher = false,
  ) {
    return new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        child = spawn(
          launcher ? '/bin/bash' : process.execPath,
          launcher
            ? [join(directory, 'Start Kidane Mehret.command')]
            : [
                '--import',
                'tsx',
                '--import',
                join(directory, 'preload.mjs'),
                fileURLToPath(new URL('./live.ts', import.meta.url)),
              ],
          {
            env: {
              ...process.env,
              PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
              TEST_NODE: process.execPath,
              TEST_APP: join(directory, 'app.mjs'),
              TEST_PID: join(directory, 'app.pid'),
              TEST_STOPPED: join(directory, 'stopped'),
              TEST_EXIT: exit ?? '',
              KIDANE_OPEN_BROWSER: openBrowser ? '1' : '',
              TEST_READY: openBrowser ? '1' : '',
              TEST_OPENED: join(directory, 'opened'),
              TEST_TSX: import.meta.resolve('tsx'),
              TEST_PRELOAD: join(directory, 'preload.mjs'),
              TEST_SUPERVISOR: fileURLToPath(
                new URL('./live.ts', import.meta.url),
              ),
              __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: 'fixture.local',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        )
        let output = ''
        let sent = false
        child.stdout?.on('data', (chunk) => {
          output += chunk
          if (
            signal &&
            !sent &&
            output.includes(
              openBrowser ? 'Dashboard opened.' : 'fixture app ready',
            )
          ) {
            sent = true
            child?.kill(signal)
          }
        })
        child.stderr?.on('data', (chunk) => {
          output += chunk
        })
        child.once('error', reject)
        child.once('exit', (code) => resolve({ code, output }))
      },
    )
  }

  it('reports early application exit and cancels readiness retries', async () => {
    const result = await run('3')
    expect(result.code).toBe(3)
    expect(result.output).toContain('[FAIL] The app exited. Next step:')
    expect(result.output).not.toContain('Service checks passed')
  })

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'forwards %s to the child app and exits cleanly',
    async (signal) => {
      const result = await run(undefined, signal)
      expect(result.code).toBe(0)
      expect(readFileSync(join(directory, 'stopped'), 'utf8')).toBe(signal)
      expect(result.output).not.toContain('[FAIL] The app exited')
    },
  )

  it('opens the browser once after verified dashboard readiness and still shuts down cleanly', async () => {
    const result = await run(undefined, 'SIGTERM', true)
    expect(result.code).toBe(0)
    expect(result.output).toContain('Readiness report')
    expect(result.output).toContain('Dashboard opened.')
    expect(readFileSync(join(directory, 'opened'), 'utf8')).toBe(
      'http://localhost:5173\n',
    )
    expect(readFileSync(join(directory, 'stopped'), 'utf8')).toBe('SIGTERM')
  })

  it('forwards Terminal-close hangup through the launcher and cleans its lock', async () => {
    const result = await run(undefined, 'SIGHUP', false, true)
    expect(result.code).toBe(129)
    expect(readFileSync(join(directory, 'stopped'), 'utf8')).toBe('SIGTERM')
    expect(existsSync(join(directory, '.cache/mac-launcher.lock'))).toBe(false)
    expect(result.output).not.toContain('[FAIL] Startup did not finish')
  })
})
