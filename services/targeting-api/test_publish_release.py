import contextlib
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

import duckdb

from build_release_manifest import build_manifest
from data_release import validate_release, verify_manifest
from publish_release import PUBLISH_LOG, PublishError, check, derive, main, record
import test_data_release


def make_base(releases: Path, name: str) -> Path:
    release = releases / name
    release.mkdir(parents=True)
    test_data_release.DataReleaseTests.make_release(None, release)
    (release / "holder_rfq.json").write_text("{}", encoding="utf-8")
    for csv in ("product_families.csv", "sub_family_relations.csv"):
        (release / "taxonomy" / csv).write_text("id\n1\n", encoding="utf-8")
    (release / "release.manifest.json").write_text(json.dumps(validate_release(release)), encoding="utf-8")
    (release / "manifest.json").write_text(json.dumps(build_manifest(release, name)), encoding="utf-8")
    return release


def snapshot(release: Path) -> dict[str, tuple[bytes, int]]:
    return {
        path.relative_to(release).as_posix(): (path.read_bytes(), path.stat().st_ino)
        for path in sorted(release.rglob("*")) if path.is_file()
    }


class PublishReleaseTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.releases = self.root / "releases"
        self.base = make_base(self.releases, "v7")
        self.replacement = self.root / "street_density.parquet"
        db = duckdb.connect()
        try:
            db.execute("create table corridors(street varchar, shops integer)")
            db.execute("insert into corridors values ('أبي سعيد الخدري', 424)")
            db.execute(f"copy corridors to '{self.replacement}' (format parquet)")
        finally:
            db.close()

    def tearDown(self):
        self._tmp.cleanup()

    def derive_v8(self, base="v7", new="v8"):
        return derive(self.releases, base, new, [f"street_density.parquet={self.replacement}"])

    def age(self, name: str, seconds_ago: int) -> None:
        stamp = time.time() - seconds_ago
        os.utime(self.releases / name, (stamp, stamp))

    def test_derive_leaves_the_base_release_untouched(self):
        before = snapshot(self.base)
        lineage = self.derive_v8()
        self.assertEqual(snapshot(self.base), before)
        new = self.releases / "v8"
        # unchanged assets share the base inode; replaced and generated files have their own
        self.assertEqual((new / "targets.parquet").stat().st_ino, (self.base / "targets.parquet").stat().st_ino)
        for name in ("street_density.parquet", "release.manifest.json", "manifest.json"):
            self.assertNotEqual((new / name).stat().st_ino, (self.base / name).stat().st_ino, name)
        self.assertEqual((new / "street_density.parquet").read_bytes(), self.replacement.read_bytes())
        self.assertEqual(lineage["base_release"], "v7")
        self.assertEqual([item["path"] for item in lineage["replaced"]], ["street_density.parquet"])
        self.assertEqual(json.loads((new / "release.lineage.json").read_text(encoding="utf-8")), lineage)
        verify_manifest(validate_release(new), new / "release.manifest.json")
        self.assertEqual(json.loads((new / "manifest.json").read_text(encoding="utf-8"))["release_id"], "v8")
        self.assertFalse((self.releases / ".v8.partial").exists())

    def test_derive_refuses_an_existing_release_and_generated_names(self):
        self.derive_v8()
        with self.assertRaises(PublishError):
            self.derive_v8()
        with self.assertRaises(PublishError):
            derive(self.releases, "v7", "v9", [f"release.manifest.json={self.replacement}"])

    def test_check_refuses_a_release_built_on_an_older_base(self):
        # the 2026-11-02 incident: v8 is live, the new release was copied from v7
        self.derive_v8(new="v7-fix")
        make_base(self.releases, "v8")
        with self.assertRaises(PublishError) as refused:
            check(self.releases, self.releases / "v8", "v7-fix", force_reason="عاجل")
        self.assertIn("v8", str(refused.exception))
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            code = main(["check", "--releases-root", str(self.releases), "--live", str(self.releases / "v8"), "--new", "v7-fix"])
        self.assertEqual(code, 2)
        self.assertIn("مرفوض", stderr.getvalue())

    def test_check_refuses_when_another_release_was_published_after_the_base(self):
        self.derive_v8(new="v7-fix")
        make_base(self.releases, "v8-unified")
        self.age("v7", 3600)
        self.age("v8-unified", 60)
        with self.assertRaises(PublishError) as refused:
            check(self.releases, self.releases / "v7", "v7-fix")
        self.assertIn("v8-unified", str(refused.exception))

    def test_force_reason_allows_a_newer_sibling_and_prints_the_three_variables(self):
        self.derive_v8(new="v7-fix")
        make_base(self.releases, "v8-abandoned")
        self.age("v7", 3600)
        self.age("v8-abandoned", 60)
        values = check(self.releases, self.releases / "v7/", "v7-fix", force_reason="v8-abandoned فشل التحقق ولن يُنشر")
        target = os.path.join(os.path.abspath(self.releases), "v7-fix")
        self.assertEqual(values, {
            "FARQ_TARGETING_DATA_DIR": target,
            "TARGETING_DATA_DIR": target,
            "FARQ_TARGETING_RELEASE_MANIFEST": os.path.join(target, "release.manifest.json"),
        })

    def test_check_passes_when_built_on_the_live_release_with_no_newer_sibling(self):
        make_base(self.releases, "v6")
        self.age("v6", 7200)
        self.age("v7", 3600)
        self.derive_v8()
        self.assertIn("FARQ_TARGETING_RELEASE_MANIFEST", check(self.releases, self.releases / "v7", "v8"))

    def test_check_refuses_a_release_whose_files_no_longer_match_its_manifest(self):
        self.derive_v8()
        target = self.releases / "v8" / "districts.geojson"
        target.unlink()  # never write through: the base shares this inode
        target.write_text(json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8")
        with self.assertRaises(PublishError):
            check(self.releases, self.releases / "v7", "v8")

    def test_record_appends_one_line_per_switch(self):
        self.derive_v8()
        record(self.releases, "v7", "v8", "ممرات تجارية: البناء الثالث")
        record(self.releases, "v8", "v7", "رجوع")
        lines = (self.releases / PUBLISH_LOG).read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), 2)
        first = json.loads(lines[0])
        self.assertEqual((first["from"], first["to"], first["base"]), ("v7", "v8", "v7"))
        self.assertEqual(first["replaced"], ["street_density.parquet"])
        self.assertEqual(first["reason"], "ممرات تجارية: البناء الثالث")
        self.assertIn("time", first)


if __name__ == "__main__":
    unittest.main()
