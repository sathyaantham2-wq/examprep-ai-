import { cn } from '../lib/utils'

// A selectable subject. Unselected is neutral; selected turns blue and shows a check mark so the
// state never depends on colour alone.
export function SubjectCard({
  name,
  selected,
  note,
  onToggle,
}: {
  name: string
  selected: boolean
  note?: string
  onToggle?: () => void
}) {
  const className = cn(
    'flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors',
    selected
      ? 'border-blue-600 bg-blue-600 text-white'
      : 'border-border bg-background text-foreground hover:border-blue-400',
    !onToggle && 'cursor-default',
  )
  const body = (
    <>
      <span>
        <span className="text-body block font-medium">{name}</span>
        {note && (
          <span className={cn('text-small block', selected ? 'text-blue-100' : 'text-muted-foreground')}>
            {note}
          </span>
        )}
      </span>
      <span aria-hidden="true" className="text-h3 w-6 text-center">
        {selected ? '✓' : ''}
      </span>
    </>
  )
  if (!onToggle) {
    return <div className={className}>{body}</div>
  }
  return (
    <button type="button" role="checkbox" aria-checked={selected} onClick={onToggle} className={className}>
      {body}
    </button>
  )
}
