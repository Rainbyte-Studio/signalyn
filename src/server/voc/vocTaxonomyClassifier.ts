/**
 * Signalyn Voice of Customer — Phase 2 & Phase 3 Complaint Taxonomy Classifier,
 * Bilingual Sentiment Analyzer, PII Sanitizer, and Duplicate Hash Generator
 */

import crypto from 'crypto';
import {
  VocComplaintCategory,
  VocComplaintCategoryDescriptor,
  VocDuplicateMetadata,
  VocLanguage,
  VocSentiment,
} from '../../types/vocIntelligence';

export const VOC_TAXONOMY_VERSION = 'VOC-P1.0-taxonomy-v1';
export const MAX_VOC_EXCERPT_LENGTH = 280;

/**
 * Strips Greek diacritics (tonos/dialytika) and lowercases text for resilient bilingual matching.
 */
export function normalizeBilingualText(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export const VOC_COMPLAINT_TAXONOMY: VocComplaintCategoryDescriptor[] = [
  {
    id: 'BATTERY_DRAIN',
    labelEn: 'Battery drain',
    labelEl: 'Γρήγορη αποφόρτιση μπαταρίας',
    description:
      'Rapid battery depletion, abnormal standby power consumption, degraded battery health, or sudden percentage drops.',
    severityWeight: 4,
    isHardwareRelated: true,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'battery drain',
      'drains fast',
      'battery life',
      'battery health',
      'empty battery',
      'battery drops',
      'standby drain',
      'screen on time',
      'sot drop',
      'fast discharge',
    ],
    keywordsEl: [
      'μπαταρια',
      'αποφορτιση',
      'αδειαζει γρηγορα',
      'κραταει λιγο',
      'καταναλωση μπαταριας',
      'πεφτει η μπαταρια',
      'αυτονομια',
    ],
  },
  {
    id: 'OVERHEATING',
    labelEn: 'Overheating',
    labelEl: 'Υπερθέρμανση συσκευής',
    description:
      'Excessive thermal buildup during normal use, charging, camera recording, or background tasks, including thermal throttling warnings.',
    severityWeight: 5,
    isHardwareRelated: true,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'overheat',
      'overheating',
      'gets very hot',
      'getting hot',
      'thermal warning',
      'burning hot',
      'runs hot',
      'temperature warning',
      'too hot to hold',
    ],
    keywordsEl: [
      'υπερθερμανση',
      'ζεσταινεται',
      'καιει',
      'υψηλη θερμοκρασια',
      'θερμοκρασια συσκευης',
      'ζεστο τηλεφωνο',
    ],
  },
  {
    id: 'CHARGING_PROBLEMS',
    labelEn: 'Charging problems',
    labelEl: 'Προβλήματα φόρτισης',
    description:
      'SuperCharge / fast charging failures, intermittent USB-C port contact, wireless charging failure, or slow/stalled charging.',
    severityWeight: 4,
    isHardwareRelated: true,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'not charging',
      'wont charge',
      "won't charge",
      'charging problem',
      'slow charging',
      'supercharge not working',
      'fast charge failed',
      'charging port',
      'wireless charging issue',
      'stops charging',
    ],
    keywordsEl: [
      'δεν φορτιζει',
      'προβλημα φορτισης',
      'αργη φορτιση',
      'θυρα φορτισης',
      'φορτιστης',
      'σταματαει να φορτιζει',
    ],
  },
  {
    id: 'DISPLAY_DEFECTS',
    labelEn: 'Display defects',
    labelEl: 'Ελαττώματα οθόνης',
    description:
      'Green/pink OLED lines, screen flickering, burn-in, dead pixels, unresponsive touch digitizer, or foldable hinge crease damage.',
    severityWeight: 5,
    isHardwareRelated: true,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'green line',
      'pink line',
      'screen flicker',
      'display defect',
      'dead pixel',
      'screen burn',
      'burn-in',
      'touch not working',
      'unresponsive screen',
      'black screen',
      'display issue',
    ],
    keywordsEl: [
      'οθονη',
      'πρασινη γραμμη',
      'τρεμοπαιζει η οθονη',
      'καμενα πιξελ',
      'δεν πατιεται η οθονη',
      'μαυρη οθονη',
      'αφη δεν λειτουργει',
    ],
  },
  {
    id: 'CAMERA_ISSUES',
    labelEn: 'Camera issues',
    labelEl: 'Προβλήματα κάμερας',
    description:
      'Autofocus hunting, blurry photos, OIS mechanical rattle, camera app crashes, lens condensation, or video stutter.',
    severityWeight: 3,
    isHardwareRelated: true,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'camera blurry',
      'camera focus',
      'autofocus issue',
      'camera crash',
      'lens fog',
      'camera quality',
      'video stutter',
      'ois rattle',
      'camera problem',
      'camera freeze',
    ],
    keywordsEl: [
      'καμερα',
      'θολες φωτογραφιες',
      'εστιαση καμερας',
      'προβλημα καμερας',
      'φακος',
      'κολλαει η καμερα',
    ],
  },
  {
    id: 'CONNECTIVITY_PROBLEMS',
    labelEn: 'Connectivity problems',
    labelEl: 'Προβλήματα συνδεσιμότητας & δικτύου',
    description:
      '5G/4G cellular signal drops, SIM card not detected, VoLTE/call drops, GPS accuracy drift, or NFC payment failures.',
    severityWeight: 4,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'no signal',
      'signal drop',
      'mobile network',
      '5g problem',
      '4g drop',
      'sim not detected',
      'call dropped',
      'gps inaccurate',
      'nfc not working',
      'connectivity issue',
    ],
    keywordsEl: [
      'σημα δικτυου',
      'χανει το σημα',
      'δεν εχει σημα',
      'προβλημα συνδεσιμοτητας',
      'καρτα sim',
      'διακοπες κλησεων',
      'προβλημα 5g',
    ],
  },
  {
    id: 'BLUETOOTH_PROBLEMS',
    labelEn: 'Bluetooth problems',
    labelEl: 'Προβλήματα Bluetooth',
    description:
      'Bluetooth pairing failures, audio dropouts with earbuds/watches, car infotainment disconnections, or codec stutter.',
    severityWeight: 3,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'bluetooth disconnect',
      'bluetooth pairing',
      'bluetooth issue',
      'bluetooth problem',
      'earbuds disconnect',
      'watch disconnect',
      'bluetooth audio stutter',
      'cannot pair bluetooth',
    ],
    keywordsEl: [
      'μπλουτουθ',
      'αποσυνδεεται το bluetooth',
      'προβλημα bluetooth',
      'δεν συνδεεται με ακουστικα',
      'αποσυνδεση ρολογιου',
    ],
  },
  {
    id: 'WIFI_ISSUES',
    labelEn: 'Wi-Fi issues',
    labelEl: 'Προβλήματα Wi-Fi',
    description:
      'Frequent Wi-Fi disconnections, weak Wi-Fi reception, 5GHz/6GHz band drop, or "connected without internet" states.',
    severityWeight: 3,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'wifi disconnect',
      'wi-fi issue',
      'wifi problem',
      'wifi drops',
      'slow wifi',
      'wi-fi keeps disconnecting',
      'weak wifi',
      'no internet on wifi',
    ],
    keywordsEl: [
      'αποσυνδεση wifi',
      'αποσυνδεεται το wifi',
      'αποσυνδεεται απο το wifi',
      'διακοπες wifi',
      'προβλημα wifi',
      'αργο wifi',
      'χανει το wifi',
      'δεν συνδεεται στο wifi',
    ],
  },
  {
    id: 'SOFTWARE_BUGS',
    labelEn: 'Software bugs',
    labelEl: 'Σφάλματα λογισμικού (Software bugs)',
    description:
      'OS UI glitches, delayed push notifications, aggressive background app killing, lockscreen bugs, or system crashes.',
    severityWeight: 3,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: true,
    keywordsEn: [
      'software bug',
      'ui glitch',
      'notifications delayed',
      'push notification issue',
      'system ui not responding',
      'emui bug',
      'harmonyos bug',
      'app closes in background',
    ],
    keywordsEl: [
      'σφαλμα λογισμικου',
      'προβλημα ειδοποιησεων',
      'δεν ερχονται ειδοποιησεις',
      'κολλαει το μενου',
      'σφαλμα συστηματος',
    ],
  },
  {
    id: 'FIRMWARE_UPDATE_PROBLEMS',
    labelEn: 'Firmware update problems',
    labelEl: 'Προβλήματα αναβάθμισης firmware / OS',
    description:
      'Regressions introduced after an EMUI / HarmonyOS / iOS / One UI OTA update, failed OTA installation, or missing security patch.',
    severityWeight: 4,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: true,
    keywordsEn: [
      'after update',
      'firmware update',
      'ota update failed',
      'since the last update',
      'update broke',
      'emui update',
      'harmonyos update',
      'software update issue',
      'stuck on update',
    ],
    keywordsEl: [
      'μετα την αναβαθμιση',
      'προβλημα αναβαθμισης',
      'ενημερωση λογισμικου',
      'χαλασε μετα το update',
      'κολλησε στην αναβαθμιση',
    ],
  },
  {
    id: 'PERFORMANCE_DEGRADATION',
    labelEn: 'Performance degradation',
    labelEl: 'Πτώση απόδοσης & κολλήματα',
    description:
      'System lag, frame drops, slow app launches, RAM management stutter, or progressive slowdown over time.',
    severityWeight: 3,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'very laggy',
      'stuttering',
      'frame drops',
      'performance drop',
      'slows down',
      'freezing',
      'system lag',
      'sluggish performance',
    ],
    keywordsEl: [
      'κολλαει πολυ',
      'αργο τηλεφωνο',
      'πτωση αποδοσης',
      'καθυστερηση',
      'λαγκαρει',
      'παγωνει',
    ],
  },
  {
    id: 'APP_COMPATIBILITY',
    labelEn: 'App compatibility',
    labelEl: 'Συμβατότητα εφαρμογών (GMS / AppGallery)',
    description:
      'Third-party app crashes, Google Mobile Services (GMS) / MicroG / GBox friction, banking app incompatibilities, or HMS Core errors.',
    severityWeight: 4,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: true,
    keywordsEn: [
      'app crash',
      'incompatible app',
      'gms issue',
      'google play services',
      'microg',
      'gbox',
      'banking app not working',
      'appgallery missing',
      'hms core error',
      'app wont open',
    ],
    keywordsEl: [
      'δεν ανοιγει η εφαρμογη',
      'συμβατοτητα εφαρμογων',
      'εφαρμογη τραπεζας',
      'υπηρεσιες google',
      'κρασαρει η εφαρμογη',
    ],
  },
  {
    id: 'DEVICE_RELIABILITY',
    labelEn: 'Device reliability',
    labelEl: 'Αξιοπιστία συσκευής & επανεκκινήσεις',
    description:
      'Sudden bootloops, random reboots, motherboard failure, unprompted shutdowns, or premature hardware failure.',
    severityWeight: 5,
    isHardwareRelated: true,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'bootloop',
      'random reboot',
      'keeps restarting',
      'sudden death',
      'motherboard failure',
      'brick',
      'bricked',
      'turns off randomly',
      'dead device',
    ],
    keywordsEl: [
      'επανεκκινησεις',
      'σβηνει μονο του',
      'δεν αναβει',
      'μητρικη πλακετα',
      'βλαβη συσκευης',
      'κολλησε στο λογοτυπο',
    ],
  },
  {
    id: 'REPAIR_WARRANTY_COMPLAINTS',
    labelEn: 'Repair and warranty complaints',
    labelEl: 'Παράπονα επισκευής & εγγύησης',
    description:
      'Warranty claim rejection, long service center turnaround times, spare part shortages, or disputed out-of-warranty charges.',
    severityWeight: 4,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'warranty denied',
      'warranty rejected',
      'repair delay',
      'service center',
      'out of warranty charge',
      'spare parts unavailable',
      'repair cost',
      'warranty claim',
    ],
    keywordsEl: [
      'εγγυηση',
      'εκτος εγγυησης',
      'καθυστερηση επισκευης',
      'σερβις',
      'ανταλλακτικα',
      'κοστος επισκευης',
    ],
  },
  {
    id: 'CUSTOMER_SUPPORT_EXPERIENCE',
    labelEn: 'Customer support experience',
    labelEl: 'Εμπειρία εξυπηρέτησης πελατών',
    description:
      'Unresponsive customer care, unhelpful support responses, communication breakdowns, or unresolved support tickets.',
    severityWeight: 3,
    isHardwareRelated: false,
    isSoftwareUpdateRelated: false,
    keywordsEn: [
      'customer support',
      'customer service',
      'no response from support',
      'unhelpful support',
      'support ticket',
      'worst support',
      'call center',
    ],
    keywordsEl: [
      'εξυπηρετηση πελατων',
      'καμια απαντηση',
      'απαραδεκτη εξυπηρετηση',
      'τηλεφωνικο κεντρο',
      'υποστηριξη πελατων',
    ],
  },
];

