import copy
import tempfile
import unittest
from unittest.mock import patch
from fastapi import UploadFile
from editor import cloud, server
from editor.store import Store, segment, generation_order


class MotionLinks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = Store(self.tmp.name)
        self.p = next(iter(self.store.data['projects'].values()))
        self.target = self.p['scenes'][0]['segments'][0]
        self.target['prompt'] = 'Continue motion'
        self.source = segment('Source in another scene')
        self.source['prompt'] = 'Begin motion'
        sc = copy.deepcopy(self.p['scenes'][0])
        sc.update(id='second-scene', name='Second scene', segments=[self.source])
        self.p['scenes'].append(sc)
        self.target['continuation_segment'] = self.source['id']

    def test_local_and_cloud_queue_source_first_without_reordering_timeline(self):
        cloud.save_config(self.store.root, {'api_key': 'test-only'})
        before = copy.deepcopy(self.p)
        for inference in ['local', 'cloud']:
            with self.subTest(inference=inference), patch.object(server, 'store', self.store):
                jobs = server.queue(dict(project_id=self.p['id'], segment_ids=[self.target['id'], self.source['id']], inference=inference))
                self.assertEqual([j['segment_id'] for j in jobs], [self.source['id'], self.target['id']])
                self.assertEqual(jobs[1]['dependency'], jobs[0]['id'])
                self.assertEqual(self.p, before)

    def test_link_to_trimmed_import_encodes_before_continuing(self):
        self.source.update(type='video', main='video', duration=3, trim_in=1)
        self.store.data['assets']['video'] = dict(id='video', kind='video', duration=5, name='Imported video')
        with patch.object(server, 'store', self.store):
            jobs = server.queue(dict(project_id=self.p['id'], segment_ids=[self.target['id']]))
        self.assertEqual([j['kind'] for j in jobs], ['encode', 'segment'])
        self.assertEqual(jobs[0]['spec']['trim_in'], 1)
        self.assertEqual(jobs[0]['spec']['duration'], 3)
        self.assertEqual(jobs[1]['dependency'], jobs[0]['id'])

    def test_cycles_and_missing_links_are_rejected(self):
        for source in [self.target['id'], 'missing']:
            self.target['continuation_segment'] = source
            with self.assertRaises(ValueError):
                generation_order(self.p)
        self.target['continuation_segment'] = self.source['id']
        self.source['continuation_segment'] = self.target['id']
        with self.assertRaisesRegex(ValueError, 'cycle'):
            generation_order(self.p)

    def test_previous_mode_crosses_scene_boundary(self):
        self.target['continuation_segment'] = None
        self.source['connected'] = True
        _, sources = generation_order(self.p)
        self.assertEqual(sources[self.source['id']]['id'], self.target['id'])

    def test_portable_project_preserves_remapped_links(self):
        with patch.object(server, 'store', self.store):
            exported = server.export_project(self.p['id'])
            with open(exported.path, 'rb') as file:
                imported = server.import_project(UploadFile(file=file, filename='linked.zip'))
        target = imported['scenes'][0]['segments'][0]
        source = imported['scenes'][1]['segments'][0]
        self.assertNotEqual(source['id'], self.source['id'])
        self.assertEqual(target['continuation_segment'], source['id'])
