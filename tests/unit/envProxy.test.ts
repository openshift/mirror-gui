import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// The server's registry verification uses Node's built-in fetch, which ignores proxy
// variables unless NODE_USE_ENV_PROXY=1. This pins that the flag the chart and
// mirror-gui.sh set really routes fetch through the proxy (needs Node >= 22.21).
describe('Node fetch honors NODE_USE_ENV_PROXY', () => {
  let proxy: http.Server;
  let proxyPort: number;
  const seen: string[] = [];

  beforeAll(async () => {
    proxy = http.createServer((req, res) => {
      seen.push(req.url ?? '');
      res.end('via-proxy');
    });
    await new Promise<void>(r => proxy.listen(0, '127.0.0.1', r));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>(r => proxy.close(() => r())));

  // Async on purpose: the proxy lives in this process, so a blocking spawn would deadlock it.
  const run = async (env: Record<string, string>) =>
    (await execFileAsync(
      process.execPath,
      ['-e', "fetch('http://registry.invalid/v2/').then(r=>r.text()).then(console.log,e=>console.log('direct-failed'))"],
      { env: { PATH: process.env.PATH ?? '', ...env }, timeout: 15000 },
    )).stdout.trim();

  it('sends the request through the proxy when enabled', async () => {
    const out = await run({ NODE_USE_ENV_PROXY: '1', HTTP_PROXY: `http://127.0.0.1:${proxyPort}` });
    expect(out).toBe('via-proxy');
    expect(seen).toContain('http://registry.invalid/v2/');
  });

  it('bypasses the proxy for hosts in NO_PROXY', async () => {
    seen.length = 0;
    const out = await run({
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
      NO_PROXY: 'registry.invalid',
    });
    expect(out).toBe('direct-failed');
    expect(seen).toEqual([]);
  });
});
