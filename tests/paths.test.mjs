import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function mod(name, result, host = {}) {
  const source = fs.readFileSync(new URL(`../mods/${name}/main.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default class', 'class');
  return vm.runInNewContext(`${source}\n${result}`, { View: class {}, ...host });
}

test('usage associates drive and UNC paths with projects across slash and case changes', () => {
  const usage = mod('cmdr-usage', '({pathKey, base, homeLike, claims, owner})', {
    home: () => 'C:\\Users\\Abdul',
    shared: () => ({}),
    spaces: () => [{id: 's1', machine: null, folder: 'Documents\\Codex\\App', tabs: []}],
    panes: () => [],
  });
  const list = usage.claims({list: [{id: 'p1', machine: null, folder: 'Documents\\Codex\\App'}], of: {s1: 'p1'}});
  assert.equal(usage.pathKey('C:\\Users\\ABDUL\\Documents\\Codex\\App\\'), 'c:/users/abdul/documents/codex/app');
  assert.equal(usage.pathKey('C:\\'), 'c:/');
  assert.equal(usage.pathKey('\\\\SERVER\\Share\\App\\'), '//server/share/app');
  assert.equal(usage.base('C:\\Work\\MyApp\\'), 'MyApp');
  assert.equal(usage.homeLike('C:\\Users\\Abdul'), true);
  assert.equal(usage.owner(list, null, 'c:/users/abdul/documents/codex/app/src'), 'p1');
  assert.equal(usage.owner(list, null, 'C:\\Worktrees\\App\\src'), 'p1');
  assert.equal(usage.owner(list, null, 'C:\\Worktrees\\Other'), null);
  const network = [{m: 'remote', folder: usage.pathKey('\\\\SERVER\\Share\\Team'), pid: 'net', own: true}];
  assert.equal(usage.owner(network, 'remote', '//server/share/team/src'), 'net');
  assert.equal(usage.owner(network, 'remote', '//server/share/teammate/src'), null);
  const roots = [
    {m: null, folder: usage.pathKey('C:\\'), pid: 'drive', own: true},
    {m: 'remote', folder: usage.pathKey('\\\\SERVER\\Share\\'), pid: 'share', own: true},
  ];
  assert.equal(usage.owner(roots, null, 'c:/Projects/App'), 'drive');
  assert.equal(usage.owner(roots, 'remote', '//server/share'), 'share');
  assert.equal(usage.owner(roots, 'remote', '\\\\server\\share\\App'), 'share');
  assert.equal(usage.owner(roots, 'remote', '//server/shared/App'), null);
});

test('usage keeps POSIX paths case sensitive and home folders narrow', () => {
  const usage = mod('cmdr-usage', '({pathKey, homeLike, owner})', {home: () => '/home/abdul'});
  const list = [{m: null, folder: '/home/abdul/App', pid: 'app', own: true}];
  assert.equal(usage.owner(list, null, '/home/abdul/App/src'), 'app');
  assert.equal(usage.owner(list, null, '/home/abdul/app/src'), null);
  assert.equal(usage.homeLike('/home/abdul'), true);
  assert.equal(usage.homeLike('/home/abdul/App'), false);
});

test('tree identifies a native Windows repo and its worktree', async () => {
  let top = 'C:\\Code\\Project';
  const calls = [];
  const tree = mod('cmdr-tree', '({Tree, pathKey, base})', {
    exec: async (_exe, args, options) => {
      calls.push(options);
      if (args[0] === '--no-optional-locks') return {code: 0, stdout: '# branch.head main\n'};
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return {code: 0, stdout: `${top}\n`};
      return {code: 0, stdout: 'c:/code/project/.git\n'};
    },
  });
  const instance = new tree.Tree();
  instance.git = {}; instance.checked = {}; instance.unsure = new Set();
  instance.prDue = () => {}; instance.watch = () => {};
  const key = JSON.stringify([null, 'C:\\Code\\Project']);
  await instance.check(key, {});
  assert.equal(instance.git[key].name, 'project');
  assert.equal(instance.git[key].linked, false);
  assert.equal(instance.git[key].repo, JSON.stringify([null, 'c:/code/project/.git']));
  assert.equal(calls[0].cwd, 'C:\\Code\\Project');
  top = 'C:\\Worktrees\\feature';
  const worktree = JSON.stringify([null, top]);
  await instance.check(worktree, {});
  assert.equal(instance.git[worktree].linked, true);
  assert.equal(instance.git[worktree].repo, instance.git[key].repo);
  assert.equal(tree.base('\\\\Server\\Share\\Repo\\.git'), '.git');
});

test('map tries native curl.exe then curl without requiring Python', async () => {
  const calls = [];
  let nativeAvailable = true;
  const {locate} = mod('cmdr-map', '({locate})', {
    exec: async (exe, args, options) => {
      calls.push({exe, args, options});
      if (exe === 'curl.exe' && !nativeAvailable) throw new Error('not found');
      return {code: 0, stdout: JSON.stringify({loc: '35.1,-106.6', city: 'Albuquerque'})};
    },
  });
  assert.equal((await locate(null)).city, 'Albuquerque');
  assert.equal(calls[0].exe, 'curl.exe');
  nativeAvailable = false;
  await locate('remote');
  assert.equal(calls[1].exe, 'curl.exe');
  assert.equal(calls[2].exe, 'curl');
  assert.equal(calls[2].options.on, 'remote');
});

test('map uses its second service after both executable attempts fail', async () => {
  const calls = [];
  const {locate} = mod('cmdr-map', '({locate})', {
    exec: async (exe, args) => {
      calls.push([exe, args.at(-1)]);
      if (args.at(-1).includes('ipinfo.io')) return {code: 22, stderr: 'failed'};
      return {code: 0, stdout: JSON.stringify({latitude: 35.1, longitude: -106.6, city: 'Albuquerque'})};
    },
  });
  assert.equal((await locate(null)).city, 'Albuquerque');
  assert.equal(calls.length, 3);
  assert.ok(calls[2][1].includes('ipapi.co'));
});
