import { defineConfig } from 'tsup'

export default defineConfig({
  // Two entries from one config so the `clean` step runs exactly once (no race):
  //  - index.ts → the stdio CLI (bin), run directly by MCP clients
  //  - tools.ts → the importable tool factory, consumed by the API's HTTP endpoint
  entry: ['src/index.ts', 'src/tools.ts'],
  format: ['cjs', 'esm'],
  clean: true,
  dts: true,
  // Shebang makes index.js runnable as a CLI. Node strips the leading `#!`
  // from any module it loads, so it's inert when tools.js is required/imported.
  banner: {
    js: '#!/usr/bin/env node',
  },
})
