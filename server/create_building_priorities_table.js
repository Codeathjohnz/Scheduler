import pool from './config/db.js'

await pool.query(`
  CREATE TABLE IF NOT EXISTS building_priorities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    building VARCHAR(50) NOT NULL,
    program VARCHAR(100) NOT NULL,
    priority INT NOT NULL,
    UNIQUE KEY uq_building_program (building, program),
    UNIQUE KEY uq_building_priority (building, priority)
  )
`)

console.log('building_priorities table created.')
await pool.end()
