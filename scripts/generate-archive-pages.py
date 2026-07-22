#!/usr/bin/env python3
"""
MENCARI MEDOK — GENERATOR HALAMAN ARSIP

Membaca archive.json hasil pemindaian Koofr lalu membuat halaman Jekyll
untuk seluruh wilayah, kecamatan, dan tempat.

Contoh:
    python3 scripts/generate-archive-pages.py \
      --catalogue assets/data/archive.json \
      --output-root arsip/wilayah \
      --force
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any


ALLOWED_REGION_NAMES = (
    "Surabaya Barat",
    "Surabaya Pusat",
    "Surabaya Selatan",
    "Surabaya Timur",
    "Surabaya Utara",
)

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
GENERATED_MARKER = "<!-- Generated from Koofr catalogue. Do not edit manually. -->"


class GenerationError(RuntimeError):
    """Kesalahan generator yang aman ditampilkan ke pengguna."""


def read_json(path: Path) -> dict[str, Any]:
    """Membaca dan memvalidasi JSON dasar."""

    if not path.is_file():
        raise GenerationError(f"Catalogue tidak ditemukan: {path}")

    try:
        with path.open("r", encoding="utf-8") as input_file:
            value = json.load(input_file)
    except json.JSONDecodeError as error:
        raise GenerationError(
            f"Catalogue bukan JSON valid: baris {error.lineno}, kolom {error.colno}."
        ) from error

    if not isinstance(value, dict):
        raise GenerationError("Root catalogue harus berbentuk object.")

    if value.get("schemaVersion") != 1:
        raise GenerationError("schemaVersion catalogue harus bernilai 1.")

    regions = value.get("regions")

    if not isinstance(regions, list):
        raise GenerationError("regions catalogue harus berbentuk array.")

    return value


def require_text(value: Any, label: str) -> str:
    """Memastikan nilai berupa teks yang tidak kosong."""

    if not isinstance(value, str) or not value.strip():
        raise GenerationError(f"{label} harus berupa teks yang tidak kosong.")

    return value.strip()


def require_slug(value: Any, label: str) -> str:
    """Memastikan slug aman dipakai sebagai nama folder dan URL."""

    slug = require_text(value, label)

    if not SLUG_PATTERN.fullmatch(slug):
        raise GenerationError(
            f"{label} tidak aman: {slug!r}. Gunakan huruf kecil, angka, dan tanda hubung."
        )

    return slug


def as_list(value: Any, label: str) -> list[dict[str, Any]]:
    """Memastikan nilai adalah array object."""

    if value is None:
        return []

    if not isinstance(value, list):
        raise GenerationError(f"{label} harus berbentuk array.")

    result: list[dict[str, Any]] = []

    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise GenerationError(f"{label}[{index}] harus berbentuk object.")
        result.append(item)

    return result


def yaml_string(value: str) -> str:
    """Menghasilkan string ber-quote yang valid untuk YAML front matter."""

    return json.dumps(value, ensure_ascii=False)


def html_text(value: str) -> str:
    """Menghindari injeksi HTML dari nama folder Koofr."""

    return html.escape(value, quote=True)


def write_text(path: Path, content: str) -> None:
    """Menulis file UTF-8 dengan newline konsisten."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8", newline="\n")


def liquid_relative_url(path: str) -> str:
    """Membuat ekspresi Liquid relative_url untuk tautan internal."""

    return "{{ " + yaml_string(path) + " | relative_url }}"


def front_matter(
    *,
    layout: str,
    title: str,
    description: str,
    permalink: str,
    values: dict[str, str],
) -> str:
    """Membuat YAML front matter halaman."""

    lines = [
        "---",
        f"layout: {layout}",
        f"title: {yaml_string(title)}",
        f"description: {yaml_string(description)}",
        f"permalink: {permalink}",
    ]

    for key, value in values.items():
        lines.append(f"{key}: {yaml_string(value)}")

    lines.extend(["---", "", GENERATED_MARKER, ""])

    return "\n".join(lines)


