"""Convert a label-independent sample of the PaySim archive to the graph CSV format."""
import argparse
import csv
import hashlib
import io
from collections import Counter
from datetime import datetime,timedelta,timezone
from pathlib import Path
from zipfile import ZipFile

def convert(archive, output, rate):
    if not 0.001<=rate<=0.2:raise ValueError('Доля должна быть от 0.001 до 0.2.')
    cutoff=int(rate*(1<<64));counts=Counter()
    output.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(archive) as z:
        files=[x for x in z.infolist() if x.filename.lower().endswith('.csv') and not x.filename.startswith('__MACOSX/')]
        if len(files)!=1 or files[0].file_size>1_000_000_000:raise ValueError('Ожидается один CSV в архиве.')
        with z.open(files[0]) as raw,io.TextIOWrapper(raw,encoding='utf-8',newline='') as src,output.open('w',encoding='utf-8',newline='') as dst:
            reader=csv.DictReader(src);required={'step','type','amount','nameOrig','nameDest','isFraud'}
            if not required.issubset(set(reader.fieldnames or [])):raise ValueError('Отсутствуют необходимые поля PaySim.')
            writer=csv.writer(dst);writer.writerow(['time','sender','recipient','amount','scenario_label','source_type'])
            base=datetime(2025,1,1,tzinfo=timezone.utc)
            for i,row in enumerate(reader):
                counts['source']+=1
                # Deterministic selection uses row index only, never labels or amounts.
                key=int.from_bytes(hashlib.blake2b(str(i).encode(),digest_size=8,person=b'paysim1').digest(),'big')
                if key>=cutoff:continue
                step=int(row['step']);amount=float(row['amount']);label='paysim_fraud' if row['isFraud']=='1' else 'ordinary'
                if step<0 or amount<0 or not row['nameOrig'] or not row['nameDest']:raise ValueError('Некорректная строка источника.')
                writer.writerow([(base+timedelta(hours=step)).isoformat(),row['nameOrig'],row['nameDest'],amount,label,row['type']])
                counts['selected']+=1;counts['selected_fraud']+=int(label=='paysim_fraud')
    print(f"Источник: {counts['source']}; выбрано: {counts['selected']}; помечено мошенническими: {counts['selected_fraud']}. Доля {rate:.3f}, одинаковая для всех меток. История разрежена отбором.")

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--rate',type=float,default=0.01);a=p.parse_args();convert(a.input,a.output,a.rate)
