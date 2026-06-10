import { useState } from 'react'
import ThresholdsConfig from '../components/config/ThresholdsConfig'
import InstallationsConfig from '../components/config/InstallationsConfig'
import DesignationsConfig from '../components/config/DesignationsConfig'
import DocumentTypesConfig from '../components/config/DocumentTypesConfig'

// Configuration (SPEC.md §5.8). A section picker keeps each editor focused on
// a phone. More sections are added in subsequent build steps.
const SECTIONS = [
  { key: 'thresholds', label: 'Thresholds & rates', Component: ThresholdsConfig },
  { key: 'installations', label: 'Installations', Component: InstallationsConfig },
  { key: 'designations', label: 'Designations', Component: DesignationsConfig },
  { key: 'documents', label: 'Document types', Component: DocumentTypesConfig },
]

export default function Configuration() {
  const [section, setSection] = useState(SECTIONS[0].key)
  const Active = SECTIONS.find((s) => s.key === section)?.Component ?? (() => null)

  return (
    <section>
      <label className="field">
        <span>Section</span>
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          {SECTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <div className="config-section">
        <Active />
      </div>
    </section>
  )
}
