import Hero from '../components/Hero'
import { Destinations, FAQ, FeaturedShippers, Features, FinalCTA, ForShippers, HowItWorks, Pricing, Testimonials } from '../components/HomeSections'

export default function Home() {
  return (
    <>
      <Hero />
      <Destinations />
      <HowItWorks />
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
