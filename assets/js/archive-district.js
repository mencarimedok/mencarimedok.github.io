/**
 * MENCARI MEDOK — HALAMAN KECAMATAN ARSIP
 *
 * Fungsi:
 * - Membaca assets/data/archive.json
 * - Menemukan wilayah dan kecamatan berdasarkan slug halaman
 * - Menampilkan statistik kecamatan
 * - Membuat kartu tempat secara dinamis
 * - Menampilkan foto pratinjau jika tersedia
 * - Menyediakan pencarian tempat
 */

(() => {
  "use strict";

  const SELECTORS = {
    placeContainer: "#archive-places",
    placeCount: "#district-place-count",
    mediaCount: "#district-media-count",
    searchInput: "#archive-place-search",
    searchResult: "#archive-place-search-result"
  };

  const state = {
    regionSlug: "",
    districtSlug: "",
    places: []
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
   * Menampilkan angka dengan format Indonesia.
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
   * Membuat slug sebagai fallback.
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
   * Menormalisasi teks untuk pencarian.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("id-ID")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Mengambil media yang valid dari sebuah tempat.
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
   * Menghitung jumlah dokumentasi sebuah tempat.
   *
   * Isi array media menjadi sumber utama.
   * mediaCount dipakai sebagai fallback.
   *
   * @param {object} place
   * @returns {number}
   */
  function getPlaceMediaCount(place) {
    const media = getMedia(place);

    if (media.length > 0) {
      return media.length;
    }

    return toSafeInteger(place.mediaCount);
  }

  /**
   * Mengambil daftar tempat yang valid.
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
      return (
        place &&
        typeof place === "object" &&
        typeof place.name === "string" &&
        place.name.trim() !== ""
      );
    });
  }

  /**
   * Mengambil daftar kecamatan valid.
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
        typeof district.name === "string"
      );
    });
  }

  /**
   * Memperbarui satu angka statistik.
   *
   * @param {string} selector
   * @param {number} value
   */
  function updateStatistic(selector, value) {
    const element = document.querySelector(selector);

    if (!element) {
      return;
    }

    element.textContent = formatNumber(value);
  }

  /**
   * Memperbarui statistik kecamatan.
   *
   * @param {object} district
   */
  function updateDistrictStatistics(district) {
    const places = getPlaces(district);

    const mediaCount = places.reduce(
      (total, place) => {
        return total + getPlaceMediaCount(place);
      },
      0
    );

    updateStatistic(
      SELECTORS.placeCount,
      places.length > 0
        ? places.length
        : toSafeInteger(district.placeCount)
    );

    updateStatistic(
      SELECTORS.mediaCount,
      mediaCount > 0
        ? mediaCount
        : toSafeInteger(district.mediaCount)
    );
  }

  /**
   * Menentukan base path situs sebelum /arsip/.
   *
   * Berguna apabila situs memakai baseurl.
   *
   * @returns {string}
   */
  function getSiteBasePath() {
    const currentPath = window.location.pathname;
    const archiveIndex = currentPath.indexOf("/arsip/");

    if (archiveIndex < 0) {
      return "";
    }

    return currentPath.slice(0, archiveIndex);
  }

  /**
   * Menyusun URL halaman detail tempat.
   *
   * @param {string} regionSlug
   * @param {string} districtSlug
   * @param {string} placeSlug
   * @returns {string}
   */
  function buildPlaceUrl(
    regionSlug,
    districtSlug,
    placeSlug
  ) {
    const basePath = getSiteBasePath();

    return [
      basePath,
      "arsip",
      "wilayah",
      encodeURIComponent(regionSlug),
      encodeURIComponent(districtSlug),
      encodeURIComponent(placeSlug),
      ""
    ]
      .join("/")
      .replace(/\/{2,}/g, "/");
  }

  /**
   * Memeriksa apakah URL terlihat aman untuk dipakai.
   *
   * @param {unknown} value
   * @returns {string|null}
   */
  function getSafeUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    try {
      const url = new URL(
        value,
        window.location.href
      );

      if (
        url.protocol !== "http:" &&
        url.protocol !== "https:"
      ) {
        return null;
      }

      return url.toString();
    } catch {
      return null;
    }
  }

  /**
   * Mencari media pertama yang memiliki preview.
   *
   * @param {object} place
   * @returns {object|null}
   */
  function findPreviewMedia(place) {
    const media = getMedia(place);

    return (
      media.find((item) => {
        return getSafeUrl(item.previewUrl);
      }) || null
    );
  }

  /**
   * Membuat elemen media pada kartu tempat.
   *
   * @param {object} place
   * @returns {HTMLDivElement}
   */
  function createPlaceMedia(place) {
    const mediaContainer =
      document.createElement("div");

    mediaContainer.className =
      "archive-place-card__media";

    const previewMedia = findPreviewMedia(place);

    if (previewMedia) {
      const image = document.createElement("img");

      image.className =
        "archive-place-card__image";

      image.src = getSafeUrl(
        previewMedia.previewUrl
      );

      image.alt = previewMedia.dish
        ? `${previewMedia.dish} di ${place.name}`
        : `Dokumentasi ${place.name}`;

      image.loading = "lazy";
      image.decoding = "async";

      image.addEventListener(
        "error",
        () => {
          const placeholder =
            createMediaPlaceholder();

          image.replaceWith(placeholder);
        },
        { once: true }
      );

      mediaContainer.appendChild(image);
    } else {
      mediaContainer.appendChild(
        createMediaPlaceholder()
      );
    }

    const status = String(
      place.status || ""
    ).trim();

    if (status) {
      const statusElement =
        document.createElement("span");

      statusElement.className =
        "archive-place-card__status";

      statusElement.textContent = status;

      mediaContainer.appendChild(statusElement);
    }

    return mediaContainer;
  }

  /**
   * Membuat placeholder ketika foto belum tersedia.
   *
   * @returns {HTMLDivElement}
   */
  function createMediaPlaceholder() {
    const placeholder =
      document.createElement("div");

    placeholder.className =
      "archive-place-card__placeholder";

    placeholder.textContent =
      "Pratinjau foto belum tersedia";

    return placeholder;
  }

  /**
   * Membuat satu kartu tempat.
   *
   * @param {object} place
   * @param {number} index
   * @returns {HTMLAnchorElement}
   */
  function createPlaceCard(place, index) {
    const placeName = String(
      place.name || ""
    ).trim();

    const placeSlug =
      String(place.slug || "").trim() ||
      slugify(placeName);

    const card = document.createElement("a");

    card.className = "archive-place-card";

    card.href = buildPlaceUrl(
      state.regionSlug,
      state.districtSlug,
      placeSlug
    );

    card.dataset.placeSlug = placeSlug;
    card.dataset.placeName = placeName;
    card.dataset.placeStatus = String(
      place.status || ""
    );
    card.dataset.placeAddress = String(
      place.address || ""
    );

    card.setAttribute(
      "aria-label",
      `Buka dokumentasi ${placeName}`
    );

    card.appendChild(
      createPlaceMedia(place)
    );

    const body = document.createElement("div");

    body.className =
      "archive-place-card__body";

    const header = document.createElement("div");

    header.className =
      "archive-place-card__header";

    const number = document.createElement("span");

    number.className =
      "archive-place-card__number";

    number.textContent = String(
      index + 1
    ).padStart(2, "0");

    const title = document.createElement("h3");

    title.className =
      "archive-place-card__title";

    title.textContent = placeName;

    header.append(number, title);

    const address = String(
      place.address || ""
    ).trim();

    if (address) {
      const addressElement =
        document.createElement("p");

      addressElement.className =
        "archive-place-card__address";

      addressElement.textContent = address;

      header.appendChild(addressElement);
    }

    const footer = document.createElement("div");

    footer.className =
      "archive-place-card__footer";

    const meta = document.createElement("p");

    meta.className =
      "archive-place-card__meta";

    const mediaCount =
      getPlaceMediaCount(place);

    meta.textContent =
      mediaCount > 0
        ? `${formatNumber(mediaCount)} dokumentasi`
        : "Belum ada dokumentasi";

    const arrow = document.createElement("span");

    arrow.className =
      "archive-place-card__arrow";

    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";

    footer.append(meta, arrow);
    body.append(header, footer);
    card.appendChild(body);

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
    const message = document.createElement("div");

    message.className =
      "archive-district-message";

    const heading = document.createElement("h3");

    heading.className =
      "archive-district-message__title";

    heading.textContent = title;

    const paragraph = document.createElement("p");

    paragraph.className =
      "archive-district-message__body";

    paragraph.textContent = body;

    message.append(heading, paragraph);

    return message;
  }

  /**
   * Mengurutkan tempat berdasarkan nama.
   *
   * @param {Array<object>} places
   * @returns {Array<object>}
   */
  function sortPlaces(places) {
    return [...places].sort((first, second) => {
      return String(first.name).localeCompare(
        String(second.name),
        "id-ID",
        {
          sensitivity: "base",
          numeric: true
        }
      );
    });
  }

  /**
   * Memperbarui keterangan hasil pencarian.
   *
   * @param {number} visibleCount
   * @param {number} totalCount
   * @param {string} query
   */
  function updateSearchResult(
    visibleCount,
    totalCount,
    query = ""
  ) {
    const element = document.querySelector(
      SELECTORS.searchResult
    );

    if (!element) {
      return;
    }

    if (totalCount === 0) {
      element.textContent =
        "Belum ada tempat";
      return;
    }

    if (query) {
      element.textContent =
        `${formatNumber(visibleCount)} dari ` +
        `${formatNumber(totalCount)} tempat`;
      return;
    }

    element.textContent =
      `${formatNumber(totalCount)} tempat`;
  }

  /**
   * Menampilkan kartu tempat.
   *
   * @param {Array<object>} places
   * @param {string} query
   */
  function renderPlaces(places, query = "") {
    const container = document.querySelector(
      SELECTORS.placeContainer
    );

    if (!container) {
      return;
    }

    container.replaceChildren();

    const normalizedQuery =
      normalizeSearchText(query);

    const filteredPlaces = places.filter(
      (place) => {
        if (!normalizedQuery) {
          return true;
        }

        const searchableText = [
          place.name,
          place.address,
          place.status
        ]
          .map(normalizeSearchText)
          .join(" ");

        return searchableText.includes(
          normalizedQuery
        );
      }
    );

    if (
      filteredPlaces.length === 0 &&
      places.length === 0
    ) {
      container.appendChild(
        createMessage(
          "Belum ada tempat",
          "Kecamatan ini belum memiliki folder tempat yang dipublikasikan dalam katalog."
        )
      );

      container.dataset.archiveState = "empty";

      updateSearchResult(0, 0, query);

      return;
    }

    if (filteredPlaces.length === 0) {
      container.appendChild(
        createMessage(
          "Tempat tidak ditemukan",
          "Tidak ada nama tempat, alamat, atau status yang cocok dengan pencarian."
        )
      );

      container.dataset.archiveState =
        "no-results";

      updateSearchResult(
        0,
        places.length,
        query
      );

      return;
    }

    const fragment =
      document.createDocumentFragment();

    filteredPlaces.forEach((place, index) => {
      fragment.appendChild(
        createPlaceCard(place, index)
      );
    });

    container.appendChild(fragment);

    container.dataset.archiveState =
      "available";

    updateSearchResult(
      filteredPlaces.length,
      places.length,
      query
    );
  }

  /**
   * Mengaktifkan pencarian tempat.
   */
  function enableSearch() {
    const input = document.querySelector(
      SELECTORS.searchInput
    );

    if (!input) {
      return;
    }

    input.disabled = state.places.length === 0;

    input.addEventListener("input", () => {
      renderPlaces(
        state.places,
        input.value
      );
    });
  }

  /**
   * Mencari wilayah berdasarkan slug.
   *
   * @param {Array<object>} regions
   * @param {string} slug
   * @returns {object|null}
   */
  function findRegion(regions, slug) {
    return (
      regions.find((region) => {
        return (
          region &&
          typeof region === "object" &&
          region.slug === slug
        );
      }) || null
    );
  }

  /**
   * Mencari kecamatan berdasarkan slug.
   *
   * @param {object} region
   * @param {string} slug
   * @returns {object|null}
   */
  function findDistrict(region, slug) {
    const districts = getDistricts(region);

    return (
      districts.find((district) => {
        const districtSlug =
          String(district.slug || "").trim() ||
          slugify(district.name);

        return districtSlug === slug;
      }) || null
    );
  }

  /**
   * Memeriksa struktur dasar katalog.
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
   * Membuat URL katalog tanpa cache.
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
    const container = document.querySelector(
      SELECTORS.placeContainer
    );

    if (container) {
      container.replaceChildren(
        createMessage(title, body)
      );

      container.dataset.archiveState = "error";
    }

    updateStatistic(
      SELECTORS.placeCount,
      0
    );

    updateStatistic(
      SELECTORS.mediaCount,
      0
    );

    const searchInput = document.querySelector(
      SELECTORS.searchInput
    );

    if (searchInput) {
      searchInput.disabled = true;
    }

    const searchResult = document.querySelector(
      SELECTORS.searchResult
    );

    if (searchResult) {
      searchResult.textContent =
        "Katalog tidak tersedia";
    }
  }

  /**
   * Menandai proses pemuatan telah selesai.
   */
  function finishLoading() {
    const container = document.querySelector(
      SELECTORS.placeContainer
    );

    if (container) {
      container.setAttribute(
        "aria-busy",
        "false"
      );
    }
  }

  /**
   * Membaca katalog dan merender halaman kecamatan.
   */
  async function loadDistrictPage() {
    const body = document.body;

    const source = String(
      body.dataset.archiveDataUrl || ""
    ).trim();

    state.regionSlug = String(
      body.dataset.regionSlug || ""
    ).trim();

    state.districtSlug = String(
      body.dataset.districtSlug || ""
    ).trim();

    if (!source) {
      showError(
        "Katalog tidak ditemukan",
        "Halaman tidak memiliki alamat sumber data Arsip Kuliner Surabaya."
      );

      finishLoading();
      return;
    }

    if (
      !state.regionSlug ||
      !state.districtSlug
    ) {
      showError(
        "Kecamatan tidak dikenali",
        "Halaman tidak memiliki identitas wilayah dan kecamatan yang lengkap."
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
        state.regionSlug
      );

      if (!region) {
        showError(
          "Wilayah belum tersedia",
          "Wilayah halaman ini tidak ditemukan dalam katalog publik."
        );

        return;
      }

      const district = findDistrict(
        region,
        state.districtSlug
      );

      if (!district) {
        showError(
          "Kecamatan belum tersedia",
          "Kecamatan halaman ini tidak ditemukan dalam katalog publik."
        );

        return;
      }

      updateDistrictStatistics(district);

      state.places = sortPlaces(
        getPlaces(district)
      );

      renderPlaces(state.places);
      enableSearch();
    } catch (error) {
      console.error(
        "Gagal memuat halaman kecamatan arsip:",
        error
      );

      showError(
        "Katalog gagal dimuat",
        "Data tempat belum dapat dibaca. Silakan membuka halaman ini kembali beberapa saat lagi."
      );
    } finally {
      finishLoading();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      loadDistrictPage,
      { once: true }
    );
  } else {
    loadDistrictPage();
  }
})();
