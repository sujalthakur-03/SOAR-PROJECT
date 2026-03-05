# ══════════════════════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Frontend Dockerfile
# ══════════════════════════════════════════════════════════════════════════════
# Service: soar-frontend
# Build: Node 18 Alpine → npm build → nginx Alpine
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

# --- Stage 2: Production (nginx) ---
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
