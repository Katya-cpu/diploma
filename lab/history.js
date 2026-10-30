(() => {
  'use strict';
  const key='payment-lab-events-v1';
  const list=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]')}catch{return []}};
  const write=(event)=>{const data=list();data.push({time:new Date().toISOString(),event});localStorage.setItem(key,JSON.stringify(data.slice(-50)));render()};
  function render(){const view=document.getElementById('events-view');view.textContent=list().length?list().map(x=>`${x.time}: ${x.event}`).join('\n'):'Пока нет учебных событий.'}
  document.getElementById('custom-check')?.addEventListener('click',()=>write('Запущена проверка учебного текста'));
  document.getElementById('events-clear').addEventListener('click',()=>{localStorage.removeItem(key);render()});
  document.getElementById('events-download').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify({kind:'training-lab-events',events:list()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='payment-lab-events.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  render();
})();
