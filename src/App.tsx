import { useEffect, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageLoader } from "@/components/ui/spinner";
import { useUserStore } from "@/stores/user";
import { canAccessPath, firstAccessibleHref } from "@/lib/permissions";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ChallanListPage } from "@/pages/ChallanListPage";
import { ChallanFormPage } from "@/pages/ChallanFormPage";
import { ChallanPrintPage } from "@/pages/ChallanPrintPage";
import { ScanPage } from "@/pages/ScanPage";
import { BillingListPage } from "@/pages/BillingListPage";
import { BillingGeneratePage } from "@/pages/BillingGeneratePage";
import { BillingDetailPage } from "@/pages/BillingDetailPage";
import { BillingEditPage } from "@/pages/BillingEditPage";
import { BillingPrintPage } from "@/pages/BillingPrintPage";
import { MastersPage } from "@/pages/MastersPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SyncPage } from "@/pages/SyncPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initializing } = useUserStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!initializing && !user) {
      navigate("/login", { replace: true });
    } else if (!initializing && user && !canAccessPath(user.role, pathname)) {
      navigate(firstAccessibleHref(user.role), { replace: true });
    }
  }, [initializing, user, pathname, navigate]);

  if (initializing) return <PageLoader label="Loading workspace…" />;
  if (!user) return null;
  if (!canAccessPath(user.role, pathname)) return null;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, initializing } = useUserStore();
  if (initializing) return <PageLoader label="Loading…" />;
  if (user) return <Navigate to={firstAccessibleHref(user.role)} replace />;
  return <>{children}</>;
}

export default function App() {
  useEffect(() => {
    void useUserStore.getState().init();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <LoginPage />
            </PublicOnly>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/challans" element={<ChallanListPage documentType="incoming" />} />
          <Route path="/challans/outgoing" element={<ChallanListPage documentType="outgoing" />} />
          <Route path="/challans/new" element={<ChallanFormPage />} />
          <Route path="/challans/:id" element={<ChallanFormPage />} />
          <Route path="/challans/:id/print" element={<ChallanPrintPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/billing" element={<BillingListPage />} />
          <Route path="/billing/generate" element={<BillingGeneratePage />} />
          <Route path="/billing/:id" element={<BillingDetailPage />} />
          <Route path="/billing/:id/edit" element={<BillingEditPage />} />
          <Route path="/billing/:id/print" element={<BillingPrintPage />} />
          <Route path="/masters" element={<MastersPage />} />
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}