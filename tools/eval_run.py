"""Оценка «было / стало» на настоящих страницах в Firefox без окна.

Открывает lab/eval.html?autorun=1 (лаборатория должна быть запущена), ждёт, пока страница прогонит
старую и новую версии анализатора по выборке (tools/eval_sample.py, tools/eval_ru.py), и сохраняет:
  tools/eval-results.json — решение каждой версии по каждой странице;
  docs/eval-results.md    — сводные таблицы для диплома.

Запуск: .venv\\Scripts\\python.exe tools\\eval_run.py      (Firefox без окна; запасной вариант — ключ --edge)

Страница, которая не загрузилась за 30 с, помечается timeout и в долях не учитывается.
Вручную: откройте http://127.0.0.1:8765/eval.html в обычном браузере, нажмите «Запустить», дождитесь конца —
страница сама сохранит tools/eval-results.json — и постройте таблицы:
    .venv\\Scripts\\python.exe tools\\eval_run.py --summary
"""
import asyncio
import json
import re
import urllib.parse
import subprocess
import tempfile
import time
from collections import Counter
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
FIREFOX = r'C:\Program Files\Mozilla Firefox\firefox.exe'
PORT = 9334


async def cmd(ws, n, method, params):
    await ws.send(json.dumps({'id': n, 'method': method, 'params': params}))
    while True:
        msg = json.loads(await ws.recv())
        if msg.get('id') == n:
            if msg.get('type') == 'error':
                raise RuntimeError(f"{method}: {msg.get('error')} {msg.get('message')}")
            return msg.get('result')


async def collect():
    """Firefox без окна. Каждая страница открывается отдельно (lab/eval/one.html) с лимитом PAGE_LIMIT секунд:
    сохранённые страницы со встроенными окнами соцсетей и внешними картинками иногда грузятся бесконечно —
    такая страница помечается «не загрузилась» (timeout), вкладка закрывается, прогон идёт дальше."""
    corpus = ROOT.parent / 'datasets' / 'web_pages' / 'eval_sample'
    items = json.loads((corpus / 'index.json').read_text(encoding='utf-8'))
    items += [dict(x, file='ru/' + x['file']) for x in json.loads((corpus / 'ru' / 'index.json').read_text(encoding='utf-8'))]
    for it in items:
        it['url'] = it['url'].strip()
        path = corpus / it['file']
        it['missing'] = not path.exists()  # несколько фишинговых файлов удаляет антивирус Windows
        it.update(page_kind(path.read_text(encoding='utf-8', errors='replace')) if path.exists() else {'card_input': False, 'password': False})
    done = {}
    part = ROOT / 'tools' / 'eval-partial.json'  # промежуточные результаты: после сбоя прогон продолжится с места остановки
    if part.exists():
        done = {r['file']: r for r in json.loads(part.read_text(encoding='utf-8'))}
    for it in items:
        if it['missing']:
            done[it['file']] = dict(it, old={'verdict': 'missing', 'checks': []}, new={'verdict': 'missing', 'checks': []})
    idle = 0  # перезапуски подряд, после которых не проверено ни одной страницы
    while True:
        todo = [it for it in items if it['file'] not in done]
        if not todo:
            break
        before = len(done)
        try:
            await firefox_pass(todo, done, part, len(items))
        except Exception as e:  # Firefox перестал отвечать — перезапуск
            print('перезапуск Firefox:', type(e).__name__, e, flush=True)
        idle = idle + 1 if len(done) == before else 0
        if idle >= 3:  # не крутиться впустую: остановиться с понятной ошибкой, промежуточные результаты сохранены
            raise SystemExit('Firefox трижды подряд не проверил ни одной страницы — прогон остановлен, см. сообщения выше')
    part.unlink(missing_ok=True)
    return [done[it['file']] for it in items]


PAGE_LIMIT = 30
CARD_INPUT = re.compile(r'cc-number|card.?num|cardnumber|ccnum|card_no|numero.?tarjeta|kartennummer|номер.?карты', re.I)


