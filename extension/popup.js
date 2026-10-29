document.getElementById('show').addEventListener('click',async()=>{
  try {const [tab]=await browser.tabs.query({active:true,currentWindow:true});await browser.tabs.sendMessage(tab.id,{type:'show-analysis'});window.close()}
  catch {document.getElementById('status').textContent='Страница недоступна для анализа. Откройте обычную веб-страницу и повторите.'}
});
document.getElementById('qr-check').addEventListener('click',()=>{
  const parsed=PaymentDetails.decodePaymentLink(document.getElementById('qr-text').value);
  document.getElementById('qr-output').textContent=JSON.stringify(parsed,null,2);
});
document.getElementById('history').addEventListener('click',()=>browser.tabs.create({url:browser.runtime.getURL('history.html')}));
document.getElementById('settings').addEventListener('click',()=>browser.tabs.create({url:browser.runtime.getURL('settings.html')}));
document.getElementById('session-check').addEventListener('click',async()=>{
  const output=document.getElementById('session-output');
  try {
    const [tab]=await browser.tabs.query({active:true,currentWindow:true});const url=new URL(tab.url);
    if(!['https:','http:'].includes(url.protocol))throw new Error('Недоступная страница');
    const cookies=await browser.cookies.getAll({url:url.origin+'/'});
    const total=cookies.length,secure=cookies.filter(c=>c.secure).length,httpOnly=cookies.filter(c=>c.httpOnly).length;
    output.textContent=`Для корня текущего сайта найдено cookies: ${total}; Secure: ${secure}; HttpOnly: ${httpOnly}. Эти признаки сами по себе не устанавливают безопасность или назначение файлов. Другие пути могут быть не учтены.`;
  } catch {output.textContent='Аудит недоступен для этой страницы.'}
});
