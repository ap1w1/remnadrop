#!/usr/bin/env python3
"""Report possible secrets and personal infrastructure in tracked source.

Only locations and finding types are printed. Values are never echoed.
Run with --history before publishing a rewritten Git history.
"""

import argparse
import io
import ipaddress
import pathlib
import re
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent
PATTERNS = {
    "private-key": re.compile(rb"(?m)^\s*-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "github-token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "openai-token": re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "aws-key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "telegram-token": re.compile(rb"\b\d{8,12}:[A-Za-z0-9_-]{35}\b"),
    "slack-token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
}
ASSIGNMENT = re.compile(
    rb"(?im)^\s*(?:export\s+)?(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*([^\r\n#]+)"
)
IPV4 = re.compile(rb"(?<![0-9.])(?:\d{1,3}\.){3}\d{1,3}(?![0-9.])")
EMAIL = re.compile(rb"\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b")
SAMPLE_WORDS = (b"example", b"change_me", b"replace", b"placeholder", b"test", b"dummy", b"your-", b"<", b"${")
SAFE_EMAIL_DOMAINS = (b"example.com", b"example.net", b"example.org", b"users.noreply.github.com", b"remnawave.com", b"github.com")


def git(*args: str, input_data: bytes | None = None) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT, input=input_data)


def inspect(data: bytes, path: str) -> set[tuple[str, int]]:
    if b"\x00" in data or len(data) > 2_000_000:
        return set()
    findings: set[tuple[str, int]] = set()
    for kind, pattern in PATTERNS.items():
        for match in pattern.finditer(data):
            findings.add((kind, data.count(b"\n", 0, match.start()) + 1))
    if path.endswith((".env.sample", ".env.example")):
        for match in ASSIGNMENT.finditer(data):
            value = match.group(1).strip().strip(b"'\"").lower()
            if value in (b"postgres", b"admin", b"false", b"true") or any(word in value for word in SAMPLE_WORDS):
                continue
            if value and not value.startswith((b"$", b"getenv", b"os.getenv")):
                findings.add(("credential-assignment", data.count(b"\n", 0, match.start()) + 1))
    if not ("/test" in path or path.startswith("tests/") or path.endswith(("_test.go", ".test.cjs", ".test.mjs", "default-templates.ts", "visual-routing-fields.tsx"))):
        for match in IPV4.finditer(data):
            try:
                ip = ipaddress.ip_address(match.group().decode("ascii"))
            except ValueError:
                continue
            if ip.is_global and ip not in (ipaddress.ip_address("8.8.8.8"), ipaddress.ip_address("1.1.1.1"), ipaddress.ip_address("9.9.9.9")):
                findings.add(("public-ip", data.count(b"\n", 0, match.start()) + 1))
    for match in EMAIL.finditer(data):
        domain = match.group(1).lower()
        if domain not in SAFE_EMAIL_DOMAINS and not domain.endswith((b".example.com", b".invalid")):
            findings.add(("email", data.count(b"\n", 0, match.start()) + 1))
    return findings


def current() -> list[tuple[str, str, int]]:
    results = []
    for raw_path in git("ls-files", "-z").split(b"\x00"):
        if not raw_path:
            continue
        path = raw_path.decode("utf-8", "replace")
        file = ROOT / path
        if not file.is_file():
            continue
        for kind, line in inspect(file.read_bytes(), path):
            results.append((path, kind, line))
    return sorted(results)


def history() -> list[tuple[str, str, int]]:
    objects = []
    for raw in git("rev-list", "--objects", "--all").splitlines():
        oid, _, path = raw.partition(b" ")
        if path:
            objects.append((oid, path.decode("utf-8", "replace")))
    batch = subprocess.run(
        ["git", "cat-file", "--batch"], cwd=ROOT,
        input=b"".join(oid + b"\n" for oid, _ in objects),
        stdout=subprocess.PIPE, check=True,
    )
    stream = io.BytesIO(batch.stdout)
    results = []
    for oid, path in objects:
        header = stream.readline().split()
        if len(header) != 3:
            raise RuntimeError("Unexpected git cat-file output")
        size = int(header[2])
        data = stream.read(size)
        stream.read(1)
        if header[1] == b"blob":
            for kind, line in inspect(data, path):
                results.append((path, kind, line))
    return sorted(set(results))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="scan all currently reachable Git objects")
    args = parser.parse_args()
    findings = history() if args.history else current()
    for path, kind, line in findings:
        print(f"{path}:{line}: {kind}")
    print(f"Findings: {len(findings)}", file=sys.stderr)
    sys.exit(bool(findings))
