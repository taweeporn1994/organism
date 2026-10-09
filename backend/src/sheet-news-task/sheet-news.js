import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

/** Calendar day in the task's timezone, independent of the server's timezone. */
export function dayInZone(date = new Date(), timeZone = 'Asia/Bangkok') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function calendarDay(year, month, day) {
  if (year >= 2400) year -= 543
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('INVALID_DATE: date does not exist')
  }
  return date.toISOString().slice(0, 10)
}

/** Accept Sheets serial dates, yyyy-mm-dd, dd/mm/yyyy (AD/BE), or ISO with timezone. */
export function normalizeSheetDate(value, timeZone = 'Asia/Bangkok') {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
    if (!Number.isFinite(date.getTime()))
      throw new Error('INVALID_DATE: serial out of range')
    return date.toISOString().slice(0, 10)
  }
  const text = String(value ?? '').trim()
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (match) return calendarDay(...match.slice(1).map(Number))
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (match)
    return calendarDay(Number(match[3]), Number(match[2]), Number(match[1]))
  // Require an explicit offset: do not interpret local timestamps in server timezone.
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      text,
    )
  ) {
    calendarDay(...text.slice(0, 10).split('-').map(Number))
    const date = new Date(text)
    if (Number.isFinite(date.getTime())) return dayInZone(date, timeZone)
  }
  throw new Error(
    'INVALID_DATE: use a Sheets date, yyyy-mm-dd, dd/mm/yyyy, or ISO timestamp with offset',
  )
}

async function tokenFrom(getAccessToken) {
  const token = await getAccessToken()
  if (typeof token !== 'string' || !token)
    throw new Error('AUTH_REQUIRED: getAccessToken must return a token string')
  return token
}

/** Read a table starting at A<headerRow>. Latest = last nonempty physical row. */
export async function readLatestRow({
  spreadsheetId,
  sheetName,
  getAccessToken,
  headerRow = 1,
  lastColumn = 'Z',
  fetchImpl = fetch,
  timeoutMs = 30000,
}) {
  if (!spreadsheetId || !sheetName || typeof getAccessToken !== 'function') {
    throw new Error(
      'INVALID_CONFIG: spreadsheetId, sheetName and getAccessToken are required',
    )
  }
  if (
    !Number.isInteger(headerRow) ||
    headerRow < 1 ||
    !/^[A-Z]+$/.test(lastColumn)
  ) {
    throw new Error('INVALID_CONFIG: invalid headerRow or lastColumn')
  }
  const range = `'${sheetName.replaceAll("'", "''")}'!A${headerRow}:${lastColumn}`
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  )
  url.searchParams.set('majorDimension', 'ROWS')
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE')
  url.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER')
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${await tokenFrom(getAccessToken)}` },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(`SHEETS_HTTP_${response.status}: cannot read spreadsheet`)
  const { values = [] } = await response.json()
  if (!values.length) return null
  const headers = values[0].map((v) => String(v ?? '').trim())
  const namedHeaders = headers.filter(Boolean)
  if (new Set(namedHeaders).size !== namedHeaders.length)
    throw new Error('DUPLICATE_HEADERS: header names must be unique')
  for (let i = values.length - 1; i >= 1; i--) {
    if (!values[i].some((v) => v !== '' && v !== null && v !== undefined))
      continue
    const data = Object.fromEntries(
      headers.flatMap((h, col) => (h ? [[h, values[i][col] ?? '']] : [])),
    )
    return { rowNumber: headerRow + i, data }
  }
  return null
}

/** Compare date before any download. Throws on an absent column or invalid date. */
export function checkRowDate(
  row,
  { dateColumn = 'วันที่', timeZone = 'Asia/Bangkok', now = new Date() } = {},
) {
  if (!Object.hasOwn(row.data, dateColumn))
    throw new Error(`MISSING_COLUMN: ${dateColumn}`)
  const expectedDate = dayInZone(now, timeZone)
  const rowDate = normalizeSheetDate(row.data[dateColumn], timeZone)
  return { matches: rowDate === expectedDate, rowDate, expectedDate }
}

/** Plain https image URLs or Google Drive file links; multiple URLs via JSON array/newlines. */
export function parseImageSources(value) {
  const text = String(value ?? '').trim()
  if (!text) return []
  const sources = text.startsWith('[') ? JSON.parse(text) : text.split(/\r?\n/)
  if (!Array.isArray(sources) || sources.some((s) => typeof s !== 'string')) {
    throw new Error('INVALID_IMAGES: expected URL strings')
  }
  return [...new Set(sources.map((s) => s.trim()).filter(Boolean))]
}

function imageRequest(source) {
  const url = new URL(source)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('INVALID_IMAGE_URL: HTTPS required')
  if (url.hostname === 'drive.google.com') {
    const fileId =
      /\/file\/d\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1] ??
      url.searchParams.get('id')
    if (!fileId || !/^[A-Za-z0-9_-]+$/.test(fileId))
      throw new Error('INVALID_DRIVE_URL: expected file link')
    const media = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`)
    media.searchParams.set('alt', 'media')
    media.searchParams.set('supportsAllDrives', 'true')
    const resourceKey = url.searchParams.get('resourcekey')
    return {
      url: media,
      drive: true,
      resourceHeader: resourceKey ? `${fileId}/${resourceKey}` : null,
    }
  }
  return { url, drive: false }
}

