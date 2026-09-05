FROM node:22-bookworm-slim

ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
    libvips42 \
    tini \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) CLOUDFLARED_ARCH="amd64" ;; \
      arm64) CLOUDFLARED_ARCH="arm64" ;; \
      *) echo "Unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CLOUDFLARED_ARCH}"; \
    chmod +x /usr/local/bin/cloudflared

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The legacy builder used by PC B commits every COPY as a separate, slow layer.
# Runtime data and secrets remain excluded by .dockerignore.
COPY . .
RUN mkdir -p \
    /app/runtime/facturacion \
    /app/runtime/jobs/facturas \
    /app/runtime/jobs/casaley \
    /app/runtime/jobs/pedidos \
    /app/runtime/pedidos \
    /app/runtime/whatsapp-capacitadores/session \
    /app/runtime/whatsapp-capacitadores/tmp \
    /app/publicimg

ARG APP_RELEASE_VERSION=0.1.0
ARG APP_BUILD_SHA=unknown
ARG APP_BUILD_TIMESTAMP=unknown

ENV NODE_ENV=production \
    PORT=7000 \
    WHATSAPP_CAP_CHROME_PATH=/usr/bin/chromium \
    APP_RELEASE_VERSION=${APP_RELEASE_VERSION} \
    APP_BUILD_SHA=${APP_BUILD_SHA} \
    APP_BUILD_TIMESTAMP=${APP_BUILD_TIMESTAMP}

EXPOSE 7000

ENTRYPOINT ["tini", "--"]
CMD ["npm", "start"]
