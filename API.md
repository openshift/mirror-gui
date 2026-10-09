# Mirror-GUI Application - API Documentation

**Current Version: v1.0**

## Overview

The Mirror-GUI Application provides a RESTful API for managing OpenShift Container Platform mirroring operations. The UI and API are served on the same port. Use the URL printed by the startup script and append `/api`.

### Key Features
- **Archive Size Control**: Optional `archiveSize` parameter to limit archive file sizes (in GiB)
- **Persistent Mirror Storage**: Mirror archives are saved to host filesystem and survive container restarts
- **Custom Mirror Destinations**: Optional subdirectory specification for organized mirror storage
- **Health Monitoring**: Dedicated health check endpoint for container orchestration
- **OCP Versions**: Supports OpenShift Container Platform versions 4.16, 4.17, 4.18, 4.19, 4.20, and 4.21

## Base URL
```
http://localhost:<port>/api
```

The default port is `3000`. All startup scripts (`./mirror-gui.sh`, `./local-build.sh`) automatically select another free port if `3000` is already occupied and print the actual URL.

## Authentication
Currently, the API does not require authentication. All endpoints are accessible without credentials.

## Response Format
API responses are returned in JSON format. Most endpoints return domain-specific JSON directly (e.g., `{ "status": "healthy" }`, `{ "registries": [...] }`). Some endpoints use a wrapper with `success`/`data` fields. Error responses typically include an `error` field:
```json
{
  "error": "Error description"
}
```

## Validation Features

The application includes comprehensive validation for configuration parameters:

### Version Range Validation
- **Platform Channels**: Validates that min/max versions are compatible with the selected channel
- **Operator Channels**: Validates version ranges against available operator versions
- **Auto-correction**: Automatically fixes invalid ranges (min > max scenarios)
- **Channel Compatibility**: Ensures versions match channel major.minor versions (e.g., `stable-4.21` requires `4.21.x` versions)

### Validation Triggers
- **Platform Channels**: Validation triggers on `onBlur` events (when user finishes typing)
- **Operator Channels**: Validation triggers after dropdown selection
- **Real-time Feedback**: Toast notifications provide immediate validation feedback

### Validation Examples
```json
// Valid configuration for stable-4.21 channel
{
  "channel": "stable-4.21",
  "minVersion": "4.21.1",
  "maxVersion": "4.21.9"
}

// Invalid configuration - version mismatch
{
  "channel": "stable-4.21", 
  "minVersion": "4.20.1",  // ❌ Wrong major.minor version
  "maxVersion": "4.21.9"
}

// Invalid configuration - min > max
{
  "channel": "stable-4.21",
  "minVersion": "4.21.9",  // ❌ Greater than max
  "maxVersion": "4.21.1"   // ❌ Less than min
}
```

## Endpoints

### System Information

#### GET /api/health
Health check endpoint for container orchestration and monitoring.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "service": "mirror-gui"
}
```

#### GET /api/system/info
Get system information including versions, disk space, architecture, and cache details.

**Response:**
```json
{
  "ocMirrorVersion": "4.21.0",
  "systemArchitecture": "x86_64",
  "availableDiskSpace": 480673603584,
  "totalDiskSpace": 876538232832,
  "hostDataDir": "/home/user/mirror-gui/data",
  "cacheDir": "/app/data/cache",
  "hostCacheDir": "/home/user/mirror-gui/data/cache",
  "cacheSizeBytes": 2552543632
}
```

**Response Fields:**
- `hostDataDir`: The host-side data directory path
- `cacheDir`: The cache directory inside the container
- `hostCacheDir`: The cache directory mapped to the host path
- `cacheSizeBytes`: Current cache size in bytes

#### GET /api/system/status
Get system status including oc-mirror version, overall health, and pull secret detection.

**Response:**
```json
{
  "ocMirrorVersion": "2.0.0",
  "systemHealth": "healthy",
  "pullSecretDetected": true
}
```

**Response Fields:**
- `ocMirrorVersion`: The version of the oc-mirror binary
- `systemHealth`: Overall system health indicator (`"healthy"` or `"degraded"`)
- `pullSecretDetected`: Whether a valid pull secret file was found at the configured path

#### GET /api/system/paths
Get available system paths for mirror storage and other operations.

**Response:**
```json
{
  "paths": [
    {
      "path": "/app/data",
      "label": "Data Directory",
      "description": "Persistent - mounted volume, contains configs, operations, logs, cache, and mirrors",
      "available": true
    },
    {
      "path": "/app/data/mirrors",
      "label": "Mirror Storage",
      "description": "Persistent - base directory for all mirror archives",
      "available": true
    }
  ]
}
```

#### GET /api/mirror-folders
Get list of existing subdirectories under the mirror base directory. Used by the Mirror Destination Folder typeahead to suggest existing folders.

**Response:**
```json
{
  "folders": ["default", "odf", "production"]
}
```

- `folders`: Sorted array of directory names under `MIRROR_BASE_DIR`. Returns an empty array if the base directory does not exist yet.

#### POST /api/mirror-folders
Create a new subdirectory under the mirror base directory. The folder name must contain only letters, numbers, dashes, and underscores.

**Request:**
```json
{
  "name": "group-sync"
}
```

**Response (201):**
```json
{
  "created": "group-sync",
  "path": "/app/data/mirrors/group-sync"
}
```

**Error (400):**
```json
{
  "error": "Use only letters, numbers, dashes, and underscores"
}
```

### Statistics and Dashboard

#### GET /api/stats
Get application statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalOperations": 10,
    "successfulOperations": 8,
    "failedOperations": 1,
    "runningOperations": 1,
    "stoppedOperations": 0
  }
}
```

