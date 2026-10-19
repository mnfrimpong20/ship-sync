import { useLang, type Lang } from './prefs'

/**
 * Customer portal in French. Strings are looked up by their English text, so anything not translated yet simply
 * stays in English. Use `useT()` in components: `const t = useT(); t('Shipments')`. `{n}`-style placeholders are
 * filled from the second argument.
 */
const FR: Record<string, string> = {
  // menu
  'Overview': 'Vue d’ensemble', 'New request': 'Nouvelle demande', 'Quote requests': 'Demandes de devis', 'Shipments': 'Envois', 'Shared barrels': 'Fûts partagés', 'Sourcing': 'Achats',
  'Money': 'Paiements', 'Invoices': 'Factures', 'This week': 'Cette semaine', 'Messages': 'Messages', 'Documents': 'Documents', 'Saved & repeat': 'Favoris et répétition', 'Recipients': 'Destinataires',
  'Problems': 'Problèmes', 'Account': 'Compte', 'Live map': 'Carte en direct', 'Track a shipment': 'Suivre un envoi', 'Ntemtem website': 'Site Ntemtem', 'More': 'Plus', 'Less': 'Moins',
  'Shipping': 'Envois', 'Organise': 'Organiser', 'Help & account': 'Aide et compte', 'Tools': 'Outils', 'Customer': 'Client', 'Home': 'Accueil', 'Pay': 'Payer',
  'Help & support': 'Aide et assistance', 'Sign out': 'Se déconnecter', 'Skip to content': 'Aller au contenu', 'Open menu': 'Ouvrir le menu', 'Close menu': 'Fermer le menu',
  // page heads
  'Your account': 'Votre compte', 'What needs you, what’s on the way, and what you owe.': 'Ce qui vous attend, ce qui est en route et ce que vous devez.', 'New shipment request': 'Nouvelle demande d’envoi',
  'Compare quotes, ask shippers questions and book.': 'Comparez les devis, posez vos questions et réservez.', 'Track, pay, share and manage everything you’ve booked.': 'Suivez, payez, partagez et gérez tout ce que vous avez réservé.',
  'What you owe, what you’ve spent, and your statements.': 'Ce que vous devez, ce que vous avez dépensé et vos relevés.', 'Every invoice from your shippers, with pay links.': 'Toutes les factures de vos transporteurs, avec liens de paiement.',
  'Pickups, cutoffs, arrivals, payments and collection days.': 'Enlèvements, dates limites, arrivées, paiements et retraits.', 'Every conversation with your shippers, before and after booking.': 'Toutes vos conversations avec les transporteurs.',
  'Invoices, receipts, packing lists and customs papers in one place.': 'Factures, reçus, listes de colisage et documents de douane au même endroit.', 'Favourite shippers, repeat shipments and price alerts.': 'Transporteurs favoris, envois répétés et alertes de prix.',
  'The people who receive your goods — saved once, picked in a tap.': 'Les personnes qui reçoivent vos marchandises — enregistrées une fois.', 'Something went wrong? Report it and follow every reply here.': 'Un problème ? Signalez-le et suivez les réponses ici.',
  'Your profile, security, alerts, family and business details.': 'Votre profil, sécurité, alertes, famille et entreprise.', 'Space you reserved in shared barrels and containers.': 'L’espace réservé dans des fûts et conteneurs partagés.', 'Goods we’re buying for you in China, the UK and the USA.': 'Les marchandises que nous achetons pour vous en Chine, au Royaume-Uni et aux États-Unis.',
  'Help': 'Aide',
  // overview
  'At a glance': 'En bref', 'Activity & spending': 'Activité et dépenses', 'You owe': 'À payer', 'On the way': 'En route', 'Quotes to review': 'Devis à examiner', 'Needs you': 'À faire',
  'All paid up': 'Tout est payé', 'unread from shippers': 'non lus', 'Nothing unread': 'Rien de non lu', '{n} delivered so far': '{n} livrés',
  'Your shipments': 'Vos envois', 'All shipments': 'Tous les envois', 'Coming up': 'À venir', 'Next 2 weeks': '2 prochaines semaines', 'Show all {n}': 'Tout afficher ({n})', 'Show fewer': 'Afficher moins',
  '{n} invoices due': '{n} factures à payer', 'Pay all': 'Tout payer', '{n} more like this': '{n} autres du même type', 'Pay & statements': 'Paiements et relevés', 'Calendar': 'Calendrier',
  // shipments list
  'Search by reference, place or what’s inside': 'Rechercher par référence, lieu ou contenu', 'Active': 'En cours', 'To pay': 'À payer', 'Delivered': 'Livrés', 'All': 'Tous',
  'Show {n} more': 'Afficher {n} de plus', 'No shipments match.': 'Aucun envoi ne correspond.', 'Back to shipments': 'Retour aux envois', 'Expected {d}': 'Prévu {d}', 'Delivered {d}': 'Livré {d}',
  'Booked': 'Réservé', 'Arrived': 'Arrivé', '{n} shipments': '{n} envois', 'Open public tracking page': 'Ouvrir la page de suivi publique',
  'Tracking': 'Suivi', 'Customs & duty': 'Douane et droits', 'Recipient & pickup': 'Destinataire et retrait', 'Pay all in one checkout': 'Tout payer en une fois', 'What’s inside': 'Contenu', 'Customs': 'Douane', 'People': 'Personnes', 'Chat': 'Discussion', 'Docs': 'Documents',
  // notifications
  'Notifications': 'Notifications', 'Mark all read': 'Tout marquer comme lu', 'Nothing new.': 'Rien de nouveau.', 'See all': 'Tout voir',
  // display settings
  'Display & language': 'Affichage et langue', 'Text size': 'Taille du texte', 'Normal': 'Normale', 'Large': 'Grande', 'Larger': 'Très grande', 'Theme': 'Thème', 'Light': 'Clair', 'Dark': 'Sombre', 'Match my device': 'Comme mon appareil', 'Language': 'Langue',
  'Saved to your account, so it follows you to every device.': 'Enregistré sur votre compte : vous le retrouvez sur tous vos appareils.',
  'Loading your account…': 'Chargement de votre compte…', 'Loading…': 'Chargement…',
}
export function translate(lang: Lang, s: string, vars?: Record<string, string | number>) {
  let out = lang === 'fr' ? FR[s] ?? s : s
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  return out
}
export function useT() { const lang = useLang(); return (s: string, vars?: Record<string, string | number>) => translate(lang, s, vars) }

/* ---------------- dates people can read ---------------- */
const loc = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB')
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T12:00:00' : v))
/** "Sun 1 Nov" (adds the year when it isn't this year). */
export function fmtDay(v: string | Date | null | undefined, lang: Lang = 'en') {
  if (!v) return ''; const d = asDate(v); if (isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString(loc(lang), { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}
/** "today", "tomorrow", "in 14 days", "3 days ago". */
export function relDay(v: string | Date | null | undefined, lang: Lang = 'en') {
  if (!v) return ''; const d = asDate(v); if (isNaN(d.getTime())) return ''
  const n = Math.round((day0(d) - day0(new Date())) / 86400000)
  try { return new Intl.RelativeTimeFormat(loc(lang), { numeric: 'auto' }).format(n, 'day') } catch { return n === 0 ? 'today' : n > 0 ? `in ${n} days` : `${-n} days ago` }
}
/** "Sun 1 Nov (in 14 days)". */
export const fmtDayRel = (v: string | Date | null | undefined, lang: Lang = 'en') => (v ? `${fmtDay(v, lang)} (${relDay(v, lang)})` : '')
