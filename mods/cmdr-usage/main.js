// Commander's usage popup: the tokens your agents used today and over the last seven
// days, by project, by day and by agent, plus Codex's own word on its weekly limit.
// The numbers are in shared "commander.usage" (cmdr-menubar runs usage.py, beside
// this file, here and on each machine with spaces); this mod only shows them.
//
// A session belongs to the project whose folder, or one of whose spaces' folders, it
// ran in or under; failing that, to the project whose folder's name is in its path (a
// worktree somewhere else). The rest is listed by folder name.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, run, closeOverlay, props, theme, shared, home } from "herdr";
import { grid, palette, faded, mix, frame, tag, lifted } from "./ui.js";

const compact = (n) => (n < 1000 ? String(n) : n < 999500 ? `${Math.round(n / 1000)}k` : n < 99950000 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e6)}M`);
const base = (path) => path.replace(/\/+$/, "").split("/").pop() || path;
// A home folder holds every project: it only claims what ran right in it.
const homeLike = (f) => /^\/(home|Users)\/[^/]+$/.test(f) || f === "/root";
const DAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const TOOLS = { claude: "Claude Code", codex: "Codex" };
const p2 = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

// Every folder that stands for a project: [{ m: machine, folder, pid }].
function claims(pj) {
  const filed = shared("commander.filing") ?? {};
  const h = home().replace(/\/+$/, "");
  const abs = (f, m) => (!f ? null : f.startsWith("/") ? f.replace(/\/+$/, "") : m ? null : `${h}/${f}`.replace(/\/+$/, ""));
  const out = [];
  for (const p of pj.list) {
    const f = abs(p.folder, p.machine ?? null);
    if (f) out.push({ m: p.machine ?? null, folder: f, pid: p.id, own: true });
  }
  const ps = panes();
  for (const s of spaces()) {
    const pid = filed[s.id] ?? pj.of[s.id];
    if (!pid) continue;
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const folders = new Set([abs(s.folder, s.machine ?? null), ...ps.filter((p) => tabs.has(p.tab) && p.cwd).map((p) => p.cwd.replace(/\/+$/, ""))]);
    for (const f of folders) if (f) out.push({ m: s.machine ?? null, folder: f, pid });
  }
  return out;
}

function owner(list, m, cwd) {
  let best = null;
  for (const c of list) {
    if (c.m !== m) continue;
    const inside = cwd === c.folder || (!homeLike(c.folder) && cwd.startsWith(`${c.folder}/`));
    if (inside && (!best || c.folder.length > best.folder.length)) best = c;
  }
  if (best) return best.pid;
  const parts = cwd.split("/");
  return list.find((c) => c.own && c.m === m && !homeLike(c.folder) && parts.includes(base(c.folder)))?.pid ?? null;
}

export default class Usage extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(80, () => this.handle.focus());
    // Opening it asks for fresh numbers; they arrive through shared state.
    run("cmdr-menubar.usage-refresh");
  }

  render() {
    const t = theme();
    const G = grid();
    const data = shared("commander.usage");
    const machines = Object.entries(data?.machines ?? {});
    // The overlay is a cell wider and taller than this: its shadow (ui.js `lifted`).
    const box = (body) => lifted(G, v_flex().id("usage").track_focus(this.handle).w_full().p(G.u).bg(t.popover).border(G.px).border_color(t.input)
      .text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .on_click(() => closeOverlay(props().overlay))
      .child(body));
    if (!machines.length) return box(div().p(2 * G.u).text_color(t.muted).child("Reading the agents' logs…"));

    const p = shared("spaces.projects");
    const pj = { list: Array.isArray(p?.list) ? p.list : [], of: p?.of ?? {} };
    const list = claims(pj);
    const hues = shared("commander.hues") ?? {};
    const colors = palette(t);

    // Rows: one per project, then the folders nobody claims.
    const rows = new Map();
    const add = (key, name, hue, today, week, where) => {
      const r = rows.get(key) ?? { key, name, hue, today: 0, week: 0, where };
      r.today += today; r.week += week;
      rows.set(key, r);
    };
    for (const [m, u] of machines) {
      for (const [cwd, today, week] of u.places ?? []) {
        const pid = owner(list, m || null, cwd);
        const q = pid ? pj.list.find((x) => x.id === pid) : null;
        if (q) add(q.id, q.name, pid in hues ? colors[hues[pid] % colors.length] : null, today, week, q.machine ?? "");
        else add(`${m}:${cwd}`, homeLike(cwd) ? "~" : base(cwd), null, today, week, m);
      }
    }
    const all = [...rows.values()].sort((a, b) => b.week - a.week);
    const named = all.filter((r) => r.hue || pj.list.some((q) => q.id === r.key));
    const loose = all.filter((r) => !named.includes(r));
    const shown = [...named, ...loose.slice(0, 4)].sort((a, b) => b.week - a.week);
    const rest = loose.slice(4);
    if (rest.length) shown.push({ key: "rest", name: `${rest.length} more folders`, hue: null, today: rest.reduce((n, r) => n + r.today, 0), week: rest.reduce((n, r) => n + r.week, 0), where: "", quiet: true });
    const total = { today: all.reduce((n, r) => n + r.today, 0), week: all.reduce((n, r) => n + r.week, 0) };
    const most = Math.max(1, ...shown.map((r) => r.week));

    const num = (n, color) => div().w(10 * G.u).flex_none().flex().justify_end().text_color(color).child(n ? compact(n) : "·");
    const row = (r) => {
      const ink = r.hue ?? (r.quiet || !named.includes(r) ? t.muted : t.foreground);
      return h_flex().relative().h(G.row).flex_none().px(2 * G.u).gap(G.u).items_center()
        // How much of the week's most this one is, as a quiet band behind the row.
        .child(div().absolute().left(0).top(G.px).bottom(G.px).w(Math.round((r.week / most) * 64) * G.u).bg(faded(r.hue ?? t.muted, "24")))
        .child(div().flex_1().min_w(0).truncate().text_color(ink).child(r.name))
        .when(Boolean(r.where), (el) => el.child(div().flex_none().text_color(t.dim).child(r.where)))
        .child(num(r.today, r.today ? t.foreground : t.dim))
        .child(num(r.week, t.muted));
    };
    const rule = () => div().h(G.px).my(G.u).mx(2 * G.u).flex_none().bg(t.border);

    // The week, a bar a day: local days, the other machines' added on by position.
    const daily = [0, 0, 0, 0, 0, 0, 0];
    for (const [, u] of machines) (u.daily ?? []).forEach((v, i) => { if (i < 7) daily[i] += v; });
    const days = (data.machines[""] ?? machines[0][1]).days ?? [];
    const peak = Math.max(1, ...daily);
    const bars = h_flex().h(14 * G.u).flex_none().px(2 * G.u).gap(G.u).items_end()
      .children(daily.map((v, i) => {
        const d = days[i] ? new Date(`${days[i]}T12:00:00`) : null;
        const last = i === daily.length - 1;
        return v_flex().flex_1().min_w(0).h_full().items_center().justify_end().gap(G.u)
          .child(div().text_color(last ? t.foreground : t.muted).child(v ? compact(v) : ""))
          .child(div().w_full().h(Math.max(v ? 2 : 0, Math.round(((v / peak) * 6 * G.u) / G.px)) * G.px).bg(last ? t.accent : mix(t.popover, t.muted, 0.45)))
          .child(div().text_color(last ? t.foreground : t.muted).child(d ? DAY[d.getDay()] : ""));
      }));

    // By agent, and what Codex last said about its limit (Claude Code doesn't log one).
    const tools = {};
    for (const [, u] of machines) for (const [k, v] of Object.entries(u.tools ?? {})) { tools[k] ??= [0, 0]; tools[k][0] += v[0]; tools[k][1] += v[1]; }
    const cached = machines.reduce((n, [, u]) => n + (u.cached?.[0] ?? 0), 0);
    const limit = machines.map(([, u]) => u.codex_limit).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const note = (text, color) => div().px(2 * G.u).flex_none().line_height(`${3 * G.u}px`).text_color(color ?? t.muted).child(text);
    let limitLine = null;
    if (limit) {
      const span = limit.minutes >= 10080 ? "weekly" : limit.minutes >= 1440 ? "daily" : `${Math.round((limit.minutes ?? 300) / 60)}h`;
      const r = limit.resets ? new Date(limit.resets * 1000) : null;
      const said = new Date(limit.at);
      limitLine = `Codex ${span} limit: ${Math.round(limit.used)}% used${r ? `, resets ${DAY[r.getDay()]} ${hhmm(r)}` : ""} (as of ${DAY[said.getDay()]} ${hhmm(said)})`;
    }
    const head = h_flex().h(G.row).flex_none().px(2 * G.u).gap(G.u).items_center().text_color(t.muted)
      .child(div().flex_1().child("Project"))
      .child(div().w(10 * G.u).flex_none().flex().justify_end().child("today"))
      .child(div().w(10 * G.u).flex_none().flex().justify_end().child("7 days"));
    const right = div().flex_none().px(G.u).h(2 * G.u).bg(t.popover).text_color(t.muted).child(`updated ${hhmm(new Date(data.at))}`);
    return box(frame(t, G, { title: tag(t, G, "Usage · tokens", t.popover, t.foreground), right, fill: false },
      v_flex().w_full().pt(G.u).pb(G.u)
        .child(head)
        .children(shown.map(row))
        .child(rule())
        .child(h_flex().h(G.row).flex_none().px(2 * G.u).gap(G.u).items_center()
          .child(div().flex_1().child("Total")).child(num(total.today, t.foreground)).child(num(total.week, t.foreground)))
        .child(rule())
        .child(bars)
        .child(rule())
        .children(Object.entries(tools).sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => h_flex().h(G.row).flex_none().px(2 * G.u).gap(G.u).items_center()
          .child(div().flex_1().text_color(t.muted).child(TOOLS[k] ?? k)).child(num(v[0], v[0] ? t.foreground : t.dim)).child(num(v[1], t.muted))))
        .when(Boolean(limitLine), (el) => el.child(rule()).child(note(limitLine, t.foreground)))
        .child(rule())
        .child(note(`Input, output and cache writes, from the agents' own logs. Cache reads are left out (${compact(cached)} today).`))));
  }
}