#### GET /api/operations/recent
Get recent operations for dashboard display.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Operation Name",
      "status": "running",
      "startTime": "2024-01-15T10:30:00Z",
      "endTime": null
    }
  ]
}
```

### Configuration Management

#### GET /api/config/list
Get list of saved configurations.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "config-id",
      "name": "Configuration Name",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### GET /api/config/download/:filename
Download a saved ImageSetConfiguration YAML file from the configs directory. The filename must be a basename ending in `.yaml` or `.yml` (path traversal is rejected).

**Response:** Raw file bytes with `Content-Disposition: attachment` and `Content-Type: application/x-yaml`.

**Error (400):** Invalid filename (wrong extension or path).

**Error (404):** File does not exist.

#### POST /api/config/save
Save a new configuration.

**Request Body:**
- `name` (string, optional): Filename for the saved configuration (defaults to `imageset-config-<timestamp>.yaml`). `.yaml` is appended automatically if the name does not end with `.yaml` or `.yml`.
- `config` (string or object, required): The ImageSetConfiguration — either as a YAML string or a JSON object

**Example — JSON object:**
```json
{
  "name": "test-config",
  "config": {
    "kind": "ImageSetConfiguration",
    "apiVersion": "mirror.openshift.io/v2alpha1",
    "archiveSize": 4,
    "mirror": {
      "platform": {
        "channels": [{"name": "stable-4.16", "minVersion": "4.16.0", "maxVersion": "4.16.3"}]
      },
      "operators": [],
      "additionalImages": []
    }
  }
}
```

**Example — YAML string:**
```json
{
  "name": "test-config.yaml",
  "config": "kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  platform:\n    channels:\n      - name: stable-4.16\n        minVersion: \"4.16.0\"\n        maxVersion: \"4.16.3\"\n  operators: []\n  additionalImages: []"
}
```

**Configuration Parameters:**
- `archiveSize` (number, optional): Maximum size in GiB for archive files when mirroring to disk. Leave empty/omit to use default behavior.

**Response:**
```json
{
  "message": "Configuration saved successfully",
  "filename": "test-config"
}
```

**Error (400):** Missing `config`, invalid YAML, or configuration fails validation (wrong `kind`, `apiVersion`, or missing `mirror` section).

**Error (500):** Failed to write configuration file.

#### POST /api/config/upload
Upload a YAML configuration file.

**Request Body:**
```json
{
  "filename": "my-config.yaml",
  "content": "kind: ImageSetConfiguration\napiVersion: mirror.openshift.io/v2alpha1\nmirror:\n  operators:\n  - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.21\n    packages:\n    - name: advanced-cluster-management"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Configuration uploaded successfully",
    "filename": "my-config.yaml"
  }
}
```

**Error Response (File Already Exists):**
```json
{
  "success": false,
  "error": "File already exists",
  "code": "FILE_EXISTS",
  "data": {
    "filename": "my-config.yaml"
  }
}
```

#### DELETE /api/config/delete/:filename
Delete a configuration file.

**Parameters:**
- `filename`: Name of the configuration file to delete

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Configuration deleted successfully",
    "filename": "my-config.yaml"
  }
}
```

