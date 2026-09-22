FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true WHATSAPP_CAP_CHROME_PATH=/usr/bin/chromium

COPY standalone/whatsapp-dev/package.json standalone/whatsapp-dev/package-lock.json ./
RUN npm ci --omit=dev
COPY standalone/whatsapp-dev/patch-whatsapp-web.cjs ./standalone/whatsapp-dev/patch-whatsapp-web.cjs
RUN node standalone/whatsapp-dev/patch-whatsapp-web.cjs

COPY standalone/whatsapp-dev ./standalone/whatsapp-dev
COPY src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js ./src/modules/whatsapp-capacitadores/whatsappCapacitadores.service.js
COPY src/modules/whatsapp-capacitadores/authorizedKnowledge.js ./src/modules/whatsapp-capacitadores/authorizedKnowledge.js
COPY src/modules/whatsapp-capacitadores/authorizedDataQuery.js ./src/modules/whatsapp-capacitadores/authorizedDataQuery.js
COPY src/modules/whatsapp-capacitadores/semanticEntities.js ./src/modules/whatsapp-capacitadores/semanticEntities.js
COPY src/modules/home/pcEstatal.service.js ./src/modules/home/pcEstatal.service.js
COPY src/modules/home/portalAccessPolicy.js ./src/modules/home/portalAccessPolicy.js
COPY src/services/desarrolloegLocalDb.js src/services/localOperationalRepository.js ./src/services/
COPY README.md ./README.md
COPY docs ./docs

EXPOSE 7010
ENTRYPOINT ["tini", "--"]
CMD ["node", "standalone/whatsapp-dev/server.js"]
