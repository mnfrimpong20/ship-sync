import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Bot, CalendarClock, Check, Container, FileText, FlaskConical, MessageCircle, Pencil, Plus, Receipt, Scale, Send, Smartphone, Trash2, Wallet, Workflow, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { autopilotApi, type AutopilotSettings, type ChatMessage, type Conversation, type Field, type LogLine, type Op, type Rule, type RuleAction, type RuleInput, type Trigger } from '../lib/autopilot'
import { partnersApi, serviceLabels, type DestPartner } from '../lib/partners'
import { countries } from '../lib/data'
import { fadeUp, stagger } from '../lib/motion'
import { fmtDateTime } from '../components/ui'

const cls = 'input-dark !min-h-9 text-sm'
const msgOf = (e: unknown, f: string) => (e instanceof Error ? e.message : f)
type Tab = 'switches' | 'activity' | 'rules' | 'assistant'

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-teal' : 'bg-border'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} /></button>
}
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-full border border-border p-0.5 text-xs">{options.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`rounded-full px-3 py-1.5 ${value === v ? 'bg-gold font-semibold text-[#14213D]' : 'text-text-muted hover:text-text'}`}>{l}</button>)}</div>
}
function Card({ icon: I, title, sub, count, on, children, testid }: { icon: typeof Bot; title: string; sub: string; count?: number; on: boolean; children: React.ReactNode; testid?: string }) {
  return (
    <motion.section variants={fadeUp} className={`card-dark p-5 ${on ? '' : 'opacity-90'}`} data-testid={testid}>
      <div className="flex items-start gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${on ? 'bg-gold/15 text-gold-deep' : 'bg-surface-2 text-text-muted'}`}><I size={18} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><h2 className="flex flex-wrap items-center gap-2 !text-base">{title}{count ? <span className="rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal">{count} this week</span> : null}</h2><p className="mt-0.5 text-sm text-text-muted">{sub}</p><div className="mt-3 space-y-3 text-sm">{children}</div></div></div>
    </motion.section>
  )
}

