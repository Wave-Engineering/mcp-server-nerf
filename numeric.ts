/**
 * Shared numeric input coercion for MCP tool handlers.
 *
 * Rationale: TypeScript casts in tool handlers (`params.x as number`) do not
 * coerce at runtime, so JSON payloads that arrive with stringified numbers
 * (observed from some MCP client emission paths) fall through to
 * `Number.isInteger()` which rejects strings. See issue #13.
 */

/**
 * Coerce a raw tool-call argument to a number, preserving `undefined`
 * so callers can distinguish "not provided" from "provided but invalid".
 *
 * - `number`       → returned as-is
 * - numeric string → parsed via `Number()` (e.g. "500000" → 500000).
 *                    JSON-compliant scientific notation such as "1e5" is
 *                    accepted and resolves to its numeric value; the caller's
 *                    `Number.isInteger` check still rejects non-integer
 *                    results like "1.5e2".
 * - `null`         → treated as `undefined` (absent field). JSON distinguishes
 *                    explicit null from missing, but tool handlers treat both
 *                    as "not provided" so the partial-args error fires
 *                    consistently instead of leaking a "got null" message.
 * - `undefined`    → returned as-is
 * - anything else  → `NaN`, which the caller's `Number.isInteger` check rejects
 *
 * Empty and whitespace-only strings become `NaN` instead of `0` to avoid
 * silently accepting blank values — `Number("")` and `Number("  ")` are `0`
 * in JS, which would otherwise masquerade as a valid zero that then fails
 * the positivity check with a misleading error.
 */
export function coerceNumericInput(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.trim() === "") return NaN;
    return Number(value);
  }
  return NaN;
}

/**
 * Format a raw input value for inclusion in an error message. Strings are
 * wrapped in quotes so callers can distinguish a stringified numeric from a
 * native number in the error output — e.g. `got "500000"` vs `got 500000`.
 */
export function formatRawValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === undefined) return "undefined";
  return String(value);
}
