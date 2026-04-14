FROM node:22-slim AS builder

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
    (cp /app/catalog-data/catalog-index.json /app/catalog-data-minimal/ 2>/dev/null || \
     echo '{"ocp_versions":[],"catalog_types":[],"catalogs":[]}' > /app/catalog-data-minimal/catalog-index.json) && \
    find /app/catalog-data -type f \( -name "operators.json" -o -name "dependencies.json" -o -name "catalog-info.json" \) ! -path "*/configs/*" 2>/dev/null | while read file; do \
      rel_path=$(echo "$file" | sed 's|/app/catalog-data/||'); \
      mkdir -p "/app/catalog-data-minimal/$(dirname "$rel_path")"; \
      cp "$file" "/app/catalog-data-minimal/$rel_path"; \
    done
RUN npx vite build

# Fetch oc-mirror only; wget/tar stay in this stage (not copied to production).
FROM node:22-slim AS downloader

ARG TARGETARCH

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget ca-certificates tar libgpgme11 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

ENV OCMIRROR_URL_AMD64="https://mirror.openshift.com/pub/openshift-v4/clients/ocp/stable/oc-mirror.tar.gz"
ENV OCMIRROR_URL_ARM64="https://mirror.openshift.com/pub/openshift-v4/aarch64/clients/ocp/stable/oc-mirror.rhel9.tar.gz"

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

FROM node:22-slim AS production

ARG BUILD_DATE=""
ARG VCS_REF=""
ARG VERSION=1.0

COPY --from=downloader /usr/local/bin/oc-mirror /usr/local/bin/oc-mirror

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        bash ca-certificates libgpgme11 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

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

# Copy only generated catalog metadata required at runtime.
COPY --from=builder /app/catalog-data-minimal ./catalog-data

RUN mkdir -p /app/data && chown -R node:node /app

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="Mirror-GUI Application" \
      org.opencontainers.image.description="Web application for OpenShift Container Platform mirroring operations" \
      org.opencontainers.image.source="https://github.com/openshift/mirror-gui"

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npx", "tsx", "server/index.ts"]
