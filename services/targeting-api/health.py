"""Minimal readiness checks for the public hosting health endpoint."""
import os


def is_ready(data_path, connection, lock):
    """Check that the primary directory asset is readable and DuckDB responds."""
    if not os.path.isfile(data_path) or not os.access(data_path, os.R_OK):
        return False
    try:
        with lock:
            connection.execute("SELECT 1").fetchone()
    except Exception:
        return False
    return True
