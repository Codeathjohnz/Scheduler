import mammoth from 'mammoth'
import { readFileSync } from 'fs'

const path = 'E:/Dether Software/Scheduling/client/public/ACTUAL-BSIT-FacultyLoading1stSem26-27 (1).docx'
const result = await mammoth.extractRawText({ path })
console.log('=== RAW TEXT ===')
console.log(result.value)
