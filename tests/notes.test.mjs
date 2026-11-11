import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// GPUI runs in Herdr, so replace only its host boundary. The real Notes class
// handles every edit, save, space switch, and conflict under test.
const source = fs.readFileSync(new URL('../mods/cmdr-notes/main.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default class', 'class');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
function host(files = new Map(), store = new Map()) {
  const pending = [];
  const cx = {notify() {}, spawn(f) { const p = f(cx); pending.push(p); return p; }, timer: {every() {}, after() {}}};
  const runtime = {
    View: class {}, grid: () => ({text: 14}), settings: () => ({}), appHome: () => '/app',
    localStorage: {getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k)},
    readTextFile: async p => files.get(p) ?? null,
    async writeTextFile(p, text, expected) {
      if (runtime.gate) { const gate = runtime.gate; runtime.gate = null; await gate.promise; }
      if ((files.get(p) ?? null) !== expected) throw new Error('stale snapshot');
      files.set(p, text);
    },
    EditorState: {new({value}) {
      let text = value; let change;
      return {value: () => text, set_value(v) { text = v; change?.(null,cx); }, on(e,f) { if(e==='change') change=f; }, release() {}};
    }},
  };
  const Notes = vm.runInNewContext(source + '\nNotes', runtime);
  const note = new Notes(); note.init(null,cx);
  return {note, runtime, cx, files, store};
}
const path = s => `/app/notes/${s}.md`;

test('typing during a save is eventually written, not marked clean prematurely', async () => {
  const h=host(new Map([[path('A'),'original']])); await h.note.open('A',h.cx);
  h.note.state.set_value('first'); h.runtime.gate=deferred(); const gate=h.runtime.gate;
  const saving=h.note.save(); h.note.state.set_value('latest'); gate.resolve(); await saving;
  assert.ok(h.note.dirty || h.files.get(path('A'))==='latest','newer typing must stay dirty until saved');
  await h.note.save(); assert.equal(h.files.get(path('A')),'latest');
});

test('a conflict preserves both the file and a recoverable per-space draft', async () => {
  const h=host(new Map([[path('A'),'original']])); await h.note.open('A',h.cx);
  h.note.state.set_value('my draft'); h.files.set(path('A'),'external edit'); await h.note.save();
  assert.equal(h.files.get(path('A')),'external edit'); assert.equal(h.note.state.value(),'my draft'); assert.equal(h.note.dirty,true);
  await h.note.open('B',h.cx); assert.equal(h.note.tab,'B');
  const restored=host(h.files,h.store); await restored.note.open('A',restored.cx);
  assert.equal(restored.note.state.value(),'my draft'); await restored.note.save();
  assert.equal(h.files.get(path('A')),'external edit');
});

test('a space switch drains an in-flight save without writing old text into the next file', async () => {
  const h=host(new Map([[path('A'),'original'],[path('B'),'B notes']])); await h.note.open('A',h.cx);
  h.note.state.set_value('first'); h.runtime.gate=deferred();const gate=h.runtime.gate;
  const saving=h.note.save(); h.note.state.set_value('latest');const opening=h.note.open('B',h.cx);
  gate.resolve(); await Promise.all([saving,opening]);
  assert.equal(h.files.get(path('A')),'latest'); assert.equal(h.files.get(path('B')),'B notes');assert.equal(h.note.state.value(),'B notes');
});

test('keeping a draft requires an explicit choice and still detects later external edits', async () => {
  const h=host(new Map([[path('A'),'original']]));await h.note.open('A',h.cx);
  h.note.state.set_value('mine');h.files.set(path('A'),'theirs');await h.note.save();
  h.files.set(path('A'),'their newer edit');await h.note.resolve(false,h.cx);
  assert.equal(h.files.get(path('A')),'their newer edit');assert.equal(h.note.dirty,true);
  await h.note.resolve(false,h.cx);
  assert.equal(h.files.get(path('A')),'mine');assert.equal(h.note.dirty,false);
});

test('using the file version explicitly discards the draft', async () => {
  const h=host(new Map([[path('A'),'original']]));await h.note.open('A',h.cx);
  h.note.state.set_value('mine');h.files.set(path('A'),'theirs');await h.note.save();
  await h.note.resolve(true,h.cx);
  assert.equal(h.note.state.value(),'theirs');assert.equal(h.note.dirty,false);
  const reopened=host(h.files,h.store);await reopened.note.open('A',reopened.cx);assert.equal(reopened.note.state.value(),'theirs');
});

test('space following cannot replace the editor during conflict resolution', async () => {
  const h=host(new Map([[path('A'),'original'],[path('B'),'B notes']]));await h.note.open('A',h.cx);
  h.note.state.set_value('mine');h.files.set(path('A'),'theirs');await h.note.save();
  const diskRead=deferred();const reading=deferred();
  const read=h.runtime.readTextFile;
  h.runtime.readTextFile=async p=>{if(p===path('A')){reading.resolve();await diskRead.promise;}return read(p);};
  const resolving=h.note.resolve(true,h.cx);await reading.promise;
  await h.note.open('B',h.cx);diskRead.resolve();await resolving;
  assert.equal(h.note.tab,'A');assert.equal(h.note.state.value(),'theirs');
  await h.note.open('B',h.cx);assert.equal(h.note.state.value(),'B notes');
});

test('using the file cannot discard typing entered after the choice', async () => {
  const h=host(new Map([[path('A'),'original']]));await h.note.open('A',h.cx);
  h.note.state.set_value('mine');h.files.set(path('A'),'theirs');await h.note.save();
  const diskRead=deferred();const reading=deferred();const read=h.runtime.readTextFile;
  h.runtime.readTextFile=async p=>{reading.resolve();await diskRead.promise;return read(p);};
  const resolving=h.note.resolve(true,h.cx);await reading.promise;
  h.note.state.set_value('typed after choosing');diskRead.resolve();await resolving;
  assert.equal(h.note.state.value(),'typed after choosing');assert.equal(h.note.dirty,true);
  assert.equal(h.files.get(path('A')),'theirs');
  const restored=host(h.files,h.store);await restored.note.open('A',restored.cx);
  assert.equal(restored.note.state.value(),'typed after choosing');
});
