import { parseStrictXml, xmlAttribute, xmlDescendants, xmlLocalName } from "./strictXml"

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
const MAX_ENTRY_BYTES = 12 * 1024 * 1024
const MAX_DECLARED_BYTES = 48 * 1024 * 1024
const MAX_ENTRIES = 256
const MAX_COMPRESSION_RATIO = 250

interface ZipEntry {
  name: string
  method: number
  flags: number
  crc32: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

const decoder = new TextDecoder("utf-8", { fatal: true })

function uint16(view: DataView, offset: number) {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error("Cabecera MXL truncada")
  return view.getUint16(offset, true)
}

function uint32(view: DataView, offset: number) {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error("Cabecera MXL truncada")
  return view.getUint32(offset, true)
}

function safeArchivePath(name: string): string {
  const normalized = name.replace(/\\/g, "/")
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.includes("\0")) throw new Error("El MXL contiene una ruta vacía o absoluta")
  if (normalized.length > 1_024) throw new Error("El MXL contiene una ruta de más de 1024 caracteres")
  const segments = normalized.split("/")
  if (segments.some(segment => segment === ".." || segment === ".")) throw new Error(`Ruta insegura dentro del MXL: ${name}`)
  return normalized
}

function endOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557)
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (uint32(view, offset) === 0x06054b50 && offset + 22 + uint16(view, offset + 20) === view.byteLength) return offset
  }
  throw new Error("El archivo .mxl no contiene un directorio ZIP válido")
}

function readEntries(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("El archivo .mxl supera 16 MB")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = endOfCentralDirectory(view)
  const disk = uint16(view, eocd + 4)
  const centralDisk = uint16(view, eocd + 6)
  const diskEntries = uint16(view, eocd + 8)
  const entryCount = uint16(view, eocd + 10)
  const centralSize = uint32(view, eocd + 12)
  const centralOffset = uint32(view, eocd + 16)
  if (disk || centralDisk || diskEntries !== entryCount) throw new Error("MXL multipartido no está permitido")
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 no está admitido para partituras MXL móviles")
  if (entryCount < 1 || entryCount > MAX_ENTRIES) throw new Error(`El MXL debe contener entre 1 y ${MAX_ENTRIES} archivos`)
  if (centralOffset + centralSize > eocd) throw new Error("El directorio del MXL apunta fuera del archivo")

  const entries: ZipEntry[] = []
  const names = new Set<string>()
  let declaredBytes = 0
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(view, cursor) !== 0x02014b50) throw new Error("Entrada central MXL no válida")
    const flags = uint16(view, cursor + 8)
    const method = uint16(view, cursor + 10)
    const crc32 = uint32(view, cursor + 16)
    const compressedSize = uint32(view, cursor + 20)
    const uncompressedSize = uint32(view, cursor + 24)
    const nameLength = uint16(view, cursor + 28)
    const extraLength = uint16(view, cursor + 30)
    const commentLength = uint16(view, cursor + 32)
    const localOffset = uint32(view, cursor + 42)
    const nameStart = cursor + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd + extraLength + commentLength > centralOffset + centralSize) throw new Error("Nombre o metadatos MXL truncados")
    const rawName = bytes.subarray(nameStart, nameEnd)
    if (!(flags & 0x0800) && rawName.some(byte => byte > 0x7f)) throw new Error("Los nombres no ASCII del MXL deben declararse como UTF-8")
    const name = safeArchivePath(decoder.decode(rawName))
    const canonicalName = name.toLowerCase()
    if (names.has(canonicalName)) throw new Error(`El MXL repite la ruta ${name}`)
    names.add(canonicalName)
    if (flags & 0x0001) throw new Error("Los MXL cifrados no están permitidos")
    if (method !== 0 && method !== 8) throw new Error(`Método ZIP ${method} no admitido en ${name}`)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error(`ZIP64 no está admitido en ${name}`)
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`La entrada ${name} supera 12 MB descomprimidos`)
    if (uncompressedSize > 0 && compressedSize === 0) throw new Error(`Tamaño comprimido inválido en ${name}`)
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) throw new Error(`La entrada ${name} excede la relación de compresión segura`)
    declaredBytes += uncompressedSize
    if (declaredBytes > MAX_DECLARED_BYTES) throw new Error("El contenido declarado del MXL supera 48 MB")
    entries.push({ name, method, flags, crc32, compressedSize, uncompressedSize, localOffset })
    cursor = nameEnd + extraLength + commentLength
  }
  return entries
}

let crcTable: Uint32Array | null = null
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let value = 0; value < 256; value += 1) {
      let current = value
      for (let bit = 0; bit < 8; bit += 1) current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
      crcTable[value] = current >>> 0
    }
  }
  let checksum = 0xffffffff
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
  return (checksum ^ 0xffffffff) >>> 0
}

