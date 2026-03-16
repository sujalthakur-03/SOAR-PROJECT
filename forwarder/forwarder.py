#!/usr/bin/env python3
"""
CyberSentinel Forwarder — Production-Grade Alert Router

Tails CyberSentinel EDR alert logs and forwards matching alerts
to SOAR playbook webhooks via configurable routing rules.

Features:
  - Per-line offset persistence (crash-safe)
  - Inode-based log rotation detection
  - SIGHUP hot-reload of routing rules
  - Alert deduplication via SHA-256 fingerprinting
  - Dead letter queue for failed deliveries
  - HMAC-SHA256 webhook payload signing
  - Backlog throttling to prevent SOAR flooding
  - Async HTTP health check endpoint
  - Prometheus-style metrics counters
  - Graceful shutdown with double-signal guard
  - YAML validation with actionable error messages
  - Array traversal in field path resolution
  - match_any (OR logic) support alongside match (AND logic)
  - aiohttp session refresh on long-running uptime
"""

import os
import sys
import json
import time
import hmac
import asyncio
import aiohttp
import yaml
import logging
import signal
import re
import hashlib
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Set
from collections import deque
from aiohttp import web

# =========================
# CONFIG
# =========================

ALERT_FILE = os.environ.get("ALERT_SOURCE", "/var/ossec/logs/alerts/alerts.json")
ROUTING_RULES = os.environ.get("ROUTING_RULES", "routing_rules.yaml")
OFFSET_FILE = os.environ.get("OFFSET_FILE", ".forwarder_offset")
DLQ_FILE = os.environ.get("DLQ_FILE", ".forwarder_dlq.jsonl")
SOAR_TIMEOUT = int(os.environ.get("DEFAULT_TIMEOUT", "30"))
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "1.0"))
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "10"))
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "9200"))
HMAC_SECRET = os.environ.get("HMAC_SECRET", "")
DEDUP_WINDOW = int(os.environ.get("DEDUP_WINDOW", "300"))
DEDUP_MAX_SIZE = int(os.environ.get("DEDUP_MAX_SIZE", "50000"))
BACKLOG_BATCH_SIZE = int(os.environ.get("BACKLOG_BATCH_SIZE", "100"))
BACKLOG_PAUSE_MS = int(os.environ.get("BACKLOG_PAUSE_MS", "200"))
SESSION_REFRESH_SECS = int(os.environ.get("SESSION_REFRESH_SECS", "3600"))
DLQ_RETRY_INTERVAL = int(os.environ.get("DLQ_RETRY_INTERVAL", "300"))

# =========================
# LOGGING
# =========================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("CyberSentinelForwarder")

# =========================
# METRICS
# =========================

class Metrics:
    """Prometheus-style counters for forwarder observability."""

    def __init__(self):
        self.alerts_read = 0
        self.alerts_matched = 0
        self.alerts_forwarded = 0
        self.alerts_failed = 0
        self.alerts_deduplicated = 0
        self.alerts_dlq = 0
        self.dlq_retried = 0
        self.dlq_recovered = 0
        self.rules_reloaded = 0
        self.webhook_429s = 0
        self.webhook_timeouts = 0
        self.rotations_detected = 0
        self.started_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "alerts_read": self.alerts_read,
            "alerts_matched": self.alerts_matched,
            "alerts_forwarded": self.alerts_forwarded,
            "alerts_failed": self.alerts_failed,
            "alerts_deduplicated": self.alerts_deduplicated,
            "alerts_dlq": self.alerts_dlq,
            "dlq_retried": self.dlq_retried,
            "dlq_recovered": self.dlq_recovered,
            "rules_reloaded": self.rules_reloaded,
            "webhook_429s": self.webhook_429s,
            "webhook_timeouts": self.webhook_timeouts,
            "rotations_detected": self.rotations_detected,
            "uptime_seconds": round(time.time() - self.started_at, 1),
        }

    def to_prometheus(self) -> str:
        lines = []
        for key, val in self.to_dict().items():
            lines.append(f"cybersentinel_forwarder_{key} {val}")
        return "\n".join(lines) + "\n"

# =========================
# DEDUPLICATION
# =========================

