const fs = require('fs') as typeof import('fs')
const path = require('path') as typeof import('path')

type EmbeddedTagMetadata = {
  title?: string
  artist?: string
  album?: string
  year?: number | string | null
  lyrics?: string
}

type ParsedFlacBlock = {
  type: number
  isLast: boolean
  payload: Buffer
}

type ParsedFlacResult = {
  blocks: ParsedFlacBlock[]
  audioOffset: number
}

function toSynchsafeInt(value: number): Buffer {
  const safe = Math.max(0, Number(value) || 0)
  return Buffer.from([
    (safe >> 21) & 0x7f,
    (safe >> 14) & 0x7f,
    (safe >> 7) & 0x7f,
    safe & 0x7f
  ])
}

function fromSynchsafeInt(buffer: Buffer, startIndex: number): number {
  if (!buffer || buffer.length < startIndex + 4) return 0
  return (
    ((buffer[startIndex] & 0x7f) << 21) |
    ((buffer[startIndex + 1] & 0x7f) << 14) |
    ((buffer[startIndex + 2] & 0x7f) << 7) |
    (buffer[startIndex + 3] & 0x7f)
  )
}

function buildId3v23Frame(frameId: string, payload: Buffer | null | undefined): Buffer {
  const id = String(frameId || '').trim()
  if (!/^[A-Z0-9]{4}$/.test(id)) return Buffer.alloc(0)
  const data = Buffer.isBuffer(payload) ? payload : Buffer.alloc(0)
  if (!data.length) return Buffer.alloc(0)

  const header = Buffer.alloc(10)
  header.write(id, 0, 4, 'ascii')
  header.writeUInt32BE(data.length, 4)
  header.writeUInt16BE(0, 8)
  return Buffer.concat([header, data])
}

function encodeUtf16Text(text: string): Buffer {
  const value = String(text || '')
  const bom = Buffer.from([0xff, 0xfe])
  return Buffer.concat([bom, Buffer.from(value, 'utf16le')])
}

function buildTextFrame(frameId: string, value: string): Buffer {
  const text = String(value || '').trim()
  if (!text) return Buffer.alloc(0)
  const payload = Buffer.concat([Buffer.from([0x01]), encodeUtf16Text(text)])
  return buildId3v23Frame(frameId, payload)
}

function buildApicFrame(imageBuffer: Buffer | null, mimeType: string): Buffer {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) return Buffer.alloc(0)
  const mime = String(mimeType || 'image/jpeg').toLowerCase()
  const mimePart = Buffer.from(mime, 'ascii')
  const payload = Buffer.concat([
    Buffer.from([0x00]),
    mimePart,
    Buffer.from([0x00]),
    Buffer.from([0x03]),
    Buffer.from([0x00]),
    imageBuffer
  ])
  return buildId3v23Frame('APIC', payload)
}

function buildUsltFrame(lyrics: string, language = 'XXX'): Buffer {
  const text = String(lyrics || '').trim()
  if (!text) return Buffer.alloc(0)

  // Empty content descriptor: UTF-16 BOM plus null terminator (2 zero bytes)
  const contentDesc = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([0x00, 0x00])])

  const payload = Buffer.concat([
    Buffer.from([0x01]), // Target text encoding: UTF-16 with BOM
    Buffer.from(language.padEnd(3, ' ').substring(0, 3), 'ascii'),
    contentDesc,
    encodeUtf16Text(text)
  ])
  return buildId3v23Frame('USLT', payload)
}

function stripLeadingId3Tag(audioBuffer: Buffer): Buffer {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 10) return audioBuffer
  if (audioBuffer[0] !== 0x49 || audioBuffer[1] !== 0x44 || audioBuffer[2] !== 0x33) return audioBuffer

  const flags = audioBuffer[5]
  const tagSize = fromSynchsafeInt(audioBuffer, 6)
  const hasFooter = (flags & 0x10) !== 0
  const totalSize = 10 + tagSize + (hasFooter ? 10 : 0)

  if (totalSize <= 0 || totalSize >= audioBuffer.length) return audioBuffer
  return audioBuffer.slice(totalSize)
}

