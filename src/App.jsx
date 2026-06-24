import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import RoleRoute from './components/RoleRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import Roster from './pages/Roster'
import Boarding from './pages/Boarding'
import Penalties from './pages/Penalties'
import Configuration from './pages/Configuration'
import Reports from './pages/Reports'
import CMView from './pages/CMView'
import OngcHeadView from './pages/OngcHeadView'

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
        <Route
          index
          element={
            <RoleRoute roles={['hr_manager']}>
              <Dashboard />
            </RoleRoute>
          }
        />
        <Route
          path="employees"
          element={
            <RoleRoute roles={['hr_manager']}>
              <Employees />
            </RoleRoute>
          }
        />
        <Route
          path="roster"
          element={
            <RoleRoute roles={['hr_manager', 'catering_manager']}>
              <Roster />
            </RoleRoute>
          }
        />
        <Route
          path="boarding"
          element={
            <RoleRoute roles={['hr_manager']}>
              <Boarding />
            </RoleRoute>
          }
        />
        <Route
          path="penalties"
          element={
            <RoleRoute roles={['hr_manager']}>
              <Penalties />
            </RoleRoute>
          }
        />
        <Route
          path="configuration"
          element={
            <RoleRoute roles={['hr_manager']}>
              <Configuration />
            </RoleRoute>
          }
        />
        <Route
          path="reports"
          element={
            <RoleRoute roles={['hr_manager']}>
              <Reports />
            </RoleRoute>
          }
        />
        <Route
          path="cm"
          element={
            <RoleRoute roles={['catering_manager']}>
              <CMView />
            </RoleRoute>
          }
        />
        <Route
          path="ongc-head"
          element={
            <RoleRoute roles={['ongc_head']}>
              <OngcHeadView />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
