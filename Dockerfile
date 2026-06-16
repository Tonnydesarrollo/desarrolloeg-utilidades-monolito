FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=7000 \
    WHATSAPP_CAP_CHROME_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    libvips42 \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY standalone/sucursales-docs ./standalone/sucursales-docs
COPY ["POLIZA SEGURO Carta Ley Todas las tiendas 2026-2027.pdf", "./POLIZA SEGURO Carta Ley Todas las tiendas 2026-2027.pdf"]
COPY README.md ./ 
COPY .env.example ./

RUN mkdir -p \
    /app/runtime/facturacion \
    /app/runtime/jobs/facturas \
    /app/runtime/jobs/casaley \
    /app/runtime/jobs/pedidos \
    /app/runtime/pedidos \
    /app/runtime/whatsapp-capacitadores/session \
    /app/runtime/whatsapp-capacitadores/tmp \
    /app/publicimg

EXPOSE 7000

ENTRYPOINT ["tini", "--"]
CMD ["npm", "start"]
