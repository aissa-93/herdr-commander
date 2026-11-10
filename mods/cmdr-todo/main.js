// Commander's to-do panel: the list of the space you're in. Every space has its own,
// and the agents working in it share it: they add the steps of what they're doing,
// mark the one they're on and tick lines off, so the panel shows all the work in the
// space, yours and theirs.
//
// A list is a markdown file on the space's machine, ~/.herdr/todos/<space id>.md:
//   - [ ] still to do      - [/] being worked on      - [x] done
// Nothing here writes that file itself: every change goes through herdr-todo.py, beside
// this file (also on PATH as `herdr-todo`, which is what agents run; their hooks call
// `herdr-todo hook`, which tells a session about the list). On another machine the same
// script is run there (python3 -c), so nothing has to be installed for the panel.
//
// Click the box to tick a line off (again: back to open), double-click its text to
// change it, ► to hand it over: typed into the agent in front, or the first message
// of a new agent in a new tab of the space. A line someone is working on shows that
// agent's state; click it to go there. With props { menu }, this mod is the ► menu.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, agents, terminals, run, exec, hc, openOverlay, closeOverlay, props, theme, shared, setShared, appHome, home, readTextFile, watchFolder, knownAgents, notify, window } from "herdr";
import { grid, mark, icon, frame, tag, views, lifted } from "./ui.js";

const script = () => `${appHome()}/mods/cmdr-todo/herdr-todo.py`;
const folder = () => `${home().replace(/\/+$/, "")}/.herdr/todos`;
// Ids of things on another machine carry its name in front here, not there.
const bare = (id) => (id ?? "").split("/").pop();
const short = (text) => (text.length > 36 ? `${text.slice(0, 35)}…` : text);
const nameOf = (s) => shared("space.labels")?.[s.id] ?? s.name;
const pending = (list) => list.filter((e) => e.state !== "done").length;
// Said with a line that is handed over, so an agent whose hooks don't tell it knows the list.
const NOTE = "(From this Herdr space's shared to-do list, where it is now marked as yours. `herdr-todo` shows the list: run `herdr-todo done <its number>` when it is finished, and `herdr-todo add \"...\"` for further steps or follow-ups.)";

// Runs herdr-todo for a space, where the space is. Returns { items, said } or { error, items }.
let source = null;
async function ask(space, args) {
  const base = ["--space", bare(space.id), "--name", nameOf(space), "--json", ...args];
  let r;
  if (space.machine) {
    source ??= await readTextFile(script());
    r = await exec("python3", ["-c", source, ...base], { on: space.machine, timeout: 20000 });
  } else r = await exec("python3", [script(), ...base], { timeout: 20000 });
  try { return JSON.parse(r.stdout); } catch { throw new Error(r.stderr.trim().split("\n").pop() || "herdr-todo gave no answer"); }
}

