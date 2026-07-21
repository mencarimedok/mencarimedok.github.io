/**
 * MENCARI MEDOK — ARSIP KULINER SURABAYA
 *
 * Membaca katalog JSON yang dihasilkan dari Koofr,
 * lalu memperbarui informasi pada kartu wilayah.
 */

(() => {
  "use strict";

  const REGION_CARD_SELECTOR = "[data-region-slug]";
  const REGION_META_SELECTOR = "[data-region-meta]";

  /**
   * Mengubah nilai apa pun menjadi bilangan bulat aman.
   *
   * @param {unknown} value
   * @returns {number}
   */
  function toSafeInteger(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
      return 0;
    }

    return Math.floor(number);
  }

  /**
   * Menampilkan angka memakai format Indonesia.
   *
   * @param {number} value
   * @returns {string}
   */
  function formatNumber(value) {
    return new Intl.NumberFormat("id-ID").format(
      toSafeInteger(value)
    );
  }

  /**
   * Membentuk informasi ringkas sebuah wilayah.
   *
   * @param {object} region
   * @returns {string}
   */
  function buildRegionMeta(region) {
    const districtCount = toSafeInteger(
      region.districtCount
    );

    const placeCount = toSafeInteger(
      region.placeCount
    );

    const mediaCount = toSafeInteger(
      region.mediaCount
    );

    if (
      districtCount === 0 &&
      placeCount === 0 &&
      mediaCount === 0
    ) {
      return "Belum ada dokumentasi";
    }

    return [
      `${formatNumber(districtCount)} kecamatan`,
      `${formatNumber(placeCount)} tempat`,
      `${formatNumber(mediaCount)} dokumentasi`
    ].join(" · ");
  }

  /**
   * Mencari data wilayah berdasarkan slug.
   *
   * @param {Array<object>} regions
   * @param {string} slug
   * @returns {object|null}
   */
  function findRegionBySlug(regions, slug) {
    return (
      regions.find((region) => {
        return region && region.slug === slug;
      }) || null
    );
  }

  /**
   * Memperbarui seluruh kartu wilayah di landing page.
   *
   * @param {Array<object>} regions
   */
  function updateRegionCards(regions) {
    const cards = document.querySelectorAll(
      REGION_CARD_SELECTOR
    );

    cards.forEach((card) => {
      const slug = card.dataset.regionSlug;
      const metaElement = card.querySelector(
        REGION_META_SELECTOR
      );

      if (!slug || !metaElement) {
        return;
      }

      const region = findRegionBySlug(
        regions,
        slug
      );

      if (!region) {
        metaElement.textContent =
          "Data wilayah belum tersedia";

        card.dataset.archiveState = "missing";

        return;
      }

      const districtCount = toSafeInteger(
        region.districtCount
      );

      const placeCount = toSafeInteger(
        region.placeCount
      );

      const mediaCount = toSafeInteger(
        region.mediaCount
      );

      metaElement.textContent =
        buildRegionMeta(region);

      card.dataset.districtCount =
        String(districtCount);

      card.dataset.placeCount =
        String(placeCount);

      card.dataset.mediaCount =
        String(mediaCount);

      card.dataset.archiveState =
        mediaCount > 0 ? "available" : "empty";
    });
  }

  /**
   * Memformat tanggal ISO menjadi waktu Indonesia Barat.
   *
   * @param {unknown} value
   * @returns {string|null}
   */
  function formatGeneratedAt(value) {
    if (typeof value !== "string" || !value) {
      return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const formatter = new Intl.DateTimeFormat(
      "id-ID",
      {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Asia/Jakarta"
      }
    );

    return `${formatter.format(date)} WIB`;
  }

  /**
   * Memperbarui teks waktu sinkronisasi.
   *
   * @param {object} catalogue
   */
  function updateGeneratedTime(catalogue) {
    const timeElement = document.getElementById(
      "archive-updated"
    );

    if (!timeElement) {
      return;
    }

    if (catalogue.mode === "sample") {
      timeElement.textContent =
        "Data contoh untuk pengujian frontend";

      timeElement.removeAttribute("datetime");

      return;
    }

    const formattedTime = formatGeneratedAt(
      catalogue.generatedAt
    );

    if (!formattedTime) {
      timeElement.textContent =
        "Waktu sinkronisasi belum tersedia";

      timeElement.removeAttribute("datetime");

      return;
    }

    timeElement.textContent = formattedTime;

    timeElement.setAttribute(
      "datetime",
      catalogue.generatedAt
    );
  }

  /**
   * Memeriksa bentuk dasar katalog.
   *
   * @param {unknown} catalogue
   * @returns {catalogue is {
   *   mode?: string,
   *   generatedAt?: string|null,
   *   regions: Array<object>
   * }}
   */
  function isValidCatalogue(catalogue) {
    return Boolean(
      catalogue &&
      typeof catalogue === "object" &&
      Array.isArray(catalogue.regions)
    );
  }

  /**
   * Memberi informasi kegagalan pada kartu dan status arsip.
   */
  function showLoadingError() {
    const cards = document.querySelectorAll(
      REGION_CARD_SELECTOR
    );

    cards.forEach((card) => {
      const metaElement = card.querySelector(
        REGION_META_SELECTOR
      );

      if (metaElement) {
        metaElement.textContent =
          "Katalog belum dapat dimuat";
      }

      card.dataset.archiveState = "error";
    });

    const timeElement = document.getElementById(
      "archive-updated"
    );

    if (timeElement) {
      timeElement.textContent =
        "Gagal membaca data katalog";

      timeElement.removeAttribute("datetime");
    }
  }

  /**
   * Menghasilkan URL katalog dengan penanda waktu
   * agar browser tidak memakai data lama dari cache.
   *
   * @param {string} source
   * @returns {string}
   */
  function createCatalogueUrl(source) {
    const url = new URL(
      source,
      window.location.href
    );

    url.searchParams.set(
      "v",
      Date.now().toString()
    );

    return url.toString();
  }

  /**
   * Membaca katalog arsip.
   */
  async function loadArchiveCatalogue() {
    const regionContainer = document.getElementById(
      "archive-regions"
    );

    const source =
      document.body.dataset.archiveDataUrl;

    if (!source) {
      console.error(
        "Lokasi archive.json tidak ditemukan."
      );

      showLoadingError();

      if (regionContainer) {
        regionContainer.setAttribute(
          "aria-busy",
          "false"
        );
      }

      return;
    }

    try {
      const response = await fetch(
        createCatalogueUrl(source),
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          },
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(
          `Permintaan katalog gagal dengan status ${response.status}.`
        );
      }

      const catalogue = await response.json();

      if (!isValidCatalogue(catalogue)) {
        throw new TypeError(
          "Struktur archive.json tidak valid."
        );
      }

      updateRegionCards(catalogue.regions);
      updateGeneratedTime(catalogue);
    } catch (error) {
      console.error(
        "Gagal memuat katalog Arsip Kuliner Surabaya:",
        error
      );

      showLoadingError();
    } finally {
      if (regionContainer) {
        regionContainer.setAttribute(
          "aria-busy",
          "false"
        );
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      loadArchiveCatalogue,
      { once: true }
    );
  } else {
    loadArchiveCatalogue();
  }
})();
