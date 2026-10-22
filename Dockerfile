# --- Catalog index images (pre-pulled before hermetic sandbox activates) ---
FROM registry.redhat.io/redhat/redhat-operator-index:v4.16 AS redhat-4-16
FROM registry.redhat.io/redhat/redhat-operator-index:v4.17 AS redhat-4-17
FROM registry.redhat.io/redhat/redhat-operator-index:v4.18 AS redhat-4-18
FROM registry.redhat.io/redhat/redhat-operator-index:v4.19 AS redhat-4-19
FROM registry.redhat.io/redhat/redhat-operator-index:v4.20 AS redhat-4-20
FROM registry.redhat.io/redhat/redhat-operator-index:v4.21 AS redhat-4-21
FROM registry.redhat.io/redhat/redhat-operator-index:v4.22 AS redhat-4-22

FROM registry.redhat.io/redhat/certified-operator-index:v4.16 AS certified-4-16
FROM registry.redhat.io/redhat/certified-operator-index:v4.17 AS certified-4-17
FROM registry.redhat.io/redhat/certified-operator-index:v4.18 AS certified-4-18
FROM registry.redhat.io/redhat/certified-operator-index:v4.19 AS certified-4-19
FROM registry.redhat.io/redhat/certified-operator-index:v4.20 AS certified-4-20
FROM registry.redhat.io/redhat/certified-operator-index:v4.21 AS certified-4-21
FROM registry.redhat.io/redhat/certified-operator-index:v4.22 AS certified-4-22

FROM registry.redhat.io/redhat/community-operator-index:v4.16 AS community-4-16
FROM registry.redhat.io/redhat/community-operator-index:v4.17 AS community-4-17
FROM registry.redhat.io/redhat/community-operator-index:v4.18 AS community-4-18
FROM registry.redhat.io/redhat/community-operator-index:v4.19 AS community-4-19
FROM registry.redhat.io/redhat/community-operator-index:v4.20 AS community-4-20
FROM registry.redhat.io/redhat/community-operator-index:v4.21 AS community-4-21
FROM registry.redhat.io/redhat/community-operator-index:v4.22 AS community-4-22

# --- Extract and process catalog data from the index images ---
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS catalog-processor

USER root

WORKDIR /app

RUN microdnf install -y --nodocs bash jq python3 python3-pyyaml && \
    microdnf clean all

COPY scripts/catalog_metadata.py ./scripts/catalog_metadata.py

COPY --from=redhat-4-16 /configs catalog-data-synced/redhat-operator-index/v4.16/configs/
COPY --from=redhat-4-17 /configs catalog-data-synced/redhat-operator-index/v4.17/configs/
COPY --from=redhat-4-18 /configs catalog-data-synced/redhat-operator-index/v4.18/configs/
COPY --from=redhat-4-19 /configs catalog-data-synced/redhat-operator-index/v4.19/configs/
COPY --from=redhat-4-20 /configs catalog-data-synced/redhat-operator-index/v4.20/configs/
COPY --from=redhat-4-21 /configs catalog-data-synced/redhat-operator-index/v4.21/configs/
COPY --from=redhat-4-22 /configs catalog-data-synced/redhat-operator-index/v4.22/configs/

COPY --from=certified-4-16 /configs catalog-data-synced/certified-operator-index/v4.16/configs/
COPY --from=certified-4-17 /configs catalog-data-synced/certified-operator-index/v4.17/configs/
COPY --from=certified-4-18 /configs catalog-data-synced/certified-operator-index/v4.18/configs/
COPY --from=certified-4-19 /configs catalog-data-synced/certified-operator-index/v4.19/configs/
COPY --from=certified-4-20 /configs catalog-data-synced/certified-operator-index/v4.20/configs/
COPY --from=certified-4-21 /configs catalog-data-synced/certified-operator-index/v4.21/configs/
COPY --from=certified-4-22 /configs catalog-data-synced/certified-operator-index/v4.22/configs/

COPY --from=community-4-16 /configs catalog-data-synced/community-operator-index/v4.16/configs/
COPY --from=community-4-17 /configs catalog-data-synced/community-operator-index/v4.17/configs/
COPY --from=community-4-18 /configs catalog-data-synced/community-operator-index/v4.18/configs/
COPY --from=community-4-19 /configs catalog-data-synced/community-operator-index/v4.19/configs/
COPY --from=community-4-20 /configs catalog-data-synced/community-operator-index/v4.20/configs/
COPY --from=community-4-21 /configs catalog-data-synced/community-operator-index/v4.21/configs/
COPY --from=community-4-22 /configs catalog-data-synced/community-operator-index/v4.22/configs/

