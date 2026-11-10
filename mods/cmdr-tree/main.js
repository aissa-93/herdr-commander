// Commander's sidebar: every space and what its agents are doing, in one tree, and
// under it the agents waiting on you with the keys to answer them.
//
// Spaces are grouped by machine and project, worktrees under their checkout (all of
// that is retro-projects' doing, kept as it was). A space's row carries its first
// agent: status mark, what it's on, how long since it changed. More agents in the
// space, and sub-agents, hang under it on tree lines. Click a space to switch,
// right-click for its menu, drag to reorder; click an agent to go to it, right-click
// to reply. Keys: cmdr-tree.reply, cmdr-tree.crew, cmdr-tree.project.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, machines, panes, agents, terminals, focused, run, openOverlay, closeOverlay, props, nextCommand, exec, hc, theme, shared, setShared, watchFolder, window, home, appHome, readTextFile, setAgentOrder } from "herdr";
import { projects, fileSpace, addProject, editProject, removeProject, newSession, adopt, filing, RANK } from "./projects.js";
import { grid, mark, duration, frame, tag, hairline, icon, mix, faded, palette } from "./ui.js";

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

// What a tab is about: its name once someone named it, else the agent's own title
// when that says something (not a path, a prompt or the program's name).
function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// What a blocked agent is asking: the last line of its screen that is a question.
function question(text) {
  const lines = (text ?? "").split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
    const l = clean(lines[i]);
    if (l.endsWith("?")) return l;
  }
  return null;
}

