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
  const REGION_IMAGE_SELECTOR = "[data-region-image]";
  const REGION_CREDIT_SELECTOR = "[data-region-credit]";
  const COUNTER_CONTAINER_ID = "archive-counters";
  const DESTINATION_COUNT_ID = "archive-destination-count";
  const PHOTO_COUNT_ID = "archive-photo-count";

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
   * Menjumlahkan nilai katalog dari seluruh wilayah.
   *
   * @param {Array<object>} regions
   * @param {"placeCount"|"mediaCount"} key
   * @returns {number}
   */
  function sumRegionCount(regions, key) {
    return regions.reduce(
      (total, region) => {
        if (!region || typeof region !== "object") {
          return total;
        }

        return total + toSafeInteger(region[key]);
      },
      0
    );
  }

  /**
   * Memperbarui counter destinasi dan foto pada hero.
   *
   * @param {Array<object>} regions
   */
  function updateArchiveCounters(regions) {
    const container = document.getElementById(
      COUNTER_CONTAINER_ID
    );

    const destinationElement =
      document.getElementById(
        DESTINATION_COUNT_ID
      );

    const photoElement =
      document.getElementById(
        PHOTO_COUNT_ID
      );

    const destinationCount = sumRegionCount(
      regions,
      "placeCount"
    );

    const photoCount = sumRegionCount(
      regions,
      "mediaCount"
    );

    if (destinationElement) {
      destinationElement.textContent =
        formatNumber(destinationCount);
    }

    if (photoElement) {
      photoElement.textContent =
        formatNumber(photoCount);
    }

    if (container) {
      container.dataset.archiveState = "ready";
      container.setAttribute(
        "aria-busy",
        "false"
      );
    }
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
   * Mengumpulkan foto yang siap ditampilkan dari seluruh tempat
   * dalam satu wilayah. Preview berukuran besar diprioritaskan
   * agar kartu tetap tajam pada layar desktop.
   *
   * @param {object} region
   * @returns {Array<{url: string, credit: string|null}>}
   */
  function collectRegionMedia(region) {
    const candidates = [];
    const districts = Array.isArray(region?.districts)
      ? region.districts
      : [];

    districts.forEach((district) => {
      const places = Array.isArray(district?.places)
        ? district.places
        : [];

      places.forEach((place) => {
        const mediaItems = Array.isArray(place?.media)
          ? place.media
          : [];

        mediaItems.forEach((media) => {
          if (!media || typeof media !== "object") {
            return;
          }

          if (
            media.previewStatus &&
            media.previewStatus !== "ready"
          ) {
            return;
          }

          const previewUrl =
            typeof media.previewUrl === "string"
              ? media.previewUrl.trim()
              : "";

          const thumbnailUrl =
            typeof media.thumbnailUrl === "string"
              ? media.thumbnailUrl.trim()
              : "";

          const url = previewUrl || thumbnailUrl;

          if (!url) {
            return;
          }

          const credit =
            typeof media.credit === "string" &&
            media.credit.trim()
              ? media.credit.trim()
              : null;

          candidates.push({
            url,
            credit
          });
        });
      });
    });

    return candidates;
  }

  /**
   * Memilih satu item secara acak. Pemilihan dilakukan ulang
   * setiap katalog dimuat, sehingga reload halaman dapat
   * menghasilkan sampul wilayah yang berbeda.
   *
   * @template T
   * @param {Array<T>} items
   * @returns {T|null}
   */
  function chooseRandomItem(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    const index = Math.floor(
      Math.random() * items.length
    );

    return items[index] ?? null;
  }

  /**
   * Menghapus sampul acak lama dari sebuah kartu.
   *
   * @param {Element} card
   */
  function clearRegionThumbnail(card) {
    card.querySelector(
      REGION_IMAGE_SELECTOR
    )?.remove();

    card.querySelector(
      REGION_CREDIT_SELECTOR
    )?.remove();

    delete card.dataset.hasThumbnail;
  }

  /**
   * Menampilkan satu foto acak dari wilayah terkait sebagai
   * sampul kartu. Foto bersifat dekoratif; kredit tetap
   * ditampilkan sebagai teks yang dapat dibaca.
   *
   * @param {Element} card
   * @param {object} region
   */
  function applyRandomRegionThumbnail(card, region) {
    clearRegionThumbnail(card);

    const candidate = chooseRandomItem(
      collectRegionMedia(region)
    );

    if (!candidate) {
      return;
    }

    const image = document.createElement("img");
    image.className =
      "archive-region-card__image";
    image.dataset.regionImage = "";
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.setAttribute("aria-hidden", "true");

    const credit = document.createElement("span");
    credit.className =
      "archive-region-card__credit";
    credit.dataset.regionCredit = "";
    credit.textContent = candidate.credit
      ? `Foto: ${candidate.credit}`
      : "Atribusi belum tercatat";

    image.addEventListener(
      "load",
      () => {
        card.dataset.hasThumbnail = "true";
      },
      { once: true }
    );

    image.addEventListener(
      "error",
      () => {
        clearRegionThumbnail(card);
      },
      { once: true }
    );

    image.src = candidate.url;

    card.prepend(image);
    card.append(credit);
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
        clearRegionThumbnail(card);

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

      applyRandomRegionThumbnail(card, region);
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
      clearRegionThumbnail(card);
    });

    const counterContainer =
      document.getElementById(
        COUNTER_CONTAINER_ID
      );

    const destinationElement =
      document.getElementById(
        DESTINATION_COUNT_ID
      );

    const photoElement =
      document.getElementById(
        PHOTO_COUNT_ID
      );

    if (destinationElement) {
      destinationElement.textContent = "—";
    }

    if (photoElement) {
      photoElement.textContent = "—";
    }

    if (counterContainer) {
      counterContainer.dataset.archiveState =
        "error";

      counterContainer.setAttribute(
        "aria-busy",
        "false"
      );
    }

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
      updateArchiveCounters(catalogue.regions);
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
