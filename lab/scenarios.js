(() => {
  const items=document.getElementById('items');
  for(const x of window.ScenarioCatalog){
    const row=document.createElement('article'),heading=document.createElement('h3'),text=document.createElement('p'),link=document.createElement('a');
    row.style.marginBottom='14px';heading.textContent=x.title;text.textContent=x.kind+' — '+x.limit;
    link.href='/fixtures/'+x.file;link.target='_blank';link.rel='noopener';link.textContent='Открыть учебную страницу ↗';
    row.append(heading,text,link);if(x.source){const src=document.createElement('a');src.href=x.source;src.target='_blank';src.rel='noopener';src.textContent=' · Источник о классе угрозы';row.append(src)}items.append(row);
  }
})();
