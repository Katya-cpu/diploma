(() => {
  'use strict';
  document.getElementById('export-case').onclick=()=>{
    const scenario=cases[selected];
    const analysis=PaymentAnalyzer.analyze({text:scenario.text,hasCard:scenario.card,hasPaymentButton:scenario.button});
    // Only fixed demo ID and signal codes; never include arbitrary text or payment data.
    const documentData={format:'payment-lab-case-v1',created_at:new Date().toISOString(),scenario:scenario.id,
      web:{status:analysis.status,signals:analysis.reasons.map(item=>item.code)},
      bank:{scope:'separate',note:'Графовый эксперимент вынесен отдельно и в этот отчёт не включён.'},
      note:'Учебный случай. Отчёт не подтверждает мошенничество или безопасность.'};
    const url=URL.createObjectURL(new Blob([JSON.stringify(documentData,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='payment-demo-case.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
})();
