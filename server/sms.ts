/**
 * Text messaging to phones in West Africa — SMS or WhatsApp, provider-agnostic.
 *
 *   SMS_PROVIDER=twilio          TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (+1…), optional TWILIO_WHATSAPP_FROM (whatsapp:+1…)
 *   SMS_PROVIDER=termii          TERMII_API_KEY, TERMII_SENDER_ID (Nigeria/Ghana-friendly)
 *   SMS_PROVIDER=africastalking  AT_USERNAME, AT_API_KEY, optional AT_FROM (sender id / short code)
 *   SMS_PROVIDER=log             print to the console (dev)
 *   unset                        auto-detect from the keys above, else off
 *   SMS_API_URL                  override the provider base URL (tests)
 *
 * Phone numbers are normalised to E.164 using the consignee's country before sending.
 */

/** Dial codes for phone normalisation. Destination countries also live in the `destinations` table (admin-editable); this map is the fallback plus origin countries. */
const COUNTRY_CODES: Record<string, string> = { GH: '233', NG: '234', LR: '231', TG: '228', CI: '225', SL: '232', SN: '221', CM: '237', GM: '220', GN: '224', BJ: '229', BF: '226', ML: '223', US: '1', GB: '44', CA: '1', DE: '49', NL: '31', FR: '33', AE: '971', CN: '86' }

/** "024 555 0190" + GH → "+233245550190"; already-international numbers pass through. */
export function normalisePhone(raw: string, country = 'GH'): string | null {
  let d = String(raw ?? '').replace(/[^\d+]/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = '+' + d.slice(2)
  if (d.startsWith('+')) return d.length >= 9 ? d : null
  const cc = COUNTRY_CODES[country.toUpperCase()] ?? ''
  if (d.startsWith('0')) d = d.slice(1)
  if (cc && d.startsWith(cc) && d.length >= 11) return '+' + d
  return cc ? `+${cc}${d}` : null
}

export type SmsProvider = 'twilio' | 'termii' | 'africastalking' | 'log' | 'off'
export function smsProvider(): { id: SmsProvider; label: string; whatsapp: boolean } {
  const p = (process.env.SMS_PROVIDER || '').toLowerCase() as SmsProvider | ''
  if (p === 'log') return { id: 'log', label: 'Console (dev)', whatsapp: false }
  if (p === 'twilio' || (!p && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)) return { id: 'twilio', label: 'Twilio', whatsapp: Boolean(process.env.TWILIO_WHATSAPP_FROM) }
  if (p === 'termii' || (!p && process.env.TERMII_API_KEY)) return { id: 'termii', label: 'Termii', whatsapp: false }
  if (p === 'africastalking' || (!p && process.env.AT_API_KEY && process.env.AT_USERNAME)) return { id: 'africastalking', label: "Africa's Talking", whatsapp: false }
  return { id: 'off', label: 'Not configured', whatsapp: false }
}

const base = (fallback: string) => (process.env.SMS_API_URL || fallback).replace(/\/$/, '')

/** Send one message. Resolves with the provider's message id; throws with a readable error. */
export async function sendText(to: string, text: string, channel: 'sms' | 'whatsapp' = 'sms'): Promise<string> {
  const p = smsProvider()
  if (p.id === 'log') { console.log(`[${channel} → ${to}] ${text}`); return 'log' }
  if (p.id === 'off') throw new Error('No messaging provider configured')
  if (p.id === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID!, tok = process.env.TWILIO_AUTH_TOKEN!
    const from = channel === 'whatsapp' && process.env.TWILIO_WHATSAPP_FROM ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_FROM!
    const dest = channel === 'whatsapp' && process.env.TWILIO_WHATSAPP_FROM ? `whatsapp:${to}` : to
    const res = await fetch(`${base('https://api.twilio.com')}/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: from, To: dest, Body: text }) })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${j.message ?? 'send failed'}`)
    return j.sid ?? 'ok'
  }
  if (p.id === 'termii') {
    const res = await fetch(`${base('https://api.ng.termii.com')}/api/sms/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: process.env.TERMII_API_KEY, to: to.replace('+', ''), from: process.env.TERMII_SENDER_ID || 'ShipSync', sms: text, type: 'plain', channel: channel === 'whatsapp' ? 'whatsapp' : 'generic' }) })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok || (j.code && j.code !== 'ok')) throw new Error(`Termii ${res.status}: ${j.message ?? 'send failed'}`)
    return j.message_id ?? 'ok'
  }
  // Africa's Talking
  const res = await fetch(`${base('https://api.africastalking.com')}/version1/messaging`, { method: 'POST', headers: { apiKey: process.env.AT_API_KEY!, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: process.env.AT_USERNAME!, to, message: text, ...(process.env.AT_FROM ? { from: process.env.AT_FROM } : {}) }) })
  const j: any = await res.json().catch(() => ({}))
  const r = j?.SMSMessageData?.Recipients?.[0]
  if (!res.ok || !r || (r.statusCode && r.statusCode >= 400)) throw new Error(`Africa's Talking ${res.status}: ${r?.status ?? j?.SMSMessageData?.Message ?? 'send failed'}`)
  return r.messageId ?? 'ok'
}
