import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Calculator, Loader2, ShieldCheck } from 'lucide-react'
import { DutyBreakdown, DutyForm } from '../components/Duty'
import { dutyApi, type DutyEstimate, type DutyInput, type DutyMeta } from '../lib/duty'
import { fadeUp, stagger } from '../lib/motion'

/** `/duty` — public landed-cost calculator. Ghana follows the GRA ICUMS structure; a link to the official calculator sits under every result. */
export default function Duty() {
  const [sp] = useSearchParams()
  const [meta, setMeta] = useState<DutyMeta | null>(null)
  const [input, setInput] = useState<DutyInput>({ destination: sp.get('destination') || 'GH', goods: (sp.get('goods') as DutyInput['goods']) || 'personal_effects', valueUsd: Number(sp.get('value')) || 0, freightUsd: sp.get('freight') ? Number(sp.get('freight')) : undefined })
  const [est, setEst] = useState<DutyEstimate | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { dutyApi.meta().then(setMeta).catch(() => {}) }, [])
  useEffect(() => {
    if (!input.valueUsd) { setEst(null); return }
    let live = true; setLoading(true)
    const t = setTimeout(() => dutyApi.estimate(input).then((e) => live && setEst(e)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not estimate.')).finally(() => live && setLoading(false)), 250)
    return () => { live = false; clearTimeout(t) }
  }, [input])
  return (
    <div className="bg-bg text-text">
      <div className="container-x py-10 md:py-16">
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto max-w-2xl text-center">
          <motion.p variants={fadeUp} className="eyebrow mb-2">Duty estimator</motion.p>
          <motion.h1 variants={fadeUp} className="!text-[clamp(2rem,4vw,3rem)]">What will I pay at Tema?</motion.h1>
          <motion.p variants={fadeUp} className="mt-2 text-text-muted">An honest estimate of customs duty, VAT and levies on arrival — the biggest unknown when you ship home. Ghana follows the GRA ICUMS assessment structure; Nigeria is a rougher guide.</motion.p>
        </motion.div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-8 grid max-w-4xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <motion.div variants={fadeUp} className="card-dark p-5">
            <h2 className="flex items-center gap-2 !text-base"><Calculator size={16} className="text-gold-deep" aria-hidden="true" /> Your shipment</h2>
            <div className="mt-3"><DutyForm value={input} onChange={setInput} meta={meta} /></div>
            <p className="mt-3 text-xs text-text-muted">Value = what the goods are worth (for used items, a fair second-hand value). Customs assess on CIF: value + freight + insurance.</p>
          </motion.div>
          <motion.div variants={fadeUp} className="card-dark p-5" aria-live="polite">
            {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
            {!input.valueUsd ? <div className="py-10 text-center text-sm text-text-muted">Enter a value to see the breakdown.</div> : loading && !est ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Calculating…</div> : est ? <DutyBreakdown e={est} /> : null}
          </motion.div>
        </motion.div>
        <motion.div initial="hidden" animate="show" variants={stagger} className="mx-auto mt-8 max-w-4xl">
          <motion.div variants={fadeUp} className="rounded-xl border border-border bg-surface p-5 text-sm">
            <h2 className="flex items-center gap-2 !text-base"><ShieldCheck size={16} className="text-gold-deep" aria-hidden="true" /> How this relates to the official GRA calculator</h2>
            <p className="mt-2 text-text-muted">The Ghana Revenue Authority publishes two ICUMS calculators — one for <a href="https://external.unipassghana.com/cl/tm/tax/selectGeneralTaxCalculate.do?decorator=popup&MENU_ID=IIM01S03V01" target="_blank" rel="noopener" className="text-gold-deep hover:underline">general goods</a> and one for <a href="https://external.unipassghana.com/cl/tm/tax/selectUsedVehicleTaxCalculate.do?decorator=popup&MENU_ID=IIM01S03V02" target="_blank" rel="noopener" className="text-gold-deep hover:underline">used vehicles</a>. They need an HS code, a CPC and the CIF in cedis, and for vehicles they use GRA’s own valuation rather than your invoice. This page applies the same assessment structure to plain-English inputs so you can plan; use the official calculator, or your shipper’s clearing agent, for the exact figure. Once your shipment is cleared, your shipper records the official assessment on the shipment and you’ll see it replace the estimate.</p>
            <p className="mt-2 text-text-muted">Ready to ship? <Link to={`/quote?destination=${input.destination}`} className="text-gold-deep hover:underline">Get quotes from verified shippers</Link>.</p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
