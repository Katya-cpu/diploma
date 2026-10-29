(function (root) {
  'use strict';
  // The analyser accepts observations, not page contents or entered secrets.
  function analyze(o) {
    const reasons = [];
    const text = String(o.text || '').slice(0, 12000).toLowerCase();
    const hasCard = !!o.hasCard;
    const manual = /(переведите|перевести|перевод|зайдите в.*банк)/i.test(text) && /(номер карты|карту получателя|карты получателя|по номеру карты)/i.test(text);
    const urgency = /(срочно|немедленно|только сегодня|иначе.*(отмен|заблок))/i.test(text);
    const contradictory = /(получить деньги|получите деньги|получение средств)/i.test(text) && /(оплатить|комисси|переведите)/i.test(text);
    if (hasCard) reasons.push({code:'card', severity:'notice', message:'Найдено поле для платёжной карты. Проверьте, кому и зачем вы передаёте данные.'});
    if (manual) reasons.push({code:'manual_transfer', severity:'warning', message:'Страница предлагает отдельный перевод по номеру карты. Уточните получателя и условия сделки.'});
    if (manual) {
      const candidates=[...text.matchAll(/(?:\d[\s-]*){13,19}/g)].map(m=>m[0].replace(/\D/g,''));
      if(candidates.length) reasons.push({code:'masked_recipient',severity:'notice',message:'На странице найдены реквизиты, окончание: •••• '+candidates[0].slice(-4)+'. Принадлежность получателя не установлена.'});
      if(root.PaymentDetails){const amounts=root.PaymentDetails.amounts(text);if(amounts.length===1)reasons.push({code:'amount',severity:'notice',message:'В тексте обнаружена сумма '+amounts[0].value+' '+amounts[0].currency+'. Проверьте, относится ли она именно к переводу.'});}
    }
    if (urgency && (hasCard || manual || o.hasPaymentButton)) reasons.push({code:'urgency', severity:'warning', message:'Есть призыв поторопиться рядом с платёжным действием.'});
    if (contradictory) reasons.push({code:'contradiction', severity:'warning', message:'Для получения денег страница одновременно просит оплату или перевод.'});
    if (o.insecureForm) reasons.push({code:'insecure_form', severity:'warning', message:'Обнаружена карточная форма с незашифрованным адресом отправки. Это наблюдение не раскрывает действий скриптов.'});
    if (o.coveredControl) reasons.push({code:'covered_control', severity:'warning', message:'Обнаруженное платёжное поле или кнопка перекрыто другим элементом. Причина перекрытия не установлена.'});
    if (o.externalForm) reasons.push({code:'external_form', severity:'notice', message:'Форма указывает адрес на другом сайте. Это может быть платёжный провайдер; назначение само по себе не доказывает угрозу.'});
    if (o.formDestinationUnknown) reasons.push({code:'unknown_destination', severity:'notice', message:'Адрес обработки формы не установлен: отправка может происходить через скрипт.'});
    if (o.hasQr) reasons.push({code:'qr', severity:'notice', message:o.qrChecked?'Одна из сумм страницы совпадает с суммой распознанного платёжного QR. Получатель и безопасность не подтверждены.':'Возможно присутствует QR-код. Его содержимое не удалось надёжно сопоставить; используйте локальную лабораторию для ручного анализа.'});
    if (o.qrMismatch) reasons.push({code:'qr_mismatch',severity:'warning',message:'Сумма распознанного платёжного QR не совпала с найденными суммами страницы. Проверьте назначение и контекст.'});
    if (o.changedForm) reasons.push({code:'changed_form',severity:'warning',message:'У доступной карточной формы изменился адрес обработки. Это может быть обычным перенаправлением; проверьте ситуацию.'});
    if (o.reputationReported) reasons.push({code:'reputation_report',severity:'warning',message:'Точный адрес сайта присутствует в локальном списке сообщений об угрозах. Проверьте источник и дату записи; список может ошибаться.'});
    if (o.hasPaymentButton) reasons.push({code:'payment_action', severity:'notice', message:'Найдено возможное платёжное действие: проверьте его назначение.'});
    const warnings = reasons.filter(r => r.severity === 'warning').length;
    return {status: warnings ? 'warning' : reasons.length ? 'notice' : 'unknown', reasons, limitations:['Проверены только доступные признаки страницы; безопасность не гарантируется.','Получатель и поведение недоступных скриптов не установлены.']};
  }
  root.PaymentAnalyzer = {analyze};
  if (typeof module !== 'undefined') module.exports = root.PaymentAnalyzer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
