# Руководство разработчика

## Структура

```
product/
├── extension/                 расширение Firefox (Manifest V2)
│   ├── core/                  АНАЛИЗАТОР — общий для расширения и лаборатории
│   │   ├── recipient.js       реквизиты: Луна, ключ счёта по БИК, ИНН, тип счёта, ГОСТ-QR, ссылки СБП, роль страницы
│   │   ├── dom.js             разбор страницы: типы полей, видимость, прозрачность, домены
│   │   ├── qr.js              чтение QR с картинок (jsQR)
│   │   ├── watch.js           наблюдение во времени: подмена реквизитов, вставленные поля, ввод карты (цифры — только в памяти)
│   │   ├── checks.js          7 проверок и сборка отчёта → PGChecks.inspect(document, sensors)
│   │   ├── catalog.js         описания проверок; SHOWS – все сообщения панели (сверка: tools/check_shows.py)
│   │   └── schemes.js         6 схем (SCHEMES) и 11 видов подачи (COVERS): реальные случаи, какие проверки срабатывают
│   ├── content.js             запускает анализатор на странице и рисует панель
│   ├── background.js          webRequest: запросы вкладки с телом (для проверки «Скиммер»), значок, журнал
│   └── popup.html/js          окно по кнопке расширения
├── lab/                       лаборатория (статические страницы)
│   ├── checks.html            раздел 1      ├── pages/      тестовые страницы раздела 1
│   ├── scenarios.html         раздел 2      ├── scenarios/  учебные сценарии раздела 2
│   ├── graph.html             раздел 3      └── assets/     стили и скрипты интерфейса
│   ├── graphsage.html         учебник «Как работает GraphSAGE» (открывается и без сервера)
│   ├── eval.html, eval/       оценка «было / стало» на настоящих страницах (eval/old — анализатор до переделки)
│   └── selftest.html          самопроверка сценариев (для разработчика)
├── graph/                     раздел 3: prepare.py (граф), train.py (модели), explain.py (разбор модели), research.py (схемы), service.py (API)
├── tools/                     генераторы страниц и QR; eval_sample.py, eval_ru.py, eval_run.py — оценка на настоящих страницах
└── server.py                  локальный сервер http://127.0.0.1:8765
```

## Главный принцип

Лаборатория подключает файлы `extension/core/*.js` напрямую (сервер отдаёт их по адресу `/extension/...`).
Поэтому раздел 1 показывает решения **именно расширения**. Копий кода нет.

Различие только в «датчиках» сетевых запросов: в расширении — `webRequest` в `background.js`,
в лаборатории — подмена `fetch`, `XMLHttpRequest`, `sendBeacon`, `Image.src`, `WebSocket` учебной страницы (`PGWatch.hookNetwork`).

## Как принимают решения проверки

Пять правил (подробно — в `docs/scenario-evidence.md`): 1) сначала ищется платёжный объект (поле карты, реквизиты, платёжный QR,
ссылка СБП); 2) фраза под отрицанием («никому не сообщайте») не считается — `findAffirmed()`; 3) телефон — реквизит, только если рядом
говорится о переводе — `PGRecipient.nearPayment()`; 4) роль сайта — только из заголовка, шапки и подвала — `roleText()`;
5) поведение важнее текста кода: номер введённой карты ищется в исходящих запросах — `cardInPayload()`.

Приватность: из введённых данных читаются только цифры поля «номер карты», в памяти вкладки, для сравнения с запросами.
Они не сохраняются и не попадают в отчёт и журнал.

## Как добавить проверку

1. В `checks.js` добавьте функцию `CHECKS['my-check'] = (ctx) => [...]`. Ей доступны: `ctx.text`, `ctx.fields`, `ctx.has(kind)`,
   `ctx.scripts`, `ctx.qr`, `ctx.recipient`, `ctx.role`, `ctx.sensors`, `ctx.doc`.
   Верните находки `{ severity: 'danger'|'warning'|'info', title, details: [...] }`.
2. В `catalog.js` добавьте описание: `plain` (простыми словами), `cases` (реальные случаи со ссылкой), `signals` (все признаки правила с оценкой), `manual` (как увидеть самому), `look` (файл и строка кода тестовой страницы), `limits`, `taxonomy`, `sources`, `pages`.
3. Положите тестовую страницу в `lab/scenarios/` (оформленную как сайт) или `lab/pages/` (короткую) и укажите её в `pages` описания проверки: `sc(...)` или `pg(...)`. Нужна и «честная» страница, на которой проверка должна молчать.
   (`tools/make_check_pages.py` создавал первую версию страниц; страниц, добавленных позже, в нём нет — не запускайте его, он перезапишет правки.)
4. Откройте раздел «Проверки» → «Прогнать все тестовые страницы» (или `checks.html?autorun=1`).

## Проверка без браузерного окна

Основная проверка — в Firefox, для которого сделано расширение: `tools/firefox_check.py` (расширение на тестовых страницах),
`tools/eval_run.py` (оценка «было/стало» на 2 020 настоящих страницах). Быстрая проверка разметки без окна
возможна и любым браузером на движке Chromium, например:

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
.venv\Scripts\python.exe -m graph.explain        # ~1 мин: разбор модели → graph/models/explain.json и lab/assets/guide-data.js
.venv\Scripts\python.exe -m graph.research       # ~20 с: исследование схем → graph/models/research.json
```
То же самое делают кнопки во вкладке «Модель и обучение». Датасет: `datasets/ibm_aml/HI-Small_Trans.csv`
(зеркало Hugging Face `bbfizp/AMLSim-HI-Small`, лицензия Apache-2.0; оригинал — Kaggle «IBM Transactions for Anti Money Laundering»).

## Оценка на настоящих страницах (было / стало)

```
.venv\Scripts\python.exe -m pip install pyarrow       # один раз: чтение parquet Phish360
.venv\Scripts\python.exe tools\eval_sample.py         # 1000 законных + 1000 фишинговых страниц Phish360
.venv\Scripts\python.exe tools\eval_ru.py             # ~20 русских законных страниц (новости, магазины, фонды, банки)
.venv\Scripts\python.exe tools\eval_run.py            # прогон в Firefox без окна → tools/eval-results.json, docs/eval-results.md
```
Страницы сохраняются в `datasets/web_pages/eval_sample/` с запретом внешних загрузок (CSP); при оценке скрипты страниц не выполняются.

## История

Предыдущая версия (с PaySim, LLM, OCR, NER) сохранена в истории git, коммит `c496973`.
