# Руководство разработчика

## Структура

```
product/
├── extension/                 расширение Firefox (Manifest V2)
│   ├── core/                  АНАЛИЗАТОР — общий для расширения и лаборатории
│   │   ├── recipient.js       реквизиты: Луна, ключ счёта по БИК, ИНН, тип счёта, ГОСТ-QR, ссылки СБП, роль страницы
│   │   ├── dom.js             разбор страницы: типы полей, видимость, прозрачность, домены
│   │   ├── qr.js              чтение QR с картинок (jsQR)
│   │   ├── watch.js           наблюдение во времени: подмена реквизитов, вставленные поля, момент ввода карты
│   │   ├── checks.js          18 проверок и сборка отчёта → PGChecks.inspect(document, sensors)
│   │   └── catalog.js         описания проверок для администратора и пользователя
│   ├── content.js             запускает анализатор на странице и рисует панель
│   ├── background.js          webRequest (куда страница отправляет запросы после ввода карты), значок, журнал
│   └── popup.html/js          окно по кнопке расширения
├── lab/                       лаборатория (статические страницы)
│   ├── checks.html            раздел 1      ├── pages/      тестовые страницы раздела 1
│   ├── scenarios.html         раздел 2      ├── scenarios/  учебные сценарии раздела 2
│   ├── graph.html             раздел 3      └── assets/     стили и скрипты интерфейса
│   └── selftest.html          самопроверка сценариев (для разработчика)
├── graph/                     раздел 3: prepare.py (граф), train.py (модели), service.py (API)
├── tools/                     генераторы тестовых страниц, сценариев и QR
└── server.py                  локальный сервер http://127.0.0.1:8765
```

## Главный принцип

Лаборатория подключает файлы `extension/core/*.js` напрямую (сервер отдаёт их по адресу `/extension/...`).
Поэтому раздел 1 показывает решения **именно расширения**. Копий кода нет.

Различие только в «датчиках» сетевых запросов: в расширении — `webRequest` в `background.js`,
в лаборатории — подмена `fetch`, `XMLHttpRequest`, `sendBeacon`, `Image.src`, `WebSocket` учебной страницы (`PGWatch.hookNetwork`).

## Как добавить проверку

1. В `checks.js` добавьте функцию `CHECKS['my-check'] = (ctx) => [...]`. Ей доступны: `ctx.text`, `ctx.fields`, `ctx.has(kind)`,
   `ctx.scripts`, `ctx.qr`, `ctx.recipient`, `ctx.role`, `ctx.sensors`, `ctx.doc`.
   Верните находки `{ severity: 'danger'|'warning'|'info', title, details: [...] }`.
2. В `catalog.js` добавьте описание: схема-источник, данные, шаги, технология, ограничения, источники, тестовые страницы.
3. Добавьте тестовую страницу в `tools/make_check_pages.py` и запустите его.
4. Откройте раздел 1 → «Прогнать все тестовые страницы».

## Проверка без браузерного окна

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --virtual-time-budget=150000 --dump-dom "http://127.0.0.1:8765/checks.html?autorun=1"
```
Ищите в выводе строку «Совпало N из N». То же для `/selftest.html`.

## Проверка расширения в настоящем Firefox

```
.venv\Scripts\python.exe tools\firefox_check.py
```
Скрипт запускает отдельный Firefox (без окна, чистый профиль) через протокол WebDriver BiDi, устанавливает расширение,
открывает сценарии и сохраняет снимки с панелью в `tools/firefox-shots/`. На сценарии со скиммером он вводит тестовую карту.
Нужен пакет `websockets` (есть в requirements.txt). Лаборатория должна быть запущена.

## Граф

```
.venv\Scripts\python.exe -m graph.prepare        # ~30 с: граф и признаки → graph/data/graph.npz
.venv\Scripts\python.exe -m graph.train          # несколько минут: 4 модели → graph/models/
.venv\Scripts\python.exe -m graph.train "{\"epochs\": 300}"
.venv\Scripts\python.exe -m graph.research       # ~20 с: исследование схем → graph/models/research.json
```
То же самое делают кнопки во вкладке «Модель и обучение». Датасет: `datasets/ibm_aml/HI-Small_Trans.csv`
(зеркало Hugging Face `bbfizp/AMLSim-HI-Small`, лицензия Apache-2.0; оригинал — Kaggle «IBM Transactions for Anti Money Laundering»).

## История

Предыдущая версия (с PaySim, LLM, OCR, NER) сохранена в истории git, коммит `c496973`.
