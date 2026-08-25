import { deepStrictEqual, doesNotThrow, match, ok, strictEqual } from "node:assert/strict"
import { describe, it } from "node:test"

function fail(message: string): never { throw new Error(message) }

export { describe, it }

export function expect(actual: any, _message?: string) {
  const hasOwn = (property: PropertyKey) => actual != null && property in Object(actual)
  const api: any = {
    toBe(expected: any) { strictEqual(actual, expected) },
    toEqual(expected: any) { deepStrictEqual(actual, expected) },
    toHaveLength(expected: number) { strictEqual(actual?.length, expected) },
    toHaveProperty(property: PropertyKey) { ok(hasOwn(property), `Expected value to have property ${String(property)}`) },
    toBeTruthy() { ok(actual) },
    toBeFalsy() { ok(!actual) },
    toBeDefined() { ok(actual !== undefined) },
    toBeNull() { strictEqual(actual, null) },
    toContain(expected: any) { ok(actual?.includes?.(expected), `Expected value to contain ${String(expected)}`) },
    toMatch(expected: RegExp | string) { typeof expected === "string" ? ok(String(actual).includes(expected)) : match(String(actual), expected) },
    toBeGreaterThan(expected: number) { ok(actual > expected, `Expected ${actual} > ${expected}`) },
    toBeGreaterThanOrEqual(expected: number) { ok(actual >= expected, `Expected ${actual} >= ${expected}`) },
    toBeLessThan(expected: number) { ok(actual < expected, `Expected ${actual} < ${expected}`) },
    toBeLessThanOrEqual(expected: number) { ok(actual <= expected, `Expected ${actual} <= ${expected}`) },
    toBeCloseTo(expected: number, digits = 2) { ok(Math.abs(actual - expected) <= 0.5 * 10 ** -digits, `Expected ${actual} close to ${expected}`) },
    toThrow(expected?: RegExp | string) {
      if (typeof actual !== "function") fail("toThrow expects a function")
      let thrown: unknown = null
      try { actual() } catch (error) { thrown = error }
      ok(thrown, "Expected function to throw")
      if (expected instanceof RegExp) match(String((thrown as Error)?.message ?? thrown), expected)
      else if (typeof expected === "string") ok(String((thrown as Error)?.message ?? thrown).includes(expected))
    },
  }
  api.not = {
    toBe(expected: any) { ok(actual !== expected) },
    toEqual(expected: any) { try { deepStrictEqual(actual, expected) } catch { return }; fail("Expected values not to be deeply equal") },
    toContain(expected: any) { ok(!actual?.includes?.(expected)) },
    toHaveProperty(property: PropertyKey) { ok(!hasOwn(property), `Expected value not to have property ${String(property)}`) },
    toThrow() { if (typeof actual !== "function") fail("not.toThrow expects a function"); doesNotThrow(actual) },
  }
  return api
}
