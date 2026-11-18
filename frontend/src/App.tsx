import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import AppShell from "./components/AppShell";
import ErrorBoundary from "./components/ErrorBoundary";
import ChangePassword from "./pages/ChangePassword";
import Login from "./pages/Login";
import { ListSkeleton } from "./ui";

const Network = lazy(() => import("./pages/Network"));
const Tree = lazy(() => import("./pages/Tree"));
const Kinship = lazy(() => import("./pages/Kinship"));
const PersonDetail = lazy(() => import("./pages/PersonDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const Admin = lazy(() => import("./pages/Admin"));
const Articles = lazy(() => import("./pages/Articles"));

function PageFallback() {
  return (
    <div className="page">
      <ListSkeleton />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const loc = useLocation();

  if (loading) return <PageFallback />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />} />
      </Routes>
    );
  }
  if (user.must_change_password) return <ChangePassword forced />;

  return (
    <AppShell>
      <ErrorBoundary resetKey={loc.pathname}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/network" replace />} />
            <Route path="/login" element={<Navigate to="/network" replace />} />
            <Route path="/network" element={<Network />} />
            <Route path="/tree" element={<Tree />} />
            <Route path="/kinship" element={<Kinship />} />
            <Route path="/persons/:id" element={<PersonDetail />} />
            <Route path="/me/*" element={<Profile />} />
            <Route path="/articles/*" element={<Articles />} />
            <Route path="/admin/*" element={user.role === "admin" ? <Admin /> : <Navigate to="/network" replace />} />
            <Route path="*" element={<Navigate to="/network" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
