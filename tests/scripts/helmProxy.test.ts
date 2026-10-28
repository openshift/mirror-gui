import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

let helmAvailable = true;
try {
  execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
} catch {
  helmAvailable = false;
}

const render = (...sets: string[]) =>
  execFileSync(
    'helm',
    ['template', 't', 'charts/mirror-gui', ...sets.flatMap(s => ['--set-string', s])],
    { encoding: 'utf8' },
  );

// Go tools (oc-mirror, oc) and Node read different proxy variable casings, and Node's fetch
// ignores them entirely unless NODE_USE_ENV_PROXY is set, so all three must be rendered.
describe.skipIf(!helmAvailable)('Helm chart proxy settings', () => {
  it('renders no proxy env by default so direct connections are unchanged', () => {
    expect(render()).not.toMatch(/proxy/i);
  });

  it('renders both casings and enables Node env proxy support when a proxy is set', () => {
    const out = render('proxy.httpProxy=http://p:3128', 'proxy.httpsProxy=http://p:3129', 'proxy.noProxy=.svc');
    expect(out).toMatch(/name: NODE_USE_ENV_PROXY\n\s+value: "1"/);
    expect(out).toMatch(/name: HTTP_PROXY\n\s+value: "http:\/\/p:3128"/);
    expect(out).toMatch(/name: http_proxy\n\s+value: "http:\/\/p:3128"/);
    expect(out).toMatch(/name: HTTPS_PROXY\n\s+value: "http:\/\/p:3129"/);
    expect(out).toMatch(/name: https_proxy\n\s+value: "http:\/\/p:3129"/);
    expect(out).toMatch(/name: NO_PROXY\n\s+value: ".svc"/);
    expect(out).toMatch(/name: no_proxy\n\s+value: ".svc"/);
  });

  it('omits variables left empty', () => {
    const out = render('proxy.httpsProxy=http://p:3129');
    expect(out).toContain('name: HTTPS_PROXY');
    expect(out).not.toMatch(/name: HTTP_PROXY/);
    expect(out).not.toMatch(/name: NO_PROXY/);
  });
});
