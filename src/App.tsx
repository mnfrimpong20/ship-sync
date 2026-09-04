import { useEffect } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import Nav from './components/Nav'
import Footer from './components/Footer'
import Home from './pages/Home'
import Quote from './pages/Quote'
import { ShipperDirectory, ShipperProfile } from './pages/Shippers'
import Track from './pages/Track'
import Live from './pages/Live'
import Admin from './pages/Admin'
import { Login, Signup } from './pages/Auth'
import { CustomerDashboard, ShipperDashboard } from './pages/Dashboard'
import { StoreProvider } from './lib/store'
import { page } from './lib/motion'

function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) { const el = document.querySelector(hash); if (el) { el.scrollIntoView({ behavior: 'smooth' }); return } }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

function Shell() {
  const loc = useLocation()
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:text-ink">Skip to content</a>
      <Nav />
      <main id="main" className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={loc.pathname} variants={page} initial="initial" animate="animate" exit="exit">
            <Routes location={loc}>
              <Route path="/" element={<Home />} />
              <Route path="/quote" element={<Quote />} />
              <Route path="/shippers" element={<ShipperDirectory />} />
              <Route path="/shippers/:id" element={<ShipperProfile />} />
              <Route path="/track" element={<Track />} />
              <Route path="/live" element={<Live />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/dashboard" element={<CustomerDashboard />} />
              <Route path="/dashboard/shipper" element={<ShipperDashboard />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <StoreProvider>
        <HashRouter>
          <ScrollManager />
          <Shell />
        </HashRouter>
      </StoreProvider>
    </MotionConfig>
  )
}
