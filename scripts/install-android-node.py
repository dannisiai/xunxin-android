"""Install the pinned Android Node runtime; does not build or run the application."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Use an existing archive instead of downloading it")
    parser.add_argument("--install-toolchain", action="store_true", help="Install pinned NDK/CMake with sdkmanager (CI)")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    config = json.loads((root / "android-shell/node-runtime.json").read_text(encoding="utf-8"))
    version = (root / ".nvmrc").read_text(encoding="ascii").strip()
    if version != config["nodeVersion"] or config["flavor"] != "full":
        raise SystemExit("The project Node version and Android full-runtime configuration must agree")
    app = (root / "android-shell/app").resolve()
    target = app / "libnode"
    # Only the ignored vendor directory may be replaced; never follow an existing link.
    if target.is_symlink() or target.resolve() != target or not target.resolve().is_relative_to(app):
        raise SystemExit("Node runtime destination is outside the expected Android app directory")
    with tempfile.TemporaryDirectory(prefix=".node-runtime-", dir=app) as temporary:
        work = Path(temporary).resolve()
        archive = args.archive.resolve() if args.archive else work / "nodejs-mobile.zip"
        if not args.archive:
            with urllib.request.urlopen(config["url"], timeout=180) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
        digest = hashlib.sha256()
        with archive.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != config["sha256"]:
            raise SystemExit("Node.js Mobile archive SHA-256 does not match the pinned release")
        payload = work / "runtime"
        payload.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                name = PurePosixPath(member.filename)
                if name.is_absolute() or ".." in name.parts or "\\" in member.filename or ":" in member.filename:
                    raise SystemExit("Invalid path in Node.js Mobile archive")
                if ((member.external_attr >> 16) & 0o170000) == 0o120000:
                    raise SystemExit("Unexpected link in Node.js Mobile archive")
                if not (payload / member.filename).resolve().is_relative_to(payload):
                    raise SystemExit("Node archive entry is outside the staging directory")
            bundle.extractall(payload)
        header = payload / "include/node/node_version.h"
        text = header.read_text(encoding="utf-8")
        parts = [re.search(r"#define NODE_" + key + r"_VERSION\s+(\d+)", text) for key in ("MAJOR", "MINOR", "PATCH")]
        if any(part is None for part in parts) or ".".join(part.group(1) for part in parts) != version:
            raise SystemExit("Node headers do not match the pinned project version")
        for abi in config["abis"]:
            if not (payload / "bin" / abi / "libnode.so").is_file():
                raise SystemExit(f"Node.js Mobile archive is missing {abi}/libnode.so")
        if args.install_toolchain:
            sdkmanager = shutil.which("sdkmanager")
            if not sdkmanager:
                raise SystemExit("sdkmanager is required to install the Android native toolchain")
            subprocess.run([sdkmanager, "ndk;" + config["ndkVersion"], "cmake;" + config["cmakeVersion"]], check=True)
        # All archive checks complete before replacing the previous runtime.
        if target.exists():
            shutil.rmtree(target)
        payload.rename(target)
    print(f"Installed Node.js Mobile {config['mobileVersion']} ({config['flavor']}) at {target}")


if __name__ == "__main__":
    main()
