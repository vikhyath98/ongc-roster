// Temporary stub for a module screen. Internals are built in later steps
// of SPEC.md §7. Keeps the authenticated shell navigable from day one.
export default function ModulePlaceholder({ title, spec, children }) {
  return (
    <section className="placeholder">
      <h2 className="placeholder__title">{title}</h2>
      {spec && <p className="placeholder__spec">Spec: {spec}</p>}
      <p className="muted">
        {children ?? 'This module will be built in a later step.'}
      </p>
    </section>
  )
}
