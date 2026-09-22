import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(config => {
  try {
    // "Remember me" on login decides which of these holds the session — see AuthContext.jsx
    const stored = localStorage.getItem('adssu_user') || sessionStorage.getItem('adssu_user')
    if (stored) {
      const user = JSON.parse(stored)
      if (user.token) config.headers.Authorization = `Bearer ${user.token}`
    }
  } catch {}
  return config
})

export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
}

export const otpAPI = {
  send:           ()                    => api.post('/otp/send'),
  verify:         (otp)                 => api.post('/otp/verify', { otp }),
  changePassword: (otp, newPassword)    => api.post('/otp/change-password', { otp, newPassword }),
}

export const usersAPI = {
  getAll:  ()           => api.get('/users'),
  getOne:  (id)         => api.get(`/users/${id}`),
  getProgramOptions: (department) => api.get(`/users/program-options?department=${encodeURIComponent(department || '')}`),
  setMyPrograms:     (programs)   => api.put('/users/me/programs', { programs }),
  setMyCrossDept:    (open)       => api.put('/users/me/cross-dept', { open }),
  create:  (data)       => api.post('/users', data),
  update:  (id, data)   => api.put(`/users/${id}`, data),
  remove:  (id)         => api.delete(`/users/${id}`),
  getSignature:    ()        => api.get('/users/signature'),
  setSignature:    (dataUri) => api.put('/users/signature', { data: dataUri }),
  removeSignature: ()        => api.delete('/users/signature'),
}

export const submissionsAPI = {
  create:                (data)          => api.post('/submissions', data),
  submitFromFacultyLoad: (data)          => api.post('/submissions/from-faculty-load', data),
  getMyTermStatus:       (year, sem)     => api.get(`/submissions/my-status?year=${year}&semester=${sem}`),
  getMy:                 ()             => api.get('/submissions/my'),
  getForVPAA:            ()             => api.get('/submissions/vpaa'),
  getForAdmin:           ()             => api.get('/submissions/admin'),
  getEntries:            (id)           => api.get(`/submissions/${id}/entries`),
  vpaaAction:            (id, action)   => api.patch(`/submissions/${id}/vpaa`, { action }),
  adminAction:           (id, action)   => api.patch(`/submissions/${id}/admin`, { action }),
  remove:                (id)           => api.delete(`/submissions/${id}`),
  // Instructor confirmation
  getMyConfirmations:    ()             => api.get('/submissions/my-confirmations'),
  getMyEntries:          (id)           => api.get(`/submissions/${id}/my-entries`),
  confirm:               (id)           => api.patch(`/submissions/${id}/confirm`),
  // Dean
  getForDean:            ()             => api.get('/submissions/dean'),
  deanAction:            (id, action)   => api.patch(`/submissions/${id}/dean`, { action }),
  deanRevert:            (id)           => api.patch(`/submissions/${id}/dean-revert`),
  // Chief Curriculum Planning and Development
  getForChiefCPD:        ()             => api.get('/submissions/chief-cpd'),
  chiefCpdAction:        (id, action)   => api.patch(`/submissions/${id}/chief-cpd`, { action }),
  chiefCpdRevert:        (id)           => api.patch(`/submissions/${id}/chief-cpd-revert`),
  // Quality Assurance
  getForQA:              ()             => api.get('/submissions/qa'),
  qaAction:              (id, action)   => api.patch(`/submissions/${id}/qa`, { action }),
}

// Asking an instructor from another department to teach — see server/routes/crossDept.js
export const crossDeptAPI = {
  mine:    ()               => api.get('/cross-dept/mine'),
  respond: (id, action, reason) => api.patch(`/cross-dept/${id}/respond`, { action, reason }),
  home:    ()               => api.get('/cross-dept/home'),
  homeAct: (id, action, reason) => api.patch(`/cross-dept/${id}/home`, { action, reason }),
  sent:    ()               => api.get('/cross-dept/sent'),
  cancel:  (id)             => api.delete(`/cross-dept/${id}`),
  counts:  ()               => api.get('/cross-dept/counts'),
  // Step 1: ask the other college's Dean for access to their instructors
  accessDepartments: (year, semester) => api.get(`/cross-dept/access/departments?year=${year}&semester=${semester}`),
  accessRequest:  (data)           => api.post('/cross-dept/access', data),
  accessSent:     ()               => api.get('/cross-dept/access/sent'),
  accessIncoming: ()               => api.get('/cross-dept/access/incoming'),
  accessAct:      (id, action, reason) => api.patch(`/cross-dept/access/${id}`, { action, reason }),
  accessCancel:   (id)             => api.delete(`/cross-dept/access/${id}`),
}

export const placeholdersAPI = {
  fill:    (academic_year, semester) => api.post('/placeholders/fill', { academic_year, semester }),
  list:    (year, sem)               => api.get(`/placeholders?year=${year}&semester=${sem}`),
  replace: (id, data)                => api.post(`/placeholders/${id}/replace`, data),
  changes: ()                        => api.get('/placeholders/changes'),
  respond: (changeId, action)        => api.patch(`/placeholders/changes/${changeId}/respond`, { action }),
}

