"""Contextual commercial usefulness over existing candidates; never proof of demand.
Quantity, customer type and trade channel are query context, not entity attributes.
"""
import re
from identity import normalize

DIGITS=str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789')
def understand(text,direction,city=''):
 q=normalize(text.translate(DIGITS));numbers=re.findall(r'(?<!\w)(\d[\d,٬]*)(?:\s*(جهاز|كرسي|كراسي|كوب|قطعه|وحده|حبه|باب|متر|طن|كيلو))?',q)
 quantities=[{'value':int(n.replace(',','').replace('٬','')),'unit':u or None} for n,u in numbers]
 retail=bool(re.search(r'تجز[يئ]ه|retail',q));wholesale=bool(re.search(r'جمله|wholesale|bulk',q));institutional=bool(re.search(r'مؤسسي|موسسي|مشتريات مركزي|مقاولين كبار|مقاول كبير',q))
 independent=bool(re.search(r'مستقل|independent',q));targets=[]
 # Explicit recipients reuse source activity vocabulary; they do not establish buying.
 for pattern,terms,label in [
  (r'مقاهي|مقاه|كافيه', ['cafe','coffee shop','مقهى','مقهي','كافيه'],'مقاهٍ'),
  (r'موزع', ['distributor','wholesaler','موزع','تجارة الجملة'],'موزعون'),
  (r'مقاول', ['construction company','contractor','مقاولات','مقاول'],'مقاولون'),
  (r'(?:عن|لـ|ل)\s*(?:محلات|متاجر) زهور', ['florist','flower shop','محل زهور','ورد'],'محلات زهور')]:
  if re.search(pattern,q):targets.append({'label':label,'terms':terms})
 if not targets:
  explicit=re.search(r'(?:استهدف|ابحث عن مشترين من|ابحث عن عملاء من|ابحث عن)\s+(.+)',q)
  if explicit:
   label=re.split(r'\s+(?:بالجمله|في|بمدينه|تشتري|يشترون)',explicit[1])[0]
   label=re.sub(r'^(?:محلات|متاجر|شركات|مؤسسات)\s+','',label).strip()
   if label and label not in ['عملاء','مشترين','جهات','موردين']:targets.append({'label':label,'terms':[label]})
 # Isolate offered item from target/usage narrative before invoking existing interpreter.
 item=re.split(r'يريد|تبحث عن|ابحث عن|وأبحث عن|يبي موزعين|لمقاولين|للمقاولين',text)[0]
 item=re.sub(r'^(?:مصنع|شركة|شركه|عيادة|عياده)\s*','',item)
 item=re.sub(r'^(?:تبيع|ابيع|أبيع|تبي|أحتاج|احتاج|أشتري|اشتري)\s*','',item)
 item=re.sub(r'\d[\d,٬]*',' ',item.translate(DIGITS)).strip()
 return {'product_text':item or text,'direction':direction,'city':city,'quantities':quantities,'trade_channel':'MIXED' if retail and wholesale else 'WHOLESALE' if wholesale else 'RETAIL' if retail else 'UNSPECIFIED','requesting_establishment':'MANUFACTURER' if re.search(r'مصنع|factory|manufacturer',q) else 'CLINIC' if re.search(r'^عياده',q) else 'COMPANY_UNSPECIFIED_SIZE' if re.search(r'^شركه',q) else 'UNSPECIFIED','institutional_procurement':institutional or any(n['value']>=100 and n['unit'] in ['جهاز','كرسي','كراسي','كوب','قطعه','وحده','حبه','باب'] for n in quantities),'independent_requested':independent,'target_activities':targets,'capacity_requirement':'INFERRED_FROM_QUERY_NOT_CONFIRMED','current_demand':'REQUIRES_DATED_PRODUCT_SPECIFIC_REQUEST'}

def target_intent(context,fallback):
 if context['direction']!='marketing' or not context['target_activities']:return fallback
 terms=[t for target in context['target_activities'] for t in target['terms']]
 return {**fallback,'key':'explicit_buyer_activity','seller':terms,'exclude':[],'label':'نشاط مستهدف اختاره المستخدم؛ الملاءمة التجارية محتملة وليست طلب شراء'}

