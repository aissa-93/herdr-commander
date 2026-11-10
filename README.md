# Commander, a layout for Herdr

A text-mode workbench look for the [Herdr](https://herdr.dev) app: menu bar, a tree of spaces and agents, framed terminals, and a bar of your real shortcuts, in one sharp 8x16 pixel font. Behind the terminals, a pixel-art Earth drawn from real coastlines turns once a minute.

![Commander](preview.png)

To add it, give your agent this repo's address in Herdr and ask it to install the layout, or copy `layouts/`, `mods/`, `themes/` and `backgrounds/` into `~/.config/herdr-app/`, merge `keys.json` into yours, then run `herdr-app do layout.switch --name commander`.

`RECIPE.md` describes the whole layout and how to build it from scratch.

The globe costs a little while it turns (about 2% of one processor core, and the layout file is rewritten eight times a second). `View > Globe` switches it between revolving, still and off.

The bundled font is PxPlus IBM VGA 8x16 from The Ultimate Oldschool PC Font Pack by VileR (int10h.org), licensed CC BY-SA 4.0 (see `mods/cmdr-tree/fonts/LICENSE-PxPlus.txt`).

The globe was rendered from [Natural Earth](https://www.naturalearthdata.com) 1:50m outlines (public domain) by `backgrounds/commander-earth/render.py`.
