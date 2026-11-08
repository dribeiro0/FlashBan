// Offline scan of the exact export; not a browser/harness or medical safety certification.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDetector } from '../../extension/src/detect/index.js';
const file=fileURLToPath(new URL('./renders/flashban-intro.mp4',import.meta.url));
const bytes=execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-vf','scale=160:90','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:64*1024*1024});
const frameBytes=160*90*4;
if(bytes.length%frameBytes!==0 || bytes.length/frameBytes!==300) throw new Error('Expected 300 complete frames');
const results=[];
for(const preset of ['wcag','strict']) {
  const detector=createDetector({preset,sampleWidth:160,sampleHeight:90,realAreaScale:12});
  let violations=0,maxGeneral=0,maxRed=0;
  for(let frame=0;frame<bytes.length/frameBytes;frame++) {
    const pixels=new Uint8ClampedArray(bytes.subarray(frame*frameBytes,(frame+1)*frameBytes));
    const r=detector.push({pixels,t:frame*1000/30,dropped:false});
    violations+=Number(r.violation);
    maxGeneral=Math.max(maxGeneral,r.flashesPerSecond);
    maxRed=Math.max(maxRed,r.redFlashesPerSecond ?? 0);
  }
  results.push({preset,frames:300,violations,maxGeneralFlashesPerSecond:maxGeneral,maxRedFlashesPerSecond:maxRed});
}
console.log(JSON.stringify({sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),sampleWidth:160,sampleHeight:90,fps:30,realAreaScale:12,results},null,2));
if(results.some(r=>r.violations>0)) process.exitCode=1;
