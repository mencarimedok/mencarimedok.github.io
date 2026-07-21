/**
 * MENCARI MEDOK — HALAMAN WILAYAH ARSIP
 *
 * Fungsi:
 * - Membaca assets/data/archive.json
 * - Menemukan wilayah berdasarkan slug halaman
 * - Menampilkan statistik wilayah
 * - Membuat kartu kecamatan secara dinamis
 */

(() => {
  "use strict";

  const SELECTORS = {
    districtContainer: "#archive-districts",
    districtCount: "#region-district-count",
    placeCount: "#region-place-count",
    mediaCount: "#region-media-count"
  };

  /**
   * Mengubah nilai menjadi bilangan bulat aman.
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
   * Memformat angka berdasarkan lokal Indonesia.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function formatNumber(value) {
    return new Intl.NumberFormat("id-ID").format(
      toSafeInteger(value)
    );
  }

  /**
   * Membuat slug aman dari nama folder.
   *
   * Slug dari archive.json tetap menjadi prioritas.
   * Fungsi ini hanya dipakai sebagai fallback.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/&/g, " dan ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Menghindari penyisipan HTML mentah dari data.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Mengambil daftar tempat yang valid dari kecamatan.
   *
   * @param {unknown} district
   * @returns {Array<object>}
   */
  function getPlaces(district) {
    if (
      !district ||
      typeof district !== "object" ||
      !Array.isArray(district.places)
    ) {
      return [];
    }

    return district.places.filter((place) => {
      return place && typeof place === "object";
    });
  }

  /**
   * Mengambil daftar media yang valid dari tempat.
   *
   * @param {unknown} place
   * @returns {Array<object>}
   */
  function getMedia(place) {
    if (
      !place ||
      typeof place !== "object" ||
      !Array.isArray(place.media)
    ) {
      return [];
    }

    return place.media.filter((media) => {
      return media && typeof media === "object";
    });
  }

  /**
   * Menghitung jumlah dokumentasi berdasarkan isi sebenarnya.
   *
   * @param {object} district
   * @returns {number}
   */
  function deriveDistrictMediaCount(district) {
    return getPlaces(district).reduce(
      (total, place) => {
        return total + getMedia(place).length;
      },
      0
    );
  }

  /**
   * Mengambil jumlah tempat pada kecamatan.
   *
   * Isi array menjadi sumber utama.
   * Nilai placeCount dipakai hanya sebagai fallback.
   *
   * @param {object} district
   * @returns {number}
   */
  function getDistrictPlaceCount(district) {
    const places = getPlaces(district);

    if (places.length > 0) {
      return places.length;
    }

    return toSafeInteger(district.placeCount);
  }

  /**
   * Mengambil jumlah dokumentasi pada kecamatan.
   *
   * Isi media menjadi sumber utama.
   * Nilai mediaCount dipakai sebagai fallback.
   *
   * @param {object} district
   * @returns {number}
   */
  function getDistrictMediaCount(district) {
    const derivedCount =
      deriveDistrictMediaCount(district);

    if (derivedCount > 0) {
      return derivedCount;
    }

    return toSafeInteger(district.mediaCount);
  }

  /**
   * Mengambil kecamatan valid dari wilayah.
   *
   * @param {unknown} region
   * @returns {Array<object>}
   */
  function getDistricts(region) {
    if (
      !region ||
      typeof region !== "object" ||
      !Array.isArray(region.districts)
    ) {
      return [];
    }

    return region.districts.filter((district) => {
      return (
        district &&
        typeof district === "object" &&
        typeof district.name === "string" &&
        district.name.trim() !== ""
      );
    });
  }

  /**
   * Menghitung statistik berdasarkan isi wilayah.
   *
   * Array aktual diprioritaskan agar angka tidak mudah
   * berbeda dari data yang ditampilkan.
   *
   * @param {object} region
   * @returns {{
   *   districtCount: number,
   *   placeCount: number,
   *   mediaCount: number
   * }}
   */
  function deriveRegionStatistics(region) {
    const districts = getDistricts(region);

    const placeCount = districts.reduce(
      (total, district) => {
        return (
          total +
          getDistrictPlaceCount(district)
        );
      },
      0
    );

    const mediaCount = districts.reduce(
      (total, district) => {
        return (
          total +
          getDistrictMediaCount(district)
        );
      },
      0
    );

    return {
      districtCount:
        districts.length > 0
          ? districts.length
          : toSafeInteger(region.districtCount),

      placeCount:
        placeCount > 0
          ? placeCount
          : toSafeInteger(region.placeCount),

      mediaCount:
        mediaCount > 0
          ? mediaCount
          : toSafeInteger(region.mediaCount)
    };
  }

  /**
   * Memperbarui satu elemen statistik.
   *
   * @param {string} selector
   * @param {number} value
   */
  function updateStatistic(selector, value) {
    const element =
      document.querySelector(selector);

    if (!element) {
      return;
    }

    element.textContent = formatNumber(value);
  }

  /**
   * Memperbarui seluruh statistik wilayah.
   *
   * @param {object} region
   */
  function updateRegionStatistics(region) {
    const statistics =
      deriveRegionStatistics(region);

    updateStatistic(
      SELECTORS.districtCount,
      statistics.districtCount
    );

    updateStatistic(
      SELECTORS.placeCount,
      statistics.placeCount
    );

    updateStatistic(
      SELECTORS.mediaCount,
      statistics.mediaCount
    );
  }

  /**
   * Menyusun URL halaman kecamatan.
   *
   * @param {string} regionSlug
   * @param {string} districtSlug
   * @returns {string}
   */
  function buildDistrictUrl(
    regionSlug,
    districtSlug
  ) {
    const currentPath = window.location.pathname;

    const archiveIndex =
      currentPath.indexOf("/arsip/");

    const basePath =
      archiveIndex >= 0
        ? currentPath.slice(0, archiveIndex)
        : "";

    return [
      basePath,
      "arsip",
      "wilayah",
      encodeURIComponent(regionSlug),
      encodeURIComponent(districtSlug),
      ""
    ]
      .join("/")
      .replace(/\/{2,}/g, "/");
  }

  /**
   * Membuat teks metadata kartu kecamatan.
   *
   * @param {object} district
   * @returns {string}
   */
  function buildDistrictMeta(district) {
    const placeCount =
      getDistrictPlaceCount(district);

    const mediaCount =
      getDistrictMediaCount(district);

    if (
      placeCount === 0 &&
      mediaCount === 0
    ) {
      return "Belum ada dokumentasi";
    }

    return [
      `${formatNumber(placeCount)} tempat`,
      `${formatNumber(mediaCount)} dokumentasi`
    ].join(" · ");
  }

  /**
   * Membuat satu kartu kecamatan.
   *
   * @param {object} district
   * @param {number} index
   * @param {string} regionSlug
   * @returns {HTMLAnchorElement}
   */
  function createDistrictCard(
    district,
    index,
    regionSlug
  ) {
    const districtName =
      String(district.name || "").trim();

    const districtSlug =
      String(district.slug || "").trim() ||
      slugify(districtName);

    const card =
      document.createElement("a");

    card.className =
      "archive-district-card";

    card.href = buildDistrictUrl(
      regionSlug,
      districtSlug
    );

    card.dataset.districtSlug =
      districtSlug;

    card.dataset.placeCount = String(
      getDistrictPlaceCount(district)
    );

    card.dataset.mediaCount = String(
      getDistrictMediaCount(district)
    );

    const number = String(index + 1).padStart(
      2,
      "0"
    );

    card.innerHTML = `
      <div class="archive-district-card__top">
        <span class="archive-district-card__number">
          ${escapeHtml(number)}
        </span>

        <span
          class="archive-district-card__arrow"
          aria-hidden="true"
        >
          ↗
        </span>
      </div>

      <div class="archive-district-card__body">
        <h3 class="archive-district-card__title">
          ${escapeHtml(districtName)}
        </h3>

        <p class="archive-district-card__meta">
          ${escapeHtml(buildDistrictMeta(district))}
        </p>
      </div>
    `;

    card.setAttribute(
      "aria-label",
      `Buka arsip Kecamatan ${districtName}`
    );

    return card;
  }

  /**
   * Membuat pesan status.
   *
   * @param {string} title
   * @param {string} body
   * @returns {HTMLDivElement}
   */
  function createMessage(title, body) {
    const message =
      document.createElement("div");

    message.className =
      "archive-region-message";

    message.innerHTML = `
      <h3 class="archive-region-message__title">
        ${escapeHtml(title)}
      </h3>

      <p class="archive-region-message__body">
        ${escapeHtml(body)}
      </p>
    `;

    return message;
  }

  /**
   * Menampilkan seluruh kecamatan.
   *
   * @param {object} region
   * @param {string} regionSlug
   */
  function renderDistricts(
    region,
    regionSlug
  ) {
    const container =
      document.querySelector(
        SELECTORS.districtContainer
      );

    if (!container) {
      return;
    }

    container.replaceChildren();

    const districts = getDistricts(region);

    if (districts.length === 0) {
      container.appendChild(
        createMessage(
          "Belum ada kecamatan",
          "Wilayah ini belum memiliki folder kecamatan yang dipublikasikan dalam katalog."
        )
      );

      container.dataset.archiveState =
        "empty";

      return;
    }

    const sortedDistricts = [...districts].sort(
      (first, second) => {
        return String(first.name).localeCompare(
          String(second.name),
          "id-ID",
          {
            sensitivity: "base",
            numeric: true
          }
        );
      }
    );

    const fragment =
      document.createDocumentFragment();

    sortedDistricts.forEach(
      (district, index) => {
        fragment.appendChild(
          createDistrictCard(
            district,
            index,
            regionSlug
          )
        );
      }
    );

    container.appendChild(fragment);

    container.dataset.archiveState =
      "available";
  }

  /**
   * Mencari wilayah berdasarkan slug.
   *
   * @param {Array<object>} regions
   * @param {string} regionSlug
   * @returns {object|null}
   */
  function findRegion(regions, regionSlug) {
    return (
      regions.find((region) => {
        return (
          region &&
          typeof region === "object" &&
          region.slug === regionSlug
        );
      }) || null
    );
  }

  /**
   * Memastikan struktur dasar katalog valid.
   *
   * @param {unknown} catalogue
   * @returns {boolean}
   */
  function isValidCatalogue(catalogue) {
    return Boolean(
      catalogue &&
      typeof catalogue === "object" &&
      Array.isArray(catalogue.regions)
    );
  }

  /**
   * Menambahkan penanda waktu pada URL agar data
   * terbaru tidak tertahan cache browser.
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
   * Menampilkan keadaan gagal.
   *
   * @param {string} title
   * @param {string} body
   */
  function showError(title, body) {
    const container =
      document.querySelector(
        SELECTORS.districtContainer
      );

    if (container) {
      container.replaceChildren(
        createMessage(title, body)
      );

      container.dataset.archiveState =
        "error";
    }

    updateStatistic(
      SELECTORS.districtCount,
      0
    );

    updateStatistic(
      SELECTORS.placeCount,
      0
    );

    updateStatistic(
      SELECTORS.mediaCount,
      0
    );
  }

  /**
   * Menandai proses pemuatan sudah berakhir.
   */
  function finishLoading() {
    const container =
      document.querySelector(
        SELECTORS.districtContainer
      );

    if (container) {
      container.setAttribute(
        "aria-busy",
        "false"
      );
    }
  }

  /**
   * Memuat data wilayah dari katalog.
   */
  async function loadRegionPage() {
    const body = document.body;

    const source =
      body.dataset.archiveDataUrl;

    const regionSlug =
      String(
        body.dataset.regionSlug || ""
      ).trim();

    if (!source) {
      console.error(
        "Lokasi archive.json tidak ditemukan."
      );

      showError(
        "Katalog tidak ditemukan",
        "Halaman tidak memiliki alamat sumber data arsip."
      );

      finishLoading();
      return;
    }

    if (!regionSlug) {
      console.error(
        "Slug wilayah tidak ditemukan."
      );

      showError(
        "Wilayah tidak dikenali",
        "Halaman tidak memiliki identitas wilayah yang valid."
      );

      finishLoading();
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

      const catalogue =
        await response.json();

      if (!isValidCatalogue(catalogue)) {
        throw new TypeError(
          "Struktur archive.json tidak valid."
        );
      }

      const region = findRegion(
        catalogue.regions,
        regionSlug
      );

      if (!region) {
        showError(
          "Wilayah belum tersedia",
          "Wilayah ini tidak ditemukan dalam katalog publik Arsip Kuliner Surabaya."
        );

        return;
      }

      updateRegionStatistics(region);

      renderDistricts(
        region,
        regionSlug
      );
    } catch (error) {
      console.error(
        "Gagal memuat halaman wilayah arsip:",
        error
      );

      showError(
        "Katalog gagal dimuat",
        "Data wilayah belum dapat dibaca. Silakan coba membuka halaman ini kembali beberapa saat lagi."
      );
    } finally {
      finishLoading();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      loadRegionPage,
      { once: true }
    );
  } else {
    loadRegionPage();
  }
})();
