// Keeps this Commander install in step with the GitHub repo. Every few hours the bar
// fetches the repo's `release` branch (CI moves it to main once main's tests pass) into
// a clone in <home>/.commander-update/repo, then copies over the files that changed:
// the layout, its themes, the globe pictures and every mods/cmdr-* folder. Herdr's hot
// reload shows them at once.
//
// A file is only replaced when it is exactly one of the repo's past versions of it (its
// git blob id, with Windows line endings forgiven): a file someone changed is kept and
// named in the toast. The layout file is compared by its structure: the sizes, panel
// state and globe picture the app writes into it are carried over to the new version.
// keys.json only gains keys the release adds and the person hasn't bound.
//
// Off when <home>/.commander-dev exists (the copy the repo is made from) or shared
// "commander.update" is "off" (≡ > Auto-update Commander). Needs git.

import { exec, appHome, notify, run, layout, shared } from "herdr";
import * as fs from "fs/promises";
import { createHash } from "crypto";

export const UPDATE = {
  url: "https://github.com/aissa-93/herdr-commander.git",
  branch: "release",
  every: 6 * 60 * 60 * 1000,
  first: 90 * 1000,
};
const LAYOUT = "layouts/commander.json";
const NO_BLOB = /^0+$/;

// The paths an update may touch; everything else in the repo is for people, not Herdr.
export const ours = (p) =>
  p === LAYOUT || p === "layouts/commander.svg" || /^themes\/commander[^/]*\.json$/.test(p)
  || /^mods\/cmdr-[^/]+\/./.test(p) || p.startsWith("backgrounds/commander-earth/");

// ---- pure parts (tests/update.test.mjs runs them) ----

// git's id for a file's bytes.
export function blobId(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}
// The ids a file on disk could have been checked out as: as is, and with CRLF made LF.
export function localIds(bytes) {
  const ids = [blobId(bytes)];
  let crlf = false;
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 13 && bytes[i + 1] === 10) { crlf = true; break; }
  if (crlf) {
    const out = [];
    for (let i = 0; i < bytes.length; i++) if (!(bytes[i] === 13 && bytes[i + 1] === 10)) out.push(bytes[i]);
    ids.push(blobId(new Uint8Array(out)));
  }
  return ids;
}

// `git ls-tree -r` lines → { path: blob }.
export function parseTree(text) {
  const tree = {};
  for (const line of text.split("\n")) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (m && ours(m[2])) tree[m[2]] = m[1];
  }
  return tree;
}
// `git log --raw` lines → { path: Set of every blob it has been }.
export function parseHistory(text) {
  const known = {};
  for (const line of text.split("\n")) {
    const m = /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) \w+\t(.+)$/.exec(line);
    if (!m || !ours(m[3])) continue;
    const set = (known[m[3]] ??= new Set());
    for (const id of [m[1], m[2]]) if (!NO_BLOB.test(id)) set.add(id);
  }
  return known;
}

// What to do with each file. `local`: path → its possible ids, or null when missing.
export function plan(tree, known, local) {
  const write = [], remove = [], kept = [];
  for (const [path, id] of Object.entries(tree)) {
    if (path === LAYOUT) continue;
    const ids = local[path];
    if (ids?.includes(id)) continue;
    if (!ids || ids.some((x) => known[path]?.has(x))) write.push(path);
    else kept.push(path);
  }
  for (const [path, ids] of Object.entries(local)) {
    if (path in tree || !ids || path === LAYOUT) continue;
    // One the repo dropped goes only if it's unchanged; an edited one is left alone.
    if (ids.some((x) => known[path]?.has(x))) remove.push(path);
  }
  // A mod's helpers before its main.js: each save reloads the mod.
  write.sort((a, b) => (a.endsWith("/main.js") - b.endsWith("/main.js")) || a.localeCompare(b));
  return { write, remove, kept };
}