class DeduplicationCache:
    """Time-windowed SHA-256 fingerprint cache to prevent re-forwarding."""

    def __init__(self, window_secs: int, max_size: int):
        self.window = window_secs
        self.max_size = max_size
        self._cache: Dict[str, float] = {}

    def fingerprint(self, alert: Dict[str, Any]) -> str:
        rule_id = alert.get("rule", {}).get("id", "")
        agent_id = alert.get("agent", {}).get("id", "")
        timestamp = alert.get("timestamp", "")
        source_ip = alert.get("data", {}).get("source_ip", alert.get("data", {}).get("srcip", ""))
        key = f"{rule_id}|{agent_id}|{timestamp}|{source_ip}"
        return hashlib.sha256(key.encode()).hexdigest()[:16]

    def is_duplicate(self, fp: str) -> bool:
        now = time.time()
        if fp in self._cache and (now - self._cache[fp]) < self.window:
            return True
        # Evict expired entries if cache is getting large
        if len(self._cache) >= self.max_size:
            self._evict(now)
        self._cache[fp] = now
        return False

    def _evict(self, now: float):
        expired = [k for k, ts in self._cache.items() if (now - ts) >= self.window]
        for k in expired:
            del self._cache[k]
        # If still too large, remove oldest half
        if len(self._cache) >= self.max_size:
            sorted_items = sorted(self._cache.items(), key=lambda x: x[1])
            for k, _ in sorted_items[:len(sorted_items) // 2]:
                del self._cache[k]

# =========================
# DEAD LETTER QUEUE
# =========================

class DeadLetterQueue:
    """Append-only file for failed webhook deliveries with periodic retry."""

    def __init__(self, path: str):
        self.path = Path(path)

    def enqueue(self, url: str, payload: bytes, rule_name: str, error: str):
        entry = {
            "url": url,
            "payload": payload.decode("utf-8", errors="replace"),
            "rule_name": rule_name,
            "error": error,
            "failed_at": time.time(),
            "retries": 0,
        }
        try:
            with open(self.path, "a") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception as e:
            log.error(f"DLQ write failed: {e}")

    def drain(self) -> List[Dict[str, Any]]:
        """Read and remove all DLQ entries for retry."""
        if not self.path.exists():
            return []
        entries = []
        try:
            with open(self.path, "r") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        entries.append(json.loads(line))
            # Truncate after reading
            self.path.write_text("")
        except Exception as e:
            log.error(f"DLQ drain failed: {e}")
        return entries

    def count(self) -> int:
        if not self.path.exists():
            return 0
        try:
            with open(self.path, "r") as f:
                return sum(1 for line in f if line.strip())
        except Exception:
            return 0

# =========================
# OFFSET + INODE TRACKING
# =========================

class FileState:
    def __init__(self, path: str, offset_file: str, metrics: Metrics):
        self.path = Path(path)
        self.offset_file = Path(offset_file)
        self.offset = 0
        self.inode = None
        self.metrics = metrics

    def load(self):
        if not self.offset_file.exists():
            return
        try:
            data = json.loads(self.offset_file.read_text())
            self.offset = data.get("offset", 0)
            self.inode = data.get("inode")
            log.info(f"Loaded offset: {self.offset}")
        except Exception as e:
            log.warning(f"Failed to load offset: {e}")

    def save(self):
        try:
            stat = self.path.stat()
            data = {
                "offset": self.offset,
                "inode": stat.st_ino,
                "updated_at": time.time()
            }
            # Atomic write via temp file
            tmp = self.offset_file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data))
            tmp.rename(self.offset_file)
        except Exception as e:
            log.error(f"Failed to save offset: {e}")

    def detect_rotation(self) -> bool:
        try:
            stat = self.path.stat()
            if self.inode is None:
                self.inode = stat.st_ino
                return False

            if stat.st_ino != self.inode or stat.st_size < self.offset:
                log.warning("Log rotation detected — resetting offset")
                self.offset = 0
                self.inode = stat.st_ino
                self.metrics.rotations_detected += 1
                return True
        except FileNotFoundError:
            pass
        return False

# =========================
# ROUTING ENGINE
# =========================

@dataclass
class WebhookTarget:
    url: str
    timeout: int
    headers: Dict[str, str] = field(default_factory=dict)

@dataclass
class Rule:
    name: str
    match: Dict[str, List[str]]
    match_any: List[Dict[str, List[str]]]
    targets: List[WebhookTarget]
    priority: int = 100
    enabled: bool = True


