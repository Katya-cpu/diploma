/* Run manually on the other computer: node tests/analyzer.cjs */
const assert=require('node:assert/strict');
const analyzer=require('../shared/analyzer.js');
const details=require('../shared/payment-details.js');
const bank=require('../shared/bank.js');

assert.equal(analyzer.analyze({text:'Новая коллекция'}).status,'unknown');
assert.equal(analyzer.analyze({text:'Оплата заказа',hasCard:true}).status,'notice');
assert.equal(analyzer.analyze({text:'Переведите деньги по номеру карты получателя'}).status,'warning');
assert.equal(analyzer.analyze({text:'Чтобы получить деньги, оплатите комиссию'}).status,'warning');
assert.equal(analyzer.analyze({text:'Чтобы получить деньги',hasCvv:true}).status,'warning');
assert.equal(analyzer.analyze({text:'Переведите по номеру телефона получателя'}).status,'warning');
assert.equal(analyzer.analyze({text:'Войти',misleadingControl:true}).status,'warning');
assert.equal(analyzer.analyze({text:'Оплата',amountMismatch:true}).status,'warning');
assert.equal(details.compare('Итого 100 ₽',details.decodePaymentLink('ST00012|Name=Учебный магазин|Sum=10000')).status,'match');
assert.equal(details.compare('Итого 200 ₽',details.decodePaymentLink('ST00012|Name=Учебный магазин|Sum=10000')).status,'mismatch');
assert.equal(details.decodePaymentLink('not a payment').status,'unknown');
const history=[{time:10,sender:'A',recipient:'R',amount:10},{time:30,sender:'B',recipient:'R',amount:20}];
assert.equal(bank.evaluate(history,{time:20,recipient:'R',amount:10}).count,1);
assert.equal(bank.evaluate(history,{time:9,recipient:'R',amount:10}).status,'unknown');
console.log('Basic shared-rule checks passed. Browser behaviour remains to be checked manually.');
