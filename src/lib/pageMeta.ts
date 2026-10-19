/** Per-route page title and description — shared by the browser (document.title) and the server (the HTML search
 *  engines and link previews read before any script runs). Keep it free of DOM code so the server can import it. */
import { HELP } from './help'

export const HOME_TITLE = 'Ntemtem — Send it. Shipping home to Ghana & West Africa'
export const DEFAULT_DESC = 'Ntemtem — Twi for quickly-quickly — connects you with verified air and ocean shippers carrying boxes, barrels, cars and cargo home to Ghana, Nigeria and across West Africa.'
const TITLES: [RegExp, string, string?][] = [
  [/^\/$/, '', 'Compare verified shippers to Ghana, Nigeria and across West Africa. Clear prices, protected payments, tracked all the way home.'],
  [/^\/for-shippers/, 'For shipping companies', 'Run your shipping business on Ntemtem: matched leads, rate cards, containers, warehouse scanning, protected payments and equipment.'],
  [/^\/pricing/, 'Pricing', 'Free for senders. Simple monthly plans for shipping companies, with a 30-day free Pro trial.'],
  [/^\/quote/, 'Get freight quotes', 'Post your shipment once and let verified shippers compete with itemised quotes.'],
  [/^\/shippers\/[^/]+/, 'Shipper profile'], [/^\/shippers/, 'Find a shipper', 'Browse verified air and ocean shippers to Ghana, Nigeria, Liberia, Togo and across West Africa — ratings, lanes and prices.'],
  [/^\/track/, 'Track a shipment', 'Follow your barrels, boxes, car or container from pickup to the door with your Ntemtem reference.'], [/^\/duty/, 'Duty & landed-cost estimator', 'Estimate import duty and taxes before you ship to West Africa.'],
  [/^\/groupage/, 'Fill a barrel — shared barrels & containers'], [/^\/brokers/, 'Customs brokers'], [/^\/sailings/, 'Sailing schedule'], [/^\/lanes/, 'Lane prices'], [/^\/live/, 'Live map'],
  [/^\/sourcing\/new/, 'Start a sourcing request'], [/^\/sourcing\/[^/]+/, 'Sourcing request'], [/^\/sourcing/, 'Source from China, the UK and the USA', 'Our own team finds the factory, wholesaler or store, buys in Ntemtem’s name, inspects and ships it to you.'],
  [/^\/about/, 'About Ntemtem'], [/^\/contact/, 'Contact us'], [/^\/help\/[^/]+/, 'Help centre'], [/^\/help/, 'Help centre', 'Answers for senders, receivers and shipping companies: quotes, paying, export filing, weights, mobile money and collecting your goods.'], [/^\/support/, 'Support'], [/^\/privacy/, 'Privacy policy'], [/^\/terms/, 'Terms of service'], [/^\/shipper-agreement/, 'Shipper agreement'],
  [/^\/s\//, 'Supplier portal · 供应商门户'], [/^\/order\//, 'Place your order'], [/^\/login/, 'Sign in'], [/^\/forgot/, 'Reset your password'], [/^\/reset/, 'Choose a new password'], [/^\/signup/, 'Create an account'], [/^\/dashboard\/shipper/, 'Shipper workspace'], [/^\/dashboard\/sourcing/, 'Sourcing board'], [/^\/dashboard\/verification/, 'Verification'], [/^\/dashboard\/(\w+)/, 'Workspace'], [/^\/dashboard/, 'My dashboard'], [/^\/admin/, 'Admin'],
]
export function pageMeta(pathname: string): { title: string; description: string } {
  const art = /^\/help\/([^/?#]+)/.exec(pathname); const a = art ? HELP.find((x) => x.slug === art[1]) : undefined
  if (a) return { title: `${a.title} · Ntemtem help`, description: a.summary }
  const hit = TITLES.find(([re]) => re.test(pathname))
  return { title: hit && hit[1] ? `${hit[1]} · Ntemtem` : HOME_TITLE, description: hit?.[2] ?? DEFAULT_DESC }
}
/** Pages search engines should skip: private, one-off links and sign-in forms. */
export const NOINDEX = /^\/(dashboard|admin|pay|doc|r|p|s|broker|reset|join|embed|add-recipient|login|signup|forgot|order|scan|support)(\/|$|\?)/
/** Public pages listed in the sitemap. */
export const SITEMAP_PATHS = ['/', '/for-shippers', '/pricing', '/shippers', '/quote', '/track', '/duty', '/groupage', '/sourcing', '/brokers', '/sailings', '/lanes', '/about', '/contact', '/help', ...HELP.map((a) => `/help/${a.slug}`), '/privacy', '/terms', '/shipper-agreement']
