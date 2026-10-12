import unittest
from evidence_state import state
NOW='2026-10-12T12:00:00+03:00'
class EvidenceState(unittest.TestCase):
 def test_current(self):self.assertEqual(state(dict(role='BUYER',source_status='active',deadline='2026-10-27T12:00:00+03:00'),NOW),'CURRENT_OPEN')
 def test_expired(self):self.assertEqual(state(dict(role='BUYER',source_status='active',deadline='2026-10-01T12:00:00+03:00'),NOW),'HISTORICAL')
 def test_cancelled(self):self.assertEqual(state(dict(role='BUYER',source_status='cancelled',deadline='2026-11-01T12:00:00+03:00'),NOW),'HISTORICAL')
 def test_observed_today_not_current(self):self.assertEqual(state(dict(role='BUYER',observed_at='2026-10-12'),NOW),'UNKNOWN')
 def test_conflict(self):self.assertEqual(state(dict(role='SELLER',identity_status='CONFLICTED'),NOW),'CONFLICTED')
 def test_potential(self):self.assertEqual(state(dict(role='BUYER',decision='POTENTIAL'),NOW),'POTENTIAL')
