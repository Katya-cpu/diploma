"""Optional prediction from previously generated AST facts; no code is executed."""
import json
import sys
from pathlib import Path
import joblib

if __name__=='__main__':
    try:
        item=json.load(sys.stdin);features={}
        for fact in item.get('facts',[]):
            key=str(fact.get('kind','unknown'))+':'+str(fact.get('name','unknown'))
            features[key]=features.get(key,0)+1
        weights=Path(__file__).resolve().parent/'model'/'js-model.joblib'
        model=joblib.load(weights);scores=model.predict_proba([features])[0];idx=int(scores.argmax())
        result={'status':'hypothesis','label':str(model.classes_[idx]),'score':float(scores[idx]),'note':'Неоткалиброванная гипотеза по статическим признакам; вредоносность не доказана.'}
    except Exception:result={'status':'unknown','reason':'Модель AST не обучена или недоступна.'}
    print(json.dumps(result,ensure_ascii=False))
