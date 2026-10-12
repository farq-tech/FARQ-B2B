import { createContext, useContext, useState, type ReactNode } from 'react'
import { FOCUS_RING, cx } from '../../ui/cx'
import { LinkButton } from './kit'
import { START_HREF } from './contact'

export const GOALS = {
  pricing: { label: 'بائعون', action: 'ابحث عن بائعين', prompt: 'أبحث عن بائعين — أبي أشتري' },
  marketing: { label: 'مشترون', action: 'ابحث عن مشترين', prompt: 'أبحث عن مشترين — أبي أبيع' },
} as const
export type LandingGoal = keyof typeof GOALS
const GoalContext = createContext<{ goal: LandingGoal | null; choose: (goal: LandingGoal) => void }>({ goal: null, choose: () => {} })
export function GoalProvider({ children }: { children: ReactNode }) {
  const [goal, choose] = useState<LandingGoal | null>(null)
  return <GoalContext.Provider value={{ goal, choose }}>{children}</GoalContext.Provider>
}
export const useLandingGoal = () => useContext(GoalContext)

export function GoalChooser() {
  const { goal, choose } = useLandingGoal()
  return <fieldset className="w-full min-w-0">
    <legend className="mb-2 text-sm font-medium">وش هدف منشأتك؟</legend>
    <div className="flex flex-wrap gap-2">
      {(Object.keys(GOALS) as LandingGoal[]).map(key => <label key={key} className={cx('relative cursor-pointer rounded-full border px-4 py-2 text-sm', goal === key ? 'border-[var(--color-border-strong)] bg-[var(--color-bg-primary-subtle)]' : 'border-[var(--color-border-default)] bg-[var(--color-bg-surface)]')}>
        <input type="radio" name="landing-goal" value={key} checked={goal === key} onChange={() => choose(key)} className="me-2 accent-[var(--brand-action-strong)]" />
        {GOALS[key].prompt}
      </label>)}
    </div>
  </fieldset>
}

export function GoalStart({ fullWidth = false, compact = false }: { fullWidth?: boolean; compact?: boolean }) {
  const { goal } = useLandingGoal()
  return <span className={cx('inline-flex rounded-lg', FOCUS_RING, fullWidth && 'w-full')}>
    <LinkButton href={goal ? START_HREF : '#goal-start'} variant="Accent" size={compact ? 'M' : undefined} fullWidth={fullWidth} icon={compact ? undefined : 'arrow-forward'}>
      {goal ? GOALS[goal].action : 'حدد هدفك وابدأ'}
    </LinkButton>
  </span>
}
