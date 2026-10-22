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
