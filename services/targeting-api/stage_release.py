"""Stage one immutable, validated Atlas targeting-data release.

This is the supported hand-off from any data build system to the targeting
service. Inputs are named explicitly so the official release path never relies
on a developer's home directory or a hidden working-directory convention.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from data_release import REQUIRED_ASSETS, validate_release


def _sources(values: list[str]) -> dict[str, Path]:
    sources: dict[str, Path] = {}
    for value in values:
        if "=" not in value:
            raise ValueError("each --source must use asset-name=/absolute/or/relative/path")
        name, raw_path = value.split("=", 1)
        if name not in REQUIRED_ASSETS:
            raise ValueError(f"unknown release asset: {name}")
        if name in sources:
            raise ValueError(f"duplicate release asset: {name}")
        path = Path(raw_path).expanduser().resolve()
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"source asset is missing or empty: {name}")
        sources[name] = path
    missing = [name for name in REQUIRED_ASSETS if name not in sources]
    if missing:
        raise ValueError(f"missing release source assets: {', '.join(missing)}")
    return sources


def _validate_provenance(value: object) -> dict:
    if not isinstance(value, dict) or not isinstance(value.get("sources"), list) or not value["sources"]:
        raise ValueError("release provenance needs a non-empty sources list")
    for source in value["sources"]:
        if not isinstance(source, dict) or not all(isinstance(source.get(key), str) and source[key].strip() for key in ("id", "license", "extracted_at")):
            raise ValueError("each provenance source needs id, license, and extracted_at")
        try:
            datetime.fromisoformat(source["extracted_at"].replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("provenance extracted_at must be ISO-8601") from error
    return value


def _provenance(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("invalid release provenance JSON") from error
    return _validate_provenance(value)


def stage_release(output_dir: Path, sources: dict[str, Path], provenance: dict) -> dict:
    """Copy explicit assets into a new directory, validate them, and return its manifest."""
    output_dir = output_dir.expanduser().resolve()
    provenance = _validate_provenance(provenance)
    if output_dir.exists():
        raise ValueError("release output already exists; use a new release directory")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".atlas-release-", dir=output_dir.parent) as raw_temp:
        staged = Path(raw_temp) / output_dir.name
        for name in REQUIRED_ASSETS:
            destination = staged / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(sources[name], destination)
        report = validate_release(staged)
        report["provenance"] = provenance
        (staged / "release.manifest.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        os.replace(staged, output_dir)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage a validated, immutable Atlas targeting-data release")
    parser.add_argument("--output", type=Path, required=True, help="new release directory; it must not already exist")
    parser.add_argument("--source", action="append", default=[], metavar="ASSET=PATH", help="repeat once for every required asset")
    parser.add_argument("--provenance", type=Path, required=True, help="JSON documenting each source's id, license, and extraction time")
    args = parser.parse_args()
    try:
        report = stage_release(args.output, _sources(args.source), _provenance(args.provenance))
    except ValueError as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps({"ok": True, "release_id": report["release_id"], "targets": report["targets"]["rows"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
