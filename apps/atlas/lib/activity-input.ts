/** The studied activity as a route passes it on to the service: exactly one way of naming it (lib/activity-query
 * activityBody), each value checked here, since everything a browser sends is untrusted. */
const ID = /^[a-z0-9_.]{1,80}$/

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function ids(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) return null
  return value.every((item) => typeof item === 'string' && ID.test(item)) ? [...new Set(value as string[])] : null
}

export function activityInput(input: { q?: unknown; main_id?: unknown; sub_ids?: unknown; specialty_ids?: unknown }) {
  const q = text(input.q, 120)
  if (q) return { q }
  const specialties = ids(input.specialty_ids, 20)
  if (specialties) return { specialty_ids: specialties }
  const subs = ids(input.sub_ids, 50)
  if (subs) return { sub_ids: subs }
  const main = text(input.main_id, 40)
  return main ? { main_id: main } : {}
}
