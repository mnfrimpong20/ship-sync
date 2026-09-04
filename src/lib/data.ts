export type Mode = 'air' | 'ocean'

export interface Country {
  code: string
  name: string
  flag: string
  ports: string[]
  airports: string[]
  oceanDays: string
  airDays: string
  note: string
}

export const countries: Country[] = [
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', ports: ['Tema', 'Takoradi'], airports: ['Accra (ACC)'], oceanDays: '28–35', airDays: '3–5', note: 'Largest lane on Ship Sync. Barrels, vehicles and 20/40ft containers weekly from US, UK and Canada.' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', ports: ['Lagos (Apapa / Tin Can)', 'Onne'], airports: ['Lagos (LOS)', 'Abuja (ABV)'], oceanDays: '30–40', airDays: '3–6', note: 'High vehicle and commercial cargo volume. Customs pre-clearance guidance included by most shippers.' },
  { code: 'LR', name: 'Liberia', flag: '🇱🇷', ports: ['Monrovia (Freeport)'], airports: ['Monrovia (ROB)'], oceanDays: '32–42', airDays: '4–7', note: 'Consolidated ocean sailings every two weeks; strong Minnesota, Pennsylvania and Rhode Island diaspora lanes.' },
  { code: 'TG', name: 'Togo', flag: '🇹🇬', ports: ['Lomé'], airports: ['Lomé (LFW)'], oceanDays: '30–38', airDays: '4–6', note: 'Lomé is a deep-water hub — many shippers route Benin and Burkina Faso cargo through it.' },
  { code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', ports: ['Abidjan', 'San-Pédro'], airports: ['Abidjan (ABJ)'], oceanDays: '28–36', airDays: '3–5', note: 'Fast lane from France and the US East Coast. Strong RoRo vehicle service.' },
  { code: 'SL', name: 'Sierra Leone', flag: '🇸🇱', ports: ['Freetown (Queen Elizabeth II Quay)'], airports: ['Freetown (FNA)'], oceanDays: '32–42', airDays: '4–7', note: 'Groupage barrels and boxes from the UK and US; door delivery available in Freetown.' },
  { code: 'SN', name: 'Senegal', flag: '🇸🇳', ports: ['Dakar'], airports: ['Dakar (DSS)'], oceanDays: '24–32', airDays: '2–5', note: 'Shortest transatlantic ocean lane in the region. Good for perishables by air.' },
]

export const origins = [
  'New York, NY', 'Newark, NJ', 'Houston, TX', 'Atlanta, GA', 'Chicago, IL', 'Minneapolis, MN', 'Philadelphia, PA', 'Providence, RI', 'Los Angeles, CA', 'Baltimore, MD',
  'London, UK', 'Manchester, UK', 'Toronto, CA', 'Hamburg, DE', 'Rotterdam, NL', 'Paris, FR', 'Dubai, AE', 'Guangzhou, CN', 'Shanghai, CN',
]

export type CargoType = 'barrels' | 'boxes' | 'pallets' | 'vehicle' | 'container20' | 'container40' | 'commercial'

export const cargoTypes: { id: CargoType; label: string; hint: string }[] = [
  { id: 'barrels', label: 'Barrels & drums', hint: '55-gal barrels, groupage' },
  { id: 'boxes', label: 'Boxes & personal effects', hint: 'Cartons, suitcases, small items' },
  { id: 'pallets', label: 'Pallets', hint: 'Palletised goods, 1–10 pallets' },
  { id: 'vehicle', label: 'Vehicle', hint: 'Car, SUV, truck — RoRo or containerised' },
  { id: 'container20', label: '20ft container', hint: 'Full container load' },
  { id: 'container40', label: '40ft container', hint: 'Full container load' },
  { id: 'commercial', label: 'Commercial cargo', hint: 'Machinery, medical, retail stock' },
]

export interface Shipper {
  id: string
  name: string
  tagline: string
  hq: string
  founded: number
  modes: Mode[]
  destinations: string[]
  origins: string[]
  cargo: CargoType[]
  rating: number
  reviews: number
  verified: boolean
  responseHours: number
  onTime: number
  services: string[]
  about: string
  priceIndex: number // 1 = budget, 2 = mid, 3 = premium
  plan: 'starter' | 'pro' | 'enterprise'
  initials: string
  hue: string
}

