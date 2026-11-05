"""Package the Next.js standalone output into an Android asset (build-time only)."""
from pathlib import Path
import hashlib
import os
import shutil
import zipfile

root = Path(__file__).resolve().parent.parent
standalone = root / ".next" / "standalone"
static = root / ".next" / "static"
public = root / "public"
assets = root / "android-shell" / "app" / "build" / "generated" / "xunxin-assets"
if not (standalone / "server.js").is_file() or not static.is_dir():
    raise SystemExit("Next.js standalone build is missing")
assets.mkdir(parents=True, exist_ok=True)
archive_path = assets / "xunxin-server.zip"
with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
    def add_tree(source, target):
        for directory, _, files in os.walk(source, followlinks=True):
            for name in files:
                file = Path(directory) / name
                archive.write(file, (Path(target) / file.relative_to(source)).as_posix())
    add_tree(standalone, ".")
    add_tree(static, ".next/static")
    add_tree(public, "public")
    archive.write(root / "android-shell" / "android-bootstrap.cjs", "android-bootstrap.cjs")
    archive.write(root / "LICENSE", "project-LICENSE")
hash_value = hashlib.sha256()
with archive_path.open("rb") as bundle:
    for block in iter(lambda: bundle.read(1024 * 1024), b""):
        hash_value.update(block)
(assets / "xunxin-bundle-version.txt").write_text(hash_value.hexdigest(), encoding="ascii")
print(f"Bundled standalone application: {archive_path.stat().st_size // (1024 * 1024)} MiB")
