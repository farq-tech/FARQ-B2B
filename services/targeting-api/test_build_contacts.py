# -*- coding: utf-8 -*-
"""Tests for build_contacts: Saudi number normalisation + contact delta logic."""
import unittest

import build_contacts as bc
import status_policy as sp


class TestNormalizeSaudi(unittest.TestCase):
    def test_mobile_forms_all_reach_e164(self):
        for raw in ('+966590677277', '966590677277', '0590677277',
                    '590677277', '00966590677277', '+966 59 067 7277'):
            self.assertEqual(bc.normalize_saudi(raw), ('966590677277', 'mobile'), raw)

    def test_landline_forms(self):
        self.assertEqual(bc.normalize_saudi('+966114726561'), ('966114726561', 'landline'))
        self.assertEqual(bc.normalize_saudi('0114726561'), ('966114726561', 'landline'))
        self.assertEqual(bc.normalize_saudi('114726561'), ('966114726561', 'landline'))

    def test_unified_and_tollfree(self):
        self.assertEqual(bc.normalize_saudi('966920002449'), ('966920002449', 'unified'))
        self.assertEqual(bc.normalize_saudi('9668007547777'), ('9668007547777', 'unified'))

    def test_junk_is_rejected_never_fabricated(self):
        for raw in ('997', '2727975', '2790038-4650068', '92001111', '', None, 'abc', '12345'):
            self.assertEqual(bc.normalize_saudi(raw), (None, None), raw)

    def test_fake_area_code_rejected(self):
        # 15/18/19 are not real KSA geographic area codes -> not a landline
        self.assertEqual(bc.normalize_saudi('966150000000'), (None, None))

    def test_agrees_with_status_policy_mobile_of(self):
        # whatever we call a mobile, status_policy.mobile_of must accept, and vice-versa
        for raw in ('0590677277', '+966504990279', '966568884108', '114726561', '997', '920'):
            num, kind = bc.normalize_saudi(raw)
            mo = sp.mobile_of({'phone_norm': raw})
            if kind == 'mobile':
                self.assertEqual(num, mo, raw)
            else:
                self.assertIsNone(mo, raw)


class TestWhatsappState(unittest.TestCase):
    def test_states(self):
        self.assertEqual(bc.whatsapp_state(True), 'source_flag_unverified')
        self.assertEqual(bc.whatsapp_state(False), 'not_available')
        self.assertEqual(bc.whatsapp_state(None), 'not_available')
        self.assertEqual(bc.whatsapp_state(True, '2026-01-01', 'surveyor'), 'verified')

    def test_matches_status_policy(self):
        for hw in (True, False, None):
            row = {'has_whatsapp': hw}
            self.assertEqual(bc.whatsapp_state(hw), sp.whatsapp_state(row))


class TestContactDelta(unittest.TestCase):
    def test_fill_empty_from_landline(self):
        d = bc.contact_delta({'poi_key': 'k1', 'phone_norm': '', 'phone_landline': '0114726561',
                              'extra_phones': None, 'has_whatsapp': False})
        self.assertEqual(d['phone_norm_fill'], '966114726561')
        self.assertEqual(d['contact_source'], 'phone_landline:landline')
        self.assertEqual(d['whatsapp_state'], 'not_available')

    def test_fill_empty_from_landline_col_mobile(self):
        d = bc.contact_delta({'poi_key': 'k2', 'phone_norm': '', 'phone_landline': '553388333',
                              'extra_phones': None, 'has_whatsapp': True})
        self.assertEqual(d['phone_norm_fill'], '966553388333')
        self.assertEqual(d['contact_source'], 'phone_landline:mobile')
        self.assertEqual(d['whatsapp_state'], 'source_flag_unverified')

    def test_flip_landline_primary_to_extra_mobile(self):
        d = bc.contact_delta({'poi_key': 'k3', 'phone_norm': '966114726561',
                              'phone_landline': None, 'extra_phones': '966112294477; 966508444409',
                              'has_whatsapp': True})
        self.assertEqual(d['phone_norm_fill'], '966508444409')  # the mobile, not the landline token
        self.assertEqual(d['contact_source'], 'extra_phones:mobile')
        self.assertEqual(d['whatsapp_state'], 'source_flag_unverified')

    def test_no_change_when_primary_already_mobile(self):
        self.assertIsNone(bc.contact_delta({'poi_key': 'k4', 'phone_norm': '966508444409',
                                             'phone_landline': None, 'extra_phones': '966112294477',
                                             'has_whatsapp': True}))

    def test_no_change_when_nothing_usable(self):
        self.assertIsNone(bc.contact_delta({'poi_key': 'k5', 'phone_norm': '',
                                             'phone_landline': '997', 'extra_phones': None,
                                             'has_whatsapp': False}))

    def test_landline_primary_without_extra_mobile_is_untouched(self):
        self.assertIsNone(bc.contact_delta({'poi_key': 'k6', 'phone_norm': '966114726561',
                                            'phone_landline': None, 'extra_phones': '966112294477',
                                            'has_whatsapp': False}))


if __name__ == '__main__':
    unittest.main()
