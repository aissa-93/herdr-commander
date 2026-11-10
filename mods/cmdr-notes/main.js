// Notes for the shown tab: what you asked its agent, what's left. One markdown
// file per tab in ~/.config/herdr-app/notes/, saved as you type.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { focused, spaces, theme, settings, appHome, readTextFile, writeTextFile } from "herdr";

const pathOf = (tab) => `${appHome()}/notes/${tab.replace(/[^A-Za-z0-9_-]/g, "_")}.md`;

export default class Notes extends View {
  init(_props, cx) {
    this.tab = null;      // the tab whose notes are in the editor
    this.disk = null;     // what the file held when last read or written (null: no file)
    this.loading = false; // set_value fires "change"; that isn't the person typing
    this.dirty = false;
    this.state = EditorState.new({ language: "markdown", value: "", line_numbers: false, folding: false, soft_wrap: true,
      font_family: settings().font_family, font_size: 13 });
    this.state.on("change", (_e, cx) => {
      if (this.loading) return;
      this.dirty = true;
      // One write per pause in typing, not per key.
      const stamp = (this.stamp = (this.stamp ?? 0) + 1);
      cx.timer.after(700, (cx) => { if (stamp === this.stamp) cx.spawn(async () => this.save()); });
    });
    // Follow the shown tab. Cheap: nothing redraws unless it changed.
    cx.timer.every(400, (cx) => {
      const tab = focused()?.tab ?? null;
      if (tab !== this.tab && !this.switching) cx.spawn(async (cx) => this.open(tab, cx));
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
    const f = focused();
    const space = spaces().find((s) => s.id === f?.space);
    const tab = space?.tabs.find((x) => x.id === this.tab);
    const name = tab ? (/^tb\d+$/.test(tab.name) ? `Tab ${space.tabs.indexOf(tab) + 1}` : tab.name) : "";
    return v_flex().size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .child(h_flex().h(34).px(12).gap(8).flex_none().items_center().border_b(1).border_color(t.border).text_size(12)
        .child(svg("mods/cmdr-notes/notes.svg").size(14).text_color(t.muted))
        .child(div().text_color(t.muted).child("Notes"))
        .when(Boolean(name), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${space?.name ?? ""} / ${name}`))))
      .child(this.tab
        ? Editor.new(this.state).flex_1().min_h(0).px(8).pt(6)
        : div().p(12).text_size(12).text_color(t.dim).child("No tab shown."))
      .child(div().h(22).px(12).flex_none().flex().items_center().text_size(10.5).text_color(t.dim)
        .child(this.dirty ? "editing…" : this.disk == null ? "Empty: type to start notes for this tab" : "saved"));
  }
}
