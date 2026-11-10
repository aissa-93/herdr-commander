// Commander's tab strip: the shown space's tabs as cells (number, what's in it, its
// agents' state), a + for a new tab or agent, and the right panel's views.
// Click a tab to show it, double-click to rename, drag to reorder, right-click for its
// menu; the wheel goes to the next and previous tab.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, shared, layout } from "herdr";
import { grid, mark, icon } from "./ui.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const G = grid();
    const space = spaces().find((p) => p.active);
    const shown = space?.tabs ?? [];
    const all = panes();
    const stop = (_e, cx) => cx.stop_propagation();
    const item = (c, i) => {
      const program = all.find((p) => p.tab === c.id && p.program?.agent)?.program ?? all.find((p) => p.tab === c.id)?.program;
      // A tab nobody named is its number: say what runs in it instead.
      const name = c.named ? c.name : program?.name ?? "Terminal";
      return h_flex().id(`tab-${c.id}`).h_full().px(2 * G.u).gap(G.u).items_center().flex_none().cursor_pointer()
        .bg(c.active ? t.raised : t.canvas).text_color(c.active ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex((x) => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .child(div().flex_none().text_color(c.active ? t.accent : t.muted).child(String(c.index)))
        .when(Boolean(program?.icon), (el) => el.child(icon(program, G, c.active ? t.foreground : t.muted)))
        .child(div().max_w(30 * G.u).truncate().child(c.zoomed ? `${name} [zoom]` : name))
        .when(c.panes > 1, (el) => el.child(div().flex_none().text_color(t.muted).child(`+${c.panes - 1}`)))
        .when(Boolean(c.status) && c.status !== "idle", (el) => el.child(mark(t, G, c.status)))
        .when(c.active, (el) => el.child(div().id(`close-${c.id}`).w(2 * G.u).h(G.row).flex_none().flex().items_center().justify_center().text_color(t.muted)
          .hover((s) => s.text_color(t.foreground))
          .tooltip("Close tab")
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child("×")));
    };
    const root = layout();
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, find(root, "notes") ? [...enabled, "notes"] : enabled);
    const panelButton = (id, label) => {
      const on = panel && !panel.hidden && body?.active === id;
      return div().id(`panel-${id}`).h_full().px(2 * G.u).flex_none().flex().items_center().cursor_pointer()
        .bg(on ? t.raised : t.canvas).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(label);
    };
    return h_flex().size_full().min_w(0).gap(G.u).items_center().bg(t.canvas)
      .text_size(G.text).line_height(`${G.text}px`)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel((e) => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(G.u).overflow_x_scrollbar()
        .children(shown.map(item))
        .child(div().id("tab-new").w(G.row).h_full().flex_none().flex().items_center().justify_center().text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("New tab or agent")
          .on_mouse_down("left", stop).on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).child("+")))
      .when(Boolean(find(root, "notes")), (el) => el.child(panelButton("notes", "Notes")))
      .when(enabled.includes("files"), (el) => el.child(panelButton("files", "Files")))
      .when(enabled.includes("changes"), (el) => el.child(panelButton("changes", "Changes")));
  }
}
