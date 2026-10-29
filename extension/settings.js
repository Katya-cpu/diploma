'use strict';
const list=document.getElementById('sites');
async function render(){
 const stored=await browser.storage.local.get('ordinaryExceptions'),exceptions=stored.ordinaryExceptions||{},entries=Object.keys(exceptions).filter(x=>exceptions[x]);list.replaceChildren();
 if(!entries.length){const li=document.createElement('li');li.textContent='Исключений нет.';list.append(li);return}
 for(const origin of entries){const li=document.createElement('li'),label=document.createElement('span'),remove=document.createElement('button');label.textContent=origin+' ';remove.textContent='Удалить исключение';remove.onclick=async()=>{const data=await browser.storage.local.get('ordinaryExceptions');const current=data.ordinaryExceptions||{};delete current[origin];await browser.storage.local.set({ordinaryExceptions:current});render()};li.append(label,remove);list.append(li)}
}
render();
const status=document.getElementById('reputation-status');
async function reputationStatus(){const s=await browser.storage.local.get(['reportedHosts','reportedSource']);const n=Object.keys(s.reportedHosts||{}).length;status.textContent=n?`В локальном списке ${n} записей. Источник: ${s.reportedSource||'не указан'}.`:'Локальный список пуст.'}
document.getElementById('reputation-import').onclick=async()=>{
 try{const file=document.getElementById('reputation-file').files?.[0];if(!file||file.size>2000000)throw Error('Выберите JSON размером до 2 МБ.');const value=JSON.parse(await file.text());
  if(!Array.isArray(value.hosts)||value.hosts.length>20000)throw Error('Ожидается массив hosts до 20 000 записей.');
  const hosts=Object.create(null);for(const host of value.hosts){if(typeof host!=='string'||!/^(?=.{1,253}$)[a-z0-9.-]+$/i.test(host)||host.startsWith('.')||host.endsWith('.'))throw Error('В списке есть некорректное имя сайта.');hosts[host.toLowerCase()]=true}
  await browser.storage.local.set({reportedHosts:hosts,reportedSource:(String(value.source||'не указан')+' / '+String(value.date||'дата не указана')).slice(0,200)});await reputationStatus();
 }catch(e){status.textContent='Список не импортирован: '+e.message}
};
document.getElementById('reputation-clear').onclick=async()=>{await browser.storage.local.remove(['reportedHosts','reportedSource']);await reputationStatus()};
reputationStatus();
