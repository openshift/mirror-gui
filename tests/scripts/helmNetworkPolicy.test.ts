import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

let helmAvailable = true;
try {
  execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
} catch {
  helmAvailable = false;
}

const renderPolicy = (...sets: string[]) =>
  execFileSync(
    'helm',
    ['template', 't', 'charts/mirror-gui', '-s', 'templates/networkpolicy.yaml', ...sets.flatMap(s => ['--set', s])],
    { encoding: 'utf8' },
  );

// The API is unauthenticated and serves the pull secret, so ingress to the pod must be
// denied unless the user names who may reach it.
describe.skipIf(!helmAvailable)('Helm chart NetworkPolicy', () => {
  it('denies all ingress by default', () => {
    const out = renderPolicy();
    expect(out).toContain('kind: NetworkPolicy');
    expect(out).toMatch(/matchLabels:\n\s+app\.kubernetes\.io\/name: mirror-gui\n\s+app\.kubernetes\.io\/instance: "t"/);
    expect(out).toMatch(/policyTypes:\n\s+- Ingress\n\s+ingress: \[\]/);
  });

  it('admits the OpenShift router only while the Route is enabled', () => {
    expect(renderPolicy()).not.toContain('policy-group.network.openshift.io/ingress');
    const out = renderPolicy('route.enabled=true');
    expect(out).toMatch(/namespaceSelector:\n\s+matchLabels:\n\s+policy-group\.network\.openshift\.io\/ingress: ""/);
    expect(out).toMatch(/ports:\n\s+- port: http\n\s+protocol: TCP/);
  });

  it('admits user-listed peers on the http port only', () => {
    const out = renderPolicy('networkPolicy.ingressFrom[0].podSelector.matchLabels.app=client');
    expect(out).toMatch(/- from:\n\s+- podSelector:\n\s+matchLabels:\n\s+app: client\n\s+ports:\n\s+- port: http/);
    expect(out).not.toContain('ingress: []');
  });

  it('is not rendered when disabled', () => {
    expect(() => renderPolicy('networkPolicy.enabled=false')).toThrow(/could not find template/);
  });
});
