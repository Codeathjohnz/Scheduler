import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

import authRoutes from './routes/auth.js'
import otpRoutes from './routes/otp.js'
import userRoutes from './routes/users.js'
import submissionRoutes from './routes/submissions.js'
import roomRoutes from './routes/rooms.js'
import scheduleRoutes from './routes/schedules.js'
import accessibilityRoutes from './routes/accessibility.js'
import prospectusRoutes from './routes/prospectus.js'
import facultyLoadRoutes from './routes/facultyload.js'
import schedulingRoutes from './routes/scheduling.js'
import adminRoutes from './routes/admin.js'
import buildingPriorityRoutes from './routes/buildingPriorities.js'
import loadRequestRoutes from './routes/loadRequests.js'

dotenv.config()

const app = express()

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:5174']
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '10mb' }))  // headroom for base64-encoded prospectus .docx uploads

app.use('/api/auth', authRoutes)
app.use('/api/otp', otpRoutes)
app.use('/api/users', userRoutes)
app.use('/api/submissions', submissionRoutes)
app.use('/api/rooms', roomRoutes)
app.use('/api/schedules', scheduleRoutes)
app.use('/api/accessibility', accessibilityRoutes)
app.use('/api/prospectus', prospectusRoutes)
app.use('/api/faculty-load', facultyLoadRoutes)
app.use('/api/scheduling', schedulingRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/building-priorities', buildingPriorityRoutes)
app.use('/api/load-requests', loadRequestRoutes)

app.get('/api/health', (_, res) => res.json({ status: 'ok', system: 'ADSSU Room Scheduling API' }))

// Serve built React frontend — works both locally (../client/dist) and in Docker (./public)
const dockerDist = join(__dirname, 'public')
const localDist  = join(__dirname, '../client/dist')
const clientDist = existsSync(dockerDist) ? dockerDist : existsSync(localDist) ? localDist : null

if (clientDist) {
  app.use(express.static(clientDist))
  // SPA fallback — all non-API routes return index.html
  app.use((req, res) => res.sendFile(join(clientDist, 'index.html')))
  console.log(`Serving frontend from: ${clientDist}`)
}

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))
