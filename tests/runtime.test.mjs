import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const file = new URL('../mods/cmdr-menubar/runtime.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
function load(exec, localHome = '/home/test') {
  return vm.runInNewContext(`${source}\n({execPython,hostInfo,openUrl});`, { exec, home: () => localHome });
}
const info = (platform = 'linux', executable = '/usr/bin/python3', minor = 13) => ({ code: 0, stdout: JSON.stringify({ platform, executable, version: [3, minor], home: '/home/test' }), stderr: '' });

test('interpreter discovery checks version and caches each target independently', async () => {
  const calls = [];
  const runtime = load(async (cmd, args, options) => {
    calls.push({cmd, args, options});
    if (args.includes('-I')) {
      if (cmd === 'py') throw new Error('missing');
      return info(options.on ? 'win32' : 'linux', options.on ? 'C:/Python/python.exe' : '/usr/bin/python3');
    }
    return { code: 0, stdout: 'ok', stderr: '' };
  });
  await runtime.execPython(['first']); await runtime.execPython(['second']);
  await runtime.execPython(['remote'], {on:'engineer1'});
  assert.equal(calls.filter(c => c.args.includes('-I')).length, 4);
  assert.equal(calls.at(-1).cmd, 'C:/Python/python.exe');
  assert.deepEqual(Array.from(calls.at(-1).args), ['-X','utf8','remote']);
  assert.equal((await runtime.hostInfo()).platform, 'linux');
});

test('nonzero helper results never replay a mutation through another Python', async () => {
  let runs = 0;
  const runtime = load(async (cmd,args) => args.includes('-I') ? info() : (++runs, {code:1,stdout:'',stderr:'write failed'}));
  const result = await runtime.execPython(['add','one']);
  assert.equal(result.code,1); assert.equal(runs,1);
});

test('rejects Python 2 and old Python 3, explains missing prerequisite', async () => {
  const runtime = load(async () => info('linux', '/python', 8));
  await assert.rejects(runtime.execPython(['anything']), /Python 3\.9 or newer/);
});

test('local Windows probes per-user interpreters even with an old app PATH', async () => {
  const calls=[];
  const runtime=load(async (cmd,args) => { calls.push(cmd); return args.includes('-I') ? info('win32',cmd) : {code:0,stdout:'',stderr:''}; }, 'C:\\Users\\A Name');
  await runtime.execPython(['hello']);
  assert.match(calls[0], /AppData\/Local\/Programs\/Python\/Python314\/python.exe$/);
});

test('Windows URL launch safely quotes Unicode and shell metacharacters', async () => {
  let call;
  const runtime=load(async (...args) => {call=args;return {code:0};}, 'C:\\Users\\Test');
  const url="https://example.com/é?a=O'Reilly&x=$(bad)";
  await runtime.openUrl(url);
  assert.equal(call[0],'powershell.exe');
  const script=Buffer.from(call[1].at(-1),'base64').toString('utf16le');
  assert.ok(script.includes("'https://example.com/é?a=O''Reilly&x=$(bad)'"));
  assert.ok(!script.includes('-WindowStyle Hidden'), 'a browser opened by a click must be visible');
  await assert.rejects(runtime.openUrl('file:///C:/Windows'), /HTTP/);
});

test('all per-mod runtime copies stay identical', () => {
  const mods = new URL('../mods/', import.meta.url);
  for (const name of fs.readdirSync(mods).filter(n=>n.startsWith('cmdr-') && fs.readFileSync(new URL(`${n}/main.js`,mods),'utf8').includes('from "./runtime.js"'))) {
    assert.equal(fs.readFileSync(new URL(`${name}/runtime.js`,mods),'utf8'),fs.readFileSync(file,'utf8'),name);
  }
});

test('native interpreter runs Unicode source with argument boundaries intact', async () => {
  const runtime=load(async (cmd,args,options) => {
    const result=spawnSync(cmd, Array.from(args), {encoding:'utf8',timeout:10000,windowsHide:true});
    if (result.error) throw result.error;
    return {code:result.status,stdout:result.stdout,stderr:result.stderr};
  }, process.env.USERPROFILE || process.env.HOME);
  const answer=await runtime.execPython(['-c','import json,sys; print(json.dumps(sys.argv[1:],ensure_ascii=False))','C:\\A B\\é','a"b','$(literal)']);
  assert.equal(answer.code,0,answer.stderr);
  assert.deepEqual(JSON.parse(answer.stdout),['C:\\A B\\é','a"b','$(literal)']);
});
