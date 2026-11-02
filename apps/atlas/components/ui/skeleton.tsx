import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

/**
 * Wraps a loading placeholder: announces «جارٍ التحميل» once to screen readers and hides the grey shapes from them.
 * `className` lays out the shapes themselves, so `divide-y`, `grid` and `gap-*` apply to them directly.
 */
function SkeletonStatus({ label = "جارٍ التحميل", className, children, ...props }: React.ComponentProps<"div"> & { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" {...props}>
      <span className="sr-only">{label}</span>
      <div aria-hidden className={className}>{children}</div>
    </div>
  )
}

type RowsProps = {
  /** how many placeholder rows */
  rows?: number
  /** a second, shorter line under the title (a district, a category) */
  sub?: boolean
  /** a value at the row's end (a count, a price); "double" stacks two lines */
  trailing?: boolean | "double"
  /** what sits before the title: a photo thumb, a colour swatch or a checkbox */
  leading?: "thumb" | "swatch" | "check"
  /** rows drawn as bordered cards instead of a divided list */
  boxed?: boolean
  /** a tight label/value list (no dividers, small gap) */
  dense?: boolean
  label?: string
  className?: string
}

const WIDTHS = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-1/3"]

/** A list that is loading: rows with the same height and parts as the rows that will replace them. */
function SkeletonRows({ rows = 4, sub = false, trailing = false, leading, boxed = false, dense = false, label, className }: RowsProps) {
  return (
    <SkeletonStatus label={label} className={cn("flex flex-col", dense || boxed ? "gap-1.5" : "divide-y", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cn("flex items-center gap-2", dense ? "justify-between" : "py-2", boxed && "rounded-lg border p-2")}>
          {leading === "thumb" && <Skeleton className="size-14 shrink-0 rounded-lg" />}
          {leading === "swatch" && <Skeleton className="h-3 w-5 shrink-0 rounded-sm" />}
          {leading === "check" && <Skeleton className="size-4 shrink-0 rounded-sm" />}
          <div className={cn("flex min-w-0 flex-col gap-1.5", dense ? "w-1/3" : "flex-1")}>
            <Skeleton className={cn("h-4", dense ? "w-full" : WIDTHS[index % WIDTHS.length])} />
            {sub && <Skeleton className="h-3 w-1/3" />}
          </div>
          {trailing && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Skeleton className={cn("h-4", dense ? "w-24" : "w-14")} />
              {trailing === "double" && <Skeleton className="h-3 w-16" />}
            </div>
          )}
        </div>
      ))}
    </SkeletonStatus>
  )
}

/** A row of stat tiles that is loading: a small label over a large number in each tile. */
function SkeletonStats({ count = 3, label, className }: { count?: number; label?: string; className?: string }) {
  return (
    <SkeletonStatus label={label} className={cn("grid gap-2", count === 2 ? "grid-cols-2" : "grid-cols-3", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5 rounded-xl bg-muted/40 px-3 py-2.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      ))}
    </SkeletonStatus>
  )
}

export { Skeleton, SkeletonRows, SkeletonStats, SkeletonStatus }
