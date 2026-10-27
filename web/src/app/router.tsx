import type { Role } from '@rgk/core';
import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { ErrorState, PageSkeleton } from '@/components/ui/misc';
import { homeFor } from '@/lib/nav';
import { useMe, useSession } from '@/lib/session';
import { AdminDashboardPage, AuditLogPage, CalendarAdminPage, CorrectDailyPage, CorrectWeeklyPage, DepartmentsPage, HierarchyPage, ProjectsAdminPage, SettingsPage } from '@/pages/admin/AdminPages';
import { RegistrationsPage, RolesPage, UserCreatePage, UserEditPage, UsersPage } from '@/pages/admin/UserAdminPages';
import { ChoosePasswordPage } from '@/pages/auth/ChoosePasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ActivatePage, ForgotPasswordPage, RegisterPage, ResetPasswordPage } from '@/pages/auth/OtherAuthPages';
import { DailyEntryPage } from '@/pages/employee/DailyEntryPage';
import { DashboardPage } from '@/pages/employee/DashboardPage';
import { MyAnalyticsPage, MyProjectsPage, NotificationsPage, ProfilePage } from '@/pages/employee/PersonalPages';
import { DailyReportDetailPage, DailyReportListPage, WeeklyReportListPage } from '@/pages/employee/ReportPages';
import { WeeklyCreatePage, WeeklyDetailPage } from '@/pages/employee/WeeklyPages';
import { ManagerDashboardPage, PendingReviewsPage, TeamAnalyticsPage, TeamListPage } from '@/pages/manager/ManagerPages';
import {
  CompliancePage,
  DepartmentAnalyticsPage,
  DirectoryPage,
  ExportsPage,
  ManagementOverviewPage,
  PendingWorkPage,
  ProjectAnalyticsPage,
  ProjectDetailPage,
} from '@/pages/management/ManagementPages';
import { EmployeeDetailPage } from '@/pages/shared/EmployeeDetailPage';
import { WorkCalendarPage } from '@/pages/shared/WorkCalendarPage';
import { WidgetMyDayPage } from '@/pages/WidgetMyDayPage';

function RequireAuth() {
  const { status, error, signOut, me } = useSession();
  const location = useLocation();
  if (status === 'loading') return <div className="p-6"><PageSkeleton /></div>;
  if (status === 'signed-out') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (status === 'blocked') {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={error} />
        <div className="mt-4 text-center"><Button variant="outline" onClick={() => void signOut()}>Sign out</Button></div>
      </div>
    );
  }
  if (me?.user.mustChangePassword) return <ChoosePasswordPage />;
  return <AppShell />;
}

function PublicOnly() {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'signed-in') return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;
  return <Outlet />;
}

/**
 * Frontend role gate for navigation UX only. The server enforces the same rules on every request,
 * so bypassing this (e.g. editing the URL) shows an "Access denied" page and no data.
 */
function Allow({ roles, reporter, children }: { roles?: Role[]; reporter?: boolean; children: ReactNode }) {
  const me = useMe();
  const ok = (!roles || roles.includes(me.role)) && (!reporter || me.isReporter);
  if (!ok) return <ErrorState error={{ code: 'permission-denied', message: 'Your role does not have access to this page.' }} />;
  return <>{children}</>;
}

function Home() {
  const me = useMe();
  return <Navigate to={homeFor(me.role)} replace />;
}

function NotFound() {
  return <ErrorState error={{ message: 'This page does not exist.' }} />;
}