def page_kind(html):
    """Что на странице есть на самом деле — по полям ввода, без скриптов и без анализатора:
    card_input — поле номера карты (поддельная форма оплаты), password — поле пароля (страница входа)."""
    body = re.sub(r'(?is)<script[^>]*>.*?</script>', ' ', html)
    inputs = re.findall(r'(?is)<input[^>]*>', body)
    return {'card_input': any(CARD_INPUT.search(i) for i in inputs),
            'password': any(re.search(r'type\s*=\s*["\']?password', i, re.I) for i in inputs)}


def kill_leftover_firefox():
    """Закрыть Firefox без окна, оставшийся от прошлого прогона (профиль pg-eval-): он держит порт и свою сессию,
    и новый запуск получает «Maximum number of active sessions». Обычный Firefox пользователя не трогается."""
    subprocess.run(['powershell', '-NoProfile', '-Command',
                    "Get-CimInstance Win32_Process -Filter \"Name='firefox.exe'\" | Where-Object { $_.CommandLine -match 'pg-eval-' } "
                    '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], check=False)
    time.sleep(1)


async def firefox_pass(todo, done, part, total):
    kill_leftover_firefox()
    profile = tempfile.mkdtemp(prefix='pg-eval-')
    proc = subprocess.Popen([FIREFOX, '--remote-debugging-port', str(PORT), '--profile', profile, '--no-remote', '--headless',
                             '--width', '1280', '--height', '900'])
    n = [0]

    async def call(method, params, timeout=20):
        n[0] += 1
        return await asyncio.wait_for(cmd(ws, n[0], method, params), timeout)

    try:
        for _ in range(60):
            try:
                ws = await websockets.connect(f'ws://127.0.0.1:{PORT}/session', max_size=200_000_000)
                break
            except OSError:
                await asyncio.sleep(0.5)
        await call('session.new', {'capabilities': {}})
        ctx = (await call('browsingContext.getTree', {}))['contexts'][0]['context']
        for it in todo:
            url = 'http://127.0.0.1:8765/eval/one.html?' + urllib.parse.urlencode({'f': it['file'], 'u': it['url']})
            await call('browsingContext.navigate', {'context': ctx, 'url': url, 'wait': 'none'})
            res, t0 = None, time.time()
            while time.time() - t0 < PAGE_LIMIT:
                await asyncio.sleep(0.3)
                try:
                    r = await call('script.evaluate', {'expression': 'window.RESULT ? JSON.stringify(window.RESULT) : ""',
                                                       'target': {'context': ctx}, 'awaitPromise': False}, timeout=5)
                except (asyncio.TimeoutError, RuntimeError):
                    continue
                val = r['result'].get('value') or ''
                if val:
                    res = json.loads(val)
                    break
            if res is None:  # страница не загрузилась за отведённое время — новая вкладка вместо зависшей
                res = {'old': {'verdict': 'timeout', 'checks': []}, 'new': {'verdict': 'timeout', 'checks': []}}
                new_ctx = (await call('browsingContext.create', {'type': 'tab'}))['context']
                try:
                    await call('browsingContext.close', {'context': ctx}, timeout=5)
                except Exception:
                    pass
                ctx = new_ctx
            done[it['file']] = dict(it, **res)
            k = len(done)
            if k % 25 == 0 or res['new']['verdict'] == 'timeout':
                part.write_text(json.dumps(list(done.values()), ensure_ascii=False), encoding='utf-8')
                print(f'{k} / {total} · {it["file"]} · {res["new"]["verdict"]}', flush=True)
    finally:
        part.write_text(json.dumps(list(done.values()), ensure_ascii=False), encoding='utf-8')
        proc.kill()
        kill_leftover_firefox()


async def collect_edge():
    """То же через Microsoft Edge без окна (протокол DevTools) — Firefox на части страниц Phish360 зависал."""
    import urllib.request
    edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    port = 9335
    profile = tempfile.mkdtemp(prefix='pg-eval-edge-')
    proc = subprocess.Popen([edge, '--headless=new', '--disable-gpu', '--no-first-run', f'--remote-debugging-port={port}',
                             f'--user-data-dir={profile}', '--window-size=1280,900', 'about:blank'])
    try:
        for _ in range(60):
            try:
                targets = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/json').read())
                page = next(t for t in targets if t.get('type') == 'page')
                break
            except Exception:
                await asyncio.sleep(0.5)
        ws = await websockets.connect(page['webSocketDebuggerUrl'], max_size=200_000_000)
        n = 1
        await cmd(ws, n, 'Page.navigate', {'url': 'http://127.0.0.1:8765/eval.html?autorun=1'})
        t0 = time.time()
        while True:
            await asyncio.sleep(10)
            n += 1
            r = await cmd(ws, n, 'Runtime.evaluate', {'expression': "window.EVAL ? 'DONE' + JSON.stringify(window.EVAL) : (document.getElementById('prog') || {}).textContent", 'returnByValue': True})
            val = (r.get('result') or {}).get('value') or ''
            if val.startswith('DONE'):
                return json.loads(val[4:])
            print(f'{time.time() - t0:5.0f} с  {val}', flush=True)
    finally:
        proc.terminate()


def summary(rows):
    alarm = lambda v: v in ('danger', 'warning')
    bad = ('timeout', 'missing', 'error')
    ok = lambda r: r['old']['verdict'] not in ('timeout', 'missing') and r['new']['verdict'] not in ('timeout', 'missing')
    ru = [r for r in rows if r['file'].startswith('ru/')]
    p360 = [r for r in rows if not r['file'].startswith('ru/')]

    def pct(part, ver, pred):
        k = sum(1 for r in part if pred(r[ver]['verdict']))
        return f'{k} ({k / len(part) * 100:.1f} %)' if part else '—'

    def two_rows(part):
        return ['| | было | стало |', '|---|---|---|',
                f'| «подозрительно» или «опасно» | {pct(part, "old", alarm)} | {pct(part, "new", alarm)} |',
                f'| из них «опасно» | {pct(part, "old", lambda v: v == "danger")} | {pct(part, "new", lambda v: v == "danger")} |', '']

    def by_check(part):
        c_old, c_new = Counter(), Counter()
        for r in part:
            for c in {x.split(':')[0] for x in r['old']['checks']}:
                c_old[c] += 1
            for c in {x.split(':')[0] for x in r['new']['checks']}:
                c_new[c] += 1
        out = ['| Проверка | было, стр. | стало, стр. |', '|---|---|---|']
        out += [f'| `{c}` | {c_old[c]} | {c_new[c]} |' for c in sorted(set(c_old) | set(c_new), key=lambda c: (-c_old[c], -c_new[c]))]
        return out + ['']

    def skipped(part):
        t = sum(1 for r in part if 'timeout' in (r['old']['verdict'], r['new']['verdict']))
        m = sum(1 for r in part if r['new']['verdict'] == 'missing')
        bits = ([f'не загрузились за 30 с — {t}'] if t else []) + ([f'файл удалён антивирусом — {m}'] if m else [])
        return ['Не учтены: ' + ', '.join(bits) + '.', ''] if bits else []

    legit = [r for r in p360 if r['label'] == 'legit']
    phish = [r for r in p360 if r['label'] == 'phish']
    md = ['# Оценка анализатора на настоящих страницах: было / стало', '',
          f'Дата прогона: {time.strftime("%d.%m.%Y")}. «Было» — версия до переделки (git 83cdc03), «стало» — текущая. '
          'Браузер — Firefox без окна (тот же, для которого сделано расширение).', '',
          'Как устроено: страницы сохранены заранее (набор Phish360 и русские страницы, `tools/eval_sample.py`, `tools/eval_ru.py`); '
          'анализатору передаётся настоящий адрес, с которого страница сохранена, поэтому работают проверки адреса '
          '(страница без HTTPS, форма отправляется на другой сайт или в Telegram-бота). Скрипты страниц не выполняются, '
          'карту никто не вводит — поэтому **проверки поведения** (номер карты ушёл на чужой сайт, подмена реквизитов, '
          'нарисованная скриптом форма) здесь не участвуют: они проверены на тестовых страницах и учебных сценариях.', '',
          '## 1. Ложные тревоги — главный результат', '',
          'Тревога на честной странице — ложная. Если помощник тревожит на каждом сайте, человек перестаёт читать предупреждения.', '']
    for title, part in [('Честные сайты Phish360', legit),
                        ('Русские честные страницы (новости о мошенничестве, оплата в магазинах, фонды, банки)', ru)]:
        good = [r for r in part if ok(r)]
        md += [f'### {title} — {len(good)} стр.', ''] + skipped(part) + two_rows(good) + by_check(good)
    legit_card = [r for r in legit if ok(r) and r['card_input']]
    if legit_card:
        md += [f'### Честные страницы Phish360 с полем номера карты — {len(legit_card)} стр.', '',
               'Самый строгий случай: настоящая форма оплаты на настоящем сайте.', ''] + two_rows(legit_card) + by_check(legit_card)
    md += ['### Русские страницы по отдельности', '', '| Страница | вид | было | стало |', '|---|---|---|---|']
    md += [f"| {r['url'][:70]} | {r.get('kind', '')} | {r['old']['verdict']} {', '.join(x.split(':')[0] for x in r['old']['checks'])} | "
           f"{r['new']['verdict']} {', '.join(x.split(':')[0] for x in r['new']['checks'])} |" for r in ru if ok(r)]
    md += ['']

    fake_card = [r for r in phish if ok(r) and r['card_input']]
    logins = [r for r in phish if ok(r) and r['password'] and not r['card_input']]
    md += ['## 2. Обнаружение поддельных форм оплаты', '',
           f'Из фишинговой половины Phish360 взяты только страницы, на которых есть **поле номера карты** — {len(fake_card)} стр. '
           '(отбор по полям ввода, без анализатора). Это то, на что расширение претендует: поддельная страница оплаты. '
           f'Остальные фишинговые страницы — в основном страницы входа с паролем (PayPal, Apple, банки; {len(logins)} стр. без поля карты): '
           'это кража аккаунта, а не платёжная атака, и расширение их не ищет. Известные фишинговые адреса в Firefox блокирует '
           'встроенная защита (Google Safe Browsing).', ''] + skipped(phish)
    md += two_rows(fake_card) + by_check(fake_card)
    md += ['По протоколу страницы:', '', '| | страниц | тревога было | тревога стало |', '|---|---|---|---|']
    for proto in ('http:', 'https:'):
        part = [r for r in fake_card if r['url'].lower().startswith(proto)]
        k_old = sum(1 for r in part if alarm(r['old']['verdict'])); k_new = sum(1 for r in part if alarm(r['new']['verdict']))
        md.append(f'| {proto[:-1].upper()} | {len(part)} | {k_old} | {k_new} ({k_new / max(1, len(part)) * 100:.1f} %) |')
    md += ['', 'Признаки проверки «форма карты», которые здесь работают: страница или отправка формы без HTTPS («опасно»); '
           'вместе с картой просят данные, не нужные для оплаты, — SSN, девичью фамилию матери, PIN, пароль от почты («опасно»); '
           'номер карты уходит на сервер самого сайта, а не платёжному провайдеру («подозрительно»). Последний признак ловит '
           'поддельные формы на HTTPS: фишинговый набор почти всегда отправляет карту на свой же сервер, а оттуда пересылает мошеннику — '
           'этого браузер уже не видит. Честный магазин номер карты к себе не принимает: поля стоят в окне провайдера или их шифрует его скрипт.', '',
           '**Ограничение.** Ложные тревоги признака «карта уходит на свой сервер» на честных формах оплаты почти не измерены: '
           'среди честных сайтов Phish360 форма карты нашлась только на одной странице (подписка на журнал через ezsubscription.com), '
           'и на ней признак ошибся — сайт сам принимает карты. Поэтому уровень — «подозрительно», а не «опасно». '
           'Остальные пропуски — формы, которые отправляет скрипт (их видно только по поведению после ввода карты), '
           'и поддельные страницы, где поле номера карты не распознано по подписи.', '']
    return '\n'.join(md)


def main():
    import sys
    if '--summary' in sys.argv:  # результаты уже собраны страницей lab/eval.html (кнопка «Запустить»)
        rows = json.loads((ROOT / 'tools' / 'eval-results.json').read_text(encoding='utf-8'))
    else:
        rows = asyncio.run(collect_edge() if '--edge' in sys.argv else collect())
        (ROOT / 'tools' / 'eval-results.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
    md = summary(rows)
    (ROOT / 'docs' / 'eval-results.md').write_text(md, encoding='utf-8')
    import eval_pages  # список страниц для просмотра глазами: lab/eval/pages.html
    eval_pages.main()
    print(md)


if __name__ == '__main__':
    main()
