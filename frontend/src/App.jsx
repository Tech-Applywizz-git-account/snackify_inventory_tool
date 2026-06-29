import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import InactivityLock from './components/InactivityLock.jsx';
import Layout from './components/Layout.jsx';
import { useAuth } from './hooks/useAuth.js';
import { supabase } from './lib/supabase.js';
import AdminPage from './pages/Admin.jsx';
import AuditLogPage from './pages/AuditLog.jsx';
import BillApprovalPage from './pages/BillApproval.jsx';
import BillUploadPage from './pages/BillUpload.jsx';
import CafeteriaPage from './pages/Cafeteria.jsx';
import ConnectionsPage from './pages/Connections.jsx';
import DailyUpdatePage from './pages/DailyUpdate.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import FinancePage from './pages/Finance.jsx';
import LiveTrackingPage from './pages/LiveTracking.jsx';
import LoginPage from './pages/Login.jsx';
import ManualPurchasesPage from './pages/ManualPurchases.jsx';
import MealBookingPage from './pages/MealBooking.jsx';
import MealHistoryPage from './pages/MealHistory.jsx';
import MealTokenDashboardPage from './pages/MealTokenDashboard.jsx';
import MyMealBoxPage from './pages/MyMealBox.jsx';
import OnboardingPage from './pages/Onboarding.jsx';
import OrderHistoryPage from './pages/OrderHistory.jsx';
import PreferencesPage from './pages/Preferences.jsx';
import RequestQueuePage from './pages/RequestQueue.jsx';
import StaffViewPage from './pages/StaffView.jsx';

function Protected({ children, allow }) {
  const { session, profile, loading, aal } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  // Require MFA (AAL2) — if only AAL1, send back to login for TOTP step
  if (aal !== 'aal2') return <Navigate to="/login" replace />;
  if (allow && profile && !allow.includes(profile.role)) {
    return <div className="p-8 text-rose-600">Access denied for role: {profile.role}</div>;
  }
  return children;
}

/** Redirect to the right home page based on role */
function RoleHome() {
  const { session, profile, loading } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  // Session exists but no profile after retries = deleted/orphaned account → sign out
  useEffect(() => {
    if (!loading && session && !profile && !signingOut) {
      setSigningOut(true);
      supabase.auth.signOut();
    }
  }, [loading, session, profile, signingOut]);

  if (loading || signingOut)
    return (
      <div className="min-h-screen grid place-items-center bg-white">
        <div className="w-6 h-6 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    );
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/login" replace />;

  const roleHome = {
    leadership: '/dashboard',
    finance: '/dashboard',
    facility_manager: '/dashboard',
    office_boy: '/queue',
    staff: '/request',
  };
  return <Navigate to={roleHome[profile.role] || '/request'} replace />;
}

/**
 * OnboardingGate – wraps the entire authenticated app.
 * Checks whether the current user has completed cafeteria onboarding.
 * If not, shows the onboarding flow before rendering children.
 */
function OnboardingGate({ children }) {
  const { session, loading: authLoading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (authLoading || !session) return;

    async function check() {
      try {
        const { data } = await supabase
          .from('employee_cafeteria_preferences')
          .select('onboarding_completed')
          .eq('user_id', session.user.id)
          .maybeSingle();

        // Show onboarding if row is missing OR onboarding_completed is false/null
        setNeedsSetup(!data?.onboarding_completed);
      } catch {
        // Table might not exist yet — skip onboarding gracefully
        setNeedsSetup(false);
      } finally {
        setChecking(false);
      }
    }

    check();
  }, [session, authLoading]);

  if (authLoading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-10 w-10 border-4 border-brand/20 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  if (needsSetup) {
    return <OnboardingPage onComplete={() => setNeedsSetup(false)} />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <OnboardingGate>
              <InactivityLock>
                <Layout />
              </InactivityLock>
            </OnboardingGate>
          </Protected>
        }
      >
        <Route index element={<RoleHome />} />
        <Route
          path="/dashboard"
          element={
            <Protected allow={['facility_manager', 'finance', 'leadership']}>
              <DashboardPage />
            </Protected>
          }
        />
        <Route
          path="/available"
          element={
            <Protected allow={['facility_manager', 'finance', 'leadership', 'office_boy']}>
              <StaffViewPage />
            </Protected>
          }
        />
        {/* /request now renders the full cafeteria UI for all roles */}
        <Route path="/request" element={<CafeteriaPage />} />
        <Route path="/track/:id" element={<LiveTrackingPage />} />
        <Route path="/meals" element={<MealBookingPage />} />
        <Route path="/meal-history" element={<MealHistoryPage />} />
        <Route path="/my-meal-box" element={<MyMealBoxPage />} />
        <Route
          path="/meal-token-dashboard"
          element={
            <Protected allow={['office_boy', 'facility_manager', 'leadership']}>
              <MealTokenDashboardPage />
            </Protected>
          }
        />
        <Route path="/orders" element={<OrderHistoryPage />} />
        <Route path="/settings" element={<PreferencesPage />} />
        <Route
          path="/queue"
          element={
            <Protected allow={['office_boy', 'facility_manager', 'leadership']}>
              <RequestQueuePage />
            </Protected>
          }
        />
        <Route
          path="/bills"
          element={
            <Protected allow={['office_boy', 'facility_manager', 'leadership', 'finance']}>
              <BillUploadPage />
            </Protected>
          }
        />
        <Route
          path="/bills/approve"
          element={
            <Protected allow={['leadership', 'finance']}>
              <BillApprovalPage />
            </Protected>
          }
        />
        <Route
          path="/daily-update"
          element={
            <Protected allow={['facility_manager', 'leadership']}>
              <DailyUpdatePage />
            </Protected>
          }
        />
        <Route
          path="/finance"
          element={
            <Protected allow={['finance', 'leadership']}>
              <FinancePage />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected allow={['leadership']}>
              <AdminPage />
            </Protected>
          }
        />
        <Route
          path="/reports"
          element={
            <Protected allow={['leadership']}>
              <AuditLogPage />
            </Protected>
          }
        />
        <Route
          path="/connections"
          element={
            <Protected allow={['leadership']}>
              <ConnectionsPage />
            </Protected>
          }
        />
        <Route
          path="/manual-purchases"
          element={
            <Protected allow={['finance', 'leadership', 'facility_manager', 'office_boy']}>
              <ManualPurchasesPage />
            </Protected>
          }
        />
      </Route>
    </Routes>
  );
}
