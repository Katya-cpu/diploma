// Верхняя навигация, общая для всех страниц лаборатории.
// Разделы про граф транзакций показываются, только если их страницы есть в этой копии проекта
// (в ветке «только расширение» их нет).
(function () {
  const here = location.pathname;
  const links = [['/', 'Главная'], ['/checks.html', 'Проверки'], ['/graph.html', 'Граф транзакций', true], ['/graphsage.html', 'Данные и модели', true]];
  const top = document.getElementById('top');
  top.innerHTML = '<a class="brand" href="/">Платёжный помощник</a><nav></nav><span class="tag">учебный стенд ВКР · все данные вымышлены</span>';
  const nav = top.querySelector('nav');
  for (const [href, text, optional] of links) {
    const a = document.createElement('a');
    a.href = href; a.textContent = text;
    if (here === href || (href !== '/' && here.startsWith(href))) a.className = 'on';
    nav.append(a);
    if (optional) {
      a.hidden = true;
      fetch(href, { method: 'HEAD' }).then((r) => { a.hidden = !r.ok; }).catch(() => {});
    }
  }
  // Блоки страниц с пометкой data-needs="/graph.html" скрываются тем же способом.
  for (const el of document.querySelectorAll('[data-needs]')) {
    fetch(el.dataset.needs, { method: 'HEAD' }).then((r) => { if (!r.ok) el.remove(); }).catch(() => el.remove());
  }
})();
