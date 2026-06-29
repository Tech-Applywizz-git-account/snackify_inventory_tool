import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { supabase } from '../lib/supabase.js';

const navByRole = {
  facility_manager: [
    '/dashboard',
    '/daily-update',
    '/request',
    '/meals',
    '/my-meal-box',
    '/meal-token-dashboard',
    '/orders',
    '/queue',
    '/available',
    '/bills',
    '/manual-purchases',
    '/settings',
  ],
  finance: [
    '/dashboard',
    '/finance',
    '/request',
    '/meals',
    '/my-meal-box',
    '/orders',
    '/available',
    '/bills',
    '/bills/approve',
    '/manual-purchases',
    '/settings',
  ],
  leadership: [
    '/dashboard',
    '/daily-update',
    '/finance',
    '/request',
    '/meals',
    '/my-meal-box',
    '/meal-token-dashboard',
    '/orders',
    '/queue',
    '/available',
    '/admin',
    '/bills',
    '/bills/approve',
    '/manual-purchases',
    '/reports',
    '/connections',
    '/settings',
  ],
  staff: ['/request', '/meals', '/my-meal-box', '/orders', '/settings'],
  office_boy: [
    '/request',
    '/meals',
    '/my-meal-box',
    '/meal-token-dashboard',
    '/orders',
    '/queue',
    '/bills',
    '/manual-purchases',
    '/settings',
  ],
};

const labels = {
  '/dashboard': 'Dashboard',
  '/daily-update': 'Daily Update',
  '/finance': 'Finance',
  '/available': "What's Available",
  '/admin': 'Admin',
  '/request': 'Cafeteria',
  '/meals': 'Meals',
  '/my-meal-box': 'My Meal Box',
  '/meal-token-dashboard': 'Meal Tokens',
  '/orders': 'Orders',
  '/queue': 'Queue',
  '/bills': 'Bills',
  '/bills/approve': 'Verify Bills',
  '/reports': 'Insights',
  '/connections': 'Sync',
  '/manual-purchases': 'Purchases',
  '/settings': 'Settings',
};

// display label for the role chip in the header
const roleDisplay = {
  leadership: 'Admin',
  facility_manager: 'Facility Manager',
  finance: 'Accounts',
  office_boy: 'Office Boy',
  staff: 'Applywizzian',
};

export default function Layout() {
  const { profile } = useAuth();
  const links = profile ? navByRole[profile.role] || ['/request'] : [];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-brand text-white grid place-items-center font-bold">
              A
            </div>
            <span className="font-semibold text-slate-900">Applywizz Pantry</span>
          </div>
          <nav className="hidden sm:flex items-center gap-1">
            {links.map((to) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium ${
                    isActive ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {labels[to]}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {/* Avatar with initials — always visible */}
            <div className="h-8 w-8 rounded-full bg-brand/10 border border-brand/20 text-brand grid place-items-center font-bold text-sm shrink-0">
              {(profile?.preferred_name || profile?.full_name || '?').charAt(0).toUpperCase()}
            </div>
            {/* Name + role — hidden on mobile */}
            <div className="text-right text-xs text-slate-500 hidden sm:block leading-tight">
              <div className="font-semibold text-slate-800">
                {profile?.preferred_name || profile?.full_name || '…'}
              </div>
              <div className="text-slate-400">{roleDisplay[profile?.role] || profile?.role}</div>
            </div>
            <button
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => supabase.auth.signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="sm:hidden flex overflow-x-auto gap-1 px-4 pb-3">
          {links.map((to) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `whitespace-nowrap px-3 py-1.5 rounded-md text-xs font-medium ${
                  isActive ? 'bg-brand text-white' : 'text-slate-600 bg-slate-100'
                }`
              }
            >
              {labels[to]}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-slate-400 py-4">Applywizz Office Pantry</footer>
    </div>
  );
}