def build_region_page(region: dict[str, Any]) -> str:
    """Membuat halaman satu wilayah."""

    name = require_text(region.get("name"), "region.name")
    slug = require_slug(region.get("slug"), f"region {name}.slug")
    escaped_name = html_text(name)
    permalink = f"/arsip/wilayah/{slug}/"

    header = front_matter(
        layout="archive-region",
        title=f"{name} — Arsip Kuliner Surabaya",
        description=f"Dokumentasi kuliner di wilayah {name}.",
        permalink=permalink,
        values={
            "region_name": name,
            "region_slug": slug,
        },
    )

    return header + f"""<article class=\"archive-region-page\">
  <div class=\"archive-shell\">
    <nav class=\"archive-breadcrumb\" aria-label=\"Breadcrumb\">
      <ol class=\"archive-breadcrumb__list\">
        <li class=\"archive-breadcrumb__item\">
          <a class=\"archive-breadcrumb__link\" href=\"{liquid_relative_url('/arsip/')}\">Arsip</a>
        </li>
        <li class=\"archive-breadcrumb__item\" aria-current=\"page\">
          <span class=\"archive-breadcrumb__current\">{escaped_name}</span>
        </li>
      </ol>
    </nav>

    <header class=\"archive-region-hero\" aria-labelledby=\"archive-region-title\">
      <div class=\"archive-region-hero__copy\">
        <p class=\"archive-region-kicker\">Arsip Kuliner Surabaya · Wilayah</p>
        <h1 class=\"archive-region-title\" id=\"archive-region-title\">{escaped_name}</h1>
      </div>

      <div class=\"archive-region-hero__aside\">
        <p class=\"archive-region-description\">
          Dokumentasi tempat makan, sajian, dan kehidupan kuliner yang ditemukan di wilayah
          {escaped_name}. Kecamatan ditampilkan berdasarkan folder yang tersedia di Koofr.
        </p>

        <ul class=\"archive-region-stats\" aria-label=\"Statistik arsip {escaped_name}\">
          <li class=\"archive-region-stat\">
            <strong class=\"archive-region-stat__value\" id=\"region-district-count\">—</strong>
            <span class=\"archive-region-stat__label\">Kecamatan</span>
          </li>
          <li class=\"archive-region-stat\">
            <strong class=\"archive-region-stat__value\" id=\"region-place-count\">—</strong>
            <span class=\"archive-region-stat__label\">Tempat</span>
          </li>
          <li class=\"archive-region-stat\">
            <strong class=\"archive-region-stat__value\" id=\"region-media-count\">—</strong>
            <span class=\"archive-region-stat__label\">Dokumentasi</span>
          </li>
        </ul>
      </div>
    </header>

    <section class=\"archive-district-section\" aria-labelledby=\"archive-district-title\">
      <div class=\"archive-district-section__head\">
        <h2 class=\"archive-district-section__title\" id=\"archive-district-title\">Kecamatan</h2>
        <p class=\"archive-district-section__description\">
          Pilih kecamatan untuk melihat tempat dan dokumentasi kuliner yang tersedia di dalam arsip.
        </p>
      </div>

      <div class=\"archive-districts\" id=\"archive-districts\" aria-live=\"polite\" aria-busy=\"true\">
        <div class=\"archive-region-message\">
          <h3 class=\"archive-region-message__title\">Membaca katalog</h3>
          <p class=\"archive-region-message__body\">
            Daftar kecamatan sedang dimuat dari data Arsip Kuliner Surabaya.
          </p>
        </div>
      </div>

      <noscript>
        <div class=\"archive-region-message\">
          <h3 class=\"archive-region-message__title\">JavaScript tidak aktif</h3>
          <p class=\"archive-region-message__body\">
            Aktifkan JavaScript untuk melihat kecamatan dan dokumentasi yang tersedia.
          </p>
        </div>
      </noscript>
    </section>

    <div class=\"archive-region-return\">
      <a class=\"archive-region-return__link\" href=\"{liquid_relative_url('/arsip/')}\">
        <span aria-hidden=\"true\">←</span>
        <span>Kembali ke seluruh wilayah</span>
      </a>
    </div>
  </div>
</article>
"""


