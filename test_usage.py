import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

SCRIPT = Path(__file__).parent / 'mods/cmdr-usage/usage.py'

class UsageChecks(unittest.TestCase):
    def scan(self, records):
        with tempfile.TemporaryDirectory() as task_home:
            root = Path(task_home)
            logs = root / '.claude/projects'
            logs.mkdir(parents=True)
            (logs / 'fixture.jsonl').write_text('\n'.join(json.dumps(x) for x in records))
            result = io.StringIO()
            with patch('os.path.expanduser', return_value=task_home), patch.dict(os.environ, {'XDG_CACHE_HOME': str(root / 'cache')}), contextlib.redirect_stdout(result):
                runpy.run_path(str(SCRIPT), run_name='__main__')
            return json.loads(result.getvalue())

    def answer(self, i, model='claude-opus-4-1', **usage):
        return {'type': 'assistant', 'timestamp': datetime.now(timezone.utc).isoformat(),
                'cwd': f'/projects/{i}', 'requestId': f'req-{i}',
                'message': {'id': f'msg-{i}', 'model': model, 'usage': usage}}

    def test_all_folders_are_included_in_project_totals(self):
        data = self.scan([self.answer(i, input_tokens=1000000) for i in range(61)])
        self.assertEqual(len(data['places']), 61)
        self.assertEqual(sum(p[2] for p in data['places']), 61000000)

    def test_opus_4_and_4_1_use_their_own_rates(self):
        for model in ('claude-opus-4-20250514', 'claude-opus-4-1-20250805'):
            with self.subTest(model=model):
                data = self.scan([self.answer(0, model, input_tokens=1000000, output_tokens=1000000,
                    cache_creation_input_tokens=2000000, cache_read_input_tokens=1000000,
                    cache_creation={'ephemeral_1h_input_tokens':1000000,'ephemeral_5m_input_tokens':1000000})])
                self.assertAlmostEqual(data['cost'][1], 140.25)

    def test_codex_write_estimate_uses_documented_default_lifetime(self):
        source = SCRIPT.read_text().split('home = os.path.expanduser')[0]
        scope = {}
        exec(source, scope)
        for model, expected in [('gpt-6-astra', 12.5), ('gpt-6.1-sol', 2.5), ('gpt-6.1-terra', 1.25)]:
            with self.subTest(model=model):
                self.assertEqual(scope['cost'](model, 0, 0, 1000000, 0, 0, False), expected)

if __name__ == '__main__':
    unittest.main()
