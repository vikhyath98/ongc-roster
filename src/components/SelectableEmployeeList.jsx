import { useMemo, useState } from 'react'

// Searchable, multi-select list of people. Used by both onboard (base staff)
// and offboard (offshore staff). `items` each need an `id`; `searchText` and
// `renderMeta` adapt it to either context.
//
// `isDisabled(item)` marks a row unselectable (e.g. cert not current) — it is
// greyed out and cannot be toggled or bulk-selected. `renderExtra(item)` adds
// a third line inside the card (a badge or a blocking reason).
export default function SelectableEmployeeList({
  items,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  searchText,
  renderPrimary,
  renderMeta,
  renderExtra,
  isDisabled = () => false,
  emptyText = 'Nobody here.',
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => searchText(it).toLowerCase().includes(q))
  }, [items, query, searchText])

  const selectable = useMemo(() => filtered.filter((it) => !isDisabled(it)), [filtered, isDisabled])
  const allVisibleSelected =
    selectable.length > 0 && selectable.every((it) => selected.has(it.id))

  return (
    <div className="select-list">
      <input
        className="search"
        type="search"
        placeholder="Search name, ID or designation…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="select-list__bar">
        <span className="muted">
          {selected.size} selected · {filtered.length} shown
        </span>
        <div className="select-list__bar-actions">
          <button
            type="button"
            className="linkish"
            onClick={() => onSelectAll(selectable.map((it) => it.id))}
            disabled={selectable.length === 0 || allVisibleSelected}
          >
            Select all
          </button>
          <button type="button" className="linkish" onClick={onClear} disabled={selected.size === 0}>
            Clear
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="muted empty-state">{emptyText}</p>
      ) : (
        <ul className="card-list">
          {filtered.map((it) => {
            const disabled = isDisabled(it)
            const isSel = selected.has(it.id)
            const extra = renderExtra ? renderExtra(it) : null
            return (
              <li key={it.id}>
                <button
                  type="button"
                  className={
                    'pick-card' +
                    (isSel ? ' pick-card--on' : '') +
                    (disabled ? ' pick-card--disabled' : '')
                  }
                  onClick={() => !disabled && onToggle(it.id)}
                  aria-pressed={disabled ? undefined : isSel}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                >
                  <span className={'pick-card__check' + (isSel ? ' pick-card__check--on' : '')}>
                    {isSel ? '✓' : ''}
                  </span>
                  <span className="pick-card__main">
                    <span className="emp-card__name">{renderPrimary(it)}</span>
                    <span className="emp-card__meta">{renderMeta(it)}</span>
                    {extra && <span className="pick-card__extra">{extra}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
