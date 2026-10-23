import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

describe('Mac live startup', () => {
  it('runs the double-click launcher from its own folder, even with spaces in its path', () => {
    const folder = join(directory, 'project with spaces')
    mkdirSync(join(folder, 'scripts'), { recursive: true })
    const launcher = join(folder, 'Start Kidane Mehret.command')
    copyFileSync(
      new URL('../Start Kidane Mehret.command', import.meta.url),
      launcher,
    )
    writeFileSync(
      join(folder, 'scripts/start-mac.sh'),
      'printf "launcher:%s|%s\\n" "$1" "$PWD" >> "$CALL_LOG"\n',
    )
    const result = spawnSync('/bin/bash', [launcher], {
      cwd: '/',
      encoding: 'utf8',
      env: {
        PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
        CALL_LOG: logFile,
      },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toBe(
      `launcher:--open-browser|${folder}\n`,
    )
    expect(result.stdout).toContain(
      'No broadcast or recording starts automatically',
    )
    expect(() =>
      readFileSync(join(folder, '.cache/mac-launcher.lock/pid')),
    ).toThrow()
  })

  it('keeps the launcher failure guidance and exit code without starting anything else', () => {
    const launcher = join(directory, 'Start Kidane Mehret.command')
    copyFileSync(
      new URL('../Start Kidane Mehret.command', import.meta.url),
      launcher,
    )
    writeFileSync(
      join(directory, 'scripts/start-mac.sh'),
      'printf "[FAIL] Fixture startup error\\n"; exit 7\n',
    )
    const result = spawnSync('/bin/bash', [launcher], {
      encoding: 'utf8',
      env: { PATH: `${join(directory, 'bin')}:/usr/bin:/bin` },
    })
    expect(result.status).toBe(7)
    expect(result.stdout).toContain('Fixture startup error')
    expect(result.stdout).toContain('Next step: follow the first error above')
  })

  it('reuses an active launcher without restarting its services or removing its lock', () => {
    const launcher = join(directory, 'Start Kidane Mehret.command')
    copyFileSync(
      new URL('../Start Kidane Mehret.command', import.meta.url),
      launcher,
    )
    const lock = join(directory, '.cache/mac-launcher.lock')
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'pid'), String(process.pid))
    writeFileSync(
      join(directory, 'scripts/start-mac.sh'),
      'printf "reuse:%s\\n" "$1" >> "$CALL_LOG"\n',
    )
    const result = spawnSync('/bin/bash', [launcher], {
      encoding: 'utf8',
      env: {
        PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
        CALL_LOG: logFile,
        MOCK_PROCESS_COMMAND: `/bin/bash ${launcher}`,
      },
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toBe('reuse:--open-existing\n')
    expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(process.pid))
  })

  it('does not start a second instance while the first launcher is still acquiring its lock', () => {
    const launcher = join(directory, 'Start Kidane Mehret.command')
    copyFileSync(
      new URL('../Start Kidane Mehret.command', import.meta.url),
      launcher,
    )
    mkdirSync(join(directory, '.cache/mac-launcher.lock'), { recursive: true })
    writeFileSync(
      join(directory, 'scripts/start-mac.sh'),
      'printf "reuse:%s\\n" "$1" >> "$CALL_LOG"; exit 1\n',
    )
    const result = spawnSync('/bin/bash', [launcher], {
      encoding: 'utf8',
      env: {
        PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
        CALL_LOG: logFile,
      },
    })
    expect(result.status).toBe(1)
    expect(readFileSync(logFile, 'utf8')).toBe('reuse:--open-existing\n')
    expect(result.stdout).toContain('check the first launcher window')
  })

  it.each(['99999999', 'garbage', 'reused'])(
    'recovers a stale launcher lock without signaling another process: %s',
    (value) => {
      const launcher = join(directory, 'Start Kidane Mehret.command')
      copyFileSync(
        new URL('../Start Kidane Mehret.command', import.meta.url),
        launcher,
      )
      const lock = join(directory, '.cache/mac-launcher.lock')
      mkdirSync(lock, { recursive: true })
      writeFileSync(
        join(lock, 'pid'),
        value === 'reused' ? String(process.pid) : value,
      )
      writeFileSync(
        join(directory, 'scripts/start-mac.sh'),
        'printf "launch:%s\\n" "$1" >> "$CALL_LOG"\n',
      )
      const result = spawnSync('/bin/bash', [launcher], {
        encoding: 'utf8',
        env: {
          PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
          CALL_LOG: logFile,
        },
      })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(logFile, 'utf8')).toBe('launch:--open-browser\n')
      expect(() => process.kill(process.pid, 0)).not.toThrow()
    },
  )

  let directory: string
  let logFile: string

  function command(name: string, body: string) {
    writeFileSync(join(directory, 'bin', name), `#!/bin/sh\n${body}\n`, {
      mode: 0o755,
    })
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kidane-startup-'))
    logFile = join(directory, 'calls.log')
    mkdirSync(join(directory, 'bin'))
    mkdirSync(join(directory, 'scripts'))
    mkdirSync(join(directory, 'home'))
    copyFileSync(
      new URL('./start-mac.sh', import.meta.url),
      join(directory, 'scripts/start-mac.sh'),
    )
    copyFileSync(
      new URL('./mediamtx-native.sh', import.meta.url),
      join(directory, 'scripts/mediamtx-native.sh'),
    )
    writeFileSync(join(directory, '.env'), 'MEDIAMTX_LAN_IP=192.168.1.231\n')
    writeFileSync(logFile, '')
    command('uname', 'echo Darwin')
    command('scutil', 'echo "${MOCK_HOST:-Mac-mini}"')
    command('networksetup', 'printf "Hardware Port: Wi-Fi\\nDevice: en7\\n"')
    command(
      'ipconfig',
      'test "$2" = en7 || exit 1; printf "%s\\n" "${MOCK_IP-192.168.1.206}"',
    )
    command('docker', 'exit "${DOCKER_EXIT:-1}"')
    command(
      'ps',
      'printf "%s\\n" "${MOCK_PROCESS_COMMAND:-/usr/bin/unrelated}"',
    )
    command(
      'lsof',
      'case "$*" in *":${BUSY_PORT:-none}"*) exit 0;; *) exit 1;; esac',
    )
    command('curl', 'exit 0')
    command(
      'npm',
      'printf "app:%s|%s|%s|%s\\n" "$*" "$MEDIAMTX_LAN_IP" "$VITE_MEDIAMTX_WEBRTC_URL" "$__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS" >> "$CALL_LOG"',
    )
    command(
      'node',
      'printf "app:%s|%s|%s|%s\\n" "$*" "$MEDIAMTX_LAN_IP" "$VITE_MEDIAMTX_WEBRTC_URL" "$__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS" >> "$CALL_LOG"',
    )
    writeFileSync(
      join(directory, 'scripts/mediamtx.sh'),
      'printf "media:%s|%s|%s\\n" "$1" "$MEDIAMTX_BACKEND" "$MEDIAMTX_LAN_IP" >> "$CALL_LOG"\nif [[ "${MEDIA_FAIL:-}" == "$1" ]]; then exit 1; fi\n',
    )
  })

  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  function run(
    args: string[] = [],
    overrides: Record<string, string> = {},
    script = 'start-mac.sh',
  ) {
    return spawnSync(
      '/bin/bash',
      [join(directory, 'scripts', script), ...args],
      {
        encoding: 'utf8',
        env: {
          HOME: join(directory, 'home'),
          PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
          CALL_LOG: logFile,
          MEDIAMTX_BACKEND: 'native',
          ...overrides,
        },
      },
    )
  }

  it('checks the current Wi-Fi address and hostname without starting services', () => {
    const result = run(['--check'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Wi-Fi/LAN IP: 192.168.1.206')
    expect(result.stdout).toContain('http://mac-mini.local:5173')
    expect(readFileSync(logFile, 'utf8')).toBe('')
  })

  it('enables automatic opening only for launcher startup', () => {
    command(
      'node',
      'printf "open:%s|%s\\n" "$*" "${KIDANE_OPEN_BROWSER:-}" >> "$CALL_LOG"',
    )
    const result = run(['--open-browser'])
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toContain(
      'open:--import tsx scripts/live.ts|1',
    )
  })

  it.each(['5173', '3001'])(
    'launcher reuse checks an occupied port %s without restarting preview',
    (port) => {
      const result = run(['--open-browser'], { BUSY_PORT: port })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(logFile, 'utf8')).toContain(
        'app:--import tsx scripts/health-check.ts --open-dashboard',
      )
      expect(readFileSync(logFile, 'utf8')).not.toContain('media:')
    },
  )

  it('can reopen an existing local dashboard without a new Wi-Fi connection or service changes', () => {
    const result = run(['--open-existing'], { MOCK_IP: '' })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toContain(
      'app:--import tsx scripts/health-check.ts --open-dashboard',
    )
    expect(readFileSync(logFile, 'utf8')).not.toContain('media:')
  })

  it('hands bootstrap completion to live startup with the selected runtime and IP', () => {
    const source = readFileSync(
      new URL('./bootstrap-mac.sh', import.meta.url),
      'utf8',
    )
    const handoff = source.slice(source.lastIndexOf('\nnpm ci\n'))
    const result = spawnSync('/bin/bash', ['-c', handoff], {
      encoding: 'utf8',
      env: {
        PATH: `${join(directory, 'bin')}:/usr/bin:/bin`,
        CALL_LOG: logFile,
        mediamtx_backend: 'native',
        lan_ip: '10.0.0.25',
      },
    })
    expect(result.status, result.stderr).toBe(0)
    const calls = readFileSync(logFile, 'utf8')
    expect(calls).toContain('app:run live|10.0.0.25|')
    expect(calls).not.toContain('mediamtx:start')
    expect(calls).not.toContain('app:run dev')
    expect(result.stdout).toContain('read-only readiness checks')
  })

  it('refreshes native preview before starting the app, overriding stale file settings', () => {
    const result = run([], {
      VITE_MEDIAMTX_WEBRTC_URL: 'http://old-ip:8889/live',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(logFile, 'utf8').trim().split('\n')).toEqual([
      'media:stop|native|192.168.1.206',
      'media:start|native|192.168.1.206',
      'app:--import tsx scripts/live.ts|192.168.1.206|http://mac-mini.local:8889/live|mac-mini.local',
    ])
    expect(readFileSync(join(directory, '.env'), 'utf8')).toBe(
      'MEDIAMTX_LAN_IP=192.168.1.231\n',
    )
  })

  it('uses a changed DHCP address and another Mac name on the next startup', () => {
    const result = run([], {
      MOCK_IP: '192.168.1.177',
      MOCK_HOST: 'Practice-Mac',
    })
    expect(result.status).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toContain(
      'app:--import tsx scripts/live.ts|192.168.1.177|http://practice-mac.local:8889/live|practice-mac.local',
    )
  })

  it('chooses Docker when its engine is ready', () => {
    const result = run([], { MEDIAMTX_BACKEND: 'auto', DOCKER_EXIT: '0' })
    expect(result.status).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toContain(
      'media:start|docker|192.168.1.206',
    )
  })

  it('falls back to native when Docker is unavailable', () => {
    expect(run([], { MEDIAMTX_BACKEND: 'auto' }).status).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toContain(
      'media:start|native|192.168.1.206',
    )
  })

  function pidFile(value: string) {
    const state = join(directory, 'home/.local/state/kidane-mehret-live')
    mkdirSync(state, { recursive: true })
    const file = join(state, 'mediamtx.pid')
    writeFileSync(file, value)
    return file
  }

  it.each(['', 'garbage', '0', '-1', '99999999'])(
    'ignores a stale or invalid PID file containing %j',
    (pid) => {
      const file = pidFile(pid)
      const result = run([], { MEDIAMTX_BACKEND: 'auto', DOCKER_EXIT: '0' })
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(logFile, 'utf8')).toContain(
        'media:start|docker|192.168.1.206',
      )
      expect(readFileSync(file, 'utf8')).toBe(pid)
    },
  )

  it('does not select or signal a reused PID whose arguments merely mention MediaMTX', () => {
    const file = pidFile(String(process.pid))
    const binary = join(
      directory,
      'home/.local/share/kidane-mehret-live/mediamtx-1.21.2/mediamtx',
    )
    const result = run([], {
      MEDIAMTX_BACKEND: 'auto',
      DOCKER_EXIT: '0',
      MOCK_PROCESS_COMMAND: `/usr/bin/unrelated ${binary}`,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toContain(
      'media:start|docker|192.168.1.206',
    )
    expect(readFileSync(file, 'utf8')).toBe(String(process.pid))
    expect(() => process.kill(process.pid, 0)).not.toThrow()
  })

  it('prefers a verified live native process even when Docker is ready', () => {
    pidFile(String(process.pid))
    const binary = join(
      directory,
      'home/.local/share/kidane-mehret-live/mediamtx-1.21.2/mediamtx',
    )
    const result = run([], {
      MEDIAMTX_BACKEND: 'auto',
      DOCKER_EXIT: '0',
      MOCK_PROCESS_COMMAND: `${binary} ${binary}.yml`,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toContain(
      'media:start|native|192.168.1.206',
    )
  })

  it.each(['start', 'stop'])(
    'standalone preview %s ignores a stale PID when Docker is ready',
    (action) => {
      const file = pidFile('99999999')
      copyFileSync(
        new URL('./mediamtx.sh', import.meta.url),
        join(directory, 'scripts/mediamtx.sh'),
      )
      command(
        'docker',
        'printf "docker:%s\\n" "$*" >> "$CALL_LOG"; case "$*" in *"ps -q mediamtx"*) echo fixture-container;; esac; exit 0',
      )
      const result = run([action], { MEDIAMTX_BACKEND: 'auto' }, 'mediamtx.sh')
      expect(result.status, result.stderr).toBe(0)
      const calls = readFileSync(logFile, 'utf8')
      expect(calls).toContain(action === 'start' ? 'up -d mediamtx' : 'down')
      expect(calls).not.toContain('app:')
      expect(readFileSync(file, 'utf8')).toBe('99999999')
    },
  )

  it('standalone preview start preserves a verified native process without trying Docker', () => {
    pidFile(String(process.pid))
    copyFileSync(
      new URL('./mediamtx.sh', import.meta.url),
      join(directory, 'scripts/mediamtx.sh'),
    )
    const binary = join(
      directory,
      'home/.local/share/kidane-mehret-live/mediamtx-1.21.2/mediamtx',
    )
    const result = run(
      ['start'],
      {
        MEDIAMTX_BACKEND: 'auto',
        MOCK_PROCESS_COMMAND: `${binary} ${binary}.yml`,
      },
      'mediamtx.sh',
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('MediaMTX is already running')
    expect(readFileSync(logFile, 'utf8')).toBe('')
  })

  it.each(['', '169.254.15.248', '192.168.1.999'])(
    'stops before changing services for unusable IP %j',
    (ip) => {
      const result = run([], { MOCK_IP: ip })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Startup stopped:')
      expect(readFileSync(logFile, 'utf8')).toBe('')
    },
  )

  it('accepts an explicit LAN IP for a non-Wi-Fi interface', () => {
    const result = run(['--check'], {
      MOCK_IP: '',
      MEDIAMTX_LAN_IP: '10.0.0.20',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Wi-Fi/LAN IP: 10.0.0.20')
  })

  it.each(['5173', '3001'])(
    'reports occupied port %s before restarting preview',
    (port) => {
      const result = run([], { BUSY_PORT: port })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(`Port ${port} is already in use`)
      expect(result.stderr).toContain('Next step:')
      expect(readFileSync(logFile, 'utf8')).toBe('')
    },
  )

  it.each(['stop', 'start'])(
    'provides a recovery step when preview %s fails',
    (action) => {
      const result = run([], { MEDIA_FAIL: action })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(`Could not ${action}`)
      expect(result.stderr).toContain('Next step:')
      expect(readFileSync(logFile, 'utf8')).not.toContain('app:')
    },
  )
})
