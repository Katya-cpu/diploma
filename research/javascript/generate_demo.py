"""Generate fictional AST-feature records for a toy ML pipeline, not validation."""
import json
import random
from pathlib import Path

def main():
    rng=random.Random(42);out=Path(__file__).resolve().parent/'demo';out.mkdir(exist_ok=True)
    for split in ('train','test'):
        rows=[]
        for i in range(120):
            suspicious=i%2==1
            kinds=['dom_selector_call','network_call'] if suspicious else ['dom_selector_call']
            if rng.random()<0.35:kinds.append('html_insertion')
            facts=[{'kind':kind,'name':{'dom_selector_call':'querySelector','network_call':'fetch','html_insertion':'innerHTML'}[kind]} for kind in kinds]
            if split=='test' and rng.random()<0.3:facts=facts[:-1]
            rows.append({'facts':facts,'label':'synthetic_suspicious' if suspicious else 'synthetic_ordinary'})
        rng.shuffle(rows);(out/(split+'.json')).write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Fictional AST features created in',out)

if __name__=='__main__':main()
