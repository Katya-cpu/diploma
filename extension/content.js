(() => {
  'use strict';
  // No input values are inspected or saved. Exception is bound to the exact origin.
  const origin = location.origin;
  const isTopFrame = window === window.top;
  let lastKey = '', timer;
  const dismissedCodes = new Set();
  const qrCache = new WeakMap();
  const sessionEvents = [];
  async function saveEvent(kind,codes) {
    try {await browser.runtime.sendMessage({type:'record-event',kind,codes})} catch {}
  }
  function eventName(e) {
    const target=e.target;
    if(!(target instanceof HTMLInputElement) || !cardPattern.test([target.autocomplete,target.name,target.id,target.placeholder,target.getAttribute('aria-label')].join(' ')))return;
    // Never read e.data, key presses or target.value; do not persist the event log.
    sessionEvents.push({kind:e.type,time:new Date().toLocaleTimeString()});
    if(sessionEvents.length>15)sessionEvents.shift();
    if(e.type==='focusin')inspect();
  }
  const cardPattern = /cc-number|card.?number|номер карты|номер банковской карты/i;
  const paymentPattern = /оплатить|оплата|перевести|перевод|платн.{0,30}подписк|оформить подписку|pay now|checkout|purchase/i;
  const pageObserver=PageObserver.create();
  async function inspectQr(obs) {
    try {
      const images=[...document.images].filter(i=>i.complete && i.naturalWidth>=80 && i.naturalHeight>=80).slice(0,5);
      for(const img of images){
        // Cross-origin pixels may be unreadable; do not fetch images or transmit their content.
        let entry=qrCache.get(img);if(!entry||entry.src!==img.currentSrc){const raw=await LocalQr.decode(img).catch(()=>null);entry={src:img.currentSrc,raw};qrCache.set(img,entry)}
        if(!entry.raw)continue;
        obs.hasQr=true;const payment=PaymentDetails.decodePaymentLink(entry.raw);
        const comparison=PaymentDetails.compare(obs.text,payment);
        const reputation=await browser.storage.local.get('reportedHosts');
        obs.qrReported=PaymentDetails.checkRecipient(payment,reputation.reportedHosts).status==='reported';
        obs.qrInsecure=payment.protocol==='http:';
        obs.qrSbp=payment.format==='Ссылка, похожая на формат СБП';obs.qrSubscription=!!payment.subscriptionHost;
        obs.qrMismatch=comparison.status==='mismatch';obs.qrChecked=comparison.status==='match';break;
      }
    }catch{}
  }
  async function inspect(force = false) {
    if (!document.body) return;
    const obs = pageObserver.collect();
    const rep = await browser.storage.local.get('reportedHosts');
    const paymentContext=obs.hasCard||obs.hasPaymentButton||/(переведите|перевод|оплатите|по номеру карты)/i.test(obs.text);
    obs.reputationReported = !!(paymentContext && rep.reportedHosts && Object.prototype.hasOwnProperty.call(rep.reportedHosts,location.hostname.toLowerCase()) && rep.reportedHosts[location.hostname.toLowerCase()]);
    if(force||obs.hasQr)await inspectQr(obs);
    const result = PaymentAnalyzer.analyze(obs);
    if(obs.hasCard || obs.hasPaymentButton)browser.runtime.sendMessage({type:'payment-context'}).catch(()=>{});
    const warnings = result.reasons.filter(r => r.severity === 'warning');
    const storage = await browser.storage.local.get('ordinaryExceptions');
    const exceptions = storage.ordinaryExceptions || {};
    const ordinaryDisabled = isTopFrame && !!exceptions[origin];
    const eligible = ordinaryDisabled ? warnings : result.reasons;
    const shown = force ? eligible : eligible.filter(r=>!dismissedCodes.has(r.code));
    const key = shown.map(r=>r.code).join(',');
    if ((!key && !force) || (!force && key === lastKey)) return;
    lastKey = key;
    document.querySelector('#payment-study-notice')?.remove();
    if (!shown.length && !force) return;
    if(warnings.length && !force)saveEvent('warning',warnings.map(r=>r.code));
    const host = document.createElement('div'); host.id='payment-study-notice';
    const shadow=host.attachShadow({mode:'closed'}), box=document.createElement('section');
    box.setAttribute('role','status');
    box.style.cssText='position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:380px;background:#fff;color:#18202a;padding:18px;border:2px solid #a96c08;border-radius:12px;box-shadow:0 4px 20px #0004;font:15px/1.45 system-ui';
    const title=document.createElement('strong'); title.textContent=warnings.length?'Найдены признаки для проверки':'Платёжный помощник'; box.append(title);
    const list=document.createElement('ul');
    shown.forEach(r=>{const li=document.createElement('li');li.textContent=r.message;list.append(li)});
    if (!shown.length) {const li=document.createElement('li');li.textContent=ordinaryDisabled && result.reasons.length?'Обычные уведомления для этого сайта отключены. Новых признаков угроз правила не обнаружили.':'Доступные признаки не найдены. Безопасность не установлена.';list.append(li)}
    box.append(list);
    if(obs.hasCard){
      const locate=document.createElement('button');locate.type='button';locate.textContent='Показать поле карты';
      locate.onclick=()=>{const field=[...document.querySelectorAll('input')].find(e=>cardPattern.test([e.autocomplete,e.name,e.id,e.placeholder,e.getAttribute('aria-label')].join(' ')));if(!field)return;shown.forEach(r=>dismissedCodes.add(r.code));host.remove();field.scrollIntoView({behavior:'smooth',block:'center'});const old=field.style.outline;field.style.outline='3px solid #e06b00';setTimeout(()=>{field.style.outline=old},5000)};
      box.append(locate);
    }
    const note=document.createElement('p');note.textContent='Учебный прототип не блокирует ввод и не гарантирует безопасность. Встроенные формы и скрипты могут быть недоступны.';box.append(note);
    if(sessionEvents.length){const p=document.createElement('p');p.textContent=`Событий в текущей вкладке: ${sessionEvents.length}. Регистрируются только тип и время, без содержимого.`;box.append(p)}
    if(force){
      browser.runtime.sendMessage({type:'destinations'}).then(data=>{
        const p=document.createElement('p');p.textContent=data?.origins?.length?'Сетевые адреса после обнаружения оплаты: '+data.origins.join(', '):'Нет сведений о сетевых адресах после обнаружения оплаты.';box.append(p);
      }).catch(()=>{});
    }
    if (isTopFrame && (obs.hasCard || obs.hasPaymentButton || obs.personalTypes.length)) {
      const label=document.createElement('label'), check=document.createElement('input');
      check.type='checkbox';check.checked=!!exceptions[origin];label.append(check,document.createTextNode(' Не показывать обычное уведомление для этого сайта'));box.append(label);
      check.addEventListener('change',async()=>{const s=await browser.storage.local.get('ordinaryExceptions');const data=s.ordinaryExceptions||{};if(check.checked)data[origin]=true;else delete data[origin];await browser.storage.local.set({ordinaryExceptions:data});});
      const desc=document.createElement('p');desc.textContent='Предупреждения о найденных признаках угроз это не отключает.';box.append(desc);
    }
    const close=document.createElement('button');close.type='button';close.textContent='Закрыть';close.onclick=()=>{shown.forEach(r=>dismissedCodes.add(r.code));saveEvent('closed',[]);host.remove()};box.append(close);
    shadow.append(box);document.documentElement.append(host);
  }
  browser.runtime.onMessage.addListener(message=>{if(message && message.type==='show-analysis'){inspect(true);return Promise.resolve({received:true})}});
  document.addEventListener('focusin',eventName,true);
  document.addEventListener('input',eventName,true);
  document.addEventListener('change',eventName,true);
  inspect();
  const observer=new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('#payment-study-notice')))return;clearTimeout(timer);timer=setTimeout(()=>inspect(),500)});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['action','href','hidden','autocomplete','style','class']});
})();
