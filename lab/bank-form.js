(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  $('bank-data').value=JSON.stringify([
    {time:1000,sender:'A',recipient:'TEST',amount:500},
    {time:2000,sender:'B',recipient:'TEST',amount:700},
    {time:3000,sender:'C',recipient:'TEST',amount:1000}
  ],null,2);
  $('bank-evaluate').onclick=()=>{
    try{
      const raw=JSON.parse($('bank-data').value);
      if(!Array.isArray(raw)||raw.length>500)throw Error('Нужен массив из не более чем 500 записей.');
      const history=raw.map(x=>({time:Number(x.time),sender:String(x.sender||'').slice(0,32),recipient:String(x.recipient||'').slice(0,32),amount:Number(x.amount)}));
      if(history.some(x=>!Number.isFinite(x.time)||!Number.isFinite(x.amount)||x.amount<0||!x.sender||!x.recipient))throw Error('В каждой строке нужны time, sender, recipient и неотрицательная amount.');
      const request={time:Number($('bank-time').value),recipient:$('bank-recipient').value.slice(0,32),amount:Number($('bank-amount').value)};
      if(!Number.isFinite(request.time)||!request.recipient||!Number.isFinite(request.amount)||request.amount<0)throw Error('Укажите корректные данные заявки.');
      const r=BankDemo.evaluate(history,request);
      $('bank-form-result').textContent=JSON.stringify(r,null,2)+'\nУчебное решение: '+(r.status==='notice'?'исполнить':'приостановить');
    }catch(e){$('bank-form-result').textContent='Не удалось обработать учебную историю: '+e.message}
  };
  $('graph-evaluate').onclick=async()=>{
    try{
      const history=JSON.parse($('bank-data').value);
      if(!Array.isArray(history)||history.length>500)throw Error('Нужен массив до 500 учебных переводов.');
      const request={time:Number($('bank-time').value),recipient:$('bank-recipient').value.slice(0,32),amount:Number($('bank-amount').value)};
      const response=await fetch('/api/graph-score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({history,request})});
      $('bank-form-result').textContent=JSON.stringify(await response.json(),null,2);
    }catch(e){$('bank-form-result').textContent='Не удалось выполнить учебный графовый анализ.'}
  };
})();
