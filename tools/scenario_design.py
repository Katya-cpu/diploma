"""Оформление учебных сценариев. Не меняет адреса, поля и исполняемые скрипты."""
from pathlib import Path
import math
import re

OUT = Path(__file__).resolve().parent.parent / 'lab' / 'scenarios'

SPECS = {
    'delivery.html': ('market', 'Москва', ['Категории', 'Транспорт', 'Личные вещи', 'Для дома', 'Помощь']),
    'seller-payout.html': ('market', 'Москва', ['Мои объявления', 'Сообщения', 'Избранное', 'Помощь']),
    'courier-code.html': ('courier', 'Служба экспресс-доставки', ['Отслеживание', 'Получателям', 'Отправителям']),
    'marketplace-transfer.html': ('electronics', 'Москва · Самовывоз и доставка', ['Каталог товаров', 'Смартфоны', 'Ноутбуки', 'Аксессуары', 'Акции']),
    'fine-qr.html': ('parking', 'Городские сервисы', ['Парковки', 'Разрешения', 'Обращения', 'Документы']),
    'safe-account.html': ('bank', 'Интернет-банк для частных клиентов', []),
    'tea-shop-skimmer.html': ('tea', 'Чай из Китая · Отправляем по России', ['Весь чай', 'Пуэр', 'Улун', 'Красный чай', 'Посуда']),
    'shoe-shop-overlay.html': ('streetwear', 'Оригинальные кроссовки и одежда', ['Новинки', 'Мужское', 'Женское', 'Бренды', 'Магазины']),
    'prize-clickjacking.html': ('rewards', 'Программа лояльности', ['Предложения', 'Мои бонусы', 'Правила участия', 'Поддержка']),
    'invoice-swap.html': ('invoice', 'Кабинет клиента', []),
    'clickfix-tickets.html': ('tickets', 'Билеты в кино', []),
    'bank-app-nfc.html': ('bank', 'Интернет-банк для частных клиентов', []),
    'bitb-login.html': ('electronics', 'Москва · Самовывоз и доставка', ['Каталог товаров', 'Смартфоны', 'Аудио', 'Аксессуары', 'Акции']),
    'homograph-mail.html': ('mail', '', []),
    'honest-shop.html': ('coffee', 'Свежеобжаренный кофе · Москва', ['Кофе', 'Обжарка', 'Оборудование', 'Доставка', 'О кофейне']),
    'honest-receipt.html': ('housing', 'Личный кабинет жителя', ['Главная', 'Квитанции', 'Показания', 'Заявки', 'Документы']),
}

def symbol(theme):
    parts = {
        'market': '<circle cx="8" cy="8" r="6" fill="#09a6b1"/><circle cx="23" cy="8" r="6" fill="#8abe46"/><circle cx="8" cy="23" r="6" fill="#f3af37"/><circle cx="23" cy="23" r="6" fill="#d86989"/>',
        'electronics': '<path d="M3 5h26v6H19v19h-7V11H3z" fill="#1750a1"/>',
        'courier': '<path d="M2 5h20l9 9-9 12H2l10-12z" fill="#bd2836"/><path d="M5 12h12M3 17h10" stroke="white" stroke-width="2"/>',
        'parking': '<path d="M4 2h24v20L16 31 4 22z" fill="#214d75"/><path d="M11 23V8h7a5 5 0 0 1 0 10h-7m0-6h7" fill="none" stroke="white" stroke-width="2"/>',
        'bank': '<path d="M3 27 16 3l13 24H3Z" fill="none" stroke="#203f58" stroke-width="2"/><path d="m9 27 7-13 7 13" fill="none" stroke="#203f58" stroke-width="2"/>',
        'tea': '<path d="M16 30V13M16 23C2 24 2 10 5 6c14 0 13 11 11 17ZM16 18C29 18 31 5 28 2c-12 0-14 10-12 16Z" fill="none" stroke="#4a5944" stroke-width="1.3"/>',
        'coffee': '<ellipse cx="16" cy="16" rx="10" ry="14" transform="rotate(30 16 16)" fill="#574334"/><path d="M21 4c-13 8 0 16-11 25" fill="none" stroke="#f8f6f2" stroke-width="1.5"/>',
        'mail': '<rect x="2" y="6" width="28" height="21" rx="2" fill="none" stroke="#335779" stroke-width="2"/><path d="m3 8 13 10L29 8" fill="none" stroke="#335779" stroke-width="2"/>',
        'housing': '<path d="m3 15 13-11 13 11M7 12v17h18V12M13 29V18h7v11" fill="none" stroke="#476c81" stroke-width="2"/>',
        'invoice': '<path d="M4 29V10l12-7 12 7v19M4 15h24M10 29V19h12v10" fill="none" stroke="#4f5d67" stroke-width="2"/>',
        'tickets': '<path d="M2 8h28v6a4 4 0 0 0 0 8v5H2v-5a4 4 0 0 0 0-8z" fill="none" stroke="#273d53" stroke-width="2"/><path d="M21 9v17" stroke="#273d53" stroke-dasharray="2 2"/>',
        'rewards': '<path d="M4 12h24v17H4zM2 8h28v6H2zM16 8v21M16 8C3 9 6-4 16 8c10-12 13 1 0 0" fill="none" stroke="#cc3e20" stroke-width="2"/>',
    }
    return '<svg class="brand-symbol" viewBox="0 0 32 32" aria-hidden="true">'+parts.get(theme,parts['electronics'])+'</svg>'