// Validate actual bytes, not just extension or Content-Type (reject HTML login pages).
function imageType(buffer) {
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { ext: 'png', mime: 'image/png' }
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return { ext: 'jpg', mime: 'image/jpeg' }
  if (['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)))
    return { ext: 'gif', mime: 'image/gif' }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return { ext: 'webp', mime: 'image/webp' }
  throw new Error('INVALID_IMAGE: expected PNG, JPEG, GIF or WebP bytes')
}

/** Bounded download, signature check, atomic save. Auth is sent only to Drive API. */
export async function downloadImage(
  source,
  {
    outputDir,
    getAccessToken,
    prefix = 'news',
    fetchImpl = fetch,
    timeoutMs = 60000,
    maxBytes = 25 * 1024 * 1024,
  },
) {
  if (!outputDir || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('INVALID_CONFIG: outputDir and positive maxBytes required')
  const request = imageRequest(source)
  const headers = {}
  if (request.drive) {
    headers.Authorization = `Bearer ${await tokenFrom(getAccessToken)}`
    if (request.resourceHeader)
      headers['X-Goog-Drive-Resource-Keys'] = request.resourceHeader
  }
  const response = await fetchImpl(request.url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: request.drive ? 'error' : 'follow',
  })
  if (!response.ok) {
    const details = await response.json().catch(() => null)
    throw new Error(
      `IMAGE_HTTP_${response.status}: ${
        details?.error?.message || 'Cannot download image'
      }`,
    )
  }
  if (!response.body) throw new Error('EMPTY_IMAGE: response has no body')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    const declaredSize = Number(response.headers.get('content-length'))
    if (declaredSize > maxBytes) throw new Error('IMAGE_TOO_LARGE')
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > maxBytes) throw new Error('IMAGE_TOO_LARGE')
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks, size)
  const { ext, mime } = imageType(bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const safePrefix =
    String(prefix)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 80) || 'news'
  const directory = path.resolve(outputDir)
  await mkdir(directory, { recursive: true })
  const localPath = path.join(directory, `${safePrefix}-${randomUUID()}.${ext}`)
  const temporary = `${localPath}.part`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
    } finally {
      await handle.close()
    }
    await rename(temporary, localPath)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return {
    localPath,
    mimeType: mime,
    sizeBytes: size,
    sha256,
    sourceUrl: source,
  }
}

/** Scheduler-facing entrypoint. No timers, publishing, or processed-state mutation. */
export async function prepareLatestNews(options) {
  const { imageColumn = 'รูป', dateColumn = 'วันที่', outputDir } = options
  const latest = await readLatestRow(options)
  if (!latest) return { status: 'empty' }
  const date = checkRowDate(latest, { ...options, dateColumn })
  const base = {
    spreadsheetId: options.spreadsheetId,
    sheetName: options.sheetName,
    rowNumber: latest.rowNumber,
    data: latest.data,
    ...date,
  }
  if (!date.matches)
    return { status: 'skipped', reason: 'date_mismatch', ...base }
  if (!Object.hasOwn(latest.data, imageColumn))
    throw new Error(`MISSING_COLUMN: ${imageColumn}`)
  const sources = parseImageSources(latest.data[imageColumn])
  if (!sources.length)
    return { status: 'skipped', reason: 'missing_image', ...base }
  if (!outputDir) throw new Error('INVALID_CONFIG: outputDir required')
  const images = []
  try {
    for (const source of sources) {
      images.push(
        await downloadImage(source, {
          ...options,
          prefix: `news-${date.rowDate}-row-${latest.rowNumber}`,
        }),
      )
    }
  } catch (error) {
    // A failed task must not leave a half-ready image set behind.
    await Promise.all(
      images.map((image) => rm(image.localPath, { force: true })),
    )
    throw error
  }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        options.spreadsheetId,
        options.sheetName,
        latest.rowNumber,
        latest.data,
      ]),
    )
    .digest('hex')
  return { status: 'ready', ...base, taskKey: fingerprint, images }
}
