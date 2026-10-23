/**
 * Receiver-facing words in English and French (Togo, Côte d'Ivoire, Senegal, Benin, Cameroon…).
 * Used by the receiver page (/r/:token) and by the texts in server/recipient.ts. Keep texts short:
 * SMS is billed per segment and accented characters already shorten a segment.
 */
import type { Lang } from './address'

export type TextKind = 'notice' | 'sailed' | 'arrived' | 'ready' | 'out_for_delivery' | 'delivered' | 'reminder' | 'charge'
export interface TextVars { hi: string; name: string; sender: string; shipper: string; ref: string; link: string; port: string; vessel?: string; eta?: string; note?: string; phone?: string; amount?: string }

const EN: Record<TextKind, (v: TextVars) => string> = {
  notice: (v) => `${v.hi} ${v.sender} is sending you a package with ${v.shipper} on Ntemtem. Ref ${v.ref}. Track it here: ${v.link}`,
  sailed: (v) => `${v.hi} your package from ${v.sender} is on its way${v.vessel ? ` on ${v.vessel}` : ''}${v.eta ? `, arriving around ${v.eta}` : ''}. Ref ${v.ref}. Follow it: ${v.link}`,
  arrived: (v) => `${v.hi} your package ${v.ref} has landed at ${v.port} and is going through customs. We'll message you the moment it's ready. ${v.link}`,
  ready: (v) => `Good news, ${v.name} — your package ${v.ref} is ready for collection at ${v.shipper}${v.note ? ` (${v.note})` : ''}. Bring your ID and this ref. ${v.link}`,
  out_for_delivery: (v) => `${v.hi} your package ${v.ref} is out for delivery today. Please keep ${v.phone || 'this number'} on. ${v.link}`,
  delivered: (v) => `${v.hi} your package ${v.ref} has been delivered. Tap to confirm you have it: ${v.link} — or reply if anything is missing.`,
  reminder: (v) => `${v.hi} a reminder: your package ${v.ref} is waiting for you at ${v.shipper}. ${v.link}`,
  charge: (v) => `${v.hi} ${v.amount} is due on your package ${v.ref}${v.note ? ` (${v.note})` : ''}. Pay by mobile money here: ${v.link}`,
}
const FR: Record<TextKind, (v: TextVars) => string> = {
  notice: (v) => `${v.hi} ${v.sender} vous envoie un colis avec ${v.shipper} via Ntemtem. Réf ${v.ref}. Suivez-le ici : ${v.link}`,
  sailed: (v) => `${v.hi} votre colis de ${v.sender} est en route${v.vessel ? ` sur le ${v.vessel}` : ''}${v.eta ? `, arrivée prévue vers le ${v.eta}` : ''}. Réf ${v.ref}. Suivi : ${v.link}`,
  arrived: (v) => `${v.hi} votre colis ${v.ref} est arrivé à ${v.port} et passe la douane. Nous vous écrirons dès qu'il sera prêt. ${v.link}`,
  ready: (v) => `Bonne nouvelle, ${v.name} : votre colis ${v.ref} est prêt à être retiré chez ${v.shipper}${v.note ? ` (${v.note})` : ''}. Apportez une pièce d'identité et cette réf. ${v.link}`,
  out_for_delivery: (v) => `${v.hi} votre colis ${v.ref} est en livraison aujourd'hui. Gardez le ${v.phone || 'ce numéro'} allumé. ${v.link}`,
  delivered: (v) => `${v.hi} votre colis ${v.ref} a été livré. Confirmez la réception ici : ${v.link} — ou répondez s'il manque quelque chose.`,
  reminder: (v) => `${v.hi} rappel : votre colis ${v.ref} vous attend chez ${v.shipper}. ${v.link}`,
  charge: (v) => `${v.hi} ${v.amount} reste à payer pour votre colis ${v.ref}${v.note ? ` (${v.note})` : ''}. Payez par mobile money ici : ${v.link}`,
}
export const receiverText = (lang: Lang, kind: TextKind, v: TextVars) => (lang === 'fr' ? FR : EN)[kind](v)
export const greeting = (lang: Lang, country: string, name: string) => (lang === 'fr' ? `Bonjour ${name},` : country === 'GH' ? `Akwaaba, ${name}!` : `Hi ${name},`)

