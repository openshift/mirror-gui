FROM registry.access.redhat.com/ubi9/nodejs-22-minimal

USER root

RUN microdnf install -y --nodocs \
    git \
    nspr nss nss-util \
    alsa-lib atk at-spi2-atk cups-libs libdrm \
    libXcomposite libXdamage libXrandr mesa-libgbm pango \
    libxkbcommon libXfixes libXcursor libXext libXi libXtst \
    libwayland-client \
    && microdnf clean all
