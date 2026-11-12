// Commander's top bar: menus for everything the app does, each item with the key it's
// bound to, and how many agents are in each state. With props { menu }, the same mod
// is one of those menus (a popup). Keys: cmdr-menubar.<menu id> opens a menu
// (herdr, space, tab, pane, agent, view, help); cmdr-menubar.bigger / smaller / sharp
// change Commander's text size.
//
// It also keeps the usage meter: every few minutes it runs mods/cmdr-usage/usage.py
// here and on each machine that has spaces, keeps the answers in shared
// "commander.usage", and shows today's tokens and estimated API cost; a click opens the cmdr-usage popup.
// Keys: cmdr-menubar.usage opens it, cmdr-menubar.todo shows or hides the to-do panel.
//
// Moving panes between tabs (mods/cmdr-tabs/herdr-move.py does it, terminals keep
// running): cmdr-menubar.pane-to-tab puts the focused pane in a new tab,
// cmdr-menubar.tab-to-split puts the shown tab's panes beside a pane of the tab before
// it (the first tab: after it). Other mods ask with shared "commander.move" =
// { op: "tab", pane } | { op: "join", tab, pane, direction } and then run
// cmdr-menubar.move: this copy stays shown, so the move and its error toast finish
// even when the pane or popup that asked is gone. With props { menu: "tab-ctx", tab }
// this mod is cmdr-tabs' right-click menu for that tab (cmdr-tabs sets shared
// "commander.tabmenu" to the tab and runs cmdr-menubar.tab-menu).
//
// Updates (update.js): a while after start and then every six hours, this copy brings
// the install up to the repo's release branch. cmdr-menubar.update looks now (and says
// what it found), cmdr-menubar.update-auto turns the timed look off or on (shared
// "commander.update"); the last result is shared "commander.update.status".

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, panes, run, openOverlay, closeOverlay, props, nextCommand, exec, theme, shared, setShared, window, layout, appHome, readTextFile, notify } from "herdr";
import { grid, chord, pretty, mark, bump, BUMP_MAX, lifted } from "./ui.js";
import { execPython } from "./runtime.js";
import { update, UPDATE } from "./update.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The right panel's views (the layout's "panel" column and its "panel-body" stack).
function panel(id) {
  const root = layout();
  const col = find(root, "panel"), body = find(root, "panel-body");
  if (!col || !find(body, id)) return null;
  const on = !col.hidden && body?.active === id;
  return {
    on,
    toggle: () => {
      if (on) run("layout.hide", { id: "panel" });
      else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
    },
  };
}

// The screen's scale, by hand, where it can't be found (anything but Hyprland): the text
// is only sharp when this matches the display's. A scale set here is kept.
const SCALES = [1, 1.25, 1.5, 1.6, 1.75, 2];
function nextScale() {
  const now = Number(shared("commander.scale")) || 1.6;
  setShared("commander.scale.manual", true);
  setShared("commander.scale", SCALES[(SCALES.indexOf(now) + 1) % SCALES.length]);
}

// The globe behind the terminals: 480 pictures of the Earth, 0.75 degrees apart, in
// backgrounds/commander-earth/, the tab block's background. The app shows a still
// picture there, so turning the planet is changing which one, eight times a second.
// A picture shown for the first time takes a moment to load, and the block is bare
// meanwhile (a flicker): so the block sits in a wrapper ("globe") that shows the
// picture before it, already loaded, in the same place.
const GLOBE = { dir: "backgrounds/commander-earth", frames: 480, every: 125, opacity: 0.5 };
const MODES = ["on", "still", "off"];
const SAYS = { on: "revolving", still: "still", off: "off" };
const globeMode = () => (MODES.includes(shared("commander.globe")) ? shared("commander.globe") : "on");
const framePath = (i) => `${GLOBE.dir}/${String(i).padStart(3, "0")}.png`;

