/**
 * The accounts a person's WhatsApp replies are filed under (pure, so node --test covers it; lib/inbox-account.ts looks
 * the organisation up). `send` is where a new campaign message is filed: the organisation when there is one, so the
 * team shares its replies; else the person's own `user-<id>`. `read` is every account the person may read: both.
 */
export type InboxAccounts = { send: string | null; read: string[]; sender: string | null }

const ID = /^[A-Za-z0-9_-]{1,80}$/

export function inboxAccounts(organizationId: string | null | undefined, userId: string | null | undefined): InboxAccounts {
  const org = organizationId && ID.test(organizationId) ? organizationId : null
  const cleanUser = (userId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 70)
  const user = cleanUser ? `user-${cleanUser}` : null
  return { send: org ?? user, read: [org, user].filter((id): id is string => Boolean(id)), sender: cleanUser || null }
}
