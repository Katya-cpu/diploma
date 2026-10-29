(() => {
  const $=id=>document.getElementById(id);let pending=false,version=0;
  function display(){
    if(pending){$('payment-result').textContent='Идёт распознавание изображения. Дождитесь результата.';return}
    const raw=$('payment-payload').value.trim();
    if(!raw){$('payment-result').textContent='Сначала выберите изображение с QR или вставьте его содержимое. Пустая строка не проверена.';return}
    const parsed=PaymentDetails.decodePaymentLink(raw), comparison=PaymentDetails.compare($('payment-context').value,parsed);
    const lines=[parsed.status==='unknown'?'Формат не распознан: '+parsed.reason:'Формат: '+parsed.format];
    if(parsed.recipient)lines.push('Имя получателя в QR: '+parsed.recipient+' — не подтверждено.');
    if(parsed.host)lines.push('Адрес ссылки: '+parsed.host+' — принадлежность и репутация не установлены.');
    if(parsed.amount!=null)lines.push('Сумма в QR: '+parsed.amount+' '+(parsed.currency||'(валюта не установлена)'));
    lines.push('Сравнение сумм: '+comparison.reason);
    const hosts=Object.create(null);
    for(const item of $('qr-reported-hosts').value.split(/[\s,;]+/).filter(Boolean)){
      if(!/^(?=.{1,253}$)[a-z0-9.-]+$/i.test(item)||item.startsWith('.')||item.endsWith('.')){lines.push('Ошибка списка: вводите только доменные имена, без путей и протокола.');$('payment-result').textContent=lines.join('\n');return}
      hosts[item.toLowerCase()]=true;
    }
    const check=PaymentDetails.checkRecipient(parsed,hosts);
    lines.push('Проверка адреса из QR: '+check.reason);
    if(parsed.protocol==='http:')lines.push('Внимание: ссылка использует HTTP без шифрования.');
    lines.push('Источник списка: '+($('qr-reported-source').value.trim()||'не указан')+'. Реквизиты и личность получателя не подтверждены.');
    $('payment-result').textContent=lines.join('\n');
  }
  $('parse-payment').addEventListener('click',display);
  $('qr-image').addEventListener('change',async event=>{
    const file=event.target.files?.[0],current=++version;$('payment-payload').value='';
    if(!file){pending=false;return}
    if(file.size>10_000_000){pending=false;$('parse-payment').disabled=false;$('payment-result').textContent='Файл больше 10 МБ. Выберите изображение меньшего размера.';return}
    pending=true;$('parse-payment').disabled=true;$('payment-result').textContent='Распознаём QR на устройстве…';
    try {let raw=await LocalQr.decode(file).catch(()=>null);if(current!==version)return;
      if(!raw){
        $('payment-result').textContent='Основной декодер не справился. Пробуем дополнительный локальный декодер…';
        const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
        const response=await fetch('/api/decode-qr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:String(dataUrl).split(',')[1]})});
        const result=await response.json();if(current!==version)return;
        if(result.status!=='ok'){$('payment-result').textContent=result.reason+' Проверка не выполнена.';return}raw=result.text;
      }
      $('payment-payload').value=raw;pending=false;display();
    } catch {if(current===version)$('payment-result').textContent='Не удалось прочитать изображение. Попробуйте другой файл; проверка не выполнена.'}
    finally {if(current===version){pending=false;$('parse-payment').disabled=false}}
  });
})();
