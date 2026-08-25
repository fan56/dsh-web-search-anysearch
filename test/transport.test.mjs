/**
 * Transport tests against a real local HTTP server: JSON-RPC success paths,
 * error surfaces, timeout, and the seam's cancellation contract.
 */
import { strict as assert } from 'node:assert'
import http from 'node:http'
import test from 'node:test'
import { WebError } from '@deepseek-ai/dsh-web'
import { callAnysearchTool } from '../lib/transport.js'

let server
let handler
let lastRequest

test.before(async () => {
  server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      lastRequest = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
      handler(req, res)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
})

test.after(async () => {
  await new Promise(resolve => server.close(resolve))
})

const endpoint = () => `http://127.0.0.1:${server.address().port}/mcp`
const jsonResponse = (res, status, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}
const ok = text => (req, res) => jsonResponse(res, 200, { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } })

test('sends a stateless tools/call with optional Bearer auth', async () => {
  handler = ok('hello')
  const withKey = await callAnysearchTool('search', { query: 'q' }, { endpoint: endpoint(), apiKey: 'k1', timeoutMs: 2000 })
  const anonymous = await callAnysearchTool('search', { query: 'q' }, { endpoint: endpoint(), timeoutMs: 2000 })
  assert.equal(withKey, 'hello')
  assert.equal(anonymous, 'hello')
  const body = JSON.parse(lastRequest.body)
  assert.deepEqual(
    { jsonrpc: body.jsonrpc, id: body.id, method: body.method, name: body.params.name, args: body.params.arguments },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', name: 'search', args: { query: 'q' } },
  )
  // Authorization presence tracks the key argument exactly.
  await callAnysearchTool('search', { query: 'q' }, { endpoint: endpoint(), apiKey: 'k1', timeoutMs: 2000 })
  assert.equal(lastRequest.headers.authorization, 'Bearer k1')
  await callAnysearchTool('search', { query: 'q' }, { endpoint: endpoint(), timeoutMs: 2000 })
  assert.equal('authorization' in lastRequest.headers, false)
})

test('surfaces JSON-RPC errors and isError results as WEB_PROVIDER_ERROR', async () => {
  handler = (req, res) => jsonResponse(res, 200, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'quota exceeded' } })
  await assert.rejects(
    callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 2000 }),
    (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_ERROR' && e.message.includes('quota exceeded'),
  )
  handler = (req, res) => jsonResponse(res, 200, { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'tool blew up' }] } })
  await assert.rejects(
    callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 2000 }),
    (e) => e.code === 'WEB_PROVIDER_ERROR' && e.message.includes('tool blew up'),
  )
})

test('keeps the HTTP status and body excerpt on non-2xx responses', async () => {
  handler = (req, res) => jsonResponse(res, 429, { error: { message: 'rate limited' } })
  await assert.rejects(
    callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 2000 }),
    (e) => e.code === 'WEB_PROVIDER_ERROR' && e.message.includes('429') && e.message.includes('rate limited'),
  )
})

test('rejects a non-JSON body as WEB_PROVIDER_ERROR', async () => {
  handler = (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html>gateway error page</html>')
  }
  await assert.rejects(
    callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 2000 }),
    (e) => e.code === 'WEB_PROVIDER_ERROR' && e.message.includes('unprocessable'),
  )
})

test('times out per the configured budget', async () => {
  handler = (req, res) => setTimeout(() => jsonResponse(res, 200, { result: {} }), 300)
  await assert.rejects(
    callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 50 }),
    (e) => e.code === 'WEB_PROVIDER_ERROR' && e.message.includes('timed out'),
  )
})

test('honors the abort signal before and during the call', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 2000, signal: controller.signal }),
    (e) => e instanceof WebError && e.code === 'WEB_ABORTED',
  )

  handler = (req, res) => setTimeout(() => jsonResponse(res, 200, {}), 300)
  const pending = callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 2000, signal: controller.signal })
  // fresh controller: abort mid-flight
  const c2 = new AbortController()
  const inFlight = callAnysearchTool('search', {}, { endpoint: endpoint(), timeoutMs: 2000, signal: c2.signal })
  c2.abort()
  await assert.rejects(inFlight, (e) => e.code === 'WEB_ABORTED')
  await pending.then(
    () => assert.fail('pre-aborted call must reject'),
    (e) => assert.equal(e.code, 'WEB_ABORTED'),
  )
})
