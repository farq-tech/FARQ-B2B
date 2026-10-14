import { expect, test, type Page } from '@playwright/test'
import { flowMatch, flowCatalog } from '../src/dev/fixtures'
import { parseRoute, routePath } from '../src/procurementContext'
const company = (id:string,name:string) => ({ poi_key:id,name_ar:name,name_en:null,category_ar:'أثاث وتجهيزات',category:null,city_en:'Riyadh',region_ar:'الرياض',district_ar:'النرجس',latitude:24.7+Number(id)/100,longitude:46.7+Number(id)/100,phone:'966512345678',has_whatsapp:true,email:null,source_count:1,sources:['qa_fixture'],reason:'بيانات اختبار معزولة — نشاط مطابق' })
async function setup(page:Page) {
  const writes:string[]=[]
  await page.addInitScript(() => {
    if (!localStorage.getItem('farq_construction_session_v1')) localStorage.setItem('farq_construction_session_v1',JSON.stringify({ accessToken:'qa-no-real-token',refreshToken:'qa-no-real-token',expiresAt:Math.floor(Date.now()/1000)+7200,user:{id:'qa-user',email:'abdulrhman@farq.sa',emailVerified:true,displayName:'اختبار'} }))
  })
  await page.route('**/_targeting/**',async route => {
    const path=new URL(route.request().url()).pathname
    if(path.endsWith('/facets')) return route.fulfill({json:{categories:[],size_available:false}})
    if(path.endsWith('/cities')) return route.fulfill({json:[{en:'Riyadh',ar:'الرياض',n:100},{en:'Jeddah',ar:'جدة',n:100}]})
    if(path.endsWith('/search')) { const body=route.request().postDataJSON(); return route.fulfill({json:{total:2,rows:body.q==='لا نتائج'?[]:[company('1','شركة الاختبار للأثاث'),company('2','مؤسسة الاختبار للتجهيزات')],parsed:{keywords:[body.q]},with_whatsapp:2,with_email:0,by_region:[]}}) }
    writes.push(path); return route.fulfill({status:403,json:{error:'QA_BLOCKED'}})
  })
  await page.route('**/_api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path.endsWith('/boq/match')) return route.fulfill({json:{ok:true,data:flowMatch(route.request().postDataJSON())}})
    if(path.includes('/catalog')) return route.fulfill({json:{ok:true,data:flowCatalog}})
    if(route.request().method()!=='GET') writes.push(path)
    return route.fulfill({status:503,json:{ok:false,error:{message:'QA: all unmocked writes blocked'}}})
  })
  return writes
}
for(const width of [390,1440]) {
  test(`شراء 20 كرسي: إدخال → مراجعة → نتائج → اختيار → تجهيز طلب (${width})`,async({page})=>{
    await page.setViewportSize({width,height:900});const writes=await setup(page)
    await page.goto('/explore');await page.getByLabel('المدينة',{exact:true}).selectOption('Riyadh')
    await page.getByLabel('البحث',{exact:true}).fill('20 كرسي عيادة')
    await page.getByRole('button',{name:'فهم الاحتياج والبحث'}).click()
    await expect(page.getByRole('heading',{name:'راجع احتياجك'})).toBeVisible()
    await expect(page.getByLabel('الكمية',{exact:true})).toHaveValue('20')
    await page.getByLabel('الوحدة',{exact:true}).fill('حبة')
    await page.getByRole('button',{name:'ابحث عن جهات لهذا البند'}).click()
    await page.locator('.farq-results').getByRole('button',{name:'أضف للاختيار'}).first().click()
    await page.getByRole('button',{name:'عرض الاختيارات'}).click()
    await page.getByRole('button',{name:'مراجعة الخطوة التالية'}).click()
    await page.screenshot({path:`docs/qa/b2b/purchase-review-${width}.png`,fullPage:true})
    await page.getByRole('button',{name:'جهّز طلب التسعير'}).click()
    await expect(page).toHaveURL(/\/new$/)
    await expect(page.getByText('كرسي عيادة',{exact:true})).toBeVisible()
    await page.getByRole('button', {name:'التالي',exact:true}).click()
    await page.getByRole('button', {name:'1 من 1 مورد',exact:true}).click()
    await expect(page.getByText('شركة الاختبار للأثاث',{exact:true}).first()).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(1)
    expect(writes).toEqual([])
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  })
  test(`بيع بالجملة: اختيار → حفظ فرصة → تأكيد الاحتياج → مراجعة عرض (${width})`,async({page})=>{
    await page.setViewportSize({width,height:900});const writes=await setup(page)
    await page.goto('/explore');await page.getByRole('button',{name:'أبي أبيع',exact:true}).click()
    await page.getByLabel('المدينة',{exact:true}).selectOption('Riyadh')
    await page.getByLabel('البحث',{exact:true}).fill('حليب بالجملة')
    await page.getByRole('button',{name:'فهم الاحتياج والبحث'}).click()
    await page.getByRole('button',{name:'ابحث عن جهات لهذا البند'}).click()
    await expect(page.getByText('مطابقة النشاط لا تعني وجود طلب شراء مؤكد.')).toBeVisible()
    await page.locator('.farq-results').getByRole('button',{name:'أضف للاختيار'}).first().click()
    await page.getByRole('button',{name:'عرض الاختيارات'}).click()
    await page.getByRole('button',{name:'مراجعة الخطوة التالية'}).click()
    await page.getByRole('button',{name:'احفظ الفرص في متابعتي'}).click()
    await page.getByRole('button',{name:/شركة الاختبار للأثاث/}).click()
    await page.getByLabel('ماذا أكد العميل؟').fill('أكد احتياجه إلى 100 كرتون')
    await page.getByLabel('الكمية',{exact:true}).fill('100');await page.getByLabel('الوحدة',{exact:true}).fill('كرتون')
    await page.getByRole('button',{name:'أكدت الاحتياج مع العميل'}).click()
    await page.getByLabel('سعر الوحدة قبل الضريبة والتوصيل').fill('20')
    await page.getByRole('button',{name:'راجع مسودة العرض'}).click()
    await expect(page.getByRole('heading',{name:'راجع قبل المشاركة'})).toBeVisible()
    await page.screenshot({path:`docs/qa/b2b/sales-review-${width}.png`,fullPage:true})
    expect(writes).toEqual([])
  })
  test(`اسم المورد يفتح مباشرة، والحفظ يستعيد الاختيارات (${width})`,async({page})=>{
    await page.setViewportSize({width,height:900});const writes=await setup(page)
    await page.goto('/explore');await page.getByLabel('المدينة',{exact:true}).selectOption('Riyadh')
    await page.getByLabel('البحث',{exact:true}).fill('شركة الاختبار للأثاث')
    await page.getByRole('button',{name:'بحث باسم الشركة',exact:true}).click()
    await expect(page.getByRole('heading',{name:'شركة الاختبار للأثاث',exact:true})).toBeVisible()
    await page.getByRole('button',{name:'أضف للاختيار',exact:true}).click()
    await page.reload();await page.getByRole('button',{name:'كمل من حيث توقفت'}).click()
    await expect(page.getByRole('button',{name:'عرض الاختيارات'})).toBeVisible()
    await page.screenshot({path:`docs/qa/b2b/explore-${width}.png`,fullPage:true})
    expect(writes).toEqual([])
    const overflow=await page.locator('.farq-glass-button').evaluateAll(buttons=>buttons.filter(b=>b.scrollWidth>b.clientWidth+2).map(b=>b.textContent))
    expect(overflow).toEqual([])
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  })
}
test('Routes preserve existing request links and add B2B sections',()=>{
 for(const view of ['account','opportunities','targeting','explore'] as const) expect(parseRoute(routePath(view,null)).view).toBe(view)
 // Figma IA: /targeting is the supplier campaign (map); the goal-based Explore lives at /explore.
 expect(parseRoute('/explore').view).toBe('explore')
})
test('Empty results offer recovery and keep selected entities',async({page})=>{
 await setup(page);await page.goto('/explore');await page.getByLabel('المدينة',{exact:true}).selectOption('Riyadh');await page.getByLabel('البحث',{exact:true}).fill('لا نتائج');await page.getByRole('button',{name:'بحث باسم الشركة',exact:true}).click();await expect(page.getByRole('heading',{name:'ما لقينا نتائج ضمن هذه الشروط'})).toBeVisible();await page.getByRole('button',{name:'تعديل البحث والفلاتر'}).click();await expect(page.getByLabel('البحث',{exact:true})).toBeFocused()
})

