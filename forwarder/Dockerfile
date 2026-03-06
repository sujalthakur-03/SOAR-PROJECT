# CyberSentinel Forwarder
# =======================
# Lightweight container for alert forwarding

FROM python:3.11-slim

# Labels
LABEL maintainer="CyberSentinel SOAR Team"
LABEL description="CyberSentinel EDR Alert Forwarder"
LABEL version="1.0.0"

# Set working directory
WORKDIR /app

# Install dependencies first (for layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY forwarder.py .
COPY routing_rules.yaml .

# Create non-root user for security
RUN useradd -r -s /bin/false forwarder && \
    chown -R forwarder:forwarder /app

# Create directory for offset file
RUN mkdir -p /app/data && chown forwarder:forwarder /app/data

# Switch to non-root user
USER forwarder

# Environment defaults
ENV ALERT_SOURCE=/var/log/cybersentinel/alerts.json
ENV ALERT_FORMAT=jsonl
ENV ROUTING_RULES=/app/routing_rules.yaml
ENV OFFSET_FILE=/app/data/.forwarder_offset
ENV LOG_LEVEL=INFO
ENV PYTHONUNBUFFERED=1

# Health check (process running)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep -f "python.*forwarder.py" || exit 1

# Run the forwarder
CMD ["python", "forwarder.py"]