**Error Response (File Not Found):**
```json
{
  "success": false,
  "error": "Configuration file not found",
  "code": "FILE_NOT_FOUND"
}
```

### Platform Channels

#### GET /api/channels
Get available OpenShift Container Platform channels.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "stable-4.18",
      "description": "Stable 4.18 channel"
    }
  ]
}
```

### Operator Catalogs and Discovery

#### GET /api/catalogs
Get available operator catalogs.

**Query Parameters:**
- `version` (optional): Filter by OCP version (4.16, 4.17, 4.18, 4.19, 4.20, 4.21)

**Catalog Fetch Workflow:**
- Catalog snapshots are produced by host-side sync workflows such as `./sync-catalogs.sh` or any `./local-build.sh` build path
- Each fetch run always performs a full pull of all supported catalogs; there is no freshness window or separate `--force` mode
- The API serves the current local catalog snapshot available under `catalog-data/`

**Response:**
```json
[
  {
    "name": "redhat-operator-index",
    "url": "registry.redhat.io/redhat/redhat-operator-index:v4.21",
    "description": "Red Hat certified operators",
    "operatorCount": 175,
    "digest": "sha256:a1b2c3d4e5f6...",
    "syncedAt": "2026-05-11T19:30:00Z"
  },
  {
    "name": "certified-operator-index",
    "url": "registry.redhat.io/redhat/certified-operator-index:v4.21",
    "description": "Certified operators",
    "operatorCount": 120,
    "digest": null,
    "syncedAt": null
  }
]
```

**Response Fields:**
- `name`: Catalog type identifier (e.g., `redhat-operator-index`)
- `url`: Full registry URL including OCP version tag
- `description`: Human-readable catalog description
- `operatorCount`: Number of operators available in this catalog
- `digest`: SHA-256 image digest of the catalog (e.g., `sha256:a1b2...`), or `null` if not yet synced. Populated when catalogs are synced via `POST /api/catalogs/sync` or during image build.
- `syncedAt`: ISO 8601 timestamp of when the digest was captured, or `null` if not yet synced.

**Supported OCP Versions:**
- 4.16
- 4.17
- 4.18
- 4.19
- 4.20
- 4.21

#### GET /api/operators
Get available operators from catalogs.

**Query Parameters:**
- `catalog` (optional): Filter by specific catalog URL

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "advanced-cluster-management",
      "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.18",
      "description": "Advanced Cluster Management for Kubernetes"
    }
  ]
}
```

#### GET /api/operator-channels/:operator
Get available channels for a specific operator.

**Parameters:**
- `operator`: Operator name

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "release-2.8",
      "description": "Release 2.8 channel"
    }
  ]
}
```

#### GET /api/operators/:operator/versions
Get available versions for a specific operator.

**Parameters:**
- `operator`: Operator name

**Query Parameters:**
- `catalog` (optional): Filter by specific catalog URL
- `channel` (optional): Filter by channel name

**Response:**
```json
{
  "versions": ["1.0.0", "1.1.0", "1.2.0"]
}
```

#### GET /api/operators/channels
Get channels for an operator from a specific catalog (batch query).

**Query Parameters:**
- `catalogUrl` (required): Full catalog URL (e.g., `registry.redhat.io/redhat/redhat-operator-index:v4.21`)
- `operatorName` (required): Operator package name

**Response:**
```json
[
  {
    "name": "stable-v4.21",
    "availableVersions": ["4.19.0", "4.19.1", "4.19.2"]
  }
]
```

#### POST /api/operators/refresh-cache
Reload the in-memory operator cache from the current local catalog snapshot or fallback sources. This does not pull fresh catalogs from remote registries.

**Response:**
```json
{
  "message": "Operator cache refreshed successfully"
}
```

#### GET /api/operators/:operator/dependencies
Get dependencies for a specific operator.

**Parameters:**
- `operator`: Operator name

**Query Parameters:**
- `catalogUrl` (optional): Specific catalog URL to search. If omitted, searches all catalogs.

**Example Request:**
```bash
curl "http://localhost:3000/api/operators/odf-operator/dependencies?catalogUrl=registry.redhat.io/redhat/redhat-operator-index:v4.21"
```

**Response:**
```json
{
  "operator": "odf-operator",
  "catalogType": "redhat-operator-index",
  "catalogVersion": "v4.18",
  "dependencies": [
    {
      "packageName": "mcg-operator",
      "versionRange": ">=4.9.0 <=4.17.0",
      "requiredBy": "odf-operator",
      "catalog": "registry.redhat.io/redhat/redhat-operator-index:v4.18"
    }
  ],
  "count": 1
}
```

**Response (no dependencies):**
```json
{
  "operator": "some-operator",
  "dependencies": [],
  "message": "No dependencies found for this operator"
}
```

**Notes:**
- Dependencies are pre-computed during catalog fetch for faster runtime lookups
- If `catalogUrl` is omitted, searches all available catalogs and returns the first match

### Operations Management

#### GET /api/operations
Get list of all operations.

**Query Parameters:**
- `status` (optional): Filter by status (running, completed, failed, stopped)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "operation-id",
      "name": "Operation Name",
      "status": "success",
      "startedAt": "2024-01-15T10:30:00Z",
      "completedAt": "2024-01-15T10:45:00Z",
      "duration": 900,
      "configFile": "my-config.yaml",
      "mirrorDestination": "/app/data/mirrors/default"
    }
  ]
}
```

