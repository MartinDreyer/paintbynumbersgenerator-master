# Builds and runs backend/ (the automated puzzle-prep server, see backend/src/server.ts).
# It compiles backend/src/*.ts together with the root src/ pipeline it imports
# (../../src/... — see CLAUDE.md's "Architecture" section), so the build context is the
# repo root, not backend/ alone.

FROM node:22-bookworm-slim AS builder

# canvas (native module) needs these headers/toolchain to build from source if no
# prebuilt binary matches this image's platform/libc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src ./src
COPY backend ./backend

WORKDIR /app/backend
RUN npm install && npm run build

FROM node:22-bookworm-slim AS runtime

# Runtime-only shared libs canvas links against (no compilers needed here).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 libpixman-1-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/public ./public
COPY --from=builder /app/backend/package.json ./package.json

ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/backend/src/server.js"]
