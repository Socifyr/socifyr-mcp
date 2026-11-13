import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Socifyr } from '@socifyr/sdk'
import { registerAllTools } from './tools'

const API_KEY = process.env.SOCIFYR_API_KEY
const API_URL = process.env.SOCIFYR_API_URL

if (!API_KEY) {
  process.stderr.write('Error: SOCIFYR_API_KEY environment variable is required\n')
  process.exit(1)
}
if (process.env.SOCIFYR_WORKSPACE_ID) {
  process.stderr.write(
    'Note: SOCIFYR_WORKSPACE_ID is no longer needed and is ignored. The API key already belongs to one workspace.\n',
  )
}

// The API key belongs to exactly one workspace, so no workspace id is needed.
const client = new Socifyr({
  apiKey: API_KEY,
  apiUrl: API_URL,
})

const server = new McpServer({
  name: 'socifyr',
  version: '0.2.0',
})

registerAllTools(server, client)

// ── Start server ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('Socifyr MCP server running\n')
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