/**
 * Returns a copy of the 15-category VOC taxonomy.
 */
export function getVocComplaintTaxonomy(): VocComplaintCategoryDescriptor[] {
  return VOC_COMPLAINT_TAXONOMY.map((c) => ({
    ...c,
    keywordsEn: [...c.keywordsEn],
    keywordsEl: [...c.keywordsEl],
  }));
}

/**
 * Detects whether the text is primarily Greek (`el`), English (`en`), or `mixed`.
 */
export function detectVocLanguage(text: string): VocLanguage {
  const greekChars = (text.match(/[\u0370-\u03ff\u1f00-\u1fff]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;

  if (greekChars === 0 && latinChars === 0) return 'other';
  if (greekChars > 0 && latinChars > 0) {
    const ratio = greekChars / (greekChars + latinChars);
    if (ratio >= 0.25 && ratio <= 0.75) return 'mixed';
    return ratio > 0.75 ? 'el' : 'en';
  }
  return greekChars > 0 ? 'el' : 'en';
}

/**
 * Redacts PII (emails, phone numbers, social handles, user profile URLs, IMEI/serials)
 * and truncates the excerpt to MAX_VOC_EXCERPT_LENGTH (280 chars) for fair-use compliance.
 */
export function sanitizeVocExcerpt(rawText: string): {
  sanitizedExcerpt: string;
  piiRedacted: boolean;
  redactedItemsCount: number;
} {
  let text = (rawText || '').replace(/\s+/g, ' ').trim();
  let redactedCount = 0;

  // 1. Redact email addresses
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, () => {
    redactedCount++;
    return '[EMAIL_REDACTED]';
  });

  // 2. Redact user profile URLs (e.g. reddit.com/user/..., github.com/users/...)
  text = text.replace(
    /https?:\/\/(?:www\.)?(?:reddit\.com\/u(?:ser)?\/|github\.com\/|twitter\.com\/|x\.com\/|facebook\.com\/)[^\s,;)"]+/gi,
    () => {
      redactedCount++;
      return '[PROFILE_URL_REDACTED]';
    }
  );

  // 3. Redact @handles / u/usernames
  text = text.replace(/(?:^|\s)(?:@|\/?u\/)[a-zA-Z0-9_.-]{3,30}\b/g, (match) => {
    redactedCount++;
    const prefix = match.startsWith(' ') ? ' ' : '';
    return `${prefix}[USER_REDACTED]`;
  });

  // 4. Redact 15-digit IMEI numbers
  text = text.replace(/\b\d{15}\b/g, () => {
    redactedCount++;
    return '[IMEI_REDACTED]';
  });

  // 5. Redact Greek and international phone numbers (e.g., +30 69..., 69xxxxxxxx, 210xxxxxxx)
  text = text.replace(
    /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b|\b(?:69\d{8}|21\d{8})\b/g,
    () => {
      redactedCount++;
      return '[PHONE_REDACTED]';
    }
  );

  if (text.length > MAX_VOC_EXCERPT_LENGTH) {
    text = `${text.slice(0, MAX_VOC_EXCERPT_LENGTH - 3).trim()}...`;
  }

  return {
    sanitizedExcerpt: text,
    piiRedacted: redactedCount > 0,
    redactedItemsCount: redactedCount,
  };
}

/**
 * Classifies a complaint text into one or more of the 15 VOC complaint categories.
 * Supports both English and Greek (including tonic-stripped text).
 */
export function classifyVocComplaintCategories(text: string): {
  primaryCategory: VocComplaintCategory;
  categories: {
    category: VocComplaintCategory;
    labelEn: string;
    labelEl: string;
    confidence: number;
    matchedKeywords: string[];
  }[];
  overallConfidence: number;
} {
  const normalized = normalizeBilingualText(text);

  const matches: {
    category: VocComplaintCategory;
    labelEn: string;
    labelEl: string;
    confidence: number;
    matchedKeywords: string[];
    severityWeight: number;
  }[] = [];

  for (const desc of VOC_COMPLAINT_TAXONOMY) {
    const matchedKeywords: string[] = [];

    for (const kw of desc.keywordsEn) {
      const normKw = normalizeBilingualText(kw);
      if (normKw && normalized.includes(normKw)) {
        matchedKeywords.push(kw);
      }
    }

    for (const kwEl of desc.keywordsEl) {
      const normKwEl = normalizeBilingualText(kwEl);
      if (normKwEl && normalized.includes(normKwEl)) {
        matchedKeywords.push(kwEl);
      }
    }

    if (matchedKeywords.length > 0) {
      const confidence = Math.min(0.98, Number((0.68 + (matchedKeywords.length - 1) * 0.1).toFixed(2)));
      matches.push({
        category: desc.id,
        labelEn: desc.labelEn,
        labelEl: desc.labelEl,
        confidence,
        matchedKeywords,
        severityWeight: desc.severityWeight,
      });
    }
  }

  // Sort by matched keywords count desc, then severityWeight desc
  matches.sort((a, b) => {
    if (b.matchedKeywords.length !== a.matchedKeywords.length) {
      return b.matchedKeywords.length - a.matchedKeywords.length;
    }
    return b.severityWeight - a.severityWeight;
  });

  if (matches.length === 0) {
    const fallback = VOC_COMPLAINT_TAXONOMY.find((c) => c.id === 'SOFTWARE_BUGS')!;
    return {
      primaryCategory: 'SOFTWARE_BUGS',
      categories: [
        {
          category: 'SOFTWARE_BUGS',
          labelEn: fallback.labelEn,
          labelEl: fallback.labelEl,
          confidence: 0.35,
          matchedKeywords: [],
        },
      ],
      overallConfidence: 0.35,
    };
  }

  return {
    primaryCategory: matches[0].category,
    categories: matches.map(({ category, labelEn, labelEl, confidence, matchedKeywords }) => ({
      category,
      labelEn,
      labelEl,
      confidence,
      matchedKeywords,
    })),
    overallConfidence: matches[0].confidence,
  };
}

/**
 * Evaluates bilingual customer sentiment (NEGATIVE, MIXED, NEUTRAL, POSITIVE).
 */
export function analyzeVocSentiment(text: string): {
  sentiment: VocSentiment;
  sentimentScore: number;
} {
  const normalized = normalizeBilingualText(text);

  const negativeTerms = [
    'issue',
    'problem',
    'bug',
    'broken',
    'defect',
    'drain',
    'overheat',
    'crash',
    'worst',
    'terrible',
    'disappointed',
    'unusable',
    'fail',
    'failed',
    'lag',
    'freeze',
    'dead',
    'flicker',
    'stuck',
    'denied',
    'προβλημα',
    'βλαβη',
    'κολλαει',
    'κρασαρει',
    'αποσυνδεεται',
    'αποσυνδεση',
    'χαλασε',
    'απαραδεκτο',
    'κακη',
    'απογοητευση',
    'δεν λειτουργει',
    'δεν φορτιζει',
    'δεν ανοιγει',
    'επανεκκινησεις',
    'σβηνει',
    'υπερθερμανση',
    'σφαλμα',
  ];

  const positiveTerms = [
    'great',
    'excellent',
    'fixed',
    'resolved',
    'smooth',
    'perfect',
    'amazing',
    'satisfied',
    'love',
    'fast',
    'εξαιρετικο',
    'τελειο',
    'λυθηκε',
    'πολυ καλο',
    'ικανοποιημενος',
  ];

  let negCount = 0;
  let posCount = 0;

  for (const term of negativeTerms) {
    if (normalized.includes(normalizeBilingualText(term))) negCount++;
  }
  for (const term of positiveTerms) {
    if (normalized.includes(normalizeBilingualText(term))) posCount++;
  }

  if (negCount > 0 && posCount > 0) {
    const score = Number(Math.max(-0.8, Math.min(0.4, (posCount - negCount) * 0.2)).toFixed(2));
    return { sentiment: 'MIXED', sentimentScore: score };
  }
  if (negCount > 0) {
    const score = Number(Math.max(-0.95, -0.45 - Math.min(4, negCount) * 0.12).toFixed(2));
    return { sentiment: 'NEGATIVE', sentimentScore: score };
  }
  if (posCount > 0) {
    const score = Number(Math.min(0.95, 0.45 + Math.min(4, posCount) * 0.12).toFixed(2));
    return { sentiment: 'POSITIVE', sentimentScore: score };
  }

  return { sentiment: 'NEUTRAL', sentimentScore: 0 };
}

/**
 * Generates deterministic SHA-256 duplicate detection metadata for a customer report.
 */
export function computeVocDuplicateMetadata(params: {
  sourceId: string;
  sourceSpecificId: string;
  text: string;
  existingReports?: { id: string; normalizedTextHash: string; sourceExternalIdHash: string }[];
}): VocDuplicateMetadata {
  const exactTrimmed = (params.text || '').trim();
  const contentHash = crypto.createHash('sha256').update(exactTrimmed, 'utf8').digest('hex').slice(0, 32);

  // Strip URLs, user handles, numbers/timestamps, and punctuation for near-duplicate text fingerprinting
  const normalizedTokens = normalizeBilingualText(exactTrimmed)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\u0370-\u03ff\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .join(' ');

  const normalizedTextHash = crypto
    .createHash('sha256')
    .update(normalizedTokens || exactTrimmed, 'utf8')
    .digest('hex')
    .slice(0, 32);

  const sourceExternalIdHash = crypto
    .createHash('sha256')
    .update(`${params.sourceId}::${params.sourceSpecificId}`, 'utf8')
    .digest('hex')
    .slice(0, 24);

  let isDuplicate = false;
  let duplicateOfReportId: string | null = null;

  if (params.existingReports && params.existingReports.length > 0) {
    const match = params.existingReports.find(
      (r) =>
        r.sourceExternalIdHash === sourceExternalIdHash ||
        (normalizedTokens.length >= 12 && r.normalizedTextHash === normalizedTextHash)
    );
    if (match) {
      isDuplicate = true;
      duplicateOfReportId = match.id;
    }
  }

  return {
    contentHash,
    normalizedTextHash,
    sourceExternalIdHash,
    isDuplicate,
    duplicateOfReportId,
  };
}
