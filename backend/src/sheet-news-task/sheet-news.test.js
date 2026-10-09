import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeSheetDate, dayInZone, prepareLatestNews, readLatestRow, downloadImage } from './sheet-news.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const config = { spreadsheetId: 'test-id', sheetName: "News' tab", getAccessToken: async () => 'test-token', now: new Date('2026-10-09T03:00:00Z') };
const sheet = values => Response.json({ values });
const table = image => [['วันที่', 'หัวข้อ', 'รูป'], ['2026-10-08', 'old', image], [], ['09/10/2569', 'latest', image], []];

test('Thai timezone boundary and supported date formats', () => {
  assert.equal(dayInZone(new Date('2026-10-08T18:00:00Z')), '2026-10-09');
  assert.equal(normalizeSheetDate('09/10/2569'), '2026-10-09');
  assert.equal(normalizeSheetDate('2026-10-08T18:00:00Z'), '2026-10-09');
  const serial = (Date.UTC(2026, 9, 9) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.equal(normalizeSheetDate(serial + 0.75), '2026-10-09');
  assert.throws(() => normalizeSheetDate('31/02/2569'), /INVALID_DATE/);
  assert.throws(() => normalizeSheetDate('2026-10-09 06:00:00'), /INVALID_DATE/);
});

test('physical latest nonblank row; preserves row number and escapes sheet name', async () => {
  const row = await readLatestRow({ ...config, fetchImpl: async (url, options) => {
    assert.match(decodeURIComponent(url.pathname), /'News'' tab'!A1:Z$/);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return sheet(table('https://example.com/image.png'));
  } });
  assert.equal(row.rowNumber, 4);
  assert.equal(row.data['หัวข้อ'], 'latest');
});

test('date mismatch skips without downloading or looking for previous matching rows', async () => {
  let calls = 0;
  const result = await prepareLatestNews({ ...config, fetchImpl: async () => {
    calls++;
    return sheet([['วันที่', 'รูป'], ['2026-10-09', 'https://example.com/a.png'], ['2026-10-08', 'https://example.com/b.png']]);
  } });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'date_mismatch');
  assert.equal(calls, 1);
});

test('empty, missing image, missing date column and malformed date', async () => {
  assert.deepEqual(await prepareLatestNews({ ...config, fetchImpl: async () => sheet([]) }), { status: 'empty' });
  const missing = await prepareLatestNews({ ...config, fetchImpl: async () => sheet(table('')) });
  assert.equal(missing.reason, 'missing_image');
  await assert.rejects(prepareLatestNews({ ...config, fetchImpl: async () => sheet([['wrong'], ['2026-10-09']]) }), /MISSING_COLUMN/);
  await assert.rejects(prepareLatestNews({ ...config, fetchImpl: async () => sheet([['วันที่'], ['bad']]) }), /INVALID_DATE/);
});

test('each invocation derives today again across Bangkok midnight', async () => {
  const fetchImpl = async () => sheet(table(''));
  const before = await prepareLatestNews({ ...config, now: new Date('2026-10-08T16:59:59Z'), fetchImpl });
  const after = await prepareLatestNews({ ...config, now: new Date('2026-10-08T17:00:00Z'), fetchImpl });
  assert.equal(before.expectedDate, '2026-10-08');
  assert.equal(before.reason, 'date_mismatch');
  assert.equal(after.expectedDate, '2026-10-09');
  assert.equal(after.reason, 'missing_image');
});

test('ready: saves actual bytes, absolute paths, stable key; no token sent to public host', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'news-test-'));
  try {
    const fetchImpl = async (url, options) => {
      if (url.hostname === 'sheets.googleapis.com') return sheet(table('https://example.com/image'));
      assert.equal(options.headers.Authorization, undefined);
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    };
    const a = await prepareLatestNews({ ...config, outputDir, fetchImpl });
    const b = await prepareLatestNews({ ...config, outputDir, fetchImpl });
    assert.equal(a.status, 'ready');
    assert.equal(a.taskKey, b.taskKey);
    assert.notEqual(a.images[0].localPath, b.images[0].localPath);
    assert.equal(path.isAbsolute(a.images[0].localPath), true);
    assert.deepEqual(await readFile(a.images[0].localPath), png);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('Drive link uses authenticated media API, including resource key', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'news-test-'));
  try {
    await downloadImage('https://drive.google.com/file/d/file_123/view?resourcekey=key1', {
      ...config, outputDir, fetchImpl: async (url, options) => {
        assert.equal(url.hostname, 'www.googleapis.com');
        assert.equal(url.searchParams.get('alt'), 'media');
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        assert.equal(options.headers['X-Goog-Drive-Resource-Keys'], 'file_123/key1');
        return new Response(png);
      },
    });
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('rejects HTML, oversized streamed content and HTTP failures without creating files', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'news-test-'));
  try {
    await assert.rejects(downloadImage('https://example.com/login', { outputDir, fetchImpl: async () => new Response('<html>login</html>') }), /INVALID_IMAGE/);
    await assert.rejects(downloadImage('https://example.com/image', { outputDir, maxBytes: 10, fetchImpl: async () => new Response(png) }), /IMAGE_TOO_LARGE/);
    await assert.rejects(readLatestRow({ ...config, fetchImpl: async () => new Response('', { status: 403 }) }), /SHEETS_HTTP_403/);
    assert.deepEqual(await readdir(outputDir), []);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('multiple images: removes previously saved files if a later download fails', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'news-test-'));
  try {
    await assert.rejects(prepareLatestNews({ ...config, outputDir, fetchImpl: async url => {
      if (url.hostname === 'sheets.googleapis.com') return sheet(table('["https://example.com/a", "https://example.com/b"]'));
      return url.pathname === '/a' ? new Response(png) : new Response('error', { status: 404 });
    } }), /IMAGE_HTTP_404/);
    assert.deepEqual(await readdir(outputDir), []);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});
