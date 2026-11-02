"""Derive, check and record an Atlas data release without overwriting anyone else's.

Incident 2026-11-02: one team published ``atlas-2026-11-02-v8-unified``; 25 minutes later another publisher
hard-link-copied the OLDER v7 release, swapped one file and repointed the service, silently replacing v8 live.
This tool makes that mistake loud:

* ``derive`` builds a new release as a hard-link copy of a base release, swaps the named files (unlink, then copy,
  so the base is never written through a shared inode), regenerates both manifests the same way (unlink first) and
  writes ``release.lineage.json`` naming the base.
* ``check`` refuses unless the lineage base is the release that is live right now, and unless no other release was
  published after the base was copied (``--force-reason`` overrides the second rule only, with a written reason).
  On success it prints the three service variables to set. Switching them stays a manual, reviewed Railway step.
* ``record`` appends the switch to ``<releases-root>/PUBLISH_LOG.jsonl``.

It reads and writes only under ``--releases-root`` and never contacts Railway or any provider.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from build_release_manifest import build_manifest
from data_release import validate_release, verify_manifest

LINEAGE = "release.lineage.json"
RELEASE_MANIFEST = "release.manifest.json"
FILE_MANIFEST = "manifest.json"
PUBLISH_LOG = "PUBLISH_LOG.jsonl"
GENERATED = frozenset({LINEAGE, RELEASE_MANIFEST, FILE_MANIFEST})


class PublishError(RuntimeError):
    """A refusal with a message meant for the publisher (Arabic)."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _safe_name(value: str, what: str) -> str:
    if not value or value != value.strip() or "/" in value or "\\" in value or value in {".", ".."} or value.startswith("."):
        raise PublishError(f"اسم {what} غير صالح: {value!r}")
    return value


def _safe_relative(value: str) -> str:
    path = PurePosixPath(value)
    if not value or value.startswith("/") or "\\" in value or ".." in path.parts or path == PurePosixPath("."):
        raise PublishError(f"مسار ملف غير صالح داخل الإصدار: {value!r}")
    return path.as_posix()


def _write_fresh(path: Path, text: str) -> None:
    """Write ``text`` to a new inode: a hard link shared with the base release is unlinked, never written through."""
    if path.exists() or path.is_symlink():
        path.unlink()
    path.write_text(text, encoding="utf-8")


def _hardlink_tree(source: Path, target: Path) -> None:
    target.mkdir()
    for root, dirs, files in os.walk(source):
        relative = Path(root).relative_to(source)
        for name in dirs:
            entry = Path(root) / name
            if entry.is_symlink():
                os.symlink(os.readlink(entry), target / relative / name)
            else:
                (target / relative / name).mkdir()
        for name in files:
            entry = Path(root) / name
            if entry.is_symlink():
                os.symlink(os.readlink(entry), target / relative / name)
            else:
                os.link(entry, target / relative / name)


def _parse_replacements(items: list[str]) -> dict[str, Path]:
    replacements: dict[str, Path] = {}
    for item in items:
        name, sep, source = item.partition("=")
        if not sep or not source:
            raise PublishError(f"صيغة --replace هي <اسم الملف>=<مسار المصدر>، وليس {item!r}")
        name = _safe_relative(name)
        if name in GENERATED:
            raise PublishError(f"{name} يُولَّد تلقائياً ولا يُستبدل يدوياً")
        source_path = Path(source)
        if not source_path.is_file():
            raise PublishError(f"ملف المصدر غير موجود: {source}")
        if name in replacements:
            raise PublishError(f"الملف {name} مذكور أكثر من مرة في --replace")
        replacements[name] = source_path
    return replacements


