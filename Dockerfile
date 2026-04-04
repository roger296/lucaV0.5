FROM node:20-alpine

WORKDIR /app

# ── Backend dependencies ──────────────────────────────────────────────────────
COPY package.json package-lock.json* ./
RUN npm ci

# ── Frontend dependencies ─────────────────────────────────────────────────────
COPY src/web/package.json src/web/package-lock.json* ./src/web/
RUN npm ci --prefix src/web

# ── Copy all source code ──────────────────────────────────────────────────────
COPY . .

# ── Build React frontend ──────────────────────────────────────────────────────
RUN npm run build --prefix src/web

# ── Compile TypeScript backend ────────────────────────────────────────────────
RUN npm run build

# ── Ensure chain directory exists ─────────────────────────────────────────────
RUN mkdir -p /data/chains

EXPOSE 3000

# Run migrations (idempotent), seed data (idempotent), then start server
CMD ["sh", "-c", "npm run migrate && npm run seed && node dist/server.js"]
