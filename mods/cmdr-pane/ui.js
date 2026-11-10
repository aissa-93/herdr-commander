// Commander's shared look. The same file lives in each cmdr-* mod (mods can't
// import across folders): change one, copy it to the others.
//
// The pixel font is sharp only at its native 16 device pixels (or a whole
// multiple of it), so nothing here is sized in plain px: everything is counted
// in `u`, half a character cell, a whole number of device pixels whatever the zoom
// is. View > Bigger text adds 2 device pixels a step (shared "commander.bump"):
// boxes and lines stay on whole pixels, the letters themselves get a little softer.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { settings, shared, keys } from "herdr";

export function grid() {
  // The screen's scale isn't something a mod can ask for; cmdr-menubar finds it.
  const scale = Number(shared("commander.scale")) || 1.6;
  const zoom = Number(settings()?.zoom) || 1;
  // As near to an 11px label as a whole multiple of the font allows.
  const k = Math.max(1, Math.round((11 * scale * zoom) / 16));
  const size = 16 * k + bump();
  const u = size / 2 / (scale * zoom);
  return { u, text: 2 * u, row: 4 * u, px: 1 / (scale * zoom), zoom, size };
}

// Extra device pixels on the text: even, so half a cell stays a whole pixel.
export const BUMP_MAX = 16;
export function bump() {
  const b = Math.round((Number(shared("commander.bump")) || 0) / 2) * 2;
  return Math.min(BUMP_MAX, Math.max(0, b));
}

// Between two "#rrggbb" colors: r = 0 is a, 1 is b.
export function mix(a, b, r) {
  const rgb = (c) => (/^#[0-9a-f]{6}/i.test(c ?? "") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a;
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * r).toString(16).padStart(2, "0")).join("");
}

// A "#rrggbb" color let through at `alpha` ("66").
export const faded = (c, alpha) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + alpha : c);

// The soft hues projects are told apart by: made from the theme's own colors, so they
// follow it, and kept off the ones that mean something (red, amber and green are the
// agents' states, blue is the selection, cyan is a git branch).
export function palette(t) {
  return [t.ansi5, mix(t.ansi2, t.ansi3, 0.5), mix(t.ansi1, t.ansi5, 0.5), mix(t.ansi4, t.ansi5, 0.5), mix(t.ansi3, t.ansi5, 0.5)];
}

// A program's icon from the app's table (programs.json), one cell tall: a one-color
// glyph in `color`, or its picture. Null when it has none.
export function icon(p, g, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(2 * g.u).flex_none().text_color(color) : image(p.icon).w(2 * g.u).h(2 * g.u).flex_none();
}

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// One mark per agent state, each its own shape so it reads without color:
// blocked an inverse "!!", done a block, working a shimmer, idle a quiet dot.
// `ink`: on a selected (inverse) row, everything takes the row's ink.
// `quiet`: the idle dot's color (a project's hue), else the theme's dim.
export function mark(t, g, status, ink = null, quiet = null) {
  const box = div().w(2 * g.u).h(2 * g.u).flex_none().flex().items_center().justify_center();
  if (status === "blocked") return ink ? box.text_color(ink).child("‼") : box.bg(t.blocked).text_color(t.accent_foreground).child("‼");
  if (status === "working") return box.text_color(ink ?? t.working).frames(["░", "▒", "▓", "▒"], 280);
  if (status === "done") return box.text_color(ink ?? t.done).child("■");
  if (status === "idle") return box.text_color(ink ?? quiet ?? t.dim).child("•");
  return box;
}

export const hairline = (t, g) => div().h(g.px).flex_1().bg(t.border);

// A panel whose title sits in its top border, like a TUI window.
// `title` / `right`: elements set into the border (they need their own background
// to cover the line). `fill`: take the whole block instead of the content's height.
export function frame(t, g, { title, right = null, color = null, fill = true }, body) {
  const edge = color ?? t.border;
  return div().relative().w_full().when(fill, (el) => el.h_full())
    .child(div().absolute().left(0).right(0).top(g.u).bottom(0).border(g.px).border_color(edge))
    .child(v_flex().w_full().when(fill, (el) => el.h_full().min_h(0))
      .child(h_flex().h(2 * g.u).flex_none().px(2 * g.u).items_center()
        .child(title)
        .child(div().flex_1())
        .when(Boolean(right), (el) => el.child(right)))
      .child(v_flex().w_full().when(fill, (el) => el.flex_1().min_h(0)).px(g.px).pb(g.px).child(body)));
}

// The plain title of a frame: text on the color behind the panel.
export const tag = (t, g, text, bg, ink) => div().flex_none().px(g.u).h(2 * g.u).bg(bg).text_color(ink).child(text);

// The key a command is bound to, as the person presses it ("Ctrl+Shift+T"), or null.
// `actions`: the action as keys.json spells it ("pane.split:right"), or several.
export function chord(actions) {
  const want = [].concat(actions);
  const list = keys();
  for (const section of [`layout:${shared("layout")}`, "global", "terminal"]) {
    const b = list.find((k) => k.section === section && want.includes(k.action));
    if (b) return b.keys;
  }
  return null;
}

const NAMES = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", cmd: "Cmd", option: "Alt", super: "Super", pagedown: "PgDn", pageup: "PgUp", escape: "Esc", enter: "Enter", tab: "Tab", up: "Up", down: "Down", left: "Left", right: "Right", space: "Space", backspace: "Bksp", delete: "Del", insert: "Ins" };

export function chordParts(ks) {
  if (!ks) return [];
  const parts = ks.endsWith("--") ? [...ks.slice(0, -2).split("-"), "-"] : ks.split("-");
  return parts.map((p) => NAMES[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)));
}

export const pretty = (ks) => chordParts(ks).join("+");