def build_district_page(
    region: dict[str, Any],
    district: dict[str, Any],
) -> str:
    """Membuat halaman satu kecamatan."""

    region_name = require_text(region.get("name"), "region.name")
    region_slug = require_slug(region.get("slug"), f"region {region_name}.slug")
    district_name = require_text(district.get("name"), "district.name")
    district_slug = require_slug(
        district.get("slug"),
        f"district {district_name}.slug",
    )

    escaped_region = html_text(region_name)
    escaped_district = html_text(district_name)
    region_url = f"/arsip/wilayah/{region_slug}/"
    permalink = f"{region_url}{district_slug}/"

    header = front_matter(
        layout="archive-district",
        title=f"{district_name} — Arsip Kuliner Surabaya",
        description=(
            f"Dokumentasi tempat makan dan sajian kuliner di Kecamatan "
            f"{district_name}, {region_name}."
        ),
        permalink=permalink,
        values={
            "region_name": region_name,
            "region_slug": region_slug,
            "district_name": district_name,
            "district_slug": district_slug,
        },
    )

    return header + f"""<article class=\"archive-district-page\">
  <div class=\"archive-shell\">
    <nav class=\"archive-district-breadcrumb\" aria-label=\"Breadcrumb\">
      <ol class=\"archive-district-breadcrumb__list\">
        <li class=\"archive-district-breadcrumb__item\">
          <a class=\"archive-district-breadcrumb__link\" href=\"{liquid_relative_url('/arsip/')}\">Arsip</a>
        </li>
        <li class=\"archive-district-breadcrumb__item\">
          <a class=\"archive-district-breadcrumb__link\" href=\"{liquid_relative_url(region_url)}\">{escaped_region}</a>
        </li>
        <li class=\"archive-district-breadcrumb__item\" aria-current=\"page\">
          <span class=\"archive-district-breadcrumb__current\">{escaped_district}</span>
        </li>
      </ol>
    </nav>

    <header class=\"archive-district-hero\" aria-labelledby=\"archive-district-title\">
      <div class=\"archive-district-hero__copy\">
        <p class=\"archive-district-kicker\">{escaped_region} · Kecamatan</p>
        <h1 class=\"archive-district-title\" id=\"archive-district-title\">{escaped_district}</h1>
      </div>

      <div class=\"archive-district-hero__aside\">
        <p class=\"archive-district-description\">
          Dokumentasi tempat makan, sajian, dan kehidupan kuliner yang tersimpan dalam folder
          Kecamatan {escaped_district}. Daftar tempat mengikuti isi terbaru katalog publik Koofr.
        </p>

        <ul class=\"archive-district-stats\" aria-label=\"Statistik arsip Kecamatan {escaped_district}\">
          <li class=\"archive-district-stat\">
            <strong class=\"archive-district-stat__value\" id=\"district-place-count\">—</strong>
            <span class=\"archive-district-stat__label\">Tempat</span>
          </li>
          <li class=\"archive-district-stat\">
            <strong class=\"archive-district-stat__value\" id=\"district-media-count\">—</strong>
            <span class=\"archive-district-stat__label\">Dokumentasi</span>
          </li>
        </ul>
      </div>
    </header>

    <section class=\"archive-place-section\" aria-labelledby=\"archive-place-title\">
      <div class=\"archive-place-section__head\">
        <h2 class=\"archive-place-section__title\" id=\"archive-place-title\">Tempat</h2>
        <p class=\"archive-place-section__description\">
          Pilih sebuah tempat untuk melihat seluruh foto, sajian, harga, dan waktu dokumentasi.
        </p>
      </div>

      <div class=\"archive-place-search\">
        <div class=\"archive-place-search__field\">
          <label class=\"archive-place-search__label\" for=\"archive-place-search\">
            Cari tempat, alamat, atau status
          </label>
          <input
            class=\"archive-place-search__input\"
            id=\"archive-place-search\"
            type=\"search\"
            name=\"q\"
            placeholder=\"Cari dalam Kecamatan {escaped_district}\"
            autocomplete=\"off\"
            spellcheck=\"false\"
            disabled
          />
        </div>
        <p class=\"archive-place-search__result\" id=\"archive-place-search-result\" aria-live=\"polite\">
          Membaca katalog
        </p>
      </div>

      <div class=\"archive-places\" id=\"archive-places\" aria-live=\"polite\" aria-busy=\"true\">
        <div class=\"archive-district-message\">
          <h3 class=\"archive-district-message__title\">Membaca katalog</h3>
          <p class=\"archive-district-message__body\">
            Daftar tempat sedang dimuat dari data Arsip Kuliner Surabaya.
          </p>
        </div>
      </div>

      <noscript>
        <div class=\"archive-district-message\">
          <h3 class=\"archive-district-message__title\">JavaScript tidak aktif</h3>
          <p class=\"archive-district-message__body\">
            Aktifkan JavaScript untuk melihat tempat dan dokumentasi yang tersedia.
          </p>
        </div>
      </noscript>
    </section>

    <div class=\"archive-district-return\">
      <a class=\"archive-district-return__link\" href=\"{liquid_relative_url(region_url)}\">
        <span aria-hidden=\"true\">←</span>
        <span>Kembali ke {escaped_region}</span>
      </a>
    </div>
  </div>
</article>
"""


