import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileClock,
  FileText,
  FolderKanban,
  GitBranch,
  Gauge,
  History,
  Home,
  LayoutGrid,
  ListTodo,
  type LucideIcon,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCheck,
  UserCircle,
  Users,
  AlertOctagon,
} from 'lucide-react';
import type { Role } from '@rgk/core';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Also highlighted on these paths and below, e.g. both tabs of a tabbed page. */
  match?: string[];
}

/** Whether a menu item is the current page (same rules as NavLink, plus `match`). */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (item.match?.some(under)) return true;
  return item.end ? pathname === item.to : under(item.to);
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const myWork: NavSection = {
  title: 'My work',
  items: [
    { to: '/dashboard', label: 'Home', icon: Home },
    { to: '/daily/today', label: "Today's tasks", icon: ListTodo },
    { to: '/weekly', label: 'Weekly report', icon: CalendarCheck, end: true },
    { to: '/reports/daily', label: 'Report history', icon: History, match: ['/reports'] },
    { to: '/my/projects', label: 'My projects', icon: FolderKanban },
    { to: '/my/analytics', label: 'My progress', icon: BarChart3 },
  ],
};

const manager: NavSection = {
  title: 'My team',
  items: [
    { to: '/manager', label: 'My team', icon: Users, end: true },
    { to: '/reviews/pending', label: 'To review', icon: ClipboardCheck },
    { to: '/reviews/daily', label: 'Team reports', icon: FileText, match: ['/reviews/daily', '/reviews/weekly'] },
    { to: '/team', label: 'Team members', icon: UserCircle, end: true },
    { to: '/team/analytics', label: 'Team progress', icon: BarChart3 },
    { to: '/team/compliance', label: 'Who submitted', icon: ClipboardList },
  ],
};

const management: NavSection = {
  title: 'Company',
  items: [
    { to: '/management', label: 'Overview', icon: Gauge, end: true },
    { to: '/directory', label: 'People', icon: Users },
    { to: '/departments', label: 'Departments', icon: Building2 },
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    { to: '/compliance', label: 'Who submitted', icon: ClipboardList },
    { to: '/pending-work', label: 'Pending work', icon: AlertOctagon },
    { to: '/analytics', label: 'Productivity', icon: BarChart3 },
    { to: '/exports', label: 'Exports', icon: Download },
  ],
};

/** Super Admin grouped into People, Organization, Reports, Calendar and Settings. */
const adminSections: NavSection[] = [
  { title: 'Admin', items: [{ to: '/admin', label: 'Admin home', icon: LayoutGrid, end: true }] },
  {
    title: 'People',
    items: [
      { to: '/admin/users', label: 'Employees', icon: Users },
      { to: '/admin/registrations', label: 'Access requests', icon: UserCheck },
      { to: '/admin/roles', label: 'Roles', icon: ShieldCheck },
      { to: '/admin/hierarchy', label: 'Reporting lines', icon: GitBranch },
    ],
  },
  {
    title: 'Organization',
    items: [
      { to: '/admin/departments', label: 'Departments', icon: Building2 },
      { to: '/admin/projects', label: 'Projects', icon: FolderKanban },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/admin/reports/daily', label: 'Reports', icon: FileClock, match: ['/admin/reports'] },
      { to: '/admin/audit', label: 'Audit history', icon: ScrollText },
    ],
  },
  { title: 'Calendar', items: [{ to: '/admin/calendar', label: 'Work calendar', icon: CalendarDays }] },
  { title: 'Settings', items: [{ to: '/admin/settings', label: 'System settings', icon: Settings }] },
];

const account: NavSection = {
  title: 'Account',
  items: [
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/calendar', label: 'Work calendar', icon: CalendarDays },
    { to: '/profile', label: 'Profile', icon: UserCircle },
  ],
};

/** Navigation is generated from role; the server enforces the same boundaries independently. */
export function navFor(role: Role, isReporter: boolean): NavSection[] {
  const sections: NavSection[] = [];
  if (role === 'SUPER_ADMIN') sections.push(...adminSections, { ...management, title: 'Company insights' });
  if (role === 'MANAGEMENT') sections.push(management);
  if (role === 'REPORTING_MANAGER') sections.push(manager);
  if (isReporter) sections.push(role === 'EMPLOYEE' ? myWork : { ...myWork, items: myWork.items.filter((i) => i.to !== '/dashboard') });
  sections.push(account);
  return sections;
}

/** Four-item mobile bottom bar per role. "Profile" opens the full menu. */
export function bottomNavFor(role: Role): NavItem[] {
  const profile = { to: '/profile', label: 'Profile', icon: UserCircle };
  switch (role) {
    case 'SUPER_ADMIN':
      return [{ to: '/admin', label: 'Home', icon: Home, end: true }, { to: '/admin/users', label: 'People', icon: Users }, { to: '/admin/reports/daily', label: 'Reports', icon: FileText, match: ['/admin/reports'] }, profile];
    case 'MANAGEMENT':
      return [{ to: '/management', label: 'Home', icon: Home, end: true }, { to: '/directory', label: 'People', icon: Users }, { to: '/projects', label: 'Projects', icon: FolderKanban }, profile];
    case 'REPORTING_MANAGER':
      return [{ to: '/manager', label: 'Team', icon: Home, end: true }, { to: '/reviews/pending', label: 'Review', icon: ClipboardCheck }, { to: '/daily/today', label: 'My Tasks', icon: ListTodo }, profile];
    default:
      return [{ to: '/dashboard', label: 'Home', icon: Home }, { to: '/daily/today', label: 'My Tasks', icon: ListTodo }, { to: '/reports/daily', label: 'Reports', icon: FileText, match: ['/reports'] }, profile];
  }
}

export function homeFor(role: Role): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return '/admin';
    case 'MANAGEMENT':
      return '/management';
    case 'REPORTING_MANAGER':
      return '/manager';
    default:
      return '/dashboard';
  }
}
