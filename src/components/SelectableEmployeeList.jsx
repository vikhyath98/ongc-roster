import { useMemo, useState } from 'react'

// Searchable, multi-select list of people. Used by both onboard (base staff)
// and offboard (offshore staff). `items` each need an `id`; `searchText` and
// `renderMeta` adapt it to either context.
export default function SelectableEmployeeList({
  items,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  searchText,
  renderPrimary,
  renderMeta,
  emptyText = 'Nobody here.',
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => searchText(it).toLowerCase().includes(q))
  }, [items, query, searchText])

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((it) => selected.has(it.id))

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
            onClick={() => onSelectAll(filtered.map((it) => it.id))}
            disabled={filtered.length === 0 || allVisibleSelected}
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
            const isSel = selected.has(it.id)
            return (
              <li key={it.id}>
                <button
                  type="button"
                  className={'pick-card' + (isSel ? ' pick-card--on' : '')}
                  onClick={() => onToggle(it.id)}
                  aria-pressed={isSel}
                >
                  <span className={'pick-card__check' + (isSel ? ' pick-card__check--on' : '')}>
                    {isSel ? '✓' : ''}
                  </span>
                  <span className="pick-card__main">
                    <span className="emp-card__name">{renderPrimary(it)}</span>
                    <span className="emp-card__meta">{renderMeta(it)}</span>
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