async function inflateRaw(bytes: Uint8Array, maximumBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador no puede descomprimir .mxl; exporta .musicxml sin comprimir")
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel()
        throw new Error("Una entrada MXL excede el límite durante la descompresión")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function extractEntry(archive: Uint8Array, entry: ZipEntry, maximumBytes = MAX_ENTRY_BYTES): Promise<Uint8Array> {
  if (entry.uncompressedSize > maximumBytes) throw new Error(`La entrada ${entry.name} supera el límite permitido para su tipo`)
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  if (uint32(view, entry.localOffset) !== 0x04034b50) throw new Error(`Cabecera local inválida en ${entry.name}`)
  const localFlags = uint16(view, entry.localOffset + 6)
  const localMethod = uint16(view, entry.localOffset + 8)
  if (localFlags !== entry.flags || localMethod !== entry.method) throw new Error(`La cabecera de ${entry.name} no coincide con su directorio`)
  if (!(entry.flags & 0x0008)) {
    const localCrc32 = uint32(view, entry.localOffset + 14)
    const localCompressedSize = uint32(view, entry.localOffset + 18)
    const localUncompressedSize = uint32(view, entry.localOffset + 22)
    if (localCrc32 !== entry.crc32 || localCompressedSize !== entry.compressedSize || localUncompressedSize !== entry.uncompressedSize) {
      throw new Error(`Los tamaños o CRC locales de ${entry.name} no coinciden con su directorio`)
    }
  }
  const nameLength = uint16(view, entry.localOffset + 26)
  const extraLength = uint16(view, entry.localOffset + 28)
  const nameStart = entry.localOffset + 30
  const nameEnd = nameStart + nameLength
  if (nameEnd > archive.byteLength) throw new Error(`Nombre local truncado en ${entry.name}`)
  const localName = safeArchivePath(decoder.decode(archive.subarray(nameStart, nameEnd)))
  if (localName !== entry.name) throw new Error(`El nombre local de ${entry.name} no coincide con su directorio`)
  const start = nameEnd + extraLength
  const end = start + entry.compressedSize
  if (end > archive.byteLength) throw new Error(`Datos truncados en ${entry.name}`)
  const compressed = archive.subarray(start, end)
  const output = entry.method === 0 ? new Uint8Array(compressed) : await inflateRaw(compressed, maximumBytes)
  if (output.byteLength !== entry.uncompressedSize) throw new Error(`El tamaño descomprimido de ${entry.name} no coincide`)
  if (crc32(output) !== entry.crc32) throw new Error(`La verificación CRC de ${entry.name} falló`)
  return output
}

function canonicalEntry(entries: readonly ZipEntry[], requested: string): ZipEntry | null {
  return entries.find(entry => entry.name === requested)
    ?? entries.find(entry => entry.name.toLowerCase() === requested.toLowerCase())
    ?? null
}

export async function extractMusicXmlFromMxl(archive: Uint8Array): Promise<{ xml: string; path: string }> {
  const entries = readEntries(archive)
  const containerEntry = canonicalEntry(entries, "META-INF/container.xml")
  let scorePath = ""
  if (containerEntry) {
    const containerXml = decoder.decode(await extractEntry(archive, containerEntry, 256 * 1024)).replace(/^\uFEFF/, "")
    const container = parseStrictXml(containerXml, { maxCharacters: 256 * 1024, maxNodes: 2_000, maxDepth: 24 })
    if (xmlLocalName(container.name) !== "container") throw new Error("META-INF/container.xml no contiene <container>")
    const rootfiles = xmlDescendants(container, "rootfile")
    const rootfile = rootfiles.find(node => ["application/vnd.recordare.musicxml+xml", "application/vnd.recordare.musicxml"].includes((xmlAttribute(node, "media-type") ?? "").toLowerCase())) ?? rootfiles[0]
    scorePath = safeArchivePath(xmlAttribute(rootfile, "full-path") ?? "")
  } else {
    const fallback = entries.find(entry => /\.(?:musicxml|xml)$/i.test(entry.name) && entry.name.toLowerCase() !== "meta-inf/container.xml")
    if (!fallback) throw new Error("El MXL no contiene META-INF/container.xml ni una partitura XML")
    scorePath = fallback.name
  }
  const scoreEntry = canonicalEntry(entries, scorePath)
  if (!scoreEntry) throw new Error(`El MXL declara ${scorePath}, pero esa entrada no existe`)
  const xml = decoder.decode(await extractEntry(archive, scoreEntry)).replace(/^\uFEFF/, "")
  return { xml, path: scoreEntry.name }
}

export const MXL_IMPORT_LIMITS = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  entryBytes: MAX_ENTRY_BYTES,
  entries: MAX_ENTRIES,
  compressionRatio: MAX_COMPRESSION_RATIO,
} as const
