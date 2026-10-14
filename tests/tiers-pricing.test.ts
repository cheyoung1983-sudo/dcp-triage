import { describe, expect, it } from 'vitest'
import { classifySymptoms, tierForRepairType, REPAIR_TYPE_LIST } from '@/lib/tiers'
import { calculateV4Quote, repairPriceFromPartCost, Tier3NotQuotableError, MOBILE_TRIP_FEE } from '@/lib/pricing'
import { TRIAGE_DECISION_TREE } from '@/lib/diagnostics/decision-tree'

describe('tier classification', () => {
  it.each([
    ['battery drains really fast', 'TIER_1'],
    ['charging port is loose, cable falls out', 'TIER_1'],
    ['screen is cracked and has lines', 'TIER_2'],
    ['ghost touch and dead zones on the display', 'TIER_2'],
    ['dropped it in the pool', 'TIER_3'],
    ["phone won't turn on at all", 'TIER_3'],
    ['logic board needs micro soldering', 'TIER_3'],
    ['cracked screen after it fell in water', 'TIER_3'],
    ['need data recovery for photos', 'TIER_3'],
  ])('%s -> %s', (text, tier) => {
    expect(classifySymptoms(text).tier).toBe(tier)
  })

  it('routes unknown descriptions to Tier 3 (human) rather than guessing', () => {
    const c = classifySymptoms('it is acting weird')
    expect(c.tier).toBe('TIER_3')
    expect(c.confidence).toBe('low')
    expect(c.quotable).toBe(false)
  })

  it('maps every repair type to exactly one of the three tiers', () => {
    for (const t of REPAIR_TYPE_LIST) expect(['TIER_1', 'TIER_2', 'TIER_3']).toContain(tierForRepairType(t))
    expect(tierForRepairType('liquid_damage')).toBe('TIER_3')
    expect(tierForRepairType('no_power')).toBe('TIER_3')
    expect(tierForRepairType('screen_oem')).toBe('TIER_2')
    expect(tierForRepairType('charging_port')).toBe('TIER_1')
  })

  it('gives every decision-tree result a tier', () => {
    for (const node of Object.values(TRIAGE_DECISION_TREE)) {
      for (const o of node.options) if (o.result) expect(o.tier).toMatch(/^TIER_[123]$/)
    }
  })
})

describe('V4 pricing engine', () => {
  it('is part x 1.8 + $75, rounded up to whole dollars', () => {
    expect(repairPriceFromPartCost(50)).toBe(165) // 90 + 75
    expect(repairPriceFromPartCost(17.76)).toBe(107) // 31.968 + 75 = 106.968 -> 107
    expect(repairPriceFromPartCost(10.01)).toBe(94) // 18.018 + 75 = 93.018 -> 94
    expect(repairPriceFromPartCost(0)).toBe(75)
  })

  it('does not round up exact dollar amounts because of float error', () => {
    expect(repairPriceFromPartCost(5)).toBe(84) // 9 + 75 exactly
    expect(repairPriceFromPartCost(0.5)).toBe(76) // 0.9 + 75 = 75.9 -> 76
  })

  it('adds the $25 trip fee as a separate line only for mobile service', () => {
    const shop = calculateV4Quote({ tier: 'TIER_2', partCost: 50, mobile: false })
    expect(shop).toMatchObject({ repairPrice: 165, tripFee: 0, total: 165 })
    expect(shop.lines).toHaveLength(1)
    const mobile = calculateV4Quote({ tier: 'TIER_2', partCost: 50, mobile: true })
    expect(mobile).toMatchObject({ repairPrice: 165, tripFee: MOBILE_TRIP_FEE, total: 190 })
    expect(mobile.lines).toEqual([
      { label: 'Repair (parts and labor)', amount: 165 },
      { label: 'Mobile trip fee', amount: 25 },
    ])
  })

  it('refuses Tier 3', () => {
    expect(() => calculateV4Quote({ tier: 'TIER_3', partCost: 10, mobile: false })).toThrow(Tier3NotQuotableError)
  })

  it('rejects negative or non-numeric part costs', () => {
    expect(() => repairPriceFromPartCost(-1)).toThrow(RangeError)
    expect(() => repairPriceFromPartCost(Number.NaN)).toThrow(RangeError)
  })
})
