import { IconBase, type FarqIconProps } from './base'

/**
 * فلاتر — Three centred lines, each shorter than the one above.
 * Used in: Area filter bar «تضييق النتائج» on خريطة الفرص.
 */
export function FiltersIcon(props: FarqIconProps) {
  return (
    <IconBase name="filters" {...props}>
      <path d="M4 7h16M7 12h10M10 17h4" />
    </IconBase>
  )
}
