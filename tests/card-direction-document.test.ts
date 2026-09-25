import test from "node:test"
import assert from "node:assert/strict"
import { cardDirectionSchema, readCardDirection } from "../shared/card-direction"
import { createPortalCardScene } from "../shared/card-scene"

test("recuperar/exportar una dirección mantiene sus tres imágenes y acepta recetas anteriores", () => {
  const scene = createPortalCardScene()
  const images = ["data:image/png;base64,AAAA", "https://example.test/mid.webp", ""]
  const document = cardDirectionSchema.parse({ type: "tloque-card-direction", version: 2, scene, images })
  assert.deepEqual(readCardDirection(JSON.parse(JSON.stringify(document))), document)
  assert.deepEqual(readCardDirection({ type: "tloque-card-direction", scene }, images)?.images, images)
  assert.equal(readCardDirection({ ...document, images: ["javascript:alert(1)", "", ""] }), null)
  assert.equal(readCardDirection({ ...document, images: images.slice(0, 2) }), null)
})
