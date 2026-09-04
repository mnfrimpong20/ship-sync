/** Small AIS reference tables for the vessel detail card: flag state from the MMSI, ship type and navigational status codes. */

/** ITU Maritime Identification Digits → flag state (major maritime registries; unknown MIDs show no flag). */
const MID: Record<string, string> = {
  201: 'Albania', 203: 'Austria', 205: 'Belgium', 207: 'Bulgaria', 209: 'Cyprus', 210: 'Cyprus', 211: 'Germany', 212: 'Cyprus', 213: 'Georgia', 214: 'Moldova', 215: 'Malta', 218: 'Germany', 219: 'Denmark', 220: 'Denmark', 224: 'Spain', 225: 'Spain', 226: 'France', 227: 'France', 228: 'France', 229: 'Malta', 230: 'Finland', 231: 'Faroe Islands', 232: 'United Kingdom', 233: 'United Kingdom', 234: 'United Kingdom', 235: 'United Kingdom', 236: 'Gibraltar', 237: 'Greece', 238: 'Croatia', 239: 'Greece', 240: 'Greece', 241: 'Greece', 242: 'Morocco', 243: 'Hungary', 244: 'Netherlands', 245: 'Netherlands', 246: 'Netherlands', 247: 'Italy', 248: 'Malta', 249: 'Malta', 250: 'Ireland', 251: 'Iceland', 252: 'Liechtenstein', 253: 'Luxembourg', 254: 'Monaco', 255: 'Madeira (Portugal)', 256: 'Malta', 257: 'Norway', 258: 'Norway', 259: 'Norway', 261: 'Poland', 262: 'Montenegro', 263: 'Portugal', 264: 'Romania', 265: 'Sweden', 266: 'Sweden', 267: 'Slovakia', 268: 'San Marino', 269: 'Switzerland', 270: 'Czech Republic', 271: 'Türkiye', 272: 'Ukraine', 273: 'Russia', 274: 'North Macedonia', 275: 'Latvia', 276: 'Estonia', 277: 'Lithuania', 278: 'Slovenia', 279: 'Serbia',
  301: 'Anguilla', 303: 'Alaska (USA)', 304: 'Antigua and Barbuda', 305: 'Antigua and Barbuda', 306: 'Curaçao', 307: 'Aruba', 308: 'Bahamas', 309: 'Bahamas', 310: 'Bermuda', 311: 'Bahamas', 312: 'Belize', 314: 'Barbados', 316: 'Canada', 319: 'Cayman Islands', 321: 'Costa Rica', 323: 'Cuba', 325: 'Dominica', 327: 'Dominican Republic', 329: 'Guadeloupe', 330: 'Grenada', 331: 'Greenland', 332: 'Guatemala', 334: 'Honduras', 336: 'Haiti', 338: 'USA', 339: 'Jamaica', 341: 'St Kitts and Nevis', 343: 'St Lucia', 345: 'Mexico', 347: 'Martinique', 348: 'Montserrat', 350: 'Nicaragua', 351: 'Panama', 352: 'Panama', 353: 'Panama', 354: 'Panama', 355: 'Panama', 356: 'Panama', 357: 'Panama', 358: 'Puerto Rico', 359: 'El Salvador', 361: 'St Pierre and Miquelon', 362: 'Trinidad and Tobago', 364: 'Turks and Caicos', 366: 'USA', 367: 'USA', 368: 'USA', 369: 'USA', 370: 'Panama', 371: 'Panama', 372: 'Panama', 373: 'Panama', 374: 'Panama', 375: 'St Vincent and the Grenadines', 376: 'St Vincent and the Grenadines', 377: 'St Vincent and the Grenadines', 378: 'British Virgin Islands', 379: 'US Virgin Islands',
  401: 'Afghanistan', 403: 'Saudi Arabia', 405: 'Bangladesh', 408: 'Bahrain', 410: 'Bhutan', 412: 'China', 413: 'China', 414: 'China', 416: 'Taiwan', 417: 'Sri Lanka', 419: 'India', 422: 'Iran', 423: 'Azerbaijan', 425: 'Iraq', 428: 'Israel', 431: 'Japan', 432: 'Japan', 434: 'Turkmenistan', 436: 'Kazakhstan', 437: 'Uzbekistan', 438: 'Jordan', 440: 'South Korea', 441: 'South Korea', 443: 'Palestine', 445: 'North Korea', 447: 'Kuwait', 450: 'Lebanon', 451: 'Kyrgyzstan', 453: 'Macao', 455: 'Maldives', 457: 'Mongolia', 459: 'Nepal', 461: 'Oman', 463: 'Pakistan', 466: 'Qatar', 468: 'Syria', 470: 'UAE', 471: 'UAE', 472: 'Tajikistan', 473: 'Yemen', 475: 'Yemen', 477: 'Hong Kong', 478: 'Bosnia and Herzegovina',
  501: 'Antarctica', 503: 'Australia', 506: 'Myanmar', 508: 'Brunei', 510: 'Micronesia', 511: 'Palau', 512: 'New Zealand', 514: 'Cambodia', 515: 'Cambodia', 516: 'Christmas Island', 518: 'Cook Islands', 520: 'Fiji', 523: 'Cocos Islands', 525: 'Indonesia', 529: 'Kiribati', 531: 'Laos', 533: 'Malaysia', 536: 'Northern Mariana Islands', 538: 'Marshall Islands', 540: 'New Caledonia', 542: 'Niue', 544: 'Nauru', 546: 'French Polynesia', 548: 'Philippines', 553: 'Papua New Guinea', 555: 'Pitcairn', 557: 'Solomon Islands', 559: 'American Samoa', 561: 'Samoa', 563: 'Singapore', 564: 'Singapore', 565: 'Singapore', 566: 'Singapore', 567: 'Thailand', 570: 'Tonga', 572: 'Tuvalu', 574: 'Vietnam', 576: 'Vanuatu', 577: 'Vanuatu', 578: 'Wallis and Futuna',
  601: 'South Africa', 603: 'Angola', 605: 'Algeria', 607: 'St Paul and Amsterdam Islands', 608: 'Ascension Island', 609: 'Burundi', 610: 'Benin', 611: 'Botswana', 612: 'Central African Republic', 613: 'Cameroon', 615: 'Congo', 616: 'Comoros', 617: 'Cabo Verde', 618: 'Crozet Archipelago', 619: "Côte d'Ivoire", 620: 'Comoros', 621: 'Djibouti', 622: 'Egypt', 624: 'Ethiopia', 625: 'Eritrea', 626: 'Gabon', 627: 'Ghana', 629: 'Gambia', 630: 'Guinea-Bissau', 631: 'Equatorial Guinea', 632: 'Guinea', 633: 'Burkina Faso', 634: 'Kenya', 635: 'Kerguelen Islands', 636: 'Liberia', 637: 'Liberia', 638: 'South Sudan', 642: 'Libya', 644: 'Lesotho', 645: 'Mauritius', 647: 'Madagascar', 649: 'Mali', 650: 'Mozambique', 654: 'Mauritania', 655: 'Malawi', 656: 'Niger', 657: 'Nigeria', 659: 'Namibia', 660: 'Réunion', 661: 'Rwanda', 662: 'Sudan', 663: 'Senegal', 664: 'Seychelles', 665: 'St Helena', 666: 'Somalia', 667: 'Sierra Leone', 668: 'São Tomé and Príncipe', 669: 'Eswatini', 670: 'Chad', 671: 'Togo', 672: 'Tunisia', 674: 'Tanzania', 675: 'Uganda', 676: 'DR Congo', 677: 'Tanzania', 678: 'Zambia', 679: 'Zimbabwe',
  701: 'Argentina', 710: 'Brazil', 720: 'Bolivia', 725: 'Chile', 730: 'Colombia', 735: 'Ecuador', 740: 'Falkland Islands', 745: 'French Guiana', 750: 'Guyana', 755: 'Paraguay', 760: 'Peru', 765: 'Suriname', 770: 'Uruguay', 775: 'Venezuela',
}

