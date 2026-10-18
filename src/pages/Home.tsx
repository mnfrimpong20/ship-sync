import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Hero from '../components/Hero'
import { Destinations, FamilyUpdates, FAQ, FeaturedShippers, Features, FinalCTA, ForShippers, HowItWorks, Pricing, Testimonials } from '../components/HomeSections'

export default function Home() {
  const [sp] = useSearchParams(); const s = sp.get('s')
  // /?s=how jumps to a section (hash links can't be used with the hash router).
  useEffect(() => { if (!s) return; const t = setTimeout(() => document.getElementById(s)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); return () => clearTimeout(t) }, [s])
  return (
    <>
      <Hero />
      <div className="ss-weave" role="presentation" />
      <Destinations />
      <HowItWorks />
      <FamilyUpdates />
      <Features />
      <ForShippers />
      <FeaturedShippers />
      <Testimonials />
      <Pricing />
      <FAQ />
      <FinalCTA />
    </>
  )
}