def style_page(name, html):
    if name not in SPECS or 'data-visual-version="2"' in html:
        return html
    theme, utility, menu = SPECS[name]
    html = html.replace('</head>', '<link rel="stylesheet" href="scenario-design.css"></head>', 1)
    html = html.replace('<body>', f'<body class="{theme}" data-visual-version="2">', 1)
    html = re.sub(r'(<a class="logo"[^>]*>)<i>.*?</i>', lambda m: m[1]+symbol(theme), html, count=1, flags=re.S)
    util = f'<div class="utility"><div class="in"><span>{utility}</span><span class="right"><span>Помощь</span><span>Личный кабинет</span></span></div></div>\n'
    html = html.replace('<div class="bar">', util+'<div class="bar">', 1)
    if menu:
        strip = '<div class="catalog-strip"><div class="in">'+''.join('<span>'+v+'</span>' for v in menu)+'</div></div>\n'
        html = html.replace('<div class="sub">', strip+'<div class="sub">', 1)
    if theme == 'bank':
        nav = '<nav class="account-nav"><span>Обзор</span><span>История</span><span>Документы</span><span class="selected">Обращения</span><span>Настройки</span></nav>\n'
        html = html.replace('<div class="page">', nav+'<div class="page">',1)
        html = html.replace('</aside>', '<div class="support-meta"><strong>Сопровождение обращения</strong>Идентификация пройдена<br>Канал: интернет-банк</div></aside>',1)
    if theme == 'mail':
        nav='<nav class="mail-nav"><b>Написать</b><span class="selected">Входящие</span><span>Отправленные</span><span>Черновики</span><span>Архив</span><span>Корзина</span></nav>\n'
        html=html.replace('<div class="page">',nav+'<div class="page">',1)
        html=html.replace('<p class="muted">От:', '<div class="paper-toolbar"><span>← Назад</span><span>Ответить</span><span>Переслать</span><span>В архив</span><span>···</span></div>\n  <p class="muted">От:',1)
        html=html.replace('<p class="lead">','<div class="email-brand">СЕВЕРНЫЙ</div><p class="lead">',1)
    if name=='seller-payout.html':
        html=html.replace('<div class="page">','<div class="page payout-page">',1)
    if name in ['delivery.html','tea-shop-skimmer.html','bitb-login.html']:
        flow='<div class="workflow"><span>Оформление</span><b>Подтверждение</b><span>Завершение</span></div>'
        html=html.replace('<h1>',flow+'<h1>',1)
    if name=='courier-code.html':
        flow='<div class="workflow"><span>Принято</span><span>В пути</span><b>У курьера</b></div>'
        html=html.replace('<span class="chip amber">',flow+'<span class="chip amber">',1)
    if theme in ['invoice','housing','parking','tickets']:
        label={'invoice':'Электронный счёт','housing':'Начисления за расчётный период','parking':'Уведомление о задолженности','tickets':'Проверка соединения'}[theme]
        html=html.replace('<h1>','<div class="context-label">'+label+'</div><h1>',1)
    if theme=='invoice':
        html=html.replace('<div class="context-label">','<div class="paper-toolbar"><span>← К списку документов</span><span>Версия для печати</span></div><div class="paper-heading"><b>СТРОЙКОМПЛЕКТ</b><small>Отдел продаж<br>Документы клиента</small></div><div class="context-label">',1)
        html=html.replace('</section>','<div class="doc-stamp">Электронный документ · экземпляр покупателя</div></section>',1)
    if theme=='housing':
        html=html.replace('<div class="context-label">','<div class="paper-toolbar"><span>← Все квитанции</span><span>Версия для печати</span></div><div class="context-label">',1)
    if name=='bank-app-nfc.html':
        html=html.replace('<span class="chip red">','<img class="app-art" src="img/bank-app.svg" alt=""><span class="chip red">',1)
    if name=='bitb-login.html':
        html=html.replace('<div style="position:fixed;','<div class="browser-window" style="position:fixed;',1)
    if name=='prize-clickjacking.html':
        html=re.sub(r'<div style="width:240px;height:240px;.*?</div>', '<img class="prize-wheel" src="img/prize-wheel.svg" alt="Колесо розыгрыша">',html,count=1)
        html=html.replace('🎁 Вам доступна','Вам доступна')
    art={'delivery.html':['bicycle'],'marketplace-transfer.html':['phone'],'bitb-login.html':['earbuds'],'shoe-shop-overlay.html':['shoe'],'tea-shop-skimmer.html':['tea-tin','tea-pouch'],'honest-shop.html':['coffee-bag']}.get(name,[])
    it=iter(art)
    def replace_thumb(match):
        asset=next(it,None)
        return '<div class="thumb"><img src="img/'+asset+'.svg" alt=""></div>' if asset else match[0]
    html=re.sub(r'<div class="thumb"[^>]*>[^<]*</div>',replace_thumb,html)
    return html

