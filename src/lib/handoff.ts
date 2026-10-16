/*
 * In-memory hand-off between pages of this tab (owner 2026-10-16: «لا اريد اي بيانات على الجهاز»).
 * Nothing here touches any browser store (web storage or databases): a reload starts clean.
 */
const mem = new Map<string, string>()

export const handoff = {
  set(key: string, value: string) { mem.set(key, value) },
  get(key: string): string | null { return mem.get(key) ?? null },
  /** Read once: the value is gone afterwards. */
  take(key: string): string | null { const v = mem.get(key) ?? null; mem.delete(key); return v },
  remove(key: string) { mem.delete(key) },
}

/** Keys used across pages. */
export const HANDOFF = { entryGoal: 'entry-goal', targetDirection: 'target-direction', targetQuery: 'target-query' } as const
