import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'farq_atlas_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const REFRESH_MARGIN_SECONDS = 5 * 60

type AtlasUser = {
  id: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
}

type StoredSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: AtlasUser
}

export type PublicSession = {
  user: AtlasUser
  expiresAt: number
}

function keyMaterial() {
  const secret = process.env.ATLAS_SESSION_SECRET
  return secret && secret.length >= 32 ? Buffer.from(secret) : null
}

function encode(session: StoredSession) {
  const secret = keyMaterial()
  if (!secret) return null
  const raw = Buffer.from(JSON.stringify(session))
  const nonce = randomBytes(16)
  const enc = createHmac('sha256', secret).update('farq-atlas-session-enc-v1').digest()
  const mac = createHmac('sha256', secret).update('farq-atlas-session-mac-v1').digest()
  const stream = Buffer.alloc(raw.length)
  for (let offset = 0, counter = 0; offset < raw.length; counter += 1) {
    const block = createHmac('sha256', enc).update(Buffer.concat([nonce, Buffer.from([(counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255])])).digest()
    block.copy(stream, offset)
    offset += block.length
  }
  const ciphertext = Buffer.from(raw.map((value, i) => value ^ stream[i]))
  const tag = createHmac('sha256', mac).update(Buffer.concat([nonce, ciphertext])).digest().subarray(0, 16)
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64url')
}

function decode(value: string | undefined): StoredSession | null {
  const secret = keyMaterial()
  if (!secret || !value) return null
  try {
    const blob = Buffer.from(value, 'base64url')
    if (blob.length < 34) return null
    const nonce = blob.subarray(0, 16)
    const ciphertext = blob.subarray(16, -16)
    const tag = blob.subarray(-16)
    const enc = createHmac('sha256', secret).update('farq-atlas-session-enc-v1').digest()
    const mac = createHmac('sha256', secret).update('farq-atlas-session-mac-v1').digest()
    const expected = createHmac('sha256', mac).update(Buffer.concat([nonce, ciphertext])).digest().subarray(0, 16)
    if (!timingSafeEqual(tag, expected)) return null
    const stream = Buffer.alloc(ciphertext.length)
    for (let offset = 0, counter = 0; offset < ciphertext.length; counter += 1) {
      const block = createHmac('sha256', enc).update(Buffer.concat([nonce, Buffer.from([(counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255])])).digest()
      block.copy(stream, offset)
      offset += block.length
    }
    const raw = Buffer.from(ciphertext.map((byte, i) => byte ^ stream[i]))
    const session = JSON.parse(raw.toString('utf8')) as Partial<StoredSession>
    if (!session.accessToken || !session.refreshToken || !session.user?.id || !Number.isFinite(session.expiresAt)) return null
    return session as StoredSession
  } catch {
    return null
  }
}

function apiOrigin() {
  return (process.env.FARQ_API_ORIGIN || 'https://api.farq.sa').replace(/\/$/, '')
}

function asSession(payload: unknown): StoredSession | null {
  const root = payload && typeof payload === 'object' && 'data' in payload ? (payload as { data?: unknown }).data : payload
  if (!root || typeof root !== 'object') return null
  const value = root as Record<string, unknown>
  const user = value.user as Record<string, unknown> | undefined
  const accessToken = typeof value.access_token === 'string' ? value.access_token : ''
  const refreshToken = typeof value.refresh_token === 'string' ? value.refresh_token : ''
  const id = user && (typeof user.id === 'string' || typeof user.id === 'number') ? String(user.id) : ''
  if (!accessToken || !refreshToken || !id) return null
  const expiry = typeof value.expires_at === 'number' ? value.expires_at : Math.floor(Date.now() / 1000) + (typeof value.expires_in === 'number' ? value.expires_in : 3600)
  return {
    accessToken,
    refreshToken,
    expiresAt: expiry,
    user: {
      id,
      email: typeof user?.email === 'string' ? user.email : null,
      emailVerified: user?.email_verified === true,
      displayName: typeof user?.display_name === 'string' ? user.display_name : null,
    },
  }
}

async function postAuth(path: string, body: Record<string, string>) {
  const response = await fetch(`${apiOrigin()}${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

export async function signIn(email: string, password: string) {
  const { response, payload } = await postAuth('/api/auth/login', { email, password })
  return { status: response.status, session: response.ok ? asSession(payload) : null }
}

async function refresh(session: StoredSession) {
  const { response, payload } = await postAuth('/api/auth/refresh', { refresh_token: session.refreshToken })
  return response.ok ? asSession(payload) : null
}

export function publicSession(session: StoredSession): PublicSession {
  return { user: session.user, expiresAt: session.expiresAt }
}

export function readSession(request: NextRequest) {
  return decode(request.cookies.get(COOKIE)?.value)
}

export function setSession(response: NextResponse, session: StoredSession) {
  const value = encode(session)
  if (!value) throw new Error('ATLAS_SESSION_NOT_CONFIGURED')
  response.cookies.set(COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export function clearSession(response: NextResponse) {
  response.cookies.set(COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 })
}

export async function sessionForRequest(request: NextRequest) {
  let session = readSession(request)
  if (!session) return { session: null, refreshed: false }
  if (session.expiresAt - Math.floor(Date.now() / 1000) <= REFRESH_MARGIN_SECONDS) {
    const next = await refresh(session)
    if (!next) return { session: null, refreshed: false }
    session = next
    return { session, refreshed: true }
  }
  return { session, refreshed: false }
}

export async function verifySession(session: StoredSession) {
  const response = await fetch(`${apiOrigin()}/api/auth/me`, {
    headers: { accept: 'application/json', authorization: `Bearer ${session.accessToken}` },
    cache: 'no-store',
  })
  return response.ok
}

export function isTargetingAllowed(session: StoredSession) {
  const configured = (process.env.ATLAS_TARGETING_ALLOWED_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
  return configured.length === 0 || (!!session.user.email && configured.includes(session.user.email.toLowerCase()))
}
