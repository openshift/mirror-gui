# OpenShift Helm Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an OpenShift-only Helm chart that deploys Mirror-GUI with restricted-SCC-compatible security, persistent data, an optional existing pull secret, and an opt-in Route.

**Architecture:** The chart in `charts/mirror-gui` renders one Deployment, Service, optional data PVC, and optional OpenShift Route. The image is changed to run directly as the arbitrary UID assigned by OpenShift; all persistent state remains under `/app/data`, and an `emptyDir` supplies writable `/tmp` when the root filesystem is read-only.

**Tech Stack:** Helm 3 templates, OpenShift Route API, Kubernetes core APIs, Bash, Podman, existing Node 22/Vitest tooling.

## Global Constraints

- OpenShift only. Do not add upstream-Kubernetes compatibility shims.
- Do not create an SCC or require `anyuid`; target the default restricted SCC.
- Do not add npm, Helm, or chart-testing dependencies.
- Deploy exactly one replica. Do not add autoscaling.
- Never render registry credentials from `values.yaml`; mount only an existing Secret when configured.
- `route.enabled` defaults to `false`; the enabled Route uses edge TLS termination.
- `persistence.storageClass: ""` uses the cluster default StorageClass; emit `storageClassName` only for a non-empty value.
- `/app/data` is persistent by default; when persistence is disabled, mount an `emptyDir` at that path.
- Require non-root execution, drop all capabilities, disable privilege escalation, use `RuntimeDefault`, and set `readOnlyRootFilesystem: true`.
- Mount a separate `emptyDir` at `/tmp` and set `TMPDIR=/tmp`.

## File Structure

- `Dockerfile`: make `/app` group-0 writable and stop declaring root as the final image user.
- `entrypoint.sh`: create required data directories without ownership changes or a fixed UID.
- `scripts/verify-openshift-restricted.sh`: start the built image with an arbitrary UID, a read-only root filesystem, writable data, and writable `/tmp`; assert the health endpoint responds.
- `charts/mirror-gui/Chart.yaml`: chart metadata and application version.
- `charts/mirror-gui/values.yaml`: documented public chart configuration and secure defaults.
- `charts/mirror-gui/templates/_helpers.tpl`: stable names, labels, and selector labels.
- `charts/mirror-gui/templates/deployment.yaml`: one restricted-SCC-compatible Pod and all mounts, probes, and application environment.
- `charts/mirror-gui/templates/service.yaml`: in-cluster port 3001 Service.
- `charts/mirror-gui/templates/pvc.yaml`: conditional data PVC.
- `charts/mirror-gui/templates/route.yaml`: conditional OpenShift edge Route.
- `charts/mirror-gui/templates/NOTES.txt`: post-install access and security warning.
- `scripts/verify-helm-chart.sh`: dependency-free assertions over Helm render output.
- `.github/workflows/mirror-gui-tests.yml`: install Helm and run lint/render checks; run the restricted-image test after the Podman build.
- `README.md`: Helm installation, existing Secret, storage, Route, and security instructions.

---

### Task 1: Make the image work under the restricted SCC

**Files:**
- Modify: `Dockerfile:136-151`
- Modify: `entrypoint.sh:1-27`
- Create: `scripts/verify-openshift-restricted.sh`
- Modify: `.github/workflows/mirror-gui-tests.yml:55-68`

**Interfaces:**
- Consumes: `PORT`, `STORAGE_DIR`, `OC_MIRROR_CACHE_DIR`, `OC_MIRROR_BASE_MIRROR_DIR`, and `TMPDIR` environment variables.
- Produces: an image that starts as an arbitrary non-root UID with primary GID 0, writes only `/app/data` and `/tmp`, and answers `GET /api/health` on port 3001.

- [ ] **Step 1: Write the failing restricted-runtime verifier**

Create `scripts/verify-openshift-restricted.sh` with this behavior. The script must build no image itself, create a dedicated temporary host directory, make it group-0 writable, run the image as an arbitrary UID, then check health from inside the container.

```bash
#!/bin/bash
set -euo pipefail

image_name="${1:?usage: $0 IMAGE}"
container_name="mirror-gui-restricted-test-$$"
data_dir="$(mktemp -d)"
cleanup() {
    podman rm -f "$container_name" >/dev/null 2>&1 || true
    rm -rf "$data_dir"
}
trap cleanup EXIT

chmod 0770 "$data_dir"
podman run -d --name "$container_name" --user 1000670000:0 \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -v "$data_dir:/app/data:Z" \
    -e PORT=3001 -e STORAGE_DIR=/app/data -e TMPDIR=/tmp \
    -e OC_MIRROR_CACHE_DIR=/app/data/cache \
    -e OC_MIRROR_BASE_MIRROR_DIR=/app/data/mirrors \
    "$image_name"

for attempt in $(seq 1 30); do
    if podman exec "$container_name" wget -qO- http://127.0.0.1:3001/api/health | grep -Fq '"status":"healthy"'; then
        exit 0
    fi
    sleep 1
done
podman logs "$container_name"
exit 1
```