/** Receiver page copy. */
const en = {
    confirmedNote: (on: string, sender: string, shipper: string) => `Receipt confirmed${on ? ` on ${on}` : ''}. ${sender} and ${shipper} have been told.`, flagged: 'We’ve flagged a problem.', followUp: (shipper: string) => `${shipper} will follow up with you.`, textsIn: 'Texts will come in English.',
    hiName: (n: string) => `Hi ${n} — `, delivered: 'your shipment has been delivered.', ready: 'your shipment is ready.', coming: 'a shipment is coming to you.',
    from: 'From', in: 'in', handledBy: 'handled by', expected: 'Expected',
    steps: ['Booked', 'On its way', 'Arrived', 'Ready', 'Delivered'],
    readyTitle: 'Ready for collection', readyFrom: 'from', bringId: 'Bring an ID and this reference:',
    reached: (p: string) => `It has reached ${p} and is going through customs. We’ll text you when it’s ready to collect.`,
    sailingOn: 'Sailing on', seeMap: 'See it on the map', pieces: (n: number, d: number) => `${n} pieces · ${d} delivered`,
    thanks: 'Thank you', confirmed: 'Receipt confirmed', reported: 'Problem reported — the shipper has been told and will contact you.',
    notYet: 'Once it reaches you, you can confirm receipt (or report a problem) right here.', didYou: 'Did you receive it?', confirmOnce: 'Tap confirm once the goods are in your hands.', onlyConfirm: 'Only confirm once the goods are actually with you — this tells the sender it has arrived.',
    yourName: 'Your name', allGood: 'All good', wrong: 'Something’s wrong', addNote: 'Anything to add? (optional)', whatsWrong: 'What’s wrong? (missing piece, damage…)',
    sending: 'Sending…', iReceived: 'I received it', report: 'Report a problem',
    showAt: 'Show this at collection', refLabel: 'Reference', staffScan: 'Staff can scan the code to pull up the shipment.', fullTracking: 'Full tracking page →',
    history: 'History', footer: (s: string) => `Sent by ${s} via Ntemtem. Questions about the goods go to the sender.`,
    deliverTo: 'Delivering to', openMap: 'Open in Maps', gps: 'GhanaPost GPS',
    toPay: 'To pay before collection', paid: 'Paid', payMomo: 'Pay with mobile money', payOther: 'Pay now', paying: 'Opening payment…', payAtCollection: 'Pay at collection — cash or mobile money to the shipper.', paidThanks: 'Payment received — thank you.', checking: 'Checking your payment…',
    lang: 'Français', invalid: 'This link is not valid.', askSender: 'Ask the sender for a fresh link, or', trackRef: 'track with the reference', loading: 'Loading…',
}
export type RxCopy = typeof en
const fr: RxCopy = {
    confirmedNote: (on: string, sender: string, shipper: string) => `Réception confirmée${on ? ` le ${on}` : ''}. ${sender} et ${shipper} ont été prévenus.`, flagged: 'Nous avons signalé le problème.', followUp: (shipper: string) => `${shipper} vous recontactera.`, textsIn: 'Les messages arriveront en français.',
    hiName: (n: string) => `Bonjour ${n} — `, delivered: 'votre colis a été livré.', ready: 'votre colis est prêt.', coming: 'un colis arrive pour vous.',
    from: 'De', in: 'à', handledBy: 'pris en charge par', expected: 'Prévu le',
    steps: ['Réservé', 'En route', 'Arrivé', 'Prêt', 'Livré'],
    readyTitle: 'Prêt à être retiré', readyFrom: 'chez', bringId: 'Apportez une pièce d’identité et cette référence :',
    reached: (p: string) => `Il est arrivé à ${p} et passe la douane. Nous vous enverrons un message quand il sera prêt.`,
    sailingOn: 'À bord du', seeMap: 'Voir sur la carte', pieces: (n: number, d: number) => `${n} colis · ${d} livrés`,
    thanks: 'Merci', confirmed: 'Réception confirmée', reported: 'Problème signalé — le transporteur a été prévenu et vous contactera.',
    notYet: 'Dès qu’il vous parvient, vous pourrez confirmer la réception (ou signaler un problème) ici.', didYou: 'Avez-vous reçu votre colis ?', confirmOnce: 'Confirmez dès que vous avez les marchandises en main.', onlyConfirm: 'Ne confirmez que lorsque vous avez réellement les marchandises — cela prévient l’expéditeur.',
    yourName: 'Votre nom', allGood: 'Tout est bon', wrong: 'Il y a un problème', addNote: 'Un commentaire ? (facultatif)', whatsWrong: 'Quel est le problème ? (colis manquant, dégâts…)',
    sending: 'Envoi…', iReceived: 'J’ai reçu mon colis', report: 'Signaler un problème',
    showAt: 'À présenter au retrait', refLabel: 'Référence', staffScan: 'Le personnel peut scanner ce code pour retrouver l’envoi.', fullTracking: 'Page de suivi complète →',
    history: 'Historique', footer: (s: string) => `Envoyé par ${s} via Ntemtem. Pour toute question sur la marchandise, contactez l’expéditeur.`,
    deliverTo: 'Livraison à', openMap: 'Ouvrir dans Maps', gps: 'GhanaPost GPS',
    toPay: 'À payer avant le retrait', paid: 'Payé', payMomo: 'Payer par mobile money', payOther: 'Payer maintenant', paying: 'Ouverture du paiement…', payAtCollection: 'À payer au retrait — en espèces ou par mobile money au transporteur.', paidThanks: 'Paiement reçu — merci.', checking: 'Vérification de votre paiement…',
    lang: 'English', invalid: 'Ce lien n’est pas valide.', askSender: 'Demandez un nouveau lien à l’expéditeur, ou', trackRef: 'suivez avec la référence', loading: 'Chargement…',
}
export const RX: Record<Lang, RxCopy> = { en, fr }
export const STATUS_FR: Record<string, string> = { booked: 'Réservé', picked_up: 'Enlevé', at_origin_port: 'Au port de départ', in_transit: 'En transit', arrived: 'Arrivé', customs: 'En douane', ready_for_collection: 'Prêt à retirer', out_for_delivery: 'En livraison', delivered: 'Livré' }
