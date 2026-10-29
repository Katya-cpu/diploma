document.getElementById('start').onclick=()=>{
  const target=document.getElementById('result');if(target.childElementCount)return;
  const label=document.createElement('label');label.textContent='Номер карты (учебный)';const field=document.createElement('input');field.autocomplete='cc-number';field.placeholder='номер карты';label.append(field);target.append(label);
};
