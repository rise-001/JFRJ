# syntax=docker/dockerfile:1

# The Vite output is architecture-independent, so build it once on the
# runner's native platform instead of repeating npm/Vite under QEMU.
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js tailwind.config.js postcss.config.js jsconfig.json components.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DDDDOCR_API_URL=http://127.0.0.1:8000/recognize

COPY ddddocr/requirements.txt /tmp/ddddocr-requirements.txt
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv libgl1 libglib2.0-0 \
    && python3 -m venv /opt/ddddocr \
    && /opt/ddddocr/bin/pip install --no-cache-dir -r /tmp/ddddocr-requirements.txt \
    && rm -rf /var/lib/apt/lists/* /tmp/ddddocr-requirements.txt

COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node ddddocr/server.py ./ddddocr/server.py
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chmod=755 server/start.sh ./server/start.sh

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["./server/start.sh"]
