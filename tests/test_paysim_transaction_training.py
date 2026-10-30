"""Exercise the full transaction training pipeline with a tiny artificial CSV."""
import csv
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class TransactionTrainingTest(unittest.TestCase):
    def test_model_produces_temporal_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'sample.csv';out=root/'results'
            with source.open('w',encoding='utf8',newline='') as f:
                writer=csv.writer(f);writer.writerow(['time','sender','recipient','amount','scenario_label','source_type'])
                for day in range(15):
                    for i in range(5):
                        time=(datetime(2025,1,1,tzinfo=timezone.utc)+timedelta(days=day,hours=i)).isoformat()
                        writer.writerow([time,f'S{i}',f'R{day%4}',100+i,'paysim_fraud' if i==0 else 'ordinary','TRANSFER'])
            proc=subprocess.run([sys.executable,str(ROOT/'research/train_paysim_transactions.py'),'--input',str(source),'--output',str(out),'--epochs','1'],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=180)
            self.assertEqual(proc.returncode,0,proc.stderr[-2000:]);r=json.loads((out/'metrics.json').read_text(encoding='utf8'))
            self.assertIn('transaction_gnn',r['models']);self.assertEqual(r['parameters']['epochs'],1)
            self.assertTrue((out/'transaction-gnn.pt').exists());self.assertIn('strictly before',r['task'])

if __name__=='__main__':unittest.main()