export const notificationsAPI = {
  list:        ()   => api.get('/notifications'),
  unreadCount: ()   => api.get('/notifications/unread-count'),
  read:        (id) => api.patch(`/notifications/${id}/read`),
  readAll:     ()   => api.post('/notifications/read-all'),
}

export const roomsAPI = {
  getAll:          ()     => api.get('/rooms'),
  getAvailability: ()     => api.get('/rooms/availability'),
  create:          (data) => api.post('/rooms', data),
  update:          (id, data) => api.put(`/rooms/${id}`, data),
  remove:          (id)   => api.delete(`/rooms/${id}`),
  bulkCreate:      (rooms) => api.post('/rooms/bulk', { rooms }),
}

export const buildingPriorityAPI = {
  getAll: ()                    => api.get('/building-priorities'),
  set:    (building, programs) => api.put(`/building-priorities/${encodeURIComponent(building)}`, { programs }),
}

export const schedulesAPI = {
  getAll:  ()              => api.get('/schedules'),
  approve: (id, action)   => api.patch(`/schedules/${id}/approve`, { action }),
}

export const accessibilityAPI = {
  submit:  (data)              => api.post('/accessibility', data),
  getMy:   ()                  => api.get('/accessibility/my'),
  getAll:  ()                  => api.get('/accessibility'),
  review:  (id, action, level) => api.patch(`/accessibility/${id}`, { action, level }),
}

export const loadRequestAPI = {
  submit:  (data)      => api.post('/load-requests', data),
  getMy:   ()          => api.get('/load-requests/my'),
  getAll:  ()          => api.get('/load-requests'),
  review:  (id, action) => api.patch(`/load-requests/${id}`, { action }),
}

export const facultyLoadAPI = {
  getAll:           (year, sem)             => api.get(`/faculty-load?year=${year}&semester=${sem}`),
  create:           (data)                  => api.post('/faculty-load', data),
  update:           (id, data)              => api.put(`/faculty-load/${id}`, data),
  remove:           (id)                    => api.delete(`/faculty-load/${id}`),
  getInstructors:   (subjectId, year, sem)  => api.get(`/faculty-load/instructors/${subjectId}?year=${year}&semester=${sem}`),
  getAllInstructors: (year, sem)             => api.get(`/faculty-load/instructors-all?year=${year}&semester=${sem}`),
  addAdminLoad:     (data)                  => api.post('/faculty-load/admin-load', data),
  removeAdminLoad:  (id)                    => api.delete(`/faculty-load/admin-load/${id}`),
  autoGenerate:     (data)                  => api.post('/faculty-load/auto-generate', data),
  getSectionCounts: (year, sem)             => api.get(`/faculty-load/section-counts?year=${year}&semester=${sem}`),
  setSectionCounts: (academic_year, semester, counts) => api.put('/faculty-load/section-counts', { academic_year, semester, counts }),
  getMyLoad:        (year, sem)             => api.get(`/faculty-load/my-load?year=${year}&semester=${sem}`),
  exportDocx:       (year, sem, collegeName, programName) => api.get(
    `/faculty-load/export-docx?year=${year}&semester=${sem}&collegeName=${encodeURIComponent(collegeName)}&programName=${encodeURIComponent(programName)}`,
    { responseType: 'blob' }
  ),
}

export const schedulingAPI = {
  getAll:   (year, sem) => api.get(`/scheduling?year=${year}&semester=${sem}`),
  getMy:    (year, sem) => api.get(`/scheduling/my?year=${year}&semester=${sem}`),
  getDept:  (year, sem) => api.get(`/scheduling/dept?year=${year}&semester=${sem}`),
  getMySection: (year, sem) => api.get(`/scheduling/my-section?year=${year}&semester=${sem}`),
  generate: (data)      => api.post('/scheduling/generate', data),
  update:   (id, data)  => api.put(`/scheduling/${id}`, data),
  publish:  (data)      => api.post('/scheduling/publish', data),
  clear:    (year, sem) => api.delete(`/scheduling/clear?year=${year}&semester=${sem}`),
  getRooms: ()          => api.get('/scheduling/rooms'),
}

export const prospectusAPI = {
  getAll:           ()        => api.get('/prospectus'),
  import:           (data)    => api.post('/prospectus', data),
  parseDocx:        (data)    => api.post('/prospectus/parse-docx', data),
  parsePdf:         (data)    => api.post('/prospectus/parse-pdf', data),
  remove:           (id)      => api.delete(`/prospectus/${id}`),
  getSubjects:      (id)      => api.get(`/prospectus/${id}/subjects`),
  getLatestSubjects:(semester) => api.get(`/prospectus/latest/subjects${semester ? `?semester=${semester}` : ''}`),
  getMySpecialties: ()        => api.get('/prospectus/specialties/me'),
  saveMySpecialties:(ids)     => api.put('/prospectus/specialties/me', { subject_ids: ids }),
  getInstructorSpecialties: (id) => api.get(`/prospectus/specialties/instructor/${id}`),
  getSpecialtyPeers: (semester) => api.get(`/prospectus/specialties/peers${semester ? `?semester=${semester}` : ''}`),
}

export default api
