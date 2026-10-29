(() => {
  const button=document.getElementById('js-analyze'),output=document.getElementById('js-result');
  button.onclick=async()=>{
    const source=document.getElementById('js-code').value;
    if(!source){output.textContent='Введите учебный код.';return}
    button.disabled=true;
    try {
      const response=await fetch('/api/inspect-js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})});
      const result=await response.json();output.textContent=result.status==='ok'?JSON.stringify(result.analysis,null,2):result.reason;
    } catch {output.textContent='Пассивный анализ недоступен.'}
    button.disabled=false;
  };
})();
