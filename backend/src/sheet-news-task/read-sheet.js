/**
 * Read all cell values from a tab, including the header row.
 * Importing this module does not make a request or start a scheduled task.
 */
export async function readSheet(sheet, {
  spreadsheetId = process.env.GOOGLE_SHEET_ID,
  getAccessToken,
  fetchImpl = fetch,
} = {}) {
  if (typeof sheet !== 'string' || !sheet.trim()) {
    throw new Error('Set a nonempty sheet tab name in code');
  }
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID is missing');

  // A quoted tab name alone selects the whole tab, without a column limit.
  const range = `'${sheet.replaceAll("'", "''")}'`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set('majorDimension', 'ROWS');
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');

  const tokenProvider = getAccessToken ?? (await import('./google-auth.js')).getGoogleAccessToken;
  const token = await tokenProvider();
  if (!token || typeof token !== 'string') throw new Error('Google access token is missing');
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch {
    throw new Error(`Sheets ${response.status}: unexpected non-JSON response`);
  }
  if (!response.ok) {
    throw new Error(`Sheets ${response.status}: ${body.error?.message || 'Request failed'}`);
  }
  return body.values || [];
}
