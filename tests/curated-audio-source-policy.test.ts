import test from "node:test"
import assert from "node:assert/strict"
import { DISCORD_MARTIN_HD28_PACK } from "../shared/curated-raw-wav-packs"
import { curatedSamplePackSource } from "../server/audioModuleInstaller"

test("el nuevo pack acústico conserva origen GitHub fijado", () => {
  assert.equal(DISCORD_MARTIN_HD28_PACK.repositoryUrl, "https://github.com/sfzinstruments/Discord-SFZ-GM-Bank")
  assert.match(DISCORD_MARTIN_HD28_PACK.pinnedCommit, /^[a-f0-9]{40}$/)
})

test("el catálogo resuelve Martin HD28 sin convertir candidatos pendientes en instalables", () => {
  assert.equal(curatedSamplePackSource("discord-martin-hd28")?.id, "discord-martin-hd28")
  assert.equal(curatedSamplePackSource("freepats-spanish-classical-guitar"), null)
})