- [ ] **Step 2: Run the verifier against the current image to prove the failure**

Run:

```bash
podman build -t mirror-gui:restricted-test .
scripts/verify-openshift-restricted.sh mirror-gui:restricted-test
```

Expected: FAIL because the current entrypoint requires root to `chown` `/app/data` and then invokes the fixed `default` user.

- [ ] **Step 3: Remove fixed-UID startup behavior and make image paths group-0 writable**

Replace the runtime ownership logic in `entrypoint.sh` with directory creation only. Do not call `chown`, `chmod`, `su`, or `runuser` at runtime.

```bash
#!/bin/bash
set -e

APP_DATA="${STORAGE_DIR:-/app/data}"
for directory in configs operations logs cache mirrors/default catalog-data; do
    mkdir -p "$APP_DATA/$directory"
done

exec "$@"
```

In `Dockerfile`, replace the final `/app` ownership setup with a group-0-compatible permission change and set a non-root image user. Keep GID 0 so OpenShift’s arbitrary UID can use group permissions.

```dockerfile
RUN mkdir -p /app/data && \
    chgrp -R 0 /app && \
    chmod -R g=u /app

USER 1001
```

Do not hardcode `runAsUser`, `runAsGroup`, or `fsGroup` in the chart. OpenShift supplies values permitted by the namespace SCC.

- [ ] **Step 4: Run the restricted-runtime verifier and existing checks**

Run:

```bash
shellcheck -S error entrypoint.sh scripts/verify-openshift-restricted.sh
podman build -t mirror-gui:restricted-test .
scripts/verify-openshift-restricted.sh mirror-gui:restricted-test
npm run build
npm test
```

Expected: all commands pass; the verifier receives `{"status":"healthy",...}` while the container uses an arbitrary UID and a read-only root filesystem.

- [ ] **Step 5: Add the verifier to CI and commit**

Add `scripts/verify-openshift-restricted.sh` to the shellcheck loop. In the existing `container-image` job, run the verifier immediately after `podman build`, using `mirror-gui:ci`.

```yaml
- name: Verify restricted OpenShift runtime
  run: scripts/verify-openshift-restricted.sh mirror-gui:ci
```

Run the workflow-equivalent commands above, inspect `git diff` for credentials, then commit:

```bash
git add Dockerfile entrypoint.sh scripts/verify-openshift-restricted.sh .github/workflows/mirror-gui-tests.yml
git commit -m "feat: support restricted OpenShift runtime"
```

### Task 2: Create the Helm chart and core workload templates

**Files:**
- Create: `charts/mirror-gui/Chart.yaml`
- Create: `charts/mirror-gui/values.yaml`
- Create: `charts/mirror-gui/templates/_helpers.tpl`
- Create: `charts/mirror-gui/templates/deployment.yaml`
- Create: `charts/mirror-gui/templates/service.yaml`
- Create: `charts/mirror-gui/templates/pvc.yaml`

**Interfaces:**
- Consumes: the values in the chart interface from the approved spec.
- Produces: named templates `mirror-gui.fullname`, `mirror-gui.labels`, and `mirror-gui.selectorLabels`; a Deployment selector used identically by the Service; an optional PVC named `{{ include "mirror-gui.fullname" . }}`.

- [ ] **Step 1: Write the failing default-render assertions**

Create `scripts/verify-helm-chart.sh` with strict assertions. Start with this default case, which must fail until the chart exists:

```bash
#!/bin/bash
set -euo pipefail

chart_dir="charts/mirror-gui"
render="$(mktemp)"
trap 'rm -f "$render"' EXIT
assert_contains() { grep -Fq "$1" "$render" || { echo "missing: $1" >&2; exit 1; }; }
assert_absent() { ! grep -Fq "$1" "$render" || { echo "unexpected: $1" >&2; exit 1; }; }

helm template test "$chart_dir" >"$render"
assert_contains 'kind: Deployment'
assert_contains 'replicas: 1'
assert_contains 'readOnlyRootFilesystem: true'
assert_contains 'allowPrivilegeEscalation: false'
assert_contains 'type: RuntimeDefault'
assert_contains 'mountPath: /app/data'
assert_contains 'mountPath: /tmp'
assert_contains 'name: TMPDIR'
assert_contains 'value: /tmp'
assert_contains 'kind: Service'
assert_contains 'port: 3001'
assert_contains 'kind: PersistentVolumeClaim'
assert_absent 'kind: Route'
```

- [ ] **Step 2: Run the assertions to verify the failure**

Run:

```bash
helm lint charts/mirror-gui
scripts/verify-helm-chart.sh
```

