/**
 * MENCARI MEDOK — HALAMAN DETAIL TEMPAT ARSIP
 *
 * Fungsi:
 * - Membaca assets/data/archive.json
 * - Menemukan wilayah, kecamatan, dan tempat berdasarkan slug
 * - Menampilkan status dan alamat tempat
 * - Menghitung jumlah serta rentang tahun dokumentasi
 * - Membuat kartu dokumentasi secara dinamis
 * - Menampilkan preview dan tautan file asli jika tersedia
 */

(() => {
  "use strict";

  const SELECTORS = {
    status: "#place-status",
    address: "#place-address",
    mediaCount: "#place-media-count",
    dateRange: "#place-date-range",
    mediaGrid: "#archive-media-grid"
  };

  const state = {
    regionSlug: "",
    districtSlug: "",
    placeSlug: ""
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
   * Menampilkan angka dalam format Indonesia.
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
   * Memastikan URL aman digunakan.
   *
   * URL relatif tetap diperbolehkan karena akan diselesaikan
   * berdasarkan alamat halaman saat ini.
   *
   * @param {unknown} value
   * @returns {string|null}
   */
  function getSafeUrl(value) {
    if (
      typeof value !== "string" ||
      value.trim() === ""
    ) {
      return null;
    }

    try {
      const url = new URL(
        value.trim(),
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
   * Mengambil nama atribusi foto.
   *
   * @param {object} media
   * @returns {string|null}
   */
  function getMediaCredit(media) {
    const credit = String(
      media && media.credit
        ? media.credit
        : ""
    ).trim();

    return credit || null;
  }

  /**
   * Membentuk teks atribusi yang selalu tersedia.
   *
   * @param {object} media
   * @returns {string}
   */
  function getMediaAttribution(media) {
    const credit = getMediaCredit(media);

    return credit
      ? `Foto: ${credit}`
      : "Atribusi belum tercatat";
  }

  /**
   * Mengambil daftar media valid.
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

    return place.media.filter((item) => {
      return item && typeof item === "object";
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
      return district && typeof district === "object";
    });
  }

  /**
   * Mengambil daftar tempat valid.
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
          String(region.slug || "").trim() === slug
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
    return (
      getDistricts(region).find((district) => {
        const districtSlug =
          String(district.slug || "").trim() ||
          slugify(district.name);

        return districtSlug === slug;
      }) || null
    );
  }

  /**
   * Mencari tempat berdasarkan slug.
   *
   * @param {object} district
   * @param {string} slug
   * @returns {object|null}
   */
  function findPlace(district, slug) {
    return (
      getPlaces(district).find((place) => {
        const placeSlug =
          String(place.slug || "").trim() ||
          slugify(place.name);

        return placeSlug === slug;
      }) || null
    );
  }

  /**
   * Mengubah tanggal ISO menjadi objek Date lokal yang stabil.
   *
   * Penggunaan waktu tengah hari mencegah tanggal bergeser
   * akibat perbedaan zona waktu browser.
   *
   * @param {unknown} value
   * @returns {Date|null}
   */
  function parseArchiveDate(value) {
    if (typeof value !== "string") {
      return null;
    }

    const match = value
      .trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(
      year,
      month - 1,
      day,
      12,
      0,
      0
    );

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  /**
   * Memformat tanggal arsip ke bahasa Indonesia.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function formatArchiveDate(value) {
    const date = parseArchiveDate(value);

    if (!date) {
      return "Tidak tercatat";
    }

    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);
  }

  /**
   * Memformat waktu dokumentasi.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function formatArchiveTime(value) {
    if (typeof value !== "string") {
      return "Tidak tercatat";
    }

    const match = value
      .trim()
      .match(
        /^(\d{2}):(\d{2})(?::(\d{2}))?$/
      );

    if (!match) {
      return value.trim() || "Tidak tercatat";
    }

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);

    if (
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return value.trim();
    }

    return match[3]
      ? `${match[1]}.${match[2]}.${match[3]}`
      : `${match[1]}.${match[2]}`;
  }

  /**
   * Mengambil tahun dari tanggal media.
   *
   * @param {object} media
   * @returns {number|null}
   */
  function getMediaYear(media) {
    const date = parseArchiveDate(media.date);

    return date ? date.getFullYear() : null;
  }

  /**
   * Membuat nilai rentang tahun dokumentasi.
   *
   * Contoh:
   * - 2021
   * - 2021–2026
   *
   * @param {Array<object>} media
   * @returns {string}
   */
  function buildDateRange(media) {
    const years = media
      .map(getMediaYear)
      .filter((year) => Number.isInteger(year))
      .sort((first, second) => first - second);

    if (years.length === 0) {
      return "—";
    }

    const firstYear = years[0];
    const lastYear = years[years.length - 1];

    return firstYear === lastYear
      ? String(firstYear)
      : `${firstYear}–${lastYear}`;
  }

  /**
   * Membuat nilai waktu untuk pengurutan.
   *
   * @param {object} media
   * @returns {number}
   */
  function getMediaTimestamp(media) {
    const date = parseArchiveDate(media.date);

    if (!date) {
      return 0;
    }

    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (typeof media.time === "string") {
      const match = media.time
        .trim()
        .match(
          /^(\d{2}):(\d{2})(?::(\d{2}))?$/
        );

      if (match) {
        hours = Number(match[1]);
        minutes = Number(match[2]);
        seconds = Number(match[3] || 0);
      }
    }

    date.setHours(
      hours,
      minutes,
      seconds,
      0
    );

    return date.getTime();
  }

  /**
   * Mengurutkan dokumentasi dari yang terbaru.
   *
   * @param {Array<object>} media
   * @returns {Array<object>}
   */
  function sortMedia(media) {
    return [...media].sort((first, second) => {
      const dateDifference =
        getMediaTimestamp(second) -
        getMediaTimestamp(first);

      if (dateDifference !== 0) {
        return dateDifference;
      }

      return String(
        first.filename || first.dish || ""
      ).localeCompare(
        String(
          second.filename || second.dish || ""
        ),
        "id-ID",
        {
          sensitivity: "base",
          numeric: true
        }
      );
    });
  }

  /**
   * Memperbarui teks sebuah elemen.
   *
   * @param {string} selector
   * @param {string} value
   */
  function updateText(selector, value) {
    const element =
      document.querySelector(selector);

    if (!element) {
      return;
    }

    element.textContent = value;
  }

  /**
   * Memperbarui informasi utama tempat.
   *
   * @param {object} place
   */
  function updatePlaceInformation(place) {
    const status = String(
      place.status || ""
    ).trim();

    const address = String(
      place.address || ""
    ).trim();

    updateText(
      SELECTORS.status,
      status || "Status tidak tercatat"
    );

    updateText(
      SELECTORS.address,
      address || "Alamat tidak tercatat."
    );

    const media = getMedia(place);

    const mediaCount =
      media.length > 0
        ? media.length
        : toSafeInteger(place.mediaCount);

    updateText(
      SELECTORS.mediaCount,
      formatNumber(mediaCount)
    );

    updateText(
      SELECTORS.dateRange,
      buildDateRange(media)
    );
  }

  /**
   * Membuat placeholder foto.
   *
   * @returns {HTMLDivElement}
   */
  function createMediaPlaceholder() {
    const placeholder =
      document.createElement("div");

    placeholder.className =
      "archive-media-card__placeholder";

    placeholder.textContent =
      "Pratinjau foto belum tersedia";

    return placeholder;
  }

  /**
   * Membuat label format file.
   *
   * @param {object} media
   * @returns {HTMLSpanElement|null}
   */
  function createFormatLabel(media) {
    const extension = String(
      media.extension || ""
    )
      .trim()
      .replace(/^\./, "")
      .toUpperCase();

    if (!extension) {
      return null;
    }

    const label = document.createElement("span");

    label.className =
      "archive-media-card__format";

    label.textContent = extension;

    return label;
  }

  /**
   * Membuat dialog penampil foto besar.
   *
   * Dialog dibuat satu kali dan dipakai ulang untuk
   * seluruh dokumentasi pada halaman.
   *
   * @returns {HTMLDialogElement}
   */
  function getMediaViewer() {
    const existing = document.getElementById(
      "archive-media-viewer"
    );

    if (existing) {
      return existing;
    }

    const dialog = document.createElement(
      "dialog"
    );

    dialog.id = "archive-media-viewer";
    dialog.className = "archive-media-viewer";

    dialog.setAttribute(
      "aria-labelledby",
      "archive-media-viewer-title"
    );

    const panel = document.createElement("div");
    panel.className = "archive-media-viewer__panel";

    const closeButton =
      document.createElement("button");

    closeButton.className =
      "archive-media-viewer__close";

    closeButton.type = "button";
    closeButton.textContent = "Tutup";

    closeButton.setAttribute(
      "aria-label",
      "Tutup tampilan foto besar"
    );

    const figure = document.createElement(
      "figure"
    );

    figure.className =
      "archive-media-viewer__figure";

    const image = document.createElement("img");

    image.className =
      "archive-media-viewer__image";

    image.dataset.viewerImage = "";

    const caption =
      document.createElement("figcaption");

    caption.className =
      "archive-media-viewer__caption";

    const title = document.createElement("h2");

    title.id = "archive-media-viewer-title";
    title.className =
      "archive-media-viewer__title";

    title.dataset.viewerTitle = "";

    const attribution =
      document.createElement("p");

    attribution.className =
      "archive-media-viewer__credit";

    attribution.dataset.viewerCredit = "";

    const details = document.createElement("p");

    details.className =
      "archive-media-viewer__details";

    details.dataset.viewerDetails = "";

    const originalLink =
      document.createElement("a");

    originalLink.className =
      "archive-media-viewer__original";

    originalLink.target = "_blank";
    originalLink.rel = "noopener noreferrer";
    originalLink.textContent = "Buka file asli";

    originalLink.dataset.viewerOriginal = "";

    caption.append(
      title,
      attribution,
      details,
      originalLink
    );

    figure.append(image, caption);
    panel.append(closeButton, figure);
    dialog.appendChild(panel);

    closeButton.addEventListener(
      "click",
      () => {
        dialog.close();
      }
    );

    dialog.addEventListener(
      "click",
      (event) => {
        if (event.target === dialog) {
          dialog.close();
        }
      }
    );

    dialog.addEventListener(
      "close",
      () => {
        image.removeAttribute("src");
        image.alt = "";
      }
    );

    document.body.appendChild(dialog);

    return dialog;
  }

  /**
   * Membuka foto besar dengan judul dan atribusi.
   *
   * @param {object} media
   * @param {string} placeName
   * @returns {boolean}
   */
  function openMediaViewer(media, placeName) {
    const source =
      getSafeUrl(media.previewUrl) ||
      getSafeUrl(media.originalUrl);

    if (!source) {
      return false;
    }

    const dialog = getMediaViewer();

    if (
      !dialog ||
      typeof dialog.showModal !== "function"
    ) {
      return false;
    }

    const image = dialog.querySelector(
      "[data-viewer-image]"
    );

    const title = dialog.querySelector(
      "[data-viewer-title]"
    );

    const credit = dialog.querySelector(
      "[data-viewer-credit]"
    );

    const details = dialog.querySelector(
      "[data-viewer-details]"
    );

    const originalLink = dialog.querySelector(
      "[data-viewer-original]"
    );

    if (
      !image ||
      !title ||
      !credit ||
      !details ||
      !originalLink
    ) {
      return false;
    }

    const mediaTitle = getMediaTitle(media);
    const date = formatArchiveDate(media.date);
    const time = formatArchiveTime(media.time);

    const detailParts = [
      placeName,
      date
    ];

    if (time !== "Tidak tercatat") {
      detailParts.push(time);
    }

    image.src = source;
    image.alt = media.dish
      ? `${media.dish} di ${placeName}`
      : `Dokumentasi ${placeName}`;

    title.textContent = mediaTitle;
    credit.textContent =
      getMediaAttribution(media);

    credit.dataset.attributionState =
      getMediaCredit(media)
        ? "recorded"
        : "missing";

    details.textContent =
      detailParts.join(" · ");

    const originalUrl = getSafeUrl(
      media.originalUrl
    );

    if (originalUrl) {
      originalLink.href = originalUrl;
      originalLink.hidden = false;
    } else {
      originalLink.removeAttribute("href");
      originalLink.hidden = true;
    }

    if (dialog.open) {
      dialog.close();
    }

    dialog.showModal();

    return true;
  }

  /**
   * Membuat area visual media.
   *
   * @param {object} media
   * @param {string} placeName
   * @returns {HTMLDivElement}
   */
  function createMediaVisual(media, placeName) {
    const visual = document.createElement("div");

    visual.className =
      "archive-media-card__visual";

    const previewUrl = getSafeUrl(
      media.previewUrl
    );

    const originalUrl = getSafeUrl(
      media.originalUrl
    );

    if (previewUrl) {
      const image = document.createElement("img");

      image.className =
        "archive-media-card__image";

      image.src = previewUrl;

      image.alt = media.dish
        ? `${media.dish} di ${placeName}`
        : `Dokumentasi ${placeName}`;

      image.loading = "lazy";
      image.decoding = "async";

      image.addEventListener(
        "error",
        () => {
          image.replaceWith(
            createMediaPlaceholder()
          );
        },
        { once: true }
      );

      const visualLinkUrl =
        originalUrl || previewUrl;

      const link = document.createElement("a");

      link.className =
        "archive-media-card__image-link";

      link.href = visualLinkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      link.setAttribute(
        "aria-label",
        media.dish
          ? `Lihat foto besar ${media.dish}`
          : `Lihat foto besar dokumentasi ${placeName}`
      );

      link.addEventListener(
        "click",
        (event) => {
          if (
            openMediaViewer(
              media,
              placeName
            )
          ) {
            event.preventDefault();
          }
        }
      );

      link.appendChild(image);
      visual.appendChild(link);
    } else {
      visual.appendChild(
        createMediaPlaceholder()
      );
    }

    const formatLabel =
      createFormatLabel(media);

    if (formatLabel) {
      visual.appendChild(formatLabel);
    }

    return visual;
  }

  /**
   * Membuat satu baris metadata.
   *
   * @param {string} term
   * @param {string} value
   * @returns {HTMLDivElement}
   */
  function createMetadataRow(term, value) {
    const row = document.createElement("div");

    row.className =
      "archive-media-meta__row";

    const termElement =
      document.createElement("dt");

    termElement.className =
      "archive-media-meta__term";

    termElement.textContent = term;

    const valueElement =
      document.createElement("dd");

    valueElement.className =
      "archive-media-meta__value";

    valueElement.textContent =
      value || "Tidak tercatat";

    row.append(
      termElement,
      valueElement
    );

    return row;
  }

  /**
   * Membuat baris atribusi yang terlihat pada setiap kartu.
   *
   * @param {object} media
   * @returns {HTMLParagraphElement}
   */
  function createMediaAttribution(media) {
    const attribution =
      document.createElement("p");

    attribution.className =
      "archive-media-card__credit";

    attribution.textContent =
      getMediaAttribution(media);

    attribution.dataset.attributionState =
      getMediaCredit(media)
        ? "recorded"
        : "missing";

    return attribution;
  }

  /**
   * Membuat daftar metadata media.
   *
   * @param {object} media
   * @returns {HTMLDListElement}
   */
  function createMediaMetadata(media) {
    const metadata =
      document.createElement("dl");

    metadata.className =
      "archive-media-meta";

    metadata.append(
      createMetadataRow(
        "Sajian",
        String(media.dish || "").trim() ||
          "Tidak tercatat"
      ),

      createMetadataRow(
        "Harga",
        String(media.price || "").trim() ||
          "Tidak tercatat"
      ),

      createMetadataRow(
        "Tanggal",
        formatArchiveDate(media.date)
      ),

      createMetadataRow(
        "Waktu",
        formatArchiveTime(media.time)
      ),

      createMetadataRow(
        "Format",
        String(
          media.extension || ""
        )
          .trim()
          .replace(/^\./, "")
          .toUpperCase() ||
          "Tidak tercatat"
      )
    );

    return metadata;
  }

  /**
   * Membuat tombol akses media.
   *
   * @param {object} media
   * @param {string} placeName
   * @returns {HTMLDivElement}
   */
  function createMediaActions(
    media,
    placeName
  ) {
    const actions =
      document.createElement("div");

    actions.className =
      "archive-media-actions";

    const originalUrl = getSafeUrl(
      media.originalUrl
    );

    const previewUrl = getSafeUrl(
      media.previewUrl
    );

    if (previewUrl) {
      const viewerLink =
        document.createElement("a");

      viewerLink.className =
        "archive-media-action";

      viewerLink.href =
        originalUrl || previewUrl;

      viewerLink.target = "_blank";
      viewerLink.rel =
        "noopener noreferrer";

      viewerLink.textContent =
        "Lihat foto besar";

      viewerLink.addEventListener(
        "click",
        (event) => {
          if (
            openMediaViewer(
              media,
              placeName
            )
          ) {
            event.preventDefault();
          }
        }
      );

      actions.appendChild(viewerLink);
    }

    if (originalUrl) {
      const originalLink =
        document.createElement("a");

      originalLink.className =
        "archive-media-action";

      originalLink.href = originalUrl;
      originalLink.target = "_blank";
      originalLink.rel =
        "noopener noreferrer";

      originalLink.textContent =
        "Buka file asli";

      actions.appendChild(originalLink);
    } else {
      const disabledOriginal =
        document.createElement("span");

      disabledOriginal.className =
        "archive-media-action archive-media-action--disabled";

      disabledOriginal.setAttribute(
        "aria-disabled",
        "true"
      );

      disabledOriginal.textContent =
        "File asli belum terhubung";

      actions.appendChild(disabledOriginal);
    }

    return actions;
  }

  /**
   * Menentukan judul dokumentasi.
   *
   * @param {object} media
   * @returns {string}
   */
  function getMediaTitle(media) {
    const dish = String(
      media.dish || ""
    ).trim();

    if (dish) {
      return dish;
    }

    const filename = String(
      media.filename || ""
    ).trim();

    if (filename) {
      return filename.replace(
        /\.[^.]+$/,
        ""
      );
    }

    return "Dokumentasi";
  }

  /**
   * Membuat satu kartu dokumentasi.
   *
   * @param {object} media
   * @param {number} index
   * @param {string} placeName
   * @returns {HTMLElement}
   */
  function createMediaCard(
    media,
    index,
    placeName
  ) {
    const card =
      document.createElement("article");

    card.className =
      "archive-media-card";

    if (media.id) {
      card.id = String(media.id);
    }

    card.appendChild(
      createMediaVisual(media, placeName)
    );

    const body =
      document.createElement("div");

    body.className =
      "archive-media-card__body";

    const header =
      document.createElement("header");

    header.className =
      "archive-media-card__header";

    const number =
      document.createElement("span");

    number.className =
      "archive-media-card__number";

    number.textContent = String(
      index + 1
    ).padStart(2, "0");

    const title =
      document.createElement("h3");

    title.className =
      "archive-media-card__title";

    title.textContent =
      getMediaTitle(media);

    header.append(number, title);

    body.append(
      header,
      createMediaAttribution(media),
      createMediaMetadata(media),
      createMediaActions(
        media,
        placeName
      )
    );

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
    const message =
      document.createElement("div");

    message.className =
      "archive-place-message";

    const heading =
      document.createElement("h3");

    heading.className =
      "archive-place-message__title";

    heading.textContent = title;

    const paragraph =
      document.createElement("p");

    paragraph.className =
      "archive-place-message__body";

    paragraph.textContent = body;

    message.append(
      heading,
      paragraph
    );

    return message;
  }

  /**
   * Menampilkan seluruh dokumentasi.
   *
   * @param {object} place
   */
  function renderMedia(place) {
    const container =
      document.querySelector(
        SELECTORS.mediaGrid
      );

    if (!container) {
      return;
    }

    container.replaceChildren();

    const media = sortMedia(
      getMedia(place)
    );

    if (media.length === 0) {
      container.appendChild(
        createMessage(
          "Belum ada dokumentasi",
          "Tempat ini belum memiliki file yang dipublikasikan dalam katalog Arsip Kuliner Surabaya."
        )
      );

      container.dataset.archiveState =
        "empty";

      return;
    }

    const fragment =
      document.createDocumentFragment();

    const placeName = String(
      place.name || "tempat ini"
    ).trim();

    media.forEach((item, index) => {
      fragment.appendChild(
        createMediaCard(
          item,
          index,
          placeName
        )
      );
    });

    container.appendChild(fragment);

    container.dataset.archiveState =
      "available";
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
   * Membuat URL katalog agar browser tidak memakai cache lama.
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
        SELECTORS.mediaGrid
      );

    if (container) {
      container.replaceChildren(
        createMessage(title, body)
      );

      container.dataset.archiveState =
        "error";
    }

    updateText(
      SELECTORS.status,
      "Data tidak tersedia"
    );

    updateText(
      SELECTORS.address,
      "Informasi tempat belum dapat dibaca."
    );

    updateText(
      SELECTORS.mediaCount,
      "0"
    );

    updateText(
      SELECTORS.dateRange,
      "—"
    );
  }

  /**
   * Menandai pemuatan sudah selesai.
   */
  function finishLoading() {
    const container =
      document.querySelector(
        SELECTORS.mediaGrid
      );

    if (container) {
      container.setAttribute(
        "aria-busy",
        "false"
      );
    }
  }

  /**
   * Membaca katalog dan merender halaman tempat.
   */
  async function loadPlacePage() {
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

    state.placeSlug = String(
      body.dataset.placeSlug || ""
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
      !state.districtSlug ||
      !state.placeSlug
    ) {
      showError(
        "Tempat tidak dikenali",
        "Halaman tidak memiliki identitas wilayah, kecamatan, dan tempat yang lengkap."
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

      const place = findPlace(
        district,
        state.placeSlug
      );

      if (!place) {
        showError(
          "Tempat belum tersedia",
          "Tempat halaman ini tidak ditemukan dalam katalog publik Arsip Kuliner Surabaya."
        );

        return;
      }

      updatePlaceInformation(place);
      renderMedia(place);
    } catch (error) {
      console.error(
        "Gagal memuat halaman detail tempat:",
        error
      );

      showError(
        "Katalog gagal dimuat",
        "Dokumentasi tempat belum dapat dibaca. Silakan membuka halaman ini kembali beberapa saat lagi."
      );
    } finally {
      finishLoading();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      loadPlacePage,
      { once: true }
    );
  } else {
    loadPlacePage();
  }
})();
