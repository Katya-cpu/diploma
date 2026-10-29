"""Prepare redacted text candidates from the project's reviewed web index.

Source labels are inherited, not independently verified. This does not create
a scientifically valid train/test split. Review examples and group by campaign.
"""
import csv
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
index=ROOT/'datasets'/'web_pages'/'reviewed_samples.json'
output=Path(__file__).resolve().parent/'reviewed_text_candidates.csv'

def sanitize(text):
    text=re.sub(r'https?://\S+','[ссылка удалена]',text,flags=re.I)
    text=re.sub(r'\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b','[почта удалена]',text,flags=re.I)
    text=re.sub(r'(?<!\d)(?:\d[\s-]*){10,19}(?!\d)','[реквизиты удалены]',text)
    return text[:5000]

if __name__=='__main__':
    rows=json.loads(index.read_text(encoding='utf-8'))
    with output.open('w',encoding='utf-8',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=['id','source','source_label','text','provenance_note']);writer.writeheader()
        for row in rows:
            writer.writerow({'id':row.get('id',''),'source':row.get('source',''),'source_label':row.get('source_label',''),
                             'text':sanitize(row.get('text_excerpt','')),'provenance_note':'Метка источника; требуется независимая проверка'})
    print('Подготовлены кандидаты:',output)
