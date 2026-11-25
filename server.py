"""Локальный сервер лаборатории: http://127.0.0.1:8765/

Отдаёт страницы лаборатории (папка lab/), файлы расширения (папка extension/ — их подключает
анализатор лаборатории) и API раздела «Граф транзакций». Работает только на этом компьютере.
"""
import json
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765
sys.path.insert(0, str(ROOT))


def graph_api():
    """Модуль графа подключается лениво: лаборатория работает и без библиотек машинного обучения."""
    try:
        from graph import service
        return service
    except ImportError as e:
        return e


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'lab'), **kwargs)

    def log_message(self, *args):
        pass  # не засоряем консоль

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def translate_path(self, path):
        clean = path.split('?', 1)[0]
        if clean.startswith('/extension/'):
            target = (ROOT / clean.lstrip('/')).resolve()
            if (ROOT / 'extension') in target.parents:
                return str(target)
        if clean.startswith('/corpus/'):  # выборка настоящих страниц для оценки (tools/eval_sample.py)
            base = (ROOT.parent / 'datasets' / 'web_pages' / 'eval_sample').resolve()
            target = (base / clean[len('/corpus/'):]).resolve()
            if base in target.parents:
                return str(target)
        return super().translate_path(path)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api(self, method):
        service = graph_api()
        if isinstance(service, Exception):
            return self.send_json({'error': 'Не установлены библиотеки для графа: запустите «Установить ML.cmd». (' + str(service) + ')'}, 503)
        length = int(self.headers.get('Content-Length') or 0)
        payload = json.loads(self.rfile.read(length) or b'{}') if method == 'POST' else {}
        route = self.path.split('?', 1)[0]
        try:
            self.send_json(service.handle(method, route, payload, self.path))
        except service.ApiError as e:
            self.send_json({'error': str(e)}, 400)

    def do_GET(self):
        if self.path.startswith('/api/'):
            return self.api('GET')
        if self.path.startswith('/corpus/') and '?orig=' in self.path:
            return self.corpus_with_origin()
        return super().do_GET()

    def corpus_with_origin(self):
        # Сохранённая копия настоящей страницы с меткой исходного адреса (?orig=…): расширение на локальной
        # странице оценивает её так, как на настоящем адресе, – и в панели стоит настоящий домен, а не 127.0.0.1.
        from html import escape
        from urllib.parse import parse_qs, urlsplit
        orig = parse_qs(urlsplit(self.path).query).get('orig', [''])[0]
        target = Path(self.translate_path(self.path))
        if not target.is_file() or not orig.startswith(('http://', 'https://')):
            return self.send_error(404)
        html = target.read_text(encoding='utf-8', errors='replace')
        meta = '<meta name="pg-original-url" content="' + escape(orig, quote=True) + '">'
        low = html.lower()
        i = low.find('<head')
        i = low.find('>', i) + 1 if i >= 0 else 0
        body = (html[:i] + meta + html[i:]).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
            return self.send_error(403)
        if self.path == '/api/eval/save':  # результаты страницы lab/eval.html (оценка «было / стало»)
            length = int(self.headers.get('Content-Length') or 0)
            (ROOT / 'tools' / 'eval-results.json').write_bytes(self.rfile.read(length))
            return self.send_json({'saved': 'tools/eval-results.json'})
        if self.path.startswith('/api/'):
            return self.api('POST')
        self.send_error(404)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    url = f'http://127.0.0.1:{PORT}/'
    print('Лаборатория открыта: ' + url + '\nОстановить: Ctrl+C')
    if '--no-browser' not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
