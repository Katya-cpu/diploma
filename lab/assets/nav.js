// Верхняя навигация, общая для всех страниц лаборатории.
(function () {
  const here = location.pathname;
  const links = [['/', 'Главная'], ['/checks.html', '1 · Проверки'], ['/scenarios.html', '2 · Сценарии'], ['/graph.html', '3 · Граф транзакций']];
  const top = document.getElementById('top');
  top.innerHTML = '<a class="brand" href="/"><svg viewBox="0 0 64 64"><path d="M32 4 8 13v17c0 15 10 26 24 30 14-4 24-15 24-30V13L32 4z" fill="#2f5bff"/><rect x="18" y="24" width="28" height="18" rx="3" fill="#fff"/><rect x="18" y="28" width="28" height="4" fill="#2f5bff"/></svg>Платёжный помощник</a><nav></nav><span class="tag">Учебный стенд · только вымышленные данные</span>';
  const nav = top.querySelector('nav');
  for (const [href, text] of links) {
    const a = document.createElement('a');
    a.href = href; a.textContent = text;
    if (here === href || (href !== '/' && here.startsWith(href))) a.className = 'on';
    nav.append(a);
  }
})();
