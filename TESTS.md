# Mirror-GUI Test Documentation

All tests run automatically on every push and pull request via the GitHub Actions workflow `[.github/workflows/mirror-gui-tests.yml](.github/workflows/mirror-gui-tests.yml)`. The workflow contains three parallel jobs described below. The container image is built in the Cachi2 pipeline, not in GitHub Actions.

---

## CI Jobs Overview


| Job                      | Runner          | What it does                                                                                           |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| **unit-and-integration** | `ubuntu-latest` | Build, lint, unit tests, integration tests, coverage, audit-catalog tests, catalog metadata validation  |
| **e2e**                  | `ubuntu-latest` | Playwright end-to-end browser tests against a live dev server                                          |
| **shellcheck**           | `ubuntu-latest` | Static analysis of all shell scripts                                                                   |


---

## Job 1: unit-and-integration

Runs the following steps in order:

1. **Build** (`npm run build`) -- TypeScript compilation and Vite production build
2. **Lint** (`npm run lint`) -- ESLint on all `src/**/*.{ts,tsx}` files
3. **Unit and integration tests** (`npm run test`) -- Vitest run across all `tests/unit/` and `tests/integration/` files
4. **Coverage** (`npm run test:coverage`) -- Same tests with V8 coverage reporting
5. **Audit-catalog tests** (`npx vitest run tests/scripts/auditFetchCatalogs.test.ts`) -- Tests the audit script logic
6. **Catalog metadata validation** (`npx vitest run tests/scripts/catalogDataIntegrity.test.ts`) -- Validates all committed catalog data

### Unit Tests (`tests/unit/`)


| File                       | Tests | Description                                                                                                     |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `catalogChannels.test.ts`  | 6     | `getChannelObjectsFromGeneratedOperator` -- handles undefined, empty, string, mixed, and invalid channel inputs |
| `pathAvailability.test.ts` | 4     | `isPathAvailable` -- writable paths, missing paths under writable parents, read-only ancestors                  |
| `utils.test.ts`            | 36    | `parseOcMirrorVersion`, `formatDuration`, `formatBytes`, `sanitizeFilename`, and other utility functions        |


### Integration Tests (`tests/integration/`)

Server API tests using Supertest against the Express server. Each suite starts a test server instance.


| File                          | Tests | Description                                                                                               |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `health.test.ts`              | 1     | `GET /api/health` -- returns `healthy` status, `mirror-gui` service name, valid ISO timestamp             |
| `catalogs.test.ts`            | 2     | `GET /api/catalogs` -- prefetched catalogs with operator counts, `digest` / `syncedAt` fields, error path |
| `channels.test.ts`            | 1     | `GET /api/channels` -- returns OCP channel names (stable-4.16 through stable-4.21)                        |
| `operators.test.ts`           | 15    | `GET /api/operators` -- operator listing, filtering by catalog/version, search, pagination                |
| `config.test.ts`              | 12    | Config API -- list, save, upload, delete, validate YAML configurations                                    |
| `configDownload.test.ts`      | 4     | `GET /api/config/download/:filename` -- invalid extension, traversal-safe basename, 404, successful download |
| `operations.test.ts`          | 7     | Operations API -- list, recent operations, stats (total/successful/failed/running)                        |
| `operationsLifecycle.test.ts` | 6     | Operations lifecycle -- start, stop, logs, details, SSE streaming, 404 handling                           |
| `settings.test.ts`            | 4     | Settings API -- registries list, cache cleanup, `POST /api/registries/verify` validation                   |
| `system.test.ts`              | 3     | System API -- path availability, system info (oc-mirror version, architecture, disk space), system status |
| `pullSecret.test.ts`          | 11    | Pull secret API -- status, content, save/validate, delete, system status / hostDataDir                     |
| `mirrorFolders.test.ts`       | 3     | `GET` / `POST /api/mirror-folders` -- list folders, reject invalid names, create folder                    |
| `catalogSync.test.ts`         | 3     | Catalog sync -- `GET /api/catalogs/sync/status`, `DELETE /api/catalogs/sync/data`, `POST` when script missing |


### Script Tests (`tests/scripts/`)


| File                           | Tests | Description                                                                                                                                                                                                                                            |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auditFetchCatalogs.test.ts`   | 2     | Tests `scripts/audit-fetch-catalogs.mjs` logic using synthetic fixtures -- detects version metadata mismatches and JSON parse errors                                                                                                                   |
| `catalogDataIntegrity.test.ts` | 94    | Validates all committed catalog metadata: `catalog-index.json` has all 6 OCP versions and 3 catalog types, all 18 catalogs have valid `operators.json` (with required fields and minimum operator counts), `dependencies.json`, `catalog-info.json`, and optional `digest`/`synced_at` fields |
| `shellcheck.test.ts`           | 7     | Runs ShellCheck on shell scripts when available; skips gracefully otherwise                                                                                                                                                                            |


---

## Job 2: e2e

Runs Playwright browser tests using headless Chromium (port 3001 in CI via dev server, port 3000 locally against a running container).


| File                         | Tests | Description                                                                                                                    |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `navigation.spec.ts`         | 12    | App loads, page title, sidebar nav items with correct routing, masthead title and version badge, sidebar toggle collapse/expand/persistence, dark theme class, logo image   |
| `dashboard.spec.ts`          | 4     | Dashboard shows environment overview, operation stats cards, recent operations section, quick action buttons                    |
| `mirrorConfig.spec.ts`       | 9     | Mirror Configuration page -- platform channels, operators (FieldBuilder + TypeaheadSelect), additional images, YAML preview, save/download, inline validation, digest toggle, load configuration   |
| `mirrorOperations.spec.ts`   | 8     | Mirror Operations page -- config file selector, start/run controls, operation table, filter dropdown with status options, select all checkbox, Delete All button |
| `history.spec.ts`            | 6     | History page -- title, filter controls, Export CSV button, filter dropdown with status options, select all checkbox, Delete All button |
| `settings.spec.ts`           | 5     | Settings page -- Pull Secret/Registry/Cache/Sync Catalogs tabs, key fields visible, sync and clear buttons                       |
| `configToOperations.spec.ts` | 1     | End-to-end workflow -- saves a YAML config via API, navigates to operations page, confirms it appears                          |
| `pullSecret.spec.ts`         | 6     | Pull secret -- Dashboard pull secret status, Environment Status label, popover, Pull Secret tab, URL tab navigation, status persistence   |


Playwright reports are uploaded as CI artifacts (retained 14 days).

---

## Job 3: shellcheck

Runs [ShellCheck](https://www.shellcheck.net/) with `-S error` (error-level severity) on all shell scripts:

- `mirror-gui.sh`
- `entrypoint.sh`
- `local-build.sh`
- `sync-catalogs.sh`

Scripts that are not present (e.g., gitignored) are skipped gracefully.

---

## Running Tests Locally

```bash
# Unit and integration tests
npm test

# With coverage
npm run test:coverage

# Single test file
npx vitest run tests/scripts/catalogDataIntegrity.test.ts

# E2E tests (requires running container on port 3000, or set E2E_PORT=3001 with dev server)
npm run test:e2e

# All tests (unit + integration + E2E)
npm run test:all

# Lint
npm run lint

# Audit-catalog script
npm run audit:fetch-catalogs
```

---

## Test Counts Summary


| Category         | Files  | Test Cases |
| ---------------- | ------ | ---------- |
| Unit             | 3      | 46         |
| Integration      | 13     | 71         |
| Scripts          | 3      | 103        |
| E2E (Playwright) | 8      | 51         |
| **Total**        | **27** | **271**    |


