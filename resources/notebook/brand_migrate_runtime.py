"""Copy a conda prefix to its final name without changing the source environment.

Invoked with -I -S: user site packages and .pth files must not run during migration.
The vendored packer is pinned and licensed in vendor/conda-pack-source.json.
"""
import json
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))
import conda_pack  # noqa: E402


def verify_macos_native(path, original):
    if sys.platform != "darwin":
        return
    with path.open("rb") as stream:
        magic = stream.read(4)
    if magic not in (b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"):
        return
    def codesign(*args):
        return subprocess.run(["/usr/bin/codesign", *args], capture_output=True, text=True, timeout=30)
    if codesign("--verify", str(path)).returncode == 0:
        return
    # dest_prefix packs rewrite Mach-O bytes without the unpack-time signing hook. Only renew a
    # verified ad-hoc source signature; never replace an identity-backed third-party signature.
    details = codesign("--display", "--verbose=2", str(original))
    if codesign("--verify", str(original)).returncode or "Signature=adhoc" not in details.stderr.splitlines():
        raise ValueError("A relocated native file requires a signing identity: " + str(path))
    signed = codesign("--force", "--sign", "-", "--preserve-metadata=identifier,entitlements,flags,runtime", str(path))
    if signed.returncode or codesign("--verify", str(path)).returncode:
        raise ValueError("Could not verify the relocated native signature: " + str(path))


def relocate(source, destination):
    source, destination = Path(os.path.abspath(source)), Path(os.path.abspath(destination))
    if source.resolve() == destination.resolve() or source.resolve() in destination.resolve().parents or destination.exists():
        raise ValueError("Runtime migration destination must be a new, separate directory")
    if not (source / "conda-meta" / "history").is_file():
        raise ValueError("Runtime has no conda ownership metadata")
    destination.parent.mkdir(parents=True, exist_ok=True)
    archive_fd, archive_path = tempfile.mkstemp(prefix=".open-science-runtime-", suffix=".tar", dir=destination.parent)
    os.close(archive_fd)
    os.unlink(archive_path)
    try:
        environment = conda_pack.CondaEnv.from_prefix(str(source), ignore_missing_files=False, ignore_editable_packages=False)
        # Bytecode embeds source filenames. Regenerate only caches whose Python source is present;
        # bytecode-only distributions are retained and must pass the ordinary relocation checks.
        kept = []
        excluded = []
        for entry in environment.files:
            source_file = Path(entry.source)
            if source_file.suffix in (".pyc", ".pyo"):
                try:
                    python_source = Path(importlib.util.source_from_cache(str(source_file)))
                except ValueError:
                    python_source = source_file.with_suffix(".py")
                if python_source.is_file() and not python_source.is_symlink():
                    excluded.append(entry)
                    continue
            kept.append(entry)
        environment = conda_pack.CondaEnv(environment.prefix, kept, excluded_files=excluded)
        # A UTF-8-decodable binary can still contain NULs. Treat untracked native files conservatively
        # instead of allowing a text substitution to shift their binary offsets.
        for entry in environment.files:
            if entry.is_conda or not os.path.isfile(entry.source) or os.path.islink(entry.source):
                continue
            with open(entry.source, "rb") as stream:
                overlap = b""
                contains_null = False
                contains_prefix = False
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    contains_null |= b"\x00" in chunk
                    contains_prefix |= os.fsencode(str(source)) in overlap + chunk
                    overlap = chunk[-max(1, len(os.fsencode(str(source))) - 1):]
                if contains_null and contains_prefix:
                    raise ValueError("An untracked native file retains its previous absolute prefix: " + entry.target)
        environment.pack(output=archive_path, format="tar", dest_prefix=str(destination), verbose=False)
        destination.mkdir()
        # Validate all members before writing any. Absolute links into this environment are rebased;
        # foreign links fail closed instead of letting extraction escape the private destination.
        with tarfile.open(archive_path, "r:") as archive:
            members = archive.getmembers()
            for member in members:
                path = Path(member.name)
                if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                    raise ValueError("Unsafe runtime archive entry")
                if member.issym() or member.islnk():
                    link = Path(member.linkname)
                    if link.is_absolute():
                        try:
                            mapped = destination / link.relative_to(source)
                        except ValueError:
                            raise ValueError("Runtime contains an external absolute symbolic link")
                        member.linkname = os.path.relpath(mapped, (destination / path).parent)
                        link = Path(member.linkname)
                    base = (destination / path).parent if member.issym() else destination
                    resolved = (base / link).resolve()
                    if resolved != destination.resolve() and destination.resolve() not in resolved.parents:
                        raise ValueError("Runtime link escapes the migrated prefix")
            # Reject a symlink used as the parent of another archive entry, independently of order.
            symlinks = {Path(m.name) for m in members if m.issym()}
            for member in members:
                if any(parent in symlinks for parent in Path(member.name).parents):
                    raise ValueError("Runtime archive writes through a symbolic link")
            if hasattr(tarfile, "data_filter"):
                archive.extractall(destination, members=members, filter="data")
            else:
                archive.extractall(destination, members=members)
        old_prefix = os.fsencode(str(source))
        # conda-pack deliberately leaves opaque untracked binaries alone. Do not commit a copy
        # whose executable still embeds the old prefix; it needs explicit environment repair.
        for directory, _, filenames in os.walk(destination, followlinks=False):
            for filename in filenames:
                path = Path(directory) / filename
                if path.is_symlink():
                    continue
                # Conda's append-only audit history records the original installation command.
                # It is provenance, never an executable prefix binding; preserve it byte for byte.
                if path.relative_to(destination) == Path("conda-meta/history"):
                    continue
                with path.open("rb") as stream:
                    overlap = b""
                    while True:
                        chunk = stream.read(1024 * 1024)
                        if not chunk:
                            break
                        data = overlap + chunk
                        if old_prefix in data:
                            raise ValueError("A runtime file retains its previous absolute prefix: " + str(path.relative_to(destination)))
                        overlap = data[-max(1, len(old_prefix) - 1):]
                verify_macos_native(path, source / path.relative_to(destination))
        print(json.dumps({"status": "verified", "prefix": str(destination)}))
    except BaseException:
        if destination.exists():
            shutil.rmtree(destination)
        raise
    finally:
        if os.path.exists(archive_path):
            os.unlink(archive_path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise ValueError("Expected source and destination prefixes")
    relocate(sys.argv[1], sys.argv[2])