export default class Tree extends View {
  init(_props, cx) {
    if (props()?.menu) return this.menuInit(cx);
    this.projectsFolded = new Set(JSON.parse(localStorage.getItem("projects.folded") ?? "[]"));
    this.known = new Set(spaces().map((s) => s.id));
    // Keys: `projects.project` opens the project menu for the focused space's machine.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "project") {
          const w = spaces().find((s) => s.active) ?? spaces()[0];
          this.machineMenu(w?.machine ?? null);
        }
        // Answer the agent that has waited longest (blocked, then done), else the one in front.
        if (c === "reply") this.replyNext();
        if (c === "crew") this.newCrew();
        cx.notify();
      }
    });
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.hovered = null;
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.asked = {}; // agent -> the question on its screen while it's blocked
    cx.timer.every(30000, (cx) => cx.notify());
    cx.timer.every(4000, (cx) => this.readWaiting(cx));
    this.readWaiting(cx);
    cx.spawn(async () => {
      let has = false;
      try { has = (await readTextFile(`${appHome()}/mods/retro-crew/main.js`)) !== null; } catch {}
      if (Boolean(shared("commander.crew")) !== has) setShared("commander.crew", has);
    });
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      // --show-prefix: where this place is inside the repo ("herdr-app/"), so a space in a
      // subfolder of a big repo (~/.config) isn't labelled with just the repo's name.
      const top = await exec("git", ["rev-parse", "--show-toplevel", "--show-prefix"], { cwd, on });
      const [topDir = "", prefix = ""] = top.stdout.split("\n");
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const parts = prefix.trim().split("/").filter(Boolean);
      const sub = parts.length === 0 ? "" : parts.length === 1 ? parts[0] : `\u2026/${parts[parts.length - 1]}`;
      const root = topDir.trim();
      const info = { name, sub, root, lead: parts[0] ?? "", leaf: parts[parts.length - 1] ?? name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${topDir.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // Popups are as tall as their items; height is only the most.
  menu(w) {
    const G = grid();
    openOverlay({ mod: "cmdr-tree", kind: "popup", width: 42 * G.u, height: 62 * G.u, props: { menu: "space", id: w.id } });
  }

  projectMenu(p) {
    const G = grid();
    openOverlay({ mod: "cmdr-tree", kind: "popup", width: 42 * G.u, height: 54 * G.u, props: { menu: "project", id: p.id } });
  }

  machineMenu(m) {
    const G = grid();
    openOverlay({ mod: "cmdr-tree", kind: "popup", width: 42 * G.u, height: 30 * G.u, props: { menu: "machine", machine: m } });
  }

  // ---- agents ----

  reply(a) {
    openOverlay({ mod: "cmdr-reply", kind: "dialog", width: 780, height: 520, props: { terminal: a.address, label: this.labelOf?.(a) } });
  }

  // The crew launcher is a mod of its own (retro-crew), not part of Commander: its
  // menu item and key show only where it's installed (shared "commander.crew").
  newCrew() {
    if (shared("commander.crew")) openOverlay({ mod: "retro-crew", kind: "dialog", modal: true, width: 640, height: 600 });
  }

  // The agents waiting on the person: blocked first, then finished, each longest first.
  waiting(list) {
    const of = (s) => list.filter((a) => a.status === s).sort((x, y) => this.since(x) - this.since(y));
    return [...of("blocked"), ...of("done")];
  }

  replyNext() {
    const list = agents();
    const a = this.waiting(list)[0] ?? list.find((x) => x.focused) ?? list[0];
    if (a) this.reply(a);
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  // An agent seen for the first time takes its tab's last change, if the app knows one.
  track(list, sp, now) {
    const tabs = new Map(sp.flatMap((s) => s.tabs ?? []).map((c) => [c.id, c]));
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      const was = this.changed[a.address];
      if (was?.s === s) continue;
      this.changed[a.address] = { s, at: was ? now : tabs.get(a.tab)?.changed_at ?? 0 };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // What each waiting agent is asking, read off its screen. Only while some wait.
  readWaiting(cx) {
    const list = this.waiting(agents()).filter((a) => a.status === "blocked").slice(0, 3);
    if (!list.length || this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      let dirty = false;
      try {
        for (const a of list) {
          const r = await hc(["read", a.address, "--lines", "0"]);
          const line = r.code === 0 ? question(r.stdout) : null;
          if (this.asked[a.address] !== line) { this.asked[a.address] = line; dirty = true; }
        }
      } catch {}
      this.reading = false;
      if (dirty) cx.notify();
    });
  }

  // Presses keys in a blocked agent: the person clicking is the one deciding.
  keysTo(a, names, cx) {
    cx.spawn(async (cx) => {
      try { await hc(["keys", a.address, ...names]); } catch {}
      this.readWaiting(cx);
    });
  }

  // Live sub-agents of `addr` that have no pane of their own (those with one are agents).
  kidsOf(ctx, addr) {
    return ctx.all.filter((k) => k.parent === addr && k.state === "live" && !ctx.listed.has(k.address));
  }

  // Depth first, each with the tree lines in front of it.
  subtree(ctx, addr, lead) {
    const kids = this.kidsOf(ctx, addr);
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...this.subtree(ctx, k.address, [...lead, last ? "" : "│"])];
    });
  }

  // Everything the rows need about agents, read once per render.
  context(list, now) {
    const leads = leadPanes(panes());
    const tabLabels = new Map(spaces().flatMap((s) => s.tabs ?? []).map((tab) => [tab.id, title(tab, leads.get(tab.id))]));
    const detail = new Map();
    for (const a of list) {
      const l = tabLabels.get(a.tab) ?? clean(a.title);
      // An automatic tab number says nothing.
      detail.set(a.address, /^\d+$/.test(l) ? "" : l);
    }
    const bySpace = new Map();
    for (const a of list) {
      if (!bySpace.has(a.space)) bySpace.set(a.space, []);
      bySpace.get(a.space).push(a);
    }
    const names = shared("space.labels") ?? {};
    this.labelOf = (a) => [names[a.space] ?? a.space_name, detail.get(a.address)].filter(Boolean).join(" · ");
    return { bySpace, detail, names, listed: new Map(list.map((a) => [a.address, a.status])), shown: focused()?.agent ?? null, all: terminals(), order: [], now };
  }

  // A project's hue: one of the palette's, the least used when it's first seen, and
  // kept (per project id) so a project keeps its color as others come and go.
  hue(t, pid) {
    if (!pid) return null;
    const colors = palette(t);
    this.hues ??= JSON.parse(localStorage.getItem("hues") ?? "{}");
    if (!(pid in this.hues)) {
      const live = new Set(projects().list.map((q) => q.id));
      for (const k of Object.keys(this.hues)) if (!live.has(k)) delete this.hues[k];
      const uses = (i) => Object.values(this.hues).filter((v) => v === i).length;
      this.hues[pid] = colors.map((_c, i) => i).reduce((best, i) => (uses(i) < uses(best) ? i : best), 0);
      localStorage.setItem("hues", JSON.stringify(this.hues));
    }
    return colors[this.hues[pid] % colors.length];
  }

  // The project's line down the left of its rows, under its chevron.
  rail(G, hue) {
    return div().absolute().left(3 * G.u - G.px).top(0).bottom(0).w(2 * G.px).bg(faded(hue, "59"));
  }

  // One column of a tree line: "│" passes through, "├" and "└" branch to the row.
  slot(t, G, l, hue = null) {
    const s = div().relative().w(2 * G.u).h(G.row).flex_none();
    if (!l) return s;
    const c = hue ? faded(hue, "b3") : t.input;
    const line = s.child(div().absolute().left(G.u).top(0).w(G.px).h(l === "└" ? G.row / 2 : G.row).bg(c));
    return l === "│" ? line : line.child(div().absolute().left(G.u).top(G.row / 2).w(G.u).h(G.px).bg(c));
  }

  // The rows under a space: its first agent's sub-agents, then its other agents (each
  // with theirs).
  under(t, G, mine, pad, ctx, hue) {
    const lead = mine[0];
    if (!lead) return [];
    const top = [...this.kidsOf(ctx, lead.address).map((k) => ({ sub: k })), ...mine.slice(1).map((a) => ({ agent: a }))];
    const out = [];
    top.forEach((e, n) => {
      const last = n === top.length - 1;
      out.push(this.childRow(t, G, { ...e, lines: [last ? "└" : "├"] }, pad, ctx, hue));
      const addr = e.agent?.address ?? e.sub.address;
      for (const s of this.subtree(ctx, addr, [last ? "" : "│"])) out.push(this.childRow(t, G, { sub: s.t, lines: s.lines }, pad, ctx, hue));
    });
    return out;
  }

  childRow(t, G, e, pad, ctx, hue) {
    const a = e.agent, k = e.sub;
    const addr = a?.address ?? k.address;
    const st = a ? a.status : kidStatus(k, ctx.listed);
    const on = a ? a.focused : addr === ctx.shown;
    const name = a ? a.program?.name ?? "agent" : k.name || k.template || k.program?.name || k.address;
    const more = a ? ctx.detail.get(a.address) ?? "" : "";
    const when = a ? this.since(a) : 0;
    const pic = icon(a ? a.program : k.program, G, t.foreground);
    // A branch of the tree: its name leans to the project's hue, quieter than a session's.
    const tint = hue ? mix(t.muted, hue, 0.6) : t.muted;
    return h_flex().relative().id(`kid-${addr}`).h(G.row).flex_none().pl(pad).pr(2 * G.u).items_center().cursor_pointer()
      .when(Boolean(hue), (el) => el.child(this.rail(G, hue)))
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (a ? run("pane.focus", { pane: a.pane }) : run("terminal.peek", { terminal: addr })))
      .when(Boolean(a), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.reply(a); }))
      .children(e.lines.map((l) => this.slot(t, G, l, hue)))
      .child(h_flex().flex_1().min_w(0).gap(G.u).items_center()
        .child(mark(t, G, st, null, hue))
        .when(Boolean(pic), (el) => el.child(pic))
        .child(div().flex_shrink(0).max_w(16 * G.u).truncate().text_color(on ? t.foreground : tint).child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(more))
        .when(Boolean(when), (el) => el.child(div().flex_none().text_color(t.muted).child(duration(ctx.now - when)))));
  }

  // ---- spaces ----

  // While a space is dragged, a project or machine header takes it: filed there, or unfiled.
  dropTarget(el, m, key, onDrop) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return el
      .on_mouse_move((_e, cx) => {
        if (this.pressed === null) return;
        const src = spaces().find((s) => s.id === this.pressed);
        const next = src && (src.machine ?? null) === m ? key : null;
        if (!same(this.over, next)) { this.over = next; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        this.over = null;
        const src = from !== null ? spaces().find((s) => s.id === from) : null;
        if (src && (src.machine ?? null) === m) onDrop(src);
        cx.notify();
      });
  }

  dragging(key) {
    return this.pressed !== null && JSON.stringify(this.over) === JSON.stringify(key);
  }

  toggleProject(id, cx) {
    this.projectsFolded.has(id) ? this.projectsFolded.delete(id) : this.projectsFolded.add(id);
    localStorage.setItem("projects.folded", JSON.stringify([...this.projectsFolded]));
    cx.notify();
  }

  chevron(t, G, open, color = null) {
    return div().w(2 * G.u).flex_none().flex().justify_center().text_color(color ?? t.muted).child(open ? "▼" : "►");
  }

  projectHead(p, kids, open, m, t, G) {
    const top = kids.map((r) => r.w.status).reduce((a, s) => ((RANK[s] ?? 0) > (RANK[a] ?? 0) ? s : a), null);
    const over = this.dragging({ project: p.id });
    const hue = this.hue(t, p.id);
    return this.dropTarget(h_flex().id(`project-${p.id}`).h(G.row).flex_none().pl(2 * G.u).pr(G.u).gap(G.u).items_center()
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .when(over, (el) => el.bg(t.selected))
      .on_click((_e, cx) => this.toggleProject(p.id, cx))
      .on_mouse_down("right", () => this.projectMenu(p))
      .child(this.chevron(t, G, open, hue))
      .child(div().flex_1().min_w(0).truncate().text_color(hue).child(p.name))
      .when(!open && Boolean(top) && top !== "idle", (el) => el.child(mark(t, G, top)))
      .child(div().flex_none().text_color(t.muted).child(String(kids.length)))
      .child(div().id(`project-add-${p.id}`).w(3 * G.u).h(3 * G.u).flex_none().flex().items_center().justify_center().text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(`New session in ${p.name}${p.folder ? ` (${p.folder})` : ""}`)
        .on_click((_e, cx) => { cx.stop_propagation(); newSession(p); }).child("+")), m, { project: p.id }, (src) => fileSpace(src.id, p.id));
  }

  projectEmpty(p, t, G) {
    return h_flex().relative().id(`project-new-${p.id}`).h(G.row).flex_none().pl(4 * G.u).pr(2 * G.u).gap(G.u).items_center()
      .child(this.rail(G, this.hue(t, p.id)))
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => newSession(p))
      .child(div().w(2 * G.u).flex_none().flex().justify_center().child("+")).child("New session here");
  }

  // A machine's rows: its projects first (each with its sessions, or a "new session"
  // row), then the sessions filed nowhere. A worktree goes with its checkout's project.
  machineRows(m, mine, draw, t, G) {
    const list = projects().list.filter((p) => (p.machine ?? null) === m);
    if (!list.length) return mine.flatMap((r) => draw(r));
    const inProject = filing(mine, list);
    const out = [];
    for (const p of list) {
      const kids = mine.filter((r) => inProject.get(r.w.id) === p.id);
      const open = !this.projectsFolded.has(p.id);
      out.push(this.projectHead(p, kids, open, m, t, G));
      if (open) out.push(...(kids.length ? kids.flatMap((r) => draw(r, p.id)) : [this.projectEmpty(p, t, G)]));
    }
    out.push(...mine.filter((r) => !inProject.get(r.w.id)).flatMap((r) => draw(r)));
    return out;
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    this.publishLabels(list);
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└" : "├" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, G, ctx) {
    const rows = this.ordered();
    const draw = (r, project = null) => this.row(r, t, G, project, ctx);
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(G.row).flex_none().px(4 * G.u).flex().items_center().text_color(t.muted).child("Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : this.machineRows(null, rows, draw, t, G);
    const machineNames = [null, ...remote];
    const small = (id, text, action, tip, loud = false) => div().id(id).flex_none().h(3 * G.u).px(G.u).flex().items_center().cursor_pointer()
      .when(loud, (el) => el.bg(t.blocked).text_color(t.accent_foreground))
      .when(!loud, (el) => el.text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); }).child(text);
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login";
      const folded = this.folded.has(m);
      const head = this.dropTarget(h_flex().id(`machine-${m ?? "local"}`).h(G.row).flex_none().pl(2 * G.u).pr(G.u).gap(G.u).items_center().text_color(t.muted)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .when(this.dragging({ unfile: m }), el => el.bg(t.selected))
        .on_mouse_down("right", () => this.machineMenu(m))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(this.chevron(t, G, !folded))
        .child(div().flex_none().max_w(24 * G.u).truncate().child(m ?? "This computer"))
        .child(hairline(t, G))
        .when(login, el => el.child(small(`machine-login-${m}`, "Log in ►", () => run("tab.new", { name: `login ${m}`, argv: ["hc", "machine", "login", m] }), `Open a terminal running hc machine login ${m}`, true)))
        .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().text_color(t.blocked).child((machine?.state ?? "asleep").replace(/_/g, " "))))
        .when(rebuilt, el => el
          .child(div().flex_none().max_w(18 * G.u).truncate().child(repair?.error || "rebuilt"))
          .child(small(`machine-connect-${m}`, repair?.busy ? "Connecting…" : "Connect", (cx) => this.reconnect(machine, cx), repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")))
        .when(connected, el => el.child(small(`machine-add-${m ?? "local"}`, "+", () => run("space.new", { machine: m ?? "" }), `New space on ${m ?? "this computer"}`))), m, { unfile: m }, (src) => fileSpace(src.id, null));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(G.row).flex_none().pl(4 * G.u).pr(2 * G.u).gap(G.u).items_center()
        .text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(div().w(2 * G.u).flex_none().flex().justify_center().child("+")).child("New space there");
      if (rebuilt || folded) return [head];
      if (!connected && !mine.length) return [head];
      if (!mine.length && loading(m)) return [head, loadingRow(m)];
      const body = this.machineRows(m, mine, draw, t, G);
      return [head, ...(body.length ? body : [empty])];
    });
  }

  // A space nobody named is called after its repo. In a dotfiles repo (rooted at ~ or in
  // a dot folder like ~/.config) that's the same name for every project inside it, so
  // such a space is called after the folder it's in under the repo (~/.config/omarchy:
  // "omarchy"). Other mods read these from shared("space.labels").
  label(w, g) {
    if (w.named || !g?.lead) return w.name;
    const root = g.root.replace(/\/+$/, "");
    const umbrella = base(root).startsWith(".") || root === home().replace(/\/+$/, "");
    return umbrella ? g.lead : w.name;
  }

  publishLabels(list) {
    const labels = {};
    for (const { w, g } of list) { const l = this.label(w, g); if (l !== w.name) labels[w.id] = l; }
    const json = JSON.stringify(labels);
    if (json !== JSON.stringify(shared("space.labels") ?? {})) setShared("space.labels", labels);
  }

  // Only what's unusual about its checkout: a branch that isn't main, commits ahead or
  // behind. Null when there's nothing to say.
  gitTail(g, name, t, G, ink) {
    const raw = g.branch ?? "detached";
    const branch = raw.toLowerCase() === name.toLowerCase() || raw === "master" || raw === "main" ? "" : raw;
    if (!branch && !g.ahead && !g.behind) return null;
    // A git branch is always this cyan, here and on the pane's header.
    return h_flex().flex_none().gap(G.u).items_center().text_color(ink ?? t.ansi6)
      .when(Boolean(branch), (el) => el.child(div().max_w(14 * G.u).truncate().child(branch)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(ink ?? t.done).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(ink ?? t.blocked).child(`↓${g.behind}`)));
  }

  // A space and, on the same row, its first agent. Returns the row and the rows under it.
  // `project`: the project this row is filed under (null: loose). A space dropped
  // on the row lands next to it, in the same project.
  row({ w, i, g, tree }, t, G, project, ctx) {
    const on = w.active;
    const filed = project !== null;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const name = this.label(w, g);
    const mine = ctx.bySpace.get(w.id) ?? [];
    const lead = mine[0] ?? null;
    for (const a of mine) ctx.order.push(a.address);
    const ink = on ? t.accent_foreground : null;
    const soft = ink ?? t.muted;
    const more = lead ? ctx.detail.get(lead.address) || (mine.length > 1 ? lead.program?.name ?? "" : "") : "";
    const when = lead ? this.since(lead) : 0;
    const pad = (filed ? 4 : 2) * G.u;
    const hot = Boolean(lead) && this.hovered === w.id && this.pressed === null;
    const tail = g ? this.gitTail(g, name, t, G, ink) : null;
    const hue = this.hue(t, project);
    const pic = lead ? icon(lead.program, G, ink ?? t.foreground) : null;
    const head = v_flex()
      .relative()
      .id(`space-${w.id}`)
      .w_full().min_w(0).overflow_hidden()
      .pl(pad)
      .pr(2 * G.u)
      .h(G.row)
      .flex_none()
      .justify_center()
      .cursor_pointer()
      .when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(Boolean(hue) && !on, (el) => el.child(this.rail(G, hue)).text_color(mix(t.foreground, hue, 0.3)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2 * G.px).bg(t.foreground)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_hover((over, cx) => {
        if (over) this.hovered = w.id;
        else if (this.hovered === w.id) this.hovered = null;
        cx.notify();
      })
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
          if ((projects().of[from] ?? null) !== project) fileSpace(from, project);
        } else if (from === w.id) {
          run("space.select", { id: w.id });
          // Already there: a second click goes to its agent.
          if (on && lead) run("pane.focus", { pane: lead.pane });
        }
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .w_full().min_w(0)
          .gap(G.u)
          .items_center()
          .when(Boolean(tree), (el) => el.child(this.slot(t, G, tree, on ? null : hue)))
          .child(mark(t, G, lead?.status ?? null, ink, hue))
          .when(Boolean(pic), (el) => el.child(pic))
          // With a long branch beside it, the name gives way before the row spills over.
          .child(div().flex_shrink(1).min_w(8 * G.u).max_w(24 * G.u).truncate().child(name))
          .child(div().flex_1().min_w(0).truncate().text_color(soft).child(more))
          .when(Boolean(tail), (el) => el.child(tail))
          .when(hot, (el) => el.child(div().id(`space-reply-${w.id}`).flex_none().px(G.u).h(3 * G.u).flex().items_center()
            .bg(on ? t.accent_foreground : t.raised).text_color(on ? t.accent : t.foreground)
            .tooltip("Read its screen and answer")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); this.reply(lead); })
            .child("reply")))
          .when(!hot && Boolean(when), (el) => el.child(div().flex_none().text_color(soft).child(duration(ctx.now - when)))),
      );
    return [head, ...this.under(t, G, mine, pad + (tree ? 2 * G.u : 0), ctx, hue)];
  }

  // The box under the tree: who is waiting, what they asked, and the keys to answer.
  queue(t, G, list, ctx) {
    const edge = list.some((a) => a.status === "blocked") ? t.blocked : t.done;
    const btn = (id, key, label, action, tip) => h_flex().id(id).h(3 * G.u).px(G.u).gap(G.u).flex_none().items_center()
      .bg(t.raised).text_color(t.foreground).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .when(Boolean(key), (el) => el.child(div().text_color(t.accent).child(key)))
      .when(Boolean(label), (el) => el.child(label));
    const item = (a, n) => {
      const when = this.since(a);
      const blocked = a.status === "blocked";
      const line = (blocked && this.asked[a.address]) || ctx.detail.get(a.address) || "";
      return v_flex().id(`wait-${a.address}`).px(2 * G.u).py(G.u).gap(G.u)
        .when(n > 0, (el) => el.border_t(G.px).border_color(t.border))
        .child(h_flex().gap(G.u).items_center()
          .child(mark(t, G, a.status))
          .when(Boolean(icon(a.program, G, t.foreground)), (el) => el.child(icon(a.program, G, t.foreground)))
          .child(div().flex_1().min_w(0).truncate().child(ctx.names[a.space] ?? a.space_name))
          .when(Boolean(when), (el) => el.child(div().flex_none().text_color(t.muted).child(duration(ctx.now - when)))))
        .when(Boolean(line), (el) => el.child(div().pl(3 * G.u).truncate().text_color(t.muted).child(line)))
        .child(h_flex().pl(3 * G.u).gap(G.u).items_center()
          .when(blocked, (el) => el
            .child(btn(`w1-${a.address}`, "1", "Yes", (cx) => this.keysTo(a, ["1"], cx), "Press 1 in the agent (usually Yes)"))
            .child(btn(`w2-${a.address}`, "2", "", (cx) => this.keysTo(a, ["2"], cx), "Press 2 in the agent"))
            .child(btn(`w3-${a.address}`, "3", "", (cx) => this.keysTo(a, ["3"], cx), "Press 3 in the agent"))
            .child(btn(`we-${a.address}`, "Esc", "", (cx) => this.keysTo(a, ["esc"], cx), "Press Esc in the agent (usually No)")))
          .child(btn(`wr-${a.address}`, "", "Reply", () => this.reply(a), "Read its screen and answer"))
          .child(btn(`wo-${a.address}`, "", "Open", () => run("pane.focus", { pane: a.pane }), "Go to this agent")));
    };
    const shown = list.slice(0, 3);
    return frame(t, G, { title: tag(t, G, `Waiting on you ${list.length}`, edge, t.accent_foreground), color: edge, fill: false },
      v_flex().w_full().pt(G.u)
        .children(shown.map(item))
        .when(list.length > shown.length, (el) => el.child(div().px(2 * G.u).pb(G.u).text_color(t.muted).child(`+${list.length - shown.length} more`))));
  }

  render() {
    const t = theme();
    if (props()?.menu) return this.renderMenu(t);
    const G = grid();
    const sp = spaces();
    this.known = adopt(sp, this.known);
    const list = agents();
    const now = Date.now();
    this.track(list, sp, now);
    const ctx = this.context(list, now);
    const rows = this.grouped(t, G, ctx);
    setAgentOrder(ctx.order);
    const waiting = this.waiting(list);
    const fresh = div().id("space-new").flex_none().px(G.u).h(2 * G.u).bg(t.canvas).text_color(t.muted).cursor_pointer()
      .hover((s) => s.text_color(t.foreground)).tooltip("New space").on_click(() => run("space.new")).child("+ new");
    return v_flex().size_full().min_h(0).gap(G.u).bg(t.canvas).text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .child(div().flex_1().min_h(0).child(frame(t, G, { title: tag(t, G, "Spaces", t.canvas, t.foreground), right: fresh },
        v_flex().id("tree").size_full().min_h(0).pt(G.u).overflow_y_scrollbar().mode("always")
          .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
          .children(rows))))
      .when(waiting.length > 0, (el) => el.child(div().flex_none().child(this.queue(t, G, waiting, ctx))));
  }

  // The popups: a space's, a project's and a machine's menu, with an inline
  // field for names and folders (Enter saves, Esc closes the popup).
  menuInit(cx) {
    this.editing = props()?.edit ?? null;
    this.text = "";
    this.input = InputState.new({ value: "" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.handle = cx.focus_handle();
    if (this.editing) { this.input.focus(); cx.timer.after(80, () => this.input.focus()); }
  }

  edit(kind, value, cx) {
    this.editing = kind;
    this.text = value ?? "";
    this.input.set_value(this.text);
    if (this.text) this.input.set_selected_range({ start: 0, end: this.text.length });
    this.input.focus();
    cx.timer.after(80, () => this.input.focus());
    cx.notify();
  }

  submit() {
    const p = props();
    const text = this.text.trim();
    const space = spaces().find((s) => s.id === p.id);
    switch (this.editing) {
      case "new-for-space":
        if (text && space) fileSpace(space.id, addProject(text, space.machine ?? null));
        break;
      case "new-for-machine":
        if (text) addProject(text, p.machine ?? null);
        break;
      case "rename":
        if (text) editProject(p.id, { name: text });
        break;
      case "folder":
        editProject(p.id, { folder: text || null });
        break;
    }
    closeOverlay(p.overlay);
  }

  renderMenu(t) {
    const G = grid();
    const p = props();
    const close = () => closeOverlay(p.overlay);
    const item = (id, text, action, color, on) => h_flex().id(id).h(G.row).px(2 * G.u).gap(G.u).items_center().flex_none()
      .text_color(color ?? t.foreground).cursor_pointer().hover((s) => s.bg(t.accent).text_color(t.accent_foreground))
      .on_click((_e, cx) => action(cx))
      .child(div().flex_1().truncate().child(text))
      .when(Boolean(on), (el) => el.child("■"));
    const head = (text) => div().px(2 * G.u).h(G.row).flex().items_center().flex_none().text_color(t.muted).child(text);
    const rule = () => div().h(G.px).my(G.u).flex_none().bg(t.border);
    const field = (hint) => v_flex().px(2 * G.u).pb(G.u).gap(G.u).flex_none()
      .child(Input.new(this.input).h(G.row).px(G.u).rounded(0).border(G.px).border_color(t.accent).bg(t.background).text_size(G.text).text_color(t.foreground))
      .child(div().text_color(t.muted).child(hint));
    const box = (...rows) => v_flex().id("project-menu").track_focus(this.handle).w_full().py(G.u).bg(t.popover)
      .text_size(G.text).line_height(`${G.text}px`).children(rows);

    if (p.menu === "space") {
      const w = spaces().find((s) => s.id === p.id);
      if (!w) return box(item("gone", "That space is gone", close, t.muted));
      const pj = projects();
      const m = w.machine ?? null;
      const list = pj.list.filter((q) => (q.machine ?? null) === m);
      const current = pj.of[w.id];
      if (this.editing) return box(head("New project"), field("Enter saves · the space moves in"));
      return box(
        head("Project"),
        ...list.map((q) => item(`to-${q.id}`, q.name, () => { fileSpace(w.id, q.id === current ? null : q.id); close(); }, null, q.id === current)),
        item("new-project", "New project…", (cx) => this.edit("new-for-space", "", cx)),
        ...(current ? [item("unfile", "Take out of its project", () => { fileSpace(w.id, null); close(); })] : []),
        rule(),
        item("rename", "Rename", () => { close(); run("space.rename", { id: w.id }); }),
        item("close", "Close space", () => { close(); run("space.close", { id: w.id }); }),
        item("more", "More…", () => { close(); openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } }); }, t.muted),
      );
    }
    if (p.menu === "project") {
      const q = projects().list.find((x) => x.id === p.id);
      if (!q) return box(item("gone", "That project is gone", close, t.muted));
      if (this.editing === "rename") return box(head("Rename project"), field("Enter saves"));
      if (this.editing === "folder") return box(head("Folder for new sessions"), field(`A path on ${q.machine ?? "this computer"}; empty: its home`));
      return box(
        head(q.name),
        item("session", "New session", () => { close(); newSession(q); }),
        item("rename", "Rename…", (cx) => this.edit("rename", q.name, cx)),
        item("folder", q.folder ? `Folder: ${q.folder}` : "Folder for new sessions…", (cx) => this.edit("folder", q.folder ?? "", cx)),
        rule(),
        item("remove", "Remove project", () => { removeProject(q.id); close(); }, t.blocked),
        div().px(2 * G.u).pb(G.u).text_color(t.muted).child("Its sessions stay, unfiled."),
      );
    }
    if (p.menu === "machine") {
      const m = p.machine ?? null;
      if (this.editing) return box(head("New project"), field(`On ${m ?? "this computer"} · Enter saves`));
      return box(
        head(m ?? "This computer"),
        item("new-project", "New project…", (cx) => this.edit("new-for-machine", "", cx)),
        item("new-space", "New space", () => { close(); run("space.new", { machine: m ?? "" }); }),
        div().px(2 * G.u).pt(G.u).pb(G.u).text_color(t.muted).child("Drag a space onto a project to file it; onto this header to take it out."),
      );
    }
    return box(item("none", "Nothing here", close, t.muted));
  }
}
