(function(root) {
  'use strict';
  function amounts(text) {
    const result=[]; const re=/(\d[\d\s\u00a0]{0,12}(?:[,.]\d{1,2})?)\s*(₽|руб(?:\.|лей|ля)?|RUB|EUR|€|USD|\$)/gi;
    for(const m of String(text||'').matchAll(re)){
      const number=Number(m[1].replace(/[\s\u00a0]/g,'').replace(',','.'));
      if(Number.isFinite(number) && number>0) result.push({value:number,currency:/₽|руб|RUB/i.test(m[2])?'RUB':/EUR|€/i.test(m[2])?'EUR':'USD'});
      if(result.length>=20) break;
    }
    return result;
  }
  function mask(s) {let d=String(s||'').replace(/\D/g,'');return d.length>=10 ? '•••• '+d.slice(-4) : null}
  function transfer(text) {
    const s=String(text||'').slice(0,12000);
    const requested=/(переведите|перевести|перевод|зайдите в.{0,30}банк)/i.test(s);
    const card=/(?:\d[\s-]*){13,19}/g;
    let matches=[...s.matchAll(card)].map(m=>mask(m[0])).filter(Boolean);
    const unique=[...new Set(matches)].slice(0,5);
    return {requested, maskedRecipients:unique, amounts:amounts(s)};
  }
  function decodePaymentLink(raw) {
    const input=String(raw||'').trim().slice(0,4096);
    if(!input) return {status:'unknown',reason:'QR или ссылка не содержит доступных данных.'};
    if(input.startsWith('ST00012') || input.startsWith('ST00011')) {
      const result={status:'parsed',format:'Платёжная строка ST',amount:null,currency:'RUB',recipient:null};
      for(const pair of input.split('|').slice(1)){
        const pos=pair.indexOf('=');if(pos<0)continue;
        const key=pair.slice(0,pos),value=pair.slice(pos+1);
        if(key==='Sum' && /^\d+$/.test(value)) result.amount=Number(value)/100;
        if(key==='Name') result.recipient=value.slice(0,100);
      }
      return result;
    }
    try {
      const url=new URL(input);
      if(!['https:','http:'].includes(url.protocol)) return {status:'unknown',reason:'Неизвестная схема ссылки; назначение не установлено.'};
      const p=url.searchParams, rawAmount=p.get('sum')||p.get('amount');
      const value=rawAmount!==null && /^\d+(?:[.,]\d+)?$/.test(rawAmount)?Number(rawAmount.replace(',','.')):null;
      const currency=p.get('currency')||null;
      // A generic URL is not classified as SBP and units of sum are not assumed.
      return {status:'partial',format:'Ссылка',host:url.hostname,amount:value,currency,
        reason:'Единицы суммы, назначение и получатель ссылки не подтверждены.'};
    } catch {return {status:'unknown',reason:'Формат содержимого не распознан.'}}
  }
  function compare(page, payment) {
    if(!payment || payment.status!=='parsed' || payment.amount==null || !payment.currency) return {status:'unknown',reason:'Недостаточно надёжных данных для сравнения.'};
    const candidates=amounts(page).filter(x=>x.currency===payment.currency);
    if(!candidates.length)return {status:'unknown',reason:'Сумма в той же валюте на странице не найдена.'};
    if(candidates.some(x=>Math.abs(x.value-payment.amount)<0.01))return {status:'match',reason:'Одна из сумм страницы совпадает с суммой платёжной строки.'};
    return {status:'mismatch',reason:'Сумма платёжной строки отличается от найденных сумм страницы; проверьте контекст.'};
  }
  root.PaymentDetails={amounts,transfer,decodePaymentLink,compare};
  if(typeof module !== 'undefined')module.exports=root.PaymentDetails;
})(typeof globalThis!=='undefined'?globalThis:this);
