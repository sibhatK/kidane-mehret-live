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

describe('Mac live startup', () => {
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

  function run(args: string[] = [], overrides: Record<string, string> = {}) {
    return spawnSync(
      '/bin/bash',
      [join(directory, 'scripts/start-mac.sh'), ...args],
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
