"""Start a local-only static lab, with no external dependencies."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
import os
import webbrowser
import base64
import io
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # The browser lab can load the shared analyser but no parent directories.
        if path.split('?', 1)[0].startswith('/shared/'):
            return str(ROOT / 'shared' / Path(path.split('?', 1)[0]).name)
        return super().translate_path(path)

    def do_POST(self):
        if self.path == '/api/research-demo':
            return self.research_demo()
        if self.path == '/api/inspect-js':
            return self.inspect_js()
        if self.path == '/api/score-text':
            return self.score_text()
        if self.path == '/api/context':
            return self.context_analysis()
        if self.path == '/api/graph-score':
            return self.graph_score()
        if self.path != '/api/ocr':
            self.send_error(404); return
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>4_000_000: raise ValueError('Изображение слишком велико')
            payload=json.loads(self.rfile.read(size))
            raw=base64.b64decode(payload['image'],validate=True)
            if len(raw)>2_500_000:raise ValueError('Изображение слишком велико')
            from PIL import Image
            import pytesseract
            Image.MAX_IMAGE_PIXELS=20_000_000
            image=Image.open(io.BytesIO(raw))
            text=pytesseract.image_to_string(image,lang='rus+eng')[:12000]
            text=re.sub(r'(?<!\d)(?:\d[\s-]*){10,19}(?!\d)','[числовые реквизиты скрыты]',text)
            result={'status':'ok','text':text,'note':'Распознавание и скрытие реквизитов могут ошибаться; не используйте реальные секреты.'}
        except Exception as e:
            result={'status':'unknown','reason':'OCR недоступен: установите Pillow, pytesseract и Tesseract с языками rus и eng; используйте учебное изображение.'}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def research_demo(self):
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>1024:raise ValueError('Некорректный запрос')
            kind=json.loads(self.rfile.read(size)).get('kind')
            if kind=='graph':
                commands=[['research/generate_demo.py'],['research/train_models.py','--input','research/demo_data/transactions.csv','--output','research/results']]
            elif kind=='aml':
                commands=[['research/unpack_misata.py'],['research/adapt_misata.py','--input','research/data/misata/transactions.csv','--output','research/data/misata/adapted.csv'],['research/train_models.py','--input','research/data/misata/adapted.csv','--output','research/aml-results']]
            elif kind=='text':
                commands=[['research/generate_text_demo.py'],['research/text_classifier.py','--train','research/text_demo/train.csv','--test','research/text_demo/test.csv','--out','research/text-model']]
            else:raise ValueError('Неизвестный вид эксперимента')
            messages=[]
            for args in commands:
                completed=subprocess.run([sys.executable,*args],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=900)
                messages.append((completed.stdout+'\n'+completed.stderr)[-12000:])
                if completed.returncode:raise RuntimeError('Не удалось завершить шаг. Установите зависимости из research/requirements.txt.\n'+messages[-1][-3000:])
            note='Полученные показатели относятся к искусственным учебным данным. Метки AML не являются метками мошеннической покупки.'
            result={'status':'ok','output':'\n'.join(messages),'note':note}
        except Exception as exc:
            result={'status':'unknown','reason':str(exc)[:3500]}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def inspect_js(self):
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>1_000_000:raise ValueError('Некорректный размер кода')
            source=json.loads(self.rfile.read(size)).get('source','')
            if not isinstance(source,str) or len(source)>500_000:raise ValueError('Некорректный код')
            process=subprocess.run(['node','research/javascript/inspect.js','-'],input=source,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
            if process.returncode:raise RuntimeError('AST-разбор недоступен. Установите Node.js и выполните npm install в research/javascript.')
            result={'status':'ok','analysis':json.loads(process.stdout)}
        except Exception as exc:result={'status':'unknown','reason':str(exc)[:400]}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def score_text(self):
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>20000:raise ValueError('Некорректный размер текста')
            raw=json.loads(self.rfile.read(size)).get('text','')
            if not isinstance(raw,str) or not raw.strip():raise ValueError('Введите текст')
            text=re.sub(r'(?<!\d)(?:\d[\s-]*){10,19}(?!\d)','[номер]',raw[:5000])
            text=re.sub(r'\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b','[почта]',text,flags=re.I)
            import joblib
            model=joblib.load(ROOT/'research'/'text-model'/'model.joblib')
            scores=model.predict_proba([text])[0];index=int(scores.argmax())
            result={'status':'hypothesis','label':str(model.classes_[index]),'score':float(scores[index]),
                    'note':'Это оценка учебной модели на искусственных примерах, не подтверждение безопасности; значения не откалиброваны.'}
        except Exception as exc:result={'status':'unknown','reason':'Модель недоступна. Запустите учебное обучение в разделе исследования моделей.'}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def context_analysis(self):
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>20000:raise ValueError('Некорректный размер текста')
            raw=json.loads(self.rfile.read(size)).get('text','')
            if not isinstance(raw,str) or not raw.strip():raise ValueError('Введите текст')
            model=ROOT/'research'/'models'/'context.gguf'
            if not model.is_file():raise FileNotFoundError('Файл локальной модели research/models/context.gguf не найден.')
            completed=subprocess.run([sys.executable,'research/local_context.py','--model',str(model),'--text','-'],input=raw[:10000],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
            if completed.returncode:raise RuntimeError('Локальная модель недоступна. Проверьте llama-cpp-python и совместимость модели.')
            result=json.loads(completed.stdout)
        except Exception as exc:result={'status':'unknown','reason':str(exc)[:400]}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def graph_score(self):
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>200000:raise ValueError('Некорректный размер запроса')
            payload=json.loads(self.rfile.read(size))
            if not isinstance(payload.get('history'),list) or len(payload['history'])>500:raise ValueError('Слишком большая история')
            completed=subprocess.run([sys.executable,'research/predict_graph.py'],input=json.dumps(payload),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
            if completed.returncode:raise RuntimeError('Графовая модель недоступна. Проверьте установку зависимостей.')
            result=json.loads(completed.stdout)
        except Exception as exc:result={'status':'unknown','reason':str(exc)[:400]}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8765), partial(Handler, directory=str(ROOT / 'lab')))
    print('Лаборатория: http://127.0.0.1:8765/   Остановка: Ctrl+C', flush=True)
    webbrowser.open('http://127.0.0.1:8765/')
    server.serve_forever()
