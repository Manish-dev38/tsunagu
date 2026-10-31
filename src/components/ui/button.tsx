import { Slot, Slottable } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { ArrowUpRight } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * chaicode.com's buttons (ui/button.tsx and landing/hero.tsx).
 *
 * - `soft` is the default: the shadcn primary, light grey on dark. It is the
 *   button on cards ("View details", "Start").
 * - `solid` is the white one with asymmetric corners. Use it once per screen,
 *   for the main action. It carries ArrowUpRight unless `iconRight={null}`.
 * - `outline` mirrors the corners and sits beside `solid`.
 * - `danger` is only for the confirm button of a destructive action.
 *
 * There is no colour prop on purpose: orange never fills a button.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-[7px] border font-semibold whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-[0.45] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[15px]",
  {
    variants: {
      variant: {
        soft: 'border-transparent rounded-[calc(var(--radius)-2px)] bg-primary font-montserrat text-primary-foreground hover:bg-primary/90',
        solid: 'border-transparent btn-asym bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'btn-asym-mirror border-border bg-transparent text-foreground hover:border-[var(--card-edge-hover)] hover:bg-[var(--hover-fill)]',
        muted:
          'border-transparent rounded-md bg-[#d4d4d866] font-montserrat text-[#52525b] hover:bg-[#d4d4d8] dark:bg-[#71717a33] dark:text-[#d4d4d8] dark:hover:bg-black/70',
        ghost: 'border-transparent rounded-[calc(var(--radius)-2px)] text-muted-foreground hover:text-foreground hover:bg-[var(--hover-fill)]',
        danger: 'border-transparent rounded-md bg-red-600 font-semibold text-white hover:bg-red-600/90 dark:bg-red-500 dark:hover:bg-red-500/90',
      },
      size: {
        sm: 'h-[30px] px-3 text-[12.5px]',
        md: 'h-9 px-4 text-[13.5px]',
        lg: 'h-10 px-6 text-[13.5px]',
        icon: 'size-9 text-[13.5px]',
      },
    },
    defaultVariants: {
      variant: 'soft',
      size: 'md',
    },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** An icon after the label, tucked in with -ml-1. `solid` defaults to ArrowUpRight; pass null to drop it. */
    iconRight?: React.ReactNode
  }

function Button({ className, variant, size, asChild = false, iconRight, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  const icon = iconRight === undefined && variant === 'solid' && size !== 'icon' ? <ArrowUpRight /> : iconRight
  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props}>
      <Slottable>{children}</Slottable>
      {icon ? (
        <span aria-hidden="true" className="-ml-1 inline-flex">
          {icon}
        </span>
      ) : null}
    </Comp>
  )
}

export { Button, buttonVariants }
