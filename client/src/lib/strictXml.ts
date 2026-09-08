export interface StrictXmlNode {
  name: string
  attributes: Readonly<Record<string, string>>
  children: StrictXmlNode[]
  text: string
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/
const DEFAULT_MAX_CHARACTERS = 12 * 1024 * 1024
const DEFAULT_MAX_NODES = 500_000
const DEFAULT_MAX_DEPTH = 128

export interface StrictXmlOptions {
  maxCharacters?: number
  maxNodes?: number
  maxDepth?: number
}

function xmlError(message: string, offset: number): Error {
  return new Error(`XML no válido cerca del carácter ${offset}: ${message}`)
}

function isXmlCharacter(value: number): boolean {
  return value === 0x09 || value === 0x0a || value === 0x0d
    || (value >= 0x20 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff)
}

function decodeEntity(entity: string, offset: number): string {
  if (entity === "lt") return "<"
  if (entity === "gt") return ">"
  if (entity === "amp") return "&"
  if (entity === "quot") return "\""
  if (entity === "apos") return "'"
  if (!/^#(?:[0-9]+|[xX][0-9A-Fa-f]+)$/.test(entity)) throw xmlError(`entidad &${entity}; desconocida o fuera de Unicode`, offset)
  const numeric = entity.startsWith("#x") || entity.startsWith("#X")
    ? Number.parseInt(entity.slice(2), 16)
    : entity.startsWith("#")
      ? Number.parseInt(entity.slice(1), 10)
      : Number.NaN
  if (!Number.isInteger(numeric) || !isXmlCharacter(numeric)) {
    throw xmlError(`entidad &${entity}; desconocida o fuera de Unicode`, offset)
  }
  return String.fromCodePoint(numeric)
}

function decodeEntities(value: string, offset: number): string {
  if (!value.includes("&")) return value
  let output = ""
  let cursor = 0
  while (cursor < value.length) {
    const ampersand = value.indexOf("&", cursor)
    if (ampersand < 0) return output + value.slice(cursor)
    output += value.slice(cursor, ampersand)
    const semicolon = value.indexOf(";", ampersand + 1)
    if (semicolon < 0 || semicolon - ampersand > 16) throw xmlError("entidad sin cierre", offset + ampersand)
    output += decodeEntity(value.slice(ampersand + 1, semicolon), offset + ampersand)
    cursor = semicolon + 1
  }
  return output
}

function tagEnd(source: string, start: number): number {
  let quote = ""
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) quote = ""
      continue
    }
    if (character === "\"" || character === "'") quote = character
    else if (character === ">") return index
  }
  return -1
}

function parseOpeningTag(source: string, offset: number): { name: string; attributes: Record<string, string>; selfClosing: boolean } {
  let content = source.trim()
  const selfClosing = content.endsWith("/")
  if (selfClosing) content = content.slice(0, -1).trimEnd()
  const nameMatch = NAME.exec(content)
  if (!nameMatch) throw xmlError("nombre de elemento inválido", offset)
  const name = nameMatch[0]
  let cursor = name.length
  const attributes: Record<string, string> = {}
  while (cursor < content.length) {
    while (/\s/.test(content[cursor] || "")) cursor += 1
    if (cursor >= content.length) break
    const attributeMatch = NAME.exec(content.slice(cursor))
    if (!attributeMatch) throw xmlError("nombre de atributo inválido", offset + cursor)
    const attributeName = attributeMatch[0]
    if (Object.prototype.hasOwnProperty.call(attributes, attributeName)) throw xmlError(`atributo duplicado ${attributeName}`, offset + cursor)
    cursor += attributeName.length
    while (/\s/.test(content[cursor] || "")) cursor += 1
    if (content[cursor] !== "=") throw xmlError(`falta = después de ${attributeName}`, offset + cursor)
    cursor += 1
    while (/\s/.test(content[cursor] || "")) cursor += 1
    const quote = content[cursor]
    if (quote !== "\"" && quote !== "'") throw xmlError(`el atributo ${attributeName} debe estar entre comillas`, offset + cursor)
    cursor += 1
    const valueStart = cursor
    const valueEnd = content.indexOf(quote, valueStart)
    if (valueEnd < 0) throw xmlError(`el atributo ${attributeName} no cierra sus comillas`, offset + valueStart)
    attributes[attributeName] = decodeEntities(content.slice(valueStart, valueEnd), offset + valueStart)
    cursor = valueEnd + 1
  }
  return { name, attributes, selfClosing }
}

/**
 * Lector XML pequeño y deliberadamente estricto para archivos MusicXML locales.
 * No interpreta DTD, entidades declaradas, instrucciones ni contenido ejecutable.
 */
