import { agentTool, methodNotAllowed } from '@/lib/http'
import { complianceTool } from '@/lib/tools/compliance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = agentTool(complianceTool)
export const GET = () => methodNotAllowed()
