import { Search } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'
import { inputClass } from '@/components/ui/input'

/**
 * A search box for listing toolbars. Password managers are told to leave it
 * alone, and it needs a label because there is no visible one.
 */
function SearchInput({
  className,
  wrapperClassName,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { 'aria-label': string; wrapperClassName?: string }) {
  return (
    <div className={cn('relative w-full sm:w-52', wrapperClassName)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        data-slot="search-input"
        type="search"
        autoComplete="off"
        data-1p-ignore=""
        data-lpignore="true"
        className={cn(inputClass, 'pl-8 [&::-webkit-search-cancel-button]:appearance-none', className)}
        {...props}
      />
    </div>
  )
}

export { SearchInput }
