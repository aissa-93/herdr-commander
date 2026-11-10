# Commander regression checks

Run from the Herdr configuration folder:

```sh
node --test tests/*.test.mjs
python -m unittest discover -s tests -v
```

The notes tests run the real mod class with controlled GPUI and file-service boundaries to reproduce pending writes and conflicts. Python tests run the real to-do CLI in temporary home folders and the move helper with a controlled app-command boundary. No user notes, lists, or terminals are changed by these tests.

Also run `herdr-app check mods/<name>` for changed mods. The live app is needed to check native rendering and pane movement.