// What the app writes into a layout file itself (clicks, the globe), per node.
const VOLATILE = ["size", "hidden", "active", "background"];
const ROOT_VOLATILE = ["terminal_opacity"];
const nodes = (n, out = {}) => {
  if (n && typeof n === "object" && n.id) out[n.id] = n;
  for (const c of n?.children ?? []) nodes(c, out);
  return out;
};
// A layout's structure, comparable across those writes (and float noise).
export function skeleton(json) {
  const strip = (v, root) => {
    if (Array.isArray(v)) return v.map((x) => strip(x));
    if (typeof v === "number") return Math.round(v * 100) / 100;
    if (!v || typeof v !== "object") return v;
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if ("type" in v && VOLATILE.includes(k)) continue;
      if (root && ROOT_VOLATILE.includes(k)) continue;
      if (k === "pane" && v.tab) { const { background, ...rest } = v.pane ?? {}; out[k] = strip(rest); continue; }
      out[k] = strip(v[k]);
    }
    return out;
  };
  return JSON.stringify(strip(json, true));
}
// The new layout with this install's sizes, panel state and globe carried over.
export function carry(next, live) {
  const out = JSON.parse(JSON.stringify(next));
  const had = nodes(live);
  for (const [id, node] of Object.entries(nodes(out))) {
    const was = had[id];
    if (!was) continue;
    for (const k of VOLATILE) { if (k in was) node[k] = was[k]; else delete node[k]; }
    const pane = node.content?.pane, wasPane = was.content?.pane;
    if (pane && wasPane) { if ("background" in wasPane) pane.background = wasPane.background; else delete pane.background; }
  }
  for (const k of ROOT_VOLATILE) { if (k in live) out[k] = live[k]; else delete out[k]; }
  return out;
}

// keys.json: adds the keys `after` has that `before` didn't, where the person has none.
export function addKeys(user, before, after) {
  const out = JSON.parse(JSON.stringify(user ?? {}));
  const added = [];
  for (const [section, keys] of Object.entries(after ?? {})) {
    for (const [key, action] of Object.entries(keys ?? {})) {
      if (before?.[section] && key in before[section]) continue;
      if (out[section] && key in out[section]) continue;
      (out[section] ??= {})[key] = action;
      added.push(key);
    }
  }
  return { keys: out, added };
}

// ---- the update ----

const git = async (repo, args, timeout = 60000) => {
  const r = await exec("git", ["-C", repo, ...args], { timeout });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").at(-1) || `git ${args[0]} failed`);
  return r.stdout;
};
const readJson = async (path) => { try { return JSON.parse(await fs.readFile(path, "utf8")); } catch { return null; } };
const parent = (path) => path.slice(0, path.lastIndexOf("/"));

