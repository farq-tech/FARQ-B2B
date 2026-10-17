import { useEffect, useId, useState, type ReactNode } from 'react'
import { farqSession } from '../api/farqSession'
import { FarqGlassButton as Action } from '../ui/FarqGlassButton'
import { useProcurement } from '../procurementContext'
import { readLocal, type BusinessProfile } from './storage'
import { cachedBusinessProfile, CompanyProfileError, fetchBusinessProfile, saveBusinessProfile } from '../api/companyProfileClient'
import { crError, EMPTY_NATIONAL_ADDRESS, formatNationalAddress, nationalAddressErrors, normalizeCr, normalizeShortAddress, normalizeVat, toLatinDigits, vatError, type NationalAddress } from '../lib/saudi'
import { openMapAnalyticsPreferences } from '../components/MapAnalyticsConsent'

/*
 * «حسابي» — the company details printed on price requests (NewRequestV2 sends cr_number / vat_number / national_address
 * in the RFQ's buyer block, as Farq Bina's rfq-dispatch prints them).
 *
 * Read from and saved to the server only (GET / PUT /api/business/company-profile, companyProfileClient.ts) — nothing
 * is kept on the device (owner 2026-10-16). Until the endpoint exists (404) the screen says «قريباً» and the form is
 * read-only; it never falls back to the browser.
 *
 * Saudi identifiers are checked by shape (validators.ts): CR 10 digits; VAT 15 digits starting and ending with 3;
 * national address short code 4 letters + 4 digits, building / additional number 4 digits, postal code 5 digits.
 */
type Key = 'name' | 'legalName' | 'phone' | 'email' | 'city' | 'defaultDeliveryCity'
const BASIC: [Key, string][] = [['name', 'اسم المنشأة'], ['legalName', 'الاسم النظامي'], ['phone', 'رقم التواصل'], ['email', 'البريد الإلكتروني'], ['city', 'مدينة المنشأة'], ['defaultDeliveryCity', 'مدينة التوريد الافتراضية']]
const ADDRESS: [keyof NationalAddress, string, string, string?][] = [
  ['shortAddress', 'العنوان المختصر', 'RRRD2929', 'ltr'], ['buildingNo', 'رقم المبنى', '2929', 'ltr'], ['street', 'الشارع', 'شارع الأمير محمد بن عبدالعزيز'],
  ['district', 'الحي', 'العليا'], ['city', 'المدينة', 'الرياض'], ['postalCode', 'الرمز البريدي', '12241', 'ltr'], ['additionalNo', 'الرقم الإضافي', '7788', 'ltr'],
]

function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode }) {
  const id = useId()
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined
  // the hint and the error sit outside the <label> so the field's name stays just its label
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? <small id={`${id}-hint`} className="text-[12px] text-[var(--color-text-tertiary)]">{hint}</small> : null}
      {error ? <small id={`${id}-err`} role="alert" className="text-[12px] font-medium text-[var(--color-text-danger)]">{error}</small> : null}
    </div>
  )
}

