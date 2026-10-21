import { type NextRequest } from 'next/server'
import { proxy } from '../../../[resource]/route'

// Next's single-segment dynamic route cannot match `/street-density/catalog`.
// Keep this nested catalogue endpoint on the same read-only proxy and HMAC path
// as the rest of the aggregate market API.
const context = { params: Promise.resolve({ resource: 'street-density/catalog' }) }

export function POST(request: NextRequest) {
  return proxy(request, context)
}
