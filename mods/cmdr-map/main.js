// Commander's ground stations: a small flat map of the world at the foot of the
// sidebar, with a mark where each machine is and a box over the spot the globe behind
// the terminals is facing, so the sides and the middle show the same planet.
//
// Where a machine is comes from its public address: the machine itself asks a lookup
// service (SOURCES), once a day, and the answer is kept in shared "commander.places"
// ({ machine name, "" for this computer: { lat, lon, city, region, country, at } }).
// A machine that can't be reached keeps its last known place, drawn dim; one this window
// hasn't listed for a month is forgotten.
//
// The land is land.svg / ice.svg, made from the globe's pictures by make-land.py: a
// grid of MAP.cols x MAP.rows cells, drawn a whole number of device pixels a cell.
//
// Keys and scripts: cmdr-map.fold (also a click on the title), cmdr-map.refresh.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, layout, run, exec, theme, shared, setShared, nextCommand } from "herdr";
import { grid, frame, tag, mix } from "./ui.js";

// make-land.py's numbers: cells across and down, degrees a cell, the top edge's latitude.
const MAP = { cols: 90, rows: 33, deg: 4, north: 76 };
// cmdr-menubar's globe: picture k looks straight at longitude -0.75 k, on the equator.
const GLOBE_STEP = 0.75;
const PLACES = "commander.places";
const FOLDED = "commander.map.folded";
const FRESH = 24 * 3600 * 1000;   // a place is asked for again after a day
const CHECK = 60 * 1000;          // how often to look for machines without one
const AGAIN = 10 * 60 * 1000;     // a machine no service answered for waits this long
const GONE = 30 * 24 * 3600 * 1000;

const SOURCES = [
  ["https://ipinfo.io/json", (d) => {
    const [lat, lon] = String(d.loc ?? "").split(",").map(Number);
    return { lat, lon, city: d.city, region: d.region, country: d.country };
  }],
  ["https://ipapi.co/json", (d) => ({ lat: Number(d.latitude), lon: Number(d.longitude), city: d.city, region: d.region, country: d.country_code })],
];

// Where `machine` (null: this computer) is, or null when no service answered.
async function locate(machine) {
  for (const [url, read] of SOURCES) {
    // Windows has curl.exe; Linux and macOS usually have curl. Try both directly
    // so geolocation works even when Python is unavailable on a machine.
    for (const command of ["curl.exe", "curl"]) {
      try {
        const r = await exec(command, ["-fsS", "--max-time", "8", url], { on: machine, timeout: 15000 });
        if (r.code !== 0) continue;
        const p = read(JSON.parse(r.stdout));
        if (Number.isFinite(p.lat) && Number.isFinite(p.lon) && (p.lat !== 0 || p.lon !== 0)) return p;
      } catch (_e) { /* try the next executable or service */ }
    }
  }
  return null;
}

function find(n, test) {
  if (!n) return null;
  if (test(n)) return n;
  for (const child of n.children ?? []) { const hit = find(child, test); if (hit) return hit; }
  return null;
}

const key = (name) => name ?? "";
const said = (name) => name ?? "here";
const longitude = (lon) => `${String(Math.round(Math.abs(lon))).padStart(3, "0")}°${lon < 0 ? "W" : "E"}`;
const where = (p) => [p.city, p.region, p.country].filter(Boolean).join(", ");

// The machines this window knows, this computer first.
function known() {
  const list = machines();
  return [{ name: null, layout: "ready" }, ...list.filter((m) => m.name)];
}

