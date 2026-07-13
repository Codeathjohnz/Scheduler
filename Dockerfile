# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# ── Stage 2: Production server ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install server dependencies (production only)
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/ .

# Copy built frontend into server's public folder
# server.js checks for ./public first, then ../client/dist
COPY --from=frontend-builder /build/client/dist ./public

EXPOSE 5000

CMD ["node", "server.js"]