const MGR: Role[] = ['REPORTING_MANAGER'];
const MGMT: Role[] = ['MANAGEMENT', 'SUPER_ADMIN'];
const ADMIN: Role[] = ['SUPER_ADMIN'];

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  { path: '/activate', element: <ActivatePage /> },
  { path: '/widget/my-day', element: <WidgetMyDayPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <Home /> },
      // Employee (any reporting role)
      { path: '/dashboard', element: <Allow reporter><DashboardPage /></Allow> },
      { path: '/daily/today', element: <Allow reporter><DailyEntryPage /></Allow> },
      { path: '/daily/:date', element: <Allow reporter><DailyEntryPage /></Allow> },
      { path: '/reports/daily', element: <Allow reporter><DailyReportListPage mode="own" /></Allow> },
      { path: '/reports/daily/:id', element: <DailyReportDetailPage mode="own" /> },
      { path: '/weekly', element: <Allow reporter><WeeklyCreatePage /></Allow> },
      { path: '/reports/weekly', element: <Allow reporter><WeeklyReportListPage mode="own" /></Allow> },
      { path: '/reports/weekly/:id', element: <WeeklyDetailPage mode="own" /> },
      { path: '/my/projects', element: <Allow reporter><MyProjectsPage /></Allow> },
      { path: '/my/analytics', element: <Allow reporter><MyAnalyticsPage /></Allow> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/profile', element: <ProfilePage /> },
      { path: '/calendar', element: <WorkCalendarPage /> },
      // Reporting Manager
      { path: '/manager', element: <Allow roles={MGR}><ManagerDashboardPage /></Allow> },
      { path: '/team', element: <Allow roles={MGR}><TeamListPage /></Allow> },
      { path: '/team/analytics', element: <Allow roles={MGR}><TeamAnalyticsPage scope="team" /></Allow> },
      { path: '/team/compliance', element: <Allow roles={MGR}><CompliancePage scope="team" /></Allow> },
      { path: '/team/pending-work', element: <Allow roles={MGR}><PendingWorkPage scope="team" /></Allow> },
      { path: '/team/:id', element: <Allow roles={MGR}><EmployeeDetailPage context="team" /></Allow> },
      { path: '/reviews/pending', element: <Allow roles={MGR}><PendingReviewsPage /></Allow> },
      { path: '/reviews/daily', element: <Allow roles={MGR}><DailyReportListPage mode="team" /></Allow> },
      { path: '/reviews/daily/:id', element: <DailyReportDetailPage mode="review" /> },
      { path: '/reviews/weekly', element: <Allow roles={MGR}><WeeklyReportListPage mode="team" /></Allow> },
      { path: '/reviews/weekly/:id', element: <WeeklyDetailPage mode="review" /> },
      // Management (read-only) — Super Admin also has company analytics
      { path: '/management', element: <Allow roles={MGMT}><ManagementOverviewPage /></Allow> },
      { path: '/directory', element: <Allow roles={MGMT}><DirectoryPage /></Allow> },
      { path: '/departments', element: <Allow roles={MGMT}><DepartmentAnalyticsPage /></Allow> },
      { path: '/employees/:id', element: <EmployeeDetailPage context="company" /> },
      { path: '/projects', element: <Allow roles={MGMT}><ProjectAnalyticsPage /></Allow> },
      { path: '/projects/:id', element: <ProjectDetailPage /> },
      { path: '/compliance', element: <Allow roles={MGMT}><CompliancePage scope="company" /></Allow> },
      { path: '/pending-work', element: <Allow roles={MGMT}><PendingWorkPage scope="company" /></Allow> },
      { path: '/analytics', element: <Allow roles={MGMT}><TeamAnalyticsPage scope="company" /></Allow> },
      { path: '/exports', element: <Allow roles={MGMT}><ExportsPage /></Allow> },
      // Super Admin
      { path: '/admin', element: <Allow roles={ADMIN}><AdminDashboardPage /></Allow> },
      { path: '/admin/users', element: <Allow roles={ADMIN}><UsersPage /></Allow> },
      { path: '/admin/users/new', element: <Allow roles={ADMIN}><UserCreatePage /></Allow> },
      { path: '/admin/users/:id', element: <Allow roles={ADMIN}><UserEditPage /></Allow> },
      { path: '/admin/registrations', element: <Allow roles={ADMIN}><RegistrationsPage /></Allow> },
      { path: '/admin/roles', element: <Allow roles={ADMIN}><RolesPage /></Allow> },
      { path: '/admin/departments', element: <Allow roles={ADMIN}><DepartmentsPage /></Allow> },
      { path: '/admin/hierarchy', element: <Allow roles={ADMIN}><HierarchyPage /></Allow> },
      { path: '/admin/projects', element: <Allow roles={ADMIN}><ProjectsAdminPage /></Allow> },
      { path: '/admin/calendar', element: <Allow roles={ADMIN}><CalendarAdminPage /></Allow> },
      { path: '/admin/reports/daily', element: <Allow roles={ADMIN}><DailyReportListPage mode="admin" /></Allow> },
      { path: '/admin/reports/daily/:id', element: <Allow roles={ADMIN}><DailyReportDetailPage mode="admin" /></Allow> },
      { path: '/admin/reports/daily/:id/correct', element: <Allow roles={ADMIN}><CorrectDailyPage /></Allow> },
      { path: '/admin/reports/weekly', element: <Allow roles={ADMIN}><WeeklyReportListPage mode="admin" /></Allow> },
      { path: '/admin/reports/weekly/:id', element: <Allow roles={ADMIN}><WeeklyDetailPage mode="admin" /></Allow> },
      { path: '/admin/reports/weekly/:id/correct', element: <Allow roles={ADMIN}><CorrectWeeklyPage /></Allow> },
      { path: '/admin/audit', element: <Allow roles={ADMIN}><AuditLogPage /></Allow> },
      { path: '/admin/settings', element: <Allow roles={ADMIN}><SettingsPage /></Allow> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
