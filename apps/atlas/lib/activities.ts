'use client'

import { useEffect, useState } from 'react'
import { postMarket } from '@/lib/insights-api'
import { isActivity, type Activity } from './activity-query'

export * from './activity-query'

const loaded = new Map<string, Activity[]>()
const pending = new Map<string, Promise<Activity[]>>()

function request(city: string): Promise<Activity[]> {
  let promise = pending.get(city)
  if (!promise) {
    promise = postMarket<{ activities?: Activity[] }>('market-activities', { city })
      .then((payload) => {
        const list = (payload.activities ?? []).filter(isActivity)
        loaded.set(city, list)
        return list
      })
      // a failed request is not kept, so the next step that needs the list asks again
      .finally(() => pending.delete(city))
    pending.set(city, promise)
  }
  return promise
}

/** The city's activities, largest first as the service orders them; empty while loading or on failure. */
export function useActivities(city: string): Activity[] {
  const [activities, setActivities] = useState<Activity[]>(() => loaded.get(city) ?? [])
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
