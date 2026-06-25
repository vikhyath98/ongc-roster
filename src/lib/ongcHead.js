import { supabase } from './supabase'
import { listInstallations } from './reference'
import { listOffshoreStints } from './boarding'
import { getAppConfig, configInt } from './config'
import { classifyOffshoreEmployee } from './manifestPipeline'
import { daysInclusive, todayISO } from './dates'

// ONGC Head view data (SPEC.md §17.O, Workstream O). One read-only aggregate per
// installation for the 14-card grid + drill-down. Reads existing tables/views
// only — no writes, no migration.

// All 14 installations with per-site rotation health, open penalty exposure, and
// expected ONGC dispute amount, plus the aboard-employee list for the drill-down
// (name + days served + manifest status only — no PII beyond that, §17.O).
export async function loadOngcHeadData() {
  const today = todayISO()
  const [instRes, stintRes, mriRes, pairRes, expRes, recRes, attrRes, cfgRes] = await Promise.all([
    listInstallations(), // all sites, no activeOnly filter — show all 14
    listOffshoreStints(),
    supabase.from('manifest_request_items').select('employee_id,replacing_employee_id'),
    supabase
      .from('replacement_pairings')
      .select('outgoing_employee_id,status,consumed_at,created_at,updated_at'),
    supabase
      .from('penalty_exposure')
      .select('rotation_log_id,installation_id,total_penalty,daily_penalty_rate,finalised'),
    supabase.from('penalty_log').select('rotation_log_id').eq('status', 'reconciled'),
    supabase
      .from('overstay_attributions')
      .select(
        'rotation_log_id,segment_1_days,segment_1_attribution,segment_2_days,segment_2_attribution,' +
          'rotation_log:rotation_log(installation_id)'
      ),
    getAppConfig(),
  ])
  const error =
    instRes.error ||
    stintRes.error ||
    mriRes.error ||
    pairRes.error ||
    expRes.error ||
    recRes.error ||
    attrRes.error ||
    cfgRes.error
  if (error) return { error }

  const warning = configInt(cfgRes.config, 'warning_day', 65)
  const max = configInt(cfgRes.config, 'max_service_days', 70)

  const installations = instRes.data ?? []
  const stints = stintRes.data ?? []
  const manifestItems = mriRes.data ?? []
  const pairings = pairRes.data ?? []

  // Open penalty exposure per installation: finalised (signed-off) overstays that
  // have NOT been reconciled. Also index each stint's daily rate for the dispute
  // calc below.
  const reconciled = new Set((recRes.data ?? []).map((r) => r.rotation_log_id))
  const rateByStint = new Map()
  const openExposureByInst = new Map()
  for (const e of expRes.data ?? []) {
    rateByStint.set(e.rotation_log_id, Number(e.daily_penalty_rate || 0))
    if (e.finalised && !reconciled.has(e.rotation_log_id)) {
      openExposureByInst.set(
        e.installation_id,
        (openExposureByInst.get(e.installation_id) ?? 0) + Number(e.total_penalty || 0)
      )
    }
  }

  // Expected dispute = ONGC-attributed days × the stint's daily rate, summed per
  // installation. Attributions exist only for offboarded stints, so this excludes
  // active overstays (surfaced as a footnote in the UI).
  const disputeByInst = new Map()
  for (const a of attrRes.data ?? []) {
    const instId = a.rotation_log?.installation_id
    if (!instId) continue
    let ongcDays = 0
    if (a.segment_1_attribution === 'ongc') ongcDays += a.segment_1_days || 0
    if (a.segment_2_attribution === 'ongc') ongcDays += a.segment_2_days || 0
    if (ongcDays === 0) continue
    const rate = rateByStint.get(a.rotation_log_id) ?? 0
    disputeByInst.set(instId, (disputeByInst.get(instId) ?? 0) + ongcDays * rate)
  }

  // Group open stints by installation: headcount, green/amber/red bands, and the
  // drill-down roster (name + days + manifest status only).
  const buckets = new Map()
  for (const inst of installations) {
    buckets.set(inst.id, { personsOnBoard: 0, green: 0, amber: 0, red: 0, employees: [] })
  }
  for (const s of stints) {
    const instId = s.installation_id ?? s.installation?.id
    const b = buckets.get(instId)
    if (!b) continue
    const days = daysInclusive(s.sign_on_date, today)
    b.personsOnBoard++
    if (days >= max) b.red++
    else if (days >= warning) b.amber++
    else b.green++
    const cls = classifyOffshoreEmployee(s, { manifestItems, pairings, warningDay: warning, today })
    b.employees.push({ name: s.employee?.full_name ?? '—', days, manifestStatus: cls?.column ?? null })
  }

  const cards = installations.map((inst) => {
    const b = buckets.get(inst.id)
    return {
      id: inst.id,
      name: inst.name,
      type: inst.type,
      personsOnBoard: b.personsOnBoard,
      green: b.green,
      amber: b.amber,
      red: b.red,
      openExposure: openExposureByInst.get(inst.id) ?? 0,
      disputeAmount: disputeByInst.get(inst.id) ?? 0,
      employees: b.employees.sort((x, y) => y.days - x.days),
    }
  })

  return { error: null, installations: cards, updatedAt: new Date() }
}
