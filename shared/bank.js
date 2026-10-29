(function(root) {
  'use strict';
  // Educational demonstration: solely history available strictly before the request.
  function evaluate(transactions, request) {
    const before = transactions.filter(t => t.recipient === request.recipient && t.time < request.time);
    const lastDay = before.filter(t => request.time - t.time <= 24 * 60 * 60);
    const distinctSenders = new Set(lastDay.map(t => t.sender)).size;
    const amount = lastDay.reduce((sum,t) => sum + t.amount, 0);
    const warnings = [];
    if (!before.length) return {status:'unknown', count:0, warnings:['История получателя отсутствует; решение по истории невозможно.']};
    if (distinctSenders >= 3) warnings.push(`За сутки получено переводов от ${distinctSenders} разных отправителей.`);
    if (lastDay.length >= 5) warnings.push(`За сутки получено ${lastDay.length} переводов.`);
    if (request.amount > 0 && before.length >= 2 && request.amount > amount * 3) warnings.push('Сумма заметно отличается от суммы недавних поступлений.');
    return {status:warnings.length?'warning':'notice', count:before.length, distinctSenders, warnings,
      note:'Это учебные правила на искусственных данных, не прогноз мошенничества.'};
  }
  root.BankDemo={evaluate};
  if(typeof module !== 'undefined') module.exports=root.BankDemo;
})(typeof globalThis !== 'undefined'?globalThis:this);
