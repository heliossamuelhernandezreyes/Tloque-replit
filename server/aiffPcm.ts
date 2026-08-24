function readExtended80(buffer: Buffer, offset: number) {
  const exponentWord = buffer.readUInt16BE(offset)
  const sign = exponentWord & 0x8000 ? -1 : 1
  const exponent = exponentWord & 0x7fff
  const hiMantissa = buffer.readUInt32BE(offset + 2)
  const loMantissa = buffer.readUInt32BE(offset + 6)
  if (exponent === 0 && hiMantissa === 0 && loMantissa === 0) return 0
  if (exponent === 0x7fff) throw new Error("AIFF con sample rate no finito")
  const mantissa = hiMantissa * 2 ** -31 + loMantissa * 2 ** -63
  return sign * mantissa * 2 ** (exponent - 16383)
}

function writeWavHeader(output: Buffer, channels: number, sampleRate: number, bitsPerSample: number, dataBytes: number) {
  const blockAlign = channels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  output.write("RIFF", 0, 4, "ascii")
  output.writeUInt32LE(36 + dataBytes, 4)
  output.write("WAVE", 8, 4, "ascii")
  output.write("fmt ", 12, 4, "ascii")
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(channels, 22)
  output.writeUInt32LE(sampleRate, 24)
  output.writeUInt32LE(byteRate, 28)
  output.writeUInt16LE(blockAlign, 32)
  output.writeUInt16LE(bitsPerSample, 34)
  output.write("data", 36, 4, "ascii")
  output.writeUInt32LE(dataBytes, 40)
}

/**
 * Converts uncompressed integer AIFF/AIFC(NONE) PCM to canonical little-endian WAV.
 * This intentionally supports only the format needed by verified institutional sample
 * sources; compressed AIFC codecs and floating point encodings are rejected.
 */
export function convertAiffPcmToWav(bytes: Buffer): Buffer {
  if (bytes.length < 12 || bytes.subarray(0, 4).toString("ascii") !== "FORM") throw new Error("La muestra no contiene un FORM AIFF válido")
  const declaredFormBytes = bytes.readUInt32BE(4) + 8
  if (declaredFormBytes > bytes.length) throw new Error("AIFF truncado")
  const formType = bytes.subarray(8, 12).toString("ascii")
  if (formType !== "AIFF" && formType !== "AIFC") throw new Error("FORM no contiene AIFF/AIFC")

  let channels = 0
  let frameCount = 0
  let bitsPerSample = 0
  let sampleRate = 0
  let soundData: Buffer | null = null

  for (let offset = 12; offset + 8 <= declaredFormBytes;) {
    const id = bytes.subarray(offset, offset + 4).toString("ascii")
    const size = bytes.readUInt32BE(offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + size
    if (dataEnd > declaredFormBytes || dataEnd > bytes.length) throw new Error(`Chunk AIFF ${id} truncado`)

    if (id === "COMM") {
      if (size < 18) throw new Error("COMM AIFF incompleto")
      channels = bytes.readUInt16BE(dataStart)
      frameCount = bytes.readUInt32BE(dataStart + 2)
      bitsPerSample = bytes.readUInt16BE(dataStart + 6)
      sampleRate = Math.round(readExtended80(bytes, dataStart + 8))
      if (formType === "AIFC") {
        if (size < 22) throw new Error("COMM AIFC incompleto")
        const compression = bytes.subarray(dataStart + 18, dataStart + 22).toString("ascii")
        if (compression !== "NONE" && compression !== "twos") throw new Error(`Compresión AIFC no soportada: ${compression}`)
      }
    } else if (id === "SSND") {
      if (size < 8) throw new Error("SSND AIFF incompleto")
      const dataOffset = bytes.readUInt32BE(dataStart)
      const blockSize = bytes.readUInt32BE(dataStart + 4)
      if (blockSize !== 0) throw new Error("AIFF con SSND blockSize no soportado")
      const pcmStart = dataStart + 8 + dataOffset
      if (pcmStart > dataEnd) throw new Error("Offset SSND fuera de rango")
      soundData = bytes.subarray(pcmStart, dataEnd)
    }

    offset = dataEnd + (size % 2)
  }

  if (!channels || channels > 8) throw new Error("AIFF sin número de canales válido")
  if (!frameCount) throw new Error("AIFF sin frames PCM")
  if (![8, 16, 24, 32].includes(bitsPerSample)) throw new Error(`Resolución AIFF no soportada: ${bitsPerSample} bits`)
  if (!Number.isFinite(sampleRate) || sampleRate < 8_000 || sampleRate > 384_000) throw new Error("AIFF con sample rate inválido")
  if (!soundData) throw new Error("AIFF sin chunk SSND")

  const bytesPerSample = bitsPerSample / 8
  const expectedBytes = frameCount * channels * bytesPerSample
  if (soundData.length < expectedBytes) throw new Error("SSND contiene menos PCM del declarado")
  const pcm = soundData.subarray(0, expectedBytes)
  const output = Buffer.allocUnsafe(44 + expectedBytes)
  writeWavHeader(output, channels, sampleRate, bitsPerSample, expectedBytes)

  if (bitsPerSample === 8) {
    // AIFF 8-bit is signed; WAV PCM 8-bit is unsigned.
    for (let i = 0; i < pcm.length; i += 1) output[44 + i] = (pcm.readInt8(i) + 128) & 0xff
  } else {
    for (let i = 0; i < expectedBytes; i += bytesPerSample) {
      for (let byte = 0; byte < bytesPerSample; byte += 1) output[44 + i + byte] = pcm[i + bytesPerSample - 1 - byte]
    }
  }
  return output
}
