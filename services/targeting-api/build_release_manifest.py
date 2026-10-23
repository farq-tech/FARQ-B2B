"""Create the integrity manifest for a prepared targeting-data release.

Run this only against a reviewed local release directory. It never uploads data
or contacts a provider; upload is a separate, access-controlled release step.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from release_data import REQUIRED_FILES, _safe_relative, sha256_file


def build_manifest(data_dir: Path, release_id: str) -> dict:
    entries = []
    for source in sorted(path for path in data_dir.rglob("*") if path.is_file() and path.name != "manifest.json"):
        relative = _safe_relative(source.relative_to(data_dir).as_posix())
        entries.append({"path": relative, "sha256": sha256_file(source), "size": source.stat().st_size})
    found = {entry["path"] for entry in entries}
    missing = sorted(REQUIRED_FILES - found)
    if missing:
        raise ValueError("missing required assets: " + ", ".join(missing))
    return {"schema_version": 1, "release_id": release_id, "files": entries}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a verified targeting-data manifest")
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.data_dir.is_dir() or not args.release_id.strip():
        raise SystemExit("--data-dir must exist and --release-id is required")
    manifest = build_manifest(args.data_dir, args.release_id.strip())
    output = args.output or args.data_dir / "manifest.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)
