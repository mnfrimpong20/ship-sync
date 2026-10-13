import { useEffect } from 'react'
import { HashRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import Nav from './components/Nav'
import Footer from './components/Footer'
import AppShell from './components/AppShell'
import Home from './pages/Home'
import Quote from './pages/Quote'
import { ShipperProfile } from './pages/Shippers'
import Directory from './pages/Directory'
import Track from './pages/Track'
import Live from './pages/Live'
import Admin from './pages/Admin'
import Clients from './pages/Clients'
import ClientDetailPage from './pages/ClientDetail'
import InvoiceView from './pages/InvoiceView'
import Team from './pages/Team'
import Fleet from './pages/Fleet'
import RunsList from './pages/Routes'
import RoutePlanner from './pages/RoutePlanner'
import MyRuns from './pages/MyRuns'
import Shipments from './pages/Shipments'
import Leads from './pages/Leads'
import Labels from './pages/Labels'
import Scan from './pages/Scan'
import Notifications from './pages/Notifications'
import Rates from './pages/Rates'
import DocumentView from './pages/DocumentView'
import Pickups from './pages/Pickups'
import Receive from './pages/Receive'
import Duty from './pages/Duty'
import Payments from './pages/Payments'
import GroupagePage from './pages/Groupage'
import GroupageManage from './pages/GroupageManage'
import Pay from './pages/Pay'
import Collections from './pages/Collections'
import BrokersPage, { BrokerPortal } from './pages/Brokers'
import Sailings, { PublicSailings } from './pages/Sailings'
import Warehouse from './pages/Warehouse'
import LanesPage, { ShipperLanes } from './pages/Lanes'
import ReviewsPage from './pages/Reviews'
import BrandedPage, { BrandEditor } from './pages/WhiteLabel'
import SourcingPage, { SourcingNew, SourcingJob, SourcingBoard, SuppliersPage, QcReportPage } from './pages/Sourcing'
import Containers from './pages/Containers'
import ContainerDetail from './pages/ContainerDetail'
import Join from './pages/Join'
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

/** Public marketing site: big header, footer, page transitions. */
function MarketingLayout() {
  const loc = useLocation()
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:text-on-accent">Skip to content</a>
      <Nav />
      <main id="main" className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={loc.pathname} variants={page} initial="initial" animate="animate" exit="exit">
            <Outlet />
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
          <Routes>
            <Route element={<MarketingLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/quote" element={<Quote />} />
              <Route path="/shippers" element={<Directory />} />
              <Route path="/shippers/:id" element={<ShipperProfile />} />
              <Route path="/track" element={<Track />} />
              <Route path="/duty" element={<Duty />} />
              <Route path="/groupage" element={<GroupagePage />} />
              <Route path="/brokers" element={<BrokersPage />} />
              <Route path="/sailings" element={<PublicSailings />} />
              <Route path="/lanes" element={<LanesPage />} />
              <Route path="/sourcing" element={<SourcingPage />} />
              <Route path="/sourcing/new" element={<SourcingNew />} />
              <Route path="/live" element={<Live />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/join" element={<Join />} />
              <Route path="/doc/:token" element={<DocumentView shared />} />
              <Route path="/pay/:token" element={<Pay />} />
              <Route path="*" element={<Home />} />
            </Route>
            {/* The signed-in application lives in its own shell, apart from the marketing site. */}
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<CustomerDashboard />} />
              <Route path="/dashboard/shipper" element={<ShipperDashboard />} />
              <Route path="/dashboard/shipments" element={<Shipments />} />
              <Route path="/dashboard/leads" element={<Leads />} />
              <Route path="/dashboard/rates" element={<Rates />} />
              <Route path="/dashboard/pickups" element={<Pickups />} />
              <Route path="/dashboard/payments" element={<Payments />} />
              <Route path="/dashboard/groupage" element={<GroupageManage />} />
              <Route path="/dashboard/collections" element={<Collections />} />
              <Route path="/dashboard/sailings" element={<Sailings />} />
              <Route path="/dashboard/warehouse" element={<Warehouse />} />
              <Route path="/dashboard/lanes" element={<ShipperLanes />} />
              <Route path="/dashboard/reviews" element={<ReviewsPage />} />
              <Route path="/dashboard/brand" element={<BrandEditor />} />
              <Route path="/dashboard/sourcing" element={<SourcingBoard />} />
              <Route path="/dashboard/sourcing/:id" element={<SourcingJob />} />
              <Route path="/dashboard/suppliers" element={<SuppliersPage />} />
              <Route path="/sourcing/:id" element={<SourcingJob />} />
              <Route path="/sourcing/:id/qc" element={<QcReportPage />} />
              <Route path="/dashboard/sourcing/:id/qc" element={<QcReportPage />} />
              <Route path="/dashboard/containers" element={<Containers />} />
              <Route path="/dashboard/containers/:id" element={<ContainerDetail />} />
              <Route path="/dashboard/clients" element={<Clients />} />
              <Route path="/dashboard/clients/:id" element={<ClientDetailPage />} />
              <Route path="/dashboard/invoices/:id" element={<InvoiceView />} />
              <Route path="/dashboard/documents/:id" element={<DocumentView />} />
              <Route path="/dashboard/team" element={<Team />} />
              <Route path="/dashboard/fleet" element={<Fleet />} />
              <Route path="/dashboard/routes" element={<RunsList />} />
              <Route path="/dashboard/routes/:id" element={<RoutePlanner />} />
              <Route path="/dashboard/runs" element={<MyRuns />} />
              <Route path="/dashboard/scan" element={<Scan />} />
              <Route path="/dashboard/notifications" element={<Notifications />} />
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="/dashboard/labels" element={<Labels />} />
            <Route path="/r/:token" element={<Receive />} />
            <Route path="/broker/:token" element={<BrokerPortal />} />
            <Route path="/t/:slug" element={<BrandedPage />} />
          </Routes>
        </HashRouter>
      </StoreProvider>
    </MotionConfig>
  )
}
