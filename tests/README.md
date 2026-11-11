# Commander regression checks

Run from the repository root with Python 3.9+ and Node.js 20+:

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -v
python test_usage.py
```

In PowerShell, use `node --test tests` for Node's test discovery because PowerShell does not expand `*.test.mjs` for native commands. CI uses Bash for the explicit glob on both platforms.

On Windows, also run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/install.Tests.ps1`. It installs into uniquely named temporary fake Herdr folders, checks backup and shortcut behavior, then removes only those fixtures. It never selects a layout or touches your live Herdr configuration.

The notes tests run the real mod class with controlled GPUI and file-service boundaries to reproduce pending writes and conflicts. Python tests run the real to-do CLI in temporary home folders and the move helper with a controlled app-command boundary. The usage tests scan temporary fixtures. No user notes, lists, or terminals are changed by these tests. The same commands run in CI on Windows and Ubuntu without external dependencies.

Also run `herdr-app check mods/<name>` for changed mods where Herdr is available. The live app is needed to check native rendering and pane movement. CI parses `install.ps1` and runs its fixture checks on Windows.
