import { test, expect, type Page } from '@playwright/test';
import { seedOperation } from '../helpers/seedOperation.js';

// A config whose additional image is distinct from anything typed in the
// draft, so tests can tell which one ended up in the editor.
const SAVED_IMAGE = 'quay.io/e2e/saved-config-image:1.0';
const SAVED_CONFIG_YAML = `kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  platform:
    channels:
      - name: stable-4.21
    graph: true
  operators: []
  additionalImages:
    - name: ${SAVED_IMAGE}
  helm:
    repositories: []
`;
const DRAFT_IMAGE = 'quay.io/e2e/unsaved-draft-image:1.0';

// In-app navigation must go through the sidebar: page.goto() reloads the
// page, which (by design) discards the in-memory draft.
async function navigateVia(page: Page, label: string) {
  await page.locator('#page-sidebar').getByText(label, { exact: true }).click();
}

async function typeDraftImage(page: Page) {
  await page.getByRole('tab', { name: /additional images/i }).click();
  await page.getByRole('button', { name: /add image/i }).click();
  await page.locator('#img-name-0').fill(DRAFT_IMAGE);
}

async function expectEditorImage(page: Page, image: string) {
  await page.getByRole('tab', { name: /additional images/i }).click();
  await expect(page.locator('#img-name-0')).toHaveValue(image, { timeout: 10000 });
}

test.describe('Mirror Configuration draft persistence', () => {
  test('unsaved draft survives navigating to another page and back', async ({ page }) => {
    await page.goto('/config');
    await typeDraftImage(page);

    await navigateVia(page, 'Dashboard');
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await navigateVia(page, 'Mirror Configuration');

    await expectEditorImage(page, DRAFT_IMAGE);
  });
});

