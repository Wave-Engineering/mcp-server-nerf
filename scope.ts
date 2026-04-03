/**
 * nerf_scope tool handler (stub).
 *
 * Returns a helpful message about the planned terminal monitor feature.
 * Full implementation deferred — scope requires terminal detection and
 * process spawning that is complex enough to warrant its own issue.
 */

import { resolveSessionId } from "./session.ts";

/**
 * Handle the nerf_scope tool call.
 *
 * Accepts an optional `interval` parameter (acknowledged in response)
 * but does not use it — the full monitor is not yet implemented.
 */
export async function handleScope(
  params: Record<string, unknown>,
): Promise<string> {
  const sessionId = resolveSessionId(params.session_id as string | undefined);
  const interval = params.interval as number | undefined;

  const lines = [
    "nerf_scope is not yet implemented in the MCP server.",
    "",
    "To monitor context usage, use the crystallizer's built-in tracking",
    `or run: cc-context watch --session ${sessionId}`,
  ];

  if (interval !== undefined) {
    lines.push("");
    lines.push(
      `(Requested interval: ${interval}ms — will be used when the monitor is implemented)`,
    );
  }

  return lines.join("\n");
}
