"""Create fictional training samples for demonstrating the text ML pipeline.

Templates in training and evaluation are intentionally different. Even so,
both come from the same artificial generator and do not establish real quality.
"""
import csv
import random
from pathlib import Path

def main():
    rng=random.Random(42);out=Path(__file__).resolve().parent/'text_demo';out.mkdir(exist_ok=True)
    sets={
      'train':{'suspicious':['Чтобы получить выплату, переведите {} рублей на карту получателя.',
                             'Подтвердите получение средств: оплатите комиссию {} рублей сейчас.',
                             'Срочно перейдите в банк и отправьте {} рублей по номеру карты.'],
               'ordinary':['Заказ оформлен. Стоимость товара {} рублей, способ оплаты выбирается на странице.',
                           'Информация о доставке: цена покупки {} рублей, оплата при получении.',
                           'Каталог товаров: стоимость выбранного товара {} рублей.']},
      'test':{'suspicious':['Вам обещали получение денег, но для зачисления требуют оплатить {} рублей.',
                            'Для получения товара сделайте перевод {} рублей на указанную карту.'],
              'ordinary':['Корзина покупок содержит товар на сумму {} рублей.',
                          'Цена выбранной вещи составляет {} рублей; доставка рассчитывается отдельно.']}}
    for split,groups in sets.items():
        rows=[]
        for label,templates in groups.items():
            for template in templates:
                for _ in range(80):rows.append([template.format(rng.randrange(100,25000)),label])
        rng.shuffle(rows)
        with (out/(split+'.csv')).open('w',encoding='utf-8',newline='') as f:
            writer=csv.writer(f);writer.writerow(['text','label']);writer.writerows(rows)
    print('Учебные наборы сохранены в',out)

if __name__=='__main__':main()