export default class GroundStations extends View {
  init(_props, cx) {
    this.size = null;
    this.busy = false;
    this.tried = {};
    cx.timer.every(CHECK, (cx) => this.refresh(cx, false));
    this.refresh(cx, false);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "fold") setShared(FOLDED, !shared(FOLDED));
        if (c === "refresh") this.refresh(cx, true);
      }
    });
  }

  // Asks each reachable machine without a fresh place where it is. `all`: every one.
  refresh(cx, all) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const list = known();
        const places = { ...(shared(PLACES) ?? {}) };
        let changed = false;
        const now = Date.now();
        // A machine that's gone takes its place with it, but not one that only hasn't
        // shown up yet (right after a start the list is short).
        for (const k of Object.keys(places)) {
          if (!list.some((m) => key(m.name) === k) && now - (places[k].at ?? 0) > GONE) { delete places[k]; changed = true; }
        }
        for (const m of list) {
          const k = key(m.name), had = places[k];
          if (m.layout !== "ready" || (!all && had && now - had.at < FRESH)) continue;
          if (!all && now - (this.tried[k] ?? 0) < AGAIN) continue;
          this.tried[k] = now;
          const p = await locate(m.name);
          if (p) { places[key(m.name)] = { ...p, at: Date.now() }; changed = true; }
        }
        if (changed) setShared(PLACES, places);
        // Machines still connecting at start get another look shortly.
        if (list.some((m) => m.layout === "loading") && (this.soon = (this.soon ?? 0) + 1) <= 8) cx.timer.after(15000, (cx) => this.refresh(cx, false));
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // The longitude the globe faces now, or null while it's off.
  facing() {
    const main = find(layout(), (n) => n.id === "main");
    const m = /(\d{3})\.png$/.exec(main?.background?.image ?? "");
    if (!m) return null;
    return ((-GLOBE_STEP * Number(m[1]) + 540) % 360) - 180;
  }

  // The block is as tall as what it shows, counted in device pixels like the rest.
  fit(height) {
    const node = find(layout(), (n) => n.content?.mod === "cmdr-map");
    const px = node?.size?.px;
    if (!node?.id || px == null || Math.abs(px - height) < 0.05 || this.fitted === height) return;
    this.fitted = height;
    run("layout.resize", { id: node.id, px: height });
  }

  // One mark per map cell (machines behind one address share it), each with a label
  // beside it: on its own line where there's room, else a line or two away with a
  // thin lead back to its mark. All in device pixels; `cell` and `u` are whole ones.
  stations(places, cell, u, width, height) {
    const cells = new Map();
    for (const m of known()) {
      const p = places[key(m.name)];
      if (!p) continue;
      const col = Math.min(MAP.cols - 1, Math.max(0, Math.floor((p.lon + 180) / MAP.deg)));
      const row = Math.min(MAP.rows - 1, Math.max(0, Math.floor((MAP.north - p.lat) / MAP.deg)));
      const id = `${col}-${row}`;
      if (!cells.has(id)) cells.set(id, { id, col, row, machines: [] });
      cells.get(id).machines.push({ name: m.name, place: p, linked: m.layout !== "unavailable" });
    }
    const list = [...cells.values()].sort((a, b) => a.row - b.row || a.col - b.col);
    const placed = [];
    const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const s of list) {
      const names = s.machines.map((m) => said(m.name));
      s.label = names.join(", ").length <= 20 ? names.join(", ") : `${names[0]} +${names.length - 1}`;
      s.x = s.col * cell; s.y = s.row * cell;
      const w = [...s.label].length * u, h = 2 * u, gap = Math.round(cell * 1.5);
      const sides = { right: s.x + cell + gap, left: s.x - gap - w };
      const fits = (side) => sides[side] >= 0 && sides[side] + w <= width;
      const order = (fits("right") ? ["right", "left"] : ["left", "right"]).filter(fits);
      const middle = s.y + cell / 2;
      const others = list.filter((o) => o !== s).map((o) => ({ x: o.col * cell - cell, y: o.row * cell - cell, w: 3 * cell, h: 3 * cell }));
      // On its mark's line, either side, before a line away; labels keep a cell apart.
      let best = null;
      for (const k of [0, 1, -1, 2, -2, 3, -3]) {
        for (const side of order) {
          const y = Math.round(middle - h / 2 + k * h);
          if (y < 0 || y + h > height) continue;
          const box = { x: sides[side], y, w, h };
          const roomy = { x: box.x - u, y, w: w + 2 * u, h };
          if (placed.some((p) => hits(roomy, p)) || others.some((o) => hits(box, o))) continue;
          best = { ...box, away: k !== 0, right: side === "right" };
          break;
        }
        if (best) break;
      }
      const side = order[0] ?? "right";
      best ??= { x: Math.min(Math.max(0, sides[side]), Math.max(0, width - w)), y: Math.min(height - h, Math.max(0, Math.round(middle - h / 2))), w, h, away: false, right: side === "right" };
      s.at = best;
      placed.push(best);
    }
    return list;
  }

  render() {
    const t = theme(), G = grid();
    const folded = Boolean(shared(FOLDED));
    const title = div().id("map-title").cursor_pointer().tooltip(folded ? "Show the map" : "Hide the map")
      .on_click(() => setShared(FOLDED, !folded))
      .child(tag(t, G, "Ground stations", t.canvas, folded ? t.muted : t.foreground));
    const root = (body) => div().id("root").size_full().bg(t.canvas).text_size(G.text).line_height(`${G.text}px`).text_color(t.foreground)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(body);
    if (folded) {
      this.fit(2 * G.u);
      return root(h_flex().w_full().h(2 * G.u).items_center()
        .child(div().w(2 * G.u).h(G.px).bg(t.border)).child(title).child(div().flex_1().h(G.px).bg(t.border)));
    }

    // Device pixels from here: `u` and a map cell are whole numbers of them.
    const px = G.px, u = Math.round(G.u / px);
    const inner = Math.floor((this.size?.width ?? 0) / px) - 4 * u - 2;
    const cell = Math.max(2, Math.floor(inner / MAP.cols));
    const width = MAP.cols * cell, height = MAP.rows * cell;
    const left = Math.max(0, Math.floor((inner - width) / 2));
    this.fit((7 * u + height + 1) * px);

    const places = shared(PLACES) ?? {};
    const here = key(spaces().find((s) => s.active)?.machine ?? null);
    const lon = this.facing();
    const land = mix(t.canvas, t.ansi2, 0.25), ice = mix(t.canvas, t.foreground, 0.3);
    const equator = Math.round((MAP.north / MAP.deg) * cell);

    let map = div().relative().flex_none().ml(left * px).w(width * px).h(height * px).overflow_hidden();
    // The line the globe's view runs along, under the land.
    if (lon !== null) map = map.child(div().absolute().left(0).w(width * px).top(equator * px).h(px).bg(t.border));
    map = map.child(svg("mods/cmdr-map/land.svg").absolute().left(0).top(0).w(width * px).h(height * px).text_color(land));
    map = map.child(svg("mods/cmdr-map/ice.svg").absolute().left(0).top(0).w(width * px).h(height * px).text_color(ice));
    if (lon !== null) {
      const x = Math.round(((lon + 180) / MAP.deg) * cell), half = Math.round(2.5 * cell);
      map = map.child(div().absolute().left((x - half) * px).top((equator - half) * px).w(2 * half * px).h(2 * half * px).border(px).border_color(t.accent));
    }
    for (const s of this.stations(places, cell, u, width, height)) {
      const mine = s.machines.some((m) => key(m.name) === here);
      const linked = s.machines.some((m) => m.linked);
      const ink = mine ? t.accent : linked ? t.foreground : t.dim;
      const tip = s.machines.map((m) => `${m.name ?? "This computer"} · ${where(m.place)}${m.linked ? "" : " · not linked"}`).join("; ");
      const go = () => {
        const target = spaces().find((sp) => s.machines.some((m) => key(m.name) === key(sp.machine)));
        if (target && !mine) run("space.select", { id: target.id });
      };
      if (s.at.away) {
        const mx = s.x + Math.floor(cell / 2), my = s.y + Math.floor(cell / 2), ly = s.at.y + u;
        const end = s.at.right ? s.at.x - Math.ceil(cell / 2) : s.at.x + s.at.w + Math.ceil(cell / 2);
        map = map.child(div().absolute().left(mx * px).top(Math.min(my, ly) * px).w(px).h((Math.abs(ly - my) + 1) * px).bg(t.dim));
        map = map.child(div().absolute().left(Math.min(mx, end) * px).top(ly * px).w(Math.abs(end - mx) * px).h(px).bg(t.dim));
      }
      map = map.child(div().absolute().left((s.x - 1) * px).top((s.y - 1) * px).w((cell + 2) * px).h((cell + 2) * px).bg(ink));
      map = map.child(div().id(`station-${s.id}`).absolute().left(s.at.x * px).top(s.at.y * px).h(2 * G.u).cursor_pointer()
        .text_color(mine ? t.foreground : linked ? t.muted : t.dim).hover((el) => el.text_color(t.foreground))
        .tooltip(tip).on_click(go).child(s.label));
    }

    const spot = places[here];
    const readout = h_flex().w_full().h(2 * G.u).flex_none().items_center().gap(G.u)
      .when(lon !== null, (el) => el.child(div().text_color(t.dim).child("facing")).child(div().text_color(t.muted).child(longitude(lon))))
      .child(div().flex_1())
      .child(div().truncate().text_color(t.dim).child(spot ? [spot.city, spot.country].filter(Boolean).join(", ") : this.busy ? "locating…" : ""));
    return root(frame(t, G, { title, fill: true },
      v_flex().w_full().px(2 * G.u).pt(G.u).pb(G.u).gap(G.u).child(map).child(readout)));
  }
}
