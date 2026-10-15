/** Where Ship Sync Sourcing buys from. Shared by the server and the app. */
export type Origin = 'CN' | 'GB' | 'US'
export interface OriginInfo {
  code: Origin; name: string; short: string; flag: string; currency: 'CNY' | 'GBP' | 'USD'; symbol: string
  /** Default city goods ship from, and the warehouse that receives them. */
  hub: string; site: string
  /** Who we buy from — "factory" for China, "supplier" (stores, brands, wholesalers) for the UK and US. */
  seller: string; sellers: string
  blurb: string; examples: string; platforms: string; linkHint: string
}
export const ORIGINS: Record<Origin, OriginInfo> = {
  CN: {
    code: 'CN', name: 'China', short: 'China', flag: '🇨🇳', currency: 'CNY', symbol: '¥', hub: 'Guangzhou', site: 'site_cn_gz', seller: 'factory', sellers: 'factories',
    blurb: 'Factories and wholesale markets. Best for bulk stock, custom and branded goods at factory prices.',
    examples: 'Solar lanterns, kitchenware, phones and accessories, fabrics, furniture, motorbike parts',
    platforms: '1688, Alibaba, Taobao, Made-in-China', linkHint: 'https://detail.1688.com/offer/… or alibaba.com/product-detail/…',
  },
  GB: {
    code: 'GB', name: 'United Kingdom', short: 'UK', flag: '🇬🇧', currency: 'GBP', symbol: '£', hub: 'London', site: 'site_uk_lon', seller: 'supplier', sellers: 'suppliers',
    blurb: 'UK brands, retailers and wholesalers. Best for genuine branded goods, school and church supplies, toiletries, used and refurbished items.',
    examples: 'Branded clothing and shoes, toiletries and baby products, school uniforms, laptops, car parts',
    platforms: 'Amazon UK, eBay, Argos, Currys, John Lewis, Boots, cash-and-carry wholesalers', linkHint: 'https://www.amazon.co.uk/dp/… or argos.co.uk/product/…',
  },
  US: {
    code: 'US', name: 'United States', short: 'USA', flag: '🇺🇸', currency: 'USD', symbol: '$', hub: 'Houston', site: 'site_us_hou', seller: 'supplier', sellers: 'suppliers',
    blurb: 'US brands, stores, wholesalers and auctions. Best for genuine brands, electronics, tools, auto parts and medical supplies.',
    examples: 'Electronics, power tools, generators, auto and truck parts, medical and lab supplies, appliances',
    platforms: 'Amazon, Walmart, Home Depot, Best Buy, eBay, Costco, auto-parts and auction sites', linkHint: 'https://www.amazon.com/dp/… or homedepot.com/p/…',
  },
}
export const ORIGIN_CODES = Object.keys(ORIGINS) as Origin[]
export const asOrigin = (v: unknown): Origin => (typeof v === 'string' && v.toUpperCase() in ORIGINS ? (v.toUpperCase() as Origin) : 'CN')
/** Price in the origin's own currency, e.g. ¥28.5, £12.99, $40. */
export const localPrice = (n: number, origin: Origin | string) => `${ORIGINS[asOrigin(origin)].symbol}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