def build_place_page(
    region: dict[str, Any],
    district: dict[str, Any],
    place: dict[str, Any],
) -> str:
    """Membuat halaman detail satu tempat."""

    region_name = require_text(region.get("name"), "region.name")
    region_slug = require_slug(region.get("slug"), f"region {region_name}.slug")
    district_name = require_text(district.get("name"), "district.name")
    district_slug = require_slug(
        district.get("slug"),
        f"district {district_name}.slug",
    )
    place_name = require_text(place.get("name"), "place.name")
    place_slug = require_slug(place.get("slug"), f"place {place_name}.slug")

    address_value = place.get("address")
    address = address_value.strip() if isinstance(address_value, str) else ""

    escaped_region = html_text(region_name)
    escaped_district = html_text(district_name)
    escaped_place = html_text(place_name)

    region_url = f"/arsip/wilayah/{region_slug}/"
    district_url = f"{region_url}{district_slug}/"
    permalink = f"{district_url}{place_slug}/"

    description = f"Dokumentasi kuliner {place_name} di Kecamatan {district_name}, {region_name}."
    if address:
        description = (
            f"Dokumentasi kuliner {place_name} di {address}, Kecamatan "
            f"{district_name}, {region_name}."
        )

    header = front_matter(
        layout="archive-place",
        title=f"{place_name} — Arsip Kuliner Surabaya",
        description=description,
        permalink=permalink,
        values={
            "region_name": region_name,
            "region_slug": region_slug,
            "district_name": district_name,
            "district_slug": district_slug,
            "place_name": place_name,
            "place_slug": place_slug,
        },
    )

    return header + f"""<article class=\"archive-place-page\">
  <div class=\"archive-shell\">
    <nav class=\"archive-place-breadcrumb\" aria-label=\"Breadcrumb\">
      <ol class=\"archive-place-breadcrumb__list\">
        <li class=\"archive-place-breadcrumb__item\">
          <a class=\"archive-place-breadcrumb__link\" href=\"{liquid_relative_url('/arsip/')}\">Arsip</a>
        </li>
        <li class=\"archive-place-breadcrumb__item\">
          <a class=\"archive-place-breadcrumb__link\" href=\"{liquid_relative_url(region_url)}\">{escaped_region}</a>
        </li>
        <li class=\"archive-place-breadcrumb__item\">
          <a class=\"archive-place-breadcrumb__link\" href=\"{liquid_relative_url(district_url)}\">{escaped_district}</a>
        </li>
        <li class=\"archive-place-breadcrumb__item\" aria-current=\"page\">
          <span class=\"archive-place-breadcrumb__current\">{escaped_place}</span>
        </li>
      </ol>
    </nav>

    <header class=\"archive-place-hero\" aria-labelledby=\"archive-place-title\">
      <div class=\"archive-place-hero__copy\">
        <p class=\"archive-place-kicker\">{escaped_district} · Tempat</p>
        <h1 class=\"archive-place-title\" id=\"archive-place-title\">{escaped_place}</h1>
      </div>

      <div class=\"archive-place-hero__aside\">
        <span class=\"archive-place-status\" id=\"place-status\">Membaca status</span>
        <p class=\"archive-place-address\" id=\"place-address\">
          Membaca alamat dari katalog Arsip Kuliner Surabaya.
        </p>

        <ul class=\"archive-place-stats\" aria-label=\"Statistik dokumentasi {escaped_place}\">
          <li class=\"archive-place-stat\">
            <strong class=\"archive-place-stat__value\" id=\"place-media-count\">—</strong>
            <span class=\"archive-place-stat__label\">Dokumentasi</span>
          </li>
          <li class=\"archive-place-stat\">
            <strong class=\"archive-place-stat__value\" id=\"place-date-range\">—</strong>
            <span class=\"archive-place-stat__label\">Rentang Waktu</span>
          </li>
        </ul>
      </div>
    </header>

    <section class=\"archive-gallery-section\" aria-labelledby=\"archive-gallery-title\">
      <div class=\"archive-gallery-section__head\">
        <h2 class=\"archive-gallery-section__title\" id=\"archive-gallery-title\">Dokumentasi</h2>
        <p class=\"archive-gallery-section__description\">
          Foto dan berkas ditampilkan bersama atribusi, informasi sajian, harga,
          tanggal, waktu, dan format arsip yang terbaca dari nama file.
        </p>
      </div>

      <div class=\"archive-media-grid\" id=\"archive-media-grid\" aria-live=\"polite\" aria-busy=\"true\">
        <div class=\"archive-place-message\">
          <h3 class=\"archive-place-message__title\">Membaca katalog</h3>
          <p class=\"archive-place-message__body\">
            Dokumentasi {escaped_place} sedang dimuat dari data Arsip Kuliner Surabaya.
          </p>
        </div>
      </div>

      <noscript>
        <div class=\"archive-place-message\">
          <h3 class=\"archive-place-message__title\">JavaScript tidak aktif</h3>
          <p class=\"archive-place-message__body\">
            Aktifkan JavaScript untuk melihat foto dan informasi dokumentasi yang tersedia.
          </p>
        </div>
      </noscript>
    </section>

    <section class=\"archive-place-note\" aria-labelledby=\"archive-place-note-title\">
      <h2 class=\"archive-place-note__title\" id=\"archive-place-note-title\">Catatan Arsip</h2>
      <p class=\"archive-place-note__body\">
        Status, harga, alamat, dan informasi sajian mencerminkan keadaan ketika dokumentasi dibuat.
        Informasi tersebut tidak selalu menggambarkan keadaan tempat pada hari ini. File asli tetap
        disimpan di Koofr.
      </p>
    </section>

    <div class=\"archive-place-return\">
      <a class=\"archive-place-return__link\" href=\"{liquid_relative_url(district_url)}\">
        <span aria-hidden=\"true\">←</span>
        <span>Kembali ke Kecamatan {escaped_district}</span>
      </a>
    </div>
  </div>
</article>
"""


