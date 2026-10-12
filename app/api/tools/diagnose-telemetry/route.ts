import { agentTool, methodNotAllowed } from '@/lib/http'
import { telemetryTool } from '@/lib/tools/telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = agentTool(telemetryTool)
export const GET = () => methodNotAllowed()
