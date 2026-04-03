/**
 * Unit tests for the Nerf MCP server stub.
 *
 * Verifies that the server initializes correctly and returns
 * an empty tool list as expected for the initial scaffold.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function createServer(): Server {
  const server = new Server(
    { name: "nerf-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [
      { type: "text", text: `Unknown tool: ${request.params.name}` },
    ],
    isError: true,
  }));

  return server;
}

describe("nerf server", () => {
  let server: Server;
  let client: Client;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connectPair() {
    server = createServer();
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  test("server starts without error", async () => {
    await connectPair();
    expect(server).toBeDefined();
    expect(client).toBeDefined();
  });

  test("list tools returns empty", async () => {
    await connectPair();
    const result = await client.listTools();
    expect(result.tools).toEqual([]);
  });
});
