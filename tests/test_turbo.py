import copy
import tempfile
import unittest
from unittest.mock import patch

from editor import cloud, server
from editor.store import Store
from editor.workflows import h3_graph, h3_cloud_graph


class TurboTests(unittest.TestCase):
    def test_queue_lora_and_steps_are_isolated_and_reach_graph(self):
        expected = 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'
        with tempfile.TemporaryDirectory() as root:
            store = Store(root)
            cloud.save_config(store.root, {'api_key': 'test-key'})
            project = next(iter(store.data['projects'].values()))
            segment = project['scenes'][0]['segments'][0]
            segment['prompt'] = 'A quiet landscape'
            segment['steps'] = 20
            original_segment = copy.deepcopy(segment)
            store.data['settings']['models']['h3_model'] = 'user-selected.safetensors'
            settings = copy.deepcopy(store.data['settings'])
            with patch.object(server, 'store', store):
                for target, graph in [('local', h3_graph), ('cloud', h3_cloud_graph)]:
                    for flag in [True, False, None]:
                        with self.subTest(target=target, turbo=flag):
                            body = dict(project_id=project['id'], segment_ids=[segment['id']], inference=target)
                            if flag is not None:
                                body['turbo'] = flag
                            job = server.queue(body)[0]
                            self.assertEqual(job['models'], settings['models'])
                            self.assertEqual(job['spec']['steps'], 4 if flag else 20)
                            for context in [None, 'continuation']:
                                g = graph(job['spec'], [], job['models'], 'test', context)
                                self.assertEqual(g['model']['inputs']['unet_name'], 'user-selected.safetensors')
                                self.assertEqual(g['sigmas']['inputs']['steps'], 4 if flag else 20)
                                if flag:
                                    self.assertEqual(g['turbo_lora']['class_type'], 'LoraLoaderModelOnly')
                                    self.assertEqual(g['turbo_lora']['inputs'], dict(model=['model', 0], lora_name=expected, strength_model=1.0))
                                else:
                                    self.assertNotIn('turbo_lora', g)
                                for key in ['guider', 'sigmas']:
                                    self.assertEqual(g[key]['inputs']['model'], ['turbo_lora' if flag else 'model', 0])
                            self.assertEqual(store.data['settings'], settings)
                            self.assertEqual(segment, original_segment)
                self.assertTrue(store.data['jobs'][0]['spec']['turbo'])
                self.assertEqual(store.data['jobs'][0]['spec']['steps'], 4)
                with self.assertRaisesRegex(ValueError, 'Turbo'):
                    server.queue(dict(project_id=project['id'], segment_ids=[segment['id']], turbo='false'))
