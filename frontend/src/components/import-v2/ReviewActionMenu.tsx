import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'

export type ReviewAction = {
  label: string
  icon: LucideIcon
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  hint?: string
}

export function ReviewActionMenu({
  actions,
  label = '更多操作',
}: {
  actions: ReviewAction[]
  label?: string
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
        >
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <div key={action.label}>
                {action.separatorBefore ? <DropdownMenu.Separator className="my-1 h-px bg-border" /> : null}
                <DropdownMenu.Item
                  disabled={action.disabled}
                  onSelect={action.onSelect}
                  className={`flex cursor-default select-none items-start gap-2.5 rounded-sm px-2 py-2 text-xs outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${
                    action.danger
                      ? 'text-destructive focus:bg-destructive/10 focus:text-destructive'
                      : 'focus:bg-accent focus:text-accent-foreground'
                  }`}
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block font-medium">{action.label}</span>
                    {action.hint ? <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{action.hint}</span> : null}
                  </span>
                </DropdownMenu.Item>
              </div>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
