import test from "node:test"
import assert from "node:assert/strict"
import { hasActiveSubscription } from "../server/subscription"

test("las funciones de IA exigen plan, estado activo y vigencia", () => {
  assert.equal(hasActiveSubscription({ subscriptionPlan: "audio", subscriptionStatus: "inactive" }, "elevenlabs"), false)
  assert.equal(hasActiveSubscription({ subscriptionPlan: "aesthetic", subscriptionStatus: "active" }, "oracle"), true)
  assert.equal(hasActiveSubscription({ subscriptionPlan: "aesthetic", subscriptionStatus: "active" }, "elevenlabs"), false)
  assert.equal(hasActiveSubscription({ subscriptionPlan: "audio", subscriptionStatus: "active" }, "elevenlabs"), true)
  assert.equal(hasActiveSubscription({ subscriptionPlan: "audio", subscriptionStatus: "active", subscriptionExpiresAt: "2020-01-01" }, "elevenlabs"), false)
})