Expected: FAIL because `charts/mirror-gui` does not exist.

- [ ] **Step 3: Add chart metadata, values, helpers, PVC, Service, and Deployment**

Set `apiVersion: v2`, `type: application`, `version: 0.1.0`, and `appVersion: "1.0"` in `Chart.yaml`. Define the approved values with these secure defaults:

```yaml
replicaCount: 1
persistence:
  enabled: true
  size: 100Gi
  storageClass: ""
pullSecret:
  existingSecret: ""
  key: pull-secret.json
route:
  enabled: false
  host: ""
```

Keep selector labels limited to Helm’s stable name and instance labels. Merge `Values.labels` into the metadata of each rendered object and the Pod template. Merge `Values.annotations` into the metadata of each rendered object and the Pod template, but never into the Service selector.

Use this PVC condition so an empty storage class is omitted rather than rendered as an empty field:

```yaml
{{- if .Values.persistence.enabled }}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "mirror-gui.fullname" . }}
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: {{ .Values.persistence.size }}
  {{- with .Values.persistence.storageClass }}
  storageClassName: {{ . | quote }}
  {{- end }}
{{- end }}
```

In the Deployment, always mount `/tmp` from `emptyDir: {}` and configure the data volume as either the PVC or `emptyDir: {}`. Add `livenessProbe` and `readinessProbe` HTTP GET checks to `/api/health` on port 3001. Configure these mandatory container security settings:

```yaml
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  seccompProfile:
    type: RuntimeDefault
```

Only when `pullSecret.existingSecret` is non-empty, add a read-only Secret volume with `items.key: {{ .Values.pullSecret.key }}` and set `OC_MIRROR_AUTHFILE` to `/app/pull-secret/{{ .Values.pullSecret.key }}`. Do not use `imagePullSecrets`; this Secret is application registry authentication.

- [ ] **Step 4: Run lint and default rendering checks**

Run:

```bash
helm lint charts/mirror-gui
scripts/verify-helm-chart.sh
```

Expected: PASS. Default output has the Deployment, Service, and PVC, has no Route, and contains every security and mount assertion.

- [ ] **Step 5: Commit the core chart**

Inspect `git diff` to confirm no credential values were added, then commit:

```bash
git add charts/mirror-gui scripts/verify-helm-chart.sh
git commit -m "feat: add Mirror-GUI Helm chart"
```

### Task 3: Add Route and render cases for storage, secrets, and metadata

**Files:**
- Create: `charts/mirror-gui/templates/route.yaml`
- Modify: `scripts/verify-helm-chart.sh`

**Interfaces:**
- Consumes: `route.enabled`, `route.host`, `persistence.enabled`, `persistence.storageClass`, `pullSecret.existingSecret`, `pullSecret.key`, `labels`, and `annotations`.
- Produces: an edge-terminated Route only when explicitly enabled and tested template output for every conditional branch.

- [ ] **Step 1: Extend render assertions for each configuration branch**

Append these cases to `scripts/verify-helm-chart.sh`:

```bash
helm template test "$chart_dir" --set persistence.storageClass=fast >"$render"
assert_contains 'storageClassName: "fast"'

helm template test "$chart_dir" --set persistence.enabled=false >"$render"
assert_absent 'kind: PersistentVolumeClaim'
assert_contains 'name: data'
assert_contains 'emptyDir: {}'

helm template test "$chart_dir" --set pullSecret.existingSecret=registry-auth --set pullSecret.key=.dockerconfigjson >"$render"
assert_contains 'secretName: registry-auth'
assert_contains 'key: .dockerconfigjson'
assert_contains 'mountPath: /app/pull-secret'
assert_contains 'value: /app/pull-secret/.dockerconfigjson'

helm template test "$chart_dir" --set route.enabled=true --set route.host=mirror.example.test >"$render"
assert_contains 'kind: Route'
assert_contains 'host: mirror.example.test'
assert_contains 'termination: edge'

helm template test "$chart_dir" --set labels.owner=platform --set annotations.owner=platform >"$render"
assert_contains 'owner: platform'
```

- [ ] **Step 2: Run the extended verifier to prove Route and conditional templates are missing**

Run:

```bash
scripts/verify-helm-chart.sh
```

Expected: FAIL on the first assertion for the unimplemented Route or a missing conditional rendering branch.

- [ ] **Step 3: Implement the Route and complete conditional volume rendering**

Create `route.yaml` with this exact gate and TLS policy:

```yaml
{{- if .Values.route.enabled }}
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: {{ include "mirror-gui.fullname" . }}
spec:
  {{- with .Values.route.host }}
  host: {{ . | quote }}
  {{- end }}
  to:
    kind: Service
    name: {{ include "mirror-gui.fullname" . }}
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
{{- end }}
```

