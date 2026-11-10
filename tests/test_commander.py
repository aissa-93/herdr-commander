import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

class TodoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='herdr-fix-test-')
        self.addCleanup(self.temp.cleanup)
        self.env = {**os.environ, 'HOME': self.temp.name}
        self.env.pop('HC_TERMINAL_ID', None)

    def ask(self, *args, success=True):
        r = subprocess.run(['python3', str(ROOT/'mods/cmdr-todo/herdr-todo.py'), '--space', 'test', '--agent', 'test-agent', '--json', *args], env=self.env, text=True, capture_output=True)
        self.assertEqual(r.returncode, 0 if success else 1, r.stderr)
        return json.loads(r.stdout)

    def repeated(self):
        self.ask('add','Check build')
        self.ask('done','1')
        result=self.ask('add','Check build')['items']
        self.assertTrue(all(e.get('id') for e in result), 'each item needs a persistent identity')
        return result

    def test_readded_item_can_be_completed_independently(self):
        old, new = self.repeated()
        items=self.ask('done','--id',new['id'])['items']
        self.assertEqual([e['state'] for e in items],['done','done'])
        self.assertEqual([e['id'] for e in items],[old['id'],new['id']])

    def test_edit_and_delete_select_the_clicked_duplicate(self):
        old,new=self.repeated()
        items=self.ask('edit','--id',new['id'],'Check deployment')['items']
        self.assertEqual([e['text'] for e in items],['Check build','Check deployment'])
        items=self.ask('rm','--id',old['id'])['items']
        self.assertEqual([e['text'] for e in items],['Check deployment'])
        self.assertEqual(items[0]['id'],new['id'])

    def test_stale_id_never_targets_a_different_item(self):
        item=self.ask('add','One')['items'][0]
        self.assertTrue(item.get('id'), 'item must have an id')
        self.ask('rm','--id',item['id']);self.ask('add','One')
        result=self.ask('done','--id',item['id'],success=False)
        self.assertEqual(result['items'][0]['state'],'open')

    def test_ambiguous_exact_text_is_rejected(self):
        self.ask('add','Check build');self.ask('done','1');self.ask('add','Check build')
        result=self.ask('done','--exact','Check build',success=False)
        self.assertIn('matches',result['error'])
        self.assertEqual([e['state'] for e in result['items']],['done','open'])

    def test_legacy_markdown_and_agent_metadata_survive_migration(self):
        folder=Path(self.temp.name)/'.herdr/todos';folder.mkdir(parents=True)
        (folder/'test.md').write_text('# My list\n\n- [/] Existing <!-- agent:t1 tab:tab1 -->\n- [ ] Other\n')
        first=self.ask('json')['items'];second=self.ask('json')['items']
        self.assertTrue(all(e.get('id') for e in first),'legacy items need ids')
        self.assertEqual(first,second)
        self.assertEqual((first[0]['text'],first[0]['agent'],first[0]['tab']),('Existing','t1','tab1'))
        self.assertEqual(self.ask('done','2')['items'][1]['state'],'done')

class MoveTests(unittest.TestCase):
    def test_terminal_can_move_to_tab_when_its_sibling_is_a_mod(self):
        spec=importlib.util.spec_from_file_location('herdr_move',ROOT/'mods/cmdr-tabs/herdr-move.py')
        move=importlib.util.module_from_spec(spec);spec.loader.exec_module(move)
        source={'id':'source','active':True,'terminals':[{'pane':'terminal-pane','terminal':'t1'}]}
        space={'id':'space','active':True,'tabs':[source]}
        calls=[]
        def do(command,**args):
            calls.append((command,args))
            return {'tab':'new-tab','pane':'new-pane'} if command=='terminal.keep' else {'ok':True}
        def pane(p):
            if p=='terminal-pane':return space,source,source['terminals'][0]
            if p=='new-pane':return space,{'id':'new-tab'},{'pane':p,'terminal':'t1'}
            return None,None,None
        with patch.object(move,'find_pane',side_effect=pane),patch.object(move,'world',return_value=[space]),patch.object(move,'do',side_effect=do),patch.object(move,'wait'),contextlib.redirect_stdout(io.StringIO()):
            try:
                move.main(['tab','terminal-pane','mod-pane'])
            except SystemExit as e:
                self.fail(f'mod sibling should allow the move: {e}')
        self.assertIn(('pane.focus',{'pane':'mod-pane'}),calls)
        self.assertIn(('terminal.keep',{'terminal':'t1','place':'tab'}),calls)
        self.assertIn(('tab.move',{'id':'new-tab','index':2}),calls)

if __name__=='__main__':unittest.main()
