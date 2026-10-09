import { readSheet } from './read-sheet.js';

// Change this to the tab name at the bottom of your Google Sheet.
const sheet = 'Sheet1';

try {
  const data = await readSheet(sheet);
  console.log(data.pop());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