Apply the common labels and annotations used by the other templates to Route metadata. Ensure `route.host: ""` omits `spec.host`, letting OpenShift assign the host.

- [ ] **Step 4: Run all chart checks**

Run:

```bash
helm lint charts/mirror-gui
scripts/verify-helm-chart.sh
```

Expected: PASS for default, explicit storage class, ephemeral data, existing Secret mount, enabled Route, labels, and annotations.

- [ ] **Step 5: Commit Route and render coverage**

Inspect the staged diff for secret-shaped values, then commit:

```bash
git add charts/mirror-gui/templates/route.yaml charts/mirror-gui/templates/deployment.yaml scripts/verify-helm-chart.sh
git commit -m "feat: add optional OpenShift Route"
```

### Task 4: Document and continuously validate the chart

**Files:**
- Create: `charts/mirror-gui/templates/NOTES.txt`
- Modify: `README.md:39-76`
- Modify: `.github/workflows/mirror-gui-tests.yml:1-70`

**Interfaces:**
- Consumes: chart install values and the existing Secret name/key contract.
- Produces: copyable safe installation instructions and CI proof that the chart renders correctly on every push and pull request.

- [ ] **Step 1: Write documentation acceptance checks before editing documentation**

Add these assertions to the end of `scripts/verify-helm-chart.sh` so the release artifact contains chart guidance:

```bash
grep -Fq 'Route access is unauthenticated' "$chart_dir/templates/NOTES.txt"
grep -Fq 'oc create secret generic mirror-gui-pull-secret' README.md
grep -Fq 'helm upgrade --install mirror-gui charts/mirror-gui' README.md
```

- [ ] **Step 2: Run the checks to verify the failure**

Run:

```bash
scripts/verify-helm-chart.sh
```

Expected: FAIL because the Helm notes and README installation instructions do not exist.

- [ ] **Step 3: Add user-facing Helm instructions and CI job**

In `README.md`, add an OpenShift Helm deployment section after local container instructions. Include this safe, value-free Secret creation example:

```bash
oc -n mirror-gui create secret generic mirror-gui-pull-secret \
  --from-file=pull-secret.json=/secure/path/pull-secret.json

helm upgrade --install mirror-gui charts/mirror-gui \
  --namespace mirror-gui --create-namespace \
  --set persistence.storageClass=fast \
  --set pullSecret.existingSecret=mirror-gui-pull-secret
```

State that users choose PVC size and storage class, disabling persistence makes all data ephemeral, and `route.enabled=true` exposes an unauthenticated administrative interface that must be protected by cluster access controls.

In `NOTES.txt`, print the Service DNS endpoint and, when `route.enabled` is true, the Route host. Include the exact sentence `Route access is unauthenticated`.

Add a `helm-chart` CI job. Install the pinned current Helm 3 release through the official install script, then run:

```yaml
- name: Lint Helm chart
  run: helm lint charts/mirror-gui

- name: Verify Helm renders
  run: scripts/verify-helm-chart.sh
```

- [ ] **Step 4: Run the full relevant verification suite**

Run:

```bash
shellcheck -S error entrypoint.sh scripts/verify-openshift-restricted.sh scripts/verify-helm-chart.sh
helm lint charts/mirror-gui
scripts/verify-helm-chart.sh
npm run build
npm run lint
npm test
podman build -t mirror-gui:restricted-test .
scripts/verify-openshift-restricted.sh mirror-gui:restricted-test
```

Expected: every command passes. Do not report success if Helm, Podman, or any test command was unavailable or skipped.

- [ ] **Step 5: Commit documentation and CI**

Inspect the complete diff for secrets, then commit:

```bash
git add README.md charts/mirror-gui/templates/NOTES.txt scripts/verify-helm-chart.sh .github/workflows/mirror-gui-tests.yml
git commit -m "docs: document OpenShift Helm deployment"
```

## Final Acceptance Review

- [ ] Run `helm template mirror-gui charts/mirror-gui` and confirm the default has no Route and no `storageClassName`.
- [ ] Run `helm template mirror-gui charts/mirror-gui --set route.enabled=true` and confirm the Route uses edge termination.
- [ ] Run `helm template mirror-gui charts/mirror-gui --set persistence.enabled=false` and confirm `/app/data` uses `emptyDir` and no PVC exists.
- [ ] Run `helm template mirror-gui charts/mirror-gui --set pullSecret.existingSecret=registry-auth` and confirm only the Secret name/key reference appears, never credential content.
- [ ] Install on a disposable OpenShift namespace with an existing pull-secret and a provisioned PVC. Confirm the Pod is admitted by the default restricted SCC and `oc exec` can read `/api/health` through the Service.
- [ ] Enable the Route only in the disposable namespace and confirm it reaches `/api/health`; remove the release with `helm uninstall mirror-gui` after the smoke test.
