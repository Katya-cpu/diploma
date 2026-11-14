"""Снимки работы расширения на настоящих мошеннических страницах.

Открывает сохранённый код страниц в отдельном Firefox с установленным расширением (extension/) и снимает экран
вместе с панелью помощника. Копии страниц — те же, что для анализатора (datasets/web_pages/eval_sample/…):
в каждую вставлен запрет скриптов и сетевых запросов (Content-Security-Policy), поэтому код мошенников не выполняется,
а внешние картинки и стили не загружаются — страница выглядит проще, чем в жизни. Поэтому рядом кладётся
оригинальный снимок той же страницы (urlscan.io или набор Zenodo), если он есть.

Вход: tools/real-pages.json — список {id, file (путь внутри /corpus/), orig (снимок оригинала или null)}.
Выход: lab/real/ext/<id>.jpg — слева оригинал, справа та же страница с панелью расширения.

Запуск (лаборатория должна быть запущена): .venv\\Scripts\\python.exe tools\\real_shots.py [id ...]
"""
import asyncio
import base64
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import websockets
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from firefox_check import Bidi, FIREFOX  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'lab' / 'real' / 'ext'
PORT = 9336
W, H = 1280, 900


def font(size):
    for f in ('C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def compose(ext_png, orig_path, out):
    ext = Image.open(io.BytesIO(ext_png)).convert('RGB')
    cap = 34
    if orig_path and Path(orig_path).exists():
        orig = Image.open(orig_path).convert('RGB')
        orig = orig.crop((0, 0, orig.width, min(orig.height, int(orig.width * H / W))))
        orig = orig.resize((W, int(orig.height * W / orig.width)))
        canvas = Image.new('RGB', (W * 2 + 16, max(orig.height, H) + cap), 'white')
        canvas.paste(orig, (0, cap))
        canvas.paste(ext, (W + 16, cap))
        d = ImageDraw.Draw(canvas)
        d.text((8, 4), 'Оригинал страницы (снимок источника)', fill='#444', font=font(22))
        d.text((W + 24, 4), 'Сохранённый код страницы в Firefox с расширением', fill='#444', font=font(22))
    else:
        canvas = Image.new('RGB', (W, H + cap), 'white')
        canvas.paste(ext, (0, cap))
        ImageDraw.Draw(canvas).text((8, 4), 'Сохранённый код страницы в Firefox с расширением', fill='#444', font=font(22))
    canvas.thumbnail((1700, 1700))
    canvas.save(out, quality=72, optimize=True)


async def run(items):
    profile = tempfile.mkdtemp(prefix='pg-shots-')
    proc = subprocess.Popen([FIREFOX, '--remote-debugging-port', str(PORT), '--profile', profile, '--no-remote', '--headless',
                             '--width', str(W), '--height', str(H)])
    try:
        for _ in range(90):
            try:
                ws = await websockets.connect(f'ws://127.0.0.1:{PORT}/session', max_size=80_000_000)
                b = Bidi(ws)
                await asyncio.wait_for(b.cmd('session.new', {'capabilities': {}}), 15)
                break
            except (OSError, asyncio.TimeoutError, websockets.exceptions.WebSocketException):
                await asyncio.sleep(0.7)
        else:
            raise RuntimeError('Firefox не ответил')
        await b.cmd('webExtension.install', {'extensionData': {'type': 'path', 'path': str(ROOT / 'extension')}})
        ctx = (await b.cmd('browsingContext.getTree', {}))['contexts'][0]['context']
        OUT.mkdir(parents=True, exist_ok=True)
        for k, it in enumerate(items):
            try:
                await asyncio.wait_for(b.cmd('browsingContext.navigate', {'context': ctx, 'url': 'http://127.0.0.1:8765/corpus/' + it['file'], 'wait': 'complete'}), 25)
            except asyncio.TimeoutError:
                pass
            await asyncio.sleep(3)
            if it.get('type'):  # учебные копии скиммеров: вводим тестовую карту с клавиатуры, как человек
                sel = json.dumps(it['type'])
                await b.cmd('script.evaluate', {'expression': f'document.querySelector({sel}).focus(); 1', 'target': {'context': ctx}, 'awaitPromise': False})
                acts = []
                for ch in '4111111111111111':
                    acts += [{'type': 'keyDown', 'value': ch}, {'type': 'keyUp', 'value': ch}]
                await b.cmd('input.performActions', {'context': ctx, 'actions': [{'type': 'key', 'id': 'kb', 'actions': acts}]})
                await b.cmd('script.evaluate', {'expression': f"document.querySelector({sel}).dispatchEvent(new Event('change', {{bubbles: true}})); 1",
                                                'target': {'context': ctx}, 'awaitPromise': False})
                await asyncio.sleep(4)
            try:
                shot = await asyncio.wait_for(b.cmd('browsingContext.captureScreenshot', {'context': ctx}), 20)
            except Exception as e:
                print('нет снимка', it['id'], e, flush=True)
                continue
            compose(base64.b64decode(shot['data']), it.get('orig'), OUT / (it['id'] + '.jpg'))
            print(f'{k + 1}/{len(items)}', it['id'], flush=True)
    finally:
        proc.terminate()


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    items = json.loads((ROOT / 'tools' / 'real-pages.json').read_text(encoding='utf-8'))
    if sys.argv[1:]:
        items = [it for it in items if it['id'] in sys.argv[1:]]
    asyncio.run(run(items))


if __name__ == '__main__':
    main()
