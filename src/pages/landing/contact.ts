/*
 * Contact + call-to-action targets for the public landing page (decisions 2 and 3).
 *
 * «ابدأ التسعير» / «سجّل»: src/api has `farqSession.signUp(email, password)` (POST /signup), but it creates a
 * فرق بناء identity for an *invited colleague* and signs that browser in — it is not a public subscriber
 * sign-up, and importing it would pull the session/API code into this public chunk. So every start/sign-up
 * CTA opens WhatsApp with the ready message instead (decision 3, fallback). No outbound message is sent by
 * the page itself: the visitor's own WhatsApp opens with the text pre-filled.
 */
export const WHATSAPP_NUMBER_DISPLAY = '+966 51 019 7017'
export const WHATSAPP_MESSAGE = 'هلا، أبي أجرب فرق تسعير'
export const WHATSAPP_HREF = `https://wa.me/966510197017?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

export const EMAIL = 'info@farq.sa'
export const EMAIL_HREF = `mailto:${EMAIL}`
export const ENTERPRISE_EMAIL_HREF = `mailto:${EMAIL}?subject=${encodeURIComponent('فرق تسعير — خطة المؤسسات')}`

/** The protected app. The landing takes «/», so the app must live elsewhere — see docs/qa/requests.md. */
export const APP_LOGIN_HREF = '/app'

/** Start/sign-up CTA target (WhatsApp until a public sign-up endpoint exists). */
export const START_HREF = WHATSAPP_HREF
