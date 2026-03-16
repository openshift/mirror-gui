import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

const SCRIPTS = [
  'start-app.sh',
  'clean-stale-ports.sh',
  'entrypoint.sh',
  'container-run.sh',
  'cron-build.sh',
  'fetch-catalogs-host.sh',
  'build-for-quay/build-for-quay.sh',
];

describe('Shell script validation', () => {
  let shellcheckAvailable = false;

  beforeAll(async () => {
    try {
      execSync('shellcheck --version', { stdio: 'ignore' });
      shellcheckAvailable = true;
    } catch {
      shellcheckAvailable = false;
    }
  });

  it('reports shellcheck availability', () => {
    if (!shellcheckAvailable) {
      console.warn('shellcheck not installed - skipping script validation');
    }
  });

  for (const script of SCRIPTS) {
    it(`passes shellcheck: ${script}`, async () => {
      // Skip if shellcheck not installed
      if (!shellcheckAvailable) {
        return;
      }

      const scriptPath = path.join(process.cwd(), script);
      try {
        const { stdout, stderr } = await execAsync(
          `shellcheck -S error "${scriptPath}" 2>&1`,
          { encoding: 'utf8' }
        );
        if (stderr) {
          console.warn(`shellcheck stderr for ${script}:`, stderr);
        }
        expect(stdout.trim()).toBe('');
      } catch (error: unknown) {
        const err = error as { stdout?: string; stderr?: string };
        const output = [err.stdout, err.stderr].filter(Boolean).join('\n');
        throw new Error(`shellcheck failed for ${script}:\n${output}`);
      }
    });
  }
});
