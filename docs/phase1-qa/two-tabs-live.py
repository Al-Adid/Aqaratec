import asyncio,json,uuid
from pathlib import Path
from playwright.async_api import async_playwright
OUT=Path('/home/ubuntu/reports/phase1-closure/evidence/two-tabs-live.json')
SCOPE='qa-two-tabs-'+str(uuid.uuid4())
SETUP='''async (workspaceId)=>{const m=await import('/src/lib/prototype-workspace-storage.ts');const d=await import('/src/lib/demo-data.ts');const scope={userId:null,identityState:'guest',localWorkspaceId:workspaceId};let go;const barrier=new Promise(r=>go=r);window.__qaGo=go;window.__qaResult=(async()=>{await barrier;const startedAt=Date.now();const r=await m.writePrototypeWorkspaceGuarded(localStorage,scope,d.createDemoState(),0);return {ok:r.ok,reason:r.ok?null:r.reason,generation:r.ok?r.metadata.generation:null,startedAt};})();window.__qaRead=()=>{const r=m.loadPrototypeWorkspace(localStorage,scope);return {kind:r.kind,generation:r.metadata.generation,scope};};return {locks:!!navigator.locks,secure:isSecureContext};}'''
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-background-networking'])
  context=await browser.new_context()
  async def allow_only_local(route):
   if route.request.url.startswith('http://127.0.0.1:3000/') and '/api/' not in route.request.url:await route.continue_()
   else:await route.abort()
  await context.route('**/*',allow_only_local)
  pages=[await context.new_page(),await context.new_page()]
  try:
   await asyncio.gather(*(x.goto('http://127.0.0.1:3000/manus-routes.json') for x in pages))
   readiness=await asyncio.gather(*(x.evaluate(SETUP,SCOPE) for x in pages))
   await asyncio.gather(*(x.evaluate('window.__qaGo()') for x in pages))
   results=await asyncio.gather(*(x.evaluate('window.__qaResult') for x in pages))
   loaded=await pages[0].evaluate('window.__qaRead()')
   report={'tested':True,'engine':'Chromium isolated headless via Playwright','realPages':len(context.pages),'fictionalScope':SCOPE,'readiness':readiness,'results':results,'oneWinner':sum(x['ok'] for x in results)==1,'oneConflict':sum(x['reason']=='generation-conflict' for x in results)==1,'validEnvelope':loaded['kind']=='ready','generation':loaded['generation'],'realAccountsTested':False,'twoDevicesTested':False,'productionDatabaseTouched':False,'externalRequestsBlocked':True}
   OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2));assert report['oneWinner'] and report['oneConflict'] and report['validEnvelope'] and report['generation']==1
  finally:await context.close();await browser.close()
asyncio.run(main())
