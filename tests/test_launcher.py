import unittest
from unittest.mock import patch
import run

class LauncherTests(unittest.TestCase):
    def launch(self, args, saved=False):
        with patch('sys.argv', ['run.py', *args]), patch('run.uvicorn.Server') as server, patch('run.Hosting'), patch('run.saved_lan', return_value=saved), patch('run.lan_addresses',return_value=['192.168.1.12']), patch('builtins.print'):
            run.main()
            server.return_value.run.assert_called_once()
            config = server.call_args.args[0]
            self.assertFalse(config.proxy_headers)
            from editor.server import app
            del app.state.hosting
            return dict(host=config.host, port=config.port)

    def test_default_remains_local(self):
        self.assertEqual(self.launch([]),dict(host='127.0.0.1',port=8787))

    def test_lan_and_custom_port(self):
        self.assertEqual(self.launch(['--lan','--port','8888']),dict(host='0.0.0.0',port=8888))

    def test_specific_interface(self):
        self.assertEqual(self.launch(['--host','192.168.1.12'])['host'],'192.168.1.12')

    def test_saved_lan_and_explicit_local_override(self):
        self.assertEqual(self.launch([], saved=True)['host'], '0.0.0.0')
        self.assertEqual(self.launch(['--local-only'], saved=True)['host'], '127.0.0.1')
