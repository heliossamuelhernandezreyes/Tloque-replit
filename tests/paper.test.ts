import test from "node:test"
import assert from "node:assert/strict"
import { PAPER_PLANS, paperChargeFor } from "../shared/paper"

test("Papel mide uso real en unidades enteras y nunca crea saldo desde cero", () => {
  assert.equal(paperChargeFor("oracle", 0, 0), 0)
  assert.equal(paperChargeFor("oracle", 800, 500), 2)
  assert.equal(paperChargeFor("elevenlabs", 1_001), 2)
  assert.equal(paperChargeFor("elevenlabs", -10), 0)
})

test("Oráculo requiere suscripción y las funciones crecen por nivel", () => {
  assert.deepEqual(PAPER_PLANS.map(plan => plan.monthlyPaper), [20, 200, 800])
  assert.equal(PAPER_PLANS[0].oracle, false)
  assert.equal(PAPER_PLANS[1].oracle, true)
  assert.equal(PAPER_PLANS[0].elevenlabs, false)
  assert.equal(PAPER_PLANS[2].elevenlabs, true)
})
