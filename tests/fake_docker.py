#!/usr/bin/env python3
"""Small stateful Docker double for deployment regression tests, never a daemon."""

import json
import os
from pathlib import Path
import sys


state_path = Path(os.environ["FAKE_DOCKER_STATE"])
state = json.loads(state_path.read_text())
args = sys.argv[1:]
with Path(os.environ["FAKE_DOCKER_LOG"]).open("a") as log:
    log.write(json.dumps({"args": args, "compose": os.environ.get("COMPOSE_FILE")}) + "\n")


def finish(output="", status=0):
    state_path.write_text(json.dumps(state))
    if output:
        print(output)
    sys.exit(status)


def format_arg():
    for flag in ("-f", "--format"):
        if flag in args:
            return args[args.index(flag) + 1]
    return None


def inspect_output(image=False):
    fmt = format_arg()
    if not fmt:
        return json.dumps([{
            "Id": state["container_id"], "Image": state["container_image"],
            "Config": {"Image": state["tag"], "Labels": {}},
            "State": {"Running": state["running"], "Health": {"Status": state["health"]}},
        }])
    if "com.docker.compose.project.config_files" in fmt:
        return state["compose_labels"]
    if "recovery.container" in fmt:
        return state["container_id"]
    if ".State.Health" in fmt and state["scenario"] == "health_transition":
        state["readiness_checks"] = state.get("readiness_checks", 0) + 1
        if state["readiness_checks"] > 1:
            state["health"] = "healthy"
    values = {
        "{{.Id}}": state["target_image"] if image else state["container_id"],
        "{{.Image}}": state["container_image"],
        "{{.Config.Image}}": state["tag"],
        "{{.State.Running}}": "true" if state["running"] else "false",
        "{{.State.Health.Status}}": state["health"],
        "{{.SizeRootFs}}": "1024",
    }
    for fallback in ("missing", "unknown", "none"):
        conditional = "{{if .State.Health}}{{.State.Health.Status}}{{else}}" + fallback + "{{end}}"
        fmt = fmt.replace(conditional, state["health"])
    for token, value in values.items():
        fmt = fmt.replace(token, value)
    if "{{" in fmt:
        raise RuntimeError("Unsupported Docker inspect template: " + fmt)
    return fmt


if args[:2] == ["image", "inspect"]:
    finish(inspect_output(image=True))
if args[:2] == ["image", "tag"]:
    finish()
if args[0] == "inspect":
    finish(inspect_output())
if args[0] in ("info", "cp", "build", "run"):
    finish()
if args[0] == "export":
    Path(args[args.index("-o") + 1]).write_bytes(b"fake root filesystem")
    finish()
if args[0] == "commit":
    finish(state["container_image"])
if args[0] == "start":
    state["running"] = True
    finish()
if args[0] == "exec":
    command = " ".join(args)
    if "pg_database_size" in command:
        finish("1024")
    if "pg_dump" in command:
        if state["scenario"] == "backup_failure" and not state["running"]:
            finish("simulated pg_dump failure", 1)
        finish("fake database dump")
    if "pg_restore" in command:
        sys.stdin.buffer.read()
        finish("fake restore catalog" if "--list" in args else "")
    if "history.sql" in command:
        finish("[]")
    if "node" in args and "-p" in args:
        finish("2.8.1")
    if "fetch(" in command:
        finish(status=0 if state["running"] and state["scenario"] != "http_failure" else 1)
    if "createdb" in command or "dropdb" in command:
        finish()
    raise RuntimeError("Unsupported docker exec: " + command)
if args[0] == "compose":
    command = args[1:]
    while command and command[0] in ("--project-directory", "--project-name", "-p", "-f"):
        command = command[2:]
    if command[0] == "config":
        finish(json.dumps({"services": {"remnawave": {"image": state["tag"]}}})
               if "--format" in command else "")
    if command[0] == "stop":
        state["running"] = False
        finish()
    if command[0] == "run":
        state["migrations_attempted"] = True
        finish(status=1 if state["scenario"] == "migration_failure" else 0)
    if command[0] == "up":
        # Compose may reuse an existing same-tag container unless forced.
        if "--force-recreate" in command and state["scenario"] != "stale_container":
            state["generation"] += 1
            state["container_id"] = format(state["generation"], "064x")
            if state["scenario"] != "wrong_image":
                state["container_image"] = state["target_image"]
        state["compose_labels"] = os.environ["COMPOSE_FILE"].replace(":", ",")
        state["running"] = state["scenario"] != "exited"
        finish()
    raise RuntimeError("Unsupported compose call: " + " ".join(command))
raise RuntimeError("Unsupported Docker call: " + " ".join(args))
