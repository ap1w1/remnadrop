#!/usr/bin/env python3
"""Start exactly the upstream Limiter 5.1.0 binary; adapt settings through RemnaDrop API.

The limiter process is stopped on disabled settings or prolonged control-plane failure.
No Docker socket, privileged container, or local panel DB credentials are needed.
"""
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

CONTROL_URL = os.environ.get("REMNADROP_LIMITER_CONTROL_URL", "http://remnawave:3000/api/limiter-bridge/runtime")
BRIDGE_TOKEN = os.environ.get("REMNADROP_LIMITER_BRIDGE_TOKEN", "")
INTERVAL = 30
BINARY = "/usr/local/bin/remnawave-limiter"
process = None
digest = None
closing = False


def log(message):
    print("[RemnaDrop Limiter 5.1.0] " + message, flush=True)


def stop():
    global process, digest
    if process is not None:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        process = None
    digest = None


def shutdown(_signal, _frame):
    global closing
    closing = True


def poll_settings():
    if len(BRIDGE_TOKEN) < 32:
        raise RuntimeError("Missing strong REMNADROP_LIMITER_BRIDGE_TOKEN")
    req = urllib.request.Request(CONTROL_URL, headers={
        "Authorization": "Bearer " + BRIDGE_TOKEN,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=10) as res:
        doc = json.load(res)
    cfg = doc["response"]
    if cfg["version"] != "5.1.0" or not isinstance(cfg["enabled"], bool):
        raise RuntimeError("Unexpected RemnaDrop Limiter runtime schema")
    if not isinstance(cfg["env"], dict):
        raise RuntimeError("Invalid RemnaDrop Limiter env map")
    return cfg


def run():
    global process, digest
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    failed_since = None
    while not closing:
        try:
            cfg = poll_settings()
            failed_since = None
            if not cfg["enabled"]:
                if process is not None:
                    log("Disabled by RemnaDrop settings")
                    stop()
            else:
                # Admin-editable values are whitelisted by the RemnaDrop API.
                env = os.environ.copy()
                for key, value in cfg["env"].items():
                    if not key.isupper() or not isinstance(value, str):
                        raise RuntimeError("Unsafe runtime configuration entry")
                    env[key] = value
                env["REMNAWAVE_API_URL"] = "http://remnawave:3000/api/limiter-bridge"
                env["REMNAWAVE_API_TOKEN"] = BRIDGE_TOKEN
                env["WEBHOOK_URL"] = "http://remnawave:3000/api/limiter-webhook"
                env["WEBHOOK_SECRET"] = os.environ.get("REMNADROP_LIMITER_WEBHOOK_SECRET", "")
                env["WEBHOOK_SECRET_HEADER"] = "false"
                if len(env["WEBHOOK_SECRET"]) < 32:
                    raise RuntimeError("Missing strong REMNADROP_LIMITER_WEBHOOK_SECRET")
                for secret in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ADMIN_IDS"):
                    if not env.get(secret):
                        raise RuntimeError("Missing " + secret + " (see .env.limiter.example)")
                fingerprint = hashlib.sha256(json.dumps(sorted(
                    (key, value) for key, value in env.items()
                    if key in cfg["env"] or key in (
                        "REMNAWAVE_API_URL", "WEBHOOK_URL", "WEBHOOK_SECRET",
                        "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ADMIN_IDS"
                    )
                )).encode()).hexdigest()
                if fingerprint != digest or process is None or process.poll() is not None:
                    if process is not None:
                        stop()
                    log("Starting the unmodified upstream Limiter 5.1.0 binary")
                    process = subprocess.Popen([BINARY], env=env, cwd="/app")
                    digest = fingerprint
        except Exception as error:
            # Avoid dangerous stale settings in auto mode while panel is unavailable.
            if failed_since is None:
                failed_since = time.monotonic()
            log("Cannot apply runtime configuration: " + type(error).__name__)
            if time.monotonic() - failed_since >= 60:
                stop()
        for _ in range(INTERVAL):
            if closing:
                break
            time.sleep(1)
    stop()
    log("Stopped")


if __name__ == "__main__":
    run()
