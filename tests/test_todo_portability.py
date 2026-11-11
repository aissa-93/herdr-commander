"""Cross-platform tests for the stand-alone herdr-todo command."""

import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "mods" / "cmdr-todo" / "herdr-todo.py"
sys.dont_write_bytecode = True


class TodoPortabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="herdr todo café ")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.env = {**os.environ, "HOME": str(self.home), "USERPROFILE": str(self.home)}
        self.env.pop("HC_TERMINAL_ID", None)

    def run_todo(self, *args, input=None):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            input=input, capture_output=True, text=True, encoding="utf-8", env=self.env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def todo_json(self, *args):
        return json.loads(self.run_todo("--space", "portable", "--agent", "agent-1", "--json", *args))

    def test_unicode_list_round_trip_without_installing_hooks(self):
        result = self.todo_json("add", "Café – ตรวจสอบ")
        self.assertEqual(result["items"][0]["text"], "Café – ตรวจสอบ")
        self.assertEqual(self.todo_json("done", "1")["items"][0]["state"], "done")
        path = self.home / ".herdr" / "todos" / "portable.md"
        self.assertIn("Café – ตรวจสอบ", path.read_text(encoding="utf-8"))
        self.assertIn("Café – ตรวจสอบ", self.run_todo("--space", "portable", "--all", "list"))
        hook = json.loads(self.run_todo(
            "--space", "portable", "--agent", "agent-1", "--name", "Équipe", "hook",
            input=json.dumps({"hook_event_name": "SessionStart", "session_id": "s1"}),
        ))
        self.assertIn("Équipe", hook["hookSpecificOutput"]["additionalContext"])
        self.assertFalse((self.home / ".claude" / "settings.json").exists())
        self.assertFalse((self.home / ".codex" / "hooks.json").exists())

    def test_install_and_uninstall_keep_other_hooks(self):
        claude = self.home / ".claude" / "settings.json"
        codex = self.home / ".codex" / "hooks.json"
        for path in (claude, codex):
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({"hooks": {"SessionStart": [
                {"hooks": [{"type": "command", "command": "existing hook"}]}
            ]}}), encoding="utf-8")

        self.run_todo("install")
        exe = self.home / ".local" / "bin" / ("herdr-todo.cmd" if os.name == "nt" else "herdr-todo")
        self.assertTrue(exe.exists())
        if os.name == "nt":
            launcher = exe.read_text(encoding="utf-8")
            self.assertIn(str(SCRIPT), launcher)
            self.assertIn("%*", launcher)
            invoked = subprocess.run(
                ["cmd.exe", "/d", "/c", str(exe), "--space", "portable", "--json", "list"],
                capture_output=True, text=True, encoding="utf-8", env=self.env,
            )
            self.assertEqual(invoked.returncode, 0, invoked.stderr)
            self.assertEqual(json.loads(invoked.stdout)["space"], "portable")
        else:
            self.assertTrue(exe.is_symlink())
        for path in (claude, codex):
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(len(data["hooks"]["SessionStart"]), 2)
            self.assertIn("herdr-todo", data["hooks"]["SessionStart"][1]["hooks"][0]["command"])

        self.run_todo("install")
        for path in (claude, codex):
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(len(data["hooks"]["SessionStart"]), 2)
        self.run_todo("uninstall")
        for path in (claude, codex):
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(data["hooks"]["SessionStart"], [
                {"hooks": [{"type": "command", "command": "existing hook"}]}
            ])
        if os.name == "nt":
            self.assertFalse(exe.exists())

    def test_platform_lock_file_supports_repeated_updates(self):
        processes = [subprocess.Popen(
            [sys.executable, str(SCRIPT), "--space", "portable", "--json", "add", "item %s" % number],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", env=self.env,
        ) for number in range(6)]
        for process in processes:
            stdout, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertIn("items", json.loads(stdout))
        lock = self.home / ".herdr" / "todos-state" / "lock"
        self.assertTrue(lock.exists())
        if os.name == "nt":
            self.assertEqual(lock.read_bytes(), b"\0")
        self.assertEqual(
            {item["text"] for item in self.todo_json("list")["items"]},
            {"item %s" % number for number in range(6)},
        )

    @unittest.skipUnless(os.name == "nt", "Windows batch launcher only")
    def test_windows_launcher_handles_unicode_script_path(self):
        copied = self.home / "répertoire" / "herdr-todo.py"
        copied.parent.mkdir()
        shutil.copy2(SCRIPT, copied)
        installed = subprocess.run(
            [sys.executable, str(copied), "install"], capture_output=True,
            text=True, encoding="utf-8", env=self.env,
        )
        self.assertEqual(installed.returncode, 0, installed.stderr)
        exe = self.home / ".local" / "bin" / "herdr-todo.cmd"
        invoked = subprocess.run(
            ["cmd.exe", "/d", "/c", str(exe), "--space", "portable", "--json", "list"],
            capture_output=True, text=True, encoding="utf-8", env=self.env,
        )
        self.assertEqual(invoked.returncode, 0, invoked.stderr)
        self.assertEqual(json.loads(invoked.stdout)["space"], "portable")


class RemoteInstallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("herdr_todo_portability", SCRIPT)
        cls.todo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.todo)

    def test_remote_install_discovers_native_python_and_sends_source(self):
        for platform, executable, found_by in (
            ("nt", r"C:\Python313\python.exe", "py"),
            ("posix", "/usr/bin/python3", "python3"),
        ):
            with self.subTest(platform=platform):
                calls = []

                def fake_run(args, **kwargs):
                    calls.append((args, kwargs))
                    if args[-2:] == ["-c", self.todo.REMOTE_BOOTSTRAP] or self.todo.REMOTE_BOOTSTRAP in args:
                        return subprocess.CompletedProcess(args, 0)
                    if args[5] == found_by:
                        return subprocess.CompletedProcess(
                            args, 0, json.dumps({"platform": platform, "executable": executable, "version": [3, 13, 0]}) + "\n", "",
                        )
                    return subprocess.CompletedProcess(args, 1, "", "not found")

                with patch.object(self.todo, "hc_path", return_value="hc"), \
                     patch.object(self.todo, "source", return_value="print('hé')"), \
                     patch.object(self.todo.subprocess, "run", side_effect=fake_run):
                    self.assertEqual(self.todo.install(False, "remote-1"), 0)
                bootstrap_args, bootstrap_options = calls[-1]
                self.assertEqual(bootstrap_args[:6], ["hc", "exec", "--on", "remote-1", "-i", executable])
                self.assertEqual(bootstrap_args[-1], "install")
                self.assertEqual(bootstrap_options["input"], "print('hé')")
                self.assertEqual(bootstrap_options["encoding"], "utf-8")
                self.assertNotIn("sh", bootstrap_args)

    def test_remote_uninstall_uses_native_bootstrap_without_source(self):
        calls = []

        def fake_run(args, **kwargs):
            calls.append((args, kwargs))
            if self.todo.REMOTE_BOOTSTRAP in args:
                return subprocess.CompletedProcess(args, 0)
            return subprocess.CompletedProcess(args, 0, json.dumps({
                "platform": "nt", "executable": r"C:\Python313\python.exe", "version": [3, 13, 0],
            }) + "\n")

        with patch.object(self.todo, "hc_path", return_value="hc"), \
             patch.object(self.todo.subprocess, "run", side_effect=fake_run):
            self.assertEqual(self.todo.install(True, "remote-1"), 0)
        self.assertEqual(calls[-1][0][-1], "uninstall")
        self.assertEqual(calls[-1][1]["input"], "")

    def test_remote_falls_back_to_encoded_powershell_and_rejects_old_python(self):
        calls = []
        expected = r"C:\Users\AdminDesign1\AppData\Local\Programs\Python\Python313\python.exe"

        def fake_run(args, **kwargs):
            calls.append(args)
            if args[5] == "powershell.exe":
                return subprocess.CompletedProcess(args, 0, json.dumps({
                    "platform": "nt", "executable": expected, "version": [3, 13, 0],
                }) + "\n")
            return subprocess.CompletedProcess(args, 0, json.dumps({
                "platform": "nt", "executable": r"C:\Python27\python.exe", "version": [2, 7, 18],
            }) + "\n")

        with patch.object(self.todo.subprocess, "run", side_effect=fake_run):
            info = self.todo.remote_python("hc", "engineer1")
        self.assertEqual(info["executable"], expected)
        self.assertEqual([args[5] for args in calls], ["py", "python3", "python", "powershell.exe"])
        self.assertEqual(calls[-1][6:9], ["-NoProfile", "-NonInteractive", "-EncodedCommand"])
        script = base64.b64decode(calls[-1][9]).decode("utf-16le")
        self.assertIn("$env:LOCALAPPDATA", script)
        self.assertIn("Python*", script)
        self.assertIn("python.exe", script)
        self.assertIn("base64.b64decode", script)


if __name__ == "__main__":
    unittest.main()