def rerank(rows,context):
 out=[]
 for row in rows:
  text=normalize(str(row.get('name',''))+' '+str(row.get('source_activity',''))+' '+str(row.get('evidence_excerpt','')))
  reasons=[];adjust=0;segment='UNRESOLVED';scope='UNRESOLVED'
  individual=bool(re.search(r'فني|معلم|technician|handyman|individual',text))
  institution=bool(re.search(r'university|college|school|hospital|جامعه|مدرسه|مستشفى|construction company|مقاولات|government|procurement',text))
  wholesale=bool(re.search(r'wholesal|distribut|مصنع|موزع|جمله',text))
  if individual:segment='INDIVIDUAL_SERVICE_PROVIDER_SOURCE_SIGNAL'
  elif institution:segment='INSTITUTIONAL_USE_SOURCE_SIGNAL'
  elif wholesale:segment='TRADE_DISTRIBUTION_SOURCE_SIGNAL'
  if context['institutional_procurement']:
   if re.search(r'headquarters|مشتريات|المقر الرئيسي',normalize(row.get('name',''))) or (re.search(r'كمبيوتر|حاسب',normalize(context['product_text'])) and re.search(r'university|جامعه|college|كليه|hospital|مستشفى|corporate office',normalize(row.get('name','')))):adjust+=10;reasons.append('استخدام مؤسسي واسع مرجح من نوع النشاط؛ لا إثبات للميزانية أو القدرة على استيعاب الكمية')
   elif re.search(r'primary school|elementary|ابتدايي|ابتدائي|تحفيظ',text):adjust-=10;reasons.append('النشاط التعليمي المحدود أقل أولوية لعرض كبير؛ حجم المنشأة الفعلي غير مثبت')
   if individual:adjust-=18;reasons.append('حجم الطلب مؤسسي؛ إشارة المصدر لفني فردي أقل ملاءمة')
   elif institution:adjust+=12;reasons.append('استخدام مؤسسي مناسب لحجم العرض؛ كمية الشراء الفعلية غير مثبتة')
  if context['trade_channel']=='RETAIL' and context['direction']=='purchase' and re.search(r'store|متجر|محل',text):adjust+=5;reasons.append('إشارة متجر مناسبة لطلب التجزئة؛ توفر الكمية غير مثبت')
  if context['trade_channel']=='WHOLESALE':
   if context['direction']=='purchase' and wholesale:adjust+=12;reasons.append('المصدر يشير للجملة أو التوزيع')
   elif context['direction']=='marketing':reasons.append('الجملة مطلوبة؛ استهلاك العميل وكميات شرائه غير مثبتة')
  group=row.get('commercial_group') or {}
  chain=bool(re.search(r'dunkin|starbucks|دانكن|دنكن|ستاربكس|barns|بارنز|tim hortons|تيم هورت',text)) or (group.get('source_locality_count',0)>3)
  if context['independent_requested'] and chain:
   # Commercial targeting exclusion only; no deletion/identity merge.
   row['commercial_exclusion']='CHAIN_OR_MULTI_LOCALITY_SIGNAL_INDEPENDENCE_UNCONFIRMED';continue
  if context['independent_requested']:reasons.append('نشاط مقهى مطابق؛ استقلال الملكية يحتاج تحققًا')
  if re.search(r'head office|headquarters|المقر الرييسي|المقر الرئيسي|اداره المشتريات',text):scope='CENTRAL_OFFICE_SOURCE_SIGNAL';adjust+=6 if context['institutional_procurement'] else 0
  elif row.get('district'):scope='LOCAL_RECORD_NOT_PROVEN_BRANCH'
  targets=context['target_activities']
  matched=[t['label'] for t in targets if any(normalize(w) in text for w in t['terms'])]
  if matched:adjust+=8;reasons.append('مطابق للجهات المطلوبة: '+'، '.join(matched))
  kind=row.get('evidence_kind','');current=kind=='FIRST_PARTY_PUBLIC_OPEN_REQUEST';historical='HISTOR' in kind
  relation='POTENTIAL_RESALE_BUYER' if context['direction']=='marketing' and wholesale else 'POTENTIAL_PROJECT_USER' if context['direction']=='marketing' and re.search(r'مقاول|contractor|construction',text) else 'POTENTIAL_BUSINESS_USER' if context['direction']=='marketing' else 'POTENTIAL_SERVICE_PROVIDER' if row.get('commercial_function')=='service_provider' else 'POTENTIAL_SUPPLIER'
  row['commercial_value']={'relationship_type':relation,'base_score':row.get('score',0),'adjustment':adjust,'score':round((row.get('score') or 0)+adjust,3),'segment':segment,'procurement_scope':scope,'quantity_capacity':'UNCONFIRMED','relationship_state':'PUBLISHED_REQUEST_MATCH_REQUIRES_SCOPE_REVIEW' if current else 'HISTORICAL' if historical else 'POTENTIAL' if context['direction']=='marketing' else 'SOURCE_SUPPORTED_OFFER' if row.get('level') in ['A','B'] else 'POTENTIAL','reasons':reasons or ['ترشيح النشاط الحالي؛ لا دليل مستقل على حجم التعامل'],'evidence_source':row.get('source_url') or row.get('source_ref'),'evidence_date':row.get('observed_at')}
  row['score']=row['commercial_value']['score'];out.append(row)
 return sorted(out,key=lambda r:(-(r.get('score') or 0),str(r.get('id',''))))

def annotate_result(result,text,direction,city):
 context=understand(text,direction,city);result['commercial_context']=context
 for key in ['main','expansion']:
  for row in result.get(key,[]):
   # Preserve ranking previously performed across full candidate window.
   if not row.get('commercial_value'):rerank([row],context)
   raw=row.get('name','');group=row.get('commercial_group') or {}
   display=row.get('commercial_identity',{}).get('display_name') or raw
   branch_match=re.search(r'\s+(?:فرع|branch)\s+(.+)$',display,re.I)
   brand=display[:branch_match.start()].strip() if branch_match else None
   display=brand or display
   row['display_identity']={'display_name':display,'original_name':raw,'brand':brand,'branch_label':' — '.join(filter(None,[branch_match[1] if branch_match else None,row.get('city'),row.get('district')])),'legal_merge':False,'procurement_scope':row.get('commercial_value',{}).get('procurement_scope','UNRESOLVED')}
 return result