SHELL ["/bin/bash", "-c"]
RUN set -euo pipefail && \
    CATALOG_DATA_DIR=./catalog-data-synced && \
    OCP_VERSIONS="4.16 4.17 4.18 4.19 4.20 4.21 4.22" && \
    CATALOG_TYPES="redhat-operator-index certified-operator-index community-operator-index" && \
    TOTAL=0 && SUCCESS=0 && FAILED=0 && \
    for ocp_version in $OCP_VERSIONS; do \
      for catalog_type in $CATALOG_TYPES; do \
        TOTAL=$((TOTAL + 1)); \
        catalog_dir="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}"; \
        if [ ! -d "${catalog_dir}/configs" ]; then \
          echo "WARN: No configs for ${catalog_type} v${ocp_version}, skipping"; \
          FAILED=$((FAILED + 1)); \
          continue; \
        fi; \
        operators_file="${catalog_dir}/operators.json"; \
        dependencies_file="${catalog_dir}/dependencies.json"; \
        if python3 ./scripts/catalog_metadata.py generate \
            --catalog-dir "$catalog_dir" \
            --catalog-type "$catalog_type" \
            --ocp-version "v${ocp_version}" \
            --operators-file "$operators_file" \
            --dependencies-file "$dependencies_file"; then \
          operator_count=$(jq '. | length' "$operators_file" 2>/dev/null || echo "0"); \
          synced_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
          printf '{"catalog_type":"%s","ocp_version":"v%s","catalog_url":"registry.redhat.io/redhat/%s:v%s","operator_count":%s,"digest":"from-build","synced_at":"%s"}\n' \
            "$catalog_type" "$ocp_version" "$catalog_type" "$ocp_version" "$operator_count" "$synced_at" \
            > "${catalog_dir}/catalog-info.json"; \
          rm -rf "${catalog_dir}/configs"; \
          SUCCESS=$((SUCCESS + 1)); \
        else \
          echo "ERROR: Failed to process ${catalog_type} v${ocp_version}"; \
          rm -rf "${catalog_dir}/configs" 2>/dev/null; \
          FAILED=$((FAILED + 1)); \
        fi; \
      done; \
    done && \
    if [ "$FAILED" -gt 0 ]; then \
      echo "ERROR: ${FAILED}/${TOTAL} catalogs failed to process"; \
      exit 1; \
    fi && \
    OCP_JSON=$(echo $OCP_VERSIONS | tr ' ' '\n' | sed 's/.*/"&"/' | paste -sd,) && \
    CAT_JSON=$(echo $CATALOG_TYPES | tr ' ' '\n' | sed 's/.*/"&"/' | paste -sd,) && \
    printf '{"ocp_versions":[%s],"catalog_types":[%s],"catalogs":[]}\n' "$OCP_JSON" "$CAT_JSON" \
      > "${CATALOG_DATA_DIR}/catalog-index.json" && \
    for ocp_version in $OCP_VERSIONS; do \
      for catalog_type in $CATALOG_TYPES; do \
        info="${CATALOG_DATA_DIR}/${catalog_type}/v${ocp_version}/catalog-info.json"; \
        if [ -f "$info" ]; then \
          jq --argjson entry "$(cat "$info")" '.catalogs += [$entry]' \
            "${CATALOG_DATA_DIR}/catalog-index.json" > "${CATALOG_DATA_DIR}/catalog-index.json.tmp" && \
            mv "${CATALOG_DATA_DIR}/catalog-index.json.tmp" "${CATALOG_DATA_DIR}/catalog-index.json"; \
        fi; \
      done; \
    done && \
    find "${CATALOG_DATA_DIR}" -type d -name configs -exec rm -rf {} + 2>/dev/null; \
    echo "Completed: ${SUCCESS}/${TOTAL} catalogs successful, ${FAILED} failed" && \
    echo "--- catalog-data contents ---" && \
    find "${CATALOG_DATA_DIR}" -type f && \
    cat "${CATALOG_DATA_DIR}/catalog-index.json"

# --- Application build stage ---
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS builder

USER root

ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=1.0

WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-timeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    if [ -f package-lock.json ]; then \
      npm ci --no-fund --no-audit; \
    else \
      npm install --no-fund --no-audit; \
    fi

COPY . .
COPY --from=catalog-processor /app/catalog-data-synced ./catalog-data-synced/
RUN mkdir -p /app/catalog-data-minimal && \
    if [ -d /app/catalog-data-synced ] && [ -f /app/catalog-data-synced/catalog-index.json ]; then \
      CATALOG_SRC=/app/catalog-data-synced; \
    else \
      CATALOG_SRC=/app/catalog-data; \
    fi && \
    (cp "$CATALOG_SRC/catalog-index.json" /app/catalog-data-minimal/ 2>/dev/null || \
     echo '{"ocp_versions":[],"catalog_types":[],"catalogs":[]}' > /app/catalog-data-minimal/catalog-index.json) && \
    find "$CATALOG_SRC" -type f \( -name "operators.json" -o -name "dependencies.json" -o -name "catalog-info.json" \) ! -path "*/configs/*" 2>/dev/null | while read file; do \
      rel_path=$(echo "$file" | sed "s|$CATALOG_SRC/||"); \
      mkdir -p "/app/catalog-data-minimal/$(dirname "$rel_path")"; \
      cp "$file" "/app/catalog-data-minimal/$rel_path"; \
    done
RUN npx vite build

