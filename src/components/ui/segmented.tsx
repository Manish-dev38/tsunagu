import * as React from 'react'

import { cn } from '@/lib/utils'

type Option<T extends string> = {
  value: T
  label: React.ReactNode
  /** Needed when the label is only an icon. */
  'aria-label'?: string
}

/**
 * The theme switch and filter switches. Prototype-exact sizing: the container
 * keeps the 3px inset and every segment takes an equal third, so System/Light/
 * Dark come out even. The active segment is the one place a warm brown fill is
 * allowed: orange-100 on light, orange-900/40 on dark.
 *
 * Local edit over the registry item (ADR-0002): sizing retuned to the Tsunagu
 * prototype's `.segmented` rules; re-adding the item would overwrite this.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  /** Names the group for screen readers. */
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="segmented"
      className={cn(
        'flex max-w-full gap-0.5 rounded-[calc(var(--radius)+2px)] border border-border bg-card-fill p-[3px]',
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o['aria-label']}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[calc(var(--radius)-1px)] px-1 py-1.5 text-[12px] font-semibold whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            value === o.value
              ? 'bg-[var(--seg-active-bg)] text-[var(--seg-active-text)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export { Segmented }