test.describe('Reopening a previously used configuration', () => {
  test.describe.configure({ mode: 'serial' });

  const configName = `e2e-draft-reload-${Date.now()}.yaml`;
  const createdOperations: string[] = [];

  test.beforeAll(async ({ request }) => {
    const saveRes = await request.post('/api/config/save', {
      data: { config: SAVED_CONFIG_YAML, name: configName },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();
    await seedOperation(request, configName, createdOperations);
  });

  test.afterAll(async ({ request }) => {
    for (const opId of createdOperations) {
      await request.post(`/api/operations/${opId}/stop`).catch(() => {});
      await request.delete(`/api/operations/${opId}`).catch(() => {});
    }
    await request.delete(`/api/config/delete/${configName}`).catch(() => {});
  });

  test('History row action opens the operation config in the editor', async ({ page }) => {
    await page.goto('/history');
    await page.getByRole('button', { name: `Edit ${configName} in Mirror Configuration` }).click();

    await expect(page).toHaveURL(/\/config/);
    await expect(page.getByText('Valid ImageSetConfiguration detected')).toBeVisible({ timeout: 10000 });
    // The draft is empty, so loading must not ask for confirmation.
    await page.getByRole('button', { name: /load into editor/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expectEditorImage(page, SAVED_IMAGE);
  });

  test('loading over an unsaved draft asks first, and Cancel keeps the draft', async ({ page }) => {
    await page.goto('/config');
    await typeDraftImage(page);

    await navigateVia(page, 'Mirror Operations');
    const row = page.getByRole('row').filter({ hasText: configName });
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.getByRole('button', { name: /actions for/i }).click();
    await page.getByRole('menuitem', { name: /edit configuration/i }).click();

    await expect(page).toHaveURL(/\/config/);
    await expect(page.getByText('Valid ImageSetConfiguration detected')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /load into editor/i }).click();

    const dialog = page.getByRole('dialog', { name: /replace current configuration/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expectEditorImage(page, DRAFT_IMAGE);

    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.getByRole('button', { name: /load into editor/i }).click();
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await expectEditorImage(page, SAVED_IMAGE);
  });

  test('Load Configuration tab lists saved configs and loads the selected one', async ({ page }) => {
    await page.goto('/config');
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await page.getByRole('button', { name: /select a saved configuration/i }).click();
    await page.getByRole('option', { name: new RegExp(configName) }).click();

    await expect(page.locator('#yaml-upload-preview')).toContainText(SAVED_IMAGE, { timeout: 10000 });
    await page.getByRole('button', { name: /load into editor/i }).click();
    await expectEditorImage(page, SAVED_IMAGE);
  });
});

test.describe('Saved configuration replacement safety', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/config/list', route => route.fulfill({ json: ['a.yaml', 'b.yaml', 'c.yaml'].map(name => ({ name, modified: '2026-01-01' })) }));
    await page.route('**/api/config/download/a.yaml', route => route.fulfill({ body: SAVED_CONFIG_YAML }));
    await page.goto('/config');
    await page.getByRole('tab', { name: /load configuration/i }).click();
  });

  async function selectSaved(page: Page, name: string) {
    await page.getByRole('button', { name: /select a saved configuration/i }).click();
    await page.getByRole('option', { name: new RegExp(`^${name.replace('.', '\\.')}\\b`) }).click();
  }

  test('blocks loading during a download and ignores an older response', async ({ page }) => {
    await selectSaved(page, 'a.yaml');
    const load = page.getByRole('button', { name: /load into editor/i });
    await expect(load).toBeEnabled();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/config/download/b.yaml', async route => {
      await gate;
      await route.fulfill({ body: SAVED_CONFIG_YAML.replace(SAVED_IMAGE, DRAFT_IMAGE) });
    });
    await page.route('**/api/config/download/c.yaml', route => route.fulfill({ body: SAVED_CONFIG_YAML }));
    await selectSaved(page, 'b.yaml');
    await expect(load).toBeDisabled();
    await selectSaved(page, 'c.yaml');
    await expect(load).toBeEnabled();
    const oldResponse = page.waitForResponse('**/api/config/download/b.yaml');
    release();
    await oldResponse;
    await load.click();
    await expectEditorImage(page, SAVED_IMAGE);
  });

  test('preserves parsed content after a failed download without logging sensitive details', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await selectSaved(page, 'a.yaml');
    await expect(page.getByRole('button', { name: /load into editor/i })).toBeEnabled();
    await page.route('**/api/config/download/b.yaml', route => route.fulfill({ status: 500, body: 'private backend details' }));
    await selectSaved(page, 'b.yaml');
    await expect(page.getByText('Failed to load configuration b.yaml')).toBeVisible();
    expect(errors.filter(message => message.includes('Error loading saved configuration'))).toEqual(['Error loading saved configuration']);
    await page.getByRole('button', { name: /load into editor/i }).click();
    await expectEditorImage(page, SAVED_IMAGE);
  });

  test('clears the old filename only after confirming draft replacement', async ({ page }) => {
    await typeDraftImage(page);
    await page.getByRole('button', { name: 'Edit filename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Configuration filename', exact: true }).fill('previous-draft');
    await page.getByRole('button', { name: 'Confirm filename', exact: true }).click();
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await selectSaved(page, 'a.yaml');
    await page.getByRole('button', { name: /load into editor/i }).click();
    const dialog = page.getByRole('dialog', { name: /replace current configuration/i });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('previous-draft.yaml', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /load into editor/i }).click();
    await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.getByText('previous-draft.yaml', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit filename', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Configuration filename', exact: true })).toHaveValue('');
  });
  async function setFilename(page: Page, name: string) {
    await page.getByRole('button', { name: 'Edit filename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Configuration filename', exact: true }).fill(name);
    await page.getByRole('button', { name: 'Confirm filename', exact: true }).click();
  }

  test('asks before replacing a draft where only the filename was edited', async ({ page }) => {
    await setFilename(page, 'name-only-draft');
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await selectSaved(page, 'a.yaml');
    await page.getByRole('button', { name: /load into editor/i }).click();
    await expect(page.getByRole('dialog', { name: /replace current configuration/i })).toBeVisible();
    await expect(page.getByText('name-only-draft.yaml', { exact: true })).toBeVisible();
  });

  test('a finishing save does not clear a filename entered after navigating back', async ({ page }) => {
    await typeDraftImage(page);
    await setFilename(page, 'draft-a');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/config/save', async route => {
      await gate;
      await route.fulfill({ json: { success: true } });
    });
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await navigateVia(page, 'Dashboard');
    await navigateVia(page, 'Mirror Configuration');
    await setFilename(page, 'draft-b');
    const saved = page.waitForResponse('**/api/config/save');
    release();
    await saved;
    await expect(page.getByText('draft-b.yaml', { exact: true })).toBeVisible();
  });
  test('asks before replacing a draft with an unapplied preview edit, then closes the editor', async ({ page }) => {
    await page.getByRole('tab', { name: /preview/i }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.locator('.yaml-editor-wrapper textarea');
    await editor.fill(`${await editor.inputValue()}# unapplied edit\n`);
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await selectSaved(page, 'a.yaml');
    await page.getByRole('button', { name: /load into editor/i }).click();
    const dialog = page.getByRole('dialog', { name: /replace current configuration/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.locator('.yaml-editor-wrapper textarea')).toHaveCount(0);
    await expect(page.locator('#yaml-preview')).toContainText(SAVED_IMAGE);
  });
  test('drops a dependency response that started before the draft was replaced', async ({ page }) => {
    const catalog = 'registry.redhat.io/redhat/redhat-operator-index:v4.21';
    const operatorConfig = (pkg: string) => `kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  operators:
    - catalog: ${catalog}
      packages:
        - name: ${pkg}
          channels:
            - name: stable
`;
    await page.route('**/api/config/download/a.yaml', route => route.fulfill({ body: operatorConfig('op-one') }));
    await page.route('**/api/config/download/b.yaml', route => route.fulfill({ body: operatorConfig('op-two') }));
    await page.route('**/api/operators?*', route => route.fulfill({
      json: ['op-one', 'op-two'].map(name => ({ name, defaultChannel: 'stable', allChannels: ['stable'] })),
    }));
    await page.route('**/api/operator-channels/**', route => route.fulfill({ json: { channels: [{ name: 'stable' }] } }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/operators/op-two/dependencies*', async route => {
      await gate;
      await route.fulfill({ json: { dependencies: [{ packageName: 'stale-dependency' }] } });
    });

    await page.getByRole('tab', { name: /load configuration/i }).click();
    await selectSaved(page, 'a.yaml');
    await page.getByRole('button', { name: /load into editor/i }).click();
    await page.getByRole('tab', { name: /operators/i }).click();
    const operatorInput = page.getByPlaceholder('Type to search operators...').first();
    await operatorInput.fill('op-two');
    await page.getByRole('option', { name: 'op-two' }).click();

    // Replace the draft with one that has the same catalog and package at the same index.
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await selectSaved(page, 'b.yaml');
    await page.getByRole('button', { name: /load into editor/i }).click();
    await page.getByRole('dialog', { name: /replace current configuration/i })
      .getByRole('button', { name: 'Replace', exact: true }).click();

    const dependenciesResponse = page.waitForResponse('**/api/operators/op-two/dependencies*');
    release();
    await dependenciesResponse;
    await page.getByRole('tab', { name: /preview/i }).click();
    await expect(page.locator('#yaml-preview')).toContainText('op-two');
    await expect(page.locator('#yaml-preview')).not.toContainText('stale-dependency');
  });
  test('asks before replacing a draft whose filename is typed but not confirmed', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit filename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Configuration filename', exact: true }).fill('typed-not-confirmed');
    await page.getByRole('tab', { name: /load configuration/i }).click();
    await selectSaved(page, 'a.yaml');
    await page.getByRole('button', { name: /load into editor/i }).click();
    await expect(page.getByRole('dialog', { name: /replace current configuration/i })).toBeVisible();
  });

  test('applies a dependency response to the operator after an earlier row is removed', async ({ page }) => {
    const catalog = 'registry.redhat.io/redhat/redhat-operator-index:v4.21';
    await page.route('**/api/config/download/a.yaml', route => route.fulfill({ body: `kind: ImageSetConfiguration
apiVersion: mirror.openshift.io/v2alpha1
mirror:
  operators:
    - catalog: ${catalog}
      packages:
        - name: op-one
          channels:
            - name: stable
        - name: op-three
          channels:
            - name: stable
` }));
    await page.route('**/api/operators?*', route => route.fulfill({
      json: ['op-one', 'op-two', 'op-three'].map(name => ({ name, defaultChannel: 'stable', allChannels: ['stable'] })),
    }));
    await page.route('**/api/operator-channels/**', route => route.fulfill({ json: { channels: [{ name: 'stable' }] } }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/operators/op-two/dependencies*', async route => {
      await gate;
      await route.fulfill({ json: { dependencies: [{ packageName: 'valid-dependency' }] } });
    });

    await page.getByRole('tab', { name: /load configuration/i }).click();
    await selectSaved(page, 'a.yaml');
    await page.getByRole('button', { name: /load into editor/i }).click();
    await page.getByRole('tab', { name: /operators/i }).click();
    // Row 2 becomes op-two, then row 1 is removed so op-two shifts to row 1.
    const operatorInput = page.getByPlaceholder('Type to search operators...').nth(1);
    await operatorInput.fill('op-two');
    await page.getByRole('option', { name: 'op-two' }).click();
    await page.getByRole('button', { name: /remove operator 1/i }).click();

    const dependenciesResponse = page.waitForResponse('**/api/operators/op-two/dependencies*');
    release();
    await dependenciesResponse;
    await page.getByRole('tab', { name: /preview/i }).click();
    await expect(page.locator('#yaml-preview')).toContainText('valid-dependency');
  });
});
