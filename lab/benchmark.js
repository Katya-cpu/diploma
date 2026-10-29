/* Explicitly fictional cases: exercise the rules, not a scientific benchmark. */
const examples=[
 {type:'suspect',text:'Переведите деньги по номеру карты получателя'},
 {type:'suspect',text:'Для получения денег оплатите комиссию'},
 {type:'suspect',text:'Срочно оплатите заказ, иначе его отменят',button:true},
 {type:'suspect',text:'Зайдите в банк и переведите по номеру карты'},
 {type:'suspect',text:'Получите деньги после того, как оплатите комиссию'},
 {type:'ordinary',text:'Выберите товар из каталога'},
 {type:'ordinary',text:'Итого 500 рублей. Оплата покупки',card:true,button:true},
 {type:'ordinary',text:'Оформление заказа. Подтвердите доставку'},
 {type:'ordinary',text:'Новости магазина и условия доставки'},
 {type:'ordinary',text:'Оплатить подписку',button:true}
];
document.getElementById('benchmark-run').onclick=()=>{
 const count={suspect:0,ordinary:0,flaggedSuspect:0,flaggedOrdinary:0,unknown:0};
 const details=[];
 for(const c of examples){const result=PaymentAnalyzer.analyze({text:c.text,hasCard:!!c.card,hasPaymentButton:!!c.button});count[c.type]++;if(result.status==='warning')count[c.type==='suspect'?'flaggedSuspect':'flaggedOrdinary']++;if(result.status==='unknown')count.unknown++;details.push({scenario:c.type,status:result.status,codes:result.reasons.map(r=>r.code)})}
 document.getElementById('benchmark-result').textContent=JSON.stringify({count,details,note:'Искусственные текстовые примеры под этот прототип; результаты не отражают частоту ошибок на реальных сайтах.'},null,2);
};
