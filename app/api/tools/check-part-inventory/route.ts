import { agentTool, methodNotAllowed } from '@/lib/http'
import { inventoryTool } from '@/lib/tools/inventory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const POST = agentTool(inventoryTool)
export const GET = () => methodNotAllowed()
