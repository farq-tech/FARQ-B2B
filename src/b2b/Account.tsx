import { useState } from 'react'
import { farqSession } from '../api/farqSession'
import { FarqGlassButton as Action } from '../ui/FarqGlassButton'
import { useProcurement } from '../procurementContext'
import { loadBusinessProfile, saveBusinessProfile, readLocal } from './storage'

export default function Account() {
  const { navigate } = useProcurement()
  const [profile, setProfile] = useState(loadBusinessProfile)
  const [notice, setNotice] = useState('')
  return <section className="farq-work-page"><h1>حسابي</h1><p className="farq-muted">بيانات منشأتك تظهر في طلبات التسعير. الإعدادات محفوظة على هذا الجهاز.</p><form className="farq-account-grid" onSubmit={e => { e.preventDefault(); setNotice(saveBusinessProfile(profile) ? 'حُفظت بيانات المنشأة على هذا الجهاز.' : 'تعذّر الحفظ. تحقق من إعدادات المتصفح.') }}>
    {([['name', 'اسم المنشأة'], ['legalName', 'الاسم القانوني'], ['phone', 'رقم التواصل'], ['email', 'البريد الإلكتروني'], ['city', 'مدينة المنشأة'], ['defaultDeliveryCity', 'مدينة التوريد الافتراضية'], ['crNumber', 'السجل التجاري'], ['vatNumber', 'الرقم الضريبي'], ['nationalAddress', 'العنوان الوطني']] as const).map(([key, label]) => <label key={key}>{label}<input required={['name', 'phone', 'email', 'city'].includes(key)} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} value={profile[key]} onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))} /></label>)}
    <div><Action type="submit">حفظ بيانات المنشأة</Action></div>
  </form><p role="status">{notice}</p><div className="farq-secondary-actions">{readLocal('purchase-wizard', null) && <Action variant="secondary" onClick={() => navigate('create-upload')}>كمل طلب الشراء المحفوظ</Action>}<Action variant="secondary" showIcon={false} onClick={() => navigate('templates')}>قوالب واتساب</Action><Action variant="ghost" showIcon={false} onClick={() => void farqSession.signOut()}>تسجيل الخروج</Action></div></section>
}
