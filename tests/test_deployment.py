"""Run real deployment scripts against a stateful Docker double.

These tests exercise orchestration and failure handling; they do not validate an
actual Docker build, database dump, database restoration, or live HTTP service.
Run: python3 -m unittest discover -s tests -v
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]
TAG = "remnadrop:2.8.1-git-d2cabd67e257"
TARGET = "sha256:" + "d" * 64
OLD = "sha256:" + "a" * 64


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="remnadrop-deploy-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.install = self.root / "installation with spaces"
        self.install.mkdir()
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "scripts").mkdir()
        for name in ("migrate-2.8.1.sh", "upgrade-fork.sh"):
            shutil.copy2(REPO / name, self.source / name)
        for helper in (REPO / "scripts").glob("*.py"):
            shutil.copy2(helper, self.source / "scripts" / helper.name)
        (self.source / "Dockerfile.dev").write_text("FROM scratch\n")
        (self.source / "recover-export.py").write_text(
            "import pathlib, sys\n"
            "pathlib.Path(sys.argv[1], 'rollback-image').write_text('remnadrop:test-recovery\\n')\n"
        )
        self.bin = self.root / "bin"
        self.bin.mkdir()
        shutil.copy2(REPO / "tests/fake_docker.py", self.bin / "docker")
        (self.bin / "docker").chmod(0o755)
        self.executable("sleep", "#!/bin/sh\nexit 0\n")
        self.executable("df", "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nmock 20000000 0 20000000 0%% /\\n'\n")
        self.state_path = self.root / "state.json"
        self.log_path = self.root / "docker.jsonl"
        self.base = str(self.install / "docker-compose.yml")
        self.custom = str(self.install / "compose.vpnclub.yml")
        self.managed = str(self.install / "compose.fork-auto.json")
        self.original_list = ":".join([self.base, self.custom, self.managed, self.managed]) + "\r\n\n"
        (self.install / ".panel-compose-files").write_text(self.original_list)
        self.state_path.write_text(json.dumps({
            "tag": TAG, "target_image": TARGET, "container_image": OLD,
            "container_id": "1" * 64, "generation": 1, "running": True,
            "health": "healthy", "scenario": "success", "migrations_attempted": False,
            "compose_labels": self.original_list.replace(":", ","),
        }))
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        FAKE_DOCKER_STATE=str(self.state_path), FAKE_DOCKER_LOG=str(self.log_path),
                        INSTALL_DIR=str(self.install), IMAGE=TAG)
        self.env.pop("PANEL_TARGET_IMAGE_ID", None)
        self.env.pop("PANEL_ROLLBACK_IMAGE", None)

    def executable(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o755)

    def state(self):
        return json.loads(self.state_path.read_text())

    def change_state(self, **changes):
        self.state_path.write_text(json.dumps(dict(self.state(), **changes)))

    def calls(self):
        return [json.loads(line) for line in self.log_path.read_text().splitlines()] if self.log_path.exists() else []

    def migrate(self, **changes):
        self.change_state(**changes)
        return subprocess.run(["bash", str(self.source / "migrate-2.8.1.sh"), str(self.install), TAG, "--update"],
                              env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)

    def assert_failed_without_success(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("HTTP check passed", result.stdout)
        self.assertNotIn("checks passed. Backup:", result.stdout)
        self.assertNotIn("SUCCESS:", result.stdout)
        self.assertEqual((self.install / ".panel-compose-files").read_bytes(), self.original_list.encode())

    def test_same_tag_recreates_only_panel_and_canonicalizes_compose(self):
        result = self.migrate()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.state()["container_image"], TARGET)
        self.assertNotEqual(self.state()["container_id"], "1" * 64)
        up = [call for call in self.calls() if call["args"][0] == "compose" and "up" in call["args"]]
        self.assertEqual(len(up), 1)
        self.assertEqual(up[0]["args"][-1], "remnawave")
        for option in ("--no-deps", "--force-recreate", "--no-build", "--pull"):
            self.assertIn(option, up[0]["args"])
        self.assertEqual(up[0]["args"][up[0]["args"].index("--pull") + 1], "never")
        expected = ":".join([self.base, self.custom, self.managed]) + "\n"
        self.assertEqual((self.install / ".panel-compose-files").read_text(), expected)
        self.assertEqual(self.migrate().returncode, 0)
        self.assertEqual((self.install / ".panel-compose-files").read_text(), expected)
        self.assertFalse(any(call["args"][0] in ("rm", "prune", "start") for call in self.calls()))

    def test_compose_success_cannot_hide_stale_container_or_wrong_image(self):
        for scenario in ("stale_container", "wrong_image"):
            with self.subTest(scenario=scenario):
                result = self.migrate(scenario=scenario)
                self.assert_failed_without_success(result)
                self.assertFalse(any(call["args"][0] == "start" for call in self.calls()))

    def test_http_success_does_not_override_unready_health(self):
        for health in ("starting", "unhealthy", "missing"):
            with self.subTest(health=health):
                result = self.migrate(health=health)
                self.assert_failed_without_success(result)

    def test_waits_for_starting_container_to_become_healthy(self):
        result = self.migrate(scenario="health_transition", health="starting")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.state()["health"], "healthy")
        self.assertGreaterEqual(self.state()["readiness_checks"], 2)
        self.assertEqual(self.state()["container_image"], TARGET)

    def test_exited_container_cannot_pass_readiness(self):
        result = self.migrate(scenario="exited")
        self.assert_failed_without_success(result)
        self.assertFalse(self.state()["running"])
        self.assertFalse(any(call["args"][0] == "start" for call in self.calls()))

    def test_healthy_container_with_failing_http_cannot_pass(self):
        result = self.migrate(scenario="http_failure")
        self.assert_failed_without_success(result)
        self.assertEqual(self.state()["health"], "healthy")
        self.assertFalse(any(call["args"][0] == "start" for call in self.calls()))

    def test_backup_failure_restarts_original_container_before_migrations(self):
        result = self.migrate(scenario="backup_failure")
        self.assert_failed_without_success(result)
        self.assertFalse(self.state()["migrations_attempted"])
        self.assertEqual(self.state()["container_image"], OLD)
        self.assertTrue(self.state()["running"])
        self.assertIn(["start", "remnawave"], [call["args"] for call in self.calls()])

    def test_migration_failure_never_restarts_old_image(self):
        result = self.migrate(scenario="migration_failure")
        self.assert_failed_without_success(result)
        self.assertTrue(self.state()["migrations_attempted"])
        self.assertFalse(self.state()["running"])
        self.assertFalse(any(call["args"][0] == "start" for call in self.calls()))

    def test_target_retag_fails_before_stopping_panel(self):
        self.env["PANEL_TARGET_IMAGE_ID"] = "sha256:" + "e" * 64
        result = self.migrate()
        self.assert_failed_without_success(result)
        self.assertTrue(self.state()["running"])
        self.assertFalse(self.state()["migrations_attempted"])
        self.assertFalse(any("stop" in call["args"] for call in self.calls()))

    def test_normalizer_preserves_custom_override_order_and_repetitions(self):
        helper = REPO / "scripts/compose-files.py"
        supplied = ":".join([self.base, self.custom, self.managed, self.managed, self.custom]) + "\r\n"
        result = subprocess.run([sys.executable, str(helper), supplied, "--managed", self.managed],
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, ":".join([self.base, self.custom, self.managed, self.custom]) + "\n")
        result = subprocess.run([sys.executable, str(helper), supplied, "--append", self.managed],
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, ":".join([self.base, self.custom, self.custom, self.managed]) + "\n")

    @unittest.skipUnless(os.geteuid() == 0, "updater intentionally requires root")
    def test_outer_updater_rejects_false_success_from_migration(self):
        (self.source / "migrate-2.8.1.sh").write_text("#!/bin/bash\nexit 0\n")
        result = subprocess.run(["bash", str(self.source / "upgrade-fork.sh")], env=self.env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
        self.assert_failed_without_success(result)

    @unittest.skipUnless(os.geteuid() == 0, "updater intentionally requires root")
    def test_low_disk_blocks_before_build(self):
        self.executable("df", "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nmock 20000000 0 10000000 0%% /\\n'\n")
        result = subprocess.run(["bash", str(self.source / "upgrade-fork.sh")], env=self.env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Not enough free disk space", result.stdout)
        self.assertFalse(any(call["args"][0] == "build" for call in self.calls()))

    @unittest.skipUnless(os.geteuid() == 0, "updater intentionally requires root")
    def test_outer_updater_skips_export_when_old_image_exists(self):
        result = subprocess.run(["bash", str(self.source / "upgrade-fork.sh")], env=self.env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertFalse(any(call["args"][0] == "export" for call in self.calls()))
        backups = list((self.install / "update-backups").glob("ops-*/rollback-source"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text().strip(), "existing-image")

    @unittest.skipUnless(os.geteuid() == 0, "updater intentionally requires root")
    def test_outer_updater_exports_when_old_image_missing(self):
        self.change_state(scenario="old_image_unavailable")
        result = subprocess.run(["bash", str(self.source / "upgrade-fork.sh")], env=self.env, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(any(call["args"][0] == "export" for call in self.calls()))
        backups = list((self.install / "update-backups").glob("ops-*/rollback-source"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text().strip(), "container-export")


if __name__ == "__main__":
    unittest.main()
