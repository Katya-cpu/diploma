(() => {
  'use strict';
  document.getElementById('ocr-run').onclick=async()=>{
    const file=document.getElementById('ocr-file').files?.[0],out=document.getElementById('ocr-result');
    if(!file){out.textContent='Выберите учебное изображение.';return}
    if(file.size>2500000){out.textContent='Размер изображения ограничен 2,5 МБ.';return}
    try{
      const reader=new FileReader();const encoded=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});
      const response=await fetch('/api/ocr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:encoded})});
      const data=await response.json();out.textContent=data.status==='ok'?data.text+'\n\n'+data.note:data.reason;
      if(data.status==='ok'){
        document.getElementById('custom-text').value=data.text;
        const visible=PaymentDetails.amounts(data.text),dom=PaymentDetails.amounts(document.getElementById('scenario-copy').textContent);
        let comparison='Сопоставление не выполнено: на одной из сторон нет однозначной суммы.';
        if(visible.length===1 && dom.length===1 && visible[0].currency===dom[0].currency){
          comparison=visible[0].value===dom[0].value?'Единственные найденные суммы совпадают.':'Единственные найденные суммы различаются; проверьте контекст.';
        }
        out.textContent+='\n\nСравнение OCR и текста учебной страницы: '+comparison+' Это не проверка подмены формы.';
      }
    }catch{out.textContent='Не удалось обработать изображение локально.'}
  };
})();