export const shippers: Shipper[] = [
  { id: 'atlantic-bridge', name: 'Atlantic Bridge Logistics', tagline: 'Weekly consolidations to Tema & Lagos', hq: 'Newark, NJ', founded: 2011, modes: ['ocean', 'air'], destinations: ['GH', 'NG', 'TG'], origins: ['Newark, NJ', 'New York, NY', 'Philadelphia, PA'], cargo: ['barrels', 'boxes', 'pallets', 'vehicle', 'container20', 'container40'], rating: 4.8, reviews: 312, verified: true, responseHours: 2, onTime: 96, services: ['Door pickup', 'Customs brokerage', 'Insurance', 'Warehousing'], about: 'Family-run NVOCC with its own bonded warehouse in Newark. Sails every Friday to Tema and Lagos, with door delivery in Accra, Kumasi and Lagos.', priceIndex: 2, plan: 'enterprise', initials: 'AB', hue: '#E3B54A' },
  { id: 'gold-coast-freight', name: 'Gold Coast Freight', tagline: 'Ghana specialists since 2008', hq: 'Houston, TX', founded: 2008, modes: ['ocean'], destinations: ['GH'], origins: ['Houston, TX', 'Atlanta, GA', 'Chicago, IL'], cargo: ['barrels', 'boxes', 'vehicle', 'container20', 'container40'], rating: 4.9, reviews: 508, verified: true, responseHours: 1, onTime: 97, services: ['Door pickup', 'Vehicle inspection', 'Customs brokerage', 'Duty estimates'], about: 'Ghana-only focus means every staff member knows Tema clearance inside out. Vehicle shipping with pre-shipment inspection and duty estimates before you commit.', priceIndex: 2, plan: 'pro', initials: 'GC', hue: '#2DD4BF' },
  { id: 'sahel-air-cargo', name: 'Sahel Air Cargo', tagline: 'Express air freight, 3-day delivery', hq: 'London, UK', founded: 2015, modes: ['air'], destinations: ['GH', 'NG', 'SN', 'CI', 'TG'], origins: ['London, UK', 'Manchester, UK', 'Paris, FR'], cargo: ['boxes', 'pallets', 'commercial'], rating: 4.7, reviews: 189, verified: true, responseHours: 3, onTime: 94, services: ['Same-day pickup (London)', 'Temperature-controlled', 'Dangerous goods certified'], about: 'IATA-accredited air forwarder with daily uplift from Heathrow. Ideal for urgent commercial shipments, medical supplies and perishables.', priceIndex: 3, plan: 'pro', initials: 'SA', hue: '#7DD3FC' },
  { id: 'monrovia-express', name: 'Monrovia Express Shipping', tagline: 'Liberia lane, every two weeks', hq: 'Minneapolis, MN', founded: 2013, modes: ['ocean', 'air'], destinations: ['LR', 'SL'], origins: ['Minneapolis, MN', 'Philadelphia, PA', 'Providence, RI'], cargo: ['barrels', 'boxes', 'vehicle', 'container20', 'container40'], rating: 4.6, reviews: 143, verified: true, responseHours: 4, onTime: 92, services: ['Door pickup', 'Freeport clearance', 'Door delivery Monrovia'], about: 'Run by Liberian-Americans for the Liberian diaspora. Bi-weekly consolidations with clearance handled at Freeport by our own team.', priceIndex: 1, plan: 'starter', initials: 'ME', hue: '#F87171' },
  { id: 'lome-line', name: 'Lomé Line Maritime', tagline: 'Togo, Benin & Burkina via Lomé', hq: 'Hamburg, DE', founded: 2006, modes: ['ocean'], destinations: ['TG', 'GH', 'CI'], origins: ['Hamburg, DE', 'Rotterdam, NL', 'Paris, FR'], cargo: ['vehicle', 'container20', 'container40', 'commercial', 'pallets'], rating: 4.8, reviews: 276, verified: true, responseHours: 2, onTime: 95, services: ['RoRo vehicles', 'Project cargo', 'Transit to Burkina Faso', 'Customs brokerage'], about: 'European gateway to Lomé with fortnightly RoRo sailings. Inland transit to Ouagadougou and Niamey arranged under bond.', priceIndex: 2, plan: 'enterprise', initials: 'LL', hue: '#A78BFA' },
  { id: 'naija-direct', name: 'Naija Direct Cargo', tagline: 'Lagos & Abuja door-to-door', hq: 'Atlanta, GA', founded: 2016, modes: ['air', 'ocean'], destinations: ['NG'], origins: ['Atlanta, GA', 'Houston, TX', 'New York, NY', 'Toronto, CA'], cargo: ['boxes', 'barrels', 'pallets', 'vehicle', 'commercial'], rating: 4.5, reviews: 401, verified: true, responseHours: 1, onTime: 91, services: ['Door pickup', 'Door delivery', 'SONCAP guidance', 'Duty estimates'], about: 'Nigeria-only forwarder with delivery hubs in Lagos, Abuja and Port Harcourt. Weekly air, monthly ocean.', priceIndex: 1, plan: 'pro', initials: 'ND', hue: '#4ADE80' },
  { id: 'dakar-sky', name: 'Dakar Sky Freight', tagline: 'Senegal & the francophone coast', hq: 'Paris, FR', founded: 2012, modes: ['air', 'ocean'], destinations: ['SN', 'CI', 'TG'], origins: ['Paris, FR', 'New York, NY'], cargo: ['boxes', 'pallets', 'commercial', 'container20'], rating: 4.7, reviews: 97, verified: false, responseHours: 6, onTime: 93, services: ['Air express', 'LCL groupage', 'French/English support'], about: 'Bilingual team serving Dakar and Abidjan with direct air uplift from Paris CDG and LCL groupage from Le Havre.', priceIndex: 2, plan: 'starter', initials: 'DS', hue: '#FB923C' },
  { id: 'pacific-west-africa', name: 'Pacific–West Africa Lines', tagline: 'From Asia to the Gulf of Guinea', hq: 'Guangzhou, CN', founded: 2010, modes: ['ocean', 'air'], destinations: ['NG', 'GH', 'CI', 'SN'], origins: ['Guangzhou, CN', 'Shanghai, CN', 'Dubai, AE'], cargo: ['container20', 'container40', 'commercial', 'pallets'], rating: 4.4, reviews: 220, verified: true, responseHours: 5, onTime: 90, services: ['Supplier pickup', 'Consolidation', 'Quality inspection', 'Customs brokerage'], about: 'Commercial importers’ partner for Asia-to-Africa trade. Supplier consolidation in Guangzhou with FCL and LCL sailings to Lagos, Tema and Abidjan.', priceIndex: 1, plan: 'enterprise', initials: 'PW', hue: '#38BDF8' },
]

