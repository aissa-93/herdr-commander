# Commander

A Herdr layout that looks and works like an old PC text-mode workbench: a menu bar on top, a framed tree of your spaces and agents on the left, framed terminals in the middle, and a bar of your real shortcuts at the bottom. Everything is set in one 8x16 pixel font, kept on the font's own pixel grid so it stays sharp. Colors are calm and low in saturation; each agent state has its own shape as well as its own color, and whatever needs you is collected in one box with the keys to answer it. A panel on the right holds a to-do list for each space, shared with the agents working there, and a note for each space; the menu bar counts the tokens your agents used today, and the sidebar keeps a log of what finished and what asked. Behind the terminals a pixel-art Earth, drawn from real coastlines, turns once a minute.

![Commander](preview.png)

## What you see

Top to bottom, on a near-black canvas (`#121417`), in PxPlus IBM VGA 8x16 throughout (16 device pixels tall by default):

- **Menu bar**, one text row tall, full width. Left: `≡`, `Space`, `Tab`, `Pane`, `Agent`, `View`, `Help`. Right: the tokens used today (`Σ 386k today`, the `Σ` in the accent color; absent until the first count is in), then counts of agents by state (`1 needs you`, `1 done`, `1 working`, `2 idle`), each with its mark; `needs you`, `done` and `working` are left out when there are none. Where the system draws no window buttons, minimize, maximize and close follow.
- **Sidebar**, 306 px wide (180 to 480 by dragging): up to three frames, one above the other. The first, filling what the others leave, has its title `Spaces` set into the top border and `+ new` on the right.
  - Machines are the top level (the header is left out when there is only this computer). Under a machine: projects (your own groups), then spaces, then git worktree spaces under their checkout.
  - A space row: status mark, the agent's program icon, the space name, what the agent is on (tab name or terminal title, muted), a git tail (branch when it isn't the default one, `↑n` / `↓n`, and where `gh` knows the branch, its pull request or last CI run: `#12` or `ci`, then `√` in green, `×` in red, or the amber shimmer while checks run), and the time since the agent last changed state (`<1m`, `5m`, `3h`, `2d`).
  - More agents in the same space, and sub-agents without a pane, hang under the row on tree lines (`├`, `└`).
  - Each project has a soft hue, built from the theme's ANSI colors and kept off red, amber, green and blue. The project's name and arrow take the full hue; its sessions get a faint rail down their left, names tinted 30% toward the hue, idle dots and tree lines in the hue. Git branches are always the theme's cyan (`ansi6`).
  - The shown space is drawn in inverse video: accent background (`#86abcf`), dark text.