def ensure_safe_output_root(output_root: Path, repository_root: Path) -> Path:
    """Mencegah penghapusan path di luar repository."""

    resolved_repository = repository_root.resolve()
    resolved_output = output_root.resolve()

    try:
        resolved_output.relative_to(resolved_repository)
    except ValueError as error:
        raise GenerationError(
            "output-root harus berada di dalam repository yang aktif."
        ) from error

    if resolved_output == resolved_repository:
        raise GenerationError("output-root tidak boleh sama dengan root repository.")

    if len(resolved_output.parts) <= len(resolved_repository.parts) + 1:
        raise GenerationError("output-root terlalu dekat dengan root repository dan tidak aman.")

    return resolved_output


def prepare_output_root(output_root: Path, force: bool) -> None:
    """Membersihkan halaman hasil generasi sebelumnya."""

    if output_root.exists():
        if not force:
            raise GenerationError(
                f"Output sudah ada: {output_root}. Jalankan ulang dengan --force untuk menggantinya."
            )

        if output_root.is_dir():
            shutil.rmtree(output_root)
        else:
            output_root.unlink()

    output_root.mkdir(parents=True, exist_ok=True)


def generate_pages(
    catalogue: dict[str, Any],
    output_root: Path,
) -> dict[str, int]:
    """Membuat seluruh halaman dan mengembalikan ringkasan."""

    regions = as_list(catalogue.get("regions"), "regions")
    region_names = [require_text(region.get("name"), "region.name") for region in regions]

    if tuple(region_names) != ALLOWED_REGION_NAMES:
        raise GenerationError(
            "Daftar atau urutan wilayah catalogue tidak sama dengan allowlist publik."
        )

    generated_regions = 0
    generated_districts = 0
    generated_places = 0
    seen_paths: set[Path] = set()

    for region in regions:
        region_slug = require_slug(region.get("slug"), "region.slug")
        region_path = output_root / region_slug / "index.html"

        if region_path in seen_paths:
            raise GenerationError(f"Path halaman bertabrakan: {region_path}")

        seen_paths.add(region_path)
        write_text(region_path, build_region_page(region))
        generated_regions += 1

        districts = as_list(
            region.get("districts"),
            f"region {region_slug}.districts",
        )

        for district in districts:
            district_slug = require_slug(
                district.get("slug"),
                f"district dalam {region_slug}.slug",
            )
            district_path = output_root / region_slug / district_slug / "index.html"

            if district_path in seen_paths:
                raise GenerationError(f"Path halaman bertabrakan: {district_path}")

            seen_paths.add(district_path)
            write_text(district_path, build_district_page(region, district))
            generated_districts += 1

            places = as_list(
                district.get("places"),
                f"district {district_slug}.places",
            )

            for place in places:
                place_slug = require_slug(
                    place.get("slug"),
                    f"place dalam {district_slug}.slug",
                )
                place_path = (
                    output_root
                    / region_slug
                    / district_slug
                    / place_slug
                    / "index.html"
                )

                if place_path in seen_paths:
                    raise GenerationError(f"Path halaman bertabrakan: {place_path}")

                seen_paths.add(place_path)
                write_text(place_path, build_place_page(region, district, place))
                generated_places += 1

    manifest = {
        "schemaVersion": 1,
        "generatedFrom": "assets/data/archive.json",
        "regionPages": generated_regions,
        "districtPages": generated_districts,
        "placePages": generated_places,
    }

    write_text(
        output_root / "catalogue-pages.json",
        json.dumps(manifest, ensure_ascii=False, indent=2),
    )

    return {
        "regions": generated_regions,
        "districts": generated_districts,
        "places": generated_places,
    }


