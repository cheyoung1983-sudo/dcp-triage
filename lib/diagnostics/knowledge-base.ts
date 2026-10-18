/**
 * Local-first retrieval for Smart Triage (ported from rev5 triageKnowledgeBase.ts).
 * Keyword overlap against the supported-devices catalog; no LLM, no network.
 * Changes from rev5: maps to the single 3-tier system, and never surfaces
 * donor-board stock claims to customers.
 */
import { SUPPORTED_DEVICES_DATABASE, type BoardRepairCapability, type SupportedDeviceModel } from '../data/supported-devices'
import type { TierId } from '../tiers'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'of',
  'in', 'on', 'at', 'it', 'my', 'me', 'i', 'with', 'for', 'this', 'that', 'has',
  'have', 'had', 'be', 'been', 'not', 'no', 'when', 'while', 'still', 'just',
])

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

/** Model tokens keep short numbers ("13", "s24") that tokenize() drops. */
export function modelTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOPWORDS.has(t))
}

/**
 * Scores how well the customer's model text matches a catalog model. When the
 * customer names a model number (e.g. "iphone 13"), only catalog models with that
 * number get the strong boost; the same family with a different number gets a
 * small one, so "iPhone 13" no longer ranks iPhone 15 Pro first.
 */
export function modelScore(query: string, modelName: string): number {
  const q = new Set(modelTokens(query))
  if (!q.size) return 0
  const m = modelTokens(modelName)
  const qNums = [...q].filter((t) => /\d/.test(t))
  const mNums = m.filter((t) => /\d/.test(t))
  const words = m.filter((t) => !/\d/.test(t) && t.length > 2)
  const familyHit = words.some((t) => q.has(t))
  if (qNums.length && mNums.length) {
    if (mNums.some((t) => q.has(t))) return familyHit || !words.length ? 8 : 5
    return familyHit ? 1 : 0
  }
  return familyHit ? 5 : 0
}

export interface DeviceMatch {
  device: SupportedDeviceModel
  matchedSymptoms: string[]
  bestRepair: BoardRepairCapability
  score: number
}

export function findMatchingDevices(deviceModel: string, symptomDescription: string, limit = 3): DeviceMatch[] {
  const queryTokens = tokenize(symptomDescription)
  const matches: DeviceMatch[] = []
  for (const device of SUPPORTED_DEVICES_DATABASE) {
    let score = 0
    const matchedSymptoms: string[] = []
    score += modelScore(deviceModel, device.modelName)
    for (const symptom of device.commonSymptoms) {
      const overlap = tokenize(symptom).filter((t) => queryTokens.includes(t)).length
      if (overlap > 0) {
        score += overlap
        matchedSymptoms.push(symptom)
      }
    }
    if (score > 0 && device.supportedRepairs.length > 0) {
      const bestRepair = [...device.supportedRepairs].sort((a, b) => b.typicalSuccessRate - a.typicalSuccessRate)[0]
      matches.push({ device, matchedSymptoms, bestRepair, score })
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function tierForBoardRepair(repairTier: BoardRepairCapability['tier']): TierId {
  return repairTier === 'Port & FPC Rework' ? 'TIER_1' : 'TIER_3'
}
