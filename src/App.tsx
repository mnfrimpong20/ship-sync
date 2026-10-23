import { BrandLoader } from './components/BrandLoader'
import { WhatsAppBubble } from './components/HelpBits'
import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import Nav from './components/Nav'
import Footer from './components/Footer'
import AppShell from './components/AppShell'
import Home from './pages/Home'
import Quote from './pages/Quote'
import Directory from './pages/Directory'
import Track from './pages/Track'
import { AboutPage, ContactPage, LegalPage, NotFound } from './pages/Company'
import { ForgotPassword, Login, ResetPassword, SignInLink, Signup } from './pages/Auth'
import { applyPageMeta } from './lib/site'

/* Everything below loads on demand: the marketing core above is the only code a first-time visitor downloads.
   Named exports are wrapped so React.lazy gets a default. */
const L = <T extends Record<string, unknown>, K extends keyof T>(load: () => Promise<T>, key: K) => lazy(() => load().then((m) => ({ default: m[key] as React.ComponentType<any> })))
const ShipperProfile = L(() => import('./pages/Shippers'), 'ShipperProfile')
const Live = lazy(() => import('./pages/Live'))
const Admin = lazy(() => import('./pages/Admin'))
const Clients = lazy(() => import('./pages/Clients'))
const ClientDetailPage = lazy(() => import('./pages/ClientDetail'))
const InvoiceView = lazy(() => import('./pages/InvoiceView'))
const Team = lazy(() => import('./pages/Team'))
const Fleet = lazy(() => import('./pages/Fleet'))
const Drivers = lazy(() => import('./pages/Drivers'))
const TeamHr = lazy(() => import('./pages/TeamHr'))
const RunsList = lazy(() => import('./pages/Routes'))
const RoutePlanner = lazy(() => import('./pages/RoutePlanner'))
const MyRuns = lazy(() => import('./pages/MyRuns'))
const BrokerJoin = lazy(() => import('./pages/BrokerJoin'))
const BrokerApp = lazy(() => import('./pages/broker/BrokerApp'))
const OfficeBrokerInvoice = lazy(() => import('./pages/broker/BrokerMoney').then((m) => ({ default: m.OfficeInvoicePage })))
const DriverHr = lazy(() => import('./pages/DriverHr'))
const PayslipPage = lazy(() => import('./pages/DriverHr').then((m) => ({ default: m.PayslipPage })))
const VerifyDriverPage = lazy(() => import('./pages/DriverHr').then((m) => ({ default: m.VerifyDriverPage })))
const Shipments = lazy(() => import('./pages/Shipments'))
const Leads = lazy(() => import('./pages/Leads'))
const Labels = lazy(() => import('./pages/Labels'))
const Scan = lazy(() => import('./pages/Scan'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Rates = lazy(() => import('./pages/Rates'))
const DocumentView = lazy(() => import('./pages/DocumentView'))
const Pickups = lazy(() => import('./pages/Pickups'))
const Receive = lazy(() => import('./pages/Receive'))
const Duty = lazy(() => import('./pages/Duty'))
const Payments = lazy(() => import('./pages/Payments'))
const GroupagePage = lazy(() => import('./pages/Groupage'))
const GroupageManage = lazy(() => import('./pages/GroupageManage'))
const Pay = lazy(() => import('./pages/Pay'))
const Collections = lazy(() => import('./pages/Collections'))
const BrokersPage = lazy(() => import('./pages/Brokers'))
const BrokerPortal = L(() => import('./pages/Brokers'), 'BrokerPortal')
const BrokerProfile = L(() => import('./pages/Brokers'), 'BrokerProfile')
const PricingPage = lazy(() => import('./pages/Pricing'))
const ForShippersPage = lazy(() => import('./pages/ForShippers'))
const Sailings = lazy(() => import('./pages/Sailings'))
const PublicSailings = L(() => import('./pages/Sailings'), 'PublicSailings')
const Warehouse = lazy(() => import('./pages/Warehouse'))
const LanesPage = lazy(() => import('./pages/Lanes'))
const ShipperLanes = L(() => import('./pages/Lanes'), 'ShipperLanes')
const AnalyticsPage = lazy(() => import('./pages/Analytics'))
const CostsPage = lazy(() => import('./pages/Costs'))
const CampaignsPage = lazy(() => import('./pages/Campaigns'))
const IntegrationsPage = lazy(() => import('./pages/Integrations'))
const BillingPage = lazy(() => import('./pages/Billing'))
const SuppliesPage = lazy(() => import('./pages/Supplies'))
const AutopilotPage = lazy(() => import('./pages/Autopilot'))
const HelpPage = L(() => import('./pages/Help'), 'HelpPage')
const SupportPage = L(() => import('./pages/Help'), 'SupportPage')
const ActivityPage = lazy(() => import('./pages/Activity'))
const EmbedTrack = lazy(() => import('./pages/EmbedTrack'))
const ReviewsPage = lazy(() => import('./pages/Reviews'))
const BrandedPage = lazy(() => import('./pages/WhiteLabel'))
const SupplierPortalPage = lazy(() => import('./pages/SupplierPortal'))
const Verification = lazy(() => import('./pages/Verification'))
const OrderPage = lazy(() => import('./pages/Order'))
const BrandEditor = L(() => import('./pages/WhiteLabel'), 'BrandEditor')
const SourcingPage = lazy(() => import('./pages/Sourcing'))
const SourcingNew = L(() => import('./pages/Sourcing'), 'SourcingNew')
const SourcingJob = L(() => import('./pages/Sourcing'), 'SourcingJob')
const SourcingBoard = L(() => import('./pages/Sourcing'), 'SourcingBoard')
const SuppliersPage = L(() => import('./pages/Sourcing'), 'SuppliersPage')
const QcReportPage = L(() => import('./pages/Sourcing'), 'QcReportPage')
const AgentToday = L(() => import('./pages/Sourcing'), 'AgentToday')
const Containers = lazy(() => import('./pages/Containers'))
const ContainerDetail = lazy(() => import('./pages/ContainerDetail'))
const ManifestPage = lazy(() => import('./pages/Manifest'))
const PartnerPortal = lazy(() => import('./pages/PartnerPortal'))
const AddRecipient = lazy(() => import('./pages/AddRecipient'))
const Join = lazy(() => import('./pages/Join'))
const CustomerDashboard = L(() => import('./pages/Dashboard'), 'CustomerDashboard')
const ShipperDashboard = L(() => import('./pages/Dashboard'), 'ShipperDashboard')
import { StoreProvider } from './lib/store'
import { page } from './lib/motion'

function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    applyPageMeta(pathname)
    if (hash) { const el = document.querySelector(hash); if (el) { el.scrollIntoView({ behavior: 'smooth' }); return } }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

/** Shown for the few hundred ms while a lazily loaded page's code arrives. */
function PageLoading() {
  return <div className="bg-bg text-text" aria-busy="true"><BrandLoader /></div>
}

/** Public marketing site: big header, footer, page transitions. */
function MarketingLayout() {
  const loc = useLocation()
  const outlet = useOutlet() // captured per location so the exiting page keeps rendering itself, not the next route
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView() }} className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:text-on-accent">Skip to content</a>
      <Nav />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <AnimatePresence mode="wait">
          <motion.div key={loc.pathname} variants={page} initial="initial" animate="animate" exit="exit">
            <Suspense fallback={<PageLoading />}>{outlet}</Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
      <MobileCta />
      <WhatsAppBubble />
    </div>
  )
}

