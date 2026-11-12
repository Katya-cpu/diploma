/*
 * Чтение QR-кодов с картинок страницы локальной библиотекой jsQR (Apache-2.0).
 * Проверяются самые крупные картинки и холсты (canvas) — в том числе фото QR-кода,
 * открытые в мессенджере. Картинки никуда не отправляются; картинку с чужого сайта
 * браузер может не дать прочитать.
 */
(function (root) {
  'use strict';
  const cache = new WeakMap(); // элемент → { src, raw } — не декодировать одну картинку дважды

  function sizeOf(el) {
    return el.tagName === 'IMG' ? [el.naturalWidth, el.naturalHeight] : [el.width, el.height];
  }

  // Пробуем несколько масштабов: на фото QR часто мелкий и с перспективой.
  function decodeElement(el) {
    const [nw, nh] = sizeOf(el);
    for (const maxSide of [1000, 600, 1600]) {
      const scale = Math.min(1, maxSide / Math.max(nw, nh));
      const w = Math.round(nw * scale), h = Math.round(nh * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(el, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h); // бросит ошибку для картинки с чужого сайта
      const code = root.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code.data;
      if (scale === 1) break; // крупнее уже не будет
    }
    return null;
  }

  async function decodeAll(doc) {
    const found = [], unreadable = [];
    const candidates = [...doc.querySelectorAll('img, canvas')]
      .filter((el) => (el.tagName !== 'IMG' || el.complete) && Math.min(...sizeOf(el)) >= 60)
      .sort((a, b) => sizeOf(b)[0] * sizeOf(b)[1] - sizeOf(a)[0] * sizeOf(a)[1])
      .slice(0, 8);
    for (const el of candidates) {
      const src = el.tagName === 'IMG' ? el.currentSrc || el.src : 'canvas';
      const cached = cache.get(el);
      if (cached && cached.src === src && src !== 'canvas') {
        if (cached.raw) found.push({ raw: cached.raw, where: cached.where });
        continue;
      }
      try {
        const raw = decodeElement(el);
        const where = el.alt || (el.getAttribute && el.getAttribute('src')) || 'картинка';
        cache.set(el, { src, raw, where });
        if (raw) found.push({ raw, where });
      } catch (e) {
        unreadable.push(src);
      }
    }
    return { found, unreadable };
  }

  root.PGQr = { decodeAll };
})(typeof window !== 'undefined' ? window : globalThis);
