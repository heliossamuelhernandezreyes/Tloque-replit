import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
const root=process.cwd(), output=resolve(root,'.tloque_cache/audio-audit');
await mkdir(output,{recursive:true});
await build({entryPoints:[resolve(root,'scripts/qa-audio-audit-browser.ts')],outfile:output+'/browser.js',bundle:true,platform:'browser',format:'esm',tsconfig:root+'/tsconfig.json',plugins:[{name:'unused-worklet-url',setup(b){b.onResolve({filter:/\?url$/},a=>({path:a.path,namespace:'asset'}));b.onLoad({filter:/.*/,namespace:'asset'},()=>({contents:'export default "/unused-worklet.js"',loader:'js'}));}}]});
const wave=seconds=>{const rate=32000,n=Math.floor(seconds*rate),buf=Buffer.alloc(44+n*2);buf.write('RIFF');buf.writeUInt32LE(36+n*2,4);buf.write('WAVEfmt ',8);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)buf.writeInt16LE(Math.round(1500*Math.sin(2*Math.PI*220*i/rate)),44+i*2);return buf};
const long=wave(8),short=wave(.5);
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.endsWith('.wav')){
   if(url.pathname==='/delayed.wav')await new Promise(r=>setTimeout(r,600));
   const bytes=url.pathname==='/short.wav'?short:long,range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
   const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
   res.writeHead(range?206:200,{'Content-Type':'audio/wav','Cache-Control':'no-store','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});
   res.end(bytes.subarray(start,end+1));return;
 }
 if(url.pathname==='/browser.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(output+'/browser.js'));return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><meta charset="utf-8"><title>Audio audit</title></head><body><button>Run audit</button><script type="module" src="/browser.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[];
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(String(error)));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button').click();
 await page.waitForFunction(()=>Boolean(window.auditResults),{},{timeout:90000});
 const result=await page.evaluate(()=>window.auditResults);
 result.consoleErrors=errors;await writeFile(output+'/browser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 if(result.fatal||result.results.some(x=>!x.confirmed))process.exitCode=1;
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
