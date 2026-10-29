import { expect, type APIRequestContext } from '@playwright/test';
import { UI_REQUEST_HEADERS } from '../uiRequestHeader.js';

/**
 * Seeds a single operation via the API: starts it, stops it immediately,
 * and polls until it reaches a terminal status (success|failed|stopped).
 *
 * The operation ID is recorded for cleanup immediately after a successful
 * start — before stopping or polling — so the caller's `afterAll` can
 * always delete it even when a later step fails or the suite is retried.
 * If no `trackingArray` is provided and stop/poll fails, the helper
 * performs best-effort cleanup itself before rethrowing.
 */
export async function seedOperation(
  request: APIRequestContext,
  configName: string,
  trackingArray?: string[],
): Promise<string> {
  const startRes = await request.post('/api/operations/start', {
    data: { configFile: configName },
  });
  expect(startRes.ok(), `Start failed: ${await startRes.text()}`).toBeTruthy();
  const { operationId } = await startRes.json();

  trackingArray?.push(operationId);

  try {
    await request.post(`/api/operations/${operationId}/stop`, { headers: UI_REQUEST_HEADERS });

    await expect(async () => {
      const res = await request.get('/api/operations');
      const ops = await res.json();
      const op = ops.find((o: { id: string }) => o.id === operationId);
      expect(op?.status).toMatch(/^(success|failed|stopped)$/);
    }).toPass({ timeout: 15000 });
  } catch (error) {
    if (!trackingArray) {
      await request.post(`/api/operations/${operationId}/stop`, { headers: UI_REQUEST_HEADERS }).catch(() => {});
      await request.delete(`/api/operations/${operationId}`).catch(() => {});
    }
    throw error;
  }

  return operationId;
}
