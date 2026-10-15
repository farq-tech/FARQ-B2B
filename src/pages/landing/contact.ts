/** Public contact links. Start opens the single-item directory search trial. */
export const WHATSAPP_NUMBER_DISPLAY = '+966 51 019 7017'
export const WHATSAPP_MESSAGE = 'هلا، أبي أجرب Farq B2B'
export const WHATSAPP_HREF = `https://wa.me/966510197017?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`

export const EMAIL = 'info@farq.sa'
export const EMAIL_HREF = `mailto:${EMAIL}`
export const ENTERPRISE_EMAIL_HREF = `mailto:${EMAIL}?subject=${encodeURIComponent('Farq B2B — خطة المؤسسات')}`

/** The protected app's home (route table in procurementContext, ba28798): «/requests» shows the login when signed out. */
export const APP_LOGIN_HREF = '/requests'

/** Public single-item supplier search; creates no RFQ and sends no supplier messages. */
export const START_HREF = '#try'
