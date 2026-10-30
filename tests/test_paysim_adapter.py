"""Sampling must not select rows based on future fraud labels."""
import csv
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
class TestPaySimAdapter(unittest.TestCase):
    def test_selection_is_label_independent(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);outputs=[]
            for flip in (False,True):
                archive=tmp/f'{flip}.zip';csvfile=tmp/f'{flip}.csv'
                lines=['step,type,amount,nameOrig,nameDest,isFraud']
                for i in range(300):lines.append(f'{i//10},TRANSFER,{i+1},S{i},R{i},{int((i%3==0)^flip)}')
                with ZipFile(archive,'w') as z:z.writestr('data.csv','\n'.join(lines))
                subprocess.run([sys.executable,str(ROOT/'research/adapt_paysim.py'),'--input',str(archive),'--output',str(csvfile),'--rate','0.2'],check=True,capture_output=True)
                with csvfile.open(encoding='utf8',newline='') as f:outputs.append(list(csv.DictReader(f)))
            self.assertGreater(len(outputs[0]),0)
            self.assertEqual([x['sender'] for x in outputs[0]],[x['sender'] for x in outputs[1]])
            self.assertTrue(all(x['scenario_label']!=y['scenario_label'] for x,y in zip(*outputs)))

if __name__=='__main__':unittest.main()
