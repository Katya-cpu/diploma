(function(root){
  'use strict';
  async function decode(source){
    if(typeof root.jsQR!=='function')throw new Error('Декодер QR не загружен.');
    let bitmap;
    try {
      bitmap=await createImageBitmap(source);
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      const result=root.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
      return result?.data||null;
    } finally {if(bitmap)bitmap.close()}
  }
  root.LocalQr={decode};
})(globalThis);
