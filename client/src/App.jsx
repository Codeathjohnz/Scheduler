import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth, ROLES } from './context/AuthContext.jsx'

import LoginPage from './pages/auth/LoginPage.jsx'

// Chair pages
import ChairLayout from './layouts/ChairLayout.jsx'
import ChairDashboard from './pages/chair/Dashboard.jsx'
import ChairSubmission from './pages/chair/Submission.jsx'
import ChairScheduleView from './pages/chair/ScheduleView.jsx'
import ChairFacultyLoad from './pages/chair/FacultyLoad.jsx'
import ChairLoadRequests from './pages/chair/LoadRequests.jsx'

// Dean pages
import DeanLayout from './layouts/DeanLayout.jsx'
import DeanDashboard from './pages/dean/Dashboard.jsx'
import DeanReview from './pages/dean/Review.jsx'

// Quality Assurance pages
import QALayout from './layouts/QALayout.jsx'
import QADashboard from './pages/qa/Dashboard.jsx'
import QAReview from './pages/qa/Review.jsx'

// VPAA pages
import VPAALayout from './layouts/VPAALayout.jsx'
import VPAADashboard from './pages/vpaa/Dashboard.jsx'
import VPAAReview from './pages/vpaa/Review.jsx'

// Admin pages
import AdminLayout from './layouts/AdminLayout.jsx'
import AdminDashboard from './pages/admin/Dashboard.jsx'
import AdminUserManagement from './pages/admin/UserManagement.jsx'
import AdminValidation from './pages/admin/Validation.jsx'
import AdminRooms from './pages/admin/Rooms.jsx'
import AdminScheduleApproval from './pages/admin/ScheduleApproval.jsx'
import AdminAccessibility from './pages/admin/Accessibility.jsx'
import AdminRealTimeRooms from './pages/admin/RealTimeRooms.jsx'
import AdminScheduleGenerator from './pages/admin/ScheduleGenerator.jsx'

// Instructor pages
import InstructorLayout from './layouts/InstructorLayout.jsx'
import InstructorDashboard from './pages/instructor/Dashboard.jsx'
import InstructorSchedule from './pages/instructor/Schedule.jsx'
import InstructorConfirmLoad from './pages/instructor/ConfirmLoad.jsx'
import InstructorSpecialty from './pages/instructor/MySpecialty.jsx'
import InstructorAccessibility from './pages/instructor/AccessibilityRequest.jsx'
import InstructorLoadRequest from './pages/instructor/LoadRequest.jsx'

// Student pages
import StudentLayout from './layouts/StudentLayout.jsx'
import StudentDashboard from './pages/student/Dashboard.jsx'
import StudentSchedule from './pages/student/Schedule.jsx'

function RoleRoute({ role, children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to="/login" replace />
  return children
}

function RootRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  const paths = {
    [ROLES.CHAIR]: '/chair',
    [ROLES.DEAN]: '/dean',
    [ROLES.QUALITY_ASSURANCE]: '/qa',
    [ROLES.VPAA]: '/vpaa',
    [ROLES.ADMIN]: '/admin',
    [ROLES.INSTRUCTOR]: '/instructor',
    [ROLES.STUDENT]: '/student',
  }
  return <Navigate to={paths[user.role] || '/login'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />

          {/* Program Chair */}
          <Route path="/chair" element={<RoleRoute role={ROLES.CHAIR}><ChairLayout /></RoleRoute>}>
            <Route index element={<ChairDashboard />} />
            <Route path="submission" element={<ChairSubmission />} />
            <Route path="schedule" element={<ChairScheduleView />} />
            <Route path="faculty-load" element={<ChairFacultyLoad />} />
            <Route path="load-requests" element={<ChairLoadRequests />} />
            <Route path="confirm-load" element={<InstructorConfirmLoad />} />
            <Route path="specialty" element={<InstructorSpecialty />} />
            <Route path="accessibility" element={<InstructorAccessibility />} />
          </Route>

          {/* Dean */}
          <Route path="/dean" element={<RoleRoute role={ROLES.DEAN}><DeanLayout /></RoleRoute>}>
            <Route index element={<DeanDashboard />} />
            <Route path="review" element={<DeanReview />} />
            <Route path="confirm-load" element={<InstructorConfirmLoad />} />
            <Route path="specialty" element={<InstructorSpecialty />} />
            <Route path="accessibility" element={<InstructorAccessibility />} />
          </Route>

          {/* Quality Assurance */}
          <Route path="/qa" element={<RoleRoute role={ROLES.QUALITY_ASSURANCE}><QALayout /></RoleRoute>}>
            <Route index element={<QADashboard />} />
            <Route path="review" element={<QAReview />} />
          </Route>

          {/* VPAA */}
          <Route path="/vpaa" element={<RoleRoute role={ROLES.VPAA}><VPAALayout /></RoleRoute>}>
            <Route index element={<VPAADashboard />} />
            <Route path="review" element={<VPAAReview />} />
          </Route>

          {/* Admin/Registrar */}
          <Route path="/admin" element={<RoleRoute role={ROLES.ADMIN}><AdminLayout /></RoleRoute>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUserManagement />} />
            <Route path="validation" element={<AdminValidation />} />
            <Route path="rooms" element={<AdminRooms />} />
            <Route path="schedule-approval" element={<AdminScheduleApproval />} />
            <Route path="accessibility" element={<AdminAccessibility />} />
            <Route path="realtime-rooms" element={<AdminRealTimeRooms />} />
            <Route path="schedule-generator" element={<AdminScheduleGenerator />} />
          </Route>

          {/* Instructor */}
          <Route path="/instructor" element={<RoleRoute role={ROLES.INSTRUCTOR}><InstructorLayout /></RoleRoute>}>
            <Route index element={<InstructorDashboard />} />
            <Route path="schedule" element={<InstructorSchedule />} />
            <Route path="confirm-load" element={<InstructorConfirmLoad />} />
            <Route path="specialty" element={<InstructorSpecialty />} />
            <Route path="accessibility" element={<InstructorAccessibility />} />
            <Route path="load-request" element={<InstructorLoadRequest />} />
          </Route>

          {/* Student */}
          <Route path="/student" element={<RoleRoute role={ROLES.STUDENT}><StudentLayout /></RoleRoute>}>
            <Route index element={<StudentDashboard />} />
            <Route path="schedule" element={<StudentSchedule />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
