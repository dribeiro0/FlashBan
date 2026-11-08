// Prepare a fresh static deployment. Only the Start-gated Grain showcase is public.
// Run node site/build.mjs first, then node site/stage-vercel.mjs.
import { mkdtemp, mkdir, readdir, copyFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const site=dirname(fileURLToPath(import.meta.url));
const stage=await mkdtemp(join(tmpdir(),'flashban-public-'));
for(const entry of await readdir(site,{withFileTypes:true})) {
  if(entry.isFile() && /\.(html|css|js|png|svg|ico)$/.test(entry.name) && !entry.name.endsWith('.test.js')) {
    await copyFile(join(site,entry.name),join(stage,entry.name));
  }
}
for(const [folder,names] of [
  ['fonts',['LICENSE.md','martian-mono.woff2','sofia-sans-extra-condensed-900.woff2']],
  ['download',['latest.js']],
]) {
  await mkdir(join(stage,folder),{recursive:true});
  for(const name of names) await copyFile(join(site,folder,name),join(stage,folder,name));
}
for(const name of await readdir(join(site,'download'))) {
  if(/^flashban-[\d.]+\.zip(?:\.sha256)?$/.test(name)) await copyFile(join(site,'download',name),join(stage,'download',name));
}
const showcase=join(stage,'demo','showcase');
await mkdir(showcase,{recursive:true});
for(const name of ['index.html','showcase.css','showcase.js']) {
  await copyFile(join(site,'..','demo','showcase',name),join(showcase,name));
}
await mkdir(join(showcase,'fonts'),{recursive:true});
for(const name of ['LICENSE.md','martian-mono.woff2','sofia-sans-extra-condensed-900.woff2']) {
  await copyFile(join(site,'..','demo','showcase','fonts',name),join(showcase,'fonts',name));
}
await writeFile(join(stage,'vercel.json'),JSON.stringify({
  version:2,framework:null,
  headers:[{source:'/(.*)',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'no-referrer'},
  ]}],
},null,2)+'\n');
console.log(stage);
