import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from editor.hosting import Hosting, is_local, saved_lan


class HostingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.old_listener = Mock()
        self.server = SimpleNamespace(config=SimpleNamespace(host='127.0.0.1', port=8787), servers=[self.old_listener])
        self.hosting = Hosting(self.server, self.tmp.name, lambda: ['192.168.1.10'])
        self.hosting.bind = AsyncMock(side_effect=lambda host: Mock())

    async def test_switch_and_persist_without_restarting_workers(self):
        self.assertFalse(saved_lan(self.tmp.name))
        status = await self.hosting.change(True)
        self.old_listener.close.assert_called_once()
        self.assertTrue(status['lan'])
        self.assertEqual(status['urls'], ['http://192.168.1.10:8787'])
        self.assertEqual(self.server.config.host, '0.0.0.0')
        self.assertTrue(saved_lan(self.tmp.name))
        status = await self.hosting.change(False)
        self.assertFalse(status['lan'])
        self.assertFalse(saved_lan(self.tmp.name))
        self.assertEqual(self.server.config.host, '127.0.0.1')
        self.assertEqual(status['urls'], [])

    async def test_bind_failure_restores_listener_and_saved_mode(self):
        restored = Mock()
        self.hosting.bind.side_effect = [OSError('Address in use'), restored]
        with self.assertRaisesRegex(ValueError, 'Could not change'):
            await self.hosting.change(True)
        self.assertEqual(self.server.servers, [restored])
        self.assertFalse(self.hosting.lan)
        self.assertFalse(saved_lan(self.tmp.name))
        self.assertEqual(self.hosting.bind.call_args.args, ('127.0.0.1',))

    async def test_bad_flag_does_not_change_listener(self):
        with self.assertRaises(ValueError):
            await self.hosting.change('false')
        self.old_listener.close.assert_not_called()

    async def test_save_failure_restores_listener(self):
        (Path(self.tmp.name) / 'hosting.json.tmp').mkdir()
        with self.assertRaisesRegex(ValueError, 'Could not save'):
            await self.hosting.change(True)
        self.assertFalse(self.hosting.lan)
        self.assertEqual(self.hosting.bind.call_args.args, ('127.0.0.1',))

    def test_loopback_and_corrupt_preferences(self):
        for host in ['127.0.0.1', '::1', '::ffff:127.0.0.1']:
            self.assertTrue(is_local(host))
        for host in ['192.168.1.10', '0.0.0.0', 'garbage']:
            self.assertFalse(is_local(host))
        (Path(self.tmp.name) / 'hosting.json').write_text('invalid')
        self.assertFalse(saved_lan(self.tmp.name))
