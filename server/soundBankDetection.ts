export function detectSoundBankType(bytes: Buffer, fileName = ""): { extension: "sf2" | "sf3" | "dls"; mimeType: string } | null {
  const riff = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF"
  if (!riff) return null
  const form = bytes.subarray(8, 12).toString("ascii")
  if (form === "DLS ") return { extension: "dls", mimeType: "application/octet-stream" }
  if (form !== "sfbk") return null
  const infoVersion = bytes.indexOf(Buffer.from("ifil"))
  const major = infoVersion >= 0 && infoVersion + 10 <= bytes.length ? bytes.readUInt16LE(infoVersion + 8) : 0
  const declaredSf3 = /\.sf3$/i.test(fileName)
  return { extension: major >= 3 || declaredSf3 ? "sf3" : "sf2", mimeType: "application/octet-stream" }
}
