import {test,expect} from '@playwright/test'
const scenarios=[['عيادة','20 كرسي انتظار لعيادة بالرياض','20'],['مطعم','علبة تغليف للطلبات','500'],['مكتب','جهاز كمبيوتر للموظفين','15'],['مقاولات','مواد سباكة وكهرباء لمشروع','1'],['غامض','أبي أجهز فرع جديد','1'],['رموز','<script>alert(1)</script> طلب 😃 & "','1']]
for(const width of [390,1440])for(const [name,text,qty]of scenarios)test(`${name} ${width}: mock review and back`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/?harness=new');
 await page.getByRole('radio',{name:/اكتب احتياجاتك/}).click();await page.getByLabel('البند',{exact:true}).fill(text);await page.getByLabel('الكمية',{exact:true}).fill(qty);await page.getByLabel('الكمية',{exact:true}).press('Enter');
 await expect(page.getByText(text,{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'التالي',exact:true}).click();await expect(page.getByRole('button',{name:'التالي: التوصيل',exact:true})).toBeVisible();
 await page.screenshot({path:`docs/qa/prelaunch/scenario-${width}-${name}.png`,fullPage:true});
 await page.getByRole('button',{name:'رجوع',exact:true}).click();await expect(page.getByText(text,{exact:true}).first()).toBeVisible();
})
