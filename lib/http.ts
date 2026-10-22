/** App Router glue: auth guard + JSON parsing + ToolResult -> Response. */
import { NextResponse } from 'next/server'
import { checkAgentRequest, getClientIp } from './auth'
import type { ToolContext, ToolResult } from './tools/types'

const MAX_BODY_BYTES = 16 * 1024

export function toResponse(result: ToolResult): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store', ...(result.headers ?? {}) },
  })
}

export function methodNotAllowed(allow = 'POST'): NextResponse {
  return NextResponse.json({ success: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: allow, 'Cache-Control': 'no-store' } })
}

/** Rejects unless the request carries a valid X-DCP-Agent-Secret. */
export function guard(req: Request, methods: string[] = ['POST']): NextResponse | null {
  const result = checkAgentRequest(req, { methods })
  if (!result) return null
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (result.status === 405) headers.Allow = methods.join(', ')
  return NextResponse.json({ success: false, error: result.error }, { status: result.status, headers })
}

function tooLarge(): NextResponse {
  return NextResponse.json({ success: false, error: 'Request too large' }, { status: 413 })
}

/** Reads the body as bytes, rejecting anything over MAX_BODY_BYTES before buffering it all. */
async function readLimited(req: Request): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  const declared = req.headers.get('content-length')
  if (declared !== null && (/^\d+$/.test(declared) ? Number(declared) > MAX_BODY_BYTES : true)) {
    return { ok: false, response: tooLarge() }
  }
  const reader = req.body?.getReader()
  if (!reader) return { ok: true, text: '' }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      return { ok: false, response: tooLarge() }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) }
}

export async function readJson(req: Request): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  const body = await readLimited(req)
  if (!body.ok) return body
  try {
    return { ok: true, data: body.text ? JSON.parse(body.text) : {} }
  } catch {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }) }
  }
}

/** Standard authenticated POST tool handler. */
export function agentTool(run: (input: unknown, ctx: ToolContext) => Promise<ToolResult> | ToolResult) {
  return async function POST(req: Request): Promise<NextResponse> {
    const denied = guard(req)
    if (denied) return denied
    const body = await readJson(req)
    if (!body.ok) return body.response
    return toResponse(await run(body.data, { clientIp: getClientIp(req.headers) }))
  }
}
