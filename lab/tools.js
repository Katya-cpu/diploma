(() => {
  const $=id=>document.getElementById(id);
  $('parse-payment').addEventListener('click',()=>{
    const parsed=PaymentDetails.decodePaymentLink($('payment-payload').value);
    const comparison=PaymentDetails.compare($('payment-context').value,parsed);
    $('payment-result').textContent=JSON.stringify({parsed,comparison},null,2);
  });
  $('qr-image').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!('BarcodeDetector' in window)){$('payment-result').textContent='Этот браузер не предоставляет локальное распознавание QR. Вставьте текст QR вручную; отсутствие поддержки не означает безопасность.';return}
    try {const bitmap=await createImageBitmap(file);const detector=new BarcodeDetector({formats:['qr_code']});const found=await detector.detect(bitmap);bitmap.close();if(!found.length){$('payment-result').textContent='QR не распознан.';return}$('payment-payload').value=found[0].rawValue;$('parse-payment').click()}
    catch {$('payment-result').textContent='Не удалось локально прочитать изображение. Никакие файлы не отправлены.'}
  });
})();
