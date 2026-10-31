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
        return super().do_GET()

    def do_POST(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
            return self.send_error(403)
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