// One look at the release branch. Returns what happened:
// { state: "dev" | "off" | "current" | "updated" | "error", commit?, wrote?, kept?, error? }.
// opts: home (default appHome()), url, branch, check (run herdr-app check, default true),
// shown (Commander is the layout on screen: its live tree is read and layout.set shows the
// new one; default: so for the app's own home), setLayout (replaces that layout.set).
export async function update(opts = {}) {
  const home = opts.home ?? appHome();
  const url = opts.url ?? UPDATE.url, branch = opts.branch ?? UPDATE.branch;
  if (await fs.exists(`${home}/.commander-dev`)) return { state: "dev" };
  if (!opts.force && shared("commander.update") === "off") return { state: "off" };
  const shown = opts.shown ?? (!opts.home && shared("layout") === "commander");
  const dir = `${home}/.commander-update`, repo = `${dir}/repo`;
  try {
    if (!(await fs.exists(`${repo}/.git`))) {
      await fs.mkdir(dir, { recursive: true });
      const r = await exec("git", ["clone", "-q", "-c", "core.autocrlf=false", "-c", "core.eol=lf",
        "--branch", branch, "--single-branch", url, repo], { timeout: 180000 });
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").at(-1) || "git clone failed");
    } else {
      await git(repo, ["fetch", "-q", "--prune", "origin"], 120000);
      await git(repo, ["reset", "-q", "--hard", `origin/${branch}`]);
    }
    await git(repo, ["clean", "-q", "-fdx"]);
    const head = (await git(repo, ["rev-parse", "HEAD"])).trim();
    const statePath = `${dir}/state.json`;
    const state = (await readJson(statePath)) ?? {};
    if (state.commit === head) return { state: "current", commit: head };

    const tree = parseTree(await git(repo, ["ls-tree", "-r", "HEAD"]));
    const known = parseHistory(await git(repo, ["log", "-m", "--raw", "--no-abbrev", "--no-renames", "--format=", "HEAD", "--",
      "layouts", "themes", "mods", "backgrounds"], 120000));
    const local = {};
    for (const path of new Set([...Object.keys(tree), ...Object.keys(known)])) {
      const file = `${home}/${path}`;
      local[path] = (await fs.exists(file)) ? localIds(await fs.readFile(file)) : null;
    }
    const { write, remove, kept } = plan(tree, known, local);

    // The layout: replaced when its structure is one the repo has had.
    let layoutNext = null;
    const liveLayout = shown ? layout() : await readJson(`${home}/${LAYOUT}`);
    if (tree[LAYOUT]) {
      const next = JSON.parse(await git(repo, ["cat-file", "blob", tree[LAYOUT]]));
      if (!liveLayout) layoutNext = next;
      else if (skeleton(liveLayout) !== skeleton(next)) {
        const mine = skeleton(liveLayout);
        let past = false;
        for (const id of known[LAYOUT] ?? []) {
          try { if (skeleton(JSON.parse(await git(repo, ["cat-file", "blob", id]))) === mine) { past = true; break; } } catch {}
        }
        if (past) layoutNext = carry(next, liveLayout);
        else kept.push(LAYOUT);
      }
    }

    // A mod that doesn't load on this Herdr waits for the next release.
    const mods = [...new Set(write.filter((p) => p.startsWith("mods/")).map((p) => p.split("/").slice(0, 2).join("/")))];
    if (opts.check !== false) {
      for (const mod of mods) {
        let r;
        try { r = await exec("herdr-app", ["check", `${repo}/${mod}`], { timeout: 60000 }); } catch { break; }
        if (r.code !== 0) throw new Error(`${mod.slice(5)} doesn't load on this Herdr: ${(r.stderr || r.stdout).trim().split("\n").at(-1)}`);
      }
      await git(repo, ["clean", "-q", "-fdx"]);
    }

    // keys.json: only keys this release adds.
    let keysAdded = [];
    if (state.commit) {
      const before = await git(repo, ["show", `${state.commit}:keys.json`]).then(JSON.parse).catch(() => null);
      const after = await readJson(`${repo}/keys.json`);
      const user = await readJson(`${home}/keys.json`);
      if (before && after && (user || !(await fs.exists(`${home}/keys.json`)))) {
        const { keys, added } = addKeys(user, before, after);
        if (added.length) { await fs.writeFile(`${home}/keys.json`, JSON.stringify(keys, null, 2) + "\n"); keysAdded = added; }
      }
    }

    const said = state.commit
      ? (await git(repo, ["log", "--format=%s", `${state.commit}..HEAD`]).catch(() => "")).trim().split("\n").filter(Boolean)
      : [];
    const changed = write.length + remove.length + (layoutNext ? 1 : 0) + keysAdded.length;
    const copy = async (path) => {
      await fs.mkdir(parent(`${home}/${path}`), { recursive: true });
      await fs.writeFile(`${home}/${path}`, await fs.readFile(`${repo}/${path}`));
    };
    // New files first (the new layout may name a new mod), then the layout, then the
    // bar's own files: saving those reloads this very script. The state is written
    // last, so a run cut short there finds nothing left to do and just records it.
    const bar = write.filter((p) => p.startsWith("mods/cmdr-menubar/"));
    for (const path of write) if (!bar.includes(path)) await copy(path);
    for (const path of remove) {
      await fs.unlink(`${home}/${path}`);
      try { if (!(await fs.readdir(parent(`${home}/${path}`))).length) await fs.rmdir(parent(`${home}/${path}`)); } catch {}
    }
    if (layoutNext) {
      if (opts.setLayout) await opts.setLayout(layoutNext);
      else if (shown) run("layout.set", { layout: layoutNext });
      else await fs.writeFile(`${home}/${LAYOUT}`, JSON.stringify(layoutNext, null, 2) + "\n");
    }
    if (changed && opts.quiet !== true) {
      const body = [said.slice(0, 3).join(" · ") || `${changed} files`];
      if (kept.length) body.push(`Kept your edits to ${kept.map((p) => p.split("/").slice(-2).join("/")).slice(0, 3).join(", ")}${kept.length > 3 ? "…" : ""}.`);
      if (keysAdded.length) body.push(`New keys: ${keysAdded.join(", ")}.`);
      notify({ title: "Commander updated", body: body.join("\n"), level: "info" });
    }
    for (const path of bar) await copy(path);
    await fs.writeFile(statePath, JSON.stringify({ commit: head, at: Date.now(), kept }, null, 2) + "\n");
    return { state: changed ? "updated" : "current", commit: head, wrote: write.length, removed: remove.length, layout: Boolean(layoutNext), kept };
  } catch (e) {
    return { state: "error", error: String(e?.message ?? e) };
  }
}
