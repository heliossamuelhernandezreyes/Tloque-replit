"""Inspect actual PDFs downloaded by the home-print browser workflow."""
import json, math, subprocess
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image

ROOT=Path('.tloque_cache/print-home-qa')
expected=json.loads((ROOT/'expected.json').read_text())
compact=lambda s:''.join(s.split())
pt=lambda mm:mm*72/25.4

def inspect(name, count, w, h, duplex='/Simplex'):
 r=PdfReader(ROOT/(name+'.pdf'))
 assert len(r.pages)==count,(name,len(r.pages),count)
 assert r.trailer['/Root']['/ViewerPreferences']['/PrintScaling']=='/None'
 assert r.trailer['/Root']['/ViewerPreferences']['/Duplex']==duplex
 for p in r.pages:
  assert math.isclose(float(p.mediabox.width),pt(w),abs_tol=.02)
  assert math.isclose(float(p.mediabox.height),pt(h),abs_tol=.02)
  assert '/TrimBox' in p and '/BleedBox' in p
 print(name+': geometry, count and print preferences passed')
 return r

def compare(name,sides):
 r=inspect(name,len(sides),279.4,215.9)
 for page,side in zip(r.pages,sides):
  target=''.join(expected['logical'][n-1] if n<=len(expected['logical']) else '' for n in side['pages'])
  assert compact(page.extract_text())==compact(target),(name,side)
 return r

fronts=compare('manual-fronts-group2',expected['fronts']);backs=compare('manual-backs-group2',expected['backs'])
compare('reprint-front-sheet3',[s for s in expected['fronts'] if s['sheet']==3])
compare('reprint-back-sheet3',[s for s in expected['backs'] if s['sheet']==3])
compare('proof-fronts',expected['proofFronts']);compare('proof-backs',expected['proofBacks'])
calfront=inspect('calibration-front',2,279.4,215.9);calback=inspect('calibration-back',2,279.4,215.9)
inspect('calibration-auto',4,279.4,215.9,'/DuplexFlipShortEdge')
for actual,letters,side in [(calfront,['A','B'],'FRENTE'),(calback,['B','A'],'REVERSO')]:
 for page,letter in zip(actual.pages,letters):
  text=page.extract_text();assert letter in text and side in text and '100 mm' in text
# Verify transformation matrices, independently of the application renderer.
for r in (backs,calback):
 for page in r.pages:
  matrices=[list(map(float,a)) for a,op in ContentStream(page.get_contents(),r).operations if op==b'cm']
  assert any(abs(m[0]+1)<1e-6 and abs(m[3]+1)<1e-6 for m in matrices)
  assert any(abs(m[4]-pt(1.2))<.01 and abs(m[5]-pt(.8))<.01 for m in matrices)
loose=inspect('cover-loose-letter',2,215.9,279.4)
folded=inspect('cover-folded-letter',1,279.4,215.9)
short=PdfReader(ROOT/'short-booklet.pdf');assert len(short.pages)==2
assert short.trailer['/Root']['/ViewerPreferences']['/Duplex']=='/DuplexFlipShortEdge'
licensed=PdfReader(ROOT/'licensed-interior.pdf')
licensed_text=''.join(p.extract_text() for p in licensed.pages)
assert 'QA-ONLY-SERIAL-7' in licensed_text and 'fictional-activation-key' in licensed_text
assert 'fictional-activation-key' not in (ROOT/'licensed-edition.json').read_text()
assert 'fictional-activation-key' not in (ROOT/'manual-job.txt').read_text()
assert len(PdfReader(ROOT/'offline-interior.pdf').pages)>4

for name in ['calibration-front','calibration-back','manual-fronts-group2','manual-backs-group2','cover-loose-letter','cover-folded-letter','short-booklet']:
 subprocess.run(['pdftoppm','-f','1','-singlefile','-scale-to','1400','-png',str(ROOT/(name+'.pdf')),str(ROOT/('proof-'+name))],check=True,capture_output=True)
# Low-ink white covers must retain empty printer margins.
for name,w,h in [('cover-loose-letter',215.9,279.4),('cover-folded-letter',279.4,215.9)]:
 im=Image.open(ROOT/('proof-'+name+'.png')).convert('L');sx=im.width/w;sy=im.height/h
 assert im.crop((0,0,round(8*sx),im.height)).getextrema()[0]>=250
 assert im.crop((im.width-round(8*sx),0,im.width,im.height)).getextrema()[0]>=250
print('Home PDF inspection passed: exact selected pages, passes, calibration transforms, cover geometry, licensed copy and offline PDF.')
