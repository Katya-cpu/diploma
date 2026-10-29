'use strict';
// Only destination origins, never request bodies, paths, queries, cookies or tokens.
const sessions=new Map();
browser.runtime.onMessage.addListener((message,sender)=>{
  const id=sender.tab?.id;
  if(id===undefined)return;
  if(message?.type==='payment-context'){
    if(!sessions.has(id))sessions.set(id,{origins:new Set(),active:true});
    return Promise.resolve({ok:true});
  }
  if(message?.type==='destinations')return Promise.resolve({origins:[...(sessions.get(id)?.origins||[])].slice(-20)});
});
browser.webRequest.onBeforeRequest.addListener(details=>{
  const session=sessions.get(details.tabId);if(!session)return;
  try{const origin=new URL(details.url).origin;if(origin.startsWith('http'))session.origins.add(origin)}catch{}
},{urls:['http://*/*','https://*/*']});
browser.tabs.onRemoved.addListener(id=>sessions.delete(id));
browser.tabs.onUpdated.addListener((id,change)=>{if(change.status==='loading')sessions.delete(id)});
