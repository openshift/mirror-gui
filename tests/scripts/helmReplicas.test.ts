import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

let helmAvailable = true;
try {
  execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
} catch {
  helmAvailable = false;
}

const render = (replicas?: number) =>
  execFileSync(
    'helm',
    [
      'template', 'ocp-oc-mirror-gui', 'charts/mirror-gui', '-n', 'ns1',
      ...(replicas === undefined ? [] : ['--set', `replicaCount=${replicas}`]),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

describe.skipIf(!helmAvailable)('Helm chart replica validation', () => {
  it('defaults to a single replica', () => {
    expect(render()).toMatch(/^ {2}replicas: 1$/m);
  });

  // Operation processes live in one server's memory, so a stop request routed to another
  // replica would report success without killing the oc-mirror process.
  it('rejects more than one replica', () => {
    expect(() => render(2)).toThrow(/replicaCount must be 1/);
  });
});
