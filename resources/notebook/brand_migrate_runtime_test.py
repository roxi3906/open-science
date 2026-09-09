import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("brand_migration", Path(__file__).with_name("brand_migrate_runtime.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class RuntimeMigrationTest(unittest.TestCase):
    def seed(self, root):
        source = Path(root) / "OpenScience" / "runtime" / "envs" / "analysis"
        (source / "conda-meta").mkdir(parents=True)
        (source / "conda-meta" / "history").write_text("# cmd: create --prefix " + str(source) + "\n")
        (source / "bin").mkdir()
        (source / "bin" / "analysis-tool").write_text("#!" + str(source) + "/bin/python\nprint('analysis')\n")
        extra = source / "lib" / "python3.12" / "site-packages" / "pip_only_package.py"
        extra.parent.mkdir(parents=True)
        extra.write_text("VALUE = 42\n")
        return source, Path(root) / "Open-Science" / "runtime" / "envs" / "analysis", extra

    def test_preserves_untracked_packages_and_rewrites_scripts_without_shared_files(self):
        with tempfile.TemporaryDirectory(prefix="open-science-runtime-test-") as root:
            source, target, extra = self.seed(root)
            original = (source / "bin" / "analysis-tool").read_bytes()
            with contextlib.redirect_stdout(io.StringIO()):
                migration.relocate(source, target)
            self.assertEqual((source / "bin" / "analysis-tool").read_bytes(), original)
            self.assertEqual((target / "conda-meta" / "history").read_bytes(), (source / "conda-meta" / "history").read_bytes())
            self.assertIn(str(target), (target / "bin" / "analysis-tool").read_text())
            copied = target / extra.relative_to(source)
            self.assertEqual(copied.read_bytes(), extra.read_bytes())
            self.assertNotEqual(copied.stat().st_ino, extra.stat().st_ino)
            copied.write_text("CHANGED = 1\n")
            self.assertEqual(extra.read_text(), "VALUE = 42\n")

    def test_unrelocatable_untracked_binary_leaves_original_environment_intact(self):
        with tempfile.TemporaryDirectory(prefix="open-science-runtime-test-") as root:
            source, target, _ = self.seed(root)
            binary = source / "native-extension.bin"
            contents = b"\x00opaque:" + bytes(str(source), "utf8") + b"\x00"
            binary.write_bytes(contents)
            with self.assertRaisesRegex(ValueError, "previous absolute prefix"):
                migration.relocate(source, target)
            self.assertEqual(binary.read_bytes(), contents)
            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
