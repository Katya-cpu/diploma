(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  function graph(history,recipient,cut){
    const svg=$('bank-graph'),ns='http://www.w3.org/2000/svg';svg.replaceChildren();
    const inputs=history.filter(x=>x.recipient===recipient&&x.time<cut).slice(-16);
    function element(name,attrs){const e=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e}
    const center={x:300,y:150};
    inputs.forEach((t,i)=>{const angle=2*Math.PI*i/Math.max(inputs.length,1),x=center.x+200*Math.cos(angle),y=center.y+110*Math.sin(angle);svg.append(element('line',{x1:x,y1:y,x2:center.x,y2:center.y,stroke:'#a8bdb1','stroke-width':2}));svg.append(element('circle',{cx:x,cy:y,r:17,fill:'#dbeae0'}));const text=element('text',{x,y:y+4,'text-anchor':'middle','font-size':11});text.textContent=t.sender.slice(0,8);svg.append(text)});
    svg.append(element('circle',{cx:center.x,cy:center.y,r:27,fill:'#17614e'}));const label=element('text',{x:center.x,y:center.y+4,'text-anchor':'middle','font-size':11,fill:'white'});label.textContent=recipient.slice(0,8);svg.append(label);
  }
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
      graph(history,request.recipient,request.time);
      const decision=r.status==='notice'?'продолжить':r.status==='warning'?'приостановить':'не определено — недостаточно истории';
      $('bank-form-result').textContent=`Учебное решение: ${decision}\nПредыдущих переводов: ${r.count}\n${r.warnings.join('\n')}\n${r.note||''}`;
    }catch(e){$('bank-form-result').textContent='Не удалось обработать учебную историю: '+e.message}
  };
  $('graph-evaluate').onclick=async()=>{
    try{
      const history=JSON.parse($('bank-data').value);
      if(!Array.isArray(history)||history.length>500)throw Error('Нужен массив до 500 учебных переводов.');
      const request={time:Number($('bank-time').value),recipient:$('bank-recipient').value.slice(0,32),amount:Number($('bank-amount').value)};
      const response=await fetch('/api/graph-score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({history,request})});
      const result=await response.json();
      if(result.status!=='hypothesis'){$('bank-form-result').textContent=result.reason||'Учебная модель недоступна.';return}
      const decision={suspend:'приостановить',proceed:'продолжить',unknown:'не определено — порог не выбран'}[result.decision]||'не определено';
      $('bank-form-result').textContent=`Решение учебной модели: ${decision}\nВыход модели: ${result.score.toFixed(3)}\nПорог: ${result.threshold===null?'нет':result.threshold}\nПереводов до заявки: ${result.count_before}\n${result.note}`;
    }catch(e){$('bank-form-result').textContent='Не удалось выполнить учебный графовый анализ.'}
  };
})();
