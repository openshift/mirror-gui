#!/bin/bash
set -e

APP_DATA="${STORAGE_DIR:-/app/data}"
for directory in configs operations logs cache mirrors/default catalog-data run; do
    mkdir -p "$APP_DATA/$directory"
done

exec "$@"
