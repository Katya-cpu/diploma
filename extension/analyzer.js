(function (root) {
  'use strict';
  // The analyser accepts observations, not page contents or entered secrets.
  function analyze(o) {
    const reasons = [];
    const text = String(o.text || '').slice(0, 12000).toLowerCase();
    const hasCard = !!o.hasCard;
    const manual = /(переведите|перевести|перевод|зайдите в.*банк)/i.test(text) && /(номер карты|карту получателя|карты получателя|по номеру карты)/i.test(text);
    const phoneTransfer = /(переведите|перевести|перевод|отправьте)/i.test(text) && /(по номеру телефона|на номер телефона|по телефону получателя)/i.test(text);
    const urgency = /(срочно|немедленно|только сегодня|иначе.*(отмен|заблок))/i.test(text);
    const contradictory = /(получить деньги|получите деньги|получение средств)/i.test(text) && /(оплатить|комисси|переведите)/i.test(text);
    if (hasCard) reasons.push({code:'card', severity:'notice', message:'Найдено поле для платёжной карты. Проверьте, кому и зачем вы передаёте данные.'});
    const supportedPersonal=['имя','телефон','электронная почта'];
    const personal=Array.isArray(o.personalTypes)?supportedPersonal.filter(x=>o.personalTypes.includes(x)):[];
    if(personal.length)reasons.push({code:'personal_fields',severity:'notice',message:'Найдены поля персональных данных: '+personal.join(', ')+'. Проверьте, кому и зачем вы собираетесь их передать.'});
    if (manual) reasons.push({code:'manual_transfer', severity:'warning', message:'Страница предлагает отдельный перевод по номеру карты. Уточните получателя и условия сделки.'});
    if (phoneTransfer) {
      reasons.push({code:'phone_transfer',severity:'warning',message:'Страница предлагает отдельный перевод по номеру телефона. Проверьте получателя и назначение до подтверждения.'});
      const match=text.match(/номер(?:у)? телефона\s*[:—-]?\s*(\+?\d[\d\s()\-]{8,18}\d)/i);
      if(match){const digits=match[1].replace(/\D/g,'');if(digits.length>=10)reasons.push({code:'masked_phone',severity:'notice',message:'Указан номер, окончание: •••• '+digits.slice(-4)+'. Принадлежность получателя не установлена.'});}
    }
    if (manual) {
      const candidates=[...text.matchAll(/(?:\d[\s-]*){13,19}/g)].map(m=>m[0].replace(/\D/g,''));
      if(candidates.length) reasons.push({code:'masked_recipient',severity:'notice',message:'На странице найдены реквизиты, окончание: •••• '+candidates[0].slice(-4)+'. Принадлежность получателя не установлена.'});
      if(root.PaymentDetails){const amounts=root.PaymentDetails.amounts(text);if(amounts.length===1)reasons.push({code:'amount',severity:'notice',message:'В тексте обнаружена сумма '+amounts[0].value+' '+amounts[0].currency+'. Проверьте, относится ли она именно к переводу.'});}
    }
    if (urgency && (hasCard || manual || o.hasPaymentButton)) reasons.push({code:'urgency', severity:'warning', message:'Есть призыв поторопиться рядом с платёжным действием.'});
    if (contradictory) reasons.push({code:'contradiction', severity:'warning', message:'Для получения денег страница одновременно просит оплату или перевод.'});
    if (o.hasCvv && /(получить деньги|получите деньги|получение средств|получить выплату|получить оплату)/i.test(text)) reasons.push({code:'receive_cvv',severity:'warning',message:'Страница сообщает о получении денег и одновременно запрашивает защитный код карты. Уточните назначение на официальной площадке; никому не сообщайте код.'});
    if (o.insecureForm) reasons.push({code:'insecure_form', severity:'warning', message:'Обнаружена карточная форма с незашифрованным адресом отправки. Это наблюдение не раскрывает действий скриптов.'});
    if (o.insecurePaymentLink) reasons.push({code:'insecure_payment_link',severity:'warning',message:'Платёжная ссылка ведёт на HTTP-адрес без шифрования соединения. Не переходите к вводу данных, пока не уточните адрес.'});
    if (o.misleadingControl) reasons.push({code:'control_mismatch',severity:'warning',message:'Видимая подпись кнопки и её доступное описание указывают на разные действия, одно из которых может быть платным. Фактическое действие не установлено.'});
    if (o.hiddenFinancialControl) reasons.push({code:'transparent_control',severity:'warning',message:'Найден почти прозрачный элемент с платёжным описанием, который может принимать нажатия. Его реальное назначение не установлено.'});
    if (o.coveredControl) reasons.push({code:'covered_control', severity:'warning', message:'Обнаруженное платёжное поле или кнопка перекрыто другим элементом. Причина перекрытия не установлена.'});
    if (o.externalForm) reasons.push({code:'external_form', severity:'notice', message:'Форма указывает адрес на другом сайте. Это может быть платёжный провайдер; назначение само по себе не доказывает угрозу.'});
    if (o.formDestinationUnknown) reasons.push({code:'unknown_destination', severity:'notice', message:'Адрес обработки формы не установлен: отправка может происходить через скрипт.'});
    if (o.hasQr) reasons.push({code:'qr', severity:'notice', message:o.qrChecked?'Одна из сумм страницы совпадает с суммой распознанного платёжного QR. Получатель и безопасность не подтверждены.':'Возможно присутствует QR-код. Его содержимое не удалось надёжно сопоставить; используйте локальную лабораторию для ручного анализа.'});
    if (o.qrMismatch) reasons.push({code:'qr_mismatch',severity:'warning',message:'Сумма распознанного платёжного QR не совпала с найденными суммами страницы. Проверьте назначение и контекст.'});
    if (o.qrReported) reasons.push({code:'qr_reported',severity:'warning',message:'Домен ссылки в QR есть в вашем локальном списке сообщений об угрозах. Проверьте источник: получатель и мошенничество не подтверждены.'});
    if (o.qrSbp) reasons.push({code:'qr_sbp',severity:'notice',message:'QR похож по формату на ссылку СБП. До подтверждения сверьте получателя и сумму в приложении банка: здесь они не установлены.'});
    if (o.qrSubscription) reasons.push({code:'qr_subscription',severity:'warning',message:'Ссылка может относиться к привязке счёта или подписке. Проверьте её назначение и условия в платёжном приложении.'});
    if (o.qrInsecure) reasons.push({code:'qr_insecure',severity:'warning',message:'Ссылка из QR использует HTTP без шифрования. Адрес и получатель не подтверждены.'});
    if (o.amountMismatch) reasons.push({code:'amount_mismatch',severity:'warning',message:'Единственная видимая сумма в рублях отличается от указанной в поддерживаемом скрытом поле формы. Проверьте назначение каждой суммы.'});
    if (o.changedForm) reasons.push({code:'changed_form',severity:'warning',message:'У доступной карточной формы изменился адрес обработки. Это может быть обычным перенаправлением; проверьте ситуацию.'});
    if (o.reputationReported) reasons.push({code:'reputation_report',severity:'warning',message:'Точный адрес сайта присутствует в локальном списке сообщений об угрозах. Проверьте источник и дату записи; список может ошибаться.'});
    if (o.hasPaymentButton) reasons.push({code:'payment_action', severity:'notice', message:'Найдено возможное платёжное действие: проверьте его назначение.'});
    const warnings = reasons.filter(r => r.severity === 'warning').length;
    return {status: warnings ? 'warning' : reasons.length ? 'notice' : 'unknown', reasons, limitations:['Проверены только доступные признаки страницы; безопасность не гарантируется.','Получатель и поведение недоступных скриптов не установлены.']};
  }
  root.PaymentAnalyzer = {analyze};
  if (typeof module !== 'undefined') module.exports = root.PaymentAnalyzer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
