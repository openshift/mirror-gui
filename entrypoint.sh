#!/bin/bash
set -e

APP_USER="default"
APP_DATA="/app/data"
DIRS="$APP_DATA/configs $APP_DATA/operations $APP_DATA/logs $APP_DATA/cache $APP_DATA/mirrors/default $APP_DATA/catalog-data"

for d in $DIRS; do
    mkdir -p "$d"
done

chown -R "${APP_USER}:0" "$APP_DATA"
chmod -R 775 "$APP_DATA"

# Podman forwards the published host port onto the container network,
# not onto 127.0.0.1 inside the container. Listen on all container interfaces
# unless the user set BIND_HOST. The host publish address is the isolation
# boundary.
if [ -z "${BIND_HOST:-}" ]; then
    export BIND_HOST=0.0.0.0
fi

AUTHFILE="${OC_MIRROR_AUTHFILE:-/app/pull-secret.json}"
if [ -f "$AUTHFILE" ]; then
    chown "${APP_USER}:0" "$AUTHFILE"
    chmod 664 "$AUTHFILE"
fi

if su -s /bin/sh "$APP_USER" -c "test -w $APP_DATA/configs"; then
    echo "[ENTRYPOINT] Permissions OK"
else
    echo "[ENTRYPOINT] ERROR: $APP_DATA/configs not writable by ${APP_USER} user"
    echo "[ENTRYPOINT] Host fix: sudo chown -R 1001:0 data/ && sudo chmod -R 775 data/"
    exit 1
fi

exec runuser -u "$APP_USER" -- "$@"