/** Phone-only sticky bar on long marketing pages so the primary action is never more than a thumb away. */
function MobileCta() {
  const loc = useLocation(); const [show, setShow] = useState(false)
  useEffect(() => { const on = () => setShow(window.scrollY > 640); on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on) }, [])
  if (['/quote', '/login', '/signup', '/join', '/sourcing/new', '/contact'].some((p) => loc.pathname.startsWith(p)) || loc.pathname.startsWith('/pay') || loc.pathname.startsWith('/doc')) return null
  return (
    <AnimatePresence>{show && (
      <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ duration: 0.2 }} className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 p-3 backdrop-blur-xl md:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }} data-testid="mobile-cta">
        {loc.pathname.startsWith('/for-shippers')
          ? <div className="flex gap-2"><Link to="/pricing?for=shippers" className="btn-ghost flex-1 !min-h-11 text-sm">Plans</Link><Link to="/signup?role=shipper" className="btn-gold flex-[2] !min-h-11 text-sm">List your company</Link></div>
          : <div className="flex gap-2"><Link to="/track" className="btn-ghost flex-1 !min-h-11 text-sm">Track</Link><Link to="/quote" className="btn-gold flex-[2] !min-h-11 text-sm">Get a quote</Link></div>}
      </motion.div>)}</AnimatePresence>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <StoreProvider>
        <BrowserRouter>
          <ScrollManager />
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route element={<MarketingLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/quote" element={<Quote />} />
              <Route path="/shippers" element={<Directory />} />
              <Route path="/shippers/:id" element={<ShipperProfile />} />
              <Route path="/track" element={<Track />} />
              <Route path="/verify/driver/:token" element={<VerifyDriverPage />} />
              <Route path="/duty" element={<Duty />} />
              <Route path="/groupage" element={<GroupagePage />} />
              <Route path="/brokers" element={<BrokersPage />} />
              <Route path="/brokers/join" element={<BrokerJoin />} />
              <Route path="/brokers/login" element={<Navigate to="/broker-portal/login" replace />} />
              <Route path="/brokers/:id" element={<BrokerProfile />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/for-shippers" element={<ForShippersPage />} />
              <Route path="/how" element={<Navigate to="/?s=how" replace />} />
              <Route path="/faq" element={<Navigate to="/?s=faq" replace />} />
              <Route path="/sailings" element={<PublicSailings />} />
              <Route path="/lanes" element={<LanesPage />} />
              <Route path="/sourcing" element={<SourcingPage />} />
              <Route path="/sourcing/new" element={<SourcingNew />} />
              <Route path="/live" element={<Live />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot" element={<ForgotPassword />} />
              <Route path="/reset" element={<ResetPassword />} />
              <Route path="/signin" element={<SignInLink />} />
              <Route path="/join" element={<Join />} />
              <Route path="/doc/:token" element={<DocumentView shared />} />
              <Route path="/pay/:token" element={<Pay />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/contact" element={<ContactPage />} />
              <Route path="/help" element={<HelpPage />} />
              <Route path="/help/:slug" element={<HelpPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/privacy" element={<LegalPage kind="privacy" />} />
              <Route path="/terms" element={<LegalPage kind="terms" />} />
              <Route path="/shipper-agreement" element={<LegalPage kind="shipper-agreement" />} />
              <Route path="*" element={<NotFound />} />
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
              <Route path="/dashboard/analytics" element={<AnalyticsPage />} />
              <Route path="/dashboard/costs" element={<CostsPage />} />
              <Route path="/dashboard/campaigns" element={<CampaignsPage />} />
              <Route path="/dashboard/integrations" element={<IntegrationsPage />} />
              <Route path="/dashboard/billing" element={<BillingPage />} />
              <Route path="/dashboard/supplies" element={<SuppliesPage />} />
              <Route path="/dashboard/autopilot" element={<AutopilotPage />} />
              <Route path="/dashboard/activity" element={<ActivityPage />} />
              <Route path="/dashboard/reviews" element={<ReviewsPage />} />
              <Route path="/dashboard/brand" element={<BrandEditor />} />
              <Route path="/dashboard/sourcing" element={<SourcingBoard />} />
              <Route path="/dashboard/sourcing/today" element={<AgentToday />} />
              <Route path="/dashboard/sourcing/:id" element={<SourcingJob />} />
              <Route path="/dashboard/suppliers" element={<SuppliersPage />} />
              <Route path="/sourcing/:id" element={<SourcingJob />} />
              <Route path="/sourcing/:id/qc" element={<QcReportPage />} />
              <Route path="/dashboard/sourcing/:id/qc" element={<QcReportPage />} />
              <Route path="/dashboard/containers" element={<Containers />} />
              <Route path="/dashboard/containers/:id" element={<ContainerDetail />} />
              <Route path="/dashboard/containers/:id/manifest" element={<ManifestPage />} />
              <Route path="/dashboard/clients" element={<Clients />} />
              <Route path="/dashboard/clients/:id" element={<ClientDetailPage />} />
              <Route path="/dashboard/invoices/:id" element={<InvoiceView />} />
              <Route path="/dashboard/documents/:id" element={<DocumentView />} />
              <Route path="/dashboard/team" element={<Team />} />
              <Route path="/dashboard/verification" element={<Verification />} />
              <Route path="/dashboard/fleet" element={<Fleet />} />
              <Route path="/dashboard/drivers" element={<Drivers />} />
              <Route path="/dashboard/routes" element={<RunsList />} />
              <Route path="/dashboard/routes/:id" element={<RoutePlanner />} />
              <Route path="/dashboard/runs" element={<MyRuns />} />
              <Route path="/dashboard/runs/pay" element={<DriverHr section="pay" />} />
              <Route path="/dashboard/runs/time" element={<DriverHr section="time" />} />
              <Route path="/dashboard/runs/me" element={<DriverHr section="me" />} />
              <Route path="/dashboard/hr" element={<TeamHr />} />
              <Route path="/dashboard/me/pay" element={<DriverHr section="pay" office />} />
              <Route path="/dashboard/me/time" element={<DriverHr section="time" office />} />
              <Route path="/dashboard/me/file" element={<DriverHr section="me" office />} />
              <Route path="/dashboard/me" element={<Navigate to="/dashboard/me/pay" replace />} />
              <Route path="/dashboard/payslip/:id" element={<PayslipPage />} />
              <Route path="/dashboard/scan" element={<Scan />} />
              <Route path="/dashboard/notifications" element={<Notifications />} />
              <Route path="/dashboard/broker-invoices/:id" element={<OfficeBrokerInvoice />} />
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="/dashboard/labels" element={<Labels />} />
            <Route path="/r/:token" element={<Receive />} />
            <Route path="/broker/:token" element={<BrokerPortal />} />
            <Route path="/broker-portal/*" element={<BrokerApp />} />
            <Route path="/broker-login" element={<Navigate to="/broker-portal/login" replace />} />
            <Route path="/s/:token" element={<SupplierPortalPage />} />
            <Route path="/p/:token" element={<PartnerPortal />} />
            <Route path="/add-recipient/:token" element={<AddRecipient />} />
            <Route path="/order/:code" element={<OrderPage />} />
            <Route path="/t/:slug" element={<BrandedPage />} />
            <Route path="/embed/track/:id" element={<EmbedTrack />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </StoreProvider>
    </MotionConfig>
  )
}
