import { agentTool, methodNotAllowed } from '@/lib/http'
import { quoteTool } from '@/lib/tools/quote'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = agentTool(quoteTool)
export const GET = () => methodNotAllowed()
