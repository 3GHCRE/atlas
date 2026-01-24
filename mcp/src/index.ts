#!/usr/bin/env node
/**
 * 3GHCRE Atlas MCP Server
 *
 * Provides tools for querying and navigating the SNF ownership database.
 * Implements the Model Context Protocol for Claude Desktop integration.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getToolDefinitions, executeTool } from './tools/index.js';
import { testConnection, closePool } from './database/connection.js';

// Create server instance
const server = new Server(
  {
    name: '3ghcre-atlas',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handler: List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: getToolDefinitions(),
  };
});

// Handler: Execute a tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Execute the requested tool
  const result = await executeTool(name, args || {});

  return result;
});

// Main entry point
async function main() {
  // Test database connectivity
  const connected = await testConnection();
  if (!connected) {
    console.error('Failed to connect to Atlas database');
    process.exit(1);
  }

  // Start the MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await closePool();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await closePool();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
