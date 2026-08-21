import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';
import { supabase } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import SnackCoin from './SnackCoin.jsx';
import SupportTicketModal from './SupportTicketModal.jsx';

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
    '/reset-authenticator',
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
  '/reset-authenticator': 'Reset MFA',
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
  const [wallet, setWallet] = useState(null);
  const [card, setCard] = useState(null);
  const [ticketOpen, setTicketOpen] = useState(false);
  const hasCard = Boolean(card?.cafeteria_card_number || (card?.card_masked && !String(card.card_masked).includes('----')));

  useEffect(() => {
    if (!profile?.id) return;
    api.tokensMe().then((d) => {
      setWallet(d?.wallet || d);
      setCard(d?.card || null);
    }).catch(() => {});
  }, [profile?.id]);

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
            {!hasCard && profile?.id ? (
              <button
                type="button"
                onClick={() => setTicketOpen(true)}
                className="h-8 w-8 rounded-full bg-slate-100 text-slate-700 grid place-items-center"
                title="Support"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 13a8 8 0 0 1 16 0" />
                  <rect x="2" y="13" width="4" height="7" rx="2" />
                  <rect x="18" y="13" width="4" height="7" rx="2" />
                </svg>
                <span className="sr-only">Support</span>
              </button>
            ) : null}
            {card?.card_masked ? (
              <div className="hidden md:block text-[11px] font-mono font-semibold text-cyan-700 bg-slate-950 border border-cyan-400/40 rounded-full px-3 py-1 tracking-wider">
                {card.card_masked}
              </div>
            ) : null}
            {wallet?.balance != null ? (
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-800 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
                <SnackCoin size={14} />
                {wallet.balance}
              </div>
            ) : null}
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
      <SupportTicketModal open={ticketOpen} onClose={() => setTicketOpen(false)} />
    </div>
  );
}
