# ══════════════════════════════════════════════════════════════════════════════
# CyberSentinel SOAR v3.0 — Backend Dockerfile
# ══════════════════════════════════════════════════════════════════════════════
# Service: soar-backend
# Runtime: Node.js 18 (Alpine)
# Port: 3001
# ══════════════════════════════════════════════════════════════════════════════

FROM node:18-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy application source
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs

# Non-root user for security
RUN addgroup -S soar && adduser -S soar -G soar
RUN chown -R soar:soar /app
USER soar

EXPOSE 3001

# Health check — backend exposes GET /health
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "src/index.js"]