/* ---------------- switches ---------------- */
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Paris', 'Africa/Accra', 'Africa/Lagos']
function Switches({ s, week, texting, save }: { s: AutopilotSettings; week: Record<string, number>; texting: boolean; save: (p: Partial<AutopilotSettings>) => void }) {
  const [msg, setMsg] = useState(s.followUpMessage); const [planMsg, setPlanMsg] = useState(''); const [busy, setBusy] = useState(false)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const plan = async () => { setBusy(true); setPlanMsg(''); try { const r = await autopilotApi.planPickups(tomorrow); setPlanMsg(`Planned ${r.stops} pickup${r.stops === 1 ? '' : 's'} on ${r.runs} run${r.runs === 1 ? '' : 's'}${r.texted ? `, ${r.texted} customers texted` : ''}.`) } catch (e) { setPlanMsg(msgOf(e, 'Could not plan.')) } finally { setBusy(false) } }
  return (
    <motion.div initial="hidden" animate="show" variants={stagger} className="mt-6 grid gap-4 lg:grid-cols-2">
      <Card icon={Wallet} title="Chase unpaid bookings" sub="Customers who haven’t paid get a reminder 2 days after booking, 3 days before pickup, and when the cargo reaches the port. Invoices keep their own reminder schedule under Collections." count={week.unpaid} on={s.unpaidReminders} testid="ap-unpaid">
        <div className="flex items-center justify-between gap-3"><span>Send payment reminders</span><Toggle on={s.unpaidReminders} onChange={(v) => save({ unpaidReminders: v })} label="Send payment reminders" /></div>
        {!texting && <p className="text-xs text-text-muted">Texts start once SMS/WhatsApp is set up; until then reminders go by email and in the app.</p>}
      </Card>
      <Card icon={Scale} title="Re-price after weighing" sub="When goods weigh in heavier than declared, a new price is worked out from the chargeable weight. The customer approves it in one tap and the bill updates." count={week.reprice} on={s.reprice !== 'off'} testid="ap-reprice">
        <Seg label="Re-pricing" value={s.reprice} onChange={(v) => save({ reprice: v })} options={[['off', 'Off'], ['review', 'I review first'], ['auto', 'Send to customer']]} />
        <label className="flex items-center gap-2">When at least <input type="number" min={3} max={100} className={`${cls} !w-16`} value={s.repriceThresholdPct} onChange={(e) => save({ repriceThresholdPct: Number(e.target.value) || 10 })} />% over what was declared</label>
      </Card>
      <Card icon={Container} title="Fill containers" sub="Before each cut-off you’re told what would fill an open container. Once it’s full enough, you’re reminded to book space with the line." count={week.container} on={s.containerFill} testid="ap-containers">
        <div className="flex items-center justify-between gap-3"><span>Container suggestions</span><Toggle on={s.containerFill} onChange={(v) => save({ containerFill: v })} label="Container suggestions" /></div>
        <label className="flex flex-wrap items-center gap-2">Load suggested shipments automatically <select className={`${cls} !w-auto`} value={s.autoLoadDays} onChange={(e) => save({ autoLoadDays: Number(e.target.value) })}><option value={0}>never — just suggest</option>{[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'} before cut-off</option>)}</select></label>
        <label className="flex items-center gap-2">Prompt to book space at <input type="number" min={50} max={100} className={`${cls} !w-16`} value={s.fillTargetPct} onChange={(e) => save({ fillTargetPct: Number(e.target.value) || 80 })} />% full</label>
      </Card>
      <Card icon={CalendarClock} title="Plan tomorrow’s pickups" sub="Every evening, tomorrow’s pickups are split into runs by area, put in driving order, given to your drivers — and every customer is texted a two-hour window." count={week.pickups} on={s.pickupPlanning} testid="ap-pickups">
        <div className="flex items-center justify-between gap-3"><span>Plan automatically</span><Toggle on={s.pickupPlanning} onChange={(v) => save({ pickupPlanning: v })} label="Plan pickups automatically" /></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Plan at</span><select className={cls} value={s.planHour} onChange={(e) => save({ planHour: Number(e.target.value) })}>{[14, 15, 16, 17, 18, 19, 20].map((h) => <option key={h} value={h}>{h > 12 ? h - 12 : h} pm</option>)}</select></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Drivers start</span><input type="time" className={cls} value={s.dayStart} onChange={(e) => save({ dayStart: e.target.value })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Max stops / run</span><input type="number" min={3} max={40} className={cls} value={s.maxStopsPerRun} onChange={(e) => save({ maxStopsPerRun: Number(e.target.value) || 12 })} /></label>
          <label className="grid gap-1 text-xs"><span className="text-text-muted">Time zone</span><select className={cls} value={s.timezone} onChange={(e) => save({ timezone: e.target.value })}>{ZONES.map((z) => <option key={z} value={z}>{z.split('/')[1].replace('_', ' ')}</option>)}</select></label>
        </div>
        <div className="flex items-center justify-between gap-3"><span>Text customers their arrival window</span><Toggle on={s.textWindows} onChange={(v) => save({ textWindows: v })} label="Text arrival windows" /></div>
        <div className="flex flex-wrap items-center gap-2"><button onClick={plan} disabled={busy} className="btn-ghost !min-h-9 text-xs" data-testid="plan-now"><CalendarClock size={14} aria-hidden="true" /> Plan tomorrow now</button>{planMsg && <span role="status" className="text-xs text-text-muted">{planMsg}</span>}</div>
      </Card>
      <Card icon={Send} title="Follow up on quotes" sub="A quote with no answer gets a friendly follow-up from you — or a nudge to your team to send one." count={week.followup} on={s.quoteFollowUp !== 'off'} testid="ap-followup">
        <Seg label="Quote follow-up" value={s.quoteFollowUp} onChange={(v) => save({ quoteFollowUp: v })} options={[['off', 'Off'], ['remind', 'Remind my team'], ['auto', 'Send it for me']]} />
        <label className="flex items-center gap-2">After <select className={`${cls} !w-auto`} value={s.followUpHours} onChange={(e) => save({ followUpHours: Number(e.target.value) })}>{[24, 48, 72, 96].map((h) => <option key={h} value={h}>{h / 24} day{h === 24 ? '' : 's'}</option>)}</select> with no reply</label>
        {s.quoteFollowUp === 'auto' && <label className="grid gap-1 text-xs"><span className="text-text-muted">Message — {'{name}'}, {'{ref}'} and {'{price}'} are filled in</span><textarea rows={3} className="input-dark py-2 text-sm" value={msg} onChange={(e) => setMsg(e.target.value)} onBlur={() => msg !== s.followUpMessage && msg.trim().length >= 10 && save({ followUpMessage: msg })} /></label>}
      </Card>
      <Card icon={FileText} title="Draft the paperwork" sub="When a container is gated in, a house bill of lading is drafted for every shipment in it; US exports also get the shipper’s letter of instruction for the EEI filing." count={week.paperwork} on={s.paperwork} testid="ap-paperwork">
        <div className="flex items-center justify-between gap-3"><span>Draft documents automatically</span><Toggle on={s.paperwork} onChange={(v) => save({ paperwork: v })} label="Draft documents" /></div>
      </Card>
      <Card icon={Receipt} title="Charge duty at destination" sub="When a shipment lands with a duty estimate (or the official assessment), the receiver’s charge is drafted in local currency — or sent for mobile-money payment." count={week.destination} on={s.destinationCharges !== 'off'} testid="ap-destination">
        <Seg label="Destination charges" value={s.destinationCharges} onChange={(v) => save({ destinationCharges: v })} options={[['off', 'Off'], ['draft', 'Draft — I’ll check'], ['send', 'Send to receiver']]} />
        <p className="text-xs text-text-muted">Skipped when the sender already prepaid duty.</p>
      </Card>
      <Card icon={MessageCircle} title="WhatsApp helper" sub="Answers your customers’ “where is my package?”, “what do I owe?” and “I want to send…” messages on Ntemtem’s WhatsApp, from live data. Anything else comes to your team." count={week.assistant} on={s.assistant} testid="ap-assistant">
        <div className="flex items-center justify-between gap-3"><span>Let the helper answer my customers</span><Toggle on={s.assistant} onChange={(v) => save({ assistant: v })} label="WhatsApp helper" /></div>
        <Link to="/dashboard/autopilot?tab=assistant" className="text-xs text-gold-deep hover:underline">Open the WhatsApp inbox and try it →</Link>
      </Card>
    </motion.div>
  )
}

/* ---------------- activity ---------------- */
const KIND_ICON: Record<string, typeof Bot> = { unpaid: Wallet, reprice: Scale, container: Container, pickups: CalendarClock, followup: Send, paperwork: FileText, destination: Receipt, rule: Workflow, assistant: MessageCircle }
function Activity({ log }: { log: LogLine[] }) {
  if (!log.length) return <p className="card-dark mt-6 p-8 text-center text-sm text-text-muted">Nothing yet — Autopilot writes here every time it does something.</p>
  return (
    <ol className="card-dark mt-6 divide-y divide-border/70 p-2" data-testid="ap-log">{log.map((l) => { const I = KIND_ICON[l.kind] ?? Bot; return (
      <li key={l.id} className="flex gap-3 p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-gold-deep"><I size={15} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{l.link ? <Link to={l.link} className="hover:underline">{l.title}</Link> : l.title}</p>{l.body && <p className="mt-0.5 text-text-muted">{l.body}</p>}<p className="mt-0.5 text-xs text-text-muted">{l.at ? fmtDateTime(l.at) : ''}</p></div></li>) })}</ol>
  )
}

/* ---------------- rules ---------------- */
const TRIGGERS: [Trigger, string][] = [['shipment.booked', 'A shipment is booked'], ['shipment.status', 'A shipment reaches a stage'], ['shipment.measured', 'A shipment is weighed'], ['container.stage', 'A container reaches a stage'], ['invoice.overdue', 'An invoice goes overdue'], ['request.received', 'A new request arrives']]
const FIELDS: [Field, string][] = [['destination', 'Destination country'], ['receiverCity', 'Receiver’s town'], ['origin', 'Origin'], ['cargo', 'Cargo'], ['mode', 'Air or ocean'], ['customer', 'Customer name'], ['valueUsd', 'Declared value ($)'], ['pieces', 'Number of pieces'], ['diffPct', '% over declared weight'], ['overdueDays', 'Days overdue'], ['amountUsd', 'Invoice amount ($)']]
const OPS: [Op, string][] = [['is', 'is'], ['is_not', 'is not'], ['contains', 'contains'], ['at_least', 'is at least'], ['at_most', 'is at most']]
const STAGES: Record<string, [string, string][]> = { 'shipment.status': [['picked_up', 'Picked up'], ['at_origin_port', 'At origin port'], ['in_transit', 'In transit'], ['arrived', 'Arrived'], ['customs', 'Customs'], ['ready_for_collection', 'Ready for collection'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered']], 'container.stage': [['loading', 'Loading'], ['gated_in', 'Gated in'], ['sailed', 'Sailed'], ['arrived', 'Arrived'], ['customs', 'Customs'], ['devanned', 'Unloaded']] }
const ACTION_LABEL: Record<RuleAction['type'], string> = { notify_team: 'Tell my team', message_customer: 'Message the customer', assign_partner: 'Assign an Ntemtem partner', receiver_charge: 'Add a receiver charge', set_handover: 'Set handover', add_note: 'Add a note to the timeline', make_document: 'Draft a document' }
const blankAction = (t: RuleAction['type']): RuleAction => t === 'notify_team' ? { type: t, roles: ['owner', 'dispatcher'], message: '{ref} — ' } : t === 'message_customer' ? { type: t, message: 'Hi {customer}, ' } : t === 'assign_partner' ? { type: t, partnerId: '', services: ['delivery'] } : t === 'receiver_charge' ? { type: t, amount: 0, currency: 'GHS', reason: 'Delivery to the door', send: false } : t === 'set_handover' ? { type: t, handover: 'delivery' } : t === 'add_note' ? { type: t, note: '' } : { type: 'make_document', kind: 'packing_list' }
const PRESETS: { name: string; rule: RuleInput }[] = [
  { name: 'Kumasi deliveries → my Kumasi partner', rule: { name: 'Kumasi deliveries to Kejetia', trigger: 'container.stage', status: 'sailed', conditions: [{ field: 'destination', op: 'is', value: 'GH' }], actions: [{ type: 'assign_partner', partnerId: '', services: ['delivery'] }], active: true } },
  { name: 'Weighed 20% over → tell finance', rule: { name: 'Big weight differences', trigger: 'shipment.measured', status: '', conditions: [{ field: 'diffPct', op: 'at_least', value: '20' }], actions: [{ type: 'notify_team', roles: ['owner', 'finance'], message: '{ref} came in heavy — check the price' }], active: true } },
  { name: 'Container sailed → message every customer', rule: { name: 'Sailing message', trigger: 'container.stage', status: 'sailed', conditions: [], actions: [{ type: 'message_customer', message: 'Good news — your shipment {ref} has sailed for {destination}. Track it any time on Ntemtem.' }], active: true } },
  { name: 'Lagos bookings → Form M reminder', rule: { name: 'Nigeria paperwork', trigger: 'shipment.booked', status: '', conditions: [{ field: 'destination', op: 'is', value: 'NG' }], actions: [{ type: 'add_note', note: 'Nigeria: check the consignee has Form M / PAAR before loading.' }, { type: 'notify_team', roles: ['dispatcher'], message: '{ref} to Nigeria — get Form M from the consignee' }], active: true } },
  { name: 'Invoice 14+ days overdue → tell the owner', rule: { name: 'Long overdue invoices', trigger: 'invoice.overdue', status: '', conditions: [{ field: 'overdueDays', op: 'at_least', value: '14' }], actions: [{ type: 'notify_team', roles: ['owner'], message: '{customer} is 14+ days overdue' }], active: true } },
]

function RuleEditor({ initial, partners, onSaved, onCancel }: { initial: RuleInput & { id?: string }; partners: DestPartner[]; onSaved: () => void; onCancel: () => void }) {
  const [r, setR] = useState<RuleInput & { id?: string }>(initial)
  const [ref, setRef] = useState(''); const [test, setTest] = useState<Awaited<ReturnType<typeof autopilotApi.testRule>> | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const setA = (i: number, a: RuleAction) => setR({ ...r, actions: r.actions.map((x, k) => (k === i ? a : x)) })
  const { id, ...input } = r
  const save = async () => { setBusy(true); setErr(''); try { await autopilotApi.saveRule(input, id); onSaved() } catch (e) { setErr(msgOf(e, 'Could not save.')) } finally { setBusy(false) } }
  const runTest = async () => { setErr(''); try { setTest(await autopilotApi.testRule(input, ref)) } catch (e) { setErr(msgOf(e, 'Could not test.')) } }
  return (
    <div className="card-dark mt-4 grid gap-4 p-5" data-testid="rule-editor">
      <label className="grid gap-1 text-xs"><span className="text-text-muted">Rule name</span><input className={cls} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs"><span className="text-text-muted">When</span><select className={cls} value={r.trigger} onChange={(e) => setR({ ...r, trigger: e.target.value as Trigger, status: '' })}>{TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        {STAGES[r.trigger] && <label className="grid gap-1 text-xs"><span className="text-text-muted">Stage</span><select className={cls} value={r.status} onChange={(e) => setR({ ...r, status: e.target.value })}><option value="">Any stage</option>{STAGES[r.trigger].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      </div>
      <div><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Only if</p>
        {r.conditions.map((c, i) => (
          <div key={i} className="mt-2 grid grid-cols-[1fr_120px_1fr_32px] gap-2">
            <select className={cls} value={c.field} onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, k) => (k === i ? { ...x, field: e.target.value as Field } : x)) })}>{FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select className={cls} value={c.op} onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, k) => (k === i ? { ...x, op: e.target.value as Op } : x)) })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {c.field === 'destination' ? <select className={cls} value={c.value} onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })}><option value="">Choose…</option>{countries.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}</select>
              : <input className={cls} value={c.value} onChange={(e) => setR({ ...r, conditions: r.conditions.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} placeholder={c.field === 'cargo' ? 'barrels, boxes, vehicle…' : ''} />}
            <button onClick={() => setR({ ...r, conditions: r.conditions.filter((_, k) => k !== i) })} className="grid h-9 w-8 place-items-center text-text-muted hover:text-danger" aria-label="Remove condition"><X size={14} /></button>
          </div>))}
        <button onClick={() => setR({ ...r, conditions: [...r.conditions, { field: 'destination', op: 'is', value: '' }] })} className="mt-2 text-xs text-gold-deep hover:underline">+ Add a condition</button>
      </div>
      <div><p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Then</p>
        {r.actions.map((a, i) => (
          <div key={i} className="mt-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2"><select className={`${cls} !w-auto`} value={a.type} onChange={(e) => setA(i, blankAction(e.target.value as RuleAction['type']))}>{Object.entries(ACTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{r.actions.length > 1 && <button onClick={() => setR({ ...r, actions: r.actions.filter((_, k) => k !== i) })} className="text-text-muted hover:text-danger" aria-label="Remove action"><X size={14} /></button>}</div>
            <div className="mt-2 grid gap-2">
              {a.type === 'notify_team' && <><div className="flex flex-wrap gap-1.5">{['owner', 'dispatcher', 'finance', 'agent', 'driver'].map((ro) => <label key={ro} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs capitalize ${a.roles.includes(ro) ? 'border-gold bg-gold/15' : 'border-border text-text-muted'}`}><input type="checkbox" className="sr-only" checked={a.roles.includes(ro)} onChange={(e) => setA(i, { ...a, roles: e.target.checked ? [...a.roles, ro] : a.roles.filter((x) => x !== ro) })} />{ro}</label>)}</div><input className={cls} value={a.message} onChange={(e) => setA(i, { ...a, message: e.target.value })} /></>}
              {a.type === 'message_customer' && <textarea rows={2} className="input-dark py-2 text-sm" value={a.message} onChange={(e) => setA(i, { ...a, message: e.target.value })} />}
              {a.type === 'assign_partner' && <><select className={cls} value={a.partnerId} onChange={(e) => setA(i, { ...a, partnerId: e.target.value })}><option value="">Choose a partner…</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.country} · {p.cities.join(', ')}</option>)}</select><div className="flex flex-wrap gap-1.5">{Object.entries(serviceLabels).map(([k, l]) => <label key={k} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${a.services.includes(k) ? 'border-gold bg-gold/15' : 'border-border text-text-muted'}`}><input type="checkbox" className="sr-only" checked={a.services.includes(k)} onChange={(e) => setA(i, { ...a, services: e.target.checked ? [...a.services, k] : a.services.filter((x) => x !== k) })} />{l}</label>)}</div></>}
              {a.type === 'receiver_charge' && <div className="grid grid-cols-[90px_80px_1fr] gap-2"><input type="number" className={cls} value={a.amount || ''} onChange={(e) => setA(i, { ...a, amount: Number(e.target.value) })} placeholder="Amount" /><input className={`${cls} uppercase`} maxLength={3} value={a.currency} onChange={(e) => setA(i, { ...a, currency: e.target.value.toUpperCase() })} /><input className={cls} value={a.reason} onChange={(e) => setA(i, { ...a, reason: e.target.value })} /><label className="col-span-3 flex items-center gap-2 text-xs"><input type="checkbox" className="accent-gold" checked={a.send} onChange={(e) => setA(i, { ...a, send: e.target.checked })} /> Send it to the receiver straight away (otherwise it waits as a draft)</label></div>}
              {a.type === 'set_handover' && <Seg label="Handover" value={a.handover} onChange={(v) => setA(i, { ...a, handover: v })} options={[['delivery', 'Door delivery'], ['collection', 'Collection']]} />}
              {a.type === 'add_note' && <input className={cls} value={a.note} onChange={(e) => setA(i, { ...a, note: e.target.value })} />}
              {a.type === 'make_document' && <select className={cls} value={a.kind} onChange={(e) => setA(i, { ...a, kind: e.target.value as typeof a.kind })}><option value="packing_list">Packing list</option><option value="commercial_invoice">Commercial invoice</option><option value="bill_of_lading">House bill of lading</option><option value="export_instructions">Shipper’s letter of instruction</option></select>}
            </div>
          </div>))}
        {r.actions.length < 6 && <button onClick={() => setR({ ...r, actions: [...r.actions, blankAction('notify_team')] })} className="mt-2 text-xs text-gold-deep hover:underline">+ Add another action</button>}
        <p className="mt-2 text-[11px] text-text-muted">Messages can use {'{ref}'}, {'{customer}'}, {'{status}'}, {'{destination}'} and {'{receiverCity}'}.</p>
      </div>
      <div className="rounded-lg bg-surface-2/50 p-3"><p className="flex items-center gap-2 text-xs font-semibold"><FlaskConical size={13} aria-hidden="true" /> Try it on a shipment — nothing is changed</p>
        <div className="mt-2 flex gap-2"><input className={`${cls} font-mono uppercase`} placeholder="NT-…" value={ref} onChange={(e) => setRef(e.target.value)} /><button onClick={runTest} disabled={!ref.trim()} className="btn-ghost !min-h-9 text-xs" data-testid="rule-test">Test</button></div>
        {test && <div className="mt-2 text-xs" data-testid="rule-test-result"><p className={`font-semibold ${test.matches ? 'text-teal' : 'text-danger'}`}>{test.matches ? 'It would run:' : 'It wouldn’t run on this shipment.'}</p>{test.checks.map((c, k) => <p key={k} className={c.pass ? 'text-text-muted' : 'text-danger'}>{c.pass ? '✓' : '✕'} {FIELDS.find(([f]) => f === c.field)?.[1]} {OPS.find(([o]) => o === c.op)?.[1]} “{c.value}” — it’s “{c.actual ?? 'empty'}”</p>)}{test.would.map((w, k) => <p key={k}>→ {w}</p>)}</div>}
      </div>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2"><button onClick={onCancel} className="btn-ghost !min-h-10 text-sm">Cancel</button><button onClick={save} disabled={busy || !r.name.trim()} className="btn-gold !min-h-10 text-sm" data-testid="rule-save">{busy ? 'Saving…' : 'Save rule'}</button></div>
    </div>
  )
}
function Rules() {
  const [rules, setRules] = useState<Rule[] | null>(null); const [edit, setEdit] = useState<(RuleInput & { id?: string }) | null>(null)
  const [partners, setPartners] = useState<DestPartner[]>([])
  const load = () => autopilotApi.rules().then(setRules).catch(() => setRules([]))
  useEffect(() => { void load(); partnersApi.directory().then(setPartners).catch(() => {}) }, [])
  const toggle = async (r: Rule) => { const { id, runs: _r, lastRunAt: _l, createdAt: _c, ...input } = r; void _r; void _l; void _c; await autopilotApi.saveRule({ ...input, active: !r.active }, id); await load() }
  const trig = (t: Trigger) => TRIGGERS.find(([v]) => v === t)?.[1] ?? t
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-text-muted">Your own “when this happens, do that”. Each rule runs once per shipment (or container) and writes what it did to the activity log.</p>{!edit && <button onClick={() => setEdit({ name: '', trigger: 'shipment.booked', status: '', conditions: [], actions: [blankAction('notify_team')], active: true })} className="btn-gold !min-h-10 text-sm" data-testid="rule-new"><Plus size={15} aria-hidden="true" /> New rule</button>}</div>
      {!edit && <div className="mt-4 flex flex-wrap gap-2">{PRESETS.map((p) => <button key={p.name} onClick={() => setEdit(p.rule)} className="rounded-full border border-border px-3 py-1.5 text-xs text-text-muted hover:border-gold hover:text-text">{p.name}</button>)}</div>}
      {edit && <RuleEditor initial={edit} partners={partners} onSaved={() => { setEdit(null); void load() }} onCancel={() => setEdit(null)} />}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">{rules?.map((r) => (
        <li key={r.id} className="card-dark p-4" data-testid="rule-row">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{r.name}</p><p className="text-xs text-text-muted">{trig(r.trigger)}{r.status ? ` · ${r.status.replace(/_/g, ' ')}` : ''}{r.conditions.length ? ` · if ${r.conditions.map((c) => `${FIELDS.find(([f]) => f === c.field)?.[1].toLowerCase()} ${OPS.find(([o]) => o === c.op)?.[1]} ${c.value}`).join(' and ')}` : ''}</p><p className="mt-1 text-xs">→ {r.actions.map((a) => ACTION_LABEL[a.type]).join(', ')}</p><p className="mt-1 text-[11px] text-text-muted">Ran {r.runs} time{r.runs === 1 ? '' : 's'}{r.lastRunAt ? ` · last ${fmtDateTime(r.lastRunAt)}` : ''}</p></div>
            <div className="flex shrink-0 items-center gap-1"><Toggle on={r.active} onChange={() => toggle(r)} label={`Rule ${r.name}`} /><button onClick={() => setEdit({ ...r })} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2" aria-label="Edit"><Pencil size={14} /></button><button onClick={async () => { await autopilotApi.deleteRule(r.id); void load() }} className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-danger" aria-label="Delete"><Trash2 size={14} /></button></div></div>
        </li>))}</ul>
      {rules?.length === 0 && !edit && <p className="mt-4 text-sm text-text-muted">No rules yet — start from one of the examples above.</p>}
    </div>
  )
}

