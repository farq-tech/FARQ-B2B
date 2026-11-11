import { createHmac } from 'node:crypto'
import type { NextRequest } from 'next/server'

/**
 * Shared by the «اطلب حساباً» routes (app/api/access-request and its /deletion): the service headers for the
 * targeting service, and the per-address limit (WINDOW_MAX an hour on this server, in memory).
 */
const WINDOW_MS = 60 * 60 * 1000
const WINDOW_MAX = 5
const hits = new Map<string, number[]>()

export function targetingHeaders() {
  const serviceToken = process.env.TARGETING_SERVICE_TOKEN
  if (serviceToken) return { 'content-type': 'application/json', 'x-farq-service': serviceToken }
  const password = process.env.TARGETING_PASSWORD
  if (!password) return null
  return { 'content-type': 'application/json', 'x-farq-service': createHmac('sha256', password).update('farq-proxy-v1').digest('hex') }
}

export function targetingOrigin() {
  return process.env.TARGETING_ORIGIN?.replace(/\/$/, '') || null
}

/** The visitor's address as the proxy in front of Atlas reports it: the last entry, the one that proxy added (the
 * first can be written by the visitor, which would let a script choose a fresh address for every request). */
export function clientAddress(request: NextRequest) {
  const hops = (request.headers.get('x-forwarded-for') ?? '').split(',').map((hop) => hop.trim()).filter(Boolean)
  return hops.at(-1) || 'unknown'
}

/** Whether this address may send another request now (and counts this one). `bucket` keeps the two forms apart. */
export function allowed(address: string, bucket: string, now = Date.now()) {
  const key = `${bucket}|${address}`
  const recent = (hits.get(key) ?? []).filter((time) => now - time < WINDOW_MS)
  if (recent.length >= WINDOW_MAX) { hits.set(key, recent); return false }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5000) for (const [name, times] of hits) if (!times.some((time) => now - time < WINDOW_MS)) hits.delete(name)
  return true
}
