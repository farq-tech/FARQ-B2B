import hashlib
import unittest

from release_data import ReleaseError, REQUIRED_FILES, validate_manifest


def valid_manifest():
    return {
        "schema_version": 1,
        "files": [
            {"path": path, "sha256": hashlib.sha256(path.encode()).hexdigest(), "size": len(path)}
            for path in sorted(REQUIRED_FILES)
        ],
    }


class ReleaseManifestTests(unittest.TestCase):
    def test_accepts_complete_immutable_manifest(self):
        files = validate_manifest(valid_manifest())
        self.assertEqual({row["path"] for row in files}, REQUIRED_FILES)

    def test_rejects_missing_core_asset(self):
        manifest = valid_manifest()
        manifest["files"] = [row for row in manifest["files"] if row["path"] != "targets.parquet"]
        with self.assertRaisesRegex(ReleaseError, "missing required"):
            validate_manifest(manifest)

    def test_rejects_path_traversal(self):
        manifest = valid_manifest()
        manifest["files"][0]["path"] = "../targets.parquet"
        with self.assertRaisesRegex(ReleaseError, "unsafe"):
            validate_manifest(manifest)
