(() => {
  'use strict';
  const result=document.getElementById('research-result');
  document.querySelectorAll('[data-research]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;result.textContent='Идёт учебный эксперимент. Это может занять несколько минут. Закрытие страницы не обязательно отменит обучение.';
    try {
      const response=await fetch('/api/research-demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:button.dataset.research})});
      const data=await response.json();result.textContent=data.status==='ok'?data.note+'\n\n'+data.output:data.reason;
    } catch {result.textContent='Запрос не завершён. Проверьте окно локального сервера.'}
    button.disabled=false;
  }));
  document.getElementById('score-text')?.addEventListener('click',async()=>{
    const out=document.getElementById('ml-result');
    try {
      const text=document.getElementById('custom-text').value;
      const response=await fetch('/api/score-text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const result=await response.json();out.textContent=result.status==='hypothesis'?`Учебная гипотеза: ${result.label}; выход модели: ${result.score.toFixed(3)}. ${result.note}`:result.reason;
    }catch{out.textContent='Локальная модель недоступна.'}
  });
  document.getElementById('context-text')?.addEventListener('click',async()=>{
    const out=document.getElementById('ml-result');out.textContent='Локальный анализ запущен; это может занять время.';
    try {
      const text=document.getElementById('custom-text').value;
      const response=await fetch('/api/context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const result=await response.json();out.textContent=JSON.stringify(result,null,2);
    }catch{out.textContent='Локальный языковой анализ недоступен.'}
  });
})();
