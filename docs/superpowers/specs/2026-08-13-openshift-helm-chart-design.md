# OpenShift Helm Chart Design

## Goal

Provide an OpenShift-only Helm chart that deploys Mirror-GUI safely under the default restricted security context, with persistent mirror data, a configurable pull-secret mount, and an opt-in Route.

## Scope

- Add a chart beneath `charts/mirror-gui`.
- Create a Deployment, Service, PersistentVolumeClaim, and optional Route.
- Keep all chart behavior configurable through `values.yaml`.
- Make the container compatible with OpenShift's restricted SCC.
- Document installation, persistent storage, pull-secret creation, and Route exposure.

## Non-goals

- Upstream Kubernetes support.
- Creating an SCC or requesting `anyuid` privileges.
- Bundling registry credentials in chart values.
- Application-level authentication or authorization.
- Horizontal scaling. Mirror-GUI remains a single-replica, single-user workload.

## Architecture

The chart deploys one replica and mounts one user-configurable PVC at `/app/data`. This preserves configurations, logs, cached content, operation records, and mirror output across Pod restarts. `persistence.storageClass` is optional: an empty value uses the cluster default StorageClass; a named value is emitted on the PVC.

The user creates an existing OpenShift Secret containing the pull-secret. The chart mounts a selected key read-only and sets `OC_MIRROR_AUTHFILE` to its in-container path. It never renders secret data from values.

The Service exposes port 3001 inside the cluster. `route.enabled` is `false` by default. When enabled, the chart creates an edge-terminated OpenShift Route to the Service. The Route deliberately does not add authentication because the application has none; its host, TLS policy, and network access are therefore operator responsibilities.

## OpenShift Security Model

The current image starts as root to adjust `/app/data` ownership, then changes to UID 1001. That conflicts with OpenShift's default restricted SCC, which runs containers with an arbitrary non-root UID. The image startup must instead be made arbitrary-UID compatible:

- Remove the runtime ownership changes and the dependency on the named `default` user.
- Ensure image-owned writable paths are group-owned by GID 0 and group-writable at build time.
- Start the Node process directly as the OpenShift-assigned UID.
- Set pod and container security contexts to require non-root execution, drop all Linux capabilities, disable privilege escalation, and use the RuntimeDefault seccomp profile.

No SCC object is installed by the chart.

## Chart Interface

`values.yaml` exposes these documented values:

| Value | Default | Purpose |
| --- | --- | --- |
| `image.repository` | project image repository | Image repository |
| `image.tag` | chart appVersion | Image tag |
| `image.pullPolicy` | `IfNotPresent` | Image pull policy |
| `replicaCount` | `1` | Must remain one unless application semantics change |
| `persistence.enabled` | `true` | Create and mount the data PVC |
| `persistence.size` | documented conservative default | Requested PVC capacity |
| `persistence.storageClass` | `""` | Empty uses cluster default; named value selects a class |
| `pullSecret.existingSecret` | `""` | Existing Secret name, required for authenticated mirroring |
| `pullSecret.key` | `pull-secret.json` | Secret key to mount |
| `route.enabled` | `false` | Create the optional Route |
| `route.host` | `""` | Optional Route host |
| `resources` | bounded defaults | Pod resource requests and limits |

The chart sets `PORT=3001`, `STORAGE_DIR=/app/data`, `OC_MIRROR_CACHE_DIR=/app/data/cache`, and `OC_MIRROR_BASE_MIRROR_DIR=/app/data/mirrors`.

## Validation

- Render tests verify default resources, PVC behavior for default and explicit storage classes, Secret mount behavior, and Route omission/creation.
- Chart linting validates Helm metadata and templates.
- An OpenShift smoke test installs the chart with a test PVC and validates `/api/health` through the Service. A Route smoke assertion runs only when `route.enabled=true`.
- Documentation states that publicly exposing the Route is unsafe without compensating access controls.

## Acceptance Criteria

1. `helm lint charts/mirror-gui` succeeds.
2. Default rendering produces a restricted-SCC-compatible single-replica Deployment, Service, and PVC, but no Route.
3. An explicit storage class is rendered only when configured.
4. An existing Secret is mounted read-only without its contents entering rendered values or documentation examples.
5. Enabling the Route renders an edge-terminated Route.
6. The container starts successfully under the OpenShift restricted SCC and reports healthy at `/api/health`.
