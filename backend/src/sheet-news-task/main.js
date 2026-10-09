import { readSheetIntelligence } from './connector/read-sheet-intelligence.js'
import { readSheetKhmer } from './connector/read-sheet-khmer.js'
import { readSheetBlue } from './connector/read-sheet-blue.js'

await readSheetIntelligence()
await readSheetKhmer()
await readSheetBlue()
