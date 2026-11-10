// Commander's top bar: menus for everything the app does, each item with the key it's
// bound to, and how many agents are in each state. With props { menu }, the same mod
// is one of those menus (a popup). Keys: cmdr-menubar.<menu id> opens a menu
// (herdr, space, tab, pane, agent, view, help); cmdr-menubar.bigger / smaller / sharp
// change Commander's text size.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, spaces, panes, run, openOverlay, closeOverlay, props, nextCommand, exec, theme, shared, setShared, window, layout } from "herdr";
import { grid, chord, pretty, mark, bump, BUMP_MAX } from "./ui.js";

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

const SEP = { sep: true };
const cmd = (label, name, args, key) => ({ label, key: key ?? name, act: () => run(name, args ?? {}) });

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
      SEP,
      cmd("Add machine…", "mod.open", { name: "machine-add" }, "mod.open:machine-add"),
      cmd("Next layout", "layout.switch"),
      SEP,
      cmd("Check for updates", "app.check_updates"),
      cmd("What's new", "app.whats_new"),
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
      cmd("Close tab", "tab.close"),
      SEP,
      cmd("Next tab", "tab.next"),
      cmd("Previous tab", "tab.prev"),
    ] },
    { id: "pane", label: "Pane", items: [
      cmd("Split right", "pane.split", { direction: "right" }, "pane.split:right"),
      cmd("Split down", "pane.split", { direction: "down" }, "pane.split:down"),
      cmd("Zoom", "pane.zoom"),
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
      cmd("Sidebar", "layout.toggle", { id: "sidebar" }, "layout.toggle:sidebar"),
      ...view("notes", "Notes"),
      // Files and Changes only where the person keeps them (the welcome's choice).
      ...(enabled.includes("files") ? view("files", "Files") : []),
      ...(enabled.includes("changes") ? view("changes", "Changes") : []),
      SEP,
      // Commander's own text, apart from the app's zoom (which the terminals follow).
      { label: `Bigger text (${grid().size}px)`, stay: true, act: () => setShared("commander.bump", Math.min(BUMP_MAX, bump() + 2)) },
      { label: "Smaller text", stay: true, act: () => setShared("commander.bump", Math.max(0, bump() - 2)) },
      { label: "Sharpest text", act: () => setShared("commander.bump", 0) },
      { label: `Screen scale: ${Number(shared("commander.scale")) || 1.6}`, stay: true, act: nextScale },
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
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (menus().some((m) => m.id === c)) this.open(c);
        // Text size, for keys: cmdr-menubar.bigger / smaller / sharp.
        if (c === "bigger") setShared("commander.bump", Math.min(BUMP_MAX, bump() + 2));
        if (c === "smaller") setShared("commander.bump", Math.max(0, bump() - 2));
        if (c === "sharp") setShared("commander.bump", 0);
        if (c === "scale") nextScale();
        if (c === "rescale") { setShared("commander.scale.manual", false); await this.detect(); }
      }
    });
  }

  // The grid needs the screen's scale, which a mod can't ask for. Hyprland says; anywhere
  // else the window's own picture does: its width in device pixels (herdr-app shot, read
  // from the PNG's header) over this bar's width, which spans the window. Failing both
  // (no sh: Windows) it stays 1.6 until the person sets it: View > Screen scale, which
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
        const r = await exec("sh", ["-c", 'd=$(mktemp -d) && herdr-app shot "$d/w.png" >/dev/null 2>&1 && od -An -tu1 -j16 -N4 "$d/w.png"; rm -rf "$d"']);
        const b = r.stdout.trim().split(/\s+/).map(Number);
        const px = b.length === 4 ? b.reduce((n, v) => n * 256 + v, 0) : 0;
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
    const rows = m.items.reduce((h, it) => h + (it.sep ? 2 * G.u + G.px : G.row), 0);
    openOverlay({ mod: "cmdr-menubar", kind: "popup", frame: "none", width: 44 * G.u, height: rows + 2 * G.u + 2 * G.px, at: { x: x * G.zoom, y: this.height ?? G.row * G.zoom }, props: { menu: id } });
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
    const m = menus().find((k) => k.id === props().menu);
    const items = m?.items ?? [];
    return v_flex().id("menu").track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx, items))
      .w_full().py(G.u).bg(t.popover).border(G.px).border_color(t.input)
      .text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .children(items.map((it, i) => {
        if (it.sep) return div().h(G.px).my(G.u).flex_none().bg(t.border);
        const on = this.at === i;
        const key = it.key ? pretty(chord(it.key)) : "";
        return h_flex().id(`item-${i}`).h(G.row).px(2 * G.u).gap(2 * G.u).flex_none().items_center().cursor_pointer()
          .when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground))
          .on_hover((over, cx) => { if (over && this.at !== i) { this.at = i; cx.notify(); } })
          .on_click(() => this.pick(it))
          .child(div().flex_1().min_w(0).truncate().child(it.label))
          .when(Boolean(it.on), (el) => el.child("■"))
          .when(Boolean(key), (el) => el.child(div().flex_none().text_color(on ? t.accent_foreground : t.muted).child(key)));
      }));
  }
}