**Operation Status Values:**
- `running` - Operation is currently executing
- `success` - Operation completed successfully
- `failed` - Operation failed with errors
- `stopped` - Operation was manually stopped

#### GET /api/operations/history
Get operation history (alias for /api/operations).

#### POST /api/operations/start
Start a new mirror operation.

**Request Body:**
```json
{
  "name": "Operation Name",
  "configId": "config-id",
  "mirrorDestinationSubdir": "default"
}
```

**Request Parameters:**
- `name` (string, required): Name for the operation
- `configId` (string, required): Configuration file name (e.g., "my-config.yaml")
- `mirrorDestinationSubdir` (string, optional): Subdirectory name within `/app/data/mirrors/` where mirror files will be saved. 
  - If not provided or empty, defaults to `default`
  - Must be alphanumeric with dashes and underscores only (no slashes or special characters)
  - Examples: `default`, `odf`, `production`, `test-123`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "operation-id",
    "message": "Operation started successfully",
    "mirrorDestination": "/app/data/mirrors/default"
  }
}
```

**Error Response (Invalid Subdirectory):**
```json
{
  "success": false,
  "error": "Subdirectory name contains invalid characters",
  "provided": "invalid/path",
  "help": "Use only letters, numbers, dashes (-), and underscores (_)"
}
```

**Error Response (Permission Denied):**
```json
{
  "success": false,
  "error": "Mirror destination directory exists but is not writable",
  "path": "/app/data/mirrors/custom",
  "code": "EACCES",
  "details": "Permission denied",
  "help": "The directory exists but the container cannot write to it. Check permissions on the host."
}
```

**Notes:**
- Mirror archives are saved persistently to the host filesystem at `data/mirrors/{subdirectory}/` on the host
- Files survive container restarts
- The full host path is displayed in the operation details after completion

#### GET /api/operations/:id/details
Get detailed information about a specific operation.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "operation-id",
    "name": "Operation Name",
    "status": "success",
    "startedAt": "2024-01-15T10:30:00Z",
    "completedAt": "2024-01-15T10:45:00Z",
    "duration": 900,
    "configFile": "my-config.yaml",
    "mirrorDestination": "/app/data/mirrors/default",
    "config": { ... },
    "logs": "..."
  }
}
```

**Response Fields:**
- `mirrorDestination`: The full container path where mirror files are saved (e.g., `/app/data/mirrors/default`)
- Host path is `{project-root}/data/mirrors/{subdirectory}/` where `{project-root}` is typically the application directory

#### GET /api/operations/:id/logs
Get operation logs.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": "Operation log content..."
  }
}
```

#### GET /api/operations/:id/logstream
Get real-time operation log stream (Server-Sent Events).

**Parameters:**
- `id`: Operation ID

**Response:** Server-Sent Events stream

**Note:** Logs are persisted to `data/logs/` directory and survive container restarts.

#### POST /api/operations/:id/stop
Stop a running operation.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Operation stopped successfully"
  }
}
```

#### DELETE /api/operations/:id
Delete an operation record and its associated log file.

**Parameters:**
- `id`: Operation ID

**Response:**
```json
{
  "message": "Operation deleted successfully"
}
```

**Bulk delete:** The UI supports selecting multiple operations and deleting them in parallel by issuing concurrent `DELETE` requests. There is no dedicated bulk-delete endpoint; the frontend calls `DELETE /api/operations/:id` for each selected operation.

**Example (single):**
```bash
curl -X DELETE http://localhost:3000/api/operations/abc123
```