export interface Testimonial { quote: string; name: string; role: string; initials: string }
export const testimonials: Testimonial[] = [
  { quote: 'I shipped a 2019 Highlander to Tema and three barrels for my mother. Four quotes in a day, picked Gold Coast, and it cleared in nine days. No surprises on duty.', name: 'Abena Owusu', role: 'Customer · Houston → Accra', initials: 'AO' },
  { quote: 'Our clinic in Monrovia needed a pallet of supplies fast. Ship Sync matched us with an air forwarder that had it there in five days, with the paperwork done.', name: 'Dr. James Kollie', role: 'NGO logistics lead · Philadelphia → Monrovia', initials: 'JK' },
  { quote: 'Listing on Ship Sync replaced our Facebook-group lead hunting. We book 30–40 new customers a month and the verification badge closes deals for us.', name: 'Kwame Asante', role: 'Operations Director, Atlantic Bridge Logistics', initials: 'KA' },
]

export const faqs = [
  { q: 'How do I know a shipper is legitimate?', a: 'Every “Verified” shipper has passed a document check: business registration, NVOCC/IATA or forwarder licence, insurance certificate, and a physical warehouse address confirmed by our team. Reviews come only from customers who booked through Ship Sync.' },
  { q: 'How much does it cost to ship a barrel or box?', a: 'Rates vary by lane. Consolidated barrels to Ghana or Nigeria from the US East Coast typically quote in a range shippers set themselves; boxes are priced by size. Post your shipment and you will receive real quotes from several shippers within 24 hours — Ship Sync charges customers nothing.' },
  { q: 'What documents do I need to ship a vehicle?', a: 'Usually the original title (or a lien-holder letter), a bill of sale, a copy of your ID, and the destination consignee’s details. Shippers on the platform provide the destination-specific checklist (e.g. Ghana Customs, Nigeria SONCAP) as part of their quote.' },
  { q: 'How long does ocean shipping take?', a: 'Port-to-port transit from the US East Coast is roughly 4–6 weeks to Tema, Lagos, Lomé or Monrovia, plus clearance. Air freight typically takes 3–7 days door to door. Each quote shows the shipper’s estimated transit and their historical on-time rate.' },
  { q: 'How do I pay?', a: 'You pay the shipper directly according to the quote — most accept card, bank transfer and Zelle. Ship Sync never holds your funds. We recommend paying only after a signed booking confirmation, which every platform shipper issues.' },
  { q: 'Is my cargo insured?', a: 'Most shippers offer all-risk cargo insurance as an add-on shown on the quote. Look for the “Insurance” badge in the directory, and declare the value accurately when you post your shipment.' },
]

