import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The prototype's `.input`: h-9 (the composer overrides to 42px), an 8px
 * radius, a grey hairline, near-black glass on dark. The focus ring stays
 * (accessibility) even though the prototype only changes the border colour.
 */
const inputClass =
  'h-9 w-full min-w-0 rounded-[calc(var(--radius)-2px)] border border-input bg-background/80 px-3 text-[13.5px] text-foreground transition-colors duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500/60'

function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" type={type} className={cn(inputClass, className)} {...props} />
}

export { Input, inputClass }
