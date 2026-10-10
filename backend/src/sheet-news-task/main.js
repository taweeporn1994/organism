import { readSheetIntelligence } from './connector/read-sheet-intelligence.js'
import { readSheetKhmer } from './connector/read-sheet-khmer.js'
import { readSheetBlue } from './connector/read-sheet-blue.js'

const intelligencePost = await readSheetIntelligence()
const khmerPost = await readSheetKhmer()
const bluePost = await readSheetBlue()
console.log(intelligencePost)
console.log(khmerPost)
console.log(bluePost)