async function writeId3TagsToMp3(
  filePath: string,
  metadata: EmbeddedTagMetadata,
  coverBuffer: Buffer | null,
  coverMime: string
): Promise<boolean> {
  const ext = String(path.extname(filePath || '')).toLowerCase()
  if (ext !== '.mp3') return false

  const title = String(metadata?.title || '').trim()
  const artist = String(metadata?.artist || '').trim()
  const album = String(metadata?.album || '').trim()
  const year = metadata?.year != null ? String(metadata.year).trim() : ''
  const lyrics = String(metadata?.lyrics || '').trim()

  const frames = [
    buildTextFrame('TIT2', title),
    buildTextFrame('TPE1', artist),
    buildTextFrame('TALB', album),
    buildTextFrame('TYER', year),
    buildUsltFrame(lyrics),
    buildApicFrame(coverBuffer, coverMime)
  ].filter((frame) => frame.length > 0)

  if (!frames.length) return false

  const tagBody = Buffer.concat(frames)
  const tagHeader = Buffer.from([
    0x49, 0x44, 0x33,
    0x03, 0x00,
    0x00,
    ...toSynchsafeInt(tagBody.length)
  ])

  const original = await fs.promises.readFile(filePath)
  const strippedAudio = stripLeadingId3Tag(original)
  const nextBuffer = Buffer.concat([tagHeader, tagBody, strippedAudio])
  await fs.promises.writeFile(filePath, nextBuffer)
  return true
}

function toUInt24BE(value: number): Buffer {
  const safe = Math.max(0, Number(value) || 0)
  return Buffer.from([
    (safe >> 16) & 0xff,
    (safe >> 8) & 0xff,
    safe & 0xff
  ])
}

function readUInt24BE(buffer: Buffer, startIndex: number): number {
  if (!buffer || buffer.length < startIndex + 3) return 0
  return (
    ((buffer[startIndex] & 0xff) << 16) |
    ((buffer[startIndex + 1] & 0xff) << 8) |
    (buffer[startIndex + 2] & 0xff)
  )
}

function toUInt32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(Math.max(0, Number(value) || 0), 0)
  return buffer
}

function toUInt32BE(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(Math.max(0, Number(value) || 0), 0)
  return buffer
}

function parseFlacBlocks(fileBuffer: Buffer): ParsedFlacResult | null {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 8) return null
  if (fileBuffer.slice(0, 4).toString('ascii') !== 'fLaC') return null

  let offset = 4
  const blocks: ParsedFlacBlock[] = []
  let reachedLast = false

  while (offset + 4 <= fileBuffer.length) {
    const header = fileBuffer[offset]
    const isLast = (header & 0x80) !== 0
    const type = header & 0x7f
    const size = readUInt24BE(fileBuffer, offset + 1)
    const payloadStart = offset + 4
    const payloadEnd = payloadStart + size

    if (payloadEnd > fileBuffer.length) return null

    blocks.push({
      type,
      isLast,
      payload: fileBuffer.slice(payloadStart, payloadEnd)
    })

    offset = payloadEnd
    if (isLast) {
      reachedLast = true
      break
    }
  }

  if (!reachedLast || blocks.length === 0) return null
  return { blocks, audioOffset: offset }
}

function buildFlacBlock(type: number, payload: Buffer, isLast: boolean): Buffer {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.alloc(0)
  const header = Buffer.concat([
    Buffer.from([(isLast ? 0x80 : 0x00) | (Number(type) & 0x7f)]),
    toUInt24BE(data.length)
  ])
  return Buffer.concat([header, data])
}

function buildVorbisPair(key: string, value: unknown): string {
  const normalizedKey = String(key || '').trim().toUpperCase()
  const normalizedValue = String(value || '').replace(/\u0000/g, '').trim()
  if (!normalizedKey || !normalizedValue) return ''
  return `${normalizedKey}=${normalizedValue}`
}

