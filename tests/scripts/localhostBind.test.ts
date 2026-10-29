import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function readRepoFile(name: string): string {
  return readFileSync(path.join(process.cwd(), name), 'utf8');
}

function expectLocalPublish(script: string): void {
  const source = readRepoFile(script);

  expect(source).toContain('WEB_BIND_HOST="${WEB_BIND_HOST:-127.0.0.1}"');
  expect(source).toContain('-p "${WEB_BIND_HOST}:${WEB_PORT}:${CONTAINER_PORT}"');
  expect(source).toContain('-e BIND_HOST="${BIND_HOST:-0.0.0.0}"');
  expect(source).not.toContain('-p "$WEB_PORT:$CONTAINER_PORT"');
}

describe('localhost publish', () => {
  it('mirror-gui.sh publishes on this machine unless WEB_BIND_HOST is set', () => {
    expectLocalPublish('mirror-gui.sh');
  });

  it('local-build.sh publishes on this machine unless WEB_BIND_HOST is set', () => {
    expectLocalPublish('local-build.sh');
  });

  it('entrypoint listens on all container interfaces when BIND_HOST is unset', () => {
    const source = readRepoFile('entrypoint.sh');

    expect(source).toContain('export BIND_HOST=0.0.0.0');
  });
});
