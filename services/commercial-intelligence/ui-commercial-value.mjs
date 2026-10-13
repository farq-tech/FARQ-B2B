import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
const out = process.env.FARQ_REVIEW_OUTPUT
if (!out || !path.isAbsolute(out)) throw new Error('OUTPUT_REQUIRED')
const browser = await chromium.launch({headless:true,channel:'chrome'})
const records=[];const errors=[]
try {
 for (const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:5194/commercial-review')
  for (const [id,goal,direction] of [['cups','مصنع أكواب ورقية يريد مقاهي مستقلة تشتري بالجملة','marketing'],['computers','شركة تبيع 500 جهاز كمبيوتر تبحث عن جهات لديها مشتريات مؤسسية','marketing'],['chairs','عيادة تبي 20 كرسي انتظار','purchase'],['doors','مصنع أبواب يبي موزعين ومقاولين','marketing']]) {
   await page.locator('select').first().selectOption(direction);await page.locator('textarea').fill(goal)
   const response=page.waitForResponse(r=>r.url().endsWith('/commercial/discover'))
   await page.getByRole('button',{name:direction==='marketing'?'ابحث عن مشترين':'ابحث عن بائعين'}).click()
   const data=await(await response).json()
   await page.getByRole('heading',{name:/مرشحون للمراجعة/}).waitFor()
   if (!data.commercial_context || data.potential.some(r=>!r.commercial_value || !r.display_identity) || data.execution_enabled!==false) throw new Error('COMMERCIAL_CONTEXT_MISSING')
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)
   if (overflow) throw new Error('OVERFLOW')
   await page.screenshot({path:path.join(out,`${id}-${width}.png`),fullPage:true})
   await page.locator('article').first().scrollIntoViewIfNeeded()
   await page.screenshot({path:path.join(out,`${id}-${width}-result.png`)})
   records.push({id,width,results:data.potential.length,contacts:data.potential.filter(r=>r.reachability.actual_values_available).length,overflow})
  }
  await context.close()
 }
 if(errors.length)throw new Error(errors.join(';'))
 fs.writeFileSync(path.join(out,'ui-validation.json'),JSON.stringify({records,errors,external_requests:'ABORTED',production_access:false},null,2))
 console.log(JSON.stringify(records))
}finally{await browser.close()}
