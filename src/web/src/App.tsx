import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Journal } from './pages/Journal';
import { ChartOfAccounts } from './pages/ChartOfAccounts';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { TrialBalance } from './pages/TrialBalance';
import { PeriodManagement } from './pages/PeriodManagement';
import { CoWorkCredentials } from './pages/CoWorkCredentials';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public route — no layout, no auth required */}
        <Route path="/login" element={<Login />} />

        {/* All other routes are protected — redirect to /login if not authenticated */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/journal" element={<Journal />} />
                  <Route path="/accounts" element={<ChartOfAccounts />} />
                  <Route path="/approvals" element={<ApprovalQueue />} />
                  <Route path="/trial-balance" element={<TrialBalance />} />
                  <Route path="/periods" element={<PeriodManagement />} />
                  <Route path="/cowork" element={<CoWorkCredentials />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
