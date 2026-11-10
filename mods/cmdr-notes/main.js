// Notes for the shown space: what it's for, what you asked its agents, what's left.
// One markdown file per space in ~/.config/herdr-app/notes/, saved as you type
// (herdr-todo's hook points the space's agents at it, to read).
//
// It looks like the to-do panel beside it: on the canvas, in a frame whose top border
// names the panel's views. A * after "Notes" means what you typed isn't saved yet.
import { View, div } from "gpui-kit";
import { v_flex, Editor, EditorState } from "gpui-base";
import { focused, spaces, theme, settings, shared, appHome, readTextFile, writeTextFile } from "herdr";
import { grid, frame, tag, views } from "./ui.js";

const pathOf = (space) => `${appHome()}/notes/${space.replace(/[^A-Za-z0-9_-]/g, "_")}.md`;

export default class Notes extends View {
  init(_props, cx) {
    this.tab = null;      // the space whose notes are in the editor
    this.disk = null;     // what the file held when last read or written (null: no file)
    this.loading = false; // set_value fires "change"; that isn't the person typing
    this.dirty = false;
    this.editor("");
    // Follow the shown space. Cheap: nothing redraws unless it changed.
    cx.timer.every(400, (cx) => {
      // An editor's text size is set when it's made: a new one when Commander's changes.
      if (grid().text !== this.size && !this.switching) { this.editor(this.state.value()); cx.notify(); }
      const tab = focused()?.space ?? null;
      if (tab !== this.tab && !this.switching) cx.spawn(async (cx) => this.open(tab, cx));
    });
  }

  editor(value) {
    this.state?.release();
    this.size = grid().text;
    this.state = EditorState.new({ language: "markdown", value, line_numbers: false, folding: false, soft_wrap: true,
      font_family: settings().font_family, font_size: this.size });
    this.state.on("change", (_e, cx) => {
      if (this.loading) return;
      this.dirty = true;
      cx.notify();
      // One write per pause in typing, not per key.
      const stamp = (this.stamp = (this.stamp ?? 0) + 1);
      cx.timer.after(700, (cx) => { if (stamp === this.stamp) cx.spawn(async (cx) => { await this.save(); cx.notify(); }); });
    });
  }

  async save() {
    if (!this.dirty || !this.tab) return;
    const text = this.state.value();
    try {
      await writeTextFile(pathOf(this.tab), text, this.disk);
      this.disk = text;
      this.dirty = false;
    } catch (e) {
      // Changed elsewhere since we read it: take what's there, then write ours over it.
      this.disk = await readTextFile(pathOf(this.tab));
      await writeTextFile(pathOf(this.tab), text, this.disk);
      this.disk = text;
      this.dirty = false;
    }
  }

  async open(tab, cx) {
    this.switching = true;
    try {
      await this.save();
      this.tab = tab;
      this.disk = tab ? await readTextFile(pathOf(tab)) : null;
      this.loading = true;
      this.state.set_value(this.disk ?? "");
      this.loading = false;
      this.dirty = false;
    } finally {
      this.switching = false;
    }
    cx.notify();
  }

  async close() {
    await this.save();
  }

  render() {
    const t = theme();
    const G = grid();
    const space = spaces().find((s) => s.id === this.tab);
    const name = space ? shared("space.labels")?.[space.id] ?? space.name : "";
    // What isn't done in this space's to-do list (cmdr-todo publishes the counts).
    const open = (space && shared("commander.todo")?.[space.id]) || 0;
    const title = views(t, G, "notes", { todo: open ? [String(open), t.dim] : null, notes: this.dirty ? ["*", t.working] : null });
    const which = name ? tag(t, G, name, t.canvas, t.muted).max_w(36 * G.u).truncate() : null;
    const hint = (text) => div().flex_none().px(2 * G.u).py(G.u).line_height(`${3 * G.u}px`).whitespace_normal().text_color(t.dim).child(text);
    const body = v_flex().size_full().min_h(0)
      .child(this.tab ? Editor.new(this.state).flex_1().min_h(0).px(G.u).pt(G.u) : hint("No space shown."))
      .when(Boolean(this.tab) && this.disk == null && !this.dirty, (el) => el.child(hint(`Nothing noted for ${name || "this space"} yet. Click above and type.`)));
    return div().size_full().bg(t.canvas).text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .child(frame(t, G, { title, right: which }, body));
  }
}
