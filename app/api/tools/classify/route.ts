import { agentTool, methodNotAllowed } from '@/lib/http'
import { classifyTool } from '@/lib/tools/classify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = agentTool(classifyTool)
export const GET = () => methodNotAllowed()
