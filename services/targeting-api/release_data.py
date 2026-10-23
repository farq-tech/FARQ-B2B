"""Fetch and verify one immutable targeting-data release from S3-compatible storage.

This script is deliberately run at container start, never during image build.
The previous active release remains untouched until every required file and hash
in the new manifest has been checked.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any


REQUIRED_FILES = {
    "targets.parquet",
    "holder_rfq.json",
    "poi_taxonomy.parquet",
    "street_density.parquet",
    "trade_clusters.parquet",
    "districts.geojson",
    "taxonomy/farq_taxonomy.json",
    "taxonomy/product_families.csv",
    "taxonomy/sub_family_relations.csv",
}
HEX_64 = re.compile(r"^[0-9a-f]{64}$")


class ReleaseError(RuntimeError):
    pass


def _safe_relative(path: object) -> str:
    if not isinstance(path, str) or not path or path.startswith("/") or "\\" in path:
        raise ReleaseError("manifest contains an unsafe file path")
    normalized = Path(path)
    if normalized == Path(".") or ".." in normalized.parts:
        raise ReleaseError("manifest contains an unsafe file path")
    return normalized.as_posix()


def validate_manifest(manifest: object) -> list[dict[str, Any]]:
    """Validate the small, auditable release manifest before downloading files."""
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise ReleaseError("manifest schema_version must be 1")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ReleaseError("manifest has no files")
    seen: set[str] = set()
    checked: list[dict[str, Any]] = []
    for item in files:
        if not isinstance(item, dict):
            raise ReleaseError("manifest file entry is invalid")
        path = _safe_relative(item.get("path"))
        checksum = item.get("sha256")
        size = item.get("size")
        if path in seen or not isinstance(checksum, str) or not HEX_64.fullmatch(checksum) or not isinstance(size, int) or size < 0:
            raise ReleaseError("manifest file entry is invalid")
        seen.add(path)
        checked.append({"path": path, "sha256": checksum, "size": size})
    missing = sorted(REQUIRED_FILES - seen)
    if missing:
        raise ReleaseError("manifest is missing required data assets: " + ", ".join(missing))
    return checked


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def release_is_valid(root: Path) -> bool:
    try:
        marker = json.loads((root / ".farq_release.json").read_text(encoding="utf-8"))
        entries = validate_manifest(marker.get("manifest"))
        return all((root / entry["path"]).is_file() and (root / entry["path"]).stat().st_size == entry["size"] and sha256_file(root / entry["path"]) == entry["sha256"] for entry in entries)
    except (OSError, ValueError, ReleaseError):
        return False


def _s3_client():
    try:
        import boto3
    except ImportError as error:  # pragma: no cover - image dependency guard
        raise ReleaseError("boto3 is not installed") from error
    endpoint = os.environ.get("AWS_ENDPOINT_URL") or os.environ.get("TARGETING_DATA_S3_ENDPOINT")
    return boto3.client("s3", endpoint_url=endpoint or None)


def _object_key(prefix: str, name: str) -> str:
    return f"{prefix.rstrip('/')}/{name.lstrip('/')}"


def download_release(bucket: str, prefix: str, destination: Path) -> dict[str, Any]:
    client = _s3_client()
    try:
        body = client.get_object(Bucket=bucket, Key=_object_key(prefix, "manifest.json"))["Body"].read()
        manifest = json.loads(body)
        entries = validate_manifest(manifest)
        for entry in entries:
            target = destination / entry["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            client.download_file(bucket, _object_key(prefix, entry["path"]), str(target))
            if target.stat().st_size != entry["size"] or sha256_file(target) != entry["sha256"]:
                raise ReleaseError("downloaded file failed integrity verification: " + entry["path"])
    except ReleaseError:
        raise
    except Exception as error:
        # Never include provider messages because they can contain bucket paths or credentials.
        raise ReleaseError("unable to retrieve the approved data release") from error
    (destination / ".farq_release.json").write_text(json.dumps({"manifest": manifest}, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    return manifest


def bootstrap() -> None:
    data_dir = Path(os.environ.get("TARGETING_DATA_DIR", "/var/lib/farq-targeting/current")).expanduser()
    bucket = (
        os.environ.get("TARGETING_DATA_BUCKET", "").strip()
        or os.environ.get("AWS_S3_BUCKET_NAME", "").strip()
    )
    prefix = os.environ.get("TARGETING_DATA_RELEASE", "").strip().strip("/")
    required = os.environ.get("TARGETING_DATA_REQUIRED", "").lower() in {"1", "true", "yes"}

    if not bucket or not prefix:
        if required:
            raise ReleaseError("TARGETING_DATA_BUCKET and TARGETING_DATA_RELEASE are required in production")
        if release_is_valid(data_dir):
            return
        # Local development may mount a hand-prepared data directory without a manifest.
        if (data_dir / "targets.parquet").is_file():
            return
        raise ReleaseError("no verified targeting data release is available")

    parent = data_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    marker = data_dir / ".farq_release.json"
    try:
        active = json.loads(marker.read_text(encoding="utf-8")) if marker.is_file() else {}
    except ValueError:
        active = {}
    if active.get("bucket") == bucket and active.get("prefix") == prefix and release_is_valid(data_dir):
        return

    stage = Path(tempfile.mkdtemp(prefix="release-", dir=parent))
    try:
        manifest = download_release(bucket, prefix, stage)
        (stage / ".farq_release.json").write_text(
            json.dumps({"bucket": bucket, "prefix": prefix, "manifest": manifest}, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        previous = parent / ".previous"
        if previous.exists() or previous.is_symlink():
            previous.unlink() if previous.is_symlink() or previous.is_file() else shutil.rmtree(previous)
        if data_dir.exists() or data_dir.is_symlink():
            data_dir.rename(previous)
        stage.rename(data_dir)
        if previous.exists():
            shutil.rmtree(previous)
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


if __name__ == "__main__":
    try:
        bootstrap()
    except ReleaseError as error:
        print(f"targeting release bootstrap failed: {error}", file=sys.stderr)
        raise SystemExit(1)
