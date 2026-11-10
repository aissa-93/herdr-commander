// Projects: the person's own grouping of a machine's spaces (sessions), kept in
// shared state so every layout and every screen of this home shows the same tree.
// A space is filed by its id; a project with no spaces still shows.
// The same file lives in each mod that shows projects (mods can't import across folders).

import { spaces, machines, shared, setShared, run } from "herdr";

export const PROJECTS = "spaces.projects";
const OLD = "overwatch.projects"; // where the first build kept them
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function projects() {
  let p = shared(PROJECTS);
  if (!p || typeof p !== "object") {
    const old = shared(OLD);
    if (old && typeof old === "object") { p = old; setShared(PROJECTS, old); setShared(OLD, null); }
  }
  return p && typeof p === "object" ? { list: Array.isArray(p.list) ? p.list : [], of: p.of ?? {} } : { list: [], of: {} };
}

export function saveProjects(p) {
  // Filings of spaces that are gone go too, but only on machines whose layout is readable.
  const live = new Set(spaces().map((s) => s.id));
  const known = (id) => { const m = id.includes("/") ? id.split("/")[0] : null; return !m || machines().find((k) => k.name === m)?.layout === "ready"; };
  for (const id of Object.keys(p.of)) if (!live.has(id) && known(id)) delete p.of[id];
  setShared(PROJECTS, p);
}

const newId = () => `pj${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function fileSpace(id, pid) {
  const p = projects();
  if (pid) p.of[id] = pid; else delete p.of[id];
  saveProjects(p);
}

export function addProject(name, machine, folder) {
  const p = projects();
  const id = newId();
  p.list.push({ id, name: name.trim() || "Project", machine: machine ?? null, folder: folder || null });
  saveProjects(p);
  return id;
}

export function editProject(id, patch) {
  const p = projects();
  const x = p.list.find((q) => q.id === id);
  if (x) Object.assign(x, patch);
  saveProjects(p);
}

export function removeProject(id) {
  const p = projects();
  p.list = p.list.filter((q) => q.id !== id);
  for (const [s, q] of Object.entries(p.of)) if (q === id) delete p.of[s];
  saveProjects(p);
}

// A new session for a project: space.new says nothing back, so the sidebar
// files the next space to appear on that machine (within a minute, see adopt).
export function newSession(p) {
  setShared("spaces.adopt", { machine: p.machine ?? null, project: p.id, until: Date.now() + 60000 });
  run("space.new", { machine: p.machine ?? "", ...(p.folder ? { folder: p.folder } : {}) });
}

// Called on render with the spaces now and the ids seen last time: files a
// session started by newSession once it appears. Returns the ids to remember.
export function adopt(sp, known) {
  const a = shared("spaces.adopt");
  if (a && typeof a === "object") {
    const fresh = sp.find((s) => !known.has(s.id) && (s.machine ?? null) === (a.machine ?? null));
    if (fresh) { setShared("spaces.adopt", null); fileSpace(fresh.id, a.project); }
    else if (Date.now() > (a.until ?? 0)) setShared("spaces.adopt", null);
  }
  return new Set(sp.map((s) => s.id));
}

// Which project each row is filed under, a worktree row going with its checkout's.
export function filing(rows, list) {
  const pj = projects();
  const ids = new Set(list.map((p) => p.id));
  const out = new Map();
  let top = null;
  for (const r of rows) {
    if (!r.tree) top = ids.has(pj.of[r.w.id]) ? pj.of[r.w.id] : null;
    out.set(r.w.id, top);
  }
  return out;
}