export function flagFromMmsi(mmsi: string): string | undefined { return MID[mmsi.slice(0, 3)] }

/** AIS ship-type code (message 5) → plain label. */
export function shipTypeLabel(t?: number): string | undefined {
  if (t == null || t <= 0) return undefined
  if (t >= 70 && t <= 79) return 'Cargo ship'
  if (t >= 80 && t <= 89) return 'Tanker'
  if (t >= 60 && t <= 69) return 'Passenger ship'
  if (t >= 40 && t <= 49) return 'High-speed craft'
  if (t >= 20 && t <= 29) return 'Wing-in-ground craft'
  if (t >= 90 && t <= 99) return 'Other vessel'
  const map: Record<number, string> = { 30: 'Fishing vessel', 31: 'Tug (towing)', 32: 'Tug (large tow)', 33: 'Dredger / underwater ops', 34: 'Diving support', 35: 'Military vessel', 36: 'Sailing vessel', 37: 'Pleasure craft', 50: 'Pilot vessel', 51: 'Search & rescue', 52: 'Tug', 53: 'Port tender', 54: 'Anti-pollution vessel', 55: 'Law enforcement', 58: 'Medical transport', 59: 'Non-combatant ship' }
  return map[t] ?? 'Vessel'
}

/** AIS navigational status code → label. */
export function navStatusLabel(s?: number): string | undefined {
  if (s == null) return undefined
  const map: Record<number, string> = { 0: 'Under way (engine)', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Fishing', 8: 'Under way (sailing)', 11: 'Towing astern', 12: 'Pushing ahead', 14: 'AIS-SART / emergency' }
  return map[s]
}

/** AIS ETA is month/day/hour/minute with no year; pick the nearest future occurrence. */
export function formatEta(eta?: { month: number; day: number; hour: number; minute: number }): string | undefined {
  if (!eta || !eta.month || !eta.day || eta.month > 12 || eta.day > 31) return undefined
  const now = new Date()
  let d = new Date(Date.UTC(now.getUTCFullYear(), eta.month - 1, eta.day, eta.hour === 24 ? 0 : eta.hour, eta.minute === 60 ? 0 : eta.minute))
  if (d.getTime() < now.getTime() - 30 * 86400000) d = new Date(Date.UTC(now.getUTCFullYear() + 1, eta.month - 1, eta.day, eta.hour, eta.minute))
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: eta.hour < 24 ? 'numeric' : undefined, minute: eta.hour < 24 ? '2-digit' : undefined, timeZone: 'UTC' }) + ' UTC'
}

/** Compass point for a course/heading in degrees. */
export function compass(deg?: number): string | undefined {
  if (deg == null || !Number.isFinite(deg)) return undefined
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return pts[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}
