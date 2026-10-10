import { readSheet } from '../utils/read-sheet.js'
import DriveImageDownloader from '../utils/DriveImageDownloader.js'

// Change this to the tab name at the bottom of your Google Sheet.
const spreadsheetId = process.env.GOOGLE_SHEET_INTELLIGENCE_ID
const sheet = 'Sheet1'

const downloader = new DriveImageDownloader({
  outputDir: './downloads/intelligence',
})

const readSheetIntelligence = async () => {
  try {
    const data = await readSheet(spreadsheetId, sheet)
    const lastRow = data.pop()
    const FILE_ID = lastRow[lastRow.length - 1]
    const image = await downloader.download(FILE_ID)
    const postText = `${lastRow[3]}\n${lastRow[4]}\n\n${lastRow[5]}`
    return { postText, imagePath: image.localPath }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

export { readSheetIntelligence }
