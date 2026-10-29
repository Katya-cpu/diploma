// Test the bundled decoder with the project's synthetic QR without external image tools.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const jsQR=require('../lab/vendor/jsQR.js');
const svg=fs.readFileSync(path.join(__dirname,'../lab/fixtures/demo-qr.svg'),'utf8');
const cells=[...svg.matchAll(/M(\d+),(\d+)H\d+V\d+H\d+z/g)];
assert.ok(cells.length>100,'Учебный QR должен содержать ячейки');
const scale=8,size=37*scale,pixels=new Uint8ClampedArray(size*size*4);pixels.fill(255);
for(const cell of cells){const x=Number(cell[1])*scale,y=Number(cell[2])*scale;for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const index=((y+dy)*size+x+dx)*4;pixels[index]=pixels[index+1]=pixels[index+2]=0;}}
const decoded=jsQR(pixels,size,size);
assert.equal(decoded?.data,'ST00012|Name=Demo|Sum=10000');
console.log('Synthetic QR decoded successfully. Browser and real images still require testing.');