def validate_rules_yaml(data: Any) -> List[str]:
    """Validate routing_rules.yaml structure and return list of errors."""
    errors = []
    if not isinstance(data, dict):
        return ["Root must be a YAML mapping (dict)"]

    rules = data.get("rules")
    if rules is None:
        return ["Missing 'rules' key at root level"]
    if not isinstance(rules, list):
        return ["'rules' must be a list"]

    for idx, r in enumerate(rules):
        prefix = f"rules[{idx}]"
        if not isinstance(r, dict):
            errors.append(f"{prefix}: must be a mapping")
            continue
        if "name" not in r:
            errors.append(f"{prefix}: missing required 'name' field")
        if "match" not in r and "match_any" not in r:
            errors.append(f"{prefix} ({r.get('name', '?')}): must have 'match' or 'match_any'")
        if "forward_to" not in r:
            errors.append(f"{prefix} ({r.get('name', '?')}): missing 'forward_to'")
        elif isinstance(r.get("forward_to"), list):
            for tidx, t in enumerate(r["forward_to"]):
                if not isinstance(t, dict) or "webhook_url" not in t:
                    errors.append(f"{prefix}.forward_to[{tidx}]: missing 'webhook_url'")
    return errors


def load_rules() -> List[Rule]:
    """Load and validate routing rules from YAML file."""
    path = Path(ROUTING_RULES)
    if not path.exists():
        log.error(f"Routing rules file not found: {ROUTING_RULES}")
        return []

    try:
        raw = path.read_text()
        data = yaml.safe_load(raw)
    except yaml.YAMLError as e:
        log.error(f"YAML parse error in {ROUTING_RULES}: {e}")
        return []

    errors = validate_rules_yaml(data)
    if errors:
        for err in errors:
            log.error(f"Routing rules validation error: {err}")
        return []

    rules = []
    for r in data.get("rules", []):
        if not r.get("enabled", True):
            log.info(f"Skipping disabled rule: {r.get('name', 'unnamed')}")
            continue

        targets = []
        for t in r.get("forward_to", []):
            if not isinstance(t, dict) or "webhook_url" not in t:
                continue
            targets.append(WebhookTarget(
                url=t["webhook_url"],
                timeout=t.get("timeout", SOAR_TIMEOUT),
                headers=t.get("headers", {}),
            ))

        # Parse match_any conditions
        match_any_raw = r.get("match_any", [])
        match_any = []
        if isinstance(match_any_raw, list):
            for cond in match_any_raw:
                if isinstance(cond, dict):
                    # Normalize values to lists
                    normalized = {}
                    for k, v in cond.items():
                        normalized[k] = v if isinstance(v, list) else [v]
                    match_any.append(normalized)

        # Parse match conditions (normalize values to lists)
        match_raw = r.get("match", {})
        match = {}
        if isinstance(match_raw, dict):
            for k, v in match_raw.items():
                match[k] = v if isinstance(v, list) else [v]

        rules.append(Rule(
            name=r["name"],
            match=match,
            match_any=match_any,
            targets=targets,
            priority=r.get("priority", 100),
            enabled=True,
        ))

    rules.sort(key=lambda r: r.priority)
    log.info(f"Loaded {len(rules)} routing rules (sorted by priority)")
    return rules


def _resolve_field(alert: Dict[str, Any], path: str):
    """Resolve a dot-notation field path, supporting array indexing like data.items[0].id."""
    cur = alert
    for key in path.split("."):
        if cur is None:
            return None
        # Handle array index notation: field[0]
        bracket = key.find("[")
        if bracket != -1:
            field_name = key[:bracket]
            idx_str = key[bracket + 1 : key.find("]")]
            if isinstance(cur, dict):
                cur = cur.get(field_name)
            else:
                return None
            if isinstance(cur, list):
                try:
                    cur = cur[int(idx_str)]
                except (IndexError, ValueError):
                    return None
            else:
                return None
        elif isinstance(cur, dict):
            cur = cur.get(key)
        elif isinstance(cur, list):
            # Auto-traverse: collect field from each element
            results = []
            for item in cur:
                if isinstance(item, dict):
                    val = item.get(key)
                    if val is not None:
                        results.append(val)
            return results if results else None
        else:
            return None
    return cur