/* ---------------- WhatsApp assistant ---------------- */
function Assistant() {
  const [sp, setSp] = useSearchParams()
  const [d, setD] = useState<Awaited<ReturnType<typeof autopilotApi.conversations>> | null>(null)
  const [open, setOpen] = useState<{ conversation: Conversation; messages: ChatMessage[] } | null>(null)
  const [reply, setReply] = useState(''); const [handBack, setHandBack] = useState(false)
  const [sim, setSim] = useState({ phone: '+1 917 555 0142', text: 'Where is my package?' }); const [simOut, setSimOut] = useState<{ text: string; intent: string; handoff: boolean; via: string } | null>(null)
  const [err, setErr] = useState('')
  const cId = sp.get('c')
  const load = () => autopilotApi.conversations().then(setD).catch((e) => setErr(msgOf(e, '')))
  useEffect(() => { void load() }, [])
  useEffect(() => { if (cId) autopilotApi.conversation(cId).then(setOpen).catch(() => setOpen(null)); else setOpen(null) }, [cId])
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!open || !reply.trim()) return; try { const r = await autopilotApi.reply(open.conversation.id, reply, handBack); setReply(''); setOpen(await autopilotApi.conversation(open.conversation.id)); void load(); if (!r.sent) setErr('Saved, but WhatsApp isn’t connected on the server yet, so it wasn’t delivered.') } catch (er) { setErr(msgOf(er, 'Could not send.')) } }
  const trySim = async (e: React.FormEvent) => { e.preventDefault(); setSimOut(null); try { setSimOut(await autopilotApi.simulate(sim.phone, sim.text)) } catch (er) { setErr(msgOf(er, 'Could not run.')) } }
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        {d && <p className="mb-3 text-xs text-text-muted">Understanding messages: {d.ai ? 'AI (Claude) + rules' : 'keyword rules (add an AI key for free-form messages)'} · WhatsApp connected: {d.inbound.twilio || d.inbound.meta ? 'yes' : 'not yet — messages appear here once Ntemtem’s WhatsApp number is connected'}</p>}
        {err && <p role="alert" className="mb-3 text-xs text-danger">{err}</p>}
        <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <ul className="space-y-2">{d?.conversations.length === 0 && <li className="card-dark p-4 text-sm text-text-muted">No WhatsApp chats yet.</li>}{d?.conversations.map((c) => <li key={c.id}><button onClick={() => setSp({ tab: 'assistant', c: c.id })} className={`card-dark w-full p-3 text-left ${cId === c.id ? '!border-gold' : ''}`}><span className="flex items-center justify-between gap-2 text-sm"><b className="truncate">{c.name || c.phone}</b>{c.unread > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}</span><span className="block truncate text-xs text-text-muted">{c.handedOff ? 'With your team · ' : ''}{c.preview}</span></button></li>)}</ul>
          {open ? (
            <div className="card-dark flex min-h-[360px] flex-col p-4" data-testid="chat">
              <p className="text-sm font-semibold">{open.conversation.name || open.conversation.phone} <span className="font-normal text-text-muted">· {open.conversation.phone}</span></p>
              <ol className="mt-3 flex-1 space-y-2 overflow-y-auto">{open.messages.map((m) => <li key={m.id} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-surface-2' : 'ml-auto bg-teal/15'}`}>{m.body}<span className="mt-1 block text-[10px] text-text-muted">{m.direction === 'out' ? (m.via === 'person' ? m.by : m.via === 'ai' ? 'Helper (AI)' : 'Helper') : ''}{m.at ? ` · ${fmtDateTime(m.at)}` : ''}</span></li>)}</ol>
              <form onSubmit={send} className="mt-3 grid gap-2"><textarea rows={2} className="input-dark py-2 text-sm" placeholder="Reply as your team" value={reply} onChange={(e) => setReply(e.target.value)} /><div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-gold" checked={handBack} onChange={(e) => setHandBack(e.target.checked)} /> Let the helper answer again after this</label><button className="btn-gold !min-h-9 text-xs" disabled={!reply.trim()}><Send size={13} aria-hidden="true" /> Send</button></div></form>
            </div>
          ) : <div className="card-dark grid min-h-[200px] place-items-center p-6 text-sm text-text-muted">Pick a chat.</div>}
        </div>
      </div>
      <form onSubmit={trySim} className="card-dark h-fit p-5" data-testid="assistant-try">
        <h2 className="flex items-center gap-2 !text-base"><Smartphone size={16} className="text-gold-deep" aria-hidden="true" /> Try the helper</h2>
        <p className="mt-1 text-xs text-text-muted">Type a message as a customer would. Use a customer’s phone number to see their real shipments. Nothing is sent.</p>
        <input className={`${cls} mt-3`} value={sim.phone} onChange={(e) => setSim({ ...sim, phone: e.target.value })} aria-label="Phone" />
        <textarea rows={2} className="input-dark mt-2 py-2 text-sm" value={sim.text} onChange={(e) => setSim({ ...sim, text: e.target.value })} aria-label="Message" />
        <div className="mt-2 flex flex-wrap gap-1.5">{['Where is my package?', 'How much do I owe?', 'I want to send 3 barrels from Houston to Kumasi', 'Où est mon colis ?', 'agent'].map((x) => <button type="button" key={x} onClick={() => setSim({ ...sim, text: x })} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-text-muted hover:text-text">{x}</button>)}</div>
        <button className="btn-gold mt-3 !min-h-9 text-sm" data-testid="assistant-run"><MessageCircle size={14} aria-hidden="true" /> See the answer</button>
        {simOut && <div className="mt-3" data-testid="assistant-answer"><p className="whitespace-pre-wrap rounded-2xl bg-teal/15 px-3 py-2 text-sm">{simOut.text}</p><p className="mt-1 text-[11px] text-text-muted">Understood as: {simOut.intent}{simOut.handoff ? ' · goes to your team' : ''} · {simOut.via === 'ai' ? 'AI' : 'rules'}</p></div>}
      </form>
    </div>
  )
}

/** `/dashboard/autopilot` — the office chores that run themselves. */
export default function AutopilotPage() {
  const { ready, user } = useStore()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab | null) ?? 'switches'
  const [d, setD] = useState<Awaited<ReturnType<typeof autopilotApi.get>> | null>(null)
  const [saved, setSaved] = useState(false); const [err, setErr] = useState('')
  useEffect(() => { if (ready && user?.role === 'shipper') autopilotApi.get().then(setD).catch((e) => setErr(msgOf(e, 'Could not load.'))) }, [ready, user, tab])
  const save = async (p: Partial<AutopilotSettings>) => { if (!d) return; setD({ ...d, settings: { ...d.settings, ...p } }); try { await autopilotApi.save(p); setSaved(true); setTimeout(() => setSaved(false), 1500) } catch (e) { setErr(msgOf(e, 'Could not save.')) } }
  const total = useMemo(() => Object.values(d?.week ?? {}).reduce((a, b) => a + b, 0), [d])
  if (!ready) return <div className="container-x py-24 text-center text-text-muted">Loading…</div>
  if (!user) return <Navigate to="/login?role=shipper&next=/dashboard/autopilot" replace />
  if (user.role !== 'shipper' || !['owner', 'dispatcher'].includes(user.staffRole ?? 'owner')) return <Navigate to="/dashboard/shipper" replace />
  const tabs: [Tab, string, typeof Bot][] = [['switches', 'Automations', Bot], ['activity', 'What it did', Check], ['rules', 'My rules', Workflow], ['assistant', 'WhatsApp helper', MessageCircle]]
  return (
    <div className="bg-bg text-text"><div className="container-x py-10 md:py-14">
      <p className="eyebrow mb-1">Autopilot</p>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="!text-[clamp(1.75rem,3.5vw,2.5rem)]">The office chores that run themselves</h1><p className="mt-1 max-w-2xl text-text-muted">Switch each one on or off. Everything Autopilot does is written to “What it did”{total ? ` — ${total} things this week` : ''}.</p></div>{saved && <span role="status" className="inline-flex items-center gap-1 text-sm text-teal"><Check size={14} aria-hidden="true" /> Saved</span>}</div>
      <nav className="mt-6 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="Autopilot sections"><ul className="flex w-max gap-1 rounded-full border border-border bg-surface p-1">{tabs.map(([k, l, I]) => <li key={k}><button onClick={() => setSp(k === 'switches' ? {} : { tab: k })} aria-current={tab === k ? 'page' : undefined} className={`inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm ${tab === k ? 'bg-gold font-semibold text-[#14213D]' : 'text-text-muted hover:text-text'}`}><I size={14} aria-hidden="true" /> {l}</button></li>)}</ul></nav>
      {err && <p role="alert" className="mt-4 text-sm text-danger">{err}</p>}
      {tab === 'switches' && d && <Switches s={d.settings} week={d.week} texting={d.texting} save={save} />}
      {tab === 'activity' && d && <Activity log={d.log} />}
      {tab === 'rules' && <Rules />}
      {tab === 'assistant' && <Assistant />}
    </div></div>
  )
}