export default function Account() {
  const { navigate } = useProcurement()
  const [profile, setProfile] = useState<BusinessProfile>(cachedBusinessProfile)
  const [address, setAddress] = useState<NationalAddress>(() => ({ ...EMPTY_NATIONAL_ADDRESS, ...(profile.nationalAddressParts || {}) }))
  const [notice, setNotice] = useState('')
  /** loading → ready (editable) | off (404: «قريباً», read-only) | error (could not read: read-only) */
  const [server, setServer] = useState<'loading' | 'ready' | 'off' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const editable = server === 'ready' && !saving

  useEffect(() => {
    let live = true
    fetchBusinessProfile().then((r) => {
      if (!live) return
      if (r.status === 'off') { setServer('off'); return }
      setProfile(r.profile)
      setAddress({ ...EMPTY_NATIONAL_ADDRESS, ...(r.profile.nationalAddressParts || {}) })
      setServer('ready')
    }).catch((e: unknown) => {
      if (!live) return
      setServer('error')
      setNotice(e instanceof CompanyProfileError ? e.message : 'ما قدرنا نجيب بيانات المنشأة. حاول بعد شوي.')
    })
    return () => { live = false }
  }, [])
  const [checked, setChecked] = useState(false)
  const errors = { crNumber: crError(profile.crNumber), vatNumber: vatError(profile.vatNumber), address: nationalAddressErrors(address) }
  const hasErrors = Boolean(errors.crNumber || errors.vatNumber || Object.keys(errors.address).length)
  const show = (e: string | null | undefined) => (checked ? e : null)

  const submit = async () => {
    if (!editable) return
    setChecked(true)
    if (hasErrors) { setNotice('راجع الخانات المعلّمة بالأحمر قبل الحفظ.'); return }
    const parts: NationalAddress = { ...address, shortAddress: normalizeShortAddress(address.shortAddress), buildingNo: toLatinDigits(address.buildingNo).trim(), postalCode: toLatinDigits(address.postalCode).trim(), additionalNo: toLatinDigits(address.additionalNo).trim() }
    const next: BusinessProfile = {
      ...profile,
      crNumber: normalizeCr(profile.crNumber),
      vatNumber: normalizeVat(profile.vatNumber),
      nationalAddressParts: parts,
      // one line for the RFQ buyer block; an older free-text address is kept until a structured one is filled
      nationalAddress: Object.values(parts).some((v) => v.trim()) ? formatNationalAddress(parts) : profile.nationalAddress,
    }
    setProfile(next)
    setSaving(true); setNotice('')
    try {
      const r = await saveBusinessProfile(next)
      if (r.status === 'off') { setServer('off'); return }
      setProfile(r.profile)
      setNotice('تم بحمد الله، حفظنا بيانات منشأتك في حسابك.')
    } catch (e) {
      setNotice(e instanceof CompanyProfileError ? e.message : 'ما قدرنا نحفظ بيانات المنشأة. حاول بعد شوي.')
    } finally { setSaving(false) }
  }

  return <section className="farq-work-page"><h1>حسابي</h1><p className="farq-muted">بيانات منشأتك تطلع في طلبات التسعير، وتنحفظ في حسابك على الخادم.</p>
    {server === 'off' ? <p role="note" className="farq-muted"><strong>قريباً</strong> — حفظ بيانات المنشأة في حسابك. الحقول للعرض فقط حالياً.</p> : null}
    {server === 'loading' ? <p className="farq-muted">جاري تحميل بيانات المنشأة…</p> : null}
    <form noValidate aria-busy={server === 'loading' || saving} onSubmit={(e) => { e.preventDefault(); void submit() }} className="flex flex-col gap-6">
      <fieldset disabled={!editable} className="farq-account-grid m-0 border-0 p-0">
        <legend className="mb-3 text-[16px] leading-[26px] font-semibold">بيانات المنشأة</legend>
        {BASIC.map(([key, label]) => <label key={key}>{label}<input required={['name', 'phone', 'email', 'city'].includes(key)} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={profile[key]} onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))} /></label>)}
      </fieldset>
      <fieldset disabled={!editable} className="farq-account-grid m-0 border-0 p-0">
        <legend className="mb-3 text-[16px] leading-[26px] font-semibold">البيانات النظامية</legend>
        <Field label="السجل التجاري" hint="10 أرقام" error={show(errors.crNumber)}>
          {({ id, describedBy, invalid }) => <input id={id} inputMode="numeric" dir="ltr" maxLength={14} autoComplete="off" value={profile.crNumber} aria-invalid={invalid} aria-describedby={describedBy} onChange={e => setProfile(p => ({ ...p, crNumber: e.target.value }))} placeholder="1010123456" />}
        </Field>
        <Field label="الرقم الضريبي" hint="15 رقمًا، يبدأ بـ 3 وينتهي بـ 3" error={show(errors.vatNumber)}>
          {({ id, describedBy, invalid }) => <input id={id} inputMode="numeric" dir="ltr" maxLength={19} autoComplete="off" value={profile.vatNumber} aria-invalid={invalid} aria-describedby={describedBy} onChange={e => setProfile(p => ({ ...p, vatNumber: e.target.value }))} placeholder="3XXXXXXXXXXXXX3" />}
        </Field>
      </fieldset>
      <fieldset disabled={!editable} className="farq-account-grid m-0 border-0 p-0">
        <legend className="mb-1 text-[16px] leading-[26px] font-semibold">العنوان الوطني</legend>
        <p className="farq-muted col-span-full -mt-2">من سُبل (العنوان الوطني). العنوان المختصر ٤ حروف و٤ أرقام.</p>
        {ADDRESS.map(([key, label, ph, dir]) => (
          <Field key={key} label={label} error={show(errors.address[key])}>
            {({ id, describedBy, invalid }) => <input id={id} dir={dir} inputMode={dir === 'ltr' && key !== 'shortAddress' ? 'numeric' : undefined} autoComplete="off" value={address[key]} placeholder={ph} aria-invalid={invalid} aria-describedby={describedBy}
              onChange={e => setAddress(a => ({ ...a, [key]: e.target.value }))} />}
          </Field>
        ))}
        {!Object.values(address).some((v) => v.trim()) && profile.nationalAddress ? <p className="farq-muted col-span-full">العنوان المحفوظ سابقًا: <bdi>{profile.nationalAddress}</bdi></p> : null}
      </fieldset>
      {server === 'ready' ? <div><Action type="submit" disabled={saving}>{saving ? 'جاري الحفظ…' : 'حفظ بيانات المنشأة'}</Action></div> : null}
    </form>
    <p role="status">{notice}</p>
    <div className="farq-secondary-actions">{readLocal('purchase-wizard', null) && <Action variant="secondary" onClick={() => navigate('create-upload')}>كمّل طلب الشراء المحفوظ</Action>}<Action variant="secondary" showIcon={false} onClick={() => navigate('templates')}>قوالب واتساب</Action><Action variant="secondary" showIcon={false} onClick={openMapAnalyticsPreferences}>تفضيلات قياس الخريطة</Action><Action variant="ghost" showIcon={false} onClick={() => void farqSession.signOut()}>تسجيل الخروج</Action></div>
  </section>
}
