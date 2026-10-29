"""Write fictional BIO-annotated examples for a demonstration, not real validation."""
import json
import random
from pathlib import Path

def main():
    rng=random.Random(42);out=Path(__file__).resolve().parent/'ner_demo';out.mkdir(exist_ok=True)
    templates={
      'train':[
        (['Переведите','{n}','рублей','получателю','{name}'],['O','B-AMOUNT','I-AMOUNT','O','B-RECIPIENT']),
        (['Оплатите','товар','на','сумму','{n}','рублей'],['O','O','O','O','B-AMOUNT','I-AMOUNT']),
        (['Получатель','{name}','ожидает','{n}','рублей'],['O','B-RECIPIENT','O','B-AMOUNT','I-AMOUNT'])],
      'test':[
        (['Сумма','заказа','составляет','{n}','рублей'],['O','O','O','B-AMOUNT','I-AMOUNT']),
        (['Платёж','для','{name}','составит','{n}','рублей'],['O','O','B-RECIPIENT','O','B-AMOUNT','I-AMOUNT'])]}
    names=['Магазин','Продавец','Получатель']
    for split,patterns in templates.items():
        rows=[]
        for tokens,tags in patterns:
            for _ in range(50):
                amount=str(rng.randrange(100,20000));name=rng.choice(names)
                rows.append({'tokens':[x.replace('{n}',amount).replace('{name}',name) for x in tokens],'tags':tags})
        rng.shuffle(rows)
        (out/(split+'.json')).write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Учебная BIO-разметка создана:',out)

if __name__=='__main__':main()
