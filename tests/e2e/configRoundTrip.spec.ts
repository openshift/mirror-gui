import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';

// Loading a file into the form editor and saving it must keep the ImageSetConfiguration
// fields that the form does not model, instead of silently dropping them.
const UPLOADED = `kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
archiveSize: 8
mirror:
  platform:
    architectures:
      - amd64
    channels:
      - name: stable-4.21
        minVersion: 4.21.0
        maxVersion: 4.21.0
    graph: true
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.21
      targetCatalog: my-org/redhat-operator-index
      targetTag: v4.21-test
      packages:
        - name: advanced-cluster-management
          defaultChannel: release-2.15
          channels:
            - name: release-2.15
              minVersion: 2.15.0
              maxVersion: 2.15.1
    - catalog: registry.redhat.io/redhat/certified-operator-index:v4.21
      full: true
      packages:
        - name: gpu-operator-certified
  additionalImages:
    - name: registry.redhat.io/ubi9/ubi-minimal:latest
  blockedImages:
    - name: registry.redhat.io/ubi9/ubi-minimal:9.4
  helm:
    repositories:
      - name: redhat-helm-charts
        url: https://charts.openshift.io
        charts:
          - name: redhat-developer-hub
            version: 1.4.0
`;

test.describe('Load Configuration round trip', () => {
  test('saving a loaded file keeps fields the form does not model', async ({ page, request }) => {
    const configName = `roundtrip-${Date.now()}`;
    const file = path.join(os.tmpdir(), `${configName}-upload.yaml`);
    fs.writeFileSync(file, UPLOADED);

    await page.goto('/config');
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.getByRole('button', { name: /load into editor/i }).click();
    await expect(page.getByText(/Kept on save/)).toBeVisible({ timeout: 10_000 });

    await page.getByLabel('Edit filename').click();
    await page.getByLabel('Configuration filename').fill(configName);
    await page.getByLabel('Confirm filename').click();
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect(page.getByText('Configuration saved successfully!')).toBeVisible({ timeout: 10_000 });
    // gpu-operator-certified has no channels because its catalog is `full: true`; no warning.
    await expect(page.getByText(/No channel selected for/)).toHaveCount(0);

    const res = await request.get(`/api/config/download/${configName}.yaml`);
    expect(res.ok()).toBe(true);
    const saved = YAML.parse(await res.text());
    const original = YAML.parse(UPLOADED);

    expect(saved.mirror.platform.architectures).toEqual(original.mirror.platform.architectures);
    expect(saved.mirror.operators[0].targetCatalog).toBe('my-org/redhat-operator-index');
    expect(saved.mirror.operators[0].targetTag).toBe('v4.21-test');
    expect(saved.mirror.operators[0].packages[0].defaultChannel).toBe('release-2.15');
    expect(saved.mirror.operators[0].packages[0].channels[0].maxVersion).toBe('2.15.1');
    expect(saved.mirror.operators[1].full).toBe(true);
    expect(saved.mirror.blockedImages).toEqual(original.mirror.blockedImages);
    expect(saved.mirror.helm).toEqual(original.mirror.helm);

    await request.delete(`/api/config/delete/${configName}.yaml`);
  });
});
