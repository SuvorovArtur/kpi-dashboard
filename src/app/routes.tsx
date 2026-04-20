import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Skeleton } from '../shared/ui';

const Overview = lazy(() => import('../pages/Overview/Overview'));
const KpiDetail = lazy(() => import('../pages/KpiDetail/KpiDetail'));
const Appeals = lazy(() => import('../pages/Appeals/Appeals'));
const ISN = lazy(() => import('../pages/ISN/ISN'));
const Settings = lazy(() => import('../pages/Settings/Settings'));
const Attendance = lazy(() => import('../pages/Attendance/Attendance'));
const SocialMonitor = lazy(() => import('../pages/SocialMonitor/SocialMonitor'));
const HeatMap = lazy(() => import('../pages/HeatMap/HeatMap'));

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
        <Route path="/appeals" element={<Appeals />} />
        <Route path="/isn" element={<ISN />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/social" element={<SocialMonitor />} />
        <Route path="/map" element={<HeatMap />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
