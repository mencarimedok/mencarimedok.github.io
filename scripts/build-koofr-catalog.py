#!/usr/bin/env python3
"""
MENCARI MEDOK — PEMBANGUN KATALOG KOOFR V2

Membaca folder publik Arsip Kuliner Surabaya melalui WebDAV secara
read-only dan menghasilkan archive.json.

Hanya lima folder wilayah berikut yang dipindai:
- Surabaya Barat
- Surabaya Pusat
- Surabaya Selatan
- Surabaya Timur
- Surabaya Utara

Folder Karantina, file lepas di folder induk, dan folder lain tidak masuk.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Iterable


ALLOWED_REGIONS = (
    "Surabaya Barat",
    "Surabaya Pusat",
    "Surabaya Selatan",
    "Surabaya Timur",
    "Surabaya Utara",
)

IGNORED_NAMES = {
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
}

DAV_NAMESPACE = {"d": "DAV:"}

PROPFIND_BODY = b"""<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <d:getcontentlength />
    <d:getcontenttype />
    <d:getlastmodified />
    <d:getetag />
  </d:prop>
</d:propfind>
"""

PLACE_WITH_STATUS_AND_ADDRESS = re.compile(
    r"""
    ^
    (?P<name>.*?)
    \s*
    \(
      (?P<status>[^()]*)
    \)
    \s*-
    \s*
    (?P<address>.+)
    $
    """,
    re.VERBOSE,
)

PLACE_WITH_ADDRESS = re.compile(
    r"""
    ^
    (?P<name>.*?)
    \s*-
    \s*
    (?P<address>.+)
    $
    """,
    re.VERBOSE,
)

MEDIA_PREFIX = re.compile(
    r"""
    ^
    (?P<date>\d{4}-\d{2}-\d{2})
    (?:
      [\s_T]+
      (?P<time>
        \d{2}
        [.:_-]
        \d{2}
        (?:
          [.:_-]
          \d{2}
        )?
      )
    )?
    (?P<remainder>.*)
    $
    """,
    re.VERBOSE,
)

STATUS_SUFFIX_PATTERN = re.compile(
    r"""
    \s*
    \(
      (?P<status>
        buka
        |tutup
        |pindah
        |tidak\s+aktif
        |permanen\s+tutup
        |sementara\s+tutup
        |buka\s*,\s*tutup
        |tutup\s*,\s*buka
      )
    \)
    \s*$
    """,
    re.IGNORECASE | re.VERBOSE,
)

PRICE_TOKEN = (
    r"(?:Rp\.?\s*\d[\d.,]*|\d+(?:[.,]\d+)?\s*k(?:\s*an)?)"
)

PRICE_GROUP = (
    rf"{PRICE_TOKEN}(?:\s*(?:dan|&|/|,)\s*{PRICE_TOKEN})*"
)

TRAILING_PRICE_PATTERN = re.compile(
    rf"""
    ^\s*
    \(?\s*
    (?P<price>{PRICE_GROUP})
    \s*\)?
    (?P<note>.*)
    $
    """,
    re.IGNORECASE | re.VERBOSE,
)

EMBEDDED_PRICE_PATTERN = re.compile(
    rf"\((?P<price>{PRICE_GROUP})\)",
    re.IGNORECASE,
)

PLAIN_CREDIT_PATTERN = re.compile(
    r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{0,50}"
)

PRICE_UNKNOWN_NOTES = {
    "lupa harga",
    "harga lupa",
    "tidak ingat harga",
    "lupa",
}


class CatalogueError(RuntimeError):
    """Kesalahan aman yang boleh ditampilkan pada workflow log."""


@dataclass(frozen=True)
class WebDavResource:
    """Satu resource yang ditemukan melalui WebDAV."""

    name: str
    url: str
    decoded_path: str
    is_collection: bool
    content_length: int | None
    content_type: str | None
    last_modified: str | None
    etag: str | None


def get_required_environment(name: str) -> str:
    """Mengambil environment variable wajib."""

    value = os.environ.get(name, "").strip()

    if not value:
        raise CatalogueError(
            f"Environment variable {name} belum tersedia atau kosong."
        )

    return value


def normalized_identity(value: str) -> str:
    """Menormalisasi nama untuk perbandingan alias."""

    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(
        character
        for character in normalized
        if not unicodedata.combining(character)
    )
    normalized = normalized.casefold().replace("&", " and ")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)

    return " ".join(normalized.split())


def identity_tokens(value: str) -> list[str]:
    """Mengubah identitas menjadi token pembanding."""

    return normalized_identity(value).split()


def slugify(value: str) -> str:
    """Menghasilkan slug URL sederhana dan stabil."""

    normalized = normalized_identity(value)
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = normalized.strip("-")

    return normalized or "tanpa-nama"


def create_unique_slug(
    base_slug: str,
    used_slugs: set[str],
) -> str:
    """Menghindari tabrakan slug di dalam parent yang sama."""

    candidate = base_slug
    suffix = 2

    while candidate in used_slugs:
        candidate = f"{base_slug}-{suffix}"
        suffix += 1

    used_slugs.add(candidate)

    return candidate


def stable_id(*parts: str) -> str:
    """Menghasilkan ID stabil dari path katalog."""

    joined = "\n".join(parts).encode("utf-8")
    digest = hashlib.sha1(joined).hexdigest()[:16]

    return f"media-{digest}"


def safe_integer(value: str | None) -> int | None:
    """Mengubah string menjadi integer non-negatif."""

    if value is None:
        return None

    try:
        number = int(value)
    except (TypeError, ValueError):
        return None

    return number if number >= 0 else None


def normalize_last_modified(value: str | None) -> str | None:
    """Mengubah tanggal HTTP menjadi ISO 8601 UTC."""

    if not value:
        return None

    try:
        parsed = parsedate_to_datetime(value)

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)

        return (
            parsed.astimezone(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
    except (TypeError, ValueError, OverflowError):
        return value


def path_name_from_href(href: str) -> str:
    """Mengambil nama file atau folder dari WebDAV href."""

    parsed = urllib.parse.urlparse(href)
    decoded_path = urllib.parse.unquote(parsed.path).rstrip("/")

    if not decoded_path:
        return ""

    return decoded_path.rsplit("/", 1)[-1]


def normalized_decoded_path(url_or_href: str) -> str:
    """Menghasilkan path decoded untuk perbandingan resource."""

    parsed = urllib.parse.urlparse(url_or_href)

    return urllib.parse.unquote(parsed.path).rstrip("/")


def resolve_resource_url(
    root_url: str,
    href: str,
    is_collection: bool,
) -> str:
    """Mengubah href WebDAV menjadi URL absolut."""

    resolved = urllib.parse.urljoin(root_url, href)

    if is_collection and not resolved.endswith("/"):
        resolved += "/"

    return resolved


class KoofrWebDavClient:
    """WebDAV client read-only memakai Python standard library."""

    def __init__(
        self,
        username: str,
        password: str,
        root_url: str,
    ) -> None:
        self.root_url = root_url.rstrip("/") + "/"

        credentials = f"{username}:{password}".encode("utf-8")

        self.authorization = (
            "Basic "
            + base64.b64encode(credentials).decode("ascii")
        )

    def _propfind(
        self,
        url: str,
        depth: str = "1",
    ) -> bytes:
        """Menjalankan PROPFIND dengan retry terbatas."""

        maximum_attempts = 3

        for attempt in range(1, maximum_attempts + 1):
            request = urllib.request.Request(
                url=url,
                data=PROPFIND_BODY,
                method="PROPFIND",
                headers={
                    "Authorization": self.authorization,
                    "Depth": depth,
                    "Content-Type": "application/xml; charset=utf-8",
                    "User-Agent": "Mencari-Medok-Archive-Sync/2.0",
                },
            )

            try:
                with urllib.request.urlopen(
                    request,
                    timeout=45,
                ) as response:
                    if response.status != 207:
                        raise CatalogueError(
                            "Koofr mengembalikan HTTP "
                            f"{response.status}; WebDAV seharusnya "
                            "mengembalikan 207 Multi-Status."
                        )

                    return response.read()

            except urllib.error.HTTPError as error:
                if error.code == 401:
                    raise CatalogueError(
                        "Autentikasi Koofr ditolak. Periksa "
                        "KOOFR_USERNAME dan KOOFR_APP_PASSWORD."
                    ) from error

                if error.code == 403:
                    raise CatalogueError(
                        "Koofr menolak akses ke resource tersebut."
                    ) from error

                if error.code == 404:
                    raise CatalogueError(
                        "Resource Koofr tidak ditemukan."
                    ) from error

                if error.code == 429:
                    if attempt >= maximum_attempts:
                        raise CatalogueError(
                            "Koofr membatasi terlalu banyak permintaan "
                            "(HTTP 429). Coba lagi setelah jeda."
                        ) from error

                    retry_after = error.headers.get("Retry-After")
                    wait_seconds = 10 * attempt

                    if retry_after and retry_after.isdigit():
                        wait_seconds = min(int(retry_after), 60)

                    time.sleep(wait_seconds)
                    continue

                if 500 <= error.code < 600:
                    if attempt >= maximum_attempts:
                        raise CatalogueError(
                            "Koofr mengalami gangguan server dengan "
                            f"HTTP {error.code}."
                        ) from error

                    time.sleep(3 * attempt)
                    continue

                raise CatalogueError(
                    "Permintaan WebDAV gagal dengan "
                    f"HTTP {error.code}."
                ) from error

            except urllib.error.URLError as error:
                if attempt >= maximum_attempts:
                    raise CatalogueError(
                        "Tidak dapat terhubung ke Koofr: "
                        f"{error.reason}"
                    ) from error

                time.sleep(3 * attempt)

        raise CatalogueError(
            "Permintaan WebDAV gagal setelah beberapa percobaan."
        )

    def list_children(
        self,
        collection_url: str,
    ) -> list[WebDavResource]:
        """Membaca isi langsung sebuah folder."""

        xml_body = self._propfind(
            collection_url,
            depth="1",
        )

        try:
            root = ET.fromstring(xml_body)
        except ET.ParseError as error:
            raise CatalogueError(
                "Respons Koofr bukan XML WebDAV yang valid."
            ) from error

        collection_path = normalized_decoded_path(collection_url)
        resources: list[WebDavResource] = []

        for response in root.findall(
            "d:response",
            DAV_NAMESPACE,
        ):
            href_element = response.find(
                "d:href",
                DAV_NAMESPACE,
            )

            if href_element is None or not href_element.text:
                continue

            href = href_element.text
            successful_prop = None

            for propstat in response.findall(
                "d:propstat",
                DAV_NAMESPACE,
            ):
                status_element = propstat.find(
                    "d:status",
                    DAV_NAMESPACE,
                )

                status_text = (
                    status_element.text
                    if status_element is not None
                    else ""
                )

                if " 200 " in status_text:
                    successful_prop = propstat.find(
                        "d:prop",
                        DAV_NAMESPACE,
                    )
                    break

            if successful_prop is None:
                continue

            resource_type = successful_prop.find(
                "d:resourcetype",
                DAV_NAMESPACE,
            )

            is_collection = bool(
                resource_type is not None
                and resource_type.find(
                    "d:collection",
                    DAV_NAMESPACE,
                )
                is not None
            )

            resource_url = resolve_resource_url(
                self.root_url,
                href,
                is_collection,
            )

            decoded_path = normalized_decoded_path(resource_url)

            if decoded_path == collection_path:
                continue

            display_name_element = successful_prop.find(
                "d:displayname",
                DAV_NAMESPACE,
            )

            display_name = (
                display_name_element.text.strip()
                if (
                    display_name_element is not None
                    and display_name_element.text
                )
                else path_name_from_href(href)
            )

            content_length_element = successful_prop.find(
                "d:getcontentlength",
                DAV_NAMESPACE,
            )

            content_type_element = successful_prop.find(
                "d:getcontenttype",
                DAV_NAMESPACE,
            )

            modified_element = successful_prop.find(
                "d:getlastmodified",
                DAV_NAMESPACE,
            )

            etag_element = successful_prop.find(
                "d:getetag",
                DAV_NAMESPACE,
            )

            resources.append(
                WebDavResource(
                    name=display_name,
                    url=resource_url,
                    decoded_path=decoded_path,
                    is_collection=is_collection,
                    content_length=safe_integer(
                        content_length_element.text
                        if content_length_element is not None
                        else None
                    ),
                    content_type=(
                        content_type_element.text.strip()
                        if (
                            content_type_element is not None
                            and content_type_element.text
                        )
                        else None
                    ),
                    last_modified=normalize_last_modified(
                        modified_element.text
                        if modified_element is not None
                        else None
                    ),
                    etag=(
                        etag_element.text.strip()
                        if (
                            etag_element is not None
                            and etag_element.text
                        )
                        else None
                    ),
                )
            )

        return sorted(
            resources,
            key=lambda item: (
                not item.is_collection,
                item.name.casefold(),
            ),
        )


def should_ignore(resource: WebDavResource) -> bool:
    """Menentukan resource teknis yang tidak perlu dimasukkan."""

    stripped_name = resource.name.strip()

    return (
        not stripped_name
        or stripped_name in IGNORED_NAMES
        or stripped_name.startswith(".")
        or stripped_name.startswith("~$")
    )


def parse_place_folder(folder_name: str) -> dict[str, str | None]:
    """Memecah nama folder tempat menjadi nama, status, dan alamat."""

    cleaned = re.sub(r"\s+", " ", folder_name).strip()

    match = PLACE_WITH_STATUS_AND_ADDRESS.match(cleaned)

    if match:
        return {
            "name": match.group("name").strip(),
            "status": match.group("status").strip() or None,
            "address": match.group("address").strip() or None,
        }

    match = PLACE_WITH_ADDRESS.match(cleaned)

    if match:
        return {
            "name": match.group("name").strip(),
            "status": None,
            "address": match.group("address").strip() or None,
        }

    return {
        "name": cleaned,
        "status": None,
        "address": None,
    }


def normalize_media_time(value: str | None) -> str | None:
    """Mengubah 18.31.15 atau 18-31-15 menjadi 18:31:15."""

    if not value:
        return None

    components = re.split(r"[.:_-]", value)

    if len(components) not in {2, 3}:
        return value

    try:
        numbers = [int(component) for component in components]
    except ValueError:
        return value

    hour = numbers[0]
    minute = numbers[1]
    second = numbers[2] if len(numbers) == 3 else None

    if (
        hour > 23
        or minute > 59
        or (second is not None and second > 59)
    ):
        return value

    if second is None:
        return f"{hour:02d}:{minute:02d}"

    return f"{hour:02d}:{minute:02d}:{second:02d}"


def split_media_segments(value: str) -> list[str]:
    """Memecah bagian nama file menjadi segmen metadata."""

    cleaned = value.strip(" \t_-–—")

    if not cleaned:
        return []

    if re.search(r"\s+-\s+", cleaned):
        segments = re.split(r"\s+-\s+", cleaned)
    else:
        # Fallback untuk format lama tanpa spasi:
        # 2023-06-02-Tempat-Sajian-25k
        segments = re.split(r"\s*-\s*", cleaned)

    return [
        segment.strip()
        for segment in segments
        if segment.strip()
    ]


def strip_status_suffix(value: str) -> tuple[str, str | None]:
    """Menghapus status seperti (Tutup) dari akhir label tempat."""

    match = STATUS_SUFFIX_PATTERN.search(value)

    if not match:
        return value.strip(), None

    return (
        value[: match.start()].strip(),
        match.group("status").strip(),
    )


def is_place_alias(candidate: str, place_name: str) -> bool:
    """Membandingkan nama file dan nama folder secara toleran."""

    candidate_tokens = identity_tokens(candidate)
    place_tokens = identity_tokens(place_name)

    if not candidate_tokens or not place_tokens:
        return False

    if candidate_tokens == place_tokens:
        return True

    if (
        len(candidate_tokens) <= len(place_tokens)
        and candidate_tokens
        == place_tokens[: len(candidate_tokens)]
    ):
        return (
            len(candidate_tokens) >= 2
            or len(candidate_tokens[0]) >= 5
        )

    if (
        len(place_tokens) <= len(candidate_tokens)
        and place_tokens == candidate_tokens[: len(place_tokens)]
    ):
        return True

    common_prefix = 0

    for candidate_token, place_token in zip(
        candidate_tokens,
        place_tokens,
    ):
        if candidate_token != place_token:
            break

        common_prefix += 1

    shorter_length = min(
        len(candidate_tokens),
        len(place_tokens),
    )

    return (
        common_prefix >= 2
        and common_prefix / shorter_length >= 0.75
    )


def strip_place_segment(
    segments: list[str],
    place_name: str,
) -> tuple[list[str], str | None, bool]:
    """Menghapus label tempat dari segmen pertama."""

    if not segments:
        return segments, None, False

    candidate = segments[0]
    candidate_without_status, _ = strip_status_suffix(candidate)

    if not is_place_alias(
        candidate_without_status,
        place_name,
    ):
        return segments, None, False

    collaboration: str | None = None

    collaboration_match = re.match(
        r"^(?P<place>.*?)\s+[x×]\s+(?P<partner>.+)$",
        candidate_without_status,
        re.IGNORECASE,
    )

    if (
        collaboration_match
        and is_place_alias(
            collaboration_match.group("place"),
            place_name,
        )
    ):
        collaboration = (
            collaboration_match.group("partner").strip()
            or None
        )

    return segments[1:], collaboration, True


def extract_credit(
    segments: list[str],
) -> tuple[list[str], str | None]:
    """Memisahkan kredit seperti (@crisp.lemonade) atau (Alwari)."""

    if not segments:
        return segments, None

    last_segment = segments[-1]
    match = re.search(
        r"\s*\((?P<credit>[^()]*)\)\s*$",
        last_segment,
    )

    if not match:
        return segments, None

    credit = match.group("credit").strip()
    before_credit = last_segment[: match.start()].rstrip()

    is_handle = credit.startswith("@")
    price_before_credit = re.search(
        rf"{PRICE_GROUP}\s*$",
        before_credit,
        re.IGNORECASE,
    )
    is_plain_credit = bool(
        price_before_credit
        and PLAIN_CREDIT_PATTERN.fullmatch(credit)
    )

    if not is_handle and not is_plain_credit:
        return segments, None

    updated_segments = segments[:-1]

    if before_credit:
        updated_segments.append(before_credit)

    return updated_segments, credit


def extract_price_and_notes(
    segments: list[str],
) -> tuple[
    list[str],
    str | None,
    str | None,
    list[str],
]:
    """Memisahkan harga, catatan harga, dan peringatan parser."""

    working_segments = list(segments)
    price: str | None = None
    notes: list[str] = []
    warnings: list[str] = []

    if working_segments:
        last_segment = working_segments[-1].strip()
        normalized_last = normalized_identity(last_segment)

        if normalized_last in PRICE_UNKNOWN_NOTES:
            notes.append(last_segment)
            working_segments.pop()
        else:
            price_match = TRAILING_PRICE_PATTERN.match(last_segment)

            if price_match:
                price = price_match.group("price").strip()
                trailing_note = price_match.group("note").strip(
                    " -–—,;"
                )

                working_segments.pop()

                if trailing_note:
                    notes.append(trailing_note)

    joined = " - ".join(working_segments)
    embedded_matches = list(
        EMBEDDED_PRICE_PATTERN.finditer(joined)
    )

    if embedded_matches:
        embedded_prices = [
            match.group("price").strip()
            for match in embedded_matches
        ]

        if price is None:
            price = embedded_prices[0]

        if len(embedded_matches) > 1:
            warnings.append("multiple-price-mentions")
        else:
            match = embedded_matches[0]
            joined = (
                joined[: match.start()]
                + joined[match.end() :]
            )
            joined = re.sub(r"\s{2,}", " ", joined)
            joined = joined.strip(" -–—")
            working_segments = split_media_segments(joined)

    notes_value = "; ".join(notes) if notes else None

    return working_segments, price, notes_value, warnings


def determine_mime_type(
    filename: str,
    extension: str | None,
    webdav_content_type: str | None,
) -> str | None:
    """Menentukan MIME type dengan override untuk HEIC dan HEIF."""

    normalized_extension = (extension or "").upper()

    if normalized_extension == "HEIC":
        return "image/heic"

    if normalized_extension == "HEIF":
        return "image/heif"

    if webdav_content_type and (
        webdav_content_type != "application/octet-stream"
    ):
        return webdav_content_type

    guessed_type, _ = mimetypes.guess_type(filename)

    return webdav_content_type or guessed_type


def parse_media_filename(
    filename: str,
    place_name: str,
) -> dict[str, Any]:
    """Membaca metadata utama dari nama file dokumentasi."""

    suffix = Path(filename).suffix
    extension = suffix.lstrip(".").upper() or None
    stem = filename[: -len(suffix)] if suffix else filename

    date_value: str | None = None
    time_value: str | None = None
    remainder = stem.strip()
    parse_warnings: list[str] = []

    prefix_match = MEDIA_PREFIX.match(stem)

    if prefix_match:
        date_value = prefix_match.group("date")
        time_value = normalize_media_time(
            prefix_match.group("time")
        )
        remainder = (
            prefix_match.group("remainder") or ""
        ).strip(" \t_-–—")
    else:
        parse_warnings.append("date-prefix-not-detected")

    segments = split_media_segments(remainder)

    segments, collaboration, place_prefix_detected = (
        strip_place_segment(
            segments,
            place_name,
        )
    )

    if not place_prefix_detected:
        parse_warnings.append("place-prefix-not-detected")

    segments, credit = extract_credit(segments)

    (
        segments,
        price,
        notes,
        price_warnings,
    ) = extract_price_and_notes(segments)

    parse_warnings.extend(price_warnings)

    dish = " - ".join(segments).strip() or None

    if not dish:
        parse_warnings.append("dish-not-detected")

    return {
        "date": date_value,
        "time": time_value,
        "dish": dish,
        "price": price,
        "credit": credit,
        "notes": notes,
        "collaboration": collaboration,
        "extension": extension,
        "parseWarnings": sorted(set(parse_warnings)),
    }


def walk_files(
    client: KoofrWebDavClient,
    collection_url: str,
    relative_parts: tuple[str, ...] = (),
    depth: int = 0,
    maximum_depth: int = 12,
) -> Iterable[tuple[WebDavResource, tuple[str, ...]]]:
    """Mengambil seluruh file di folder tempat secara rekursif."""

    if depth > maximum_depth:
        raise CatalogueError(
            "Struktur folder terlalu dalam. Kedalaman maksimum "
            f"adalah {maximum_depth} tingkat di bawah folder tempat."
        )

    for resource in client.list_children(collection_url):
        if should_ignore(resource):
            continue

        current_parts = relative_parts + (resource.name,)

        if resource.is_collection:
            yield from walk_files(
                client=client,
                collection_url=resource.url,
                relative_parts=current_parts,
                depth=depth + 1,
                maximum_depth=maximum_depth,
            )
        else:
            yield resource, current_parts


def build_media_record(
    resource: WebDavResource,
    relative_parts: tuple[str, ...],
    region_name: str,
    district_name: str,
    place_folder_name: str,
    place_name: str,
) -> dict[str, Any]:
    """Menghasilkan satu entri media katalog."""

    parsed = parse_media_filename(
        resource.name,
        place_name,
    )

    relative_path = "/".join(relative_parts)

    return {
        "id": stable_id(
            region_name,
            district_name,
            place_folder_name,
            relative_path,
        ),
        "filename": resource.name,
        "relativePath": relative_path,
        "date": parsed["date"],
        "time": parsed["time"],
        "dish": parsed["dish"],
        "price": parsed["price"],
        "credit": parsed["credit"],
        "notes": parsed["notes"],
        "collaboration": parsed["collaboration"],
        "extension": parsed["extension"],
        "mimeType": determine_mime_type(
            filename=resource.name,
            extension=parsed["extension"],
            webdav_content_type=resource.content_type,
        ),
        "sizeBytes": resource.content_length,
        "lastModified": resource.last_modified,
        "etag": resource.etag,
        "parseWarnings": parsed["parseWarnings"],
        "previewUrl": None,
        "originalUrl": None,
    }


def build_place_record(
    client: KoofrWebDavClient,
    place_resource: WebDavResource,
    region_name: str,
    district_name: str,
    place_slug: str,
) -> dict[str, Any]:
    """Menghasilkan data sebuah tempat dan seluruh medianya."""

    parsed_place = parse_place_folder(place_resource.name)
    place_name = parsed_place["name"] or place_resource.name

    media_records = [
        build_media_record(
            resource=file_resource,
            relative_parts=relative_parts,
            region_name=region_name,
            district_name=district_name,
            place_folder_name=place_resource.name,
            place_name=place_name,
        )
        for file_resource, relative_parts in walk_files(
            client,
            place_resource.url,
        )
    ]

    media_records.sort(
        key=lambda item: (
            item.get("date") or "",
            item.get("time") or "",
            item.get("filename") or "",
        ),
        reverse=True,
    )

    return {
        "name": place_name,
        "folderName": place_resource.name,
        "slug": place_slug,
        "status": parsed_place["status"],
        "address": parsed_place["address"],
        "mediaCount": len(media_records),
        "media": media_records,
    }


def build_district_record(
    client: KoofrWebDavClient,
    district_resource: WebDavResource,
    region_name: str,
    district_slug: str,
) -> dict[str, Any]:
    """Menghasilkan data kecamatan dari folder di bawah wilayah."""

    place_resources = [
        resource
        for resource in client.list_children(
            district_resource.url
        )
        if resource.is_collection and not should_ignore(resource)
    ]

    used_place_slugs: set[str] = set()
    places: list[dict[str, Any]] = []

    for place_resource in place_resources:
        parsed_place = parse_place_folder(place_resource.name)
        place_name = parsed_place["name"] or place_resource.name

        place_slug = create_unique_slug(
            slugify(place_name),
            used_place_slugs,
        )

        places.append(
            build_place_record(
                client=client,
                place_resource=place_resource,
                region_name=region_name,
                district_name=district_resource.name,
                place_slug=place_slug,
            )
        )

    places.sort(key=lambda item: item["name"].casefold())

    media_count = sum(
        place["mediaCount"]
        for place in places
    )

    return {
        "name": district_resource.name,
        "slug": district_slug,
        "placeCount": len(places),
        "mediaCount": media_count,
        "places": places,
    }


def empty_region_record(region_name: str) -> dict[str, Any]:
    """Membuat data wilayah kosong jika folder tidak ditemukan."""

    return {
        "name": region_name,
        "slug": slugify(region_name),
        "districtCount": 0,
        "placeCount": 0,
        "mediaCount": 0,
        "districts": [],
    }


def build_region_record(
    client: KoofrWebDavClient,
    region_resource: WebDavResource,
) -> dict[str, Any]:
    """Menghasilkan data wilayah beserta seluruh kecamatan."""

    district_resources = [
        resource
        for resource in client.list_children(
            region_resource.url
        )
        if resource.is_collection and not should_ignore(resource)
    ]

    used_district_slugs: set[str] = set()
    districts: list[dict[str, Any]] = []

    for district_resource in district_resources:
        district_slug = create_unique_slug(
            slugify(district_resource.name),
            used_district_slugs,
        )

        districts.append(
            build_district_record(
                client=client,
                district_resource=district_resource,
                region_name=region_resource.name,
                district_slug=district_slug,
            )
        )

    districts.sort(key=lambda item: item["name"].casefold())

    place_count = sum(
        district["placeCount"]
        for district in districts
    )

    media_count = sum(
        district["mediaCount"]
        for district in districts
    )

    return {
        "name": region_resource.name,
        "slug": slugify(region_resource.name),
        "districtCount": len(districts),
        "placeCount": place_count,
        "mediaCount": media_count,
        "districts": districts,
    }


def find_archive_folder(
    client: KoofrWebDavClient,
    archive_folder_name: str,
) -> WebDavResource:
    """Mencari folder Arsip Kuliner Surabaya di root Koofr."""

    archive_resource = next(
        (
            resource
            for resource in client.list_children(
                client.root_url
            )
            if (
                resource.is_collection
                and resource.name == archive_folder_name
            )
        ),
        None,
    )

    if archive_resource is None:
        raise CatalogueError(
            f"Folder '{archive_folder_name}' tidak ditemukan "
            "di root Koofr."
        )

    return archive_resource


def build_catalogue(
    client: KoofrWebDavClient,
    archive_folder_name: str,
) -> dict[str, Any]:
    """Membangun katalog dari lima wilayah publik."""

    archive_resource = find_archive_folder(
        client,
        archive_folder_name,
    )

    region_resources = {
        resource.name: resource
        for resource in client.list_children(
            archive_resource.url
        )
        if (
            resource.is_collection
            and resource.name in ALLOWED_REGIONS
        )
    }

    regions: list[dict[str, Any]] = []

    for region_name in ALLOWED_REGIONS:
        region_resource = region_resources.get(region_name)

        if region_resource is None:
            regions.append(empty_region_record(region_name))
            continue

        regions.append(
            build_region_record(
                client,
                region_resource,
            )
        )

    return {
        "schemaVersion": 1,
        "parserVersion": 2,
        "mode": "koofr-preview",
        "generatedAt": (
            datetime.now(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        ),
        "regions": regions,
    }


def write_catalogue(
    catalogue: dict[str, Any],
    output_path: Path,
) -> None:
    """Menulis katalog secara atomik."""

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = output_path.with_suffix(
        output_path.suffix + ".tmp"
    )

    with temporary_path.open(
        "w",
        encoding="utf-8",
        newline="\n",
    ) as output_file:
        json.dump(
            catalogue,
            output_file,
            ensure_ascii=False,
            indent=2,
        )
        output_file.write("\n")

    temporary_path.replace(output_path)


def count_parse_warnings(catalogue: dict[str, Any]) -> int:
    """Menghitung media yang masih memiliki peringatan parser."""

    count = 0

    for region in catalogue["regions"]:
        for district in region["districts"]:
            for place in district["places"]:
                for media in place["media"]:
                    if media.get("parseWarnings"):
                        count += 1

    return count


def print_summary(catalogue: dict[str, Any]) -> None:
    """Mencetak ringkasan aman tanpa nama tempat atau file."""

    print("Koofr catalogue generated successfully.")

    for region in catalogue["regions"]:
        print(
            f"- {region['name']}: "
            f"{region['districtCount']} district(s), "
            f"{region['placeCount']} place(s), "
            f"{region['mediaCount']} media file(s)"
        )

    total_districts = sum(
        region["districtCount"]
        for region in catalogue["regions"]
    )

    total_places = sum(
        region["placeCount"]
        for region in catalogue["regions"]
    )

    total_media = sum(
        region["mediaCount"]
        for region in catalogue["regions"]
    )

    warning_count = count_parse_warnings(catalogue)

    print(
        "Total public catalogue: "
        f"{total_districts} district(s), "
        f"{total_places} place(s), "
        f"{total_media} media file(s)."
    )

    print(
        f"Media with parser warnings: {warning_count}."
    )

    print(
        "Folders and files outside the five allowed regions "
        "were not included."
    )


def parse_arguments() -> argparse.Namespace:
    """Membaca argumen command line."""

    parser = argparse.ArgumentParser(
        description=(
            "Build Arsip Kuliner Surabaya catalogue "
            "from Koofr WebDAV."
        )
    )

    parser.add_argument(
        "--output",
        default="generated/archive.json",
        help=(
            "Lokasi archive.json hasil pemindaian. "
            "Default: generated/archive.json"
        ),
    )

    return parser.parse_args()


def main() -> int:
    """Entry point."""

    arguments = parse_arguments()

    try:
        username = get_required_environment("KOOFR_USERNAME")
        password = get_required_environment("KOOFR_APP_PASSWORD")

        root_url = os.environ.get(
            "KOOFR_WEBDAV_URL",
            "https://app.koofr.net/dav/Koofr/",
        ).strip()

        archive_folder = os.environ.get(
            "KOOFR_ARCHIVE_FOLDER",
            "Arsip Kuliner Surabaya",
        ).strip()

        if not root_url:
            raise CatalogueError(
                "KOOFR_WEBDAV_URL tidak boleh kosong."
            )

        if not archive_folder:
            raise CatalogueError(
                "KOOFR_ARCHIVE_FOLDER tidak boleh kosong."
            )

        client = KoofrWebDavClient(
            username=username,
            password=password,
            root_url=root_url,
        )

        catalogue = build_catalogue(
            client=client,
            archive_folder_name=archive_folder,
        )

        output_path = Path(arguments.output)

        write_catalogue(
            catalogue,
            output_path,
        )

        print_summary(catalogue)
        print(f"Output written to: {output_path}")

        return 0

    except CatalogueError as error:
        print(
            f"::error::{error}",
            file=sys.stderr,
            flush=True,
        )

        return 1

    except Exception as error:
        print(
            "::error::Terjadi kesalahan tak terduga saat "
            f"membangun katalog: {error}",
            file=sys.stderr,
            flush=True,
        )

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
