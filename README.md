# Commander, a layout for Herdr

A text-mode workbench look for the [Herdr](https://herdr.dev) app: menu bar, a tree of spaces and agents, framed terminals, and a bar of your real shortcuts, in one sharp 8x16 pixel font. A side panel holds a to-do list for each space, shared with the agents working there, and a note for each space; the menu bar counts the tokens your agents used today, and the sidebar keeps a log of what finished and what asked. Behind the terminals, a pixel-art Earth drawn from real coastlines turns once a minute.

![Commander](preview.png)

To add it, give your agent this repo's address in Herdr and ask it to install the layout, or copy `layouts/`, `mods/`, `themes/` and `backgrounds/` into `~/.config/herdr-app/`, merge `keys.json` into yours, then run `herdr-app do layout.switch --name commander`.

`RECIPE.md` describes the whole layout and how to build it from scratch.

Before you install, what it runs and touches outside the app folder: `git` and, where it is installed, `gh` (which talks to GitHub) in your spaces' folders; and `python3` scripts that read Claude Code's and Codex's own session logs (`~/.claude/projects`, `~/.codex/sessions`) for the usage meter and keep the to-do lists in `~/.herdr/todos/`. Nothing changes your agents' settings unless you run the optional `herdr-todo install` yourself: it adds a hook to Claude Code's and Codex's settings so new sessions are told about their space's list. `RECIPE.md` has the full list.

The globe costs a little while it turns (about 2% of one processor core, and the layout file is rewritten eight times a second). `View > Globe` switches it between revolving, still and off.

The bundled font is PxPlus IBM VGA 8x16 from The Ultimate Oldschool PC Font Pack by VileR (int10h.org), licensed CC BY-SA 4.0 (see `mods/cmdr-tree/fonts/LICENSE-PxPlus.txt`).

The globe was rendered from [Natural Earth](https://www.naturalearthdata.com) 1:50m outlines (public domain) by `backgrounds/commander-earth/render.py`.
