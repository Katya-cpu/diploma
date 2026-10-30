"""The experiment result must remain visible even if dependencies emit many warnings."""
import http.client
import json
import sys
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import start_lab

class TestResearchOutput(unittest.TestCase):
    def test_result_is_not_truncated_by_warnings(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(start_lab.Handler,directory=str(start_lab.ROOT/'lab')))
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            with patch.object(start_lab.subprocess,'run',return_value=SimpleNamespace(stdout='METRIC_RESULT_VISIBLE',stderr='warning\n'*5000,returncode=0)):
                c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=10)
                c.request('POST','/api/research-demo',json.dumps({'kind':'graph'}),{'Host':'localhost:8765','Origin':'http://localhost:8765','Content-Type':'application/json'})
                result=json.loads(c.getresponse().read());self.assertEqual(result['status'],'ok');self.assertIn('METRIC_RESULT_VISIBLE',result['output'])
        finally:
            server.shutdown();server.server_close();worker.join()

    def test_transaction_model_uses_expected_command(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(start_lab.Handler,directory=str(start_lab.ROOT/'lab')))
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        try:
            with patch.object(start_lab.subprocess,'run',return_value=SimpleNamespace(stdout='OK',stderr='',returncode=0)) as run:
                c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=10)
                body=json.dumps({'kind':'paysim-transaction','sample_rate':0.01,'epochs':2,'learning_rate':0.002,'max_fpr':0.05})
                c.request('POST','/api/research-demo',body,{'Host':'localhost:8765','Origin':'http://localhost:8765','Content-Type':'application/json'})
                result=json.loads(c.getresponse().read());self.assertEqual(result['status'],'ok');self.assertEqual(run.call_count,2)
                self.assertIn('research/train_paysim_transactions.py',run.call_args_list[1].args[0])
                self.assertIn('--epochs',run.call_args_list[1].args[0])
        finally:
            server.shutdown();server.server_close();worker.join()

if __name__=='__main__':unittest.main()
