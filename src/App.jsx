import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import Roster from './pages/Roster'
import Boarding from './pages/Boarding'
import Penalties from './pages/Penalties'
import Configuration from './pages/Configuration'
import Reports from './pages/Reports'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="roster" element={<Roster />} />
        <Route path="boarding" element={<Boarding />} />
        <Route path="penalties" element={<Penalties />} />
        <Route path="configuration" element={<Configuration />} />
        <Route path="reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