def derive(releases_root: Path, base: str, new: str, replace: list[str]) -> dict:
    base = _safe_name(base, "الإصدار الأساس")
    new = _safe_name(new, "الإصدار الجديد")
    base_dir = releases_root / base
    new_dir = releases_root / new
    if not base_dir.is_dir():
        raise PublishError(f"الإصدار الأساس غير موجود: {base_dir}")
    if new_dir.exists():
        raise PublishError(f"الإصدار {new} موجود مسبقاً؛ الإصدارات لا تُعدَّل بعد إنشائها، اختر اسماً جديداً")
    replacements = _parse_replacements(replace)
    if not replacements:
        raise PublishError("لا ملف للاستبدال: إصدار مطابق للأساس لا يحتاج نشراً")

    staging = releases_root / f".{new}.partial"
    if staging.exists():
        raise PublishError(f"بقايا محاولة سابقة: {staging}؛ راجعها واحذفها يدوياً")
    try:
        _hardlink_tree(base_dir, staging)
        replaced = []
        for name, source in sorted(replacements.items()):
            target = staging / name
            base_file = base_dir / name
            if target.exists() or target.is_symlink():
                target.unlink()
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            replaced.append({
                "path": name,
                "sha256": _sha256(target),
                "bytes": target.stat().st_size,
                "base_sha256": _sha256(base_file) if base_file.is_file() else None,
            })
        for name in GENERATED:
            stale = staging / name
            if stale.exists() or stale.is_symlink():
                stale.unlink()
        lineage = {
            "schema_version": 1,
            "release": new,
            "base_release": base,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "replaced": replaced,
        }
        _write_fresh(staging / LINEAGE, json.dumps(lineage, ensure_ascii=False, indent=2) + "\n")
        report = validate_release(staging)
        _write_fresh(staging / RELEASE_MANIFEST, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        manifest = build_manifest(staging, new)
        _write_fresh(staging / FILE_MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        verify_manifest(validate_release(staging), staging / RELEASE_MANIFEST)
        staging.rename(new_dir)
    except BaseException:
        if staging.exists():
            shutil.rmtree(staging)  # only unlinks this copy's names; the base keeps every inode
        raise
    return lineage


def _read_lineage(release_dir: Path) -> dict:
    try:
        return json.loads((release_dir / LINEAGE).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PublishError(f"لا يوجد {LINEAGE} صالح في {release_dir}؛ ابنِ الإصدار بالأمر derive") from error


def env_values(releases_root: Path, new: str) -> dict[str, str]:
    release_dir = os.path.join(os.path.abspath(releases_root), new)
    return {
        "FARQ_TARGETING_DATA_DIR": release_dir,
        "TARGETING_DATA_DIR": release_dir,
        "FARQ_TARGETING_RELEASE_MANIFEST": os.path.join(release_dir, RELEASE_MANIFEST),
    }


def check(releases_root: Path, live: Path, new: str, force_reason: str | None = None) -> dict[str, str]:
    new = _safe_name(new, "الإصدار الجديد")
    new_dir = releases_root / new
    if not new_dir.is_dir():
        raise PublishError(f"الإصدار الجديد غير موجود: {new_dir}")
    lineage = _read_lineage(new_dir)
    base = lineage.get("base_release")
    live_name = os.path.basename(os.path.normpath(str(live)))
    if base != live_name:
        raise PublishError(
            f"مرفوض: الإصدار {new} مبني على {base}، والإصدار الحي الآن {live_name}. "
            f"النشر سيمحو ما في {live_name}. أعد البناء بالأمر derive --base {live_name}."
        )
    base_dir = releases_root / base
    if not base_dir.is_dir():
        raise PublishError(f"الإصدار الأساس {base} غير موجود تحت {releases_root}")
    base_mtime = base_dir.stat().st_mtime
    newer = sorted(
        entry.name for entry in releases_root.iterdir()
        if entry.is_dir() and not entry.name.startswith(".") and entry.name not in {base, new}
        and entry.stat().st_mtime > base_mtime
    )
    if newer and not (force_reason and force_reason.strip()):
        raise PublishError(
            f"مرفوض: نُشر بعد {base} إصدار أحدث ({', '.join(newer)}). ربما نشره فريق آخر ولم يُوجَّه إليه بعد، "
            "فالنشر الآن قد يمحوه. راجع مع صاحبه، أو أعد البناء عليه، أو مرّر --force-reason بسبب مكتوب."
        )
    try:
        verify_manifest(validate_release(new_dir), new_dir / RELEASE_MANIFEST)
    except ValueError as error:
        raise PublishError(f"مرفوض: بيان الإصدار {new} لا يطابق ملفاته ({error})") from error
    return env_values(releases_root, new)


def record(releases_root: Path, source: str, target: str, reason: str) -> dict:
    target = _safe_name(target, "الإصدار الجديد")
    if not reason or not reason.strip():
        raise PublishError("--reason مطلوب: لماذا نُقلت الخدمة إلى هذا الإصدار؟")
    # a roll-back to a release built before this tool has no lineage; it is still logged
    if not (releases_root / target).is_dir():
        raise PublishError(f"الإصدار {target} غير موجود تحت {releases_root}")
    lineage = _read_lineage(releases_root / target) if (releases_root / target / LINEAGE).is_file() else {}
    entry = {
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "from": source,
        "to": target,
        "base": lineage.get("base_release"),
        "replaced": [item.get("path") for item in lineage.get("replaced", [])],
        "reason": reason.strip(),
    }
    with (releases_root / PUBLISH_LOG).open("a", encoding="utf-8") as log:
        log.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Safe Atlas data-release publishing (derive / check / record)")
    commands = parser.add_subparsers(dest="command", required=True)

    p_derive = commands.add_parser("derive", help="hard-link copy a base release and swap named files")
    p_derive.add_argument("--releases-root", required=True, type=Path)
    p_derive.add_argument("--base", required=True)
    p_derive.add_argument("--new", required=True)
    p_derive.add_argument("--replace", action="append", default=[], metavar="NAME=SOURCE")

    p_check = commands.add_parser("check", help="refuse unless the new release is built on the live one")
    p_check.add_argument("--releases-root", required=True, type=Path)
    p_check.add_argument("--live", required=True, type=Path, help="the release directory the service reads now")
    p_check.add_argument("--new", required=True)
    p_check.add_argument("--force-reason")

    p_record = commands.add_parser("record", help="append the switch to PUBLISH_LOG.jsonl")
    p_record.add_argument("--releases-root", required=True, type=Path)
    p_record.add_argument("--from", dest="source", required=True)
    p_record.add_argument("--to", dest="target", required=True)
    p_record.add_argument("--reason", required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "derive":
            lineage = derive(args.releases_root, args.base, args.new, args.replace)
            print(json.dumps({"ok": True, "lineage": lineage}, ensure_ascii=False, indent=2))
        elif args.command == "check":
            values = check(args.releases_root, args.live, args.new, args.force_reason)
            print("الفحص ناجح. اضبط متغيرات الخدمة يدوياً في Railway على:")
            for key, value in values.items():
                print(f"{key}={value}")
            print(f"ثم سجّل النقل: publish_release.py record --releases-root {args.releases_root} "
                  f"--from {os.path.basename(os.path.normpath(str(args.live)))} --to {args.new} --reason '...'")
        else:
            entry = record(args.releases_root, args.source, args.target, args.reason)
            print(json.dumps({"ok": True, "logged": entry}, ensure_ascii=False))
    except (PublishError, ValueError) as error:
        print(f"خطأ: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
