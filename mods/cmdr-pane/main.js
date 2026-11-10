// Commander's pane header: a tag in the frame's top-left corner with the pane's number
// and what runs in it (inverse while the pane has the keyboard), its folder, and the
// agent's state on the right. Hover for split, move to a new tab, zoom and close (the
// move is cmdr-menubar's: see "commander.move" there).
//   { "tab": "active", "pane": { "header": { "content": { "mod": "cmdr-pane" } } } }
// Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, setShared } from "herdr";
import { grid, mark, icon } from "./ui.js";

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

const WORD = { working: "working", blocked: "needs you", done: "done" };

export default class Pane extends View {
  init() { this.hovered = false; }

  render() {
    const t = theme();
    const G = grid();
    const all = panes();
    const p = all.find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const pane = p.pane;
    const siblings = all.filter((x) => x.tab === p.tab);
    const n = siblings.findIndex((x) => x.pane === pane) + 1;
    const movable = Boolean(p.terminal) && siblings.length > 1;
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || p.mod || "shell";
    const button = (id, label, tip, command, args) => div().id(id).w(3 * G.u).h_full().flex_none().flex().items_center().justify_center()
      .text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (typeof command === "function") command();
        else run(command, args);
      })
      .child(label);
    const toTab = () => { setShared("commander.move", { op: "tab", pane, at: Date.now() }); run("cmdr-menubar.move"); };
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .gap(G.u)
      .items_center()
      .bg(t.background)
      .text_size(G.text).line_height(`${G.text}px`)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(h_flex().h_full().flex_none().px(G.u).gap(G.u).items_center()
        .bg(p.focused ? t.accent : t.raised).text_color(p.focused ? t.accent_foreground : t.foreground)
        .child(String(n))
        .when(Boolean(p.program?.icon), (el) => el.child(icon(p.program, G, p.focused ? t.accent_foreground : t.foreground)))
        .child(div().max_w(40 * G.u).truncate().child(p.zoomed ? `${name} [zoom]` : name)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(folder(p.cwd)))
      .when(Boolean(p.branch), (el) => el.child(div().flex_none().max_w(24 * G.u).truncate().text_color(t.ansi6).child(p.branch)))
      .when(!WORD[p.status] && !this.hovered, (el) => el.child(div().w(G.px).flex_none()))
      .when(Boolean(WORD[p.status]), (el) => el.child(h_flex().flex_none().gap(G.u).pr(G.u).items_center().text_color(t[p.status])
        .child(mark(t, G, p.status)).child(WORD[p.status])))
      .when(this.hovered, (el) => el.child(h_flex().h_full().flex_none()
        .child(button(`ph-r-${pane}`, "→", "Split right", "pane.split", { direction: "right", pane }))
        .child(button(`ph-d-${pane}`, "↓", "Split down", "pane.split", { direction: "down", pane }))
        .when(movable, (el) => el.child(button(`ph-t-${pane}`, "T", "Move to a new tab", toTab)))
        .child(button(`ph-z-${pane}`, "Z", p.zoomed ? "Unzoom" : "Zoom", "pane.zoom", { pane }))
        .child(button(`ph-x-${pane}`, "×", "Close pane", "pane.close", { pane }))));
  }
}
