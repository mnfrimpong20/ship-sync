/** Help centre articles. Plain words, short, one task each. `body` paragraphs are separated by blank lines; lines starting "- " are bullets. */
export type Audience = 'senders' | 'receivers' | 'shippers'
export interface HelpArticle { slug: string; audience: Audience; title: string; summary: string; body: string; links?: { label: string; to: string }[] }

export const HELP: HelpArticle[] = [
  { slug: 'get-a-quote', audience: 'senders', title: 'Getting quotes for a shipment', summary: 'One request, several shippers answer.', body: `Tell us what you're sending, from where, and where it's going. Verified shippers on that lane send you prices — usually within a few hours.

- Compare price, transit time, what's included (pickup, door delivery, insurance) and reviews.
- Quotes say whether they're firm or estimated. Estimated prices can change after the goods are weighed.
- Nothing is booked until you accept a quote.`, links: [{ label: 'Get a quote', to: '/quote' }] },
  { slug: 'declaration', audience: 'senders', title: 'What you can and can’t ship', summary: 'The declaration on every request, and why it matters.', body: `Every request includes a short declaration. Shippers can't carry firearms, explosives, gas cylinders, illegal drugs, counterfeit goods, or live animals and plants. Customs at the destination can seize them, and you may be fined.

Some things are allowed but the shipper must know in advance: lithium batteries and power banks, perfume and aerosols, food, medicine, used electronics, and cash or jewellery over US$10,000. Tick them on the request so the shipper can pack and declare them properly.` },
  { slug: 'paying', audience: 'senders', title: 'Paying for your shipment', summary: 'Card payments are held until your goods are on their way.', body: `When you pay through Ntemtem, the money is held and only released to the shipper once your shipment reaches the stage the platform sets (usually when it has sailed or flown).

- You can pay several shipments in one checkout from your dashboard.
- If something goes wrong, open a dispute from the shipment before the money is released.
- Some shippers also accept bank transfer or cash; they record it and you'll see it on the shipment.`, links: [{ label: 'Your payments', to: '/dashboard?tab=money' }] },
  { slug: 'eei', audience: 'senders', title: 'US export filing (EEI) for valuable shipments and cars', summary: 'Why a shipment worth over $2,500 needs an extra step.', body: `Shipments leaving the United States need an Electronic Export Information (EEI) filing when any single type of goods is worth more than US$2,500, and always for vehicles. Your shipper files it and records the ITN number on your shipment.

For cars, the original title must reach US Customs at least 72 hours before export. Your shipper will tell you when to hand it over. The shipment can't leave until this is done, so send documents early.` },
  { slug: 'add-recipient', audience: 'senders', title: 'Adding the person who receives it', summary: 'Name, phone, address — and a GhanaPost GPS code in Ghana.', body: `Add the receiver's name and phone (WhatsApp if they have it). They get texts as the shipment moves, and a link to confirm when it arrives.

Use the address search to pin their home on the map for the driver. In Ghana, add their GhanaPost GPS digital address (it looks like GA-183-8164 and is shown in the GhanaPost GPS app). Receivers in French-speaking countries get their texts in French.` },
  { slug: 'weights', audience: 'senders', title: 'Why the weight on my invoice changed', summary: 'Actual weight, volume and chargeable weight.', body: `Shippers weigh and measure every piece when they collect it. Air freight is charged on whichever is higher: the actual weight, or the volume weight (length × width × height in cm ÷ 6000). Ocean freight is charged by volume, where 1 cubic metre counts as 1,000 kg.

If your goods came in noticeably heavier or bigger than you estimated, we'll tell you, and your shipper may update an estimated price before it ships.` },
  { slug: 'damage', audience: 'senders', title: 'Something arrived damaged or missing', summary: 'What to do in the first 48 hours.', body: `Ask the receiver to tap "Something's wrong" on their link and add photos if they can. Then open a dispute from the shipment, or open a support ticket marked "Damage or loss".

If you bought cover with the shipment, make your insurance claim from the same screen. Keep the packaging until it's sorted.`, links: [{ label: 'Open a support ticket', to: '/support' }] },
  { slug: 'track', audience: 'receivers', title: 'Following a shipment that’s coming to you', summary: 'The link in your text message.', body: `The text from Ntemtem has a link to your shipment page. It shows where the shipment is, when it should arrive, and where to collect it. You don't need an account.

You can also track with the reference (it starts with NT- or SS-) on the tracking page.`, links: [{ label: 'Track a shipment', to: '/track' }] },
  { slug: 'receiver-pay', audience: 'receivers', title: 'Paying duty or delivery by mobile money', summary: 'MTN MoMo, Telecel Cash, AirtelTigo, M-Pesa, Orange Money.', body: `If the shipper has to collect money from you — duty they paid at customs, delivery to your door, or storage — it shows on your shipment page with a "Pay with mobile money" button. You get a confirmation as soon as it's paid.

Where online payment isn't available yet, you pay the shipper at collection in cash or by mobile money, and they record it.` },
  { slug: 'collect', audience: 'receivers', title: 'Collecting your goods', summary: 'What to bring.', body: `When your shipment is ready, you'll get a text with where to collect it. Bring a photo ID and the reference. Staff can scan the QR code on your shipment page.

Once you have everything, tap "I received it" on your page — the sender will be told straight away.` },
  { slug: 'french', audience: 'receivers', title: 'Reading your page in French or English', summary: 'Changer de langue.', body: `Receivers in French-speaking countries see their page and texts in French. Use the language button at the top of the page to switch; future texts follow your choice.

Les destinataires des pays francophones reçoivent la page et les messages en français. Utilisez le bouton de langue en haut de la page pour changer.` },
  { slug: 'shipper-join', audience: 'shippers', title: 'Listing your company on Ntemtem', summary: 'Sign up, get verified, start quoting.', body: `Create your company, add your lanes and prices, and send your licence and insurance for verification. Verified shippers get the badge, rank higher and win more quotes.

We screen every company against sanctions lists as part of verification.`, links: [{ label: 'For shipping companies', to: '/for-shippers' }] },
  { slug: 'shipper-export', audience: 'shippers', title: 'Recording EEI filings and vehicle titles', summary: 'The Export filing card on each US shipment.', body: `For shipments from the US worth over US$2,500, and for every vehicle, file in AESDirect (ACE) or through your broker, then type the ITN (an X followed by 14 digits) into Export filing on the shipment. If no filing is needed, pick the exemption you're relying on.

Vehicles also need the title step (CBP filed) in the vehicle checklist. You can't move the shipment to "At origin port" until this is done.` },
  { slug: 'shipper-weigh', audience: 'shippers', title: 'Weighing and measuring pieces', summary: 'Use a USB scale or type it in.', body: `Open a shipment and use Weigh & measure. Enter the weight and L × W × H for each piece, in kg/cm or lb/in. In Chrome or Edge, the plug button reads a USB scale directly. Scales that type into the box work in any browser.

We work out the volume, volumetric weight and chargeable weight, and flag it if the goods are 10% or more over what the customer declared.` },
  { slug: 'shipper-collect', audience: 'shippers', title: 'Collecting money from the receiver', summary: 'Duty, delivery and storage at destination.', body: `Open the shipment and use Collect from receiver. Add the amount in local currency and what it's for, and we'll text the receiver a payment link. They pay by mobile money where available.

If they pay you in cash or straight to your own MoMo number, record it with one tap. Ask Ntemtem to link your Paystack subaccount so online payments settle straight to you.` },
  { slug: 'shipper-supplies', audience: 'shippers', title: 'Scanners, printers and packing supplies', summary: 'Buy, rent or get them with your plan.', body: `The Ntemtem store sells and rents label printers, scanners and packing supplies. Some kits come with your plan. Barrels and boxes your customers ask for can be supplied by you or, if you don't stock them, by Ntemtem straight to the customer.`, links: [{ label: 'Open the store', to: '/dashboard/supplies' }] },
]

export const AUDIENCES: { key: Audience; label: string; blurb: string }[] = [
  { key: 'senders', label: 'Sending', blurb: 'Quotes, paying, documents and problems' },
  { key: 'receivers', label: 'Receiving', blurb: 'Tracking, paying at destination, collecting' },
  { key: 'shippers', label: 'Shipping companies', blurb: 'Running your business on Ntemtem' },
]

export function searchHelp(q: string): HelpArticle[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  if (!words.length) return []
  return HELP.map((a) => { const hay = `${a.title} ${a.summary} ${a.body}`.toLowerCase(); const score = words.reduce((s, w) => s + (a.title.toLowerCase().includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0); return { a, score } })
    .filter((x) => x.score >= words.length).sort((x, y) => y.score - x.score).map((x) => x.a)
}
