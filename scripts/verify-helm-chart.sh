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
assert_contains 'host: "mirror.example.test"'
assert_contains 'termination: edge'

helm template test "$chart_dir" --set labels.owner=platform --set annotations.owner=platform >"$render"
assert_contains 'owner: platform'