function buildFlacVorbisCommentPayload(metadata: EmbeddedTagMetadata): Buffer {
  const comments = [
    buildVorbisPair('TITLE', metadata?.title),
    buildVorbisPair('ARTIST', metadata?.artist),
    buildVorbisPair('ALBUM', metadata?.album),
    buildVorbisPair('DATE', metadata?.year),
    buildVorbisPair('LYRICS', metadata?.lyrics)
  ].filter(Boolean)

  if (!comments.length) return Buffer.alloc(0)

  const vendor = Buffer.from('music-player', 'utf8')
  const parts: Buffer[] = [toUInt32LE(vendor.length), vendor, toUInt32LE(comments.length)]

  for (const item of comments) {
    const buffer = Buffer.from(item, 'utf8')
    parts.push(toUInt32LE(buffer.length), buffer)
  }

  return Buffer.concat(parts)
}

function buildFlacPicturePayload(imageBuffer: Buffer | null, mimeType: string): Buffer {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) return Buffer.alloc(0)

  const mime = Buffer.from(String(mimeType || 'image/jpeg').toLowerCase(), 'ascii')
  const desc = Buffer.alloc(0)

  return Buffer.concat([
    toUInt32BE(3),
    toUInt32BE(mime.length),
    mime,
    toUInt32BE(desc.length),
    desc,
    toUInt32BE(0),
    toUInt32BE(0),
    toUInt32BE(0),
    toUInt32BE(0),
    toUInt32BE(imageBuffer.length),
    imageBuffer
  ])
}

async function writeFlacTagsToFlac(
  filePath: string,
  metadata: EmbeddedTagMetadata,
  coverBuffer: Buffer | null,
  coverMime: string
): Promise<boolean> {
  const ext = String(path.extname(filePath || '')).toLowerCase()
  if (ext !== '.flac') return false

  const original = await fs.promises.readFile(filePath)
  const parsed = parseFlacBlocks(original)
  if (!parsed) return false

  const streamInfo = parsed.blocks.find((block) => block.type === 0)
  if (!streamInfo) return false

  const preservedBlocks: Array<{ type: number; payload: Buffer }> = [
    { type: 0, payload: streamInfo.payload },
    ...parsed.blocks
      .filter((block) => block.type !== 0 && block.type !== 4 && block.type !== 6)
      .map((block) => ({ type: block.type, payload: block.payload }))
  ]

  const commentPayload = buildFlacVorbisCommentPayload(metadata)
  const picturePayload = buildFlacPicturePayload(coverBuffer, coverMime)

  if (commentPayload.length > 0) {
    preservedBlocks.push({ type: 4, payload: commentPayload })
  }
  if (picturePayload.length > 0) {
    preservedBlocks.push({ type: 6, payload: picturePayload })
  }

  if (preservedBlocks.length === 0) return false

  const metadataBytes = preservedBlocks.map((block, index) => {
    const isLast = index === preservedBlocks.length - 1
    return buildFlacBlock(block.type, block.payload, isLast)
  })

  const audioBody = original.slice(parsed.audioOffset)
  const nextBuffer = Buffer.concat([Buffer.from('fLaC', 'ascii'), ...metadataBytes, audioBody])
  await fs.promises.writeFile(filePath, nextBuffer)
  return commentPayload.length > 0 || picturePayload.length > 0
}

async function writeEmbeddedTags(
  filePath: string,
  metadata: EmbeddedTagMetadata,
  coverBuffer: Buffer | null,
  coverMime: string
): Promise<boolean> {
  const ext = String(path.extname(filePath || '')).toLowerCase()
  if (ext === '.mp3') {
    return writeId3TagsToMp3(filePath, metadata, coverBuffer, coverMime)
  }
  if (ext === '.flac') {
    return writeFlacTagsToFlac(filePath, metadata, coverBuffer, coverMime)
  }
  return false
}

module.exports = {
  writeId3TagsToMp3,
  writeFlacTagsToFlac,
  writeEmbeddedTags
}

export {}