def _match_value(field_val, pattern: str) -> bool:
    pat = str(pattern)
    if pat.startswith("regex:"):
        if isinstance(field_val, list):
            return any(bool(re.search(pat[6:], str(v))) for v in field_val)
        return bool(re.search(pat[6:], str(field_val)))
    if pat.startswith("gt:"):
        try:
            val = float(field_val) if not isinstance(field_val, list) else max(float(v) for v in field_val)
            return val > float(pat[3:])
        except (ValueError, TypeError):
            return False
    if pat.startswith("lt:"):
        try:
            val = float(field_val) if not isinstance(field_val, list) else min(float(v) for v in field_val)
            return val < float(pat[3:])
        except (ValueError, TypeError):
            return False
    if pat.startswith("exists:"):
        expected = pat[7:].lower() == "true"
        return (field_val is not None) == expected
    if isinstance(field_val, list):
        return any(str(v) == pat for v in field_val)
    return str(field_val) == pat


def _match_conditions(alert: Dict[str, Any], conditions: Dict[str, List[str]]) -> bool:
    """Check if ALL conditions in a match block are satisfied."""
    for path, values in conditions.items():
        field_val = _resolve_field(alert, path)
        if not any(_match_value(field_val, v) for v in values):
            return False
    return True


def match_rule(alert: Dict[str, Any], rule: Rule) -> bool:
    """Match alert against a rule. Supports both AND (match) and OR (match_any) logic."""
    # AND conditions: all must match
    if rule.match:
        if not _match_conditions(alert, rule.match):
            return False

    # OR conditions: at least one block must match
    if rule.match_any:
        if not any(_match_conditions(alert, cond) for cond in rule.match_any):
            return False

    return True

# =========================
# WEBHOOK SENDER
# =========================

class WebhookSender:
    def __init__(self, metrics: Metrics, hmac_secret: str = ""):
        self.sem = asyncio.Semaphore(MAX_CONCURRENT)
        self.session: Optional[aiohttp.ClientSession] = None
        self.session_created_at = 0.0
        self.metrics = metrics
        self.hmac_secret = hmac_secret.encode() if hmac_secret else b""

    async def _ensure_session(self):
        """Create or refresh the aiohttp session."""
        now = time.time()
        if self.session is None or (now - self.session_created_at) > SESSION_REFRESH_SECS:
            if self.session:
                await self.session.close()
            self.session = aiohttp.ClientSession()
            self.session_created_at = now
            log.info("HTTP session created/refreshed")

    async def close(self):
        if self.session:
            await self.session.close()
            self.session = None

    def _sign_payload(self, payload: bytes) -> Dict[str, str]:
        """Generate HMAC-SHA256 signature headers for the payload."""
        if not self.hmac_secret:
            return {}
        sig = hmac.new(self.hmac_secret, payload, hashlib.sha256).hexdigest()
        return {"X-CyberSentinel-Signature": f"sha256={sig}"}

    async def send(self, url: str, payload: bytes, timeout: int,
                   extra_headers: Optional[Dict[str, str]] = None, retries: int = 3) -> bool:
        await self._ensure_session()
        async with self.sem:
            for attempt in range(retries):
                try:
                    headers = {"Content-Type": "application/json"}
                    headers.update(self._sign_payload(payload))
                    if extra_headers:
                        headers.update(extra_headers)

                    async with self.session.post(
                        url,
                        data=payload,
                        timeout=aiohttp.ClientTimeout(total=timeout),
                        headers=headers,
                    ) as resp:
                        if resp.status in (200, 201, 202):
                            self.metrics.alerts_forwarded += 1
                            return True
                        if resp.status == 429:
                            retry_after = int(resp.headers.get("Retry-After", 60))
                            self.metrics.webhook_429s += 1
                            log.warning(f"Rate limited (429). Waiting {retry_after}s — retry {attempt + 1}/{retries}")
                            await asyncio.sleep(retry_after)
                            continue
                        text = await resp.text()
                        log.warning(f"Webhook {resp.status}: {text[:200]}")
                        self.metrics.alerts_failed += 1
                        return False

                except asyncio.TimeoutError:
                    self.metrics.webhook_timeouts += 1
                    log.error(f"Webhook timeout ({timeout}s): {url} — attempt {attempt + 1}/{retries}")
                    if attempt < retries - 1:
                        await asyncio.sleep(2 ** attempt)
                except Exception as e:
                    log.error(f"Webhook error: {e} — attempt {attempt + 1}/{retries}")
                    if attempt < retries - 1:
                        await asyncio.sleep(2 ** attempt)

            self.metrics.alerts_failed += 1
            return False

