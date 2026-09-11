FROM node:20-trixie-slim

# Build tools in case better-sqlite3 needs a source compile on this arch.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm i -g pnpm@9

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
COPY scripts ./scripts
RUN pnpm install

COPY . .

ENV PORT=3100 \
    STORE_PATH=/data/setter.db \
    POLLER_INTERVAL_MS=300000 \
    TICK_INTERVAL_MS=300000

VOLUME /data
EXPOSE 3100
CMD ["pnpm", "start"]
