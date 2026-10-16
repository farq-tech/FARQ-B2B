import { IconBase, type FarqIconProps } from './base'

/**
 * السوق — A Saudi shop front: a zigzag Sadu-style awning over an arched door.
 * Used in: Sidebar section «السوق».
 */
export function MarketIcon(props: FarqIconProps) {
  return (
    <IconBase name="market" {...props}>
      <path className="fi-fill" d="M5 4h14l1.5 3.5H3.5z" /><path d="M3.5 7.5l2.125 2 2.125-2 2.125 2L12 7.5l2.125 2 2.125-2 2.125 2 2.125-2" /><path d="M5 11.75v8.75M19 11.75v8.75M3.5 20.5h17" /><path className="fi-fill" d="M9.5 20.5V16a2.5 2.5 0 0 1 5 0v4.5" />
    </IconBase>
  )
}