# Fetch oc-mirror only; wget/tar stay in this stage (not copied to production).
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS downloader

USER root

ARG TARGETARCH

RUN microdnf install -y --nodocs wget tar gzip gpgme && \
    microdnf clean all

ENV OCMIRROR_URL_AMD64="https://mirror.openshift.com/pub/cgw/oc-mirror/latest/oc-mirror-rhel9-linux-amd64.tar.gz"
ENV OCMIRROR_URL_ARM64="https://mirror.openshift.com/pub/cgw/oc-mirror/latest/oc-mirror-rhel9-linux-arm64.tar.gz"

RUN set -eux; \
    if [ "$TARGETARCH" = "arm64" ]; then \
      OCMIRROR_FILE="oc-mirror-rhel9-linux-arm64.tar.gz"; \
    else \
      OCMIRROR_FILE="oc-mirror-rhel9-linux-amd64.tar.gz"; \
    fi; \
    if [ -f "/cachi2/output/deps/generic/$OCMIRROR_FILE" ]; then \
      echo "Using prefetched oc-mirror binary"; \
      tar --no-same-owner -xzf "/cachi2/output/deps/generic/$OCMIRROR_FILE" -C /usr/local/bin/; \
    else \
      if [ "$TARGETARCH" = "arm64" ]; then \
        OCMIRROR_URL=$OCMIRROR_URL_ARM64; \
      else \
        OCMIRROR_URL=$OCMIRROR_URL_AMD64; \
      fi; \
      wget -O /tmp/oc-mirror.tar.gz "$OCMIRROR_URL"; \
      tar --no-same-owner -xzf /tmp/oc-mirror.tar.gz -C /usr/local/bin/; \
      rm /tmp/oc-mirror.tar.gz; \
    fi; \
    chmod +x /usr/local/bin/oc-mirror; \
    which oc-mirror; \
    oc-mirror version

FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS production

USER root

ENV NODE_ENV=production

ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=1.0

COPY --from=downloader /usr/local/bin/oc-mirror /usr/local/bin/oc-mirror

RUN microdnf install -y --nodocs \
        bash tar gzip wget gpgme \
        python3 python3-pyyaml jq \
        util-linux shadow-utils && \
    microdnf clean all && \
    # nodejs-22-minimal has no named app user; create UBI convention uid 1001 (default).
    useradd --uid 1001 --gid 0 --home-dir /app --no-create-home \
        --shell /sbin/nologin default

# Install oc CLI for runtime catalog sync (oc image extract)
ARG TARGETARCH
RUN set -eux; \
    if [ "$TARGETARCH" = "arm64" ]; then \
      OC_FILE="openshift-client-linux-arm64.tar.gz"; \
      OC_URL="https://mirror.openshift.com/pub/openshift-v4/aarch64/clients/ocp/stable/openshift-client-linux.tar.gz"; \
    else \
      OC_FILE="openshift-client-linux-amd64.tar.gz"; \
      OC_URL="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-linux.tar.gz"; \
    fi; \
    if [ -f "/cachi2/output/deps/generic/$OC_FILE" ]; then \
      echo "Using prefetched oc CLI binary"; \
      tar --no-same-owner -xzf "/cachi2/output/deps/generic/$OC_FILE" -C /usr/local/bin oc; \
    else \
      wget -qO /tmp/oc.tar.gz "$OC_URL"; \
      tar --no-same-owner -xzf /tmp/oc.tar.gz -C /usr/local/bin oc; \
      rm /tmp/oc.tar.gz; \
    fi; \
    oc version --client

RUN set -eux; \
    which oc-mirror; \
    oc-mirror version; \
    which node; \
    node --version; \
    which npm; \
    npm --version

WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-timeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    if [ -f package-lock.json ]; then \
      npm ci --no-fund --no-audit && \
      npm cache clean --force; \
    else \
      npm install --no-fund --no-audit && \
      npm cache clean --force; \
    fi

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY scripts/catalog_metadata.py ./scripts/catalog_metadata.py
COPY sync-catalogs.sh ./sync-catalogs.sh
RUN chmod +x ./sync-catalogs.sh

# Copy only generated catalog metadata required at runtime.
COPY --from=builder /app/catalog-data-minimal ./catalog-data


# OpenShift assigns an arbitrary UID with GID 0, so anything the runtime writes must be
# group-owned by root and group-writable. /app itself stays root-owned so the runtime cannot
# replace its own code; everything it writes goes under /app/data, /app/cache or TMPDIR.
# /app/cache is the oc-mirror --cache-dir mount point, kept apart from /app/data so it can be
# backed by its own volume.
RUN mkdir -p /app/data /app/cache && \
    chgrp -R 0 /app/data /app/cache && \
    chmod -R g=u /app/data /app/cache

ENV OC_MIRROR_CACHE_DIR=/app/cache

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="Mirror-GUI Application" \
      org.opencontainers.image.description="Web application for OpenShift Container Platform mirroring operations" \
      org.opencontainers.image.source="https://github.com/openshift/mirror-gui"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER 1001

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npx", "tsx", "server/index.ts"]