# =========================
# HEALTH CHECK SERVER
# =========================

class HealthServer:
    """Lightweight HTTP server for health checks and metrics."""

    def __init__(self, metrics: Metrics, forwarder: "Forwarder"):
        self.metrics = metrics
        self.forwarder = forwarder
        self.runner: Optional[web.AppRunner] = None

    async def start(self, port: int):
        app = web.Application()
        app.router.add_get("/health", self._handle_health)
        app.router.add_get("/metrics", self._handle_metrics)
        app.router.add_get("/status", self._handle_status)
        self.runner = web.AppRunner(app, access_log=None)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "0.0.0.0", port)
        await site.start()
        log.info(f"Health server listening on :{port}")

    async def stop(self):
        if self.runner:
            await self.runner.cleanup()

    async def _handle_health(self, request: web.Request) -> web.Response:
        return web.json_response({
            "status": "healthy" if self.forwarder.running else "shutting_down",
            "uptime_seconds": round(time.time() - self.metrics.started_at, 1),
        })

    async def _handle_metrics(self, request: web.Request) -> web.Response:
        accept = request.headers.get("Accept", "")
        if "text/plain" in accept or "prometheus" in accept:
            return web.Response(text=self.metrics.to_prometheus(), content_type="text/plain")
        return web.json_response(self.metrics.to_dict())

    async def _handle_status(self, request: web.Request) -> web.Response:
        return web.json_response({
            "status": "healthy" if self.forwarder.running else "shutting_down",
            "alert_file": str(ALERT_FILE),
            "offset": self.forwarder.state.offset,
            "rules_loaded": len(self.forwarder.rules),
            "dlq_pending": self.forwarder.dlq.count(),
            "dedup_cache_size": len(self.forwarder.dedup._cache),
            "metrics": self.metrics.to_dict(),
        })

# =========================
# FORWARDER CORE
# =========================

