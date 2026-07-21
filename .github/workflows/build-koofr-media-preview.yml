#!/usr/bin/env python3
"""
MENCARI MEDOK — PEMBANGUN PREVIEW MEDIA KOOFR

Membaca assets/data/archive.json atau katalog hasil pemindaian,
mengunduh media gambar dari Koofr melalui WebDAV secara read-only,
lalu membuat dua turunan WebP:

- thumbnail: sisi terpanjang maksimum 720 px
- preview: sisi terpanjang maksimum 1800 px

File asli tetap berada di Koofr dan tidak dimasukkan ke repository.
Katalog diperbarui dengan thumbnailUrl dan previewUrl.

Dependensi:
    pip install Pillow pillow-heif
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener


PIPELINE_VERSION = 1

SUPPORTED_EXTENSIONS = {
    "AVIF",
    "BMP",
    "GIF",
    "HEIC",
    "HEIF",
    "JPE",
    "JPEG",
    "JPG",
    "PNG",
    "TIF",
    "TIFF",
    "WEBP",
}

MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_IMAGE_PIXELS = 80_000_000

THUMBNAIL_MAX_EDGE = 720
PREVIEW_MAX_EDGE = 1800

THUMBNAIL_QUALITY = 80
PREVIEW_QUALITY = 86

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
register_heif_opener()


class PreviewError(RuntimeError):
    """Kesalahan yang aman ditampilkan di workflow log."""


@dataclass(frozen=True)
class PreviewFiles:
    """Lokasi dan URL turunan satu media."""

    directory: Path
    thumbnail_path: Path
    preview_path: Path
    thumbnail_url: str
    preview_url: str


def required_environment(name: str) -> str:
    """Mengambil environment variable wajib."""

    value = os.environ.get(name, "").strip()

    if not value:
        raise PreviewError(
            f"Environment variable {name} belum tersedia atau kosong."
        )

    return value


def read_json(path: Path) -> dict[str, Any]:
    """Membaca objek JSON."""

    try:
        with path.open("r", encoding="utf-8") as input_file:
            value = json.load(input_file)
    except FileNotFoundError as error:
        raise PreviewError(
            f"Katalog tidak ditemukan: {path}"
        ) from error
    except json.JSONDecodeError as error:
        raise PreviewError(
            f"Katalog bukan JSON valid: {error}"
        ) from error

    if not isinstance(value, dict):
        raise PreviewError(
            "Root katalog harus berbentuk object."
        )

    return value


def write_json_atomic(
    path: Path,
    value: dict[str, Any],
) -> None:
    """Menulis JSON secara atomik."""

    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")

    with temporary_path.open(
        "w",
        encoding="utf-8",
        newline="\n",
    ) as output_file:
        json.dump(
            value,
            output_file,
            ensure_ascii=False,
            indent=2,
        )
        output_file.write("\n")

    temporary_path.replace(path)


def encode_path_segments(parts: list[str]) -> str:
    """Mengodekan setiap segmen path WebDAV secara aman."""

    return "/".join(
        urllib.parse.quote(
            str(part),
            safe="",
        )
        for part in parts
    )


def split_relative_path(value: str) -> list[str]:
    """Memecah relativePath katalog menjadi segmen aman."""

    normalized = value.replace("\\", "/")

    parts = [
        part
        for part in normalized.split("/")
        if part not in {"", "."}
    ]

    if not parts:
        raise PreviewError(
            "relativePath media kosong."
        )

    if any(part == ".." for part in parts):
        raise PreviewError(
            "relativePath media mengandung parent traversal."
        )

    return parts


def build_source_url(
    base_url: str,
    archive_folder: str,
    region_name: str,
    district_name: str,
    place_folder_name: str,
    relative_path: str,
) -> str:
    """Menyusun URL WebDAV sumber tanpa menyimpannya di katalog."""

    root = base_url.rstrip("/") + "/"

    parts = [
        archive_folder,
        region_name,
        district_name,
        place_folder_name,
        *split_relative_path(relative_path),
    ]

    return root + encode_path_segments(parts)


def make_authorization(
    username: str,
    password: str,
) -> str:
    """Membuat header HTTP Basic Authorization."""

    credentials = f"{username}:{password}".encode("utf-8")

    return (
        "Basic "
        + base64.b64encode(credentials).decode("ascii")
    )


def download_bytes(
    url: str,
    authorization: str,
) -> bytes:
    """Mengunduh satu file Koofr dengan retry terbatas."""

    maximum_attempts = 3

    for attempt in range(1, maximum_attempts + 1):
        request = urllib.request.Request(
            url=url,
            method="GET",
            headers={
                "Authorization": authorization,
                "User-Agent": (
                    "Mencari-Medok-Archive-Preview/1.0"
                ),
                "Accept": "image/*,application/octet-stream",
            },
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=90,
            ) as response:
                content_length = response.headers.get(
                    "Content-Length"
                )

                if (
                    content_length
                    and content_length.isdigit()
                    and int(content_length) > MAX_SOURCE_BYTES
                ):
                    raise PreviewError(
                        "File sumber melebihi batas "
                        f"{MAX_SOURCE_BYTES:,} byte."
                    )

                data = response.read(
                    MAX_SOURCE_BYTES + 1
                )

                if len(data) > MAX_SOURCE_BYTES:
                    raise PreviewError(
                        "File sumber melebihi batas "
                        f"{MAX_SOURCE_BYTES:,} byte."
                    )

                return data

        except urllib.error.HTTPError as error:
            if error.code == 401:
                raise PreviewError(
                    "Autentikasi Koofr ditolak."
                ) from error

            if error.code == 403:
                raise PreviewError(
                    "Koofr menolak akses ke file media."
                ) from error

            if error.code == 404:
                raise PreviewError(
                    "File media tidak ditemukan di Koofr."
                ) from error

            if error.code == 429:
                if attempt >= maximum_attempts:
                    raise PreviewError(
                        "Koofr membatasi permintaan "
                        "(HTTP 429)."
                    ) from error

                retry_after = error.headers.get(
                    "Retry-After"
                )

                wait_seconds = 10 * attempt

                if (
                    retry_after
                    and retry_after.isdigit()
                ):
                    wait_seconds = min(
                        int(retry_after),
                        60,
                    )

                time.sleep(wait_seconds)
                continue

            if 500 <= error.code < 600:
                if attempt >= maximum_attempts:
                    raise PreviewError(
                        "Koofr mengalami gangguan server "
                        f"(HTTP {error.code})."
                    ) from error

                time.sleep(3 * attempt)
                continue

            raise PreviewError(
                "Unduhan WebDAV gagal dengan "
                f"HTTP {error.code}."
            ) from error

        except urllib.error.URLError as error:
            if attempt >= maximum_attempts:
                raise PreviewError(
                    "Tidak dapat mengunduh media dari Koofr: "
                    f"{error.reason}"
                ) from error

            time.sleep(3 * attempt)

    raise PreviewError(
        "Unduhan media gagal setelah beberapa percobaan."
    )


def source_fingerprint(
    media: dict[str, Any],
) -> str:
    """Membuat fingerprint dari metadata sumber."""

    components = [
        str(media.get("id") or ""),
        str(media.get("filename") or ""),
        str(media.get("relativePath") or ""),
        str(media.get("etag") or ""),
        str(media.get("lastModified") or ""),
        str(media.get("sizeBytes") or ""),
    ]

    return hashlib.sha256(
        "\n".join(components).encode("utf-8")
    ).hexdigest()


def validate_media_id(value: Any) -> str:
    """Memastikan media ID aman dipakai sebagai nama file."""

    media_id = str(value or "").strip()

    if not media_id:
        raise PreviewError(
            "Media tidak memiliki id."
        )

    allowed = set(
        "abcdefghijklmnopqrstuvwxyz"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "0123456789-_"
    )

    if any(character not in allowed for character in media_id):
        raise PreviewError(
            f"Media id tidak aman: {media_id!r}"
        )

    return media_id


def preview_files_for_media(
    output_root: Path,
    url_prefix: str,
    media_id: str,
) -> PreviewFiles:
    """Menghasilkan path lokal dan URL publik media."""

    hash_part = (
        media_id.removeprefix("media-")
        or media_id
    )

    bucket = hash_part[:2].lower()

    if (
        len(bucket) != 2
        or any(
            character not in "0123456789abcdef"
            for character in bucket
        )
    ):
        bucket = hashlib.sha256(
            media_id.encode("utf-8")
        ).hexdigest()[:2]

    directory = output_root / bucket

    thumbnail_name = f"{media_id}-thumb.webp"
    preview_name = f"{media_id}-preview.webp"

    normalized_prefix = "/" + url_prefix.strip("/")

    return PreviewFiles(
        directory=directory,
        thumbnail_path=directory / thumbnail_name,
        preview_path=directory / preview_name,
        thumbnail_url=(
            f"{normalized_prefix}/{bucket}/{thumbnail_name}"
        ),
        preview_url=(
            f"{normalized_prefix}/{bucket}/{preview_name}"
        ),
    )


def flatten_transparency(image: Image.Image) -> Image.Image:
    """Mengubah gambar transparan menjadi RGB berlatar putih."""

    if image.mode in {"RGBA", "LA"}:
        rgba_image = image.convert("RGBA")
        background = Image.new(
            "RGBA",
            rgba_image.size,
            (255, 255, 255, 255),
        )
        background.alpha_composite(rgba_image)
        return background.convert("RGB")

    if (
        image.mode == "P"
        and "transparency" in image.info
    ):
        rgba_image = image.convert("RGBA")
        background = Image.new(
            "RGBA",
            rgba_image.size,
            (255, 255, 255, 255),
        )
        background.alpha_composite(rgba_image)
        return background.convert("RGB")

    return image.convert("RGB")


def decode_source_image(data: bytes) -> Image.Image:
    """Membuka gambar dan menerapkan orientasi EXIF."""

    try:
        with Image.open(io.BytesIO(data)) as source:
            source.seek(0)
            source.load()

            corrected = ImageOps.exif_transpose(source)
            rgb_image = flatten_transparency(corrected)

            return rgb_image.copy()

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as error:
        raise PreviewError(
            "File tidak dapat didekode sebagai gambar."
        ) from error


def resized_copy(
    image: Image.Image,
    maximum_edge: int,
) -> Image.Image:
    """Membuat salinan yang diperkecil tanpa memperbesar."""

    result = image.copy()

    result.thumbnail(
        (maximum_edge, maximum_edge),
        Image.Resampling.LANCZOS,
        reducing_gap=3.0,
    )

    return result


def save_webp_atomic(
    image: Image.Image,
    path: Path,
    quality: int,
) -> None:
    """Menyimpan WebP secara atomik."""

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = path.with_suffix(
        path.suffix + ".tmp"
    )

    image.save(
        temporary_path,
        format="WEBP",
        quality=quality,
        method=6,
        optimize=True,
    )

    temporary_path.replace(path)


def build_derivatives(
    source_data: bytes,
    files: PreviewFiles,
) -> dict[str, int]:
    """Menghasilkan thumbnail dan preview WebP."""

    image = decode_source_image(source_data)

    thumbnail = resized_copy(
        image,
        THUMBNAIL_MAX_EDGE,
    )

    preview = resized_copy(
        image,
        PREVIEW_MAX_EDGE,
    )

    save_webp_atomic(
        thumbnail,
        files.thumbnail_path,
        THUMBNAIL_QUALITY,
    )

    save_webp_atomic(
        preview,
        files.preview_path,
        PREVIEW_QUALITY,
    )

    return {
        "sourceWidth": image.width,
        "sourceHeight": image.height,
        "thumbnailWidth": thumbnail.width,
        "thumbnailHeight": thumbnail.height,
        "previewWidth": preview.width,
        "previewHeight": preview.height,
        "thumbnailBytes": (
            files.thumbnail_path.stat().st_size
        ),
        "previewBytes": (
            files.preview_path.stat().st_size
        ),
    }


def media_extension(
    media: dict[str, Any],
) -> str:
    """Mengambil ekstensi media dalam huruf kapital."""

    extension = str(
        media.get("extension") or ""
    ).strip().lstrip(".").upper()

    if extension:
        return extension

    filename = str(
        media.get("filename") or ""
    )

    return (
        Path(filename).suffix
        .lstrip(".")
        .upper()
    )


def append_warning(
    media: dict[str, Any],
    warning: str,
) -> None:
    """Menambah parse warning tanpa duplikasi."""

    warnings = media.get("parseWarnings")

    if not isinstance(warnings, list):
        warnings = []

    if warning not in warnings:
        warnings.append(warning)

    media["parseWarnings"] = warnings


def clear_preview_fields(
    media: dict[str, Any],
) -> None:
    """Mengosongkan metadata turunan web."""

    media["thumbnailUrl"] = None
    media["previewUrl"] = None
    media["previewStatus"] = "unavailable"

    for key in (
        "sourceWidth",
        "sourceHeight",
        "thumbnailWidth",
        "thumbnailHeight",
        "previewWidth",
        "previewHeight",
        "thumbnailBytes",
        "previewBytes",
    ):
        media[key] = None


def apply_preview_metadata(
    media: dict[str, Any],
    files: PreviewFiles,
    dimensions: dict[str, int],
) -> None:
    """Memasang URL dan dimensi turunan ke katalog."""

    media["thumbnailUrl"] = files.thumbnail_url
    media["previewUrl"] = files.preview_url
    media["previewStatus"] = "ready"

    for key, value in dimensions.items():
        media[key] = value


def manifest_dimensions(
    entry: dict[str, Any],
) -> dict[str, int] | None:
    """Membaca kembali metadata dimensi dari manifest."""

    keys = (
        "sourceWidth",
        "sourceHeight",
        "thumbnailWidth",
        "thumbnailHeight",
        "previewWidth",
        "previewHeight",
        "thumbnailBytes",
        "previewBytes",
    )

    values: dict[str, int] = {}

    for key in keys:
        value = entry.get(key)

        if not isinstance(value, int):
            return None

        values[key] = value

    return values


def walk_catalogue_media(
    catalogue: dict[str, Any],
):
    """Menghasilkan konteks setiap media dalam katalog."""

    regions = catalogue.get("regions")

    if not isinstance(regions, list):
        raise PreviewError(
            "catalogue.regions harus berbentuk array."
        )

    for region in regions:
        if not isinstance(region, dict):
            continue

        region_name = str(
            region.get("name") or ""
        ).strip()

        districts = region.get("districts")

        if not isinstance(districts, list):
            continue

        for district in districts:
            if not isinstance(district, dict):
                continue

            district_name = str(
                district.get("name") or ""
            ).strip()

            places = district.get("places")

            if not isinstance(places, list):
                continue

            for place in places:
                if not isinstance(place, dict):
                    continue

                place_folder_name = str(
                    place.get("folderName")
                    or place.get("name")
                    or ""
                ).strip()

                media_items = place.get("media")

                if not isinstance(media_items, list):
                    continue

                for media in media_items:
                    if not isinstance(media, dict):
                        continue

                    yield (
                        region_name,
                        district_name,
                        place_folder_name,
                        media,
                    )


def load_manifest(path: Path) -> dict[str, Any]:
    """Membaca manifest lama bila kompatibel."""

    if not path.is_file():
        return {
            "pipelineVersion": PIPELINE_VERSION,
            "entries": {},
        }

    try:
        value = read_json(path)
    except PreviewError:
        return {
            "pipelineVersion": PIPELINE_VERSION,
            "entries": {},
        }

    if value.get("pipelineVersion") != PIPELINE_VERSION:
        return {
            "pipelineVersion": PIPELINE_VERSION,
            "entries": {},
        }

    entries = value.get("entries")

    if not isinstance(entries, dict):
        entries = {}

    return {
        "pipelineVersion": PIPELINE_VERSION,
        "entries": entries,
    }


def clean_orphan_files(
    output_root: Path,
    expected_files: set[Path],
) -> int:
    """Menghapus WebP lama yang tak lagi tercantum di katalog."""

    if not output_root.exists():
        return 0

    removed = 0

    for path in output_root.rglob("*.webp"):
        if path not in expected_files:
            path.unlink()
            removed += 1

    for directory in sorted(
        (
            path
            for path in output_root.rglob("*")
            if path.is_dir()
        ),
        reverse=True,
    ):
        try:
            directory.rmdir()
        except OSError:
            pass

    return removed


def build_previews(
    catalogue: dict[str, Any],
    catalogue_path: Path,
    output_root: Path,
    manifest_path: Path,
    url_prefix: str,
    base_url: str,
    archive_folder: str,
    authorization: str,
) -> dict[str, int]:
    """Membangun seluruh turunan media."""

    old_manifest = load_manifest(
        manifest_path
    )

    old_entries = old_manifest["entries"]
    new_entries: dict[str, Any] = {}

    expected_files: set[Path] = set()

    statistics = {
        "total": 0,
        "ready": 0,
        "generated": 0,
        "reused": 0,
        "unsupported": 0,
        "failed": 0,
        "orphaned": 0,
    }

    for (
        region_name,
        district_name,
        place_folder_name,
        media,
    ) in walk_catalogue_media(catalogue):
        statistics["total"] += 1

        media_id = validate_media_id(
            media.get("id")
        )

        files = preview_files_for_media(
            output_root=output_root,
            url_prefix=url_prefix,
            media_id=media_id,
        )

        expected_files.add(
            files.thumbnail_path
        )
        expected_files.add(
            files.preview_path
        )

        extension = media_extension(media)

        if extension not in SUPPORTED_EXTENSIONS:
            clear_preview_fields(media)
            media["previewStatus"] = "unsupported"
            append_warning(
                media,
                "unsupported-preview-format",
            )
            statistics["unsupported"] += 1
            continue

        fingerprint = source_fingerprint(media)
        old_entry = old_entries.get(media_id)

        can_reuse = bool(
            isinstance(old_entry, dict)
            and old_entry.get(
                "sourceFingerprint"
            ) == fingerprint
            and files.thumbnail_path.is_file()
            and files.preview_path.is_file()
        )

        dimensions = (
            manifest_dimensions(old_entry)
            if can_reuse
            else None
        )

        if can_reuse and dimensions:
            apply_preview_metadata(
                media,
                files,
                dimensions,
            )

            new_entries[media_id] = {
                "sourceFingerprint": fingerprint,
                **dimensions,
                "thumbnailUrl": files.thumbnail_url,
                "previewUrl": files.preview_url,
            }

            statistics["ready"] += 1
            statistics["reused"] += 1
            continue

        relative_path = str(
            media.get("relativePath")
            or media.get("filename")
            or ""
        ).strip()

        try:
            source_url = build_source_url(
                base_url=base_url,
                archive_folder=archive_folder,
                region_name=region_name,
                district_name=district_name,
                place_folder_name=place_folder_name,
                relative_path=relative_path,
            )

            source_data = download_bytes(
                source_url,
                authorization,
            )

            dimensions = build_derivatives(
                source_data,
                files,
            )

            apply_preview_metadata(
                media,
                files,
                dimensions,
            )

            new_entries[media_id] = {
                "sourceFingerprint": fingerprint,
                "sourceSha256": hashlib.sha256(
                    source_data
                ).hexdigest(),
                **dimensions,
                "thumbnailUrl": files.thumbnail_url,
                "previewUrl": files.preview_url,
            }

            statistics["ready"] += 1
            statistics["generated"] += 1

            print(
                "Generated preview: "
                f"{media_id} "
                f"({extension}, "
                f"{dimensions['sourceWidth']}×"
                f"{dimensions['sourceHeight']})"
            )

        except PreviewError as error:
            clear_preview_fields(media)
            append_warning(
                media,
                "preview-generation-failed",
            )

            for output_path in (
                files.thumbnail_path,
                files.preview_path,
            ):
                output_path.unlink(
                    missing_ok=True
                )

            statistics["failed"] += 1

            print(
                f"::warning::{media_id}: {error}",
                file=sys.stderr,
                flush=True,
            )

    statistics["orphaned"] = clean_orphan_files(
        output_root,
        expected_files,
    )

    manifest = {
        "pipelineVersion": PIPELINE_VERSION,
        "thumbnailMaxEdge": THUMBNAIL_MAX_EDGE,
        "previewMaxEdge": PREVIEW_MAX_EDGE,
        "entries": new_entries,
    }

    write_json_atomic(
        manifest_path,
        manifest,
    )

    write_json_atomic(
        catalogue_path,
        catalogue,
    )

    return statistics


def parse_arguments() -> argparse.Namespace:
    """Membaca argumen command line."""

    parser = argparse.ArgumentParser(
        description=(
            "Download Koofr images and build WebP previews "
            "for Arsip Kuliner Surabaya."
        )
    )

    parser.add_argument(
        "--catalogue",
        default="assets/data/archive.json",
        help=(
            "Path katalog JSON yang akan diperbarui. "
            "Default: assets/data/archive.json"
        ),
    )

    parser.add_argument(
        "--output-root",
        default="assets/archive-media",
        help=(
            "Folder output WebP. "
            "Default: assets/archive-media"
        ),
    )

    parser.add_argument(
        "--manifest",
        default=None,
        help=(
            "Path manifest cache. Default: "
            "<output-root>/manifest.json"
        ),
    )

    parser.add_argument(
        "--url-prefix",
        default="/assets/archive-media",
        help=(
            "Prefix URL publik untuk turunan media. "
            "Default: /assets/archive-media"
        ),
    )

    parser.add_argument(
        "--strict",
        action="store_true",
        help=(
            "Keluar dengan status gagal bila ada gambar "
            "yang tidak berhasil dibuat."
        ),
    )

    return parser.parse_args()


def main() -> int:
    """Entry point."""

    arguments = parse_arguments()

    try:
        username = required_environment(
            "KOOFR_USERNAME"
        )

        password = required_environment(
            "KOOFR_APP_PASSWORD"
        )

        base_url = os.environ.get(
            "KOOFR_WEBDAV_URL",
            "https://app.koofr.net/dav/Koofr/",
        ).strip()

        archive_folder = os.environ.get(
            "KOOFR_ARCHIVE_FOLDER",
            "Arsip Kuliner Surabaya",
        ).strip()

        if not base_url:
            raise PreviewError(
                "KOOFR_WEBDAV_URL tidak boleh kosong."
            )

        if not archive_folder:
            raise PreviewError(
                "KOOFR_ARCHIVE_FOLDER tidak boleh kosong."
            )

        catalogue_path = Path(
            arguments.catalogue
        )

        output_root = Path(
            arguments.output_root
        )

        manifest_path = (
            Path(arguments.manifest)
            if arguments.manifest
            else output_root / "manifest.json"
        )

        catalogue = read_json(
            catalogue_path
        )

        authorization = make_authorization(
            username,
            password,
        )

        statistics = build_previews(
            catalogue=catalogue,
            catalogue_path=catalogue_path,
            output_root=output_root,
            manifest_path=manifest_path,
            url_prefix=arguments.url_prefix,
            base_url=base_url,
            archive_folder=archive_folder,
            authorization=authorization,
        )

        print("")
        print("Koofr media preview build completed.")
        print(
            f"- Total media: {statistics['total']}"
        )
        print(
            f"- Ready: {statistics['ready']}"
        )
        print(
            f"- Generated: {statistics['generated']}"
        )
        print(
            f"- Reused: {statistics['reused']}"
        )
        print(
            f"- Unsupported: {statistics['unsupported']}"
        )
        print(
            f"- Failed: {statistics['failed']}"
        )
        print(
            f"- Removed orphan files: "
            f"{statistics['orphaned']}"
        )

        if (
            arguments.strict
            and statistics["failed"] > 0
        ):
            print(
                "::error::Sebagian preview media gagal dibuat.",
                file=sys.stderr,
            )
            return 1

        return 0

    except PreviewError as error:
        print(
            f"::error::{error}",
            file=sys.stderr,
            flush=True,
        )
        return 1

    except Exception as error:
        print(
            "::error::Terjadi kesalahan tak terduga saat "
            f"membangun preview: {error}",
            file=sys.stderr,
            flush=True,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
