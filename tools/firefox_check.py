"""Проверка расширения в настоящем Firefox (без участия человека).

Запускает отдельный Firefox с чистым профилем через протокол WebDriver BiDi, устанавливает
расширение из папки extension/ как временное, открывает учебные сценарии и сохраняет скриншоты
с панелью расширения в папку tools/firefox-shots/. Лаборатория должна быть запущена.

Запуск: .venv\\Scripts\\python.exe tools\\firefox_check.py
"""
import asyncio
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
FIREFOX = r'C:\Program Files\Mozilla Firefox\firefox.exe'
PORT = 9333
SHOTS = ROOT / 'tools' / 'firefox-shots'
PAGES = sys.argv[1:] or ['delivery.html', 'marketplace-transfer.html', 'fine-qr.html', 'tea-shop-skimmer.html',
                         'invoice-swap.html', 'prize-clickjacking.html', 'honest-receipt.html']


class Bidi:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def cmd(self, method, params):
        self.n += 1
        await self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get('id') == self.n:
                if msg.get('type') == 'error':
                    raise RuntimeError(f"{method}: {msg.get('error')} {msg.get('message')}")
                return msg.get('result')


async def main():
    profile = tempfile.mkdtemp(prefix='pg-ff-')
    proc = subprocess.Popen([FIREFOX, '--remote-debugging-port', str(PORT), '--profile', profile, '--no-remote', '--headless',
                             '--width', '1280', '--height', '950'])
    try:
        for _ in range(60):
            try:
                ws = await websockets.connect(f'ws://127.0.0.1:{PORT}/session', max_size=50_000_000)
                break
            except OSError:
                await asyncio.sleep(0.5)
        b = Bidi(ws)
        await b.cmd('session.new', {'capabilities': {}})
        ext = await b.cmd('webExtension.install', {'extensionData': {'type': 'path', 'path': str(ROOT / 'extension')}})
        print('Расширение установлено:', ext)
        tree = await b.cmd('browsingContext.getTree', {})
        ctx = tree['contexts'][0]['context']
        SHOTS.mkdir(exist_ok=True)
        for page in PAGES:
            await b.cmd('browsingContext.navigate', {'context': ctx, 'url': f'http://127.0.0.1:8765/scenarios/{page}', 'wait': 'complete'})
            await asyncio.sleep(3.5)
            if 'skimmer' in page:  # имитируем ввод карты: клавиатурой через BiDi input
                await b.cmd('script.evaluate', {'expression': "document.getElementById('cc').focus(); 1", 'target': {'context': ctx}, 'awaitPromise': False})
                acts = []
                for ch in '4111111111111111':
                    acts += [{'type': 'keyDown', 'value': ch}, {'type': 'keyUp', 'value': ch}]
                await b.cmd('input.performActions', {'context': ctx, 'actions': [{'type': 'key', 'id': 'kb', 'actions': acts}]})
                # У живого пользователя при переходе к следующему полю браузер генерирует событие change.
                # В автоматически запущенном окне без фокуса этого не происходит — генерируем его явно.
                await b.cmd('script.evaluate', {'expression': "document.getElementById('cc').dispatchEvent(new Event('change', {bubbles: true})); 1", 'target': {'context': ctx}, 'awaitPromise': False})
                await asyncio.sleep(4)
            shot = await b.cmd('browsingContext.captureScreenshot', {'context': ctx})
            (SHOTS / page.replace('.html', '.png')).write_bytes(base64.b64decode(shot['data']))
            print('Снимок:', page)
    finally:
        proc.terminate()


if __name__ == '__main__':
    asyncio.run(main())
