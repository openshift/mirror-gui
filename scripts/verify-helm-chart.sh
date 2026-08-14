#!/bin/bash
set -euo pipefail

chart_dir="charts/mirror-gui"
render="$(mktemp)"
cleanup() {
    task_status=$?
    rm -f "$render"
    exit "$task_status"
}
trap cleanup EXIT
assert_contains() { grep -Fq "$1" "$render" || { echo "missing: $1" >&2; exit 1; }; }
assert_absent() { ! grep -Fq "$1" "$render" || { echo "unexpected: $1" >&2; exit 1; }; }
route_document() {
  awk '
    function print_route_document() {
      if (document ~ /(^|\n)kind: Route([[:space:]]|$)/) {
        printf "%s", document
      }
    }
    /^---$/ {
      print_route_document()
      document = $0 ORS
      next
    }
    { document = document $0 ORS }
    END { print_route_document() }
  ' "$render"
}
assert_route_contains() { route_document | grep -Fq "$1" || { echo "missing from Route: $1" >&2; exit 1; }; }
assert_route_absent() { ! route_document | grep -Fq "$1" || { echo "unexpected in Route: $1" >&2; exit 1; }; }
assert_route_count() {
  count="$(route_document | grep -Fc "$1" || true)"
  [ "$count" -eq "$2" ] || { echo "expected $2 Route occurrences of: $1" >&2; exit 1; }
}
assert_data_volume_empty_dir() {
  awk '
    /^      volumes:$/ { volumes = 1; next }
    volumes && /^        - name: data$/ { data_volume = 1; next }
    data_volume && /^        - name:/ { exit 1 }
    data_volume && /^          emptyDir: \{\}$/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$render" || { echo "data volume must be an emptyDir" >&2; exit 1; }
}

helm template test "$chart_dir" >"$render"
assert_contains 'kind: Deployment'
assert_contains 'replicas: 1'
assert_contains 'type: Recreate'
assert_contains 'image: "registry.ci.openshift.org/ocp/5.0:mirror-gui"'
assert_contains 'readOnlyRootFilesystem: true'
assert_contains 'allowPrivilegeEscalation: false'
assert_contains 'runAsNonRoot: true'
assert_contains 'fsGroup: 0'
assert_contains 'drop: [ALL]'
assert_contains 'type: RuntimeDefault'
assert_contains 'startupProbe:'
assert_contains 'failureThreshold: 30'
assert_contains 'livenessProbe:'
assert_contains 'readinessProbe:'
assert_contains 'cpu: 500m'
assert_contains 'memory: 1Gi'
assert_contains 'memory: 4Gi'
assert_contains 'sizeLimit: 8Gi'
assert_absent 'helm.sh/resource-policy: keep'
assert_contains 'mountPath: /app/data'
assert_contains 'mountPath: /tmp'
assert_contains 'name: TMPDIR'
assert_contains 'value: /tmp'
assert_contains 'kind: Service'
assert_contains 'port: 3001'
assert_contains 'kind: PersistentVolumeClaim'
assert_absent 'kind: Route'
assert_absent 'storageClassName:'

helm template test "$chart_dir" --set persistence.storageClass=fast >"$render"
assert_contains 'storageClassName: "fast"'

helm template test "$chart_dir" --set persistence.enabled=false >"$render"
assert_absent 'kind: PersistentVolumeClaim'
assert_data_volume_empty_dir

helm template test "$chart_dir" --set pullSecret.existingSecret=registry-auth --set pullSecret.key=.dockerconfigjson >"$render"
assert_contains 'secretName: registry-auth'
assert_contains 'key: .dockerconfigjson'
assert_contains 'mountPath: /app/pull-secret'
assert_contains 'value: /app/pull-secret/.dockerconfigjson'

helm template test "$chart_dir" --set route.enabled=true --set route.host=mirror.example.test >"$render"
assert_route_contains 'apiVersion: route.openshift.io/v1'
assert_route_contains 'kind: Route'
assert_route_contains 'host: "mirror.example.test"'
assert_route_contains 'termination: edge'
assert_route_contains 'insecureEdgeTerminationPolicy: Redirect'

helm template test "$chart_dir" --set route.enabled=true >"$render"
assert_route_contains 'kind: Route'
assert_route_absent 'host:'

helm template test "$chart_dir" --set route.enabled=true --set labels.owner=platform --set annotations.owner=platform >"$render"
assert_route_count 'owner: platform' 2

# A user label colliding with a chart-owned one must be dropped, not emitted alongside it;
# two copies of the same key in one mapping make the manifest fail to decode.
helm template test "$chart_dir" --set 'labels.app\.kubernetes\.io/name=collide' >"$render"
assert_absent 'app.kubernetes.io/name: collide'
assert_contains 'app.kubernetes.io/name: mirror-gui'

helm template test "$chart_dir" --set persistence.retain=true >"$render"
assert_contains 'helm.sh/resource-policy: keep'

helm template test "$chart_dir" --set resources=null --set tmpDir.sizeLimit= >"$render"
assert_absent 'cpu: 500m'
assert_absent 'sizeLimit:'
assert_contains 'emptyDir: {}'

# Nulling a whole values sub-map is the usual way to unset a block, and it must not abort
# the render the way a bare `.Values.tmpDir.sizeLimit` lookup would.
helm template test "$chart_dir" --set tmpDir=null --set persistence=null --set pullSecret=null --set route=null >"$render"
assert_contains 'kind: Deployment'
assert_absent 'sizeLimit:'
assert_absent 'kind: PersistentVolumeClaim'
assert_absent 'kind: Route'
assert_absent 'mountPath: /app/pull-secret'
assert_data_volume_empty_dir

grep -Fq 'Route access is unauthenticated' "$chart_dir/templates/NOTES.txt"
grep -Fq 'oc create namespace mirror-gui' README.md
grep -Fq 'oc -n mirror-gui create secret generic mirror-gui-pull-secret' README.md
grep -Fq 'helm upgrade --install mirror-gui charts/mirror-gui' README.md
grep -Fq 'registry.ci.openshift.org/ocp/5.0:mirror-gui' README.md
