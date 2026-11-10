// Commander's key bar: the shortcuts worth knowing, read from keys.json so the bar
// never lies. Most share one prefix (Ctrl+Shift+), shown once on the left; each cell
// is then the last key and what it does. A command with no binding isn't shown.
// Click a cell to run it.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, shared } from "herdr";
import { grid, chord, chordParts } from "./ui.js";

// [label, the action as keys.json spells it, the command, its arguments]
const CELLS = [
  ["New tab", "tab.new", "tab.new"],
  ["Split →", "pane.split:right", "pane.split", { direction: "right" }],
  ["Split ↓", "pane.split:down", "pane.split", { direction: "down" }],
  ["Zoom", "pane.zoom", "pane.zoom"],
  ["Close pane", "pane.close", "pane.close"],
  ["Reply", "cmdr-tree.reply", "cmdr-tree.reply"],
  ["Crew", "cmdr-tree.crew", "cmdr-tree.crew"],
  ["Go to", "mod.open:picker", "mod.open", { name: "picker" }],
  ["Commands", "app.palette", "app.palette"],
  ["Sidebar", "layout.toggle:sidebar", "layout.toggle", { id: "sidebar" }],
  ["Layout", "layout.switch", "layout.switch"],
];

export default class Keys extends View {
  render() {
    const t = theme();
    const G = grid();
    const bound = CELLS.filter(([, action]) => action !== "cmdr-tree.crew" || shared("commander.crew")).map(([label, action, name, args]) => ({ label, name, args, parts: chordParts(chord(action)) })).filter((c) => c.parts.length);
    // The prefix most cells share goes on the left, once.
    const tally = {};
    for (const c of bound) { const p = c.parts.slice(0, -1).join("+"); tally[p] = (tally[p] ?? 0) + 1; }
    const prefix = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    const cell = (c, i) => {
      const own = c.parts.slice(0, -1).join("+");
      const key = own === prefix ? c.parts.at(-1) : c.parts.join("+");
      return h_flex().id(`key-${i}`).flex_1().min_w(0).h(3 * G.u).gap(G.u).items_center().cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click(() => run(c.name, c.args ?? {}))
        .child(div().flex_none().text_color(t.accent).child(key))
        .child(div().flex_1().min_w(0).h_full().px(G.u).flex().items_center().bg(t.raised).text_color(t.foreground)
          .child(div().truncate().child(c.label)));
    };
    return h_flex().size_full().px(G.u).gap(G.u).items_center().bg(t.chrome).border_t(G.px).border_color(t.border)
      .text_size(G.text).line_height(`${G.text}px`).text_color(t.muted)
      .when(Boolean(prefix), (el) => el.child(div().flex_none().child(`${prefix}+`)))
      .children(bound.map(cell));
  }
}
