(() => {
  'use strict';
  const scenarios=window.ScenarioCatalog;
  const select=document.getElementById('fixture'), frame=document.getElementById('preview'),run=document.getElementById('run');
  scenarios.forEach(({file,title})=>{const o=document.createElement('option');o.value=file;o.textContent=title;select.append(o)});
  let observer,version=0;
  function load(){const n=++version,record=scenarios.find(x=>x.file===select.value);observer=null;run.disabled=true;
    document.getElementById('description').textContent=record.kind;
    document.getElementById('check-data').textContent=record.data;document.getElementById('check-method').textContent=record.method;document.getElementById('check-limit').textContent=record.limit;
    const evidence=document.getElementById('check-source');evidence.hidden=!record.source;if(record.source)evidence.href=record.source;
    document.getElementById('standalone').href='/fixtures/'+record.file;document.getElementById('status').textContent='Загрузка учебной страницы…';document.getElementById('reasons').replaceChildren();document.getElementById('limits').textContent='';frame.src='/fixtures/'+record.file;frame.dataset.version=String(n)}
  function script(doc,src){return new Promise((resolve,reject)=>{const node=doc.createElement('script');node.src=src;node.onload=resolve;node.onerror=reject;doc.head.append(node)})}
  frame.onload=async()=>{const n=Number(frame.dataset.version);try{
    const doc=frame.contentDocument;
    for(const path of ['/shared/payment-details.js?v=20261030-2','/shared/analyzer.js?v=20261030-2','/shared/page-observer.js?v=20261030-2','/vendor/jsQR.js?v=20261030-2','/qr-reader.js?v=20261030-2'])await script(doc,path);
    if(n!==version)return;observer=frame.contentWindow.PageObserver.create();run.disabled=false;document.getElementById('status').textContent='Страница готова. Нажмите «Проверить страницу».';
  }catch{document.getElementById('status').textContent='Не удалось загрузить анализатор. Перезапустите лабораторию.'}};
  select.onchange=load;
  run.onclick=async()=>{if(!observer)return;run.disabled=true;try{
    const w=frame.contentWindow,obs=observer.collect();
    if(obs.hasQr){for(const image of [...w.document.images].slice(0,5)){
      if(!image.complete||image.naturalWidth<80||image.naturalHeight<80)continue;
      const raw=await w.LocalQr.decode(image).catch(()=>null);if(!raw)continue;
      const payment=w.PaymentDetails.decodePaymentLink(raw),comparison=w.PaymentDetails.compare(obs.text,payment);
      obs.qrMismatch=comparison.status==='mismatch';obs.qrChecked=comparison.status==='match';obs.qrSbp=payment.format==='Ссылка, похожая на формат СБП';obs.qrSubscription=!!payment.subscriptionHost;obs.qrInsecure=payment.protocol==='http:';break;
    }}
    const result=w.PaymentAnalyzer.analyze(obs);document.getElementById('status').textContent={warning:'Есть признаки для проверки',notice:'Есть информационные признаки',unknown:'Признаки не обнаружены; безопасность неизвестна'}[result.status];
    const list=document.getElementById('reasons');list.replaceChildren(...result.reasons.map(reason=>{const li=document.createElement('li');li.textContent=reason.message;return li}));
    document.getElementById('limits').textContent=result.limitations.join(' ');
  }catch{document.getElementById('status').textContent='Проверка не завершилась. Обновите страницу и повторите.'}finally{run.disabled=false}};
  load();
})();
