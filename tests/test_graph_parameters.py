"""Check graph parameter validation without training or external datasets."""
import http.client
import json
import threading
import unittest
from functools import partial
from pathlib import Path
from http.server import ThreadingHTTPServer
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from start_lab import Handler, ROOT

class TestGraphParameters(unittest.TestCase):
    def test_invalid_epochs_are_rejected(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT/'lab')))
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=10)
            body=json.dumps({'kind':'graph','epochs':101,'learning_rate':0.002,'max_fpr':0.05})
            conn.request('POST','/api/research-demo',body,{'Host':'localhost:8765','Origin':'http://localhost:8765','Content-Type':'application/json'})
            response=conn.getresponse();result=json.loads(response.read())
            self.assertEqual(result['status'],'unknown')
            self.assertIn('параметры',result['reason'])
        finally:
            server.shutdown();server.server_close();worker.join()

if __name__=='__main__':unittest.main()
