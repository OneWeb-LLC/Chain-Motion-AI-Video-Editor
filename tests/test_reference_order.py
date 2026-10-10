import unittest
from editor.store import ordered_references

class ReferenceOrderTests(unittest.TestCase):
    def test_shared_order_new_and_removed_references(self):
        scene={'refs':['a']};seg={'refs':['b','audio','c'],'ref_order':['c','removed','b','a']}
        self.assertEqual(ordered_references(scene,seg),['c','b','a','audio'])
        self.assertEqual(scene['refs'],['a'])
        self.assertEqual(ordered_references(scene,{'refs':['b']}),['a','b'])
        with self.assertRaises(ValueError):ordered_references(scene,{'refs':[],'ref_order':[{}]})
