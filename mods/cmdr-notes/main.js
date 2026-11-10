// Notes for the shown space: what it's for, what you asked its agents, what's left.
// One markdown file per space in ~/.config/herdr-app/notes/, saved as you type
// (herdr-todo's hook points the space's agents at it, to read).
//
// It looks like the to-do panel beside it: on the canvas, in a frame whose top border
// names the panel's views. A * after "Notes" means what you typed isn't saved yet.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { focused, spaces, theme, settings, shared, appHome, readTextFile, writeTextFile } from "herdr";
import { grid, frame, tag, views } from "./ui.js";

const pathOf = (space) => `${appHome()}/notes/${space.replace(/[^A-Za-z0-9_-]/g, "_")}.md`;

export default class Notes extends View {
  init(_props, cx) {
    this.tab = null;      // the space whose notes are in the editor
    this.disk = null;     // what the file held when last read or written (null: no file)
    this.loading = false; // set_value fires "change"; that isn't the person typing
    this.dirty = false;
    this.drafts = JSON.parse(localStorage.getItem("drafts") ?? "{}");
    this.problem = null;
    this.conflict = undefined;
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
      this.remember();
      cx.notify();
      // One write per pause in typing, not per key.
      const stamp = (this.stamp = (this.stamp ?? 0) + 1);
      cx.timer.after(700, (cx) => { if (stamp === this.stamp) cx.spawn(async (cx) => { await this.save(); cx.notify(); }); });
    });
  }

  // Keep unsaved text across space switches, reloads and failed writes. Each
  // draft retains its original disk snapshot: restoring it never grants permission
  // to overwrite a file changed by another editor.
  remember() {
    if (!this.tab) return;
    if (this.dirty) this.drafts[this.tab] = { text: this.state.value(), disk: this.disk };
    else delete this.drafts[this.tab];
    localStorage.setItem("drafts", JSON.stringify(this.drafts));
  }

  async save() {
    if (this.saving) return this.saving;
    this.saving = this.flush();
    try { await this.saving; }
    finally { this.saving = null; }
  }

  async flush() {
    while (this.dirty && this.tab && !this.problem) {
      const tab = this.tab, text = this.state.value(), expected = this.disk;
      try {
        await writeTextFile(pathOf(tab), text, expected);
      } catch (e) {
        this.problem = `Couldn't save: ${e?.message ?? e}`;
        try {
          const disk = await readTextFile(pathOf(tab));
          if (disk !== expected) {
            this.conflict = disk;
            this.problem = "This file changed elsewhere. Choose which version to keep.";
          }
        } catch {}
        this.remember();
        return;
      }
      this.disk = text;
      // A completed write acknowledges only the text it actually wrote. Drain
      // later typing in the same writer, including before a space switch.
      this.dirty = this.state.value() !== text;
      this.remember();
    }
  }

  async open(tab, cx) {
    if (this.resolving || this.switching) return;
    this.switching = true;
    try {
      // Read the next file before releasing the old editor. Typing while this
      // read is pending still belongs to the old space and is saved below.
      const disk = tab ? await readTextFile(pathOf(tab)) : null;
      await this.save();
      this.remember();
      this.tab = tab;
      const draft = this.drafts[tab];
      this.dirty = Boolean(draft) && draft.text !== (disk ?? "");
      this.disk = this.dirty ? draft.disk : disk;
      this.conflict = this.dirty && draft.disk !== disk ? disk : undefined;
      this.problem = this.conflict !== undefined ? "This file changed elsewhere. Choose which version to keep." : null;
      this.loading = true;
      this.state.set_value(this.dirty ? draft.text : disk ?? "");
      this.loading = false;
      this.remember();
    } catch (e) {
      this.problem = `Couldn't open notes: ${e?.message ?? e}`;
    } finally {
      this.switching = false;
    }
    cx.notify();
  }

  async resolve(useFile, cx) {
    if (this.resolving || this.switching) return;
    this.resolving = true;
    const stamp = this.stamp;
    try {
      await this.save();
      if (useFile) {
        const disk = await readTextFile(pathOf(this.tab));
        if (stamp !== this.stamp) {
          this.conflict = disk;
          this.problem = "Your draft changed while the file was loading. Choose again.";
          this.remember();
          return;
        }
        this.loading = true;
        this.state.set_value(disk ?? "");
        this.loading = false;
        this.disk = disk;
        this.dirty = false;
      } else if (this.conflict !== undefined) {
        // Accept only the version shown in the conflict. A subsequent external
        // change still fails the atomic write and presents another conflict.
        this.disk = this.conflict;
      }
      this.problem = null;
      this.conflict = undefined;
      this.remember();
      await this.save();
    } finally {
      this.resolving = false;
      cx.notify();
    }
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
    const action = (id, label, useFile) => div().id(id).px(G.u).py(G.u / 2).bg(t.raised).cursor_pointer()
      .hover((el) => el.bg(t.hover)).on_click((_e, cx) => cx.spawn(async (cx) => {
        try { await this.resolve(useFile, cx); }
        catch (e) { this.problem = `Couldn't resolve notes: ${e?.message ?? e}`; cx.notify(); }
      })).child(label);
    const body = v_flex().size_full().min_h(0)
      .when(Boolean(this.problem), (el) => el.child(v_flex().flex_none().p(G.u).gap(G.u)
        .child(div().whitespace_normal().text_color(t.blocked).child(`${this.problem} Your unsaved draft is kept.`))
        .child(h_flex().gap(G.u)
          .child(action("notes-retry", this.conflict !== undefined ? "Save my draft" : "Retry", false))
          .when(this.conflict !== undefined, (row) => row.child(action("notes-use-file", "Use file", true))))))
      .child(this.tab ? Editor.new(this.state).flex_1().min_h(0).px(G.u).pt(G.u) : hint("No space shown."))
      .when(Boolean(this.tab) && this.disk == null && !this.dirty, (el) => el.child(hint(`Nothing noted for ${name || "this space"} yet. Click above and type.`)));
    return div().size_full().bg(t.canvas).text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .child(frame(t, G, { title, right: which }, body));
  }
}
