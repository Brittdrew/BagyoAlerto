import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import Forecast from './pages/Forecast'
import { AdminAuthProvider } from './context/AdminAuthContext'
import AdminProtectedRoute from './components/AdminProtectedRoute'
import AdminLogin from './pages/admin/AdminLogin'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminBarangays from './pages/admin/AdminBarangays'
import AdminEvacuationCenters from './pages/admin/AdminEvacuationCenters'
import AdminHistory from './pages/admin/AdminHistory'
import AdminSettings from './pages/admin/AdminSettings'
import AdminWeather from './pages/admin/AdminWeather'
import AdminWeatherMap from './pages/admin/AdminWeatherMap'
import './App.css'

function App() {
  return (
    <AdminAuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/forecast" element={<Forecast />} />
          <Route path="/history" element={<History />} />

          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={
            <AdminProtectedRoute><AdminDashboard /></AdminProtectedRoute>
          } />
          <Route path="/admin/weather" element={
            <AdminProtectedRoute><AdminWeather /></AdminProtectedRoute>
          } />
          <Route path="/admin/weather-map" element={
            <AdminProtectedRoute><AdminWeatherMap /></AdminProtectedRoute>
          } />
          <Route path="/admin/barangays" element={
            <AdminProtectedRoute><AdminBarangays /></AdminProtectedRoute>
          } />
          <Route path="/admin/evacuation-centers" element={
            <AdminProtectedRoute><AdminEvacuationCenters /></AdminProtectedRoute>
          } />
          <Route path="/admin/history" element={
            <AdminProtectedRoute><AdminHistory /></AdminProtectedRoute>
          } />
          <Route path="/admin/settings" element={
            <AdminProtectedRoute><AdminSettings /></AdminProtectedRoute>
          } />
          <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
        </Routes>
      </Router>
    </AdminAuthProvider>
  )
}

export default App
