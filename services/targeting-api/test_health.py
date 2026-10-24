import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

from health import is_ready


class HealthTests(unittest.TestCase):
    def test_requires_a_readable_directory_asset_and_database(self):
        connection = Mock()
        with tempfile.TemporaryDirectory() as raw:
            data = Path(raw) / "targets.parquet"
            self.assertFalse(is_ready(str(data), connection, threading.Lock()))

            data.write_bytes(b"fixture")
            self.assertTrue(is_ready(str(data), connection, threading.Lock()))
            connection.execute.assert_called_once_with("SELECT 1")

    def test_reports_unready_when_database_query_fails(self):
        connection = Mock()
        connection.execute.side_effect = RuntimeError("database unavailable")
        with tempfile.TemporaryDirectory() as raw:
            data = Path(raw) / "targets.parquet"
            data.write_bytes(b"fixture")
            self.assertFalse(is_ready(str(data), connection, threading.Lock()))


if __name__ == "__main__":
    unittest.main()
