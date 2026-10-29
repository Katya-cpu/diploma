'use strict';
const target=document.getElementById('events');
async function get(){const data=await browser.storage.local.get('briefEvents');return Array.isArray(data.briefEvents)?data.briefEvents:[]}
async function render(){const events=await get();target.textContent=events.length?JSON.stringify(events,null,2):'История пуста.'}
document.getElementById('clear').onclick=async()=>{await browser.storage.local.remove('briefEvents');await render()};
document.getElementById('download').onclick=async()=>{const blob=new Blob([JSON.stringify({type:'brief-events',events:await get()},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='payment-warnings.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)};
render();
