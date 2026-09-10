import test from "node:test"
import assert from "node:assert/strict"
import { createElement, useEffect } from "react"
import TestRenderer from "react-test-renderer"
import { Canvas } from "@react-three/fiber"
import { build } from "esbuild"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { visualBudget } from "../shared/visual-experience"

// Real React/R3F mount lifecycle, with zero layout size so no GPU is required.
// This catches callbacks in Canvas's HTML fallback, which is always mounted.
test("Canvas no declara fallo por montar sus hijos HTML de fallback", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
    addEventListener() {}, removeEventListener() {}, ResizeObserver: class {},
  } })
  const directory = await mkdtemp(path.join(process.cwd(), "node_modules/.visual-lifecycle-"))
  let root: any
  try {
    const result = await build({ entryPoints: ["client/src/visual/VisualSurface.tsx"], bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic", write: false })
    const filename = path.join(directory, "surface.mjs")
    await writeFile(filename, result.outputFiles[0].contents)
    const { default: VisualSurface } = await import(pathToFileURL(filename).href)
    let fallbackMounted = 0
    function Probe() { useEffect(() => { fallbackMounted++ }, []); return null }
    TestRenderer.act(() => { root = TestRenderer.create(createElement(Canvas, { fallback: createElement(Probe) })) })
    assert.equal(fallbackMounted, 1, "R3F monta fallback sin que exista un fallo WebGL")
    TestRenderer.act(() => root.unmount())

    let failures = 0
    const props = { entries: [], budget: visualBudget("ultra"), onFailure: () => { failures++ } }
    TestRenderer.act(() => { root = TestRenderer.create(createElement(VisualSurface, props)) })
    assert.equal(failures, 0, "el montaje normal no desactiva el motor")
    const expectedDpr = 1.75
    assert.equal(root.root.findByType(Canvas).props.dpr, expectedDpr)
    // Simulate the compositor's pressure feedback, then an unrelated slot update.
    TestRenderer.act(() => root.root.findByType(Canvas).props.children.props.onDprChange(.8))
    TestRenderer.act(() => root.update(createElement(VisualSurface, { ...props, entries: [] })))
    assert.equal(root.root.findByType(Canvas).props.dpr, .8, "el siguiente render no restablece DPR=1")
    assert.equal(failures, 0)
  } finally {
    if (root) TestRenderer.act(() => root.unmount())
    await rm(directory, { recursive: true, force: true })
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow)
    else delete (globalThis as any).window
  }
})