def parse_arguments() -> argparse.Namespace:
    """Membaca argumen command line."""

    parser = argparse.ArgumentParser(
        description="Generate Jekyll archive pages from archive.json."
    )

    parser.add_argument(
        "--catalogue",
        default="assets/data/archive.json",
        help="Path archive.json. Default: assets/data/archive.json",
    )

    parser.add_argument(
        "--output-root",
        default="arsip/wilayah",
        help="Folder root halaman wilayah. Default: arsip/wilayah",
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Hapus output lama sebelum membuat ulang seluruh halaman.",
    )

    return parser.parse_args()


def main() -> int:
    """Entry point."""

    arguments = parse_arguments()
    repository_root = Path.cwd()
    catalogue_path = Path(arguments.catalogue)
    output_root = ensure_safe_output_root(
        Path(arguments.output_root),
        repository_root,
    )

    try:
        catalogue = read_json(catalogue_path)
        prepare_output_root(output_root, arguments.force)
        summary = generate_pages(catalogue, output_root)
    except GenerationError as error:
        print(f"::error::{error}", file=sys.stderr, flush=True)
        return 1
    except Exception as error:
        print(
            f"::error::Kesalahan tak terduga saat membuat halaman arsip: {error}",
            file=sys.stderr,
            flush=True,
        )
        return 1

    print("Archive pages generated successfully.")
    print(f"- Region pages: {summary['regions']}")
    print(f"- District pages: {summary['districts']}")
    print(f"- Place pages: {summary['places']}")
    print(f"- Output root: {output_root}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
