'use client'

import { useEffect, useState } from 'react'
import { postMarket } from '@/lib/insights-api'

/** One main activity of the directory, as market-summary lists it for a city. */
export type MainActivity = { main_id: string; main_ar: string }

// one request per city for the page's life: every step that offers the activity picker reads the same list, so
// moving between steps neither asks again nor shows an empty picker first
const loaded = new Map<string, MainActivity[]>()
const pending = new Map<string, Promise<MainActivity[]>>()

function request(city: string): Promise<MainActivity[]> {
  let promise = pending.get(city)
  if (!promise) {
    promise = postMarket<{ summary?: { main_activities?: MainActivity[] } }>('market-summary', { city })
      .then((payload) => {
        const list = payload.summary?.main_activities ?? []
        loaded.set(city, list)
        return list
      })
      // a failed request is not kept, so the next step that needs the list asks again
      .finally(() => pending.delete(city))
    pending.set(city, promise)
  }
  return promise
}

/** The city's main activities, largest first as the service orders them; empty while loading or on failure. */
export function useMainActivities(city: string): MainActivity[] {
  const [activities, setActivities] = useState<MainActivity[]>(() => loaded.get(city) ?? [])
  useEffect(() => {
    let live = true
    const known = loaded.get(city)
    if (known) { setActivities(known); return }
    setActivities([])
    request(city).then((list) => { if (live) setActivities(list) }, () => { if (live) setActivities([]) })
    return () => { live = false }
  }, [city])
  return activities
}
