(() => {
  const button=document.getElementById('corpus-load'),list=document.getElementById('corpus-list');
  button.onclick=async()=>{
    try{
      const response=await fetch('/api/reviewed');const data=await response.json();list.replaceChildren();
      if(data.status!=='ok'){list.textContent=data.reason;return}
      const note=document.createElement('p');note.textContent=data.note;list.append(note);
      for(const item of data.items){
        const details=document.createElement('details'),summary=document.createElement('summary'),excerpt=document.createElement('p'),assessment=document.createElement('p');
        summary.textContent=`${item.id} · ${item.source} · метка источника: ${item.label}`;
        excerpt.textContent=item.text;
        const result=PaymentAnalyzer.analyze({text:item.text,hasCard:item.card_fields>0});
        assessment.textContent='Правила: '+result.status+'; основания: '+(result.reasons.map(x=>x.code).join(', ')||'нет');
        details.append(summary,excerpt,assessment);list.append(details);
      }
    }catch{list.textContent='Не удалось прочитать локальный индекс.'}
  };
})();
