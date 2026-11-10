// Quick reply: an agent's last screen and a line to answer it, without leaving
// the pane you're in. props: { terminal, label? }. Opened by cmdr-tree.
// Enter sends the line; when the agent is blocked, the key buttons answer its
// prompt (1 / 2 / 3, Enter, Esc). "Open" goes to the agent's pane.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, run, props, closeOverlay, theme, hc } from "herdr";

const LINES = 22;
// Strip trailing blank lines and the agent's own input-box chrome at the bottom
// is kept: it shows what's already typed there.
function tail(text) {
  const lines = (text ?? "").replace(/\s+$/, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  return lines.slice(-LINES);
}

export default class Reply extends View {
  init(_props, cx) {
    this.lines = [];
    this.text = "";
    this.note = null;
    this.input = InputState.new({ placeholder: "Reply, then Enter" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.send(cx));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.handle = cx.focus_handle();
    this.refresh(cx);
    // The screen while the popup is open: it closes in seconds, so 1.5s is cheap.
    cx.timer.every(1500, (cx) => this.refresh(cx));
  }

  get address() { return props()?.terminal; }

  agent() {
    return agents().find((a) => a.address === this.address)
      ?? terminals().find((t) => t.address === this.address);
  }

  refresh(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", this.address, "--lines", "0"]);
        const lines = tail(r.stdout);
        if (lines.join("\n") !== this.lines.join("\n")) { this.lines = lines; cx.notify(); }
      } catch (e) {
        this.note = `Couldn't read the screen: ${e?.message ?? e}`;
        cx.notify();
      } finally {
        this.reading = false;
      }
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  // A blocked agent is waiting on a decision; the person typing here is making it,
  // so the send goes through (--force) instead of being refused.
  send(cx) {
    const text = this.text.trim();
    if (!text) return;
    const blocked = this.agent()?.status === "blocked";
    cx.spawn(async (cx) => {
      const r = await hc(["send", ...(blocked ? ["--force"] : []), this.address, text]);
      if (r.code === 0) return this.dismiss();
      this.note = (r.stderr || r.stdout || "Send failed").trim().split("\n")[0];
      cx.notify();
    });
  }

  keys(names, cx) {
    cx.spawn(async (cx) => {
      const r = await hc(["keys", this.address, ...names]);
      if (r.code !== 0) this.note = (r.stderr || "Key failed").trim().split("\n")[0];
      this.refresh(cx);
      cx.notify();
    });
  }

  open() {
    const a = this.agent();
    if (a?.pane) run("pane.focus", { pane: a.pane });
    else run("terminal.peek", { terminal: this.address });
    this.dismiss();
  }

  onKey(e, cx) {
    if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); }
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const a = this.agent();
    const status = a?.status ?? "unknown";
    const blocked = status === "blocked";
    const prog = a?.program;
    const pic = prog?.icon ? (prog.tint ? svg(prog.icon).size(16).text_color(t.foreground) : image(prog.icon).size(16)) : null;
    const machine = this.address?.includes("/") ? this.address.split("/")[0] : null;

    const btn = (id, label, primary, action, tip) => h_flex().id(id).h(28).px(10).items_center().flex_none()
      .rounded(0).border(1).border_color(primary ? t.accent : t.input).bg(primary ? t.accent + "22" : t.raised)
      .text_size(12).text_color(primary ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => action(cx)).child(label);

    return v_flex().id("reply").track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      // Title: who, where, what state.
      .child(h_flex().h(40).px(14).gap(9).flex_none().items_center().border_b(1).border_color(t.border)
        .when(Boolean(pic), (el) => el.child(pic))
        .child(div().text_size(13).font_semibold().child(prog?.name ?? "Agent"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim)
          .child(`· ${p.label ?? a?.space_name ?? this.address}${machine ? `  @${machine}` : ""}`))
        .child(div().px(6).h(18).flex().items_center().text_size(10.5).font_semibold()
          .bg((t[status] ?? t.dim) + "26").text_color(t[status] ?? t.dim)
          .child(blocked ? "Needs you" : status))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      // Its screen, last lines.
      .child(v_flex().id("reply-screen").flex_1().min_h(0).px(14).py(10).bg(t.background).overflow_hidden()
        .text_size(11.5).text_color(t.muted).justify_end()
        .children(this.lines.map((l, i) => div().id(`ln-${i}`).h(15).whitespace_nowrap().overflow_hidden().child(l || " "))))
      // Answer.
      .child(v_flex().px(14).py(10).gap(8).flex_none().border_t(1).border_color(t.border)
        .when(blocked, (el) => el.child(h_flex().gap(6).items_center()
          .child(div().text_size(11).text_color(t.dim).mr(4).child("Answer"))
          .child(btn("k1", "1", true, (cx) => this.keys(["1"], cx), "Press 1 (usually: Yes)"))
          .child(btn("k2", "2", false, (cx) => this.keys(["2"], cx), "Press 2"))
          .child(btn("k3", "3", false, (cx) => this.keys(["3"], cx), "Press 3"))
          .child(btn("kenter", "Enter", false, (cx) => this.keys(["enter"], cx), "Press Enter"))
          .child(btn("kesc", "Esc", false, (cx) => this.keys(["esc"], cx), "Press Esc in the agent (usually: No)"))))
        .child(h_flex().gap(8).items_center()
          .child(Input.new(this.input).flex_1().h(32).px(10).rounded(0).border(1).border_color(t.accent)
            .bg(t.background).text_size(12.5).text_color(t.foreground))
          .child(btn("send", "Send", true, (cx) => this.send(cx), "Type it into the agent and press Enter"))
          .child(btn("open", "Open", false, () => this.open(), "Go to this agent")))
        .when(Boolean(this.note), (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.note))));
  }
}
