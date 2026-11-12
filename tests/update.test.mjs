import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// The real update.js with Herdr's own calls faked and real git underneath.
const source = fs.readFileSync(new URL('../mods/cmdr-menubar/update.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function load(host = {}) {
  const toasts = [], runs = [];
  const shared = { ...(host.shared ?? {}) };
  const exec = async (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.error) throw r.error;
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const fsShim = { ...fsp, exists: async (p) => fs.existsSync(p) };
  const api = vm.runInNewContext(`${source}\n({update, plan, skeleton, carry, addKeys, localIds, blobId, ours, parseTree, parseHistory});`, {
    exec, appHome: () => host.home, notify: (t) => toasts.push(t), run: (name, args) => runs.push({ name, args }),
    layout: () => host.layout, shared: (k) => shared[k], fs: fsShim, createHash, Uint8Array, JSON, Math, Set, Date,
  });
  return { ...api, toasts, runs, shared };
}
const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
function put(root, files) {
  for (const [p, text] of Object.entries(files)) {
    const file = path.join(root, p);
    if (text === null) { fs.rmSync(file, { force: true }); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2));
  }
}
const read = (root, p) => fs.readFileSync(path.join(root, p), 'utf8');

const layout = (extra = []) => ({
  id: 'root', type: 'column', children: [
    { id: 'menubar', type: 'block', size: { px: 22.22 }, content: { mod: 'cmdr-menubar' } },
    { id: 'main', type: 'block', content: { tab: 'active', pane: { gap: 5.56, background: 'background' } } },
    { id: 'panel', type: 'column', hidden: true, children: [{ id: 'notes', type: 'block', content: { mod: 'cmdr-notes' } }] },
    ...extra,
  ],
});

