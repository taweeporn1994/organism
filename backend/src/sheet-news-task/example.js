import { prepareLatestNews } from './sheet-news.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { getGoogleAccessToken } from './google-auth.js';

// Export this function and let your own scheduler call it.
export async function scheduledNewsTask() {
  const result = await prepareLatestNews({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    sheetName: process.env.GOOGLE_SHEET_TAB || 'Sheet1',
    dateColumn: process.env.NEWS_DATE_COLUMN || 'วันที่จัดเก็บ',
    imageColumn: process.env.NEWS_IMAGE_COLUMN || 'รูป',
    outputDir: process.env.NEWS_IMAGE_DIR || './downloads/news',
    timeZone: process.env.NEWS_TIMEZONE || 'Asia/Bangkok',
    getAccessToken: getGoogleAccessToken,
    // Today's date is calculated again on EVERY invocation.
  });

  if (result.status !== 'ready') return result;
  // Your project takes over here: check result.taskKey against your DB,
  // create the task using result.data and result.images[*].localPath,
  // then mark processed only AFTER the downstream action succeeds.
  return result;
}

// One-shot CLI example. Importing this file will not run the task.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  scheduledNewsTask().then(
    result => console.log(JSON.stringify(result, null, 2)),
    error => { console.error(error.message); process.exitCode = 1; },
  );
}
