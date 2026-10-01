import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { AuthenticatedPage } from './pages/AuthenticatedPage';
import { AuthProvider, useAuth } from './auth/AuthProvider';
function AppRoutes() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/app" replace /> : <LoginPage />} />
      <Route
        path="/app"
        element={session ? <AuthenticatedPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={session ? '/app' : '/login'} replace />} />
    </Routes>
  );
}
export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
