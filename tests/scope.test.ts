/**
 * Unit tests for scope.ts — nerf_scope stub handler.
 */

import { describe, test, expect } from "bun:test";
import { handleScope } from "../scope.ts";

describe("nerf_scope", () => {
  test("scope returns not-implemented message", async () => {
    const result = await handleScope({});

    expect(result).toContain("nerf_scope is not yet implemented");
    expect(result).toContain("cc-context watch");
  });

  test("scope does not throw", async () => {
    // Should return cleanly, not crash
    const result = await handleScope({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("scope acknowledges interval parameter", async () => {
    const result = await handleScope({ interval: 15000 });

    expect(result).toContain("15000ms");
    expect(result).toContain("will be used when the monitor is implemented");
  });

  test("scope includes explicit session_id in help text", async () => {
    const result = await handleScope({ session_id: "my-test-session-abc" });

    expect(result).toContain("cc-context watch --session my-test-session-abc");
  });

  test("scope without interval does not mention interval", async () => {
    const result = await handleScope({});

    expect(result).not.toContain("Requested interval");
  });
});
