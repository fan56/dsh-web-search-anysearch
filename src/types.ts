/**
 * Wire types for the AnySearch API (`POST https://api.anysearch.com/mcp`,
 * JSON-RPC 2.0 `tools/call`). Only the fields this provider consumes are
 * modeled; unknown fields are ignored by design.
 * @module @aiwayds/dsh-web-search-anysearch/types
 */

/** JSON-RPC 2.0 response envelope from the MCP endpoint. */
export interface JsonRpcResponse {
  readonly jsonrpc?: string
  readonly id?: number | string
  readonly result?: {
    /** MCP tool-result content blocks; the search payload is the `text` item. */
    readonly content?: readonly { readonly type?: string; readonly text?: string }[]
    /** MCP tool-execution failure flag; the `text` item carries the reason. */
    readonly isError?: boolean
  }
  readonly error?: {
    readonly code?: number
    readonly message?: string
  }
}