// Puts the globe's frame `i` in the layout, or takes the globe out (i null).
function setGlobe(i) {
  const root = JSON.parse(JSON.stringify(layout()));
  const main = find(root, "main");
  const pane = main?.content?.pane;
  if (!main || !pane) return;
  const under = find(root, "globe");
  if (i === null) {
    delete main.background; pane.background = "background"; root.terminal_opacity = 1;
    if (under) delete under.background;
  } else {
    main.background = { image: framePath(i), fit: "contain" }; delete pane.background; root.terminal_opacity = GLOBE.opacity;
    if (under) under.background = { image: framePath((i + GLOBE.frames - 1) % GLOBE.frames), fit: "contain" };
  }
  run("layout.set", { layout: root });
}
const globeFrame = () => { const m = /(\d{3})\.png$/.exec(find(layout(), "main")?.background?.image ?? ""); return m ? Number(m[1]) : null; };
function nextGlobeMode() {
  const mode = MODES[(MODES.indexOf(globeMode()) + 1) % MODES.length];
  setShared("commander.globe", mode);
  if (mode === "off") setGlobe(null);
  else if (globeFrame() === null) setGlobe(0);
}

// Commander's own updates (see the top), as the ≡ menu says them.
function updateSays() {
  const s = shared("commander.update.status");
  if (!s) return null;
  if (s.state === "dev") return "dev copy";
  if (s.state === "error") return "failed";
  return s.commit ? s.commit.slice(0, 7) : null;
}
const toggleAutoUpdate = () => setShared("commander.update", shared("commander.update") === "off" ? "on" : "off");

