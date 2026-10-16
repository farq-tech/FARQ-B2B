import type { TargetRow } from '../../../api/targetingClient'
import { rolesOf, specsOf } from './model'

/*
 * Role and specialty chips on result rows and in the profile drawer (owner 2026-10-16):
 * specialties in navy on an 8% navy fill, «جملة» on sand, other roles on the neutral grey.
 */
const base = 'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[12px] leading-[18px] font-medium'

export function RoleChip({ role }: { role: string }) {
  return role === 'جملة'
    ? <span className={`${base} border-[var(--map-sand)] bg-[color-mix(in_srgb,var(--map-sand)_25%,white)] text-[var(--map-ink)]`}>{role}</span>
    : <span className={`${base} border-[var(--color-border-default)] bg-[var(--color-bg-surface-2)] text-[var(--map-ink)]`}>{role}</span>
}

export function SpecChip({ name }: { name: string }) {
  return <span className={`${base} truncate border-[color-mix(in_srgb,var(--map-navy)_30%,white)] bg-[color-mix(in_srgb,var(--map-navy)_8%,white)] text-[var(--map-navy)]`} title={name}>{name}</span>
}

/** Roles first, then up to `max` specialties (+N). */
export function RowBadges({ r, max = 3 }: { r: TargetRow; max?: number }) {
  const roles = rolesOf(r), specs = specsOf(r)
  if (!roles.length && !specs.length) return null
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="row-badges">
      {roles.map((x) => <RoleChip key={`r${x}`} role={x} />)}
      {specs.slice(0, max).map((x) => <SpecChip key={`s${x}`} name={x} />)}
      {specs.length > max ? <span className="text-[12px] leading-[18px] text-[var(--color-text-secondary)]">+{specs.length - max}</span> : null}
    </span>
  )
}
