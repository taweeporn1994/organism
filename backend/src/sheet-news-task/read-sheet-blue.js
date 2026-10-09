import { readSheet } from './utils/read-sheet.js'
import DriveImageDownloader from './utils/DriveImageDownloader.js'

// Change this to the tab name at the bottom of your Google Sheet.
const spreadsheetId = process.env.GOOGLE_SHEET_BLUE_ID
const sheet = 'ข่าวการเมืองน้ำเงิน'

const downloader = new DriveImageDownloader({
  outputDir: './downloads/blue',
})

const readSheetBlue = async () => {
  try {
    const data = await readSheet(spreadsheetId, sheet)
    const lastRow = data.pop()
    console.log(lastRow)
    const FILE_ID = lastRow[lastRow.length - 1]
    const image = await downloader.download(FILE_ID)
    console.log(image.localPath)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
export { readSheetBlue }