// A token count in four characters or so: 950, 386k, 2.9M.
const compact = (n) => (n < 1000 ? String(n) : n < 999500 ? `${Math.round(n / 1000)}k` : n < 99950000 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e6)}M`);
const USAGE_EVERY = 180000;

const SEP = { sep: true };
const cmd = (label, name, args, key) => ({ label, key: key ?? name, act: () => run(name, args ?? {}) });

// ---- moving panes between tabs ----

// Asks the shown bar copy to move (see the top). Safe from a popup or a pane header.
function requestMove(req) {
  setShared("commander.move", { ...req, at: Date.now() });
  run("cmdr-menubar.move");
}

// A tab's panes in order, and what a menu calls it.
const tabPanes = (id) => panes().filter((p) => p.tab === id);
function tabLabel(c) {
  const all = tabPanes(c.id);
  const program = all.find((p) => p.program?.agent)?.program ?? all[0]?.program;
  return `${c.index} · ${c.named ? c.name : program?.name ?? "Terminal"}`;
}
// Where a tab joining `target` goes: beside its last terminal pane (the right/bottom one).
const landing = (target) => tabPanes(target).filter((p) => p.terminal).at(-1)?.pane;

// The focused pane into a new tab: only a terminal, and only from a tab with another pane.
function canPaneToTab(pane) {
  return Boolean(pane?.terminal) && tabPanes(pane.tab).length > 1;
}
// The tab the shown one would join by key: the one before it, else the one after.
function joinTarget(space) {
  const tabs = (space?.tabs ?? []).filter((c) => !c.settled);
  const i = tabs.findIndex((c) => c.active);
  return i < 0 ? null : tabs[i - 1] ?? tabs[i + 1] ?? null;
}

// A tab's right-click menu (cmdr-tabs): rename, new, join into each other tab, close.
const JOIN_MAX = 9;
function tabMenu(id) {
  const space = spaces().find((s) => s.tabs.some((c) => c.id === id));
  if (!space) return [];
  const others = space.tabs.filter((c) => c.id !== id && landing(c.id)).slice(0, JOIN_MAX);
  const movable = tabPanes(id).some((p) => p.terminal);
  return [
    cmd("Rename…", "tab.rename", { id }, "tab.rename"),
    cmd("New tab", "tab.new", { space: space.id }, "tab.new"),
    ...(movable && others.length ? [SEP, ...others.map((c) => ({ label: `Join into ${tabLabel(c)}`, act: () => requestMove({ op: "join", tab: id, pane: landing(c.id), direction: "right" }) }))] : []),
    SEP,
    cmd("Close tab", "tab.close", { id }, "tab.close"),
  ];
}
// A menu's height: rows, separators and the frame, in the menu's px.
const menuHeight = (items, G) => items.reduce((h, it) => h + (it.sep ? 2 * G.u + G.px : G.row), 0) + 2 * G.u + 2 * G.px;

// Every menu. `key`: the action as keys.json spells it, to show its binding.
function menus() {
  const space = spaces().find((s) => s.active);
  const pane = panes().find((p) => p.focused);
  const enabled = shared("workspace.panels") ?? ["files", "changes"];
  const view = (id, label) => { const p = panel(id); return p ? [{ label, on: p.on, act: p.toggle }] : []; };
  return [
    { id: "herdr", label: "≡", items: [
      cmd("Settings…", "app.settings"),
      cmd("Command palette", "app.palette"),
      cmd("Go to space or agent…", "mod.open", { name: "picker" }, "mod.open:picker"),
      cmd("Usage…", "cmdr-menubar.usage"),
      SEP,
      cmd("Add machine…", "mod.open", { name: "machine-add" }, "mod.open:machine-add"),
      cmd("Next layout", "layout.switch"),
      SEP,
      cmd("Check for updates", "app.check_updates"),
      cmd("What's new", "app.whats_new"),
      SEP,
      { label: "Update Commander", key: "cmdr-menubar.update", value: updateSays(), act: () => run("cmdr-menubar.update") },
      { label: "Auto-update Commander", key: "cmdr-menubar.update-auto", on: shared("commander.update") !== "off", stay: true, act: toggleAutoUpdate },
    ] },
    { id: "space", label: "Space", items: [
      cmd("New space", "space.new"),
      cmd("Rename…", "space.rename"),
      cmd("Close space", "space.close"),
      SEP,
      cmd("Next space", "space.next"),
      cmd("Previous space", "space.prev"),
      SEP,
      { label: "New worktree…", act: () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: pane?.cwd, action: "new" } }) },
      { label: "Open worktree…", act: () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: pane?.cwd, action: "open" } }) },
    ] },
    { id: "tab", label: "Tab", items: [
      cmd("New tab", "tab.new"),
      { label: "New agent…", act: () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }) },
      cmd("Rename…", "tab.rename"),
      ...(joinTarget(space) && tabPanes(space.tabs.find((c) => c.active)?.id).some((p) => p.terminal)
        ? [cmd(`Join into tab ${joinTarget(space).index}`, "cmdr-menubar.tab-to-split")] : []),
      cmd("Close tab", "tab.close"),
      SEP,
      cmd("Next tab", "tab.next"),
      cmd("Previous tab", "tab.prev"),
    ] },
    { id: "pane", label: "Pane", items: [
      cmd("Split right", "pane.split", { direction: "right" }, "pane.split:right"),
      cmd("Split down", "pane.split", { direction: "down" }, "pane.split:down"),
      cmd("Zoom", "pane.zoom"),
      ...(canPaneToTab(pane) ? [cmd("Move to new tab", "cmdr-menubar.pane-to-tab")] : []),
      cmd("Close pane", "pane.close"),
      SEP,
      cmd("Go left", "pane.go", { direction: "left" }, "pane.go:left"),
      cmd("Go right", "pane.go", { direction: "right" }, "pane.go:right"),
      cmd("Go up", "pane.go", { direction: "up" }, "pane.go:up"),
      cmd("Go down", "pane.go", { direction: "down" }, "pane.go:down"),
    ] },
    { id: "agent", label: "Agent", items: [
      cmd("Next agent", "agent.next"),
      cmd("Previous agent", "agent.prev"),
      SEP,
      cmd("Reply…", "cmdr-tree.reply"),
      ...(shared("commander.crew") ? [cmd("Start a crew…", "cmdr-tree.crew")] : []),
    ] },
    { id: "view", label: "View", items: [
      // `on`: a thing that is shown or not, drawn with a box in front ([x] / [ ]).
      { ...cmd("Sidebar", "layout.toggle", { id: "sidebar" }, "layout.toggle:sidebar"), on: !find(layout(), "sidebar")?.hidden },
      ...view("notes", "Notes"),
      ...view("todo", "To-do").map((it) => ({ ...it, key: "cmdr-menubar.todo" })),
      // Files and Changes only where the person keeps them (the welcome's choice).
      ...(enabled.includes("files") ? view("files", "Files") : []),
      ...(enabled.includes("changes") ? view("changes", "Changes") : []),
      SEP,
      // Commander's own text, apart from the app's zoom (which the terminals follow).
      // `value`: what a setting is now, said at the row's right end.
      { label: "Bigger text", value: `${grid().size}px`, stay: true, act: () => setShared("commander.bump", Math.min(BUMP_MAX, bump() + 2)) },
      { label: "Smaller text", stay: true, act: () => setShared("commander.bump", Math.max(0, bump() - 2)) },
      { label: "Sharpest text", act: () => setShared("commander.bump", 0) },
      { label: "Screen scale", value: Number(shared("commander.scale")) || 1.6, stay: true, act: nextScale },
      { label: "Globe", value: SAYS[globeMode()], stay: true, act: nextGlobeMode },
      SEP,
      cmd("Zoom in", "app.zoom_in"),
      cmd("Zoom out", "app.zoom_out"),
      cmd("Actual size", "app.zoom_reset"),
    ] },
    { id: "help", label: "Help", items: [
      cmd("Keyboard shortcuts", "app.help"),
      cmd("Send feedback…", "app.feedback"),
    ] },
  ];
}

// A top-level label is its text plus two cells either side.
const labelWidth = (m, G) => ([...m.label].length + 4) * G.u;

export default class Menubar extends View {
  init(_props, cx) {
    if (props()?.menu) return this.menuInit(cx);
    // The planet's turn, a step at a time, while it's set to revolve.
    cx.timer.every(GLOBE.every, () => {
      const at = globeFrame();
      if (globeMode() === "on" && at !== null) setGlobe((at + 1) % GLOBE.frames);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (menus().some((m) => m.id === c)) this.open(c);
        // Text size, for keys: cmdr-menubar.bigger / smaller / sharp.
        if (c === "bigger") setShared("commander.bump", Math.min(BUMP_MAX, bump() + 2));
        if (c === "smaller") setShared("commander.bump", Math.max(0, bump() - 2));
        if (c === "sharp") setShared("commander.bump", 0);
        if (c === "scale") nextScale();
        if (c === "globe") nextGlobeMode();
        if (c === "rescale") { setShared("commander.scale.manual", false); await this.detect(); }
        if (c === "usage") this.openUsage();
        if (c === "update") this.checkUpdate(cx, true);
        if (c === "update-auto") toggleAutoUpdate();
        if (c === "usage-refresh") this.readUsage(cx, true);
        if (c === "todo") panel("todo")?.toggle();
        if (c === "pane-to-tab") {
          const pane = panes().find((p) => p.focused);
          if (canPaneToTab(pane)) this.move(cx, { op: "tab", pane: pane.pane });
          else notify({ title: "Nothing to move", body: "The pane is its tab's only one, or not a terminal.", level: "info" });
        }
        if (c === "tab-to-split") {
          const space = spaces().find((s) => s.active);
          const from = space?.tabs.find((c) => c.active), to = joinTarget(space);
          const pane = to && landing(to.id);
          if (from && pane) this.move(cx, { op: "join", tab: from.id, pane, direction: "right" });
          else notify({ title: "Nothing to join", body: "This space has no other tab with a terminal.", level: "info" });
        }
        // From cmdr-tabs (a right-click), else the shown tab's (a key).
        if (c === "tab-menu") {
          const id = shared("commander.tabmenu") ?? spaces().find((s) => s.active)?.tabs.find((t) => t.active)?.id;
          setShared("commander.tabmenu", null);
          if (id) this.openTabMenu(id);
        }
        if (c === "move") {
          const req = shared("commander.move");
          setShared("commander.move", null);
          // A request is a moment old; anything older was left behind.
          if (req && Date.now() - req.at < 5000) this.move(cx, req);
        }
      }
    });
    cx.timer.every(USAGE_EVERY, (cx) => this.readUsage(cx, false));
    this.readUsage(cx, true);
    cx.timer.after(UPDATE.first, (cx) => this.checkUpdate(cx, false));
    cx.timer.every(UPDATE.every, (cx) => this.checkUpdate(cx, false));
  }

  // One look at the repo (update.js). A timed look is quiet unless it changed something;
  // one asked for (the menu, the key) says what it found, and runs even with auto off.
  checkUpdate(cx, asked) {
    if (this.updating) return;
    this.updating = true;
    cx.spawn(async () => {
      try {
        const r = await update({ force: asked });
        setShared("commander.update.status", { ...r, at: Date.now() });
        if (asked && r.state === "current") notify({ title: "Commander is up to date", body: `Release ${r.commit.slice(0, 7)}.`, level: "info" });
        if (asked && r.state === "dev") notify({ title: "Commander doesn't update here", body: "This is a dev copy (.commander-dev): the repo is made from it.", level: "info" });
        if (asked && r.state === "error") notify({ title: "Couldn't update Commander", body: r.error, level: "error" });
      } finally {
        this.updating = false;
      }
    });
  }

  // One move at a time, by the script (it waits for the core between steps).
  move(cx, req) {
    (this.moves ??= []).push(req);
    if (this.moving) return;
    this.moving = true;
    cx.spawn(async () => {
      while (this.moves.length) {
        const m = this.moves.shift();
        // ls omits mod panes. Supply the sibling from the app's complete pane
        // list so a terminal beside a mod can leave its tab too.
        const source = panes().find((p) => p.pane === m.pane);
        const beside = source && tabPanes(source.tab).find((p) => p.pane !== m.pane)?.pane;
        const args = m.op === "tab" ? ["tab", m.pane, ...(beside ? [beside] : [])] : ["join", m.tab, m.pane, m.direction ?? "right"];
        try {
          const r = await execPython([`${appHome()}/mods/cmdr-tabs/herdr-move.py`, ...args], { timeout: 60000 });
          if (r.code !== 0) notify({ title: "Couldn't move the pane", body: (r.stderr || r.stdout).trim().split("\n").at(-1), level: "error" });
        } catch (e) {
          notify({ title: "Couldn't move the pane", body: String(e?.message ?? e), level: "error" });
        }
      }
      this.moving = false;
    });
  }

  // cmdr-tabs' right-click menu for a tab, at the pointer.
  openTabMenu(id) {
    const G = grid();
    const items = tabMenu(id);
    if (items.length) openOverlay({ mod: "cmdr-menubar", kind: "popup", frame: "none", width: 45 * G.u, height: menuHeight(items, G) + G.u, at: "pointer", props: { menu: "tab-ctx", tab: id } });
  }

  // The agents' own logs, added up by the script (see it for what counts). Each machine
  // with spaces is asked; one that doesn't answer keeps what it said last.
  readUsage(cx, force) {
    if (this.reading || (!force && !window().active)) return;
    this.reading = true;
    cx.spawn(async () => {
      try {
        const path = `${appHome()}/mods/cmdr-usage/usage.py`;
        const src = await readTextFile(path);
        if (src) {
          const was = shared("commander.usage")?.machines ?? {};
          const now = { at: Date.now(), machines: {}, errors: {} };
          for (const on of [null, ...new Set(spaces().map((s) => s.machine).filter(Boolean))]) {
            const key = on ?? "";
            try {
              const r = on ? await execPython(["-c", src], { on, timeout: 60000 }) : await execPython([path], { timeout: 120000 });
              if (r.code === 0) now.machines[key] = JSON.parse(r.stdout);
              else now.errors[key] = r.stderr.trim() || "Usage helper failed.";
            } catch (error) { now.errors[key] = String(error?.message ?? error); }
            if (!now.machines[key] && was[key]) now.machines[key] = was[key];
          }
          setShared("commander.usage", now);
        }
      } catch {}
      this.reading = false;
    });
  }

  openUsage() {
    const G = grid();
    const width = 68 * G.u;
    openOverlay({ mod: "cmdr-usage", kind: "popup", frame: "none", width: width + G.u, height: 111 * G.u, at: { x: Math.max(0, (this.width ?? 0) - (width + 2 * G.u) * G.zoom), y: this.height ?? G.row * G.zoom } });
  }

  // The grid needs the screen's scale, which a mod can't ask for. Hyprland says; anywhere
  // else the window's own picture does: its width in device pixels (herdr-app shot, read
  // from the PNG's header) over this bar's width, which spans the window. Failing both
  // it stays 1.6 until the person sets it: View > Screen scale, which
  // is then kept (cmdr-menubar.rescale goes back to finding it).
  async detect() {
    if (shared("commander.scale.manual")) return;
    let scale = null;
    try {
      const list = JSON.parse((await exec("hyprctl", ["monitors", "-j"])).stdout);
      scale = (list.find((m) => m.focused) ?? list[0])?.scale;
    } catch {}
    if (!scale && this.width) {
      try {
        const code = 'import os,struct,subprocess,tempfile\nwith tempfile.TemporaryDirectory(prefix="herdr-scale-") as folder:\n path=os.path.join(folder,"window.png")\n subprocess.run(["herdr-app","shot",path],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n with open(path,"rb") as image: header=image.read(24)\n if header[:8] != b"\\x89PNG\\r\\n\\x1a\\n": raise ValueError("Not a PNG")\n print(struct.unpack(">I",header[16:20])[0])';
        const r = await execPython(["-c", code]);
        const px = r.code === 0 ? Number(r.stdout.trim()) : 0;
        // on_size_change counts in window px (zoom already in). Scales come in
        // twentieths (1, 1.25, 1.6, 2).
        if (px) scale = Math.round((px / this.width) * 20) / 20;
      } catch {}
    }
    if (scale >= 0.5 && scale <= 4 && scale !== shared("commander.scale")) setShared("commander.scale", scale);
  }

  // The bars are one row tall, and a row is counted in device pixels (see ui.js), so
  // its size in layout px moves with the zoom: keep the layout's three bars on it.
  fit(G) {
    this.fitted ??= {};
    const root = layout();
    for (const id of ["menubar", "tabs", "keybar"]) {
      const px = find(root, id)?.size?.px;
      if (px == null || Math.abs(px - G.row) < 0.05 || this.fitted[id] === G.row) continue;
      this.fitted[id] = G.row;
      run("layout.resize", { id, px: G.row });
    }
  }

  open(id) {
    const G = grid();
    const all = menus();
    const n = all.findIndex((m) => m.id === id);
    const m = all[n];
    if (!m) return;
    const x = all.slice(0, n).reduce((w, k) => w + labelWidth(k, G), 0);
    // `at` is in window px before zoom; sizes are after it, like everything a mod draws.
    openOverlay({ mod: "cmdr-menubar", kind: "popup", frame: "none", width: 45 * G.u, height: menuHeight(m.items, G) + G.u, at: { x: x * G.zoom, y: this.height ?? G.row * G.zoom }, props: { menu: id } });
  }

  render() {
    const t = theme();
    if (props()?.menu) return this.renderMenu(t);
    const G = grid();
    this.fit(G);
    const open = shared("commander.menu");
    const stop = (_e, cx) => cx.stop_propagation();
    const list = agents();
    const count = (s) => list.filter((a) => a.status === s).length;
    const stat = (s, text) => h_flex().gap(G.u).items_center().child(mark(t, G, s)).child(text);
    const blocked = count("blocked");
    const w = window();
    const used = Object.values(shared("commander.usage")?.machines ?? {});
    // A machine whose day hasn't turned yet (another time zone) still counts as today.
    const today = used.reduce((n, m) => n + Object.values(m.tools ?? {}).reduce((k, v) => k + (v[0] ?? 0), 0), 0);
    // And what that would cost at API list prices (usage.py's estimate), once a machine has one.
    const spent = used.some((m) => m.cost) ? used.reduce((n, m) => n + (m.cost?.[0] ?? 0), 0) : null;
    const button = (id, label, action) => div().id(id).w(G.row).h(G.row).flex_none().flex().items_center().justify_center().text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(action).child(label);
    return h_flex().id("bar").size_full().items_center().bg(t.chrome).border_b(G.px).border_color(t.border)
      .on_size_change((size, cx) => {
        this.height = size.height;
        const first = !this.width;
        this.width = size.width;
        if (first) cx.spawn(async () => { await this.detect(); });
      })
      .text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .children(menus().map((m) => {
        const on = open === m.id;
        return div().id(`menu-${m.id}`).w(labelWidth(m, G)).h_full().flex_none().flex().items_center().justify_center().cursor_pointer()
          .when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground))
          .when(!on, (el) => el.when(m.id === "herdr", (el) => el.text_color(t.accent)).hover((s) => s.bg(t.hover)))
          .on_mouse_down("left", stop)
          .on_click(() => this.open(m.id))
          .child(m.label);
      }))
      .child(div().flex_1())
      .child(h_flex().flex_none().px(2 * G.u).gap(3 * G.u).items_center().text_color(t.muted)
        .when(used.length > 0, (el) => el.child(h_flex().id("usage").gap(G.u).items_center().cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .tooltip("Tokens your agents used today, and what they'd cost at API list prices. Click for projects and the week.")
          .on_mouse_down("left", stop).on_click(() => this.openUsage())
          .child(div().text_color(t.accent).child("Σ")).child(`${compact(today)} today`)
          .when(spent !== null, (el) => el.child(div().text_color(t.dim).child(`≈$${spent < 9.995 ? spent.toFixed(2) : Math.round(spent)}`)))))
        .when(blocked > 0, (el) => el.child(h_flex().id("needs").gap(G.u).items_center().cursor_pointer().text_color(t.foreground)
          .tooltip("Answer the one that has waited longest")
          .on_mouse_down("left", stop).on_click(() => run("cmdr-tree.reply"))
          .child(mark(t, G, "blocked")).child(`${blocked} needs you`)))
        .when(count("done") > 0, (el) => el.child(stat("done", `${count("done")} done`)))
        .when(count("working") > 0, (el) => el.child(stat("working", `${count("working")} working`)))
        .child(stat("idle", `${count("idle")} idle`)))
      .when(Boolean(w?.buttons), (el) => el
        .child(button("minimize", "_", () => run("window.minimize")))
        .child(button("maximize", w.maximized ? "▫" : "□", () => run("window.maximize")))
        .child(button("close-window", "×", () => run("window.close"))));
  }

  // ---- one menu, as a popup ----

  menuInit(cx) {
    this.at = -1;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(80, () => this.handle.focus());
    // The bar shows which menu is open.
    setShared("commander.menu", props().menu);
  }

  async close() {
    if (props()?.menu && shared("commander.menu") === props().menu) setShared("commander.menu", null);
  }

  // `stay`: the menu stays open, to press again (text size).
  pick(it) {
    if (!it.stay) closeOverlay(props().overlay);
    it.act();
  }

  onKey(e, cx, items) {
    const live = items.map((it, i) => (it.sep ? -1 : i)).filter((i) => i >= 0);
    const here = live.indexOf(this.at);
    if (e.key === "down") this.at = live[(here + 1) % live.length];
    else if (e.key === "up") this.at = live[(here - 1 + live.length) % live.length];
    else if (e.key === "enter" && here >= 0) return this.pick(items[this.at]);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  renderMenu(t) {
    const G = grid();
    const items = props().menu === "tab-ctx" ? tabMenu(props().tab) : menus().find((k) => k.id === props().menu)?.items ?? [];
    // A menu with things to show or hide keeps a column in front for their boxes.
    const boxes = items.some((it) => "on" in it);
    // The overlay is a cell wider and taller than the menu: its shadow (ui.js `lifted`).
    return lifted(G, v_flex().id("menu").track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx, items))
      .w_full().py(G.u).bg(t.popover).border(G.px).border_color(t.input)
      .text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .children(items.map((it, i) => {
        if (it.sep) return div().h(G.px).my(G.u).flex_none().bg(t.border);
        const on = this.at === i;
        const key = it.key ? pretty(chord(it.key)) : "";
        return h_flex().id(`item-${i}`).h(G.row).px(2 * G.u).flex_none().items_center().cursor_pointer()
          .when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground))
          .on_hover((over, cx) => { if (over && this.at !== i) { this.at = i; cx.notify(); } })
          .on_click(() => this.pick(it))
          .when(boxes, (el) => el.child(div().w(4 * G.u).flex_none().when(!it.on && !on, (x) => x.text_color(t.dim)).child("on" in it ? (it.on ? "[x]" : "[ ]") : "")))
          .child(div().flex_1().min_w(0).truncate().child(it.label))
          .when(it.value != null, (el) => el.child(div().flex_none().ml(2 * G.u).text_color(on ? t.accent_foreground : t.accent).child(String(it.value))))
          .when(Boolean(key), (el) => el.child(div().flex_none().ml(2 * G.u).text_color(on ? t.accent_foreground : t.muted).child(key)));
      })));
  }
}
