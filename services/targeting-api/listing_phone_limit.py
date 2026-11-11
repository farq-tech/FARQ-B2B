"""Persistent per-user limits for deliberate advertiser-phone reveals."""

import math
import re
import sqlite3
import time
from pathlib import Path


def valid_listing_id(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9]{1,12}", value))


class ListingPhoneLimit:
    def __init__(self, path, maximum=20, window_seconds=3600):
        self.path = Path(path)
        self.maximum = maximum
        self.window_seconds = window_seconds

    def consume(self, viewer_hash, now=None):
        if not isinstance(viewer_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", viewer_hash):
            raise ValueError("viewer")
        if not isinstance(self.maximum, int) or self.maximum < 1 or not isinstance(self.window_seconds, int) or self.window_seconds < 1:
            raise ValueError("limit")
        now = time.time() if now is None else float(now)
        cutoff = now - self.window_seconds
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path, timeout=10) as connection:
            connection.execute("PRAGMA busy_timeout = 10000")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS listing_phone_reveals (
                    viewer_hash TEXT NOT NULL,
                    revealed_at REAL NOT NULL
                )
            """)
            connection.execute("CREATE INDEX IF NOT EXISTS listing_phone_reveals_by_user ON listing_phone_reveals(viewer_hash, revealed_at)")
            connection.execute("CREATE INDEX IF NOT EXISTS listing_phone_reveals_by_time ON listing_phone_reveals(revealed_at)")
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM listing_phone_reveals WHERE revealed_at <= ?", (cutoff,))
            row = connection.execute(
                "SELECT COUNT(*), MIN(revealed_at) FROM listing_phone_reveals WHERE viewer_hash = ?",
                (viewer_hash,),
            ).fetchone()
            count, oldest = row
            if count >= self.maximum:
                connection.commit()
                return {"allowed": False, "retry_after_seconds": max(1, math.ceil(oldest + self.window_seconds - now))}
            connection.execute("INSERT INTO listing_phone_reveals(viewer_hash, revealed_at) VALUES (?, ?)", (viewer_hash, now))
            connection.commit()
        return {"allowed": True, "retry_after_seconds": 0}
