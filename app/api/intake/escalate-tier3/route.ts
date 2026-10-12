import { agentTool, methodNotAllowed } from '@/lib/http'
import { escalateTool } from '@/lib/tools/escalate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = agentTool(escalateTool)
export const GET = () => methodNotAllowed()