### Pull Secret Management

#### GET /api/pull-secret/status
Check whether a pull secret is detected.

**Response:**
```json
{
  "detected": true,
  "path": "/app/data/pull-secret.json"
}
```

The path is `OC_MIRROR_AUTHFILE` when set, otherwise `pull-secret.json` inside `STORAGE_DIR`.

#### GET /api/pull-secret/content
Get the current pull secret content for viewing/editing.

**Response:**
```json
{
  "content": "{\"auths\":{...}}"
}
```

#### POST /api/pull-secret
Save a pull secret. The content is validated as JSON and saved to the configured `AUTHFILE_PATH`.

Returns `409` when the authfile is managed outside the application, which is the case when
the Helm chart points `OC_MIRROR_AUTHFILE` at a read-only Secret mount.

**Request Body:**
```json
{
  "content": "{\"auths\":{\"registry.redhat.io\":{\"auth\":\"...\",\"email\":\"...\"}}}"
}
```

#### DELETE /api/pull-secret
Remove the pull secret file. Returns `409` when the authfile is managed outside the
application, as with a read-only Secret mount.

**Response:**
```json
{
  "message": "Pull secret removed successfully"
}
```

### Registry Authentication

#### GET /api/registries
Get registries parsed from the pull secret with authentication info and cached verification status. Non-registry hosts (e.g. `cloud.openshift.com`) are filtered out.

**Response:**
```json
{
  "registries": [
    {
      "registry": "registry.redhat.io",
      "username": "user",
      "hasAuth": true,
      "status": "authenticated",
      "error": null
    }
  ]
}
```

**Response Fields:**
- `status`: Cached verification result -- `"not_verified"` (default), `"authenticated"`, or `"failed"`. Persists in-memory until the server process restarts.
- `error`: Error details when `status` is `"failed"`, otherwise `null`/undefined.

#### POST /api/registries/verify
Verify authentication against a specific registry using Docker v2 auth flow. Results are cached in memory and reflected in subsequent `GET /api/registries` responses.

**Request Body:**
```json
{
  "registry": "registry.redhat.io"
}
```

**Response:**
```json
{
  "registry": "registry.redhat.io",
  "status": "authenticated"
}
```

**Response (failed):**
```json
{
  "registry": "registry.redhat.io",
  "status": "failed",
  "error": "Authentication failed (401)"
}
```

### Cache Management

#### POST /api/cache/cleanup
Delete all files in the cache directory.

**Response:**
```json
{
  "message": "Cache cleaned up successfully"
}
```

**Notes:**
- The cache directory is set via the `OC_MIRROR_CACHE_DIR` environment variable (default: `/app/data/cache`)
- To override, set `CACHE_DIR` when starting the app: `CACHE_DIR=/tmp/cache ./mirror-gui.sh`

### Catalog Sync

#### POST /api/catalogs/sync
Trigger a full operator catalog sync from registry.redhat.io. Requires a pull secret. Runs `sync-catalogs.sh` in the background and streams progress to the sync status endpoint.

**Response:**
```json
{
  "status": "started",
  "message": "Catalog sync started"
}
```

**Response (no pull secret):**
```json
{
  "error": "Pull secret not detected. Please configure a pull secret first."
}
```

#### GET /api/catalogs/sync/status
Get current catalog sync status, progress, logs, and diff.

**Response:**
```json
{
  "status": "running",
  "syncStartTime": "2026-05-07T10:00:00.000Z",
  "lastSyncTime": null,
  "successCount": 5,
  "failedCount": 0,
  "totalCount": 18,
  "completedCatalogs": 5,
  "currentCatalog": "certified-operator-index:v4.18",
  "logs": ["Extracting redhat-operator-index:v4.16 ...", "..."],
  "diff": [],
  "hasRuntimeSyncData": true
}
```

**Response Fields:**
- `hasRuntimeSyncData`: `true` when runtime-synced catalog data is present on disk (same probe as `DELETE /api/catalogs/sync/data`); use this to enable a “clear sync data” action in the UI
- `syncStartTime`: ISO timestamp when the current/last sync started
- `completedCatalogs`: Number of catalogs processed so far
- `currentCatalog`: Catalog currently being processed (while running)
- `diff`: Array of catalog change entries after sync completes, each with `catalog`, `newOperators`, `removedOperators`, and `updatedOperators` (with version details)

#### DELETE /api/catalogs/sync/data
Clear runtime-synced catalog data and fall back to built-in catalog data baked into the container image. Does not require an app restart.

