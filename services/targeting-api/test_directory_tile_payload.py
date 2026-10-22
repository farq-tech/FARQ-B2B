"""The vector tile contract must never expose directory contact fields."""
import collections
import math
import pathlib
import sys
import threading
import unittest

import mapbox_vector_tile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from directory_tiles import DirectoryTiles  # noqa: E402


def tile_for(lon, lat, zoom):
    size = 2 ** zoom
    x = int((lon + 180) / 360 * size)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * size)
    return x, y


class DirectoryTilePayloadTests(unittest.TestCase):
    def test_leaf_tile_has_only_key_name_and_count(self):
        tiles = DirectoryTiles.__new__(DirectoryTiles)
        tiles.lock = threading.RLock()
        tiles.tiles = collections.OrderedDict()
        tiles.contexts = {
            'a' * 32: (9999999999, [{
                'poi_key': 'poi-1', 'name_ar': 'شركة مقاولات', 'longitude': 46.7, 'latitude': 24.8,
                'location_precision': 'point', 'phone_norm': '966500000000', 'email': 'private@example.test',
            }], 'Riyadh', {}),
        }
        x, y = tile_for(46.7, 24.8, 16)
        decoded = mapbox_vector_tile.decode(tiles.tile('a' * 32, 16, x, y))
        properties = decoded['businesses']['features'][0]['properties']
        self.assertEqual(properties, {'key': 'poi-1', 'name': 'شركة مقاولات', 'count': 1})
        self.assertNotIn('phone', str(decoded))
        self.assertNotIn('email', str(decoded))


if __name__ == '__main__':
    unittest.main()