export function parseStrictXml(source: string, options: StrictXmlOptions = {}): StrictXmlNode {
  const maxCharacters = options.maxCharacters ?? DEFAULT_MAX_CHARACTERS
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  if (source.length > maxCharacters) throw new Error(`El XML supera ${(maxCharacters / 1024 / 1024).toFixed(0)} MB descomprimidos`)
  for (let index = 0; index < source.length;) {
    const value = source.codePointAt(index)!
    if (!isXmlCharacter(value)) throw xmlError("carácter no permitido por XML 1.0", index)
    index += value > 0xffff ? 2 : 1
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) throw new Error("MusicXML con DTD o ENTITY no está permitido")

  const stack: StrictXmlNode[] = []
  let root: StrictXmlNode | null = null
  let cursor = 0
  let nodeCount = 0
  while (cursor < source.length) {
    const opening = source.indexOf("<", cursor)
    if (opening < 0) {
      const trailing = source.slice(cursor)
      if (stack.length) stack[stack.length - 1].text += decodeEntities(trailing, cursor)
      else if (trailing.trim()) throw xmlError("texto fuera del elemento raíz", cursor)
      break
    }
    const plainText = source.slice(cursor, opening)
    if (stack.length) stack[stack.length - 1].text += decodeEntities(plainText, cursor)
    else if (plainText.trim()) throw xmlError("texto fuera del elemento raíz", cursor)

    if (source.startsWith("<!--", opening)) {
      const end = source.indexOf("-->", opening + 4)
      if (end < 0) throw xmlError("comentario sin cierre", opening)
      cursor = end + 3
      continue
    }
    if (source.startsWith("<![CDATA[", opening)) {
      const end = source.indexOf("]]>", opening + 9)
      if (end < 0) throw xmlError("CDATA sin cierre", opening)
      if (!stack.length) throw xmlError("CDATA fuera del elemento raíz", opening)
      stack[stack.length - 1].text += source.slice(opening + 9, end)
      cursor = end + 3
      continue
    }
    if (source.startsWith("<?", opening)) {
      const end = source.indexOf("?>", opening + 2)
      if (end < 0) throw xmlError("instrucción de procesamiento sin cierre", opening)
      cursor = end + 2
      continue
    }
    if (source.startsWith("<!", opening)) throw xmlError("declaración XML no permitida", opening)

    const end = tagEnd(source, opening + 1)
    if (end < 0) throw xmlError("etiqueta sin cierre", opening)
    const tag = source.slice(opening + 1, end)
    if (tag.startsWith("/")) {
      const closing = tag.slice(1).trim()
      if (!NAME.test(closing) || closing.match(NAME)?.[0] !== closing) throw xmlError("cierre de elemento inválido", opening)
      const current = stack.pop()
      if (!current || current.name !== closing) throw xmlError(`se esperaba cerrar ${current?.name ?? "ningún elemento"}, no ${closing}`, opening)
    } else {
      const parsed = parseOpeningTag(tag, opening + 1)
      const node: StrictXmlNode = { name: parsed.name, attributes: parsed.attributes, children: [], text: "" }
      nodeCount += 1
      if (nodeCount > maxNodes) throw new Error(`El XML supera ${maxNodes} elementos`)
      if (stack.length) stack[stack.length - 1].children.push(node)
      else if (root) throw xmlError("hay más de un elemento raíz", opening)
      else root = node
      if (!parsed.selfClosing) {
        stack.push(node)
        if (stack.length > maxDepth) throw new Error(`El XML supera ${maxDepth} niveles de anidación`)
      }
    }
    cursor = end + 1
  }
  if (stack.length) throw xmlError(`falta cerrar ${stack[stack.length - 1].name}`, source.length)
  if (!root) throw new Error("El archivo XML está vacío")
  return root
}

export function xmlLocalName(value: string): string {
  const separator = value.lastIndexOf(":")
  return separator < 0 ? value : value.slice(separator + 1)
}

export function xmlChildren(node: StrictXmlNode, name: string): StrictXmlNode[] {
  return node.children.filter(child => xmlLocalName(child.name) === name)
}

export function xmlChild(node: StrictXmlNode | null | undefined, name: string): StrictXmlNode | null {
  return node?.children.find(child => xmlLocalName(child.name) === name) ?? null
}

export function xmlAttribute(node: StrictXmlNode | null | undefined, name: string): string | null {
  if (!node) return null
  for (const [attribute, value] of Object.entries(node.attributes)) {
    if (xmlLocalName(attribute) === name) return value
  }
  return null
}

export function xmlText(node: StrictXmlNode | null | undefined): string {
  if (!node) return ""
  const pieces = [node.text]
  for (const child of node.children) pieces.push(xmlText(child))
  return pieces.join("").replace(/\s+/g, " ").trim()
}

export function xmlNumber(node: StrictXmlNode | null | undefined): number | null {
  const text = xmlText(node)
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function xmlDescendants(node: StrictXmlNode, name: string): StrictXmlNode[] {
  const matches: StrictXmlNode[] = []
  const pending = [...node.children].reverse()
  while (pending.length) {
    const current = pending.pop()!
    if (xmlLocalName(current.name) === name) matches.push(current)
    for (let index = current.children.length - 1; index >= 0; index -= 1) pending.push(current.children[index])
  }
  return matches
}
