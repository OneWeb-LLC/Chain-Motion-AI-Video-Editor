import os
import tempfile
import unittest
from pathlib import Path

from editor import satellite
from editor.store import Store


class SatelliteStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['FRAMEFORGE_DATA_ROOT'] = self.tmp.name
        satellite._store_cache.clear()

    def tearDown(self):
        self.tmp.cleanup()
        satellite._store_cache.clear()

    def test_workspace_libraries_are_isolated(self):
        a = satellite.store_for_workspace('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        b = satellite.store_for_workspace('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
        a.data['assets']['x'] = {'id': 'x', 'name': 'only-a'}
        a.save()
        self.assertNotIn('x', b.data['assets'])
        self.assertTrue((Path(self.tmp.name) / 'workspaces').exists())

    def test_invalid_workspace_rejected(self):
        with self.assertRaises(ValueError):
            satellite.store_for_workspace('../escape')


if __name__ == '__main__':
    unittest.main()
