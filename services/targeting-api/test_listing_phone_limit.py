import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from listing_phone_limit import ListingPhoneLimit, valid_listing_id


class ListingPhoneLimitTest(unittest.TestCase):
    def test_limit_is_per_user_persists_and_expires_on_the_rolling_window(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "limits.sqlite3"
            limit = ListingPhoneLimit(path, maximum=2, window_seconds=60)
            user_a = "a" * 64
            user_b = "b" * 64

            self.assertTrue(limit.consume(user_a, now=100)["allowed"])
            self.assertTrue(limit.consume(user_a, now=110)["allowed"])
            blocked = limit.consume(user_a, now=120)
            self.assertEqual(blocked, {"allowed": False, "retry_after_seconds": 40})
            self.assertTrue(limit.consume(user_b, now=120)["allowed"])

            restarted = ListingPhoneLimit(path, maximum=2, window_seconds=60)
            self.assertFalse(restarted.consume(user_a, now=159)["allowed"])
            self.assertTrue(restarted.consume(user_a, now=160)["allowed"])

    def test_concurrent_requests_cannot_exceed_the_limit(self):
        with tempfile.TemporaryDirectory() as root:
            limit = ListingPhoneLimit(Path(root) / "limits.sqlite3", maximum=5, window_seconds=60)
            user = "c" * 64
            with ThreadPoolExecutor(max_workers=12) as pool:
                results = list(pool.map(lambda _: limit.consume(user, now=1000)["allowed"], range(20)))
            self.assertEqual(sum(results), 5)

    def test_viewer_key_must_be_an_opaque_sha256_digest(self):
        with tempfile.TemporaryDirectory() as root:
            limit = ListingPhoneLimit(Path(root) / "limits.sqlite3")
            for invalid in (None, "", "user@example.com", "f" * 63, "g" * 64):
                with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                    limit.consume(invalid)

    def test_listing_identity_is_validated_before_consuming_a_reveal(self):
        self.assertTrue(valid_listing_id("123456789012"))
        for invalid in (None, "", "1.2", "-1", "1234567890123", "٠٥٠١٢٣٤٥٦٧"):
            with self.subTest(invalid=invalid):
                self.assertFalse(valid_listing_id(invalid))


if __name__ == "__main__":
    unittest.main()
