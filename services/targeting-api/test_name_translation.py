"""English names learned from the directory's Arabic/English pairs, and measured before use."""
import unittest

import name_translation as nt

PAIRS = ([('صيدلية النور', 'Al Noor Pharmacy')] * 4 + [('مطعم الراجحي', 'Al Rajhi Restaurant')] * 4
         + [('بقالة الخير', 'Al Khair Grocery')] * 3 + [('ستاربكس', 'Starbucks')] * 5 + [('مؤسسة سعيد للتجارة', 'Saeed Trading Est.')] * 3)


class TranslatorTests(unittest.TestCase):
    def setUp(self):
        self.tr = nt.Translator().learn(PAIRS)

    def test_a_known_name_is_written_as_the_directory_writes_it(self):
        self.assertEqual(self.tr.translate('ستاربكس'), ('Starbucks', 'known_name'))

    def test_words_are_translated_and_the_business_word_goes_last(self):
        self.assertEqual(self.tr.translate('مطعم النور'), ('Al Noor Restaurant', 'translated'))
        self.assertEqual(self.tr.translate('صيدلية الراجحي'), ('Al Rajhi Pharmacy', 'translated'))

    def test_prefixed_business_words(self):
        self.assertEqual(self.tr.translate('شركة الخير للمقاولات')[0], 'Al Khair Company Contracting')

    def test_unknown_words_fall_back_to_vowel_rules_and_say_so(self):
        self.assertEqual(nt.transliterate_word('النور'), 'Al Noor')
        self.assertEqual(nt.transliterate_word('سعيد'), 'Saeed')
        self.assertEqual(nt.transliterate_word('الرياض'), 'Al Riyadh')
        self.assertEqual(nt.transliterate_word('زمزم'), 'Zamzam')
        self.assertEqual(nt.transliterate_word('عبدالكريم'), 'Abdul Kareem')
        self.assertEqual(self.tr.translate('مطعم شمس')[1], 'partly_transliterated')

    def test_a_rare_or_disputed_spelling_is_not_learned(self):
        tr = nt.Translator().learn([('النخبة', 'Al Nokhba')] * 2 + [('النخبة', 'Elite')] * 2)
        self.assertNotIn(nt.key('النخبة'), tr.proper)

    def test_quality_is_measured_on_held_out_names(self):
        report = nt.evaluate(PAIRS * 10, holdout=3)
        self.assertTrue(report)
        for scores in report.values():
            self.assertLessEqual(scores['exact'], 1)


if __name__ == '__main__':
    unittest.main()