export type ShipmentStatus = 'booked' | 'picked_up' | 'at_origin_port' | 'in_transit' | 'arrived' | 'customs' | 'out_for_delivery' | 'delivered'

export const statusLabels: Record<ShipmentStatus, string> = {
  booked: 'Booked', picked_up: 'Picked up', at_origin_port: 'At origin port', in_transit: 'In transit', arrived: 'Arrived at destination', customs: 'Customs clearance', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
}
export const statusOrder: ShipmentStatus[] = ['booked', 'picked_up', 'at_origin_port', 'in_transit', 'arrived', 'customs', 'out_for_delivery', 'delivered']

export interface TrackingEvent { status: ShipmentStatus; at: string; place: string; note?: string }
export interface Shipment {
  id: string
  ref: string
  shipperId: string
  mode: Mode
  origin: string
  destination: string
  cargo: CargoType
  description: string
  status: ShipmentStatus
  eta: string
  events: TrackingEvent[]
  customer: string
}

export const sampleShipments: Shipment[] = [
  { id: 's1', ref: 'SS-4F7K2Q', shipperId: 'gold-coast-freight', mode: 'ocean', origin: 'Houston, TX', destination: 'GH', cargo: 'vehicle', description: '2019 Toyota Highlander + 3 barrels', status: 'in_transit', eta: '2026-10-02', customer: 'Abena Owusu', events: [
    { status: 'booked', at: '2026-08-14T15:20:00Z', place: 'Houston, TX', note: 'Booking confirmed. Title and bill of sale received.' },
    { status: 'picked_up', at: '2026-08-18T13:05:00Z', place: 'Houston, TX', note: 'Vehicle collected; inspection photos uploaded.' },
    { status: 'at_origin_port', at: '2026-08-22T09:40:00Z', place: 'Port of Houston', note: 'Loaded into container MSKU 771 204 3.' },
    { status: 'in_transit', at: '2026-08-27T02:15:00Z', place: 'Atlantic Ocean', note: 'Sailed on MSC Alessia. Next port: Tema.' },
  ] },
  { id: 's2', ref: 'SS-9B3MX1', shipperId: 'sahel-air-cargo', mode: 'air', origin: 'London, UK', destination: 'NG', cargo: 'pallets', description: '2 pallets — medical consumables', status: 'delivered', eta: '2026-08-30', customer: 'Adaeze Health Ltd', events: [
    { status: 'booked', at: '2026-08-24T10:00:00Z', place: 'London, UK' },
    { status: 'picked_up', at: '2026-08-25T08:30:00Z', place: 'Croydon, UK' },
    { status: 'in_transit', at: '2026-08-26T22:10:00Z', place: 'LHR → LOS', note: 'BA075' },
    { status: 'arrived', at: '2026-08-27T06:05:00Z', place: 'Lagos (LOS)' },
    { status: 'customs', at: '2026-08-28T11:00:00Z', place: 'MMIA Cargo' },
    { status: 'out_for_delivery', at: '2026-08-29T07:45:00Z', place: 'Lagos' },
    { status: 'delivered', at: '2026-08-29T13:20:00Z', place: 'Victoria Island, Lagos', note: 'Signed by C. Okafor.' },
  ] },
  { id: 's3', ref: 'SS-2LR8TD', shipperId: 'monrovia-express', mode: 'ocean', origin: 'Minneapolis, MN', destination: 'LR', cargo: 'barrels', description: '6 barrels — household goods', status: 'customs', eta: '2026-09-08', customer: 'Joseph Kollie', events: [
    { status: 'booked', at: '2026-07-20T16:00:00Z', place: 'Minneapolis, MN' },
    { status: 'picked_up', at: '2026-07-24T14:00:00Z', place: 'Brooklyn Park, MN' },
    { status: 'at_origin_port', at: '2026-08-01T10:00:00Z', place: 'Port of Baltimore' },
    { status: 'in_transit', at: '2026-08-04T04:00:00Z', place: 'Atlantic Ocean' },
    { status: 'arrived', at: '2026-09-01T08:30:00Z', place: 'Freeport of Monrovia' },
    { status: 'customs', at: '2026-09-02T12:00:00Z', place: 'Freeport of Monrovia', note: 'Duty assessment in progress.' },
  ] },
]

export const countryByCode = (code: string) => countries.find((c) => c.code === code)
export const shipperById = (id: string) => shippers.find((s) => s.id === id)
export const cargoLabel = (id: CargoType) => cargoTypes.find((c) => c.id === id)?.label ?? id
