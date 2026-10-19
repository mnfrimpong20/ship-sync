/* Shared by the server (scoring) and the driver's phone (questions, agreement text). */

export const CONTRACT_VERSION = '1'

/** Short driver agreement shown and signed on the phone. Companies should have a lawyer check it for their country. */
export const contractText = (company: string, driver: string, employment: 'employee' | 'contractor') => [
  `This agreement is between ${company || 'the company'} and ${driver || 'the driver'}${employment === 'contractor' ? ', working as an independent contractor' : ', working as an employee'}.`,
  'Proof of every stop. I will record proof (name, pieces, photo and signature where asked) at every pickup and delivery, and only hand goods to the right person — checking the delivery code or ID when the app asks.',
  'Money. Cash, mobile money and other payments I take belong to the company. I will record every payment in the app and hand cash to the office the same or next working day. Shortfalls may be deducted from my pay after we talk about them.',
  'The vehicle. I will do the vehicle check before each run, report any problem straight away, and not drive a vehicle that is unsafe. I will follow traffic law and never use the phone by hand while driving.',
  'Goods. I will handle goods with care, report any damage or loss through the app at once, and never open a customer’s goods.',
  'Time and pay. I will clock in and out honestly. Pay is set by the rates the company sets in the app and is shown on my payslips.',
  'Privacy. Customer details, addresses, codes and photos are only for doing the job. My location is shared with the office only while a run is open in the app.',
  'Ending. Either side can end this agreement with notice. I will return equipment, keys, fuel cards and uniforms on my last day.',
]

export interface TrainingQ { q: string; options: string[]; answer: number; why: string }
export const TRAINING: TrainingQ[] = [
  { q: 'The receiver can’t find the 4-digit delivery code. What do you do?', options: ['Hand it over anyway', 'Check their ID and enter only the last 4 characters', 'Take it back to the warehouse without asking'], answer: 1, why: 'An ID check is the other way to prove it’s them. Only the last 4 characters are kept.' },
  { q: 'Nobody is home. A neighbour offers to take the barrel. You…', options: ['Leave it at the gate with no record', 'Choose “Left with someone”, name them and take a photo', 'Mark it delivered to the receiver'], answer: 1, why: 'The app texts the receiver where it was left, and the photo protects you.' },
  { q: 'You took $200 in cash at a stop. When do you hand it in?', options: ['At the end of the month', 'The same or next working day, and record it in the app at the stop', 'Only if the office asks'], answer: 1, why: 'The office matches every handover against what the app recorded.' },
  { q: 'During the vehicle check the brakes feel soft. What now?', options: ['Drive carefully', 'Mark brakes as a problem and say it isn’t safe to drive', 'Tell a colleague later'], answer: 1, why: '“Not safe” puts the vehicle into maintenance and alerts the office straight away.' },
  { q: 'A box gets crushed while you load it. You…', options: ['Tape it and say nothing', 'Report a problem with photos before you leave', 'Wait for the customer to complain'], answer: 1, why: 'Early reports with photos let the office start an insurance claim.' },
  { q: 'At a pickup the barrel weighs far more than the sender declared. You…', options: ['Charge them cash on the spot', 'Weigh it in the app and get the sender to sign the new price', 'Refuse the pickup'], answer: 1, why: 'The app works out the new price; the sender signs it at the door.' },
  { q: 'When is your location shared with the office?', options: ['All the time', 'Only while a run is open in the app', 'Never'], answer: 1, why: 'Location is only sent while a run is in progress and the app is open.' },
  { q: 'You finish late and forget to clock out. What should you do?', options: ['Nothing', 'Clock out as soon as you notice, or tell the office the right time', 'Clock out next morning'], answer: 1, why: 'The office can correct the time, and your timesheet stays right.' },
]
