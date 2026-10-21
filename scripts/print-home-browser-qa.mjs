import {createRequire} from 'node:module'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {preview} from 'vite'
import {composeEdition} from '../client/src/print/compose.ts'
import {editionSettings,printLabels} from '../client/src/print/model.ts'
import {fontMetrics,pdfDocument} from '../client/src/print/pdfRuntime.ts'
import {physicalSides,selectPrintSides,printerProfile} from '../client/src/print/homeJob.ts'

const {chromium}=createRequire(import.meta.url)('playwright')
const output=resolve('.tloque_cache/print-home-qa');await mkdir(output,{recursive:true})
const vite=await preview({preview:{host:'127.0.0.1',port:4186,strictPort:true},logLevel:'error'})
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.TLOQUE_QA_CHROME?{executablePath:process.env.TLOQUE_QA_CHROME}:{})})
const sentence='Lucía cruzó el río y encontró la biblioteca abierta. ¿Quién recordaba todavía el nombre de aquella ciudad? La lámpara iluminaba sus páginas y cada palabra traía consigo una memoria distinta.'
const full={id:91,title:'Un libro para imprimir en casa',author:'Tloque · muestra técnica',originalLanguage:'es',genre:'fantasia',isClassic:true,status:'published',coverUrl:'',revision:1,synopsis:'Muestra técnica para comprobar impresión y encuadernación.',chapters:Array.from({length:3},(_,i)=>({title:['El umbral','Las páginas','El regreso'][i],content:Array.from({length:20},(_,j)=>`Párrafo ${i+1}.${j+1}. ${sentence} ${sentence}`).join('\n\n')+(i===2?'\n\nÚLTIMA LÍNEA: FIN DE LA MUESTRA.':'')}))}
const books={91:full,92:{...full,id:92,title:'Un folleto completo',chapters:[{title:'El encuentro',content:sentence.repeat(5)}]},93:{...full,id:93,isClassic:false,authorId:45,title:'Ejemplar autorizado'}}
const fonts=Object.fromEntries(await Promise.all([['normal','Regular'],['bold','Bold'],['italic','It']].map(async([key,name])=>[key,(await readFile('client/src/print/assets/SourceSerif4-'+name+'.ttf')).toString('base64')])))
const metrics=fontMetrics(pdfDocument(148,210,fonts)), layout=composeEdition(full,editionSettings({destination:'booklet',paper:'letter',signature:8,recto:false,binding:'bound',economyCover:true}),metrics,printLabels('es'))
const profile=printerProfile({duplex:'manual',reverseBacks:true,rotateBacks:true,offsetX:1.2,offsetY:-.8})
const sides=physicalSides(layout)
await writeFile(output+'/expected.json',JSON.stringify({logical:layout.pages.map(p=>p.ops.filter(o=>o.kind==='text').map(o=>o.text).join('\n')),profile,fronts:selectPrintSides(sides,{signature:2,pass:'front'},profile),backs:selectPrintSides(sides,{signature:2,pass:'back'},profile),proofFronts:selectPrintSides(sides,{signature:1,pass:'front'},profile),proofBacks:selectPrintSides(sides,{signature:1,pass:'back'},profile)},null,2))
const errors=[],writes=[]
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,reducedMotion:'reduce'})
context.setDefaultTimeout(30000)
await context.addInitScript(()=>{localStorage.setItem('novareads_onboarding_done','1');sessionStorage.setItem('tloque_boot_seen_v1','1');localStorage.setItem('tloque_settings_v2',JSON.stringify({visualQuality:'essential',reduceMotion:true,orbSounds:false,musicEnabled:false,language:'es'}))})
await context.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url())
 if(u.hostname!=='127.0.0.1')return route.abort()
 if(!u.pathname.startsWith('/api/'))return route.continue()
 if(req.method()!=='GET'){
  writes.push(req.method()+' '+u.pathname)
  if(u.pathname==='/api/print-copies/7/prepare'&&req.method()==='POST')return route.fulfill({json:{bookId:93,copy:{folio:'QA-ONLY-SERIAL-7',key:'fictional-activation-key'}}})
  return route.fulfill({status:405,json:{}})
 }
 let data={}
 if(u.pathname==='/api/auth/me')data={id:99,email:'fixture@example.test',name:'Print fixture',avatar:'',isAdmin:true,capabilities:{manageCatalog:true,manageFrames:true,manageAudioCatalog:true,manageFinance:true,manageAdmins:true,runDiagnostics:true},persona:'admin'}
 else if(/^\/api\/books\/\d+$/.test(u.pathname))data=books[u.pathname.split('/').at(-1)]
 else if(u.pathname==='/api/books')data=[]
 else if(u.pathname==='/api/frames')data={frames:[]}
 else if(u.pathname.includes('notifications'))data={notifications:[],unread:0}
 else if(u.pathname==='/api/sync/state')data={library:[],progress:[],streak:null}
 else if(u.pathname==='/api/tokens/mine')data={tokens:u.searchParams.get('bookId')==='93'?[{id:3,kind:'support',licenseStatus:'active',copies:[{id:7,folio:'QA-ONLY-SERIAL-7',canPrint:true,digitalClaimed:false,claimedByOwner:false}]}]:[]}
 else if(u.pathname==='/api/payments/config')data={enabled:false,prices:{}}
 else if(u.pathname==='/api/wallet')data={tinta:0,papel:0}
 return route.fulfill({json:data})
})
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
const ready=async()=>{await page.locator('.print-preview-pane[aria-busy=false]').waitFor({state:'attached',timeout:60000});assert.equal(await page.locator('.print-error').count(),0)}
const step=async n=>page.getByRole('button',{name:n,exact:true}).click()
const open=async id=>{await page.goto('http://127.0.0.1:4186/book/'+id);await page.getByRole('button',{name:'Crear edición física',exact:true}).click();await ready()}
let previousDownload=0
// Chromium throttles download bursts; emulate separate human save gestures.
const download=async(label,name)=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,previousDownload+400-Date.now())));previousDownload=Date.now();const event=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();await(await event).saveAs(output+'/'+name)}
const number=async(label,value)=>{const field=page.getByLabel(label,{exact:true});await field.fill(String(value));await field.press('Tab');await ready()}
try {
 console.log('Home print QA: manual passes, calibration, selected sheets, project revision and home covers')
 await open(91)
 await page.getByRole('button',{name:/^Cuadernillos/}).click();await ready()
 await page.getByLabel('Páginas por cuadernillo',{exact:true}).selectOption('8');await ready()
 await step('03 Revisión')
 await page.getByLabel('Cómo imprime las dos caras',{exact:true}).selectOption('manual')
 assert.equal(await page.getByRole('button',{name:'1 · Descargar frentes',exact:true}).isDisabled(),true)
 await page.getByText('Prueba de orientación y escala',{exact:true}).click()
 await page.getByLabel('Invertir el orden de los reversos',{exact:true}).check()
 await page.getByLabel('Girar los reversos 180°',{exact:true}).check()
 await number('Mover reverso a la derecha · mm',1.2);await number('Mover reverso hacia abajo · mm',-.8)
 await download('Prueba · frentes A y B','calibration-front.pdf');await download('Prueba · reversos A y B','calibration-back.pdf')
 await page.getByLabel('Comprobé letras, orientación, escala y márgenes con estas opciones.',{exact:true}).check()
 await page.getByLabel('Cuadernillo',{exact:true}).selectOption('2')
 await download('1 · Descargar frentes','manual-fronts-group2.pdf');await download('2 · Descargar reversos','manual-backs-group2.pdf')
 await page.getByLabel('Hoja física',{exact:true}).selectOption('3')
 await download('1 · Descargar frentes','reprint-front-sheet3.pdf');await download('2 · Descargar reversos','reprint-back-sheet3.pdf')
 await download('Descargar primer cuadernillo de prueba · FRENTE','proof-fronts.pdf');await download('Descargar primer cuadernillo de prueba · REVERSO','proof-backs.pdf')
 await download('Descargar interior PDF','reading-order.pdf')
 await download('Descargar ficha de impresión','manual-job.txt')
 assert.ok((await readFile(output+'/manual-job.txt','utf8')).includes('SHA-256'))
 await page.getByText('Guardar y recuperar esta edición',{exact:true}).click()
 await download('Guardar edición','edition.json')
 const project=JSON.parse(await readFile(output+'/edition.json','utf8'))
 assert.equal(project.version,2);assert.equal(project.engine,2);assert.match(project.fingerprint,/^[a-f0-9]{64}$/);assert.equal(project.settings.bodyPt,11)
 await step('02 Diseño');await number('Cuerpo · pt',14)
 await page.getByLabel('Cargar edición guardada',{exact:true}).setInputFiles(output+'/edition.json');await ready()
 assert.equal(await page.getByLabel('Cuerpo · pt',{exact:true}).inputValue(),'11')
 await page.getByRole('button',{name:'Cerrar taller',exact:true}).click()
 books[91]={...full,revision:2,chapters:[{...full.chapters[0],content:'Un párrafo nuevo.\n'+full.chapters[0].content},...full.chapters.slice(1)]}
 await open(91)
 await page.getByText('Guardar y recuperar esta edición',{exact:true}).click()
 await page.getByLabel('Cargar edición guardada',{exact:true}).setInputFiles(output+'/edition.json')
 await page.locator('.print-project [role=alert]').waitFor()
 assert.match(await page.locator('.print-project [role=alert]').innerText(),/manuscrito.*cambiado/)
 await step('01 Formato');await page.getByRole('button',{name:/^En casa/}).click();await ready()
 await step('03 Revisión');await page.getByText('Preparar la cubierta',{exact:true}).click()
 assert.equal(await page.getByLabel('Lomo confirmado · mm',{exact:true}).count(),0)
 await page.getByLabel('Revisaré la cubierta y cómo sujetar las páginas antes de montar el libro.',{exact:true}).check()
 await download('Descargar cubierta doméstica PDF','cover-loose-letter.pdf')
 assert.equal(await page.getByTestId('print-preview').getAttribute('viewBox'),'0 0 215.9 279.4')
 await page.getByRole('button',{name:'Hoja de contraportada',exact:true}).click()
 assert.match(await page.getByTestId('print-preview').textContent(),/Muestra técnica/)
 await page.screenshot({path:output+'/home-desktop.png',animations:'disabled'})
 await page.getByRole('button',{name:'Cerrar taller',exact:true}).click()
 await open(92);await page.getByRole('button',{name:/^Cuadernillos/}).click();await ready()
 await page.getByLabel('Cómo vas a unir el libro',{exact:true}).selectOption('saddle');await ready()
 await step('03 Revisión');await page.getByLabel('Cómo imprime las dos caras',{exact:true}).selectOption('auto')
 await download('Descargar cuadernillos PDF','short-booklet.pdf')
 await page.getByText('Prueba de orientación y escala',{exact:true}).click()
 await download('Prueba · doble cara automática','calibration-auto.pdf')
 await page.getByText('Preparar la cubierta',{exact:true}).click();await page.getByLabel('Revisaré la cubierta y cómo sujetar las páginas antes de montar el libro.',{exact:true}).check()
 await download('Descargar cubierta doméstica PDF','cover-folded-letter.pdf')
 assert.equal(await page.getByTestId('print-preview').getAttribute('viewBox'),'0 0 279.4 215.9')
 await page.getByRole('button',{name:'Cerrar taller',exact:true}).click()
 console.log('Home print QA: selected licensed copy preparation without secrets in listings')
 await page.goto('http://127.0.0.1:4186/book/93')
 await page.getByRole('button',{name:'PDF QA-ONLY-SERIAL-7',exact:true}).click();await ready()
 await page.getByRole('button',{name:/^En casa/}).click();await ready();await step('03 Revisión')
 await download('Descargar interior PDF','licensed-interior.pdf')
 await page.getByText('Guardar y recuperar esta edición',{exact:true}).click();await download('Guardar edición','licensed-edition.json')
 assert.ok(!(await readFile(output+'/licensed-edition.json','utf8')).includes('fictional-activation-key'))
 await page.getByRole('button',{name:'Cerrar taller',exact:true}).click()
 console.log('Home print QA: real offline reopen and PDF download')
 await open(91)
 await page.locator('.print-offline-state[data-ready=true]').waitFor({timeout:60000})
 await page.evaluate(()=>navigator.serviceWorker.ready)
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller)
 await page.getByRole('button',{name:'Cerrar taller',exact:true}).click()
 await writeFile(output+'/offline-cache.json',JSON.stringify(await page.evaluate(async()=>{const out=[];for(const n of await caches.keys()){const c=await caches.open(n);out.push({cache:n,keys:(await c.keys()).map(r=>r.url)})}return out}),null,2));await context.setOffline(true)
 await page.getByRole('button',{name:'Crear edición física',exact:true}).click();await ready()
 await step('03 Revisión');await download('Descargar interior PDF','offline-interior.pdf')
 assert.ok((await readFile(output+'/offline-interior.pdf')).length>1000)
 await context.setOffline(false)
 await page.setViewportSize({width:390,height:844})
 await page.getByLabel('Cómo imprime las dos caras',{exact:true}).selectOption('manual')
 await page.getByText('Prueba de orientación y escala',{exact:true}).click()
 await page.screenshot({path:output+'/home-mobile.png',animations:'disabled'})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(writes,['POST /api/print-copies/7/prepare']);assert.deepEqual(errors,[])
 await writeFile(output+'/result.json',JSON.stringify({passed:true,writes,errors,offlineExport:true},null,2))
 console.log('Home print QA passed: actual manual PDFs, calibration, reprints, covers, revision checks, selected copy and real offline export')
} catch(error) {console.error('Home QA errors:',errors);console.error('Project panel:',await page.locator('.print-project').allTextContents());await page.screenshot({path:output+'/debug-failure.png'});throw error} finally {await context.close();await browser.close();await new Promise(resolve=>vite.httpServer.close(resolve))}
