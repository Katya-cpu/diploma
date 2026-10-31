/*
 * Чтение QR-кодов с картинок страницы локальной библиотекой jsQR (Apache-2.0).
 * Картинки никуда не отправляются; картинку с чужого сайта браузер может не дать прочитать.
 */
(function (root) {
  'use strict';

  async function decodeAll(doc) {
    const found = [], unreadable = [];
    const images = [...doc.images].filter((i) => i.complete && i.naturalWidth >= 60 && i.naturalHeight >= 60).slice(0, 12);
    for (const img of images) {
      try {
        const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const g = canvas.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, w, h);
        const data = g.getImageData(0, 0, w, h); // бросит ошибку для картинки с чужого сайта
        const code = root.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) found.push({ raw: code.data, where: img.alt || img.getAttribute('src') || 'картинка' });
      } catch (e) {
        unreadable.push(img.getAttribute('src') || 'картинка');
      }
    }
    return { found, unreadable };
  }

  root.PGQr = { decodeAll };
})(typeof window !== 'undefined' ? window : globalThis);