test('blob ids match git, and Windows line endings are forgiven', () => {
  const u = load();
  assert.equal(u.blobId(new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  const lf = u.localIds(Buffer.from('a\nb\n'));
  const crlf = u.localIds(Buffer.from('a\r\nb\r\n'));
  assert.equal(lf.length, 1);
  assert.equal(crlf[1], lf[0]);
});

test('only Commander files are in scope', () => {
  const u = load();
  for (const p of ['layouts/commander.json', 'themes/commander-navy.json', 'mods/cmdr-tree/main.js', 'backgrounds/commander-earth/001.png'])
    assert.ok(u.ours(p), p);
  for (const p of ['keys.json', 'README.md', 'layouts/main.json', 'mods/files/main.js', 'mods/cmdr-tree', 'tests/x.mjs', 'themes/paper.json'])
    assert.ok(!u.ours(p), p);
});

test('a layout is compared by structure, and keeps its clicks and globe', () => {
  const u = load();
  const live = layout();
  live.children[0].size = { px: 25 };
  delete live.children[2].hidden;
  live.children[1].background = { image: 'backgrounds/commander-earth/355.png' };
  delete live.children[1].content.pane.background;
  live.children[1].content.pane.gap = 5.559999942779541;
  live.terminal_opacity = 0.5;
  assert.equal(u.skeleton(live), u.skeleton(layout()));
  assert.notEqual(u.skeleton(layout([{ id: 'map', type: 'block' }])), u.skeleton(layout()));
  const next = u.carry(layout([{ id: 'map', type: 'block', size: { px: 40 } }]), live);
  assert.equal(next.children[0].size.px, 25);
  assert.equal(next.children[2].hidden, undefined);
  assert.equal(next.children[1].background.image, 'backgrounds/commander-earth/355.png');
  assert.equal(next.children[1].content.pane.background, undefined);
  assert.equal(next.children[3].size.px, 40, 'a new node keeps its own size');
  assert.equal(next.terminal_opacity, 0.5);
});

test('keys: only what a release adds, never over the person\'s', () => {
  const u = load();
  const { keys, added } = u.addKeys(
    { global: { 'ctrl-q': 'app.quit' }, 'layout:commander': { 'ctrl-shift-j': 'mine', 'ctrl-shift-r': 'cmdr-tree.reply' } },
    { 'layout:commander': { 'ctrl-shift-r': 'cmdr-tree.reply', 'ctrl-shift-d': 'cmdr-menubar.todo' } },
    { 'layout:commander': { 'ctrl-shift-r': 'cmdr-tree.reply', 'ctrl-shift-d': 'cmdr-menubar.todo', 'ctrl-shift-j': 'cmdr-tree.project', 'ctrl-shift-y': 'new' } });
  assert.deepEqual(Array.from(added), ['ctrl-shift-y']);
  assert.equal(keys['layout:commander']['ctrl-shift-j'], 'mine');
  assert.equal(keys['layout:commander']['ctrl-shift-d'], undefined, 'a key the person removed stays removed');
  assert.equal(keys.global['ctrl-q'], 'app.quit');
});

test('an install follows the release branch end to end', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-update-'));
  try {
    const work = path.join(tmp, 'work'), origin = path.join(tmp, 'origin.git'), home = path.join(tmp, 'home');
    fs.mkdirSync(work);
    sh(work, 'init', '-q', '-b', 'main');
    sh(work, 'config', 'user.email', 'test@example.com');
    sh(work, 'config', 'user.name', 'Test');
    const v1 = {
      'layouts/commander.json': layout(),
      'themes/commander.json': '{\n  "background": "#000000"\n}\n',
      'mods/cmdr-a/main.js': 'export const v = 1;\n',
      'mods/cmdr-a/ui.js': 'export const ui = 1;\n',
      'mods/cmdr-old/main.js': 'old\n',
      'keys.json': { 'layout:commander': { 'ctrl-shift-r': 'cmdr-tree.reply' } },
      'README.md': 'readme\n',
    };
    put(work, v1);
    sh(work, 'add', '-A'); sh(work, 'commit', '-qm', 'v1');
    sh(tmp, 'clone', '-q', '--bare', work, origin);
    sh(work, 'push', '-q', origin, 'main:release');

    // Installed as the README says, plus the person's own things.
    const install = { ...v1 };
    delete install['keys.json']; delete install['README.md'];
    put(home, install);
    put(home, { 'keys.json': { global: { 'ctrl-q': 'app.quit' }, 'layout:commander': { 'ctrl-shift-r': 'cmdr-tree.reply' } }, 'mods/mine/main.js': 'mine\n' });
    // A Windows checkout's line endings.
    put(home, { 'themes/commander.json': read(home, 'themes/commander.json').replace(/\n/g, '\r\n') });

    const opts = { home, url: origin, branch: 'release', check: false };
    let u = load({ home });
    let r = await u.update(opts);
    assert.equal(r.state, 'current', r.error);
    assert.equal(u.toasts.length, 0, 'a fresh install is quiet');

    // v2: a changed mod, a new one, one dropped, a theme, a key, a layout node.
    put(work, {
      'mods/cmdr-a/main.js': 'export const v = 2;\n',
      'mods/cmdr-a/ui.js': 'export const ui = 2;\n',
      'mods/cmdr-b/main.js': 'new\n',
      'mods/cmdr-old/main.js': null,
      'themes/commander.json': '{\n  "background": "#111111"\n}\n',
      'keys.json': { 'layout:commander': { 'ctrl-shift-r': 'cmdr-tree.reply', 'ctrl-shift-y': 'cmdr-b.go' } },
      'layouts/commander.json': layout([{ id: 'map', type: 'block', content: { mod: 'cmdr-b' } }]),
      'README.md': 'readme 2\n',
    });
    sh(work, 'add', '-A'); sh(work, 'commit', '-qm', 'Add cmdr-b');
    sh(work, 'push', '-q', origin, 'main:release');
    // The person edited one file; the app wrote its clicks into the layout.
    put(home, { 'mods/cmdr-a/ui.js': 'export const ui = "mine";\n' });
    const clicked = layout(); clicked.children[0].size = { px: 25 };
    put(home, { 'layouts/commander.json': clicked });

    u = load({ home });
    r = await u.update(opts);
    assert.equal(r.state, 'updated', r.error);
    assert.equal(read(home, 'mods/cmdr-a/main.js'), 'export const v = 2;\n');
    assert.equal(read(home, 'mods/cmdr-a/ui.js'), 'export const ui = "mine";\n', 'an edited file is kept');
    assert.equal(read(home, 'mods/cmdr-b/main.js'), 'new\n');
    assert.ok(!fs.existsSync(path.join(home, 'mods/cmdr-old')), 'a dropped mod goes, folder and all');
    assert.match(read(home, 'themes/commander.json'), /#111111/);
    assert.equal(read(home, 'mods/mine/main.js'), 'mine\n');
    assert.ok(!fs.existsSync(path.join(home, 'README.md')));
    const keys = JSON.parse(read(home, 'keys.json'));
    assert.equal(keys['layout:commander']['ctrl-shift-y'], 'cmdr-b.go');
    assert.equal(keys.global['ctrl-q'], 'app.quit');
    const lay = JSON.parse(read(home, 'layouts/commander.json'));
    assert.equal(lay.children.at(-1).id, 'map');
    assert.equal(lay.children[0].size.px, 25, 'clicks carried over');
    assert.equal(u.toasts.length, 1);
    assert.match(u.toasts[0].body, /Add cmdr-b/);
    assert.match(u.toasts[0].body, /cmdr-a\/ui\.js/);
    assert.match(u.toasts[0].body, /ctrl-shift-y/);

    r = await u.update(opts);
    assert.equal(r.state, 'current');

    // While Commander is shown the layout goes through the app, from its live tree.
    const shownLive = JSON.parse(read(home, 'layouts/commander.json'));
    put(work, { 'layouts/commander.json': layout([{ id: 'map', type: 'block', content: { mod: 'cmdr-b' } }, { id: 'x', type: 'block' }]) });
    sh(work, 'commit', '-qam', 'v3'); sh(work, 'push', '-q', origin, 'main:release');
    u = load({ home, layout: shownLive });
    r = await u.update({ ...opts, shown: true });
    assert.equal(r.state, 'updated', r.error);
    assert.equal(u.runs.length, 1);
    assert.equal(u.runs[0].name, 'layout.set');
    assert.equal(u.runs[0].args.layout.children.at(-1).id, 'x');

    // A layout the person rebuilt is theirs.
    const mine = layout([{ id: 'own', type: 'block' }]);
    put(home, { 'layouts/commander.json': mine });
    put(work, { 'layouts/commander.json': layout([{ id: 'y', type: 'block' }]) });
    sh(work, 'commit', '-qam', 'v4'); sh(work, 'push', '-q', origin, 'main:release');
    u = load({ home });
    r = await u.update(opts);
    assert.ok(r.kept.includes('layouts/commander.json'));
    assert.equal(JSON.parse(read(home, 'layouts/commander.json')).children.at(-1).id, 'own');

    // Off switches.
    assert.equal((await load({ home, shared: { 'commander.update': 'off' } }).update(opts)).state, 'off');
    put(home, { '.commander-dev': '' });
    assert.equal((await load({ home }).update({ ...opts, force: true })).state, 'dev');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
