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
import shutil
import socket

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Always fetch current local application files after an update.
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def send_head(self):
        # Ignore cached timestamps: files in Git checkouts can share a timestamp.
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        return super().send_head()

    def translate_path(self, path):
        # The browser lab can load the shared analyser but no parent directories.
        if path.split('?', 1)[0].startswith('/shared/'):
            return str(ROOT / 'shared' / Path(path.split('?', 1)[0]).name)
        return super().translate_path(path)

    def do_GET(self):
        if self.path!='/api/reviewed':return super().do_GET()
        if self.headers.get('Host') not in ('127.0.0.1:8765','localhost:8765'):
            self.send_error(403); return
        try:
            path=ROOT.parent/'datasets'/'web_pages'/'reviewed_samples.json'
            rows=json.loads(path.read_text(encoding='utf-8'))
            items=[]
            for row in rows[:100]:
                text=str(row.get('text_excerpt',''))[:5000]
                text=re.sub(r'(?i)https?://\S+','[ссылка удалена]',text)
                text=re.sub(r'\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b','[почта удалена]',text,flags=re.I)
                text=re.sub(r'(?<!\d)(?:\d[\s-]*){10,19}(?!\d)','[реквизиты удалены]',text)
                items.append({'id':str(row.get('id',''))[:120],'label':str(row.get('source_label',''))[:30],
                              'source':str(row.get('source',''))[:60],'text':text,'card_fields':int(row.get('card_fields',0))})
            result={'status':'ok','items':items,'note':'Метки источников; HTML не выполняется. Очистка может быть неполной.'}
        except Exception:
            result={'status':'unknown','reason':'Индекс проверенных выдержек не найден в datasets/web_pages. В архиве Git он не поставляется.'}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def do_POST(self):
        if self.headers.get('Host') not in ('127.0.0.1:8765','localhost:8765'):
            self.send_error(403); return
        if self.path == '/api/research-demo':
            return self.research_demo()
        if self.path == '/api/inspect-js':
            return self.inspect_js()
        if self.path == '/api/decode-qr':
            return self.decode_qr()
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
            if image.width*image.height>20_000_000:raise ValueError('Изображение превышает лимит пикселей')
            text=pytesseract.image_to_string(image,lang='rus+eng')[:12000]
            text=re.sub(r'(?<!\d)(?:\d[\s-]*){10,19}(?!\d)','[числовые реквизиты скрыты]',text)
            result={'status':'ok','text':text,'note':'Распознавание и скрытие реквизитов могут ошибаться; не используйте реальные секреты.'}
        except Exception as e:
            result={'status':'unknown','reason':'OCR недоступен: установите Pillow, pytesseract и Tesseract с языками rus и eng; используйте учебное изображение.'}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def decode_qr(self):
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>14_000_000:raise ValueError('Размер изображения превышает ограничение.')
            payload=json.loads(self.rfile.read(size))
            raw=base64.b64decode(payload.get('image',''),validate=True)
            if len(raw)>10_000_000:raise ValueError('Размер изображения превышает 10 МБ.')
            from PIL import Image, ImageOps
            import zxingcpp
            Image.MAX_IMAGE_PIXELS=20_000_000
            image=Image.open(io.BytesIO(raw))
            if image.width*image.height>20_000_000:raise ValueError('Изображение превышает лимит пикселей.')
            image=ImageOps.exif_transpose(image).convert('RGB')
            codes=zxingcpp.read_barcodes(image,formats=zxingcpp.BarcodeFormat.QRCode,try_rotate=True,try_downscale=True,try_invert=True)
            if not codes:result={'status':'unknown','reason':'QR не распознан. Попробуйте другое изображение или улучшите снимок.'}
            elif len(codes)>1:result={'status':'unknown','reason':'Найдено несколько QR-кодов. Выберите изображение с одним кодом.'}
            else:result={'status':'ok','text':codes[0].text[:4096],'method':'локальный ZXing'}
        except ImportError:
            result={'status':'unknown','reason':'Дополнительный декодер не установлен. Запустите «Установить поддержку QR.cmd» и перезапустите лабораторию.'}
        except Exception:
            result={'status':'unknown','reason':'Не удалось обработать изображение. Проверьте формат, размер и качество.'}
        data=json.dumps(result,ensure_ascii=False).encode('utf-8')
        self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def research_demo(self):
        if self.headers.get('Origin') not in ('http://127.0.0.1:8765','http://localhost:8765'):
            self.send_error(403); return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>1024:raise ValueError('Некорректный запрос')
            payload=json.loads(self.rfile.read(size));kind=payload.get('kind')
            options=[]
            if kind in ('graph','aml'):
                epochs=payload.get('epochs',15);lr=payload.get('learning_rate',0.002);fpr=payload.get('max_fpr',0.05)
                if type(epochs) is not int or not 1<=epochs<=100 or type(lr) not in (int,float) or not 0.00001<=lr<=0.1 or type(fpr) not in (int,float) or not 0<=fpr<=0.5:raise ValueError('Некорректные параметры модели.')
                options=['--epochs',str(epochs),'--learning-rate',str(lr),'--max-fpr',str(fpr)]
            if kind=='graph':
                commands=[['research/generate_demo.py'],['research/train_models.py','--input','research/demo_data/transactions.csv','--output','research/results',*options]]
            elif kind=='aml':
                commands=[['research/unpack_misata.py'],['research/adapt_misata.py','--input','research/data/misata/transactions.csv','--output','research/data/misata/adapted.csv'],['research/train_models.py','--input','research/data/misata/adapted.csv','--output','research/aml-results',*options]]
            elif kind=='text':
                commands=[['research/generate_text_demo.py'],['research/text_classifier.py','--train','research/text_demo/train.csv','--test','research/text_demo/test.csv','--out','research/text-model']]
            elif kind=='js':
                commands=[['research/javascript/generate_demo.py'],['research/javascript/train_model.py','--train','research/javascript/demo/train.json','--test','research/javascript/demo/test.json','--out','research/javascript/model']]
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
            node=shutil.which('node')
            inspector=ROOT/'research'/'javascript'/'inspect.js'
            modules=ROOT/'research'/'javascript'/'node_modules'
            if not node or not inspector.is_file() or not (modules/'acorn').is_dir() or not (modules/'acorn-walk').is_dir():
                patterns=[('network_call',r'\b(fetch|sendBeacon|open|send)\s*\('),('dom_selector_call',r'\b(querySelector|getElementById|getElementsByName)\s*\('),('dynamic_code_call',r'\b(eval|Function)\s*\('),('html_insertion',r'\b(innerHTML|outerHTML)\s*=')]
                facts=[]
                for kind,pattern in patterns:
                    for match in re.finditer(pattern,source):
                        facts.append({'kind':kind,'name':match.group(1),'line':source.count('\n',0,match.start())+1})
                facts.sort(key=lambda fact:fact['line'])
                result={'status':'ok','analysis':{'method':'простой поиск текста, не AST','facts':facts[:100],'limitations':['Поиск может находить слова в комментариях и строках и пропускать скрытые вызовы.','Код не выполнялся; признаки не доказывают вредоносность. Для AST установите Node.js и зависимости research/javascript.']},'model':{'status':'unknown','reason':'Модель для простого поиска не применяется.'}}
                data=json.dumps(result,ensure_ascii=False).encode('utf-8')
                self.send_response(200);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
                return
            process=subprocess.run([node,str(inspector),'-'],input=source,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
            if process.returncode:raise RuntimeError('Не удалось разобрать код как JavaScript. Проверьте его синтаксис; код не выполнялся.')
            analysis=json.loads(process.stdout)
            analysis['method']='AST-разбор с Acorn'
            prediction=subprocess.run([sys.executable,'research/javascript/predict_model.py'],input=json.dumps(analysis),cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
            model_output=json.loads(prediction.stdout) if prediction.returncode==0 else {'status':'unknown','reason':'Модель AST недоступна.'}
            result={'status':'ok','analysis':analysis,'model':model_output}
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

class ExclusiveLabServer(ThreadingHTTPServer):
    allow_reuse_address = False
    def server_bind(self):
        if sys.platform == 'win32':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

if __name__ == '__main__':
    try:
        server = ExclusiveLabServer(('127.0.0.1', 8765), partial(Handler, directory=str(ROOT / 'lab')))
    except OSError:
        print('Не удалось занять адрес лаборатории 127.0.0.1:8765. Закройте все старые окна лаборатории и запустите её снова.', flush=True)
        sys.exit(1)
    print('Лаборатория: http://127.0.0.1:8765/   Остановка: Ctrl+C', flush=True)
    webbrowser.open('http://127.0.0.1:8765/')
    server.serve_forever()
