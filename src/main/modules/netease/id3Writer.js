const fs = require('fs')
const path = require('path')

function toSynchsafeInt(value) {
  const safe = Math.max(0, Number(value) || 0)
  return Buffer.from([
    (safe >> 21) & 0x7f,
    (safe >> 14) & 0x7f,
    (safe >> 7) & 0x7f,
    safe & 0x7f
  ])
}

function fromSynchsafeInt(buffer, startIndex) {
  if (!buffer || buffer.length < startIndex + 4) return 0
  return (
    ((buffer[startIndex] & 0x7f) << 21) |
    ((buffer[startIndex + 1] & 0x7f) << 14) |
    ((buffer[startIndex + 2] & 0x7f) << 7) |
    (buffer[startIndex + 3] & 0x7f)
  )
}

function buildId3v23Frame(frameId, payload) {
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

function encodeUtf16Text(text) {
  const value = String(text || '')
  const bom = Buffer.from([0xff, 0xfe])
  return Buffer.concat([bom, Buffer.from(value, 'utf16le')])
}

function buildTextFrame(frameId, value) {
  const text = String(value || '').trim()
  if (!text) return Buffer.alloc(0)
  const payload = Buffer.concat([Buffer.from([0x01]), encodeUtf16Text(text)])
  return buildId3v23Frame(frameId, payload)
}

function buildApicFrame(imageBuffer, mimeType) {
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

function buildUsltFrame(lyrics, language = 'XXX') {
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

function stripLeadingId3Tag(audioBuffer) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 10) return audioBuffer
  if (audioBuffer[0] !== 0x49 || audioBuffer[1] !== 0x44 || audioBuffer[2] !== 0x33) return audioBuffer

  const flags = audioBuffer[5]
  const tagSize = fromSynchsafeInt(audioBuffer, 6)
  const hasFooter = (flags & 0x10) !== 0
  const totalSize = 10 + tagSize + (hasFooter ? 10 : 0)

  if (totalSize <= 0 || totalSize >= audioBuffer.length) return audioBuffer
  return audioBuffer.slice(totalSize)
}

async function writeId3TagsToMp3(filePath, metadata, coverBuffer, coverMime) {
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

module.exports = { writeId3TagsToMp3 }
