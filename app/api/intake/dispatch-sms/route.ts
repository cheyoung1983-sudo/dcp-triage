import { agentTool, methodNotAllowed } from '@/lib/http'
import { dispatchTool } from '@/lib/tools/dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = agentTool(dispatchTool)
export const GET = () => methodNotAllowed()