export default class Todo extends View {
  init(_props, cx) {
    if (props()?.menu) return this.menuInit(cx);
    this.space = null; // the space whose list is in `items`
    this.items = [];
    this.hovered = null;
    this.editing = null; // { id, text } for the line the field is changing
    this.text = "";
    this.input = InputState.new({ placeholder: "Add a to-do, then Enter" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    // Follow the files on this computer: an agent's change, the ► menu's.
    cx.spawn(async (cx) => {
      try { await exec("mkdir", ["-p", folder()]); } catch {}
      await this.count(spaces().filter((s) => !s.machine).map((s) => s.id));
      try {
        for (;;) {
          const paths = await watchFolder(folder());
          // The folder itself: too much changed to say what; anything but a list: not ours.
          const all = paths.some((p) => p.replace(/\/+$/, "") === folder());
          const ids = all ? spaces().filter((s) => !s.machine).map((s) => s.id) : paths.map((p) => /\/([A-Za-z0-9_-]+)\.md$/.exec(p)?.[1]).filter(Boolean);
          if (!ids.length) continue;
          const here = this.current();
          if (here && !here.machine && ids.includes(here.id)) await this.read(here);
          await this.count(ids.filter((id) => id !== here?.id));
          cx.notify();
        }
      } catch {}
    });
    // A list on another machine can't be watched: looked at while it's the one shown.
    cx.timer.every(5000, (cx) => {
      const here = this.current();
      if (here?.machine && window().active) cx.spawn(async (cx) => { await this.read(here); cx.notify(); });
    });
    // The shown list follows the shown space.
    cx.timer.every(300, (cx) => this.follow(cx));
    this.follow(cx);
  }

  current() {
    return spaces().find((s) => s.active) ?? null;
  }

  follow(cx) {
    const here = this.current();
    if (!here || here.id === this.space || this.opening) return;
    this.opening = true;
    cx.spawn(async (cx) => {
      await this.read(here, true);
      this.editing = null;
      this.opening = false;
      cx.notify();
    });
  }

  // `fresh`: the space just came into view; an unreadable list then shows empty, not the last one.
  async read(space, fresh = false) {
    try {
      const out = await ask(space, ["json"]);
      this.took(space, out.items ?? []);
    } catch {
      if (fresh) this.took(space, []);
    }
  }

  took(space, items) {
    this.space = space.id;
    this.items = items;
    this.publish({ [space.id]: pending(items) });
  }

  // How many lines aren't done in each space, for the tab strip's button: the ones
  // this panel has read, and this computer's other lists straight from their files.
  async count(ids) {
    const found = {};
    for (const id of ids) {
      try { found[id] = ((await readTextFile(`${folder()}/${id}.md`)) ?? "").split("\n").filter((l) => /^\s*[-*] \[[ /]\] /.test(l)).length; } catch {}
    }
    this.publish(found);
  }

  publish(found) {
    const live = new Set(spaces().map((s) => s.id));
    const was = shared("commander.todo") ?? {};
    const now = {};
    for (const [id, n] of Object.entries({ ...was, ...found })) if (live.has(id) && n > 0) now[id] = n;
    if (JSON.stringify(now) !== JSON.stringify(was)) setShared("commander.todo", now);
  }

  // One change to the shown list.
  act(cx, args) {
    const space = this.current();
    if (!space) return;
    cx.spawn(async (cx) => {
      try {
        const out = await ask(space, args);
        if (out.error) notify({ title: "To-do", body: out.error, level: "warning" });
        this.took(space, out.items ?? []);
      } catch (err) {
        notify({ title: "To-do", body: String(err?.message ?? err).slice(0, 160), level: "error" });
      }
      cx.notify();
    });
  }

  submit(cx) {
    const text = this.text.trim().replace(/\s+/g, " ");
    const editing = this.editing;
    this.editing = null;
    this.text = "";
    this.input.set_value("");
    if (!text) return cx.notify();
    this.act(cx, editing ? ["edit", "--id", editing.id, text] : ["add", text]);
  }

  edit(e, cx) {
    this.editing = { id: e.id, text: e.text };
    this.text = e.text;
    this.input.set_value(e.text);
    this.input.focus();
    cx.notify();
  }

  render() {
    const t = theme();
    if (props()?.menu) return this.renderMenu(t);
    const G = grid();
    const space = this.current();
    const mine = Boolean(space) && space.id === this.space;
    const all = mine ? this.items.map((e, i) => ({ e, i })) : [];
    const todo = all.filter((x) => x.e.state !== "done"), done = all.filter((x) => x.e.state === "done");
    // The agents of this space, by the address they have on its machine.
    const live = new Map(agents().filter((a) => a.space === space?.id).map((a) => [bare(a.address), a]));
    // Every terminal running on the space's machine: a line whose agent isn't one of them was left behind.
    const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);
    const running = new Set(terminals().filter((x) => machineOf(x.address ?? "") === (space?.machine ?? null) && (x.state ?? "live") === "live").map((x) => bare(x.address)));
    const swallow = (_e, cx) => cx.stop_propagation();
    const cell = 3 * G.u;
    const button = (id, label, tip, action, color) => div().id(id).w(cell).h(cell).flex_none().flex().items_center().justify_center().cursor_pointer()
      .text_color(color ?? t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", swallow).on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(label);

    const row = ({ e, i }) => {
      const hot = this.hovered === i;
      const started = e.state === "started";
      const a = started && e.agent ? live.get(e.agent) ?? null : null;
      const left = started && Boolean(e.agent) && running.size > 0 && !running.has(e.agent);
      const isDone = e.state === "done";
      return h_flex().id(`todo-${i}`).w_full().min_h(G.row).flex_none().pl(2 * G.u).pr(G.u).py(G.u / 2).gap(G.u).items_start()
        .when(this.editing?.id === e.id, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .on_hover((over, cx) => {
          if (over) this.hovered = i;
          else if (this.hovered === i) this.hovered = null;
          cx.notify();
        })
        .child(div().id(`box-${i}`).h(cell).flex_none().flex().items_center().cursor_pointer()
          .text_color(isDone ? t.dim : started && !left ? t.accent : t.muted).hover((s) => s.text_color(t.foreground))
          .tooltip(isDone ? "Done. Click to open it again."
            : left ? `Agent ${e.agent} was on it and is gone. Click if it's done, or hand it over again with ►.`
            : started ? `${e.agent ? `Agent ${e.agent} is` : "Someone is"} working on it. Click when it's done.` : "Click when it's done")
          .on_click((_e, cx) => this.act(cx, [isDone ? "reopen" : "done", "--id", e.id]))
          .child(isDone ? "[x]" : left ? "[?]" : started ? "[►]" : "[ ]"))
        .when(Boolean(a), (el) => el.child(h_flex().id(`agent-${i}`).h(cell).flex_none().gap(G.u).items_center().cursor_pointer()
          .tooltip(`${a.program?.name ?? "Its agent"} is ${a.status}. Click to go to it.`)
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(mark(t, G, a.status))
          .when(Boolean(icon(a.program, G, t.foreground)), (x) => x.child(icon(a.program, G, t.foreground)))))
        .child(div().id(`text-${i}`).flex_1().min_w(0).whitespace_normal().line_height(`${cell}px`)
          .text_color(isDone ? t.dim : t.foreground).when(isDone, (el) => el.line_through())
          .on_mouse_down("left", (ev, cx) => { if (ev.click_count === 2) this.edit(e, cx); })
          .child(e.text))
        // Always there, so the text doesn't wrap differently under the pointer.
        .child(h_flex().w(2 * cell).h(cell).flex_none().justify_end()
          .when(hot && (e.state === "open" || left), (el) => el.child(button(`hand-${i}`, "►", "Hand it to an agent", () => this.hand(space, e, G), t.accent)))
          .when(hot, (el) => el.child(button(`drop-${i}`, "×", "Delete this line", (cx) => this.act(cx, ["rm", "--id", e.id])))));
    };

    const title = views(t, G, "todo", { todo: todo.length ? [String(todo.length), t.muted] : null });
    const which = space ? tag(t, G, nameOf(space), t.canvas, t.muted).id("which").max_w(36 * G.u).truncate()
      .tooltip("This space's list. The agents working here see it and keep it up to date.") : null;
    const body = v_flex().size_full().min_h(0)
      // A prompt line, like the agents' own: no box, a rule under it from edge to edge.
      .child(h_flex().flex_none().h(G.row + G.u).mt(G.u).px(2 * G.u).gap(G.u).items_center()
        .child(div().flex_none().text_color(t.accent).child(">"))
        .child(Input.new(this.input).flex_1().min_w(0).h(G.row).rounded(0).bg(t.canvas).text_size(G.text).text_color(t.foreground))
        .when(Boolean(this.editing), (el) => el.child(div().id("cancel").flex_none().px(G.u).h(cell).flex().items_center().cursor_pointer().text_color(t.muted)
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => { this.editing = null; this.text = ""; this.input.set_value(""); cx.notify(); }).child("cancel"))))
      .child(div().h(G.px).flex_none().bg(this.editing ? t.accent : t.border))
      .child(v_flex().id("todo-list").flex_1().min_h(0).pt(G.u).overflow_y_scrollbar()
        .children(todo.map(row))
        .when(mine && !all.length, (el) => el.child(div().px(2 * G.u).py(G.u).line_height(`${cell}px`).whitespace_normal().text_color(t.muted)
          .child(`Nothing to do in ${nameOf(space)}. Type a line above; the agents working here add theirs. ► on a line hands it to an agent.`)))
        .when(done.length > 0, (el) => el
          .child(h_flex().h(G.row).flex_none().mt(G.u).px(2 * G.u).gap(G.u).items_center().text_color(t.dim)
            .child(div().flex_none().child(`Done ${done.length}`))
            .child(div().h(G.px).flex_1().bg(t.border))
            .child(div().id("clear-done").flex_none().cursor_pointer().hover((s) => s.text_color(t.foreground))
              .tooltip("Take the done lines out of the list")
              .on_click((_e, cx) => this.act(cx, ["clear-done"]))
              .child("clear")))
          .children(done.map(row))));
    // On the canvas, in a frame like the sidebar's: the panel's views are its title.
    return div().size_full().bg(t.canvas).text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .child(frame(t, G, { title, right: which }, body));
  }

  hand(space, e, G) {
    openOverlay({ mod: "cmdr-todo", kind: "popup", frame: "none", at: "pointer", width: 53 * G.u, height: 49 * G.u, props: { menu: { space: space.id, text: e.text, id: e.id } } });
  }

  // ---- the ► menu: who gets this line ----

  menuInit(cx) {
    this.known = null; // the agents that can be started on the space's machine
    this.busy = null; // what it's doing, while it does it (the popup stays until then)
    this.tool = false; // is herdr-todo there for the agent to run
    const space = this.target();
    cx.spawn(async () => {
      try { this.tool = (await exec("sh", ["-c", 'command -v herdr-todo >/dev/null || test -x "$HOME/.local/bin/herdr-todo"'], { on: space?.machine ?? undefined })).code === 0; } catch {}
    });
    cx.spawn(async (cx) => {
      try { this.known = (await knownAgents({ on: space?.machine ?? null })).filter((a) => a.installed).slice(0, 6); } catch { this.known = []; }
      cx.notify();
    });
  }

  target() {
    return spaces().find((s) => s.id === props().menu.space) ?? null;
  }

  // Does the handing over, marks the line as that agent's, then closes. The popup
  // stays meanwhile: closing it would stop this.
  go(cx, says, work) {
    if (this.busy) return;
    this.busy = says;
    cx.notify();
    cx.spawn(async () => {
      const m = props().menu;
      try {
        const got = await work();
        await ask(this.target(), ["start", "--id", m.id, "--agent", bare(got.agent), "--tab", bare(got.tab) || "-"]);
      } catch (err) {
        notify({ title: "Couldn't hand it over", body: String(err?.message ?? err).split("\n")[0].slice(0, 160), level: "error" });
      }
      closeOverlay(props().overlay);
    });
  }

  send(a, cx) {
    const text = props().menu.text;
    this.go(cx, `Typing it into ${a.program?.name ?? "the agent"}…`, async () => {
      const r = await hc(["send", a.address, this.tool ? `${text} ${NOTE}` : text]);
      if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || "hc send failed");
      return { agent: a.address, tab: a.tab };
    });
  }

  start(agent, cx) {
    const text = props().menu.text;
    const space = this.target();
    this.go(cx, `Starting ${agent.name}…`, async () => {
      const r = await exec("herdr-app", ["do", "tab.new", "--space", space.id, "--name", short(text), "--argv", JSON.stringify(agent.run), "--task", this.tool ? `${text}\n\n${NOTE}` : text]);
      let made = null;
      try { made = JSON.parse(r.stdout); } catch {}
      if (r.code !== 0 || !made?.terminal) throw new Error(made?.error ?? (r.stderr.trim() || "The agent didn't start."));
      return { agent: made.terminal, tab: made.tab };
    });
  }

  renderMenu(t) {
    const G = grid();
    const m = props().menu;
    const space = this.target();
    const front = space ? agents().find((a) => a.focused && a.space === space.id) ?? null : null;
    const item = (id, pic, text, action, tip) => h_flex().id(id).h(G.row).px(2 * G.u).gap(G.u).items_center().flex_none()
      .cursor_pointer().hover((s) => s.bg(t.accent).text_color(t.accent_foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => action(cx))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().child(text));
    const head = (text, color) => div().px(2 * G.u).h(G.row).flex().items_center().flex_none().text_color(color ?? t.muted).child(div().w_full().truncate().child(text));
    const rule = () => div().h(G.px).my(G.u).flex_none().bg(t.border);
    const box = (...rows) => lifted(G, v_flex().id("hand-menu").w_full().py(G.u).bg(t.popover).border(G.px).border_color(t.input).text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground).children(rows));
    if (!space) return box(head("That space is gone"));
    if (this.busy) return box(head(m.text, t.foreground), head(this.busy));
    return box(
      head(m.text, t.foreground),
      rule(),
      ...(front ? [
        item("send", icon(front.program, G, t.foreground), `Send to ${front.program?.name ?? "the agent"} in front`, (cx) => this.send(front, cx),
          front.status === "blocked" ? "It is waiting on a question: answer that first" : "Typed into it and sent, as if you had"),
        rule(),
      ] : []),
      head("Start an agent on it, in a new tab"),
      ...(this.known === null ? [head("Looking for agents…")]
        : this.known.length ? this.known.map((a) => item(`start-${a.key}`, icon(a, G, t.foreground), a.name, (cx) => this.start(a, cx)))
        : [head("No agent is installed there.")]),
    );
  }
}
