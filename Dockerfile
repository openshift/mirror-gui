FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS builder

USER root

ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=1.0

WORKDIR /app
RUN npm install -g npm@11.6.2

COPY package*.json ./
RUN npm config set fetch-timeout 300000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    if [ -f package-lock.json ]; then \
      npm ci --no-fund --no-audit && npm audit fix || true; \
    else \
      npm install --no-fund --no-audit && npm audit fix || true; \
    fi

COPY . .
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
      OCMIRROR_URL=$OCMIRROR_URL_ARM64; \
    else \
      OCMIRROR_URL=$OCMIRROR_URL_AMD64; \
    fi; \
    wget -O /tmp/oc-mirror.tar.gz "$OCMIRROR_URL"; \
    tar -xzf /tmp/oc-mirror.tar.gz -C /usr/local/bin/; \
    chmod +x /usr/local/bin/oc-mirror; \
    rm /tmp/oc-mirror.tar.gz; \
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
      OC_URL="https://mirror.openshift.com/pub/openshift-v4/aarch64/clients/ocp/stable/openshift-client-linux.tar.gz"; \
    else \
      OC_URL="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/openshift-client-linux.tar.gz"; \
    fi; \
    wget -qO /tmp/oc.tar.gz "$OC_URL"; \
    tar -xzf /tmp/oc.tar.gz -C /usr/local/bin oc; \
    rm /tmp/oc.tar.gz; \
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
      npm audit fix || true && \
      npm cache clean --force; \
    else \
      npm install --no-fund --no-audit && \
      npm audit fix || true && \
      npm cache clean --force; \
    fi

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY scripts/catalog_metadata.py ./scripts/catalog_metadata.py
COPY sync-catalogs.sh ./sync-catalogs.sh
RUN chmod +x ./sync-catalogs.sh

# Copy only generated catalog metadata required at runtime.
COPY --from=builder /app/catalog-data-minimal ./catalog-data


RUN mkdir -p /app/data && \
    chgrp -R 0 /app && \
    chmod -R g=u /app

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