def make_artwork():
    images={
        'bicycle':'<g fill="none" stroke="#30383d" stroke-width="3"><circle cx="48" cy="110" r="28"/><circle cx="150" cy="110" r="28"/><path d="m48 110 35-57 26 57H48l27-41h63l12 41M105 110l34-66h12M75 53h22"/><path d="m80 69 27 41" stroke="#617d65" stroke-width="7"/></g><path d="M72 48h27v5H72z" fill="#292929"/>',
        'phone':'<rect x="61" y="18" width="80" height="126" rx="11" fill="#3b3e42"/><rect x="67" y="23" width="68" height="115" rx="7" fill="#667171"/><path d="m67 23 68 115H67z" fill="#48585d"/><rect x="84" y="26" width="34" height="7" rx="4" fill="#202426"/><rect x="37" y="31" width="74" height="121" rx="10" fill="#696b6d" stroke="#c3c4c2"/><rect x="43" y="37" width="31" height="33" rx="6" fill="#5c5e61"/><g fill="#181e24" stroke="#999"><circle cx="51" cy="46" r="6"/><circle cx="65" cy="58" r="6"/><circle cx="51" cy="61" r="6"/></g>',
        'earbuds':'<path d="M49 88c0-21 104-21 104 0v30c0 30-104 30-104 0z" fill="#e5e7e7" stroke="#c3c7c8"/><ellipse cx="101" cy="89" rx="52" ry="18" fill="#f5f5f5" stroke="#d1d4d5"/><path d="M69 27c-22-2-24 26-7 31v28c0 12 13 12 13 0V44c0-10 0-16-6-17ZM129 27c22-2 24 26 7 31v28c0 12-13 12-13 0V44c0-10 0-16 6-17Z" fill="#f5f6f6" stroke="#cbd0d0"/><ellipse cx="65" cy="39" rx="5" ry="8" fill="#4c5252"/><ellipse cx="133" cy="39" rx="5" ry="8" fill="#4c5252"/>',
        'shoe':'<path d="m31 99 28-12 12-39 29 10 18 23 38 10 22 20-2 18H28Z" fill="#e6e1d7" stroke="#77746e" stroke-width="2"/><path d="m72 50 26 12-12 31-33-5Z" fill="#b1a995"/><path d="m31 110 76 1 58-7 13 8-2 17H28Z" fill="#f9f8f4" stroke="#77746e" stroke-width="2"/><path d="m99 73-19 7m26 2-21 7m27 2-21 7" stroke="#fff" stroke-width="4"/><path d="m118 104 25-5" stroke="#535750" stroke-width="4"/>',
        'tea-tin':'<ellipse cx="100" cy="36" rx="40" ry="12" fill="#737966"/><path d="M60 36v103c0 17 80 17 80 0V36" fill="#53614e"/><ellipse cx="100" cy="36" rx="40" ry="10" fill="#72806b" stroke="#44523e"/><path d="M67 61h66v57H67z" fill="#f2eddd"/><text x="100" y="85" text-anchor="middle" font-family="Georgia" font-size="16" fill="#4b5140">TEA</text><path d="M80 96h40M86 103h28" stroke="#a9a28c"/>',
        'tea-pouch':'<path d="m65 26 70 0 10 118-90 0z" fill="#b7a689" stroke="#998a70"/><path d="M66 32h68M64 40h72" stroke="#665b49"/><rect x="66" y="65" width="68" height="54" fill="#f7f0dc"/><text x="100" y="89" text-anchor="middle" font-size="14" font-family="Georgia" fill="#5c5e40">OOLONG</text><path d="M82 103h36" stroke="#9e9c78"/>',
        'coffee-bag':'<path d="m63 19 76 0-5 20 14 109-94 0 14-109z" fill="#bba88b" stroke="#a08e71"/><path d="M64 25h74M69 39h64" stroke="#79664d"/><rect x="66" y="67" width="68" height="66" fill="#f4eee3"/><text x="100" y="91" text-anchor="middle" font-family="Georgia" font-size="17" fill="#4d3e30">ЗЕРНО</text><text x="100" y="113" text-anchor="middle" font-family="Arial" font-size="8" fill="#79624b">COLOMBIA</text>',
        'bank-app':'<rect x="48" y="17" width="104" height="130" rx="18" fill="#e2e9ed"/><path d="m72 114 28-66 28 66H72Z" fill="none" stroke="#2a465b" stroke-width="5"/><path d="m87 114 13-31 13 31" fill="none" stroke="#2a465b" stroke-width="5"/>',
    }
    for name,body in images.items():
        (OUT/'img'/f'{name}.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 170">'+body+'</svg>',encoding='utf-8')
    pieces=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><circle cx="150" cy="150" r="138" fill="#f2ead9" stroke="#384d45" stroke-width="8"/>']
    for i in range(8):
        a,b=math.radians(i*45-90),math.radians((i+1)*45-90)
        x,y=150+132*math.cos(a),150+132*math.sin(a);xx,yy=150+132*math.cos(b),150+132*math.sin(b)
        fill='#384d45' if i%2==0 else '#efe7d4'
        pieces.append(f'<path d="M150 150L{x} {y}A132 132 0 0 1 {xx} {yy}Z" fill="{fill}"/>')
        angle=i*45+22.5-90;mid=math.radians(angle);tx,ty=150+91*math.cos(mid),150+91*math.sin(mid)
        text='ПРИЗ' if i%2==0 else 'БОНУС'
        pieces.append(f'<text x="{tx}" y="{ty}" fill="'+('#f9f2e2' if i%2==0 else '#384d45')+f'" font-size="12" font-family="Arial" text-anchor="middle" transform="rotate({angle+90} {tx} {ty})">{text}</text>')
    pieces.append('<circle cx="150" cy="150" r="26" fill="#f5eee1" stroke="#c4bba9"/><path d="m139 7 11 22 11-22" fill="#c3462c"/></svg>')
    (OUT/'img/prize-wheel.svg').write_text(''.join(pieces),encoding='utf-8')

if __name__ == '__main__':
    make_artwork()
    for name in SPECS:
        path=OUT/name
        path.write_text(style_page(name,path.read_text(encoding='utf-8')),encoding='utf-8')
    print('Обновлено оформление страниц:',len(SPECS))
