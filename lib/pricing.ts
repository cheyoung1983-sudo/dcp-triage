/**
 * The ONE pricing engine (V4).
 *
 *   repair price = ceil(part cost x 1.8 + $75 labor)      (whole dollars, rounded UP)
 *   mobile trip fee = $25, a separate line, only for mobile/on-site service
 *
 * Replaces rev5's `parts + hours*$55 + parts*0.95` and portalRev2's
 * `parts + 80% markup + $50/hr` formulas. Sales tax is not included.
 * Tier 3 is never priced here.
 */
import { isQuotable, type TierId } from './tiers'

export const PART_MULTIPLIER = 1.8
export const LABOR_FEE = 75
export const MOBILE_TRIP_FEE = 25

export interface V4Quote {
  repairPrice: number
  tripFee: number
  total: number
  lines: { label: string; amount: number }[]
  formula: string
}

export class Tier3NotQuotableError extends Error {
  constructor() {
    super('Tier 3 repairs are never given a binding quote; escalate instead.')
    this.name = 'Tier3NotQuotableError'
  }
}

/** Works in integer cents to avoid floating point surprises, then rounds up to whole dollars. */
export function repairPriceFromPartCost(partCost: number): number {
  if (!Number.isFinite(partCost) || partCost < 0) throw new RangeError('partCost must be a non-negative number')
  const partCents = Math.round(partCost * 100)
  const cents = Math.round(partCents * PART_MULTIPLIER) + LABOR_FEE * 100
  return Math.ceil(cents / 100)
}

export function calculateV4Quote(params: { tier: TierId; partCost: number; mobile: boolean }): V4Quote {
  if (!isQuotable(params.tier)) throw new Tier3NotQuotableError()
  const repairPrice = repairPriceFromPartCost(params.partCost)
  const tripFee = params.mobile ? MOBILE_TRIP_FEE : 0
  const lines = [{ label: 'Repair (parts and labor)', amount: repairPrice }]
  if (tripFee) lines.push({ label: 'Mobile trip fee', amount: tripFee })
  return {
    repairPrice,
    tripFee,
    total: repairPrice + tripFee,
    lines,
    formula: `ceil(part cost x ${PART_MULTIPLIER} + $${LABOR_FEE} labor)${tripFee ? ` + $${MOBILE_TRIP_FEE} trip fee` : ''}`,
  }
}
