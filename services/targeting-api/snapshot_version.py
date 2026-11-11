"""The data version every answer is sent with (header X-Data-Version): when the mounted snapshot was built.

A published release writes its build time into release.lineage.json (publish_release.py, `created_at`); a release
staged before lineage existed has only release.manifest.json, whose modification time is when it was written; a bare
data directory (local development, tests) falls back to the newest of its directory assets. The value is an ISO UTC
time to the second, the same for every request while the snapshot is mounted, so a client that kept an answer can tell
that the data under it changed. It names no file, path or person.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

LINEAGE = 'release.lineage.json'
MANIFEST = 'release.manifest.json'
# the directory's own assets, for a snapshot without release files
ASSETS = ('targets.parquet', 'trade_clusters.parquet', 'street_density.parquet', 'districts.geojson')


def _iso(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat(timespec='seconds')


def snapshot_version(data_dir: str) -> str:
    """The snapshot's build time as an ISO UTC string, or '' when the directory holds none of its files."""
    lineage = os.path.join(data_dir, LINEAGE)
    try:
        with open(lineage, encoding='utf-8') as handle:
            created = json.load(handle).get('created_at')
        if isinstance(created, str) and created:
            parsed = datetime.fromisoformat(created.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat(timespec='seconds')
    except (OSError, ValueError, AttributeError):
        pass
    manifest = os.path.join(data_dir, MANIFEST)
    if os.path.isfile(manifest):
        return _iso(os.path.getmtime(manifest))
    times = [os.path.getmtime(path) for path in (os.path.join(data_dir, name) for name in ASSETS) if os.path.isfile(path)]
    return _iso(max(times)) if times else ''
