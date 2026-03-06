#!/usr/bin/env python3
import os
import sys
import json
import time
import asyncio
import aiohttp
import yaml
import logging
import signal
import re
import hashlib
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional

# =========================
# CONFIG
# =========================

ALERT_FILE = os.environ.get("ALERT_SOURCE", "/var/ossec/logs/alerts/alerts.json")
ROUTING_RULES = os.environ.get("ROUTING_RULES", "routing_rules.yaml")
OFFSET_FILE = os.environ.get("OFFSET_FILE", ".forwarder_offset")
SOAR_TIMEOUT = int(os.environ.get("DEFAULT_TIMEOUT", "30"))
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "1.0"))
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "10"))
# =========================
# LOGGING
# =========================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("CyberSentinelForwarder")

# =========================
# OFFSET + INODE TRACKING
# =========================

class FileState:
    def __init__(self, path: str, offset_file: str):
        self.path = Path(path)
        self.offset_file = Path(offset_file)
        self.offset = 0
        self.inode = None

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
            self.offset_file.write_text(json.dumps(data))
        except Exception as e:
            log.error(f"Failed to save offset: {e}")

    def detect_rotation(self):
        try:
            stat = self.path.stat()
            if self.inode is None:
                self.inode = stat.st_ino
                return False

            if stat.st_ino != self.inode or stat.st_size < self.offset:
                log.warning("Log rotation detected — resetting offset")
                self.offset = 0
                self.inode = stat.st_ino
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
    targets: List[WebhookTarget]
    priority: int = 100
    enabled: bool = True

def load_rules():
    rules = []
    data = yaml.safe_load(Path(ROUTING_RULES).read_text())
    for r in data.get("rules", []):
        if not r.get("enabled", True):
            log.info(f"Skipping disabled rule: {r.get('name', 'unnamed')}")
            continue
        targets = [
            WebhookTarget(
                t["webhook_url"],
                t.get("timeout", SOAR_TIMEOUT),
                t.get("headers", {})
            )
            for t in r.get("forward_to", [])
        ]
        rules.append(Rule(
            name=r["name"],
            match=r.get("match", {}),
            targets=targets,
            priority=r.get("priority", 100),
            enabled=True
        ))
    rules.sort(key=lambda r: r.priority)
    log.info(f"Loaded {len(rules)} routing rules (sorted by priority)")
    return rules

def _resolve_field(alert: Dict[str, Any], path: str):
    cur = alert
    for key in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur

def _match_value(field_val, pattern: str) -> bool:
    pat = str(pattern)
    if pat.startswith("regex:"):
        return bool(re.search(pat[6:], str(field_val)))
    if pat.startswith("gt:"):
        try:
            return float(field_val) > float(pat[3:])
        except (ValueError, TypeError):
            return False
    if pat.startswith("lt:"):
        try:
            return float(field_val) < float(pat[3:])
        except (ValueError, TypeError):
            return False
    if pat.startswith("exists:"):
        expected = pat[7:].lower() == "true"
        return (field_val is not None) == expected
    return str(field_val) == pat

def match_rule(alert: Dict[str, Any], rule: Rule) -> bool:
    for path, values in rule.match.items():
        field_val = _resolve_field(alert, path)
        if not any(_match_value(field_val, v) for v in values):
            return False
    return True

# =========================
# WEBHOOK SENDER
# =========================

class WebhookSender:
    def __init__(self):
        self.sem = asyncio.Semaphore(MAX_CONCURRENT)
        self.session = aiohttp.ClientSession()

    async def close(self):
        await self.session.close()

    async def send(self, url: str, payload: bytes, timeout: int, extra_headers: Dict[str, str] = None, retries: int = 3):
        async with self.sem:
            for attempt in range(retries):
                try:
                    headers = {"Content-Type": "application/json"}
                    if extra_headers:
                        headers.update(extra_headers)
                    async with self.session.post(
                        url,
                        data=payload,
                        timeout=aiohttp.ClientTimeout(total=timeout),
                        headers=headers
                    ) as resp:
                        if resp.status in (200, 201, 202):
                            return True
                        if resp.status == 429:
                            retry_after = int(resp.headers.get("Retry-After", 60))
                            log.warning(f"Rate limited (429). Waiting {retry_after}s before retry {attempt + 1}/{retries}")
                            await asyncio.sleep(retry_after)
                            continue
                        text = await resp.text()
                        log.warning(f"Webhook failed {resp.status}: {text[:100]}")
                        return False
                except Exception as e:
                    log.error(f"Webhook error: {e}")
                    if attempt < retries - 1:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        return False
        return False

# =========================
# FORWARDER CORE
# =========================

class Forwarder:
    def __init__(self):
        self.state = FileState(ALERT_FILE, OFFSET_FILE)
        self.rules = load_rules()
        self.sender = WebhookSender()
        self.running = True

    async def shutdown(self):
        self.running = False
        await self.sender.close()
        self.state.save()
        log.info("Forwarder shutdown complete")

    async def run(self):
        self.state.load()
        log.info(f"Monitoring: {ALERT_FILE}")

        while self.running:
            try:
                if not Path(ALERT_FILE).exists():
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                self.state.detect_rotation()

                with open(ALERT_FILE, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(self.state.offset)
                    while True:
                        line = f.readline()
                        if not line:
                            break
                        self.state.offset = f.tell()

                        try:
                            alert = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        payload = line.encode()
                        await self.process(alert, payload)

                self.state.save()
                await asyncio.sleep(POLL_INTERVAL)

            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error(f"Runtime error: {e}")
                await asyncio.sleep(1)

    def _resolve_headers(self, headers: Dict[str, str]) -> Dict[str, str]:
        if not headers:
            return headers
        resolved = {}
        for k, v in headers.items():
            if "${EPOCH_TIMESTAMP}" in str(v):
                v = str(v).replace("${EPOCH_TIMESTAMP}", str(int(time.time())))
            resolved[k] = v
        return resolved

    async def process(self, alert: Dict[str, Any], payload: bytes):
        for rule in self.rules:
            if match_rule(alert, rule):
                log.info(f"Matched rule: {rule.name}")
                for t in rule.targets:
                    headers = self._resolve_headers(t.headers)
                    await self.sender.send(t.url, payload, t.timeout, headers)

# =========================
# ENTRYPOINT
# =========================

async def main():
    fwd = Forwarder()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(fwd.shutdown()))

    await fwd.run()

if __name__ == "__main__":
    asyncio.run(main())
