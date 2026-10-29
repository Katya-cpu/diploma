(function(root){
  'use strict';
  function create(){
    const origin=location.origin;
    let previousFormOrigins=null, formChanged=false;
    const cardPattern=/cc-number|card.?number|номер карты|номер банковской карты/i;
    const paymentPattern=/оплатить|оплата|перевести|перевод|платн.{0,30}подписк|оформить подписку|pay now|checkout|purchase/i;
  function collect() {
    const fields = [...document.querySelectorAll('input')];
    const cardFields = fields.filter(e => cardPattern.test([e.autocomplete,e.name,e.id,e.placeholder,e.getAttribute('aria-label')].join(' ')));
    const hasCard = cardFields.length>0;
    const hasCvv = fields.some(e=>/cc-csc|\bcvv\b|\bcvc\b|код безопасности|защитный код/i.test([e.autocomplete,e.name,e.id,e.placeholder,e.getAttribute('aria-label')].join(' ')));
    const buttons = [...document.querySelectorAll('button,input[type=submit],[role=button],a[href]')];
    const hasPaymentButton = buttons.some(e => paymentPattern.test([e.innerText,e.value,e.getAttribute('aria-label')].filter(Boolean).join(' ').slice(0,240)));
    const insecurePaymentLink=buttons.some(e=>{
      if(!(e instanceof HTMLAnchorElement) || !paymentPattern.test([e.innerText,e.getAttribute('aria-label')].filter(Boolean).join(' ').slice(0,240)))return false;
      try{return new URL(e.getAttribute('href'),location.href).protocol==='http:'}catch{return false}
    });
    const misleadingControl=buttons.some(e=>/войти|продолжить|принять|sign in|continue/i.test((e.innerText || e.value || '').slice(0,120)) && /оплат|платн|подписк|subscribe|purchase|payment/i.test((e.getAttribute('aria-label') || '').slice(0,160)));
    const hiddenFinancialControl=buttons.some(e=>{
      const label=[e.innerText,e.value,e.getAttribute('aria-label')].filter(Boolean).join(' ').slice(0,240);
      if(!paymentPattern.test(label))return false;
      const style=getComputedStyle(e),rect=e.getBoundingClientRect();
      return Number(style.opacity)<0.1 && style.visibility!=='hidden' && style.pointerEvents!=='none' && rect.width>8 && rect.height>8;
    });
    let insecureForm=false,externalForm=false,formDestinationUnknown=false,coveredControl=false;
    const formOrigins=[];
    for(const input of cardFields){
      const form=input.form, action=form?.getAttribute('action');
      if(!action) formDestinationUnknown=true;
      else try {const url=new URL(action,location.href);formOrigins.push(url.origin);if(url.protocol==='http:')insecureForm=true;if(url.origin!==origin)externalForm=true;} catch {formDestinationUnknown=true}
      const rect=input.getBoundingClientRect();
      if(rect.width>8 && rect.height>8 && rect.x>=0 && rect.y>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight){
        const top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        if(top && top.id!=='payment-study-notice' && top!==input && !input.contains(top) && !top.contains(input))coveredControl=true;
      }
    }
    for(const button of buttons.filter(e=>paymentPattern.test((e.innerText || e.value || e.getAttribute('aria-label') || '').slice(0,120)))){
      const rect=button.getBoundingClientRect();
      if(rect.width>8 && rect.height>8 && rect.x>=0 && rect.y>=0 && rect.right<=innerWidth && rect.bottom<=innerHeight){
        const top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
        if(top && top.id!=='payment-study-notice' && top!==button && !button.contains(top) && !top.contains(button))coveredControl=true;
      }
    }
    const hasQr=[...document.querySelectorAll('img,canvas')].some(e=>/\bqr\b|qr.?код|куар/i.test([e.alt,e.title,e.id,e.className].join(' ')));
    const pageText=(document.body?.innerText || '').slice(0,12000);
    const displayAmounts=PaymentDetails.amounts(pageText).filter(x=>x.currency==='RUB');
    const declared=fields.filter(e=>e.type==='hidden' && /^(amount_rub|sum_rub)$/i.test(e.name) && /^\d+(?:[.,]\d{1,2})?$/.test(e.value)).map(e=>Number(e.value.replace(',','.')));
    const amountMismatch=displayAmounts.length===1 && declared.length===1 && Math.abs(displayAmounts[0].value-declared[0])>=0.01;
    const fingerprint=[...new Set(formOrigins)].sort().join('|');
    if(previousFormOrigins!==null && fingerprint && fingerprint!==previousFormOrigins)formChanged=true;
    if(fingerprint)previousFormOrigins=fingerprint;
    return {text:pageText, hasCard, hasCvv, hasPaymentButton,insecurePaymentLink,misleadingControl,hiddenFinancialControl,insecureForm,externalForm,formDestinationUnknown,coveredControl,hasQr,amountMismatch,changedForm:formChanged};
  }
    return {collect};
  }
  root.PageObserver={create};
})(globalThis);
