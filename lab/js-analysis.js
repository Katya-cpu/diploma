(() => {
  const button=document.getElementById('js-analyze'),output=document.getElementById('js-result');
  button.onclick=async()=>{
    const source=document.getElementById('js-code').value;
    if(!source){output.textContent='Введите учебный код.';return}
    button.disabled=true;
    try {
      const response=await fetch('/api/inspect-js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})});
      const result=await response.json();
      if(result.status!=='ok'){output.textContent=result.reason;return}
      const labels={network_call:'Сетевой вызов',dom_selector_call:'Обращение к элементу страницы',dynamic_code_call:'Динамическое выполнение',html_insertion:'Вставка HTML'};
      const facts=result.analysis.facts.map(f=>`${labels[f.kind]||f.kind}: ${f.name}, строка ${f.line}`);
      output.textContent=`Способ: ${result.analysis.method}\n\n${facts.length?facts.join('\n'):'Из поддерживаемых признаков ничего не найдено.'}\n\n${result.analysis.limitations.join('\n')}\n\nМодель: ${result.model.reason||result.model.note||'результат недоступен'}`;
    } catch {output.textContent='Пассивный анализ недоступен.'}
    button.disabled=false;
  };
})();
