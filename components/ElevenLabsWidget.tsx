'use client'

import Script from 'next/script'

interface ElevenLabsWidgetProps {
  agentId?: string
}

export default function ElevenLabsWidget({ agentId }: ElevenLabsWidgetProps) {
  const effectiveAgentId = agentId || process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID

  if (!effectiveAgentId) {
    return (
      <div className="card" style={{ borderLeft: '4px solid #D4AF37', background: '#faf9f5' }}>
        <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🎙️</span> ElevenLabs Voice Intake Agent (&ldquo;Virtual Ryan&rdquo;)
        </h3>
        <p className="muted" style={{ margin: '0 0 0.5rem 0' }}>
          Connect live conversational voice triage by adding <code>NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> to your environment variables.
        </p>
      </div>
    )
  }

  return (
    <>
      <Script
        src="https://elevenlabs.io/convai-widget/index.js"
        strategy="lazyOnload"
      />
      {/* ElevenLabs Conversational AI Web Component */}
      {/* @ts-expect-error Custom element from ElevenLabs script */}
      <elevenlabs-convai agent-id={effectiveAgentId}></elevenlabs-convai>
    </>
  )
}
