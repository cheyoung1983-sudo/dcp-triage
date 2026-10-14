import { guard, toResponse } from '@/lib/http'
import { getTicketTool } from '@/lib/tools/tickets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, ['GET'])
  if (denied) return denied
  const { id } = await params
  return toResponse(await getTicketTool(id))
}