for (const width of [390, 1440]) {
  test(`صفحة البداية والدخول بنفس الهوية (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route(/wa\.me|api\.whatsapp\.com/, route => route.abort())
    await page.goto('/')
    await page.locator('footer').waitFor()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(await page.locator('header .farq-wordmark').textContent()).toBe('FARQB2B')
    expect(await page.locator('.landing-layers').evaluate(el => getComputedStyle(el).getPropertyValue('--brand-deep').trim())).toBe('#24583f')
    await page.screenshot({ path: `docs/qa/b2b/landing-${width}.png` })
    await page.goto('/requests')
    await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible()
    await expect(page.getByLabel('كلمة المرور')).toBeVisible()
    await expect(page.getByRole('button', { name: 'دخول', exact: true })).toBeDisabled()
    await page.screenshot({ path: `docs/qa/b2b/login-${width}.png` })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('link', { name: 'العودة إلى صفحة البداية' }).click()
    await expect(page.locator('h1')).toContainText('قل لنا')
  })
}

test('purchase sends only selected company after explicit consent and paid WhatsApp confirmation', async ({page}) => {
  await setup(page)
  await page.addInitScript(target => {
    localStorage.setItem('farq.b2b.qa-user.purchase-seed.v1',JSON.stringify({lines:[{name:'كرسي عيادة',qty:'20',unit:'حبة',spec:''}],city:'الرياض',targets:[target]}))
    localStorage.setItem('farq.b2b.qa-user.profile.v1',JSON.stringify({name:'عيادة اختبار',phone:'+966501234568',city:'الرياض',email:'buyer@example.com'}))
  },company('1','شركة الاختبار للأثاث'))
  const requests:Array<{path:string,body:Record<string,unknown>}>=[]
  await page.route('**/_api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    const body=route.request().method()==='POST'?route.request().postDataJSON():{}
    if(route.request().method()==='POST')requests.push({path,body})
    let data:unknown
    if(path.endsWith('/b2b/capabilities'))data={general_requests:true,sales_dispatch:false}
    else if(path.endsWith('/suppliers/import'))data={imported:[{id:'user-selected-company'}],imported_count:1}
    else if(path.endsWith('/rfqs'))data={id:'00000000-0000-4000-8000-000000000001'}
    else if(path.endsWith('/whatsapp/pricing'))data={enabled:true,price_sar:.17}
    else if(path.endsWith('/dispatch'))data={state:'DONE',total:1,processed:1,sent:1,failed:0}
    else if(path.endsWith('/rfqs/00000000-0000-4000-8000-000000000001'))data={id:'00000000-0000-4000-8000-000000000001',invitations:[{id:'qa-invite',preferred_channel:'WHATSAPP',supplier:{id:'user-selected-company'}}]}
    else return route.fulfill({status:503,json:{ok:false,error:{message:'Unmocked request blocked'}}})
    return route.fulfill({json:{ok:true,data}})
  })
  await page.goto('/new')
  await page.getByRole('button',{name:'التالي',exact:true}).click()
  await page.getByRole('button',{name:'التالي: التوصيل',exact:true}).click()
  await expect(page.getByText('طلب أعمال · جهات اخترتها')).toBeVisible()
  await page.getByRole('button',{name:'التالي: الإرسال',exact:true}).click()
  expect(requests).toEqual([])
  await page.getByRole('button',{name:'أرسل الطلب',exact:true}).click()
  await expect(page.getByRole('alertdialog')).toContainText('0.17')
  expect(requests.some(r=>r.path.endsWith('/dispatch'))).toBe(false)
  const created=requests.find(r=>r.path.endsWith('/rfqs'))!.body
  expect(created.selected_supplier_ids).toEqual(['user-selected-company'])
  expect(created.request_origin).toBe('farq-b2b')
  expect(created.engineering_department).toBe('GENERAL')
  expect(created.manual_send).toBe(true)
  expect((created.lines as Array<Record<string,unknown>>)[0]).toMatchObject({name_ar:'كرسي عيادة',quantity:20,uom:'حبة',farq_spec_id:null})
  await page.getByRole('button',{name:'نعم، أرسل عبر واتساب',exact:true}).click()
  await expect(page.getByText('تم الإرسال لـ 1 من 1')).toBeVisible()
  expect(requests.filter(r=>r.path.endsWith('/dispatch'))).toHaveLength(1)
  expect(requests.find(r=>r.path.endsWith('/dispatch'))!.body.whatsapp_paid).toBe(true)
})

for (const width of [390,1440]) test(`تحميل كل الصفحات والفلاتر وطبقة كل النقاط (${width})`,async({page})=>{
  await page.setViewportSize({width,height:900});await setup(page)
  const calls:any[]=[]
  await page.route('**/_targeting/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path.endsWith('/cities')) return route.fulfill({json:[{en:'Riyadh',ar:'الرياض',n:100}]})
    if(path.endsWith('/facets'))return route.fulfill({json:{categories:[{value:'Shopping',label:'تجارة',count:65,subcategories:[{value:'Tiles',label:'بورسلان',count:65}]}],size_available:false}})
    if(path.endsWith('/search')) {
      const b=route.request().postDataJSON();calls.push(b)
      const count=b.filters?.name_only?7:65;const offset=b.offset||0
      return route.fulfill({json:{total:count,has_more:offset+30<count,next_offset:offset+30<count?offset+30:null,rows:Array.from({length:Math.min(30,count-offset)},(_,i)=>({...company(String(offset+i+1),`شركة بورسلان ${offset+i+1}`),match_confidence:{score:85,basis:'دليل النشاط وليس توفر المنتج',method:'activity_evidence_heuristic_not_probability'},keyword_name_match:true})),parsed:{},with_whatsapp:count,with_email:0,by_region:[]}})
    }
    if(path.endsWith('/map-query')){calls.push(route.request().postDataJSON());return route.fulfill({json:{total:1500,located_total:1400,map_query:'a'.repeat(32),rows:[],parsed:{}}})}
    return route.fulfill({status:403,json:{error:'QA_BLOCKED'}})
  })
  await page.goto('/explore');await page.getByLabel('المدينة',{exact:true}).selectOption('Riyadh')
  await page.getByLabel('البحث',{exact:true}).fill('بورسلان');await page.getByRole('button',{name:'بحث باسم الشركة',exact:true}).click()
  await expect(page.locator('.farq-results article')).toHaveCount(30)
  await page.getByRole('button',{name:'تحميل جهات أخرى'}).click();await expect(page.locator('.farq-results article')).toHaveCount(60)
  await page.getByRole('button',{name:'تحميل جهات أخرى'}).click();await expect(page.locator('.farq-results article')).toHaveCount(65)
  await expect(page.getByRole('button',{name:'تحميل جهات أخرى'})).toHaveCount(0)
  expect(calls.filter(c=>c.objective).map(c=>c.offset)).toEqual([0,30,60])
  await page.getByText('التصنيفات وفلاتر الجهات',{exact:true}).click()
  await page.getByLabel('التصنيف الرئيسي',{exact:true}).selectOption('Shopping');await page.getByLabel('التصنيف الفرعي',{exact:true}).selectOption('Tiles');await page.getByLabel('نوع المنشأة',{exact:true}).selectOption('company')
  await page.getByLabel('الأسماء التي تحتوي البحث فقط').check();await page.getByLabel('كلمة البحث في الاسم أولًا').check()
  await page.getByRole('button',{name:'تطبيق الفلاتر',exact:true}).click();await expect(page.locator('.farq-results article')).toHaveCount(7)
  expect(calls.at(-1).filters).toMatchObject({category:'Shopping',subcategory:'Tiles',entity_type:'company',name_only:true,sort:'name_first'})
  await page.getByRole('button',{name:'كل نقاط السجل',exact:true}).click();await expect(page.getByText(/١٬٥٠٠ جهة وفق الفلاتر/)).toBeVisible()
  expect(calls.at(-1).filters).toMatchObject({category:'Shopping',subcategory:'Tiles',entity_type:'company'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
