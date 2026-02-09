# ══════════════════════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Frontend Dockerfile
# ══════════════════════════════════════════════════════════════════════════════
# Service: soar-frontend
# Runtime: Node.js 18 (Alpine) build → serve with Vite preview
# Port: 3000
# ══════════════════════════════════════════════════════════════════════════════

# --- Stage 1: Build ---
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY index.html tsconfig*.json vite.config.ts postcss.config.js tailwind.config.ts ./
COPY src/ ./src/
COPY public/ ./public/

RUN npm run build

# --- Stage 2: Serve ---
FROM node:18-alpine

WORKDIR /app

# Only need vite to run "vite preview"
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null; \
    npm install vite @vitejs/plugin-react-swc 2>/dev/null || true

# Copy built assets and vite config (needed for preview)
COPY --from=builder /app/dist ./dist
COPY vite.config.ts ./
COPY tsconfig*.json ./

# Non-root user
RUN addgroup -S soar && adduser -S soar -G soar
RUN chown -R soar:soar /app
USER soar

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
