import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * A short-lived proof that an authenticated directory request created this map
 * cohort. It authorizes only its opaque query id, never contacts or an account.
 * Mapbox loads tiles from a worker, where browsers can omit HttpOnly cookies.
 */
const TTL_SECONDS = 15 * 60

function key() {
  const secret = process.env.ATLAS_SESSION_SECRET
  return secret && secret.length >= 32 ? secret : null
}

function signature(query: string, expiresAt: number, secret: string) {
  return createHmac('sha256', secret).update(`farq-atlas-tile-v1:${query}:${expiresAt}`).digest('base64url')
}

export function issueTileAccess(query: string, now = Math.floor(Date.now() / 1000)) {
  const secret = key()
  if (!secret || !/^[a-f0-9]{32}$/.test(query)) return null
  const expiresAt = now + TTL_SECONDS
  return `${expiresAt}.${signature(query, expiresAt, secret)}`
}

export function verifyTileAccess(query: string, value: string | null | undefined, now = Math.floor(Date.now() / 1000)) {
  const secret = key()
  if (!secret || !value || !/^[a-f0-9]{32}$/.test(query)) return false
  const [expires, provided, ...extra] = value.split('.')
  const expiresAt = Number(expires)
  if (extra.length || !Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + TTL_SECONDS + 60 || !provided) return false
  const expected = signature(query, expiresAt, secret)
  const actual = Buffer.from(provided)
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}
