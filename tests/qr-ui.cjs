// Exercise the selected-file -> button -> local API flow. Pass an image path explicitly.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const details=require('../shared/payment-details.js');
const filePath=process.argv[2];
if(!filePath)throw Error('Pass a local image path as the first argument.');
const elements={};
for(const id of ['qr-image','parse-payment','payment-result','payment-payload','payment-context','qr-reported-hosts','qr-reported-source']){
  elements[id]={value:'',textContent:'',disabled:false,files:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn}};
}
const bytes=fs.readFileSync(filePath);
elements['qr-image'].files=[{size:bytes.length,bytes}];
class MockReader{readAsDataURL(file){this.result='data:image/png;base64,'+file.bytes.toString('base64');queueMicrotask(()=>this.onload())}}
const context={document:{getElementById:id=>elements[id]},PaymentDetails:details,LocalQr:{decode:async()=>null},FileReader:MockReader,
  fetch:(url,options)=>fetch('http://127.0.0.1:8765'+url,{...options,headers:{...options.headers,Origin:'http://127.0.0.1:8765'}}),console};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../lab/tools.js'),'utf8'),context);
(async()=>{
  elements['qr-image'].handlers.change();
  assert.match(elements['payment-result'].textContent,/Файл выбран/);
  await elements['parse-payment'].handlers.click();
  assert.ok(elements['payment-payload'].value,'QR content should be populated: '+elements['payment-result'].textContent);
  assert.match(elements['payment-result'].textContent,/Формат:/);
  assert.doesNotMatch(elements['payment-result'].textContent,/Сначала выберите/);
  assert.equal(elements['parse-payment'].disabled,false);
  console.log('QR file selection, button, fallback API and result: passed. Payload not printed.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
