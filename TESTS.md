# Mirror-GUI Test Documentation

All tests run automatically on every push and pull request via the GitHub Actions workflow `[.github/workflows/mirror-gui-tests.yml](.github/workflows/mirror-gui-tests.yml)`. The workflow contains four parallel jobs described below.

---

## CI Jobs Overview


| Job                      | Runner          | What it does                                                                                           |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| **unit-and-integration** | `ubuntu-latest` | Build, lint, unit tests, integration tests, coverage, audit-catalog tests, catalog metadata validation |
| **e2e**                  | `ubuntu-latest` | Playwright end-to-end browser tests against a live dev server                                          |
| **shellcheck**           | `ubuntu-latest` | Static analysis of all shell scripts                                                                   |
| **container-image**      | `ubuntu-latest` | Validates the Dockerfile builds successfully with Podman                                               |


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
| `catalogs.test.ts`            | 2     | `GET /api/catalogs` -- returns prefetched catalog list with name, URL, description, operator count        |
| `channels.test.ts`            | 1     | `GET /api/channels` -- returns OCP channel names (stable-4.16 through stable-4.21)                        |
| `operators.test.ts`           | 15    | `GET /api/operators` -- operator listing, filtering by catalog/version, search, pagination                |
| `config.test.ts`              | 11    | Config API -- list, save, load, delete, validate YAML configurations                                      |
| `operations.test.ts`          | 7     | Operations API -- list, recent operations, stats (total/successful/failed/running)                        |
| `operationsLifecycle.test.ts` | 6     | Operations lifecycle -- start, stop, logs, details, SSE streaming, 404 handling                           |
| `settings.test.ts`            | 4     | Settings API -- default settings, persist concurrency/retention preferences                               |
| `system.test.ts`              | 3     | System API -- path availability, system info (oc-mirror version, architecture, disk space), system status |


### Script Tests (`tests/scripts/`)


| File                           | Tests | Description                                                                                                                                                                                                                                            |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auditFetchCatalogs.test.ts`   | 2     | Tests `scripts/audit-fetch-catalogs.mjs` logic using synthetic fixtures -- detects version metadata mismatches and JSON parse errors                                                                                                                   |
| `catalogDataIntegrity.test.ts` | 76    | Validates all committed catalog metadata: `catalog-index.json` has all 6 OCP versions and 3 catalog types, all 18 catalogs have valid `operators.json` (with required fields and minimum operator counts), `dependencies.json`, and `catalog-info.json` |
| `shellcheck.test.ts`           | 2     | Runs ShellCheck on shell scripts when available; skips gracefully otherwise                                                                                                                                                                            |


---

## Job 2: e2e

Starts the dev server (`npm run dev`) and runs Playwright browser tests against `http://localhost:3001` using headless Chromium.


| File                         | Tests | Description                                                                                                                    |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `navigation.spec.ts`         | 6     | App loads, page title matches, sidebar has 5 nav items, clicking each navigates correctly, masthead title and version badge    |
| `dashboard.spec.ts`          | 4     | Dashboard shows system overview, operation stats cards, recent operations section, quick action buttons                        |
| `mirrorConfig.spec.ts`       | 5     | Mirror Configuration page -- platform channels tab, operators tab, additional images tab, YAML preview, save/download controls |
| `mirrorOperations.spec.ts`   | 4     | Mirror Operations page -- config file selector, start/run controls, operation table or main content area                       |
| `history.spec.ts`            | 3     | History page -- title, filter controls, Export CSV button                                                                      |
| `settings.spec.ts`           | 5     | Settings page -- General/Registry/System tabs, key fields visible, Save button enabled                                         |
| `configToOperations.spec.ts` | 1     | End-to-end workflow -- saves a YAML config via API, navigates to operations page, confirms it appears                          |


Playwright reports are uploaded as CI artifacts (retained 14 days).

---

## Job 3: shellcheck

Runs [ShellCheck](https://www.shellcheck.net/) with `-S error` (error-level severity) on all shell scripts:

- `start-app.sh`
- `clean-stale-ports.sh`
- `entrypoint.sh`
- `container-run.sh`
- `fetch-catalogs-host.sh`

Scripts that are not present (e.g., gitignored) are skipped gracefully.

---

## Job 4: container-image

Builds the multi-stage Dockerfile with Podman to verify the container image builds successfully. Does not push to any registry. Has a 45-minute timeout to accommodate the oc-mirror binary download.

```
podman build -t mirror-gui:ci .
```

---

## Running Tests Locally

```bash
# Unit and integration tests
npm test

# With coverage
npm run test:coverage

# Single test file
npx vitest run tests/scripts/catalogDataIntegrity.test.ts

# E2E tests (starts dev server automatically)
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
| Integration      | 9      | 50         |
| Scripts          | 3      | 80         |
| E2E (Playwright) | 7      | 28         |
| **Total**        | **22** | **204**    |


