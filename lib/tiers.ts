/**
 * The ONE tier system for Display & Cell Pros triage.
 *
 *   Tier 1  power / port   (battery, charging port)            -> quotable
 *   Tier 2  display        (screen, plus camera/back glass)     -> quotable
 *   Tier 3  board / liquid / no-power / data recovery          -> escalate to Ryan, NEVER a binding quote
 *
 * Replaces the TIER_1_POWER / TIER_1_POWER_PORT_REFRESH / 'Tier 1 (Power/Port Refresh)'
 * variants from rev5, portalRev2 and PR #45, and drops the rev5 "Tier 4".
 */
export const TIERS = {
  TIER_1: { id: 'TIER_1', number: 1, label: 'Tier 1', name: 'Power & port', quotable: true },
  TIER_2: { id: 'TIER_2', number: 2, label: 'Tier 2', name: 'Display', quotable: true },
  TIER_3: { id: 'TIER_3', number: 3, label: 'Tier 3', name: 'Board, liquid & no-power', quotable: false },
} as const

export type TierId = keyof typeof TIERS

export const REPAIR_TYPES = {
  battery: 'TIER_1',
  charging_port: 'TIER_1',
  screen_aftermarket: 'TIER_2',
  screen_oem: 'TIER_2',
  camera: 'TIER_2',
  back_glass: 'TIER_2',
  logic_board: 'TIER_3',
  motherboard: 'TIER_3',
  micro_soldering: 'TIER_3',
  liquid_damage: 'TIER_3',
  water_damage: 'TIER_3',
  data_recovery: 'TIER_3',
  no_power: 'TIER_3',
} as const satisfies Record<string, TierId>

export type RepairType = keyof typeof REPAIR_TYPES
export const REPAIR_TYPE_LIST = Object.keys(REPAIR_TYPES) as [RepairType, ...RepairType[]]

export function tierForRepairType(repairType: RepairType): TierId {
  return REPAIR_TYPES[repairType]
}

export function isQuotable(tier: TierId): boolean {
  return TIERS[tier].quotable
}

// Order matters: Tier 3 signals win over anything else in the same description.
const TIER3_PATTERNS: RegExp[] = [
  /\b(logic|mother)\s*board\b/,
  /\bboard\b/,
  /\bmicro[-\s]?solder/,
  /\b(liquid|water|wet|spill(ed)?|drop(ped)? (it )?in|submerged|coffee|soda|toilet|pool|rain)\b/,
  /\bcorro(sion|ded)\b/,
  /\bno power\b/,
  /\b(won'?t|will not|doesn'?t|does not|can'?t|cannot) (turn|power|boot|switch) on\b/,
  /\bdead\b(?! zones?)/,
  /\bshort(ed)?\b/,
  /\bdata recovery\b|\brecover (my )?(photos|data|files)\b/,
  /\bboot ?loop\b/,
  /\bno (charging icon|response)\b/,
]

const TIER2_PATTERNS: RegExp[] = [
  /\b(screen|display|lcd|oled|digitizer|glass)\b/,
  /\b(crack(ed)?|shatter(ed)?|lines|flicker(ing)?|ghost touch|dead zones?|black screen|ink|touch)\b/,
  /\b(camera|back glass)\b/,
]

const TIER1_PATTERNS: RegExp[] = [
  /\bbatter(y|ies)\b/,
  /\b(charg(e|ing|er)|port|lightning|usb-?c|cable)\b/,
  /\b(drain(s|ing)?|dies fast|swollen|shuts? (down|off))\b/,
]

export interface TierClassification {
  tier: TierId
  label: string
  name: string
  quotable: boolean
  requiresEscalation: boolean
  matchedSignals: string[]
  confidence: 'high' | 'medium' | 'low'
}

/** Keyword classifier for free-text symptom descriptions (voice or web). */
export function classifySymptoms(description: string): TierClassification {
  const text = (description || '').toLowerCase()
  const hits = (patterns: RegExp[]) =>
    patterns.map((p) => text.match(p)?.[0]).filter((m): m is string => Boolean(m))

  const t3 = hits(TIER3_PATTERNS)
  const t2 = hits(TIER2_PATTERNS)
  const t1 = hits(TIER1_PATTERNS)

  let tier: TierId
  let matched: string[]
  if (t3.length) {
    tier = 'TIER_3'
    matched = t3
  } else if (t2.length) {
    tier = 'TIER_2'
    matched = t2
  } else if (t1.length) {
    tier = 'TIER_1'
    matched = t1
  } else {
    // Unknown: route to a human rather than guess a price.
    tier = 'TIER_3'
    matched = []
  }

  const info = TIERS[tier]
  return {
    tier,
    label: info.label,
    name: info.name,
    quotable: info.quotable,
    requiresEscalation: !info.quotable,
    matchedSignals: [...new Set(matched)],
    confidence: matched.length >= 2 ? 'high' : matched.length === 1 ? 'medium' : 'low',
  }
}
