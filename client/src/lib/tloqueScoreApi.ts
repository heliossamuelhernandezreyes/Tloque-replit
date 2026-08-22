import type { LinearScoreRecipe } from "@shared/audio"

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function diagnosticMessage(value: unknown): string | null {
  if (!isObject(value) || typeof value.message !== "string" || !value.message.trim()) return null
  const line = typeof value.line === "number" && Number.isFinite(value.line)
    ? `L${value.line}: `
    : ""
  return `${line}${value.message.trim()}`
}

function responseErrorMessage(response: Response, body: unknown, rawBody: string): string {
  const prefix = `HTTP ${response.status || "desconocido"}`
  if (isObject(body)) {
    const diagnostics = Array.isArray(body.diagnostics)
      ? body.diagnostics.map(diagnosticMessage).filter((item): item is string => Boolean(item))
      : []
    if (diagnostics.length) return `${prefix}\n${diagnostics.join("\n")}`
    if (typeof body.message === "string" && body.message.trim()) {
      return `${prefix} · ${body.message.trim()}`
    }
  }

  const plainText = rawBody.replace(/\s+/g, " ").trim().slice(0, 240)
  if (plainText) return `${prefix} · ${plainText}`
  return `${prefix} · El servidor no devolvió detalles del error`
}

export async function readTloqueScoreCompileResponse(response: Response): Promise<LinearScoreRecipe> {
  const rawBody = await response.text()
  let body: unknown = null
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      body = null
    }
  }

  if (response.ok && isObject(body) && body.ok === true && body.recipe !== undefined) {
    return body.recipe as LinearScoreRecipe
  }
  throw new Error(responseErrorMessage(response, body, rawBody))
}

export async function compileTloqueScoreOnServer(source: string): Promise<LinearScoreRecipe> {
  let response: Response
  try {
    response = await fetch("/api/admin/audio/score/compile", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    })
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` · ${error.message}` : ""
    throw new Error(`Sin respuesta HTTP · No se pudo contactar al compilador${detail}`)
  }
  return readTloqueScoreCompileResponse(response)
}
