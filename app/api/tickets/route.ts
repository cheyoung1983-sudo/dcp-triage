import { guard, toResponse } from '@/lib/http'
import { listTicketsTool } from '@/lib/tools/tickets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const denied = guard(req, ['GET'])
  if (denied) return denied
  return toResponse(await listTicketsTool(new URL(req.url).searchParams.get('limit')))
}