class Forwarder:
    def __init__(self):
        self.metrics = Metrics()
        self.state = FileState(ALERT_FILE, OFFSET_FILE, self.metrics)
        self.rules = load_rules()
        self.sender = WebhookSender(self.metrics, HMAC_SECRET)
        self.dedup = DeduplicationCache(DEDUP_WINDOW, DEDUP_MAX_SIZE)
        self.dlq = DeadLetterQueue(DLQ_FILE)
        self.health = HealthServer(self.metrics, self)
        self.running = True
        self._shutdown_requested = False
        self._continue_on_match = False

        # Load global settings from routing rules
        try:
            data = yaml.safe_load(Path(ROUTING_RULES).read_text())
            settings = data.get("settings", {})
            self._continue_on_match = settings.get("continue_on_match", False)
        except Exception:
            pass

    def reload_rules(self):
        """Hot-reload routing rules from YAML (triggered by SIGHUP)."""
        log.info("SIGHUP received — reloading routing rules...")
        new_rules = load_rules()
        if new_rules:
            self.rules = new_rules
            self.metrics.rules_reloaded += 1
            log.info(f"Rules reloaded: {len(self.rules)} active rules")
        else:
            log.warning("Rule reload produced 0 rules — keeping existing rules")

        # Reload global settings
        try:
            data = yaml.safe_load(Path(ROUTING_RULES).read_text())
            settings = data.get("settings", {})
            self._continue_on_match = settings.get("continue_on_match", False)
        except Exception:
            pass

    async def shutdown(self):
        """Graceful shutdown with double-signal guard."""
        if self._shutdown_requested:
            log.warning("Force shutdown (second signal)")
            sys.exit(1)
        self._shutdown_requested = True
        log.info("Shutdown requested — finishing current batch...")
        self.running = False
        await self.health.stop()
        await self.sender.close()
        self.state.save()
        log.info("Forwarder shutdown complete")

    async def run(self):
        self.state.load()

        # Start health check server
        try:
            await self.health.start(HEALTH_PORT)
        except OSError as e:
            log.warning(f"Health server failed to start on :{HEALTH_PORT}: {e}")

        # Schedule DLQ retry task
        dlq_task = asyncio.create_task(self._dlq_retry_loop())

        log.info(f"Monitoring: {ALERT_FILE}")
        log.info(f"HMAC signing: {'enabled' if HMAC_SECRET else 'disabled'}")
        log.info(f"Dedup window: {DEDUP_WINDOW}s | Backlog batch: {BACKLOG_BATCH_SIZE}")

        batch_count = 0

        while self.running:
            try:
                if not Path(ALERT_FILE).exists():
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                self.state.detect_rotation()
                batch_count = 0

                with open(ALERT_FILE, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(self.state.offset)
                    while self.running:
                        line = f.readline()
                        if not line:
                            break
                        self.state.offset = f.tell()

                        try:
                            alert = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        self.metrics.alerts_read += 1

                        # Deduplication check
                        fp = self.dedup.fingerprint(alert)
                        if self.dedup.is_duplicate(fp):
                            self.metrics.alerts_deduplicated += 1
                            continue

                        payload = line.encode()
                        await self.process(alert, payload)

                        # Per-line offset save (crash-safe)
                        self.state.save()

                        # Backlog throttle: pause every N alerts to avoid flooding
                        batch_count += 1
                        if batch_count >= BACKLOG_BATCH_SIZE:
                            batch_count = 0
                            await asyncio.sleep(BACKLOG_PAUSE_MS / 1000.0)

                await asyncio.sleep(POLL_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error(f"Runtime error: {e}", exc_info=True)
                await asyncio.sleep(1)

        dlq_task.cancel()
        try:
            await dlq_task
        except asyncio.CancelledError:
            pass

    def _resolve_headers(self, headers: Dict[str, str]) -> Dict[str, str]:
        if not headers:
            return {}
        resolved = {}
        for k, v in headers.items():
            v_str = str(v)
            if "${EPOCH_TIMESTAMP}" in v_str:
                v_str = v_str.replace("${EPOCH_TIMESTAMP}", str(int(time.time())))
            resolved[k] = v_str
        return resolved

    async def process(self, alert: Dict[str, Any], payload: bytes):
        matched = False
        for rule in self.rules:
            if match_rule(alert, rule):
                matched = True
                self.metrics.alerts_matched += 1
                log.info(f"Matched rule: {rule.name}")

                for t in rule.targets:
                    headers = self._resolve_headers(t.headers)
                    success = await self.sender.send(t.url, payload, t.timeout, headers)
                    if not success:
                        self.dlq.enqueue(t.url, payload, rule.name, "delivery_failed")
                        self.metrics.alerts_dlq += 1
                        log.warning(f"Alert sent to DLQ — rule: {rule.name}, target: {t.url[:60]}...")

                # Stop on first match unless continue_on_match is enabled
                if not self._continue_on_match:
                    break

    async def _dlq_retry_loop(self):
        """Periodically retry failed deliveries from the dead letter queue."""
        while self.running:
            try:
                await asyncio.sleep(DLQ_RETRY_INTERVAL)
                entries = self.dlq.drain()
                if not entries:
                    continue

                log.info(f"DLQ retry: {len(entries)} entries")
                self.metrics.dlq_retried += len(entries)
                re_enqueue = []

                for entry in entries:
                    retries = entry.get("retries", 0)
                    if retries >= 5:
                        log.warning(f"DLQ entry exceeded max retries — dropping: {entry.get('rule_name')}")
                        continue

                    url = entry["url"]
                    payload = entry["payload"].encode()
                    success = await self.sender.send(url, payload, SOAR_TIMEOUT)
                    if success:
                        self.metrics.dlq_recovered += 1
                    else:
                        entry["retries"] = retries + 1
                        entry["last_retry"] = time.time()
                        re_enqueue.append(entry)

                # Re-enqueue still-failed entries
                for entry in re_enqueue:
                    try:
                        with open(self.dlq.path, "a") as f:
                            f.write(json.dumps(entry) + "\n")
                    except Exception:
                        pass

                if re_enqueue:
                    log.info(f"DLQ: {self.metrics.dlq_recovered} recovered, {len(re_enqueue)} still failing")

            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error(f"DLQ retry error: {e}")

# =========================
# ENTRYPOINT
# =========================

async def main():
    fwd = Forwarder()

    loop = asyncio.get_running_loop()

    # Graceful shutdown on SIGINT/SIGTERM
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(fwd.shutdown()))

    # Hot-reload routing rules on SIGHUP
    loop.add_signal_handler(signal.SIGHUP, fwd.reload_rules)

    await fwd.run()

if __name__ == "__main__":
    asyncio.run(main())
