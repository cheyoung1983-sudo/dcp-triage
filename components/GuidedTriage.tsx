'use client'

/** Step-by-step questions from the dcptriage decision tree. */
import { useState } from 'react'
import { TRIAGE_DECISION_TREE, getStartQuestion, type HardwareComponent } from '@/lib/diagnostics/decision-tree'
import { TIERS, type TierId } from '@/lib/tiers'

export default function GuidedTriage() {
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ text: string; tier?: TierId } | null>(null)
  const node = nodeId ? TRIAGE_DECISION_TREE[nodeId] : null

  const start = (c: HardwareComponent) => {
    setOutcome(null)
    setNodeId(getStartQuestion(c).id)
  }

  return (
    <div className="card">
      <h2>Not sure how to describe it?</h2>
      <p>Pick what seems wrong and answer a few questions.</p>
      <div>
        {(['Screen', 'Battery', 'Button'] as HardwareComponent[]).map((c) => (
          <button key={c} type="button" className="secondary" onClick={() => start(c)}>{c}</button>
        ))}
      </div>
      {node && !outcome && (
        <div>
          <p><strong>{node.question}</strong></p>
          {node.options.map((o) => (
            <button
              key={o.label}
              type="button"
              className="secondary"
              onClick={() => (o.nextId ? setNodeId(o.nextId) : setOutcome({ text: o.result ?? '', tier: o.tier }))}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {outcome && (
        <div aria-live="polite">
          {outcome.tier && <p><span className="tier">{TIERS[outcome.tier].label}</span> {TIERS[outcome.tier].name}</p>}
          <p>{outcome.text}</p>
          {outcome.tier === 'TIER_3' && <p>This needs a technician to look at it before it can be priced.</p>}
        </div>
      )}
    </div>
  )
}
