import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { directoryFacets, mapQuery, mapProfile, type DirectoryFacets, type SearchFilters, listCities, searchTargets, type City, type TargetRow, type TargetSearch, waNumber } from '../api/targetingClient'
import { useProcurement } from '../procurementContext'
import { Icon } from '../ui'
import { FarqGlassButton as Action } from '../ui/FarqGlassButton'
import { readBooklet, type BookletLine } from '../lib/readBooklet'
import TargetMap from '../pages/targeting/TargetMap'
import { readLocal, writeLocal, saveOpportunities, type ExploreDraft, type GoalMode } from './storage'

const MapboxMap = lazy(() => import('../pages/targeting/MapboxMap'))
const nameOf = (r: TargetRow) => r.name_ar || r.name_en || 'جهة بدون اسم'
const CATEGORIES = ['أثاث وتجهيزات', 'منتجات غذائية', 'خدمات تقنية', 'معدات طبية', 'مواد بناء', 'خدمات أعمال']
type Stage = 'start' | 'understood' | 'results' | 'profile' | 'selection' | 'review'
const emptyDraft: ExploreDraft = { q: '', city: '', mode: 'purchase', lines: [], selected: [], updatedAt: '' }
const normalized = (text: string) => text.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim()

/** One state owns both map and list; directory contacts are never represented as confirmed demand. */
export default function Explore() {
  const { navigate } = useProcurement()
  const [saved] = useState(() => readLocal<ExploreDraft>('explore', emptyDraft))
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<GoalMode>(() => { try { return sessionStorage.getItem('farq-entry-goal') === 'marketing' ? 'marketing' : 'purchase' } catch { return 'purchase' } })
  const [city, setCity] = useState(saved.city || '')
  const [cities, setCities] = useState<City[]>([])
  const [cityError, setCityError] = useState(false)
  const [stage, setStage] = useState<Stage>('start')
  const [lines, setLines] = useState<BookletLine[]>([])
  const [selected, setSelected] = useState<TargetRow[]>([])
  const [focused, setFocused] = useState<TargetRow | null>(null)
  const [resultKind,setResultKind]=useState<GoalMode|'name'|'browse'>('purchase')
  const [result, setResult] = useState<TargetSearch | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [storageError, setStorageError] = useState(false)
  const [message, setMessage] = useState('')
  const [suggestions, setSuggestions] = useState<TargetRow[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [listMode, setListMode] = useState(false)
  const [sheet, setSheet] = useState<'mini' | 'half' | 'full'>('half')
  const [contactFilter, setContactFilter] = useState('all')
  const [filters,setFilters]=useState<SearchFilters>({})
  const [facets,setFacets]=useState<DirectoryFacets|null>(null)
  const [allPoints,setAllPoints]=useState(false)
  const [pointScope,setPointScope]=useState('city')
  const [catalogQuery,setCatalogQuery]=useState<string>()
  const [catalogCount,setCatalogCount]=useState(0)
  const [locatedCount,setLocatedCount]=useState(0)
  const [tileBusy,setTileBusy]=useState(false)
  const [shown, setShown] = useState(30)
  const [area, setArea] = useState<[number, number, number, number] | null>(null)
  const [pendingArea, setPendingArea] = useState<[number, number, number, number] | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const activeSearch = useRef<{text:string; kind:GoalMode|'name'|'browse'; city:string; filters:SearchFilters} | null>(null)
  const cityName = cities.find(c => c.en === city)?.ar || city
  const snapshot = (): ExploreDraft => ({ q, city, mode, lines, selected, updatedAt: new Date().toISOString() })

  useEffect(() => {
    let active = true
    listCities().then(value => { if (active) { setCities(value); setCityError(false) } }, () => { if (active) setCityError(true) })
    return () => { active = false; generation.current++ }
  }, [])
  useEffect(() => {
    if (!q && !selected.length && !lines.length) return
    setStorageError(!writeLocal('explore', { q, city, mode, lines, selected, updatedAt: new Date().toISOString() }))
  }, [q, city, mode, lines, selected])
  // Name suggestions use the directory's literal search, independently of purchase/marketing matching.
  useEffect(() => {
    let active = true
    setSuggestions([])
    if (!suggestOpen || q.trim().length < 3 || !city) return
    const timer = window.setTimeout(() => {
      searchTargets(q.trim(), city, 8, 'name').then(r => {
        if (active) setSuggestions(r.rows.filter(row => normalized(nameOf(row)).includes(normalized(q))).slice(0, 4))
      }, () => { /* Optional suggestions must not block submitting the search. */ })
    }, 400)
    return () => { active = false; window.clearTimeout(timer) }
  }, [q, city, suggestOpen])

  useEffect(()=>{let active=true;setFacets(null);setAllPoints(false);setCatalogQuery(undefined);if(city)directoryFacets(city).then(r=>{if(active)setFacets(r)},()=>{});return()=>{active=false}},[city])
  async function showAllPoints(refresh=false,scope=pointScope){
    if(!city){setError('اختر المدينة أولًا.');return}
    if(allPoints&&!refresh){setAllPoints(false);return}
    setTileBusy(true);setError(''); const cityAtStart=city; const id=generation.current
    try{const r=await mapQuery(scope==='all'?'*':city,{...filters,keyword:q.trim(),contact:contactFilter});if(id!==generation.current||cityAtStart!==city)return;setCatalogQuery(r.map_query);setCatalogCount(r.total);setLocatedCount(r.located_total||0);setAllPoints(true)}catch(err){setError(err instanceof Error?err.message:'تعذّر تحميل طبقة النقاط')}finally{setTileBusy(false)}
  }
  async function openTile(key:string){const query=allPoints?catalogQuery:result?.map_query;if(!query||!key)return;const id=generation.current;try{const r=await mapProfile(query,key);if(id===generation.current)openProfile(r.row)}catch(err){setError(err instanceof Error?err.message:'تعذّر فتح الجهة')}}
  function changeMode(value: GoalMode) {
    generation.current++; setBusy(false); setLoadingMore(false); setMode(value); setResult(null); setFocused(null); setSelected([]); setStage('start'); setError(''); setArea(null); setPendingArea(null)
  }
  async function runSearch(text = q, kind: GoalMode | 'name' | 'browse' = mode, applied:SearchFilters = filters) {
    if (!city) { setError('اختر المدينة لتحديد نطاق البحث.'); return }
    if (kind!=='browse' && text.trim().length < 3) { setError('اكتب احتياجك أو اسم الشركة بثلاثة أحرف على الأقل.'); input.current?.focus(); return }
    const id = ++generation.current
    setBusy(true); setLoadingMore(false); setError(''); setSuggestOpen(false); setNote(''); setArea(null); setPendingArea(null)
    const scope={...applied,keyword:text.trim(),contact:applied.contact||contactFilter};activeSearch.current={text:text.trim(),kind,city,filters:scope};setAllPoints(false)
    try {
      const r = await searchTargets(text.trim(), city, 30, kind,0,scope)
      if (id !== generation.current) return
      setResult(r);setResultKind(kind); setShown(30); setStage('results'); setFocused(null)
      if (kind === 'name') {
        const exact = r.rows.find(row => normalized(nameOf(row)) === normalized(text))
        if (exact) { setFocused(exact); setStage('profile') }
      }
    } catch (err) { if (id === generation.current) setError(err instanceof Error ? err.message : 'تعذّر البحث. حاول مرة ثانية.') }
    finally { if (id === generation.current) setBusy(false) }
  }
  async function loadMore() {
    const search=activeSearch.current
    if (!search || loadingMore || busy || !result?.has_more || result.next_offset == null) return
    const id=generation.current
    setLoadingMore(true); setError('')
    try {
      const next=await searchTargets(search.text,search.city,30,search.kind,result.next_offset,search.filters)
      if (id!==generation.current) return
      setResult(current=>current ? {...next,map_query:current.map_query,rows:[...current.rows,...next.rows.filter(row=>!current.rows.some(old=>old.poi_key===row.poi_key))]} : next)
      setShown(current=>current+30)
    } catch (err) { if (id===generation.current) setError(err instanceof Error ? err.message : 'تعذّر تحميل بقية النتائج. حاول مرة ثانية.') }
    finally { if (id===generation.current) setLoadingMore(false) }
  }
  function understand() {
    if (!city || q.trim().length < 3) { void runSearch(); return }
    setSuggestOpen(false); setError('')
    if (!lines.length) {
      // An editable reading of what the user typed, never an invented AI extraction.
      const latin = q.replace(/[٠-٩]/g, n => String('٠١٢٣٤٥٦٧٨٩'.indexOf(n)))
      const qty = latin.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s)/)?.[1] || ''
      setLines([{ name: q.trim().replace(/^[٠-٩0-9]+(?:[.][٠-٩0-9]+)?\s+/, ''), qty, unit: '', spec: '' }])
    }
    setStage('understood')
  }
  async function upload(files: File[]) {
    if (!files.length) return
    const id = ++generation.current; setBusy(true); setError('')
    try {
      if (files.some(f => f.size > 25 * 1024 * 1024)) throw new Error('حد الملف 25 ميجابايت. اختر ملفًا أصغر.')
      const read = await readBooklet(files, setNote)
      if (id !== generation.current) return
      if (!read.length) throw new Error('لم نجد بنودًا واضحة. جرّب ملفًا آخر أو اكتبها مباشرة.')
      setLines(read); setQ(read[0].name); setStage('understood'); setNote('راجع البنود المستخرجة وعدّلها قبل البحث.')
    } catch (err) { if (id === generation.current) setError(err instanceof Error ? err.message : 'تعذّرت قراءة الملف.') }
    finally { if (id === generation.current) setBusy(false); if (file.current) file.current.value = '' }
  }
  function toggle(row: TargetRow) {
    setSelected(current => current.some(r => r.poi_key === row.poi_key) ? current.filter(r => r.poi_key !== row.poi_key) : [...current, row])
  }
  function openProfile(row: TargetRow) { setFocused(row); setStage('profile'); setSheet('half'); setSuggestOpen(false) }
  function review() {
    setStage('review'); setSheet('full')
    setMessage(mode === 'purchase' ? `السلام عليكم، نرغب بعرض سعر لـ ${lines.map(l => `${l.name}${l.qty ? ` · ${l.qty} ${l.unit}` : ''}`).join('، ') || q}، للتوريد إلى ${cityName}. نرجو توضيح المواصفات والضريبة والتوصيل ومدة التوريد.` : `السلام عليكم، نقدم ${q} في ${cityName}. هل لديكم احتياج لهذا المنتج؟ نرسل التفاصيل بعد تأكيد اهتمامكم.`)
  }
  const keys = useMemo(() => new Set(selected.map(row => row.poi_key)), [selected])
  const mapRows=useMemo(()=>[...(result?.rows || []),...selected.filter(row=>!result?.rows.some(r=>r.poi_key===row.poi_key)),...(focused&&!result?.rows.some(r=>r.poi_key===focused.poi_key)&&!selected.some(r=>r.poi_key===focused.poi_key)?[focused]:[])],[result,selected,focused])
  const rows = result?.rows || []
  const reason = (row: TargetRow) => row.reason || (row.match === 'product' ? 'المنتج مذكور في بيانات الجهة' : row.category_ar || row.category ? `النشاط المسجل: ${row.category_ar || row.category}` : 'مطابقة من البحث؛ تحقق من التخصص قبل التواصل')
  const confidence = (row: TargetRow) => row.match_confidence && <span className="farq-confidence" title={row.match_confidence.basis}>ثقة المطابقة <b>{row.match_confidence.score}%</b></span>
  const card = (row: TargetRow) => <article key={row.poi_key} className={`farq-entity ${focused?.poi_key === row.poi_key ? 'is-focused' : ''}`}>
    <button className="farq-entity-title" type="button" onClick={() => openProfile(row)}><span className="farq-entity-avatar"><Icon name="building" size={20} /></span><span><strong>{nameOf(row)}</strong><small>{[row.district_ar || row.district_en, row.city_en === city ? cityName : row.city_en].filter(Boolean).join(' · ') || 'الموقع غير مكتمل'}</small></span></button>
    <p className="farq-evidence"><Icon name="check" size={16} />{reason(row)}</p>
    {confidence(row)}{row.keyword_name_match && <small className="farq-confidence">عبارة البحث في الاسم</small>}
    <div className="farq-card-bottom"><span className="farq-muted">{waNumber(row) ? 'واتساب' : row.email ? 'إيميل' : 'قناة التواصل غير متاحة'}</span><Action variant="ghost" showIcon={false} aria-pressed={keys.has(row.poi_key)} onClick={() => toggle(row)}>{keys.has(row.poi_key) ? '✓ ضمن الاختيار' : 'أضف للاختيار'}</Action></div>
  </article>

  return <div className={`farq-explore ${listMode ? 'list-mode' : ''}`}>
    <div className="farq-explore-top">
      <div className="farq-mode" aria-label="هدفك"><Action variant={mode === 'purchase' ? 'primary' : 'secondary'} showIcon={false} aria-pressed={mode === 'purchase'} onClick={() => changeMode('purchase')}>أبي أشتري</Action><Action variant={mode === 'marketing' ? 'primary' : 'secondary'} showIcon={false} aria-pressed={mode === 'marketing'} onClick={() => changeMode('marketing')}>أبي أبيع</Action></div>
      <label className="farq-location"><Icon name="map-pin" size={18} /><span className="sr-only">المدينة</span><select aria-label="المدينة" value={city} onChange={e => { generation.current++; setBusy(false); setCity(e.target.value); setResult(null); setStage('start'); setArea(null); setPendingArea(null) }}><option value="">اختر المدينة</option>{cities.map(c => <option key={c.en} value={c.en}>{c.ar || c.en}</option>)}</select></label>
    </div>
    <div className="farq-discovery">
      <div className="farq-map" aria-label="خريطة نتائج الاستكشاف">
        <Suspense fallback={<p role="status">جارٍ تحميل الخريطة…</p>}>
          {import.meta.env.VITE_MAPBOX_TOKEN ? <MapboxMap rows={mapRows} selected={keys} focusedKey={focused?.poi_key} onToggle={openProfile} onViewportChange={setPendingArea} tileQuery={allPoints?catalogQuery:result?.map_query} onTileClick={key=>void openTile(key)} onTileRefresh={()=>{if(allPoints)void showAllPoints(true);else if(activeSearch.current)void runSearch(activeSearch.current.text,activeSearch.current.kind,activeSearch.current.filters)}} topInset={72} legend={false} /> : <TargetMap rows={rows} selected={keys} focusedKey={focused?.poi_key} onToggle={openProfile} topInset={72} legend={false} />}
        </Suspense>
        <div className="farq-map-tools"><Action variant="secondary" showIcon={false} onClick={() => { setListMode(!listMode); setSheet(listMode ? 'half' : 'full') }}><Icon name={listMode ? 'map-pin' : 'list'} size={17} />{listMode ? 'الخريطة' : 'قائمة'}</Action><Action variant={allPoints?'primary':'secondary'} showIcon={false} loading={tileBusy} aria-pressed={allPoints} onClick={()=>void showAllPoints()}>كل نقاط السجل</Action>{pendingArea && <Action variant="primary" showIcon={false} onClick={() => { const scope={...filters,bounds:pendingArea};setFilters(scope);setPendingArea(null);void runSearch(activeSearch.current?.text||q,allPoints?'browse':activeSearch.current?.kind||mode,scope);setSheet('half') }}>ابحث في هذه المنطقة</Action>}</div>
        {allPoints && <span className="farq-map-caption">{catalogCount.toLocaleString('ar-SA')} جهة وفق الفلاتر · {pointScope==='all'?'كل المملكة':cityName} · {locatedCount.toLocaleString('ar-SA')} موقع بإحداثيات · ليست ترشيحات</span>}{!import.meta.env.VITE_MAPBOX_TOKEN && <span className="farq-map-caption">عرض إحداثيات الجهات · خريطة الطرق غير مفعّلة</span>}
      </div>
      <section className={`farq-panel farq-sheet-${sheet}`} aria-label="لوحة الاستكشاف">
        <div className="farq-sheet-controls"><button type="button" aria-label="تصغير اللوحة" onClick={() => setSheet('mini')}>—</button><button type="button" aria-label="نصف الشاشة" onClick={() => setSheet('half')}>◒</button><button type="button" aria-label="توسيع اللوحة" onClick={() => setSheet('full')}>↑</button></div>
        <div className="farq-panel-content">
          {stage !== 'start' && <Action variant="ghost" showIcon={false} onClick={() => { setStage(stage === 'profile' || stage === 'selection' ? 'results' : stage === 'review' ? 'selection' : 'start'); setError('') }}>رجوع</Action>}
          <h1>{stage === 'start' ? mode === 'purchase' ? 'وش تحتاج لمنشأتك؟' : 'وش تقدّم لعملائك؟' : stage === 'understood' ? 'راجع احتياجك' : stage === 'profile' ? nameOf(focused!) : stage === 'selection' ? `اختياراتك · ${selected.length}` : stage === 'review' ? 'راجع قبل التواصل' : resultKind === 'browse' ? 'جهات التصنيف' : mode === 'marketing' ? 'مشترون محتملون' : 'الجهات المناسبة'}</h1>
          <p className="farq-muted">{stage === 'start' ? 'اكتب احتياجك، اسم الشركة أو النشاط.' : mode === 'marketing' ? 'مطابقة النشاط لا تعني وجود طلب شراء مؤكد.' : 'راجع الدليل والمواصفات قبل اختيار المورد.'}</p>
          {cityError && <p role="alert">تعذّر تحميل المدن. <button type="button" className="farq-text-link" onClick={() => { setCityError(false); listCities().then(setCities, () => setCityError(true)) }}>أعد المحاولة</button></p>}
          {storageError && <p role="alert">تعذّر الحفظ التلقائي في هذا المتصفح. اترك الصفحة مفتوحة حتى تنتهي.</p>}
          {error && <p className="farq-error" role="alert">{error}</p>}
          {note && <p role="status" className="farq-muted">{note}</p>}
          {(stage === 'start' || stage === 'results') && <>
            {stage === 'start' && saved.q && !q && <div className="farq-resume"><span>مسودة محفوظة: {saved.q}</span><Action variant="ghost" showIcon={false} onClick={() => { setQ(saved.q); setCity(saved.city); setMode(saved.mode); setLines(saved.lines); setSelected(saved.selected); setNote('استعدنا المسودة والاختيارات. اضغط بحث لتحديث النتائج.') }}>كمل من حيث توقفت</Action></div>}
            <form onSubmit={e => { e.preventDefault(); if (stage === 'start') understand(); else void runSearch() }} className="farq-search-form">
              <label htmlFor="farq-unified-search">البحث</label><div className="farq-search-field"><Icon name="search" size={20} /><input id="farq-unified-search" ref={input} type="search" value={q} autoComplete="off" placeholder={mode === 'purchase' ? 'مثال: 20 كرسي عيادة' : 'مثال: حليب بالجملة'} onFocus={() => setSuggestOpen(true)} onChange={e => { setQ(e.target.value); setLines([]); setSuggestOpen(true) }} aria-controls={suggestOpen ? "farq-suggestions" : undefined} /></div>
              {suggestOpen && q.trim().length >= 3 && <div id="farq-suggestions" className="farq-suggestions" aria-label="اقتراحات البحث"><strong>شركات</strong>{suggestions.length ? suggestions.map(row => <button key={row.poi_key} type="button" onClick={() => { setQ(nameOf(row)); openProfile(row) }}>{nameOf(row)}<small>افتح الشركة مباشرة</small></button>) : <button type="button" disabled={busy} onClick={() => void runSearch(q, 'name')}>ابحث باسم «{q}»<small>بدون إنشاء طلب</small></button>}<strong>منتجات وخدمات</strong><button type="button" onClick={() => { setSuggestOpen(false); understand() }}>{q}<small>{mode === 'purchase' ? 'ابحث عن الموردين' : 'ابحث عن المشترين المحتملين'}</small></button><strong>تصنيفات</strong>{CATEGORIES.filter(c => normalized(c).includes(normalized(q))).map(c => <button key={c} type="button" onClick={() => { setQ(c); void runSearch(c) }}>{c}</button>)}</div>}
              <Action type="submit" loading={busy} loadingLabel="نبحث عن الجهات…">{stage === 'start' ? 'فهم الاحتياج والبحث' : 'تحديث البحث'}</Action>
            </form>
            <details className="farq-directory-filters"><summary>التصنيفات وفلاتر الجهات</summary><div className="farq-filter-grid">
              <label>التصنيف الرئيسي<select aria-label="التصنيف الرئيسي" value={filters.category||''} onChange={e=>setFilters({...filters,category:e.target.value,subcategory:''})}><option value="">كل التصنيفات</option>{facets?.categories.map(c=><option key={c.value} value={c.value}>{c.label} ({c.count.toLocaleString('ar-SA')})</option>)}</select></label>
              <label>التصنيف الفرعي<select aria-label="التصنيف الفرعي" disabled={!filters.category} value={filters.subcategory||''} onChange={e=>setFilters({...filters,subcategory:e.target.value})}><option value="">كل الأنشطة الفرعية</option>{facets?.categories.find(c=>c.value===filters.category)?.subcategories.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
              <label>نوع المنشأة<select aria-label="نوع المنشأة" value={filters.entity_type||''} onChange={e=>setFilters({...filters,entity_type:e.target.value})}><option value="">الكل</option><option value="company">شركات</option><option value="establishment">مؤسسات</option><option value="unknown">غير محدد</option><option disabled>مؤسسات صغيرة — بيانات الحجم غير متاحة</option></select></label>
              <label><input type="checkbox" checked={!!filters.branches_only} onChange={e=>setFilters({...filters,branches_only:e.target.checked})}/>جهات لديها عدة مواقع مسجلة</label>
              <label><input type="checkbox" checked={filters.sort==='name_first'} onChange={e=>setFilters({...filters,sort:e.target.checked?'name_first':'confidence'})}/>كلمة البحث في الاسم أولًا</label>
              <label><input type="checkbox" checked={!!filters.name_only} onChange={e=>setFilters({...filters,name_only:e.target.checked})}/>الأسماء التي تحتوي البحث فقط</label>
            </div><label>نطاق طبقة كل النقاط<select aria-label="نطاق طبقة كل النقاط" value={pointScope} disabled={tileBusy} onChange={e=>{setPointScope(e.target.value);if(allPoints)void showAllPoints(true,e.target.value)}}><option value="city">المدينة المختارة</option><option value="all">كل المملكة</option></select></label><p className="farq-muted">نوع المنشأة مستدل من الاسم. تعدد المواقع حسب العلامة المسجلة، وليس تحققًا من الفروع. الحجم غير متاح.</p><div className="farq-secondary-actions"><Action variant="secondary" showIcon={false} disabled={busy} onClick={()=>void runSearch(activeSearch.current?.text||q,activeSearch.current?.kind||mode)}>تطبيق الفلاتر</Action><Action variant="ghost" showIcon={false} disabled={busy} onClick={()=>void runSearch(q,'browse')}>استعرض التصنيف</Action></div></details>
            {stage === 'start' && <><div className="farq-secondary-actions"><Action variant="ghost" showIcon={false} disabled={busy} onClick={() => file.current?.click()}><Icon name="upload" size={18} />{mode === 'purchase' ? 'ارفع قائمة احتياجاتك' : 'ارفع كتالوجك'}</Action><Action variant="ghost" showIcon={false} disabled={busy} onClick={() => void runSearch(q, 'name')}>بحث باسم الشركة</Action></div><details className="farq-categories"><summary>أو اختر تصنيفًا</summary><div>{CATEGORIES.map(c => <Action key={c} variant="secondary" showIcon={false} onClick={() => { setQ(c); void runSearch(c) }}>{c}</Action>)}</div></details></>}
            {stage === 'results' && <><div className="farq-result-heading"><span role="status">{Math.min(shown,rows.length)} جهة معروضة{result && result.total > (result.rows?.length || 0) ? ` من ${result.total}` : ''}</span><label>التواصل<select aria-label="فلتر التواصل" value={contactFilter} onChange={e => {setContactFilter(e.target.value);if(activeSearch.current)void runSearch(activeSearch.current.text,activeSearch.current.kind,{...filters,contact:e.target.value})}}><option value="all">الكل</option><option value="whatsapp">واتساب</option></select></label></div>{area && <Action variant="ghost" showIcon={false} onClick={() => setArea(null)}>إزالة نطاق الخريطة</Action>}{filters.bounds && <Action variant="ghost" showIcon={false} onClick={()=>{const scope={...filters,bounds:undefined};setFilters(scope);void runSearch(activeSearch.current?.text||q,activeSearch.current?.kind||mode,scope)}}>إزالة نطاق الخريطة</Action>}<p className="farq-muted farq-confidence-note">{resultKind==='browse'?'عرض من التصنيف المسجل؛ ليس ترشيحًا بالثقة.':'نسبة الثقة مؤشر تقريبي لدليل الاسم والنشاط؛ لا تؤكد توفر المنتج أو نية الشراء.'}{result?.located_total!=null && ` ${result.located_total.toLocaleString('ar-SA')} من ${result.total.toLocaleString('ar-SA')} لها إحداثيات على الخريطة.`}</p>{busy ? <p role="status">جارٍ المطابقة…</p> : rows.length ? <div className="farq-results">{rows.slice(0, shown).map(card)}{result?.has_more && shown>=rows.length && <Action variant="secondary" loading={loadingMore} disabled={busy} onClick={()=>void loadMore()}>تحميل جهات أخرى</Action>}{shown < rows.length && <Action variant="secondary" onClick={() => setShown(shown + 30)}>عرض المزيد</Action>}</div> : !error && <div className="farq-empty"><Icon name="search" size={30} /><h2>ما لقينا نتائج ضمن هذه الشروط</h2><p>غيّر المدينة، عدّل الكلمة أو أزل فلتر التواصل. تبقى اختياراتك محفوظة.</p><Action variant="secondary" showIcon={false} onClick={() => { setContactFilter('all'); setArea(null); input.current?.focus() }}>تعديل البحث والفلاتر</Action></div>}</>}
          </>}
          {stage === 'understood' && <><p className="farq-muted">عدّل الوصف والكمية والوحدة؛ لن نفترض مواصفات لم تذكرها.</p>{lines.map((line, i) => <div key={i} className="farq-line-editor"><label>البند<input value={line.name} onChange={e => setLines(current => current.map((l, k) => k === i ? { ...l, name: e.target.value } : l))} /></label><div><label>الكمية<input type="number" min="0.001" step="any" value={line.qty} onChange={e => setLines(current => current.map((l, k) => k === i ? { ...l, qty: e.target.value } : l))} /></label><label>الوحدة<input placeholder="مثل: حبة" value={line.unit} onChange={e => setLines(current => current.map((l, k) => k === i ? { ...l, unit: e.target.value } : l))} /></label></div><label>المواصفات<textarea rows={2} value={line.spec || ''} onChange={e => setLines(current => current.map((l, k) => k === i ? { ...l, spec: e.target.value } : l))} /></label><Action variant="ghost" showIcon={false} loading={busy} loadingLabel="نبحث عن جهات مناسبة…" onClick={() => { setQ(line.name); void runSearch(line.name) }}>ابحث عن جهات لهذا البند</Action></div>)}</>}
          {stage === 'profile' && focused && <><div className="farq-profile-facts"><h2>ليش هذه الجهة؟</h2><p>{reason(focused)}</p><h2>ما نعرفه</h2><p>{focused.category_ar || focused.category || 'النشاط غير مذكور'} · {focused.city_en || cityName}</p><p>{waNumber(focused) ? 'رقم واتساب في البيانات' : focused.email ? 'بريد إلكتروني في البيانات' : 'لا توجد قناة تواصل مؤكدة'}</p><h2>المصدر</h2><p>{focused.sources?.join(' · ') || 'سجل البحث؛ رابط المصدر غير متاح'}</p><h2>ما لم يتأكد</h2><p>{mode === 'marketing' ? 'وجود احتياج فعلي، الكمية وموعد الشراء.' : 'توفر الكمية، السعر والمواصفات المطلوبة.'}</p>{focused.phone_source_name && <p>مصدر الرقم: {focused.phone_source_name}</p>}</div><Action onClick={() => toggle(focused)}>{keys.has(focused.poi_key) ? 'إزالة من الاختيار' : 'أضف للاختيار'}</Action><Action variant="ghost" showIcon={false} onClick={() => { setStage('results'); setSuggestOpen(false) }}>عرض النتائج</Action></>}
          {stage === 'selection' && <><div className="farq-results">{selected.map(card)}</div>{!selected.length && <p>اختياراتك فارغة. أضف جهة من النتائج.</p>}<Action disabled={!selected.length} onClick={review}>مراجعة الخطوة التالية</Action></>}
          {stage === 'review' && <><div className="farq-review-summary"><h2>{selected.length} جهة مختارة</h2><p>{selected.map(nameOf).join('، ')}</p><h2>{mode === 'purchase' ? 'بنود طلبك' : 'ما تقدمه'}</h2><p>{lines.map(l => `${l.name} · ${l.qty || 'كمية غير محددة'} ${l.unit}`).join('، ') || q}</p><h2>مدينة النطاق</h2><p>{cityName}</p></div><label>مسودة الرسالة<textarea rows={5} value={message} onChange={e => setMessage(e.target.value)} /></label>{mode === 'purchase' ? <><p className="farq-muted">نكمل تجهيز الطلب في مسار التسعير. نحافظ على الجهات التي اخترتها، ثم نراجع البنود والرسالة والتكلفة قبل تأكيد الإرسال.</p><Action disabled={!lines.some(l => l.name.trim() && Number(l.qty) > 0 && l.unit.trim())} onClick={() => { writeLocal('purchase-seed', { lines, city: cityName, targets: selected }); navigate('create-upload') }}>جهّز طلب التسعير</Action><p className="farq-muted">يلزم تحديد الكمية والوحدة. لم يُرسل شيء بعد.</p></> : <><p className="farq-muted">الإرسال من FARQ غير مفعّل لمسار البيع. يمكنك حفظ هذه الجهات كفرص ومتابعة تأكيد الاحتياج.</p><Action onClick={() => { if (saveOpportunities(snapshot())) navigate('opportunities'); else setError('تعذّر حفظ الفرص في المتصفح.') }}>احفظ الفرص في متابعتي</Action><p className="farq-muted">الحفظ على هذا الجهاز فقط، بدون إرسال رسائل.</p></>}</>}
        </div>
        {selected.length > 0 && stage !== 'review' && <footer className="farq-selection-bar"><span>{selected.length} ضمن الاختيار</span><Action variant="primary" onClick={() => { setStage('selection'); setSheet('full') }}>عرض الاختيارات</Action></footer>}
      </section>
    </div>
    <input ref={file} type="file" className="sr-only" aria-label="ارفع ملف احتياجك أو كتالوجك" accept=".pdf,.xlsx,image/*" onChange={e => void upload(Array.from(e.target.files || []))} />
  </div>
}
