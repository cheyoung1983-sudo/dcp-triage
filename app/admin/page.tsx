import type { Metadata } from 'next'
import { getAuth0, isStaff } from '@/lib/auth0'
import { listTicketsTool } from '@/lib/tools/tickets'
import type { Ticket } from '@/lib/store/types'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Staff - recent tickets', robots: { index: false, follow: false } }

/** Staff-only view of recent triage tickets. proxy.ts gates /admin; this re-checks server-side (defense in depth). */
export default async function AdminPage() {
  const auth0 = getAuth0()
  const session = auth0 ? await auth0.getSession() : null
  if (!auth0 || !session || !isStaff(session.user)) {
    return <main style={{ padding: 24 }}><h1>Not authorized</h1></main>
  }

  const result = await listTicketsTool('50')
  const body = result.body as { success: boolean; store?: string; tickets?: Ticket[]; error?: string }
  const tickets = body.tickets ?? []

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <h1>Recent tickets</h1>
        <p>
          Signed in as {session.user.email} · <a href="/auth/logout">Log out</a>
        </p>
      </header>
      {!body.success ? (
        <p role="alert">Ticket store unavailable: {body.error ?? 'not configured'}</p>
      ) : tickets.length === 0 ? (
        <p>No tickets yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <caption style={{ textAlign: 'left' }}>Last {tickets.length} tickets ({body.store})</caption>
          <thead>
            <tr>
              {['Created', 'ID', 'Status', 'Tier', 'Source', 'Device', 'Summary', 'Quote'].map((h) => (
                <th key={h} scope="col" style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td style={{ padding: 6 }}>{new Date(t.createdAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</td>
                <td style={{ padding: 6 }}><code>{t.id}</code></td>
                <td style={{ padding: 6 }}>{t.status}</td>
                <td style={{ padding: 6 }}>{t.tier}</td>
                <td style={{ padding: 6 }}>{t.source}</td>
                <td style={{ padding: 6 }}>{t.deviceModel}</td>
                <td style={{ padding: 6 }}>{t.summary}</td>
                <td style={{ padding: 6 }}>{t.quote ? `$${t.quote.total.toFixed(2)}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
