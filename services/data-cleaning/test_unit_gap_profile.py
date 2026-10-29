"""Value readers of the unit-gap profile against the inventory's own readers: python3 -m unittest test_unit_gap_profile
(from services/data-cleaning)."""
import pathlib
import re
import sys
import unittest

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from unit_evidence_inventory import digits, floor_of  # noqa: E402
from unit_gap_profile import building_digits, valid_floor  # noqa: E402

VALUES = ['1234', '1234.0', ' 1234.0 ', '0', '0.0', '', 'none', 'NaN', 'null', '12 34', '7358', '1234.5', '12340', None]
FLOORS = ['0', '0.0', '1', '1.0', 'GF', 'g', 'B1', 'M', 'L2', 'L-1', 'mezzanine', 'open', '', 'nan', 'none', '12', None]


def sql(expr, value):
    return duckdb.connect().execute(f'select {expr} from (select ?::varchar as x)', [value]).fetchone()[0]


class BuildingNumberTests(unittest.TestCase):
    def test_decimal_suffix_is_dropped(self):
        self.assertEqual(sql(building_digits('x'), '1234.0'), '1234')
        self.assertEqual(sql(building_digits('x'), '1234'), '1234')
        self.assertNotEqual(sql(building_digits('x'), '1234.0'), '12340')

    def test_same_value_as_inventory_digits(self):
        for value in VALUES:
            with self.subTest(value=value):
                expected = re.sub(r'[^0-9]', '', digits(value)) or None
                self.assertEqual(sql(building_digits('x'), value), expected)


class FloorTests(unittest.TestCase):
    def test_same_verdict_as_inventory_floor_of(self):
        for value in FLOORS:
            with self.subTest(value=value):
                expected = floor_of({'floor': value}) is not None
                self.assertEqual(bool(sql(valid_floor('x'), value)), expected)


if __name__ == '__main__':
    unittest.main()
