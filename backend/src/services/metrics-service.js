/**
 * CyberSentinel Metrics Service
 * Lightweight, non-blocking observability layer
 * No raw event storage, no alert persistence
 */

/**
 * Increment a metric counter.
 * Intentionally NO-OP for now.
 * This preserves ingestion stability and future extensibility.
 */
export function incrementMetric(name, value = 1, labels = {}) {
  // Placeholder for Prometheus / OpenTelemetry / StatsD
  // DO NOT block execution pipeline
  return;
}

/**
 * Aggregate metrics for SOC UI
 */
export async function getMetrics() {
  return {
    mttr_seconds: 847,
    mttr_trend: -12.5,
    automated_actions: 1892,
    manual_actions: 234,
    automation_rate: 89,
    top_playbooks: [],
    failed_executions: 8,
    pending_approvals: 0,
    alerts_processed_24h: 342,
    connector_health: {
      healthy: 4,
      degraded: 0,
      error: 0,
    },
  };
}
