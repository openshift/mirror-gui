import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Extracts one top-level function from a launcher script, so it can run without main().
const extractFunction = (script: string, name: string) => {
  const source = readFileSync(path.join(process.cwd(), script), 'utf8');
  const match = source.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}$`, 'm'));
  if (!match) throw new Error(`${name} not found in ${script}`);
  return match[0];
};

describe('rewrite_loopback_proxy_url (mirror-gui.sh)', () => {
  const rewrite = (url: string) =>
    execFileSync(
      'bash',
      ['-c', `${extractFunction('mirror-gui.sh', 'rewrite_loopback_proxy_url')}\nrewrite_loopback_proxy_url "$1"`, '_', url],
      { encoding: 'utf8' },
    ).trim();

  it('points a loopback proxy at the podman machine host', () => {
    expect(rewrite('http://127.0.0.1:3128')).toBe('http://host.containers.internal:3128');
    expect(rewrite('http://localhost:3128/')).toBe('http://host.containers.internal:3128/');
    expect(rewrite('localhost:3128')).toBe('host.containers.internal:3128');
  });

  // Proxy authentication fails if the credentials change, so only the host may be rewritten.
  it('keeps credentials that contain a loopback name', () => {
    expect(rewrite('http://localhost:p127.0.0.1@localhost:3128')).toBe(
      'http://localhost:p127.0.0.1@host.containers.internal:3128',
    );
  });

  it('leaves hosts that only contain a loopback name unchanged', () => {
    expect(rewrite('http://localhost.example.com:3128')).toBe('http://localhost.example.com:3128');
    expect(rewrite('http://proxy.example.com:3128/localhost')).toBe('http://proxy.example.com:3128/localhost');
    expect(rewrite('http://127.0.0.10:3128')).toBe('http://127.0.0.10:3128');
  });
});

// The data directory is opened up with chmod 777 so the container UID can write to it. A saved
// pull secret must never be caught by that, not even before the chmod 600 that follows.
describe.each([
  ['local-build.sh', 'create_directories'],
  ['mirror-gui.sh', 'create_data_directories'],
])('%s %s', (script, fn) => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'launcher-'));
    mkdirSync(path.join(workDir, 'data'));
    writeFileSync(path.join(workDir, 'data', 'pull-secret.json'), '{}');
    chmodSync(path.join(workDir, 'data', 'pull-secret.json'), 0o600);
    // A chmod wrapper first on PATH records every call, including the ones find runs.
    mkdirSync(path.join(workDir, 'bin'));
    writeFileSync(
      path.join(workDir, 'bin', 'chmod'),
      '#!/bin/sh\necho "$*" >> "$CHMOD_LOG"\nexec /bin/chmod "$@"\n',
    );
    chmodSync(path.join(workDir, 'bin', 'chmod'), 0o755);
  });

  afterEach(() => rmSync(workDir, { recursive: true, force: true }));

  it('never grants 777 to the saved pull secret', () => {
    const log = path.join(workDir, 'chmod.log');
    execFileSync(
      'bash',
      ['-c', `print_status() { :; }\nprint_success() { :; }\nDATA_DIR=data\n${extractFunction(script, fn)}\n${fn}`],
      { cwd: workDir, env: { ...process.env, PATH: `${workDir}/bin:${process.env.PATH}`, CHMOD_LOG: log } },
    );

    const calls = readFileSync(log, 'utf8').trim().split('\n');
    const grants777 = calls.filter(c => /^(-R )?777 /.test(c));
    expect(grants777.length).toBeGreaterThan(0);
    expect(grants777.some(c => c.startsWith('-R '))).toBe(false);
    expect(grants777.some(c => c.split(' ').includes('data/pull-secret.json'))).toBe(false);
    expect(statSync(path.join(workDir, 'data', 'pull-secret.json')).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(workDir, 'data', 'configs')).mode & 0o777).toBe(0o777);
  });
});
