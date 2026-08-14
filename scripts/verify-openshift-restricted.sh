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

chmod 0777 "$data_dir"
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
