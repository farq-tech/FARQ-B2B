"""Normalisation and phone parsing of the HudHud CR gap audit: python3 -m unittest test_crs_gap_audit (from services/data-cleaning)."""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from crs_gap_audit import VALID, norm, phones, text  # noqa: E402


class PhoneTests(unittest.TestCase):
    def test_mobile_and_landline_in_any_form(self):
        self.assertEqual(phones('+966 55 123 4567'), {'551234567': 'mobile'})
        self.assertEqual(phones('0551234567'), {'551234567': 'mobile'})
        self.assertEqual(phones('{"phone_numbers": ["+966114463611", "0598371899"]}'),
                         {'114463611': 'landline', '598371899': 'mobile'})
        self.assertEqual(phones('920012345'), {'920012345': 'landline'})

    def test_noise_is_not_a_number(self):
        self.assertEqual(phones('1144666310114468028'), {}, 'two numbers run together are not guessed apart')
        self.assertEqual(phones(None), {})
        self.assertEqual(phones('{"phone_numbers": []}'), {})


class NormTests(unittest.TestCase):
    def test_spelling_noise_is_not_a_difference(self):
        self.assertEqual(norm('name_ar', 'مؤسسة  الأمل'), norm('name_ar', 'موسسه الامل'))
        self.assertEqual(norm('website', 'https://www.Farq.sa/'), norm('website', 'farq.sa'))
        self.assertEqual(norm('instagram', 'https://instagram.com/farq_sa?igsh=1'), norm('instagram', '@farq_sa'))
        self.assertEqual(norm('phone', '+966551234567'), norm('phone', '0551234567'))

    def test_empty_markers_and_validation(self):
        self.assertEqual([text(v) for v in (None, 'null', 'NaN', '[]', ' x ')], ['', '', '', '', 'x'])
        self.assertTrue(VALID['national_address']('RCWA3474'))
        self.assertFalse(VALID['national_address']('RCWA347'))
        self.assertFalse(VALID['website']('https://google.com/maps/place/x'))


if __name__ == '__main__':
    unittest.main()
