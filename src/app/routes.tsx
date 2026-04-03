import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Skeleton } from '../shared/ui';

const Overview = lazy(() => import('../pages/Overview/Overview'));
const KpiDetail = lazy(() => import('../pages/KpiDetail/KpiDetail'));
const Territories = lazy(() => import('../pages/Territories/Territories'));
const Appeals = lazy(() => import('../pages/Appeals/Appeals'));
const Staff = lazy(() => import('../pages/Staff/Staff'));
const Roadmap = lazy(() => import('../pages/Roadmap/Roadmap'));
const Settings = lazy(() => import('../pages/Settings/Settings'));

const PageLoader = () => (
  <div style={{ padding: 32 }}>
    <Skeleton variant="card" />
    <div style={{ height: 16 }} />
    <Skeleton variant="chart" />
  </div>
);

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/kpi" element={<KpiDetail />} />
        <Route path="/territories" element={<Territories />} />
        <Route path="/appeals" element={<Appeals />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