- **Activity**, a second frame under the tree, always there. Title `Activity`; on the right `clear` and `▼`. One row per event, newest first: the time (`14:05`; the date, `11/09`, once it is 20 hours old), a green `■` or the red `‼`, the agent's icon, its space and what it was on, then how long it worked (`5m`) or `asked`. Six rows show, the rest scroll. Empty, it says `Nothing has finished or asked yet.`
- **Waiting on you**, the last frame in the sidebar, present only while an agent is blocked or done. Its frame and title are red (`#d77a6e`) if anything is blocked, green (`#8fb58a`) if agents are only done. Up to 3 entries: mark, icon, space name, time; then the question read from the agent's screen, or the tab name; then buttons.
- **Tab strip**, one row: a cell per tab of the shown space (`number`, program icon, name, `+N` for extra panes, status mark, `×` on the active one), a `+`, and on the right the side-panel buttons: `To-do` (with the number of lines not done yet: `To-do 3`), `Notes`, and `Files` / `Changes` when the person enabled them. The buttons are there only while the panel is hidden or shows Files or Changes.
- **Panes**, each in a 1 px frame (`#30353b`; the accent color while it has the keyboard), square corners, 5.56 px apart. Each has a header row: a tag with the pane's number, program icon and name (inverse while focused), the folder with `~` for home, the branch in cyan, and the agent's state in words (`working`, `needs you`, `done`).
- **Globe**, behind the panes and centred in the terminal area, as large as the area's shorter side allows: the Earth as pixel art, 112 globe pixels across, seen from the side with its axis leaning 23.4° to the right. Land, lakes, glaciers and the Antarctic ice shelves are where they really are (Natural Earth 1:50m outlines). Six muted colors: ocean `#2b425c`, land `#5d7a5a`, ice `#b4bfc9`, and a darker one of each (`#1f2e44`, `#3f5644`, `#768493`) on the side away from the light, which comes from the upper left; the edge of the shadow is a checkerboard dither. Terminals are half see-through (`terminal_opacity` 0.5) and panes have no fill of their own, so the globe shows through the text.
- **Side panel** (hidden until asked for), 368 px wide (280 to 900 by dragging), to the right of the tab strip and panes and as tall as the sidebar. It shows one of four views: To-do, Notes, and the shipped Files and Changes.
  - To-do and Notes are drawn on the canvas in a frame like the sidebar's. The frame's title is the views themselves, as tags set into the top border: `To-do`, `Notes`, and `Files` / `Changes` when enabled. The shown one is a raised chip (`#262a2f`, text `#d7dbe0`), the others muted (`#9aa1aa`). After `To-do` stands the number of lines not done; after `Notes`, an amber `*` (`#d2b570`) while what you typed isn't saved. On the right of the border: the space's name.
  - **To-do**: a prompt line (`>` in the accent color, a field that says `Add a to-do, then Enter`) with a rule under it from edge to edge, then the lines. Each line starts with a box: `[ ]` to do (muted), `[►]` being worked on (accent, followed by that agent's state mark and icon), `[?]` begun by an agent that is gone, `[x]` done. Done lines sit at the bottom under `Done 4 ──── clear`, dim (`#646b75`) and struck through. An empty list says how to start.
  - **Notes**: a markdown editor filling the frame, in the same font and size as everything else. With no note yet, one dim line under it: `Nothing noted for <space> yet. Click above and type.`
- **Key bar**, one row: the prefix most shortcuts share (`Ctrl+Shift+`) once on the left, then a cell per command: the last key in accent, the label on a raised cell. New tab, Split →, Split ↓, Zoom, Close pane, Reply, To-do, Go to, Commands, Sidebar, Layout.

Menus and popups (the menu bar's menus, the tab menu, the tree's menus, the to-do hand-off menu, the usage popup) are square boxes with the popover fill (`#262a2f`) and a border one device pixel wide (`#444a52`), each casting a hard shadow (`#000000a0`) one character's width to the right and below.

Two themes ship with it: `commander` (graphite, dark: background `#1c1f23`, text `#d7dbe0`) and `commander-navy` (navy, used for the light appearance).

## How it behaves

Agent states, the same everywhere (tree, tabs, pane headers, menu bar, activity, waiting box, to-do lines):

- **blocked**: `‼` in dark ink on a red square (`#d77a6e`).
- **done**: a green `■` (`#8fb58a`).
- **working**: an amber block that shimmers through `░ ▒ ▓ ▒`, one step every 280 ms (`#d2b570`).
- **idle**: a small `•`, in the project's hue or the theme's dim color.

Tree: click a space to show it; right-click for its menu (file it in a project or take it out, new project, rename, close, `More…` for the app's own space menu; the project it is in is marked `[x]`); drag a space to reorder it, onto a project to file it, onto a machine header to unfile it. Click an agent row to go to it. Hovering a row shows a `reply` button. A project header folds its sessions, counts them, and its `+` starts a new session in the project's folder. A machine header's `+` starts a space there; an unreachable machine says so in red, one that needs a login offers `Log in ►`, and one that was rebuilt offers `Connect`.

GitHub marks: for a space whose folder is a git checkout, the tree asks `gh` there. On a branch other than `main`, `master` or `trunk` it shows the branch's pull request: `#12`, the word `draft`, `merged` or `closed` when it isn't open, and for an open or draft one its checks (`√` all passed, `×` any failing, shimmer while any run). On a default branch, or with no pull request, it shows `ci` and the result of the branch's last workflow run. Hovering says the title, the review state and the checks; a click opens the page in the browser. Where `gh` is missing, not logged in, or the repo isn't on GitHub, nothing shows.

Activity: a line is added when an agent finishes its turn (working to idle or done: a green `■` and how long it worked) and when an agent the tree already knew stops to ask (`‼` and `asked`). 60 are kept, across restarts. Click a line to go to that agent; a line whose agent has closed is muted and does nothing. `▼` folds the frame to its title, which then counts the lines (`Activity 12`); `clear` empties it.

Waiting box: a blocked entry has `1 Yes`, `2`, `3` and `Esc`, which press that key in the agent's terminal; every entry has `Reply` (a dialog showing the agent's last lines and a text field, sent to the agent) and `Open` (go to its pane).

Menus: click a label to open it under the bar. Each item shows the key it is bound to, read live from `keys.json`. Esc closes it. Things that are shown or hidden have a box in a column on the left, `[x]` or `[ ]`: in View, `Sidebar`, `Notes`, `To-do`, and `Files` / `Changes` when enabled. Settings say their value at the right, in the accent color: `Bigger text` `16px`, `Screen scale` `1.6`, `Globe` `revolving`; these and `Smaller text` keep the menu open, so the next click moves on. View also has `Sharpest text` and the app's zoom. `≡` has `Usage…`. `Tab > Join into tab N` and `Pane > Move to new tab` are listed only when they can be done.

Tabs: click to show, double-click to rename, drag to reorder, wheel for next and previous. Right-click opens Commander's own menu at the pointer: `Rename…`, `New tab`, `Join into …` for each other tab of the space that has a terminal (nine at most), `Close tab`. `+` opens the shipped new-tab menu. The side panel's open view is remembered per space.

Side panel: a tab-strip button, `View`, or `Ctrl+Shift+D` (To-do) shows a view. In the frame of To-do or Notes, click another tag to switch to it, and the shown one to hide the panel. Files and Changes have no such frame, so while one of them shows, the tab strip's buttons are back to switch or hide.

To-do: every space has its own list, and the panel shows the shown space's. Type on the `>` line and press Enter to add a line. Click a line's box to tick it off; click the box of a done line to open it again. Double-click a line's text to reword it on the `>` line (Enter saves, `cancel` drops the change). Hovering a line shows `×` (delete) and, on a line nobody is on, `►`: a menu that hands the line to an agent, either typed into the agent in front in that space, or given as the first message to a new agent in a new tab (the agents installed on that machine, six at most). The line is then that agent's: `[►]`, with the agent's state mark and icon, which go to the agent when clicked. If its terminal is gone the box turns to `[?]` and `►` is offered again. `clear` takes the done lines out. Agents change the same list from their terminals with `herdr-todo` (`add`, `start`, `done`, and more); their changes show at once for a space on this computer, and within 5 seconds for one on another machine while its list is shown.

Notes: one note per space; the editor follows the shown space. What you type is saved 0.7 seconds after you stop, and before the editor moves on to another space.

Usage: the count in the menu bar is the tokens Claude Code and Codex used today, on this computer and on every machine that has spaces. It is read at start and every 3 minutes while the window is in front. Click it for the popup, under the right end of the bar: a row per project (in the project's hue, with a quiet band behind it for its share of the week) and for up to four folders no project claims, each with today and the last 7 days; a total; a bar for each of the 7 days, today's in the accent color; a row per agent; Codex's own word on its limit, when it logged one; and a note saying what is counted (input, output and cache writes; cache reads apart). Opening it reads again. A click on it, or Esc, closes it.

Pane header: click to focus; hovering shows `→` (split right), `↓` (split down), `T` (move to a new tab; only on a terminal in a tab with more than one pane), `Z` (zoom) and `×` (close).

Moving panes between tabs: `Pane > Move to new tab`, `T` on the header, or `Ctrl+Shift+M` takes a terminal pane out of its tab and puts it in a new tab right after it. `Tab > Join into tab N` or `Ctrl+Shift+A` puts the shown tab's terminals into the tab before it (from the first tab: the one after) as splits: the first to the right of that tab's last terminal pane, the others stacked under the first; a tab emptied this way closes. The tab menu's `Join into …` does the same into the tab picked. The terminals keep running through a move. Mod panes (Files, a viewer) don't move. A move that can't be done says why in a toast.

Globe: it turns west to east, 0.75° a step, eight steps a second, one revolution a minute; the light stays put and the planet turns under it. `View > Globe` goes from `revolving` to `still` (the picture stays where it stopped) to `off` (no picture, panes filled with the theme background, terminals opaque) and back; the menu stays open so the next click moves on. Turning it on again starts from the first picture.

Key bar: click a cell to run it. A command with no key bound is not shown.

Keys added for this layout: `Ctrl+Shift+R` replies to the first waiting agent, `Ctrl+Shift+J` opens the project menu, `Ctrl+Shift+D` shows or hides the to-do panel, `Ctrl+Shift+M` moves the focused pane to a new tab, `Ctrl+Shift+A` joins the shown tab into the one before it.

## Built from

`layouts/commander.json`: a root `column`, `titlebar: "none"`, not resizable, background `canvas`, `font` and `ui_font` "PxPlus IBM VGA 8x16", `font_size` 14, `terminal_padding` [8, 6], `terminal_opacity` 0.5, `theme: { light: "commander-navy", dark: "commander" }`.

```
root (column)
├─ menubar   block  cmdr-menubar   22.22 px, window_drag
├─ body      row    padding 5.56, gap 5.56
│  ├─ sidebar  block  cmdr-tree    305.56 px, min 180, max 480
│  ├─ work     column gap 5.56, not resizable
│  │  ├─ tabs       block  cmdr-tabs   22.22 px
│  │  └─ work-body  row    gap 5.56
│  │     └─ globe   column, not resizable, background { image: "backgrounds/commander-earth/479.png", fit: "contain" }
│  │        └─ main  block  background { image: "backgrounds/commander-earth/000.png", fit: "contain" },
│  │                        { tab: "active", pane: { header: cmdr-pane (top, always, 20.83 px),
│  │                          border 1 px "border", focus 1 px "accent", radius 0, gap 5.56, lone: true } }
│  └─ panel    column, hidden, 368 px, min 280, max 900, no border
│     └─ panel-body  stack, active "notes": files, changes (shipped), notes = cmdr-notes, todo = cmdr-todo
└─ keybar    block  cmdr-keys      22.22 px
```

`panel` is the last child of `body`, after `work`, so it runs the full height between the two bars, like the sidebar.

Mods, nine, none with `props` of their own unless said:

- `cmdr-tree`: the sidebar (tree, Activity, Waiting on you). `projects.js` keeps projects in shared `spaces.projects` (`{ list: [{ id, name, machine, folder }], of: { spaceId: projectId } }`). With `props().menu` (`space`, `project`, `machine`) the same mod draws that popup menu. Commands: `cmdr-tree.reply`, `cmdr-tree.project`, `cmdr-tree.activity` (fold the log), `cmdr-tree.activity-clear`. The log is in the mod's `localStorage` (`activity`, `activity.folded`). For the other mods it publishes shared `commander.filing` (`{ spaceId: projectId }`, as drawn, a worktree going with its checkout), `commander.hues` (`{ projectId: index into palette() }`) and `space.labels`. Carries the font in `fonts/`.
- `cmdr-menubar`: the bar; with `props().menu` it draws one menu as a popup: a menu id, or `tab-ctx` with `props().tab` for a tab's right-click menu. Commands: `cmdr-menubar.<herdr|space|tab|pane|agent|view|help>` open a menu; `.bigger`, `.smaller`, `.sharp`, `.scale`, `.rescale` change text size and screen scale; `.globe` moves the globe to its next setting; `.todo` shows or hides the to-do view; `.usage` opens the usage popup and `.usage-refresh` reads the numbers again; `.pane-to-tab` and `.tab-to-split` move panes; `.tab-menu` opens the tab menu for the tab in shared `commander.tabmenu` (else the shown tab); `.move` does the move asked for in shared `commander.move` (`{ op: "tab", pane, at }` or `{ op: "join", tab, pane, direction, at }`). It also turns the globe: a 125 ms timer that, while shared `commander.globe` is `on` (the default; `still`, `off`) and `main` has a globe picture, copies `layout()`, sets `main.background.image` to the next of the 480 pictures and the `globe` node's to the one before it, and runs `layout.set`. And it keeps the usage numbers: a 180 s timer runs `mods/cmdr-usage/usage.py` here and on each machine with spaces and puts the answers in shared `commander.usage` (`{ at, machines: { "": {…}, <machine>: {…} } }`).
- `cmdr-tabs`: the tab strip. `herdr-move.py` beside it moves panes: `herdr-move.py tab <pane>` and `herdr-move.py join <tab> <pane> [right|down]`. It parks the terminal (`terminal.park`), waits until the core has dropped its keep and its `herdr.tab` label, then keeps it again where it should be (`pane.focus` on the pane to land beside, then `terminal.keep` with `place` `tab`, `right` or `down`); a new tab is then un-named (`tab.rename` to "") and moved next to the one it came from.
- `cmdr-pane` (gets `{ pane, terminal }` from the app), `cmdr-keys`.
- `cmdr-reply` (`props: { terminal, label? }`, a dialog).
- `cmdr-notes`: the notes view. An `Editor` (markdown, no line numbers, soft wrap) at the grid's text size, inside `frame()` with `views()` as its title.
- `cmdr-todo`: the to-do view; with `props().menu` (`{ space, text }`) the same mod is the `►` menu. It never writes a list itself: every change is a run of `herdr-todo.py`, beside it (`--space <id> --name <name> --json`, then `json`, `add`, `done`, `reopen`, `edit`, `rm`, `start`, `clear-done`, lines named by their whole text with `--exact`). It publishes shared `commander.todo` (`{ spaceId: lines not done }`) for the tab strip and the notes frame.
  - A list is a markdown file, `~/.herdr/todos/<space id>.md`, on the space's machine: `- [ ] text` to do, `- [/] text <!-- agent:<terminal> tab:<tab> -->` being worked on, `- [x] text` done. Other lines in the file are kept as they are.
  - `herdr-todo.py` is also the agents' command. In a Herdr terminal it finds its own space from the terminal's `herdr.space` label (`HC_TERMINAL_ID`, `hc get`, up through its parents); `herdr-todo` alone shows the list. `herdr-todo hook` is for agents' hooks (SessionStart, UserPromptSubmit, Stop): it gives a new session the rules and the list, says where the space's notes file is when there is one, speaks again only when the list changed, and once stops an agent from finishing while lines are still marked as its own.
  - `herdr-todo install` puts those hooks in place (see below); `herdr-todo uninstall` takes them out. The panel works without it.
- `cmdr-usage`: the usage popup. It only shows shared `commander.usage`; it files each folder under a project with `spaces.projects`, `commander.filing` and the spaces' folders, and colors it with `commander.hues`. `usage.py` beside it prints one machine's numbers as JSON: `days`, `daily`, `places` (`[folder, today, 7 days]`, the 60 largest), `tools`, `cached`, `output`, `codex_limit`.
- `ui.js`, the same file in eight of the nine mods (all but `cmdr-reply`): `grid()`, `bump()` and `BUMP_MAX`, `mix()`, `faded()`, `palette()`, `icon()`, `duration()`, `mark()`, `hairline()`, `frame()`, `tag()`, `views()` with `VIEWS` and `OWN_VIEWS`, `lifted()`, `chord()`, `chordParts()`, `pretty()`.

Popups: every one Commander draws (the bar's menus, `tab-ctx`, the usage popup, the tree's three menus, the `►` menu) is opened with `frame: "none"`, one `u` wider and one `u` taller than its box, and its box (background `popover`, border `input`) is wrapped in `lifted()`, which paints the shadow in that extra `u`. The bar's menus are 44 `u` wide in a 45 `u` overlay, the tree's 42 in 43, the usage popup 68 in 69, the `►` menu 52 in 53.

Shipped mods it opens: `menu` (the tree's `More…`), `new-menu`, `picker`, `worktree`, `files`, `changes`, `machine-add`.

`herdr` functions: `spaces`, `machines`, `panes`, `agents`, `terminals`, `focused`, `layout`, `theme`, `settings`, `keys`, `shared` / `setShared`, `props`, `nextCommand`, `openOverlay` / `closeOverlay`, `setAgentOrder`, `run`, `exec`, `hc`, `knownAgents`, `notify`, `watchFolder`, `readTextFile` / `writeTextFile`, `window`, `home`, `appHome`.

Commands it runs: `space.select`, `space.new`, `space.rename`, `space.close`, `space.move`, `space.next`, `space.prev`, `tab.new`, `tab.select`, `tab.rename`, `tab.move`, `tab.close`, `tab.next`, `tab.prev`, `pane.focus`, `pane.go`, `pane.split`, `pane.zoom`, `pane.close`, `terminal.peek`, `agent.next`, `agent.prev`, `layout.resize`, `layout.set`, `layout.toggle`, `layout.show`, `layout.hide`, `layout.select`, `layout.switch`, `mod.open`, `app.palette`, `app.help`, `app.settings`, `app.check_updates`, `app.whats_new`, `app.feedback`, `app.zoom_in`, `app.zoom_out`, `app.zoom_reset`, `window.minimize`, `window.maximize`, `window.close`; and from its scripts, through `herdr-app do`: `terminal.park`, `terminal.keep`, `pane.focus`, `tab.rename`, `tab.move` (`herdr-move.py`) and `tab.new` (the `►` menu, to learn the new terminal's address).

Programs it runs and files it touches (tell the person before installing):

- `git status` and `git rev-parse` in each space's folder (branch, ahead/behind, which repo and worktree it is), on the space's own machine. On this computer it also watches each repo's git folder for changes.
- `gh pr view` and `gh run list` in the same folders, on the space's own machine, where `gh` is installed: this is the one thing that reaches the network (GitHub, with the person's `gh` login). A click on a mark runs `xdg-open` (else `open`) with the page's address.
- `hc read` on waiting agents every 4 seconds (to find the question), `hc keys` and `hc send` when you answer or hand over a to-do line, `hc machine ls`; `Log in ►` opens a tab running `hc machine login <machine>`; `Connect` runs `hc machine rm` and `hc machine add` for that machine.
- `hyprctl monitors -j` to learn the screen scale; where that isn't there, `herdr-app shot` to a temporary file and `od` on its header.
- While the globe revolves, `layout.set` makes the app rewrite `layouts/commander.json` and its saved clicks eight times a second.
- `python3 mods/cmdr-usage/usage.py`, here and (as `python3 -c`) on each machine with spaces. It reads the agents' own session logs, `~/.claude/projects/**/*.jsonl` (Claude Code) and `~/.codex/sessions/**/*.jsonl` (Codex), those changed in the last 8 days, and keeps what it found in `~/.cache/herdr-commander-usage.json` (under `$XDG_CACHE_HOME` when set). It sends nothing anywhere; its answer goes back to the menu bar.
- `python3 mods/cmdr-todo/herdr-todo.py`, here or (as `python3 -c`) on the space's machine. It reads and writes `~/.herdr/todos/<space id>.md` and keeps a lock and what each terminal has seen in `~/.herdr/todos-state/`; it runs `hc get` and `hc ls`, reads `~/.config/herdr-app/shared.json` for the space's name, and in the hook looks whether `~/.config/herdr-app/notes/<space id>.md` exists. The panel itself runs `mkdir -p ~/.herdr/todos`, watches and reads that folder, and asks `sh` whether `herdr-todo` is on the machine. The `►` menu runs `herdr-app do tab.new` to start an agent.
- `herdr-todo install` is never run by the layout: only the person runs it (`python3 ~/.config/herdr-app/mods/cmdr-todo/herdr-todo.py install`), because it changes how their agents behave. It links `~/.local/bin/herdr-todo` to the script, adds the `herdr-todo hook` command to the SessionStart, UserPromptSubmit and Stop hooks in `~/.claude/settings.json` and `~/.codex/hooks.json` (each only where that agent's folder exists), and adds `Bash(herdr-todo:*)` to Claude Code's allowed commands so it can run it without asking. A file it changes is first copied to `<file>.before-herdr-todo`. `install --on <machine>` copies the script to `~/.local/bin/herdr-todo` there with `hc exec` and does the same there.
- `python3 mods/cmdr-tabs/herdr-move.py`, here, for each move: it runs `herdr-app ls`, `herdr-app do` and `hc get`.
- `cmdr-notes` reads and writes `~/.config/herdr-app/notes/<space id>.md`, on this computer.
- `cmdr-tree` looks for `mods/retro-crew/main.js`, a crew launcher that is not part of this layout: only where that mod exists do a `Start a crew…` menu item and a `Crew` key cell (`cmdr-tree.crew`) show.
- No `fetch`: apart from `gh`, nothing talks to the network.

Art: the font is PxPlus IBM VGA 8x16 from The Ultimate Oldschool PC Font Pack by VileR (int10h.org), under CC BY-SA 4.0; its license is in `mods/cmdr-tree/fonts/`. Program icons are the app's own.

The globe is `backgrounds/commander-earth/000.png` to `479.png`: 312 × 312 px, transparent outside a 224 px disc (each globe pixel is 2 × 2), one picture per 0.75° of turn. `render.py` beside them made them (Python with numpy and Pillow): it paints Natural Earth's 1:50m land, lakes, glaciated areas and Antarctic ice shelves (public domain, naturalearthdata.com; GeoJSON from github.com/nvkelso/natural-earth-vector) onto an 8192 × 4096 map, then for each picture looks up every globe pixel through an orthographic projection, 5 × 5 samples a pixel, majority wins. The pictures as shipped: `render.py <folder with the four .geojson files> <out folder> 112 480 2 0.72`.

## Watch out

- **Nothing is sized in plain px.** The font is sharp only at 16 device pixels (or a whole multiple), so every size is counted in `u`, half a character cell: `u = (16k + bump) / 2 / (scale × zoom)`, where `k` is the multiple nearest an 11 px label. Text is `2u`, a row `4u`, one device pixel `1 / (scale × zoom)`. A build that writes `text_size(12)` gets blurred strokes.
- **A mod can't ask for the screen scale.** `cmdr-menubar` finds it (shared `commander.scale`): Hyprland first, else the frame's pixel width over the bar's width from `on_size_change`, which is already in window px with zoom applied. Without `sh` (Windows) it stays 1.6 until the person picks one in View > Screen scale; a wrong scale means soft text, nothing worse.
- **Bars follow the zoom.** A row's height in layout px changes with zoom and text size, so `cmdr-menubar` resizes `menubar`, `tabs` and `keybar` with `layout.resize`. The pane header's height (20.83) and the sidebar's width are fixed in the layout file; raise them by hand for much bigger text.
- `Bigger text` adds 2 device pixels a step (shared `commander.bump`, 0 to 16). Boxes stay on whole pixels; letters are softer off the font's native size.
- Popup `at` is in window px before zoom (multiply mod px by zoom); overlay `width` and `height` are after it.
- **A popup's shadow needs room.** The overlay must be opened `frame: "none"` and one `u` wider and taller than the box, and the box must draw its own background and border. With the app's frame left on, the popup gets rounded corners and a soft shadow; without the extra `u`, the hard shadow is cut off.
- Mods can't import across folders: `ui.js` is copied into each mod that uses it. Change one, copy it to the others; the eight copies are identical.
- Terminal text is the layout's `font_size` 14, not on the grid; it is as sharp as the app's own text rendering makes it.
- The pane title is a tag in the header's corner, not set into the border line: the app draws pane borders.
- `cmdr-reply` and the shipped mods it opens (`menu`, `new-menu`, `picker`, `worktree`, `machine-add`) are sized in ordinary px, not on the grid. So are the shipped `files` and `changes` in the side panel, which also have no Commander frame: the view tags are missing while one of them shows, which is why the tab strip's buttons come back then.
- An editor's text size is set when it is made: `cmdr-notes` makes a new one (with the same text) when the grid's text size changes.
- Notes are saved on this computer, also for a space on another machine (under its id with the machine's name in front). The hook's pointer to the notes file therefore only finds notes of spaces on this computer.
- Menu labels have no Alt-letter hotkeys. Inside an open menu, Up, Down and Enter are handled in code but this build was only exercised with the mouse and by command.
- The answer buttons press keys blindly: they suit agents whose prompts take `1`, `2`, `3` and Esc.
- Animate the working mark with `.frames(...)`, never a timer.
- **A move has to be run by a mod that stays.** Parking a pane removes its header, and a popup closes when its item is clicked; a task started there stops halfway. So the pane header and the tab menu only write the request to shared `commander.move` and run `cmdr-menubar.move`; the bar's copy runs `herdr-move.py`, one move at a time, and shows the error toast. A request older than 5 seconds is dropped.
- Limits of a move: only terminal panes; a pane that is its tab's only one can't go to a new tab; `terminal.keep` lands in the focused pane's tab, so the script moves the focus, and a join ends with the focus on the first pane it moved. Between the park and the keep the terminal has no pane: the script tries the keep ten times, 0.3 seconds apart, and waits up to 8 seconds for the core at each step; if it still fails the terminal goes on running without a pane (the toast says what failed). From the menus and keys a join always goes to the right; `down` exists only in the script. It needs `python3`, `herdr-app` and `hc` on the PATH that `exec` sees.
- **The to-do list has many writers.** The person and several agents change the same file, so nothing edits it directly: `herdr-todo.py` takes a lock (`fcntl`, so not on Windows), re-reads the file, changes it and replaces it in one step. The panel names a line by its whole text, not its number, which may have moved. Two lines with the same text can't be told apart (a line that is already on the list and not done isn't added a second time).
- The `►` menu stays open, saying what it is doing, until the line is handed over and marked: closing the popup would stop its task.
- A list on another machine can't be watched: it is read every 5 seconds while it is the one shown and the window is in front, and it is counted on the tab strip only once it has been shown.
- Without `herdr-todo install`, agents are not told about the list; a line handed over with `►` is then just its text. With it installed on that machine, the handed-over text ends with a note naming `herdr-todo`. The hooks exist for Claude Code and Codex only.
- The usage meter counts Claude Code and Codex only, from their logs; tokens are input, output and cache writes. "Today" is each machine's own day. Codex's limit is as of the last time Codex logged it; Claude Code logs none. The first read goes through 8 days of logs and can take a while (the bar shows no count until one is in); later reads only re-read files that changed.
- GitHub answers are kept: 30 seconds while checks run, 3 minutes when settled, 10 minutes where the branch has no run, an hour where `gh` couldn't answer at all. A branch is asked about again only when its git is looked at, so a mark can lag behind GitHub. Opening the page has no Windows path (`xdg-open`, then `open`).
- The activity log only knows what happened while the app ran. A change seen in the first 20 seconds after a start gets no duration, and an agent that is blocked the first time the tree sees it adds no line.
- **The app does not animate a layout background.** An animated GIF or WebP shows its first frame, and a picture is cached by its path, so overwriting the file changes nothing. The globe turns by naming a different file each step, through `layout.set`.
- **A picture shown for the first time leaves its block bare for a moment**, which reads as flicker on the first revolution. That is what the `globe` wrapper is for: it shows the previous picture, already loaded, in the same place under `main`. `main` must be its only child, with no gap or padding, or the two globes won't line up.
- **The globe has a running cost.** Measured on one Linux laptop while revolving: about 2% of one processor core, about 68 kB a second written to disk (the layout file, each step), and about 190 MB of memory for the 480 loaded pictures. `still` stops the first two. At one step a second the motion ticks visibly; that is why it is eight.
- The layout file is rewritten eight times a second while the globe revolves: set it to `still` before editing `layouts/commander.json` by hand, or your edit is overwritten.
- Copy `backgrounds/commander-earth/` along with the layout and mods. Without the folder there is no globe, only half see-through terminals; `View > Globe`, clicked through to `off`, puts the pane fill back.
- The pictures are scaled to the terminal area (`fit: "contain"`), so unlike the text, the globe's pixels do not sit on the screen's pixel grid.
- A new set of pictures needs a new folder name while the app runs (the cache again); then change `GLOBE.dir` and `GLOBE.frames` in `cmdr-menubar/main.js` and the two paths in the layout.

## Done when

- `herdr-app check` passes for each of the nine mods, and `layout.switch {name: "commander"}` shows the window with no `layouts/commander.error`.
- A screenshot enlarged 4× shows single-pixel strokes in the menu bar, tree, side panel and key bar, at zoom 0.9 and 1.
- After `app.zoom_in`, the three bars are still exactly one text row tall.
- A terminal reporting `state=blocked` (OSC 7501) shows `‼` on its row, raises the menu bar's `needs you` count, and appears in a red "Waiting on you" box with the last line ending in `?` from its screen; killing it removes all three.
- `herdr-app do cmdr-menubar.view` opens the View menu directly under its label, flush with the bar, with a dark strip one character wide down its right side and along its bottom; `Sidebar` has `[x]` in front, `Globe` has `revolving` at its right.
- Each key bar cell names a key that is bound in `keys.json`, and unbinding one removes its cell.
- Two projects on one machine show two different hues, and their sessions carry them.
- `herdr-app do cmdr-menubar.todo` shows the side panel from the menu bar down to the key bar, with `To-do` a raised chip in its top border, and takes the `To-do` and `Notes` buttons off the tab strip; clicking `Notes` in the border shows the note; clicking it again hides the panel and the buttons are back.
- In a space on this computer with an empty list, a line typed on the `>` line appears as `- [ ] …` in `~/.herdr/todos/<space id>.md`, and with the panel hidden again the tab strip's button says `To-do 1`. From a shell, `python3 ~/.config/herdr-app/mods/cmdr-todo/herdr-todo.py --space <space id> start 1` turns the line's box to `[►]` without a click in the app, and the same with `done 1` moves it under `Done 1`, struck through.
- `►` on a line, then an agent's name, opens a new tab in that space running that agent with the line as its first message, and the line's box becomes `[►]` with the agent's mark and icon beside it.
- Typing in Notes puts `*` after `Notes`; a second after the last key it is gone and `~/.config/herdr-app/notes/<space id>.md` holds the text. Showing another space shows that space's note.
- Once the first count is in, the menu bar shows `Σ … today` and `~/.cache/herdr-commander-usage.json` exists; `herdr-app do cmdr-menubar.usage` opens the usage popup under the right end of the bar.
- In a tab with two terminals, `herdr-app do cmdr-menubar.pane-to-tab` leaves one in the tab and puts the focused one in a new tab right after it, with the same terminal address and whatever ran in it still running; `herdr-app do cmdr-menubar.tab-to-split` from the new tab puts it back to the right of the other and the new tab is gone. In a tab with one pane, `pane-to-tab` shows the toast `Nothing to move`.
- Right-clicking a tab opens Commander's menu at the pointer, with one `Join into …` line for each other tab that has a terminal.
- An agent that goes from working to idle adds a line to Activity with the time and how long it worked, and one that goes from working to blocked adds a line ending in `asked`; after the agent's terminal is closed its lines stay, muted. `herdr-app do cmdr-tree.activity` folds the frame to `Activity <count>`, and `herdr-app do cmdr-tree.activity-clear` empties it.
- In a checkout on a branch with an open pull request, with `gh` logged in, the space's row shows `#<number>` and `√`, `×` or the shimmer; with `gh` missing, the row shows no mark and nothing reports an error.
- With the globe revolving, the number in `main`'s `background.image` in `layouts/commander.json` goes up by about eight a second and follows `479` with `000`, and screenshots taken in quick succession all show a globe.
- `herdr-app do cmdr-menubar.globe` once stops that number; again removes `background` from `main` and `globe`, gives `pane` the fill `background` and sets `terminal_opacity` to 1; a third time puts picture `000` back and it turns again.