**Response:**
```json
{
  "message": "Runtime catalog data cleared. Reverted to built-in catalog data.",
  "operatorCount": 243
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `CONFIG_NOT_FOUND` | Configuration not found |
| `OPERATION_NOT_FOUND` | Operation not found |
| `INVALID_CONFIG` | Invalid configuration format |
| `OPERATION_FAILED` | Operation execution failed |
| `REGISTRY_AUTH_FAILED` | Registry authentication failed |
| `CATALOG_FETCH_FAILED` | Failed to fetch operator catalog |
| `FILE_EXISTS` | Configuration file already exists |
| `FILE_NOT_FOUND` | Configuration file not found |
| `INVALID_YAML` | Invalid YAML format in uploaded file |
| `INVALID_KIND` | Invalid ImageSetConfiguration kind |
| `INVALID_API_VERSION` | Invalid API version in uploaded file |
| `EACCES` | Permission denied (file system access error) |
| `INVALID_SUBDIRECTORY` | Invalid subdirectory name (contains path separators or invalid characters) |
| `SUBDIRECTORY_NOT_WRITABLE` | Mirror destination subdirectory exists but is not writable |
| `INVALID_PULL_SECRET` | Invalid pull secret format or content |
| `SYSTEM_ERROR` | Internal system error |

## Rate Limiting

Currently, there are no rate limits implemented on the API endpoints.

## CORS

The API supports CORS and can be accessed from web browsers. All origins are allowed in development mode.

## Health Check

The application provides multiple health check endpoints:

- **`/api/health`**: Simple JSON health check endpoint for container orchestration (Docker HEALTHCHECK, Kubernetes liveness probes, etc.)
- **`/api/system/info`**: Detailed system information including versions, architecture, resource usage, and host data directory
- **`/api/system/status`**: System status summary including oc-mirror version, system health, and pull secret detection

All three endpoints can be used by load balancers, monitoring systems, and container orchestration platforms.

## Examples

### Using curl

```bash
# Get system information
curl http://localhost:3000/api/system/info

# Health check
curl http://localhost:3000/api/health

# Get system paths
curl http://localhost:3000/api/system/paths

# List existing mirror destination folders
curl http://localhost:3000/api/mirror-folders

# Create a new mirror destination folder
curl -X POST http://localhost:3000/api/mirror-folders \
  -H "Content-Type: application/json" \
  -d '{"name": "group-sync"}'

# Download a saved configuration YAML (URL-encode the filename if needed)
curl -OJ "http://localhost:3000/api/config/download/my-config.yaml"

# Start an operation with default mirror destination
curl -X POST http://localhost:3000/api/operations/start \
  -H "Content-Type: application/json" \
  -d '{"name": "My Operation", "configId": "my-config.yaml"}'

# Start an operation with custom mirror destination subdirectory
curl -X POST http://localhost:3000/api/operations/start \
  -H "Content-Type: application/json" \
  -d '{"name": "My Operation", "configId": "my-config.yaml", "mirrorDestinationSubdir": "odf"}'

# Get operation logs
curl http://localhost:3000/api/operations/operation-123/logs

# Check pull secret status
curl http://localhost:3000/api/pull-secret/status

# Upload a pull secret
curl -X POST http://localhost:3000/api/pull-secret \
  -H "Content-Type: application/json" \
  -d '{"content": "{\"auths\":{\"registry.redhat.io\":{\"auth\":\"...\",\"email\":\"...\"}}}"}'

# List registries from pull secret
curl http://localhost:3000/api/registries

# Verify registry authentication
curl -X POST http://localhost:3000/api/registries/verify \
  -H "Content-Type: application/json" \
  -d '{"registry": "registry.redhat.io"}'

# Clean up cache
curl -X POST http://localhost:3000/api/cache/cleanup
```

### Using JavaScript

```javascript
// Get available operators
const response = await fetch('/api/operators');
const data = await response.json();

// Start operation with default mirror destination
const startResponse = await fetch('/api/operations/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'My Operation',
    configId: 'my-config.yaml'
  })
});

// Start operation with custom mirror destination subdirectory
const startResponseCustom = await fetch('/api/operations/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'ODF Mirror Operation',
    configId: 'odf-config.yaml',
    mirrorDestinationSubdir: 'odf'
  })
});

// Check health
const healthResponse = await fetch('/api/health');
const healthData = await healthResponse.json();
console.log('Health status:', healthData.status);
``` 