#!/bin/bash
set -euo pipefail

chart_dir="charts/mirror-gui"
render="$(mktemp)"
trap 'rm -f "$render"' EXIT
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
