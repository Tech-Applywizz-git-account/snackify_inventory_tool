import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const confirmationRequests = new Map();

function confirmVendorInvitationOnce(tokenHash) {
  if (!confirmationRequests.has(tokenHash)) {
    const url = 'https://snackify.applywizz.ai/api/auth/confirm-vendor-link';
    const request = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenHash }),
    }).then(async (res) => {
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const body = await res.json();
            if (body?.error) msg = body.error;
          }
        } catch (e) {}
        const error = new Error(msg);
        error.status = res.status;
        throw error;
      }
      if (res.status === 204) return null;
      return res.json();
    });
    confirmationRequests.set(tokenHash, request);
    request.then(
      () => confirmationRequests.delete(tokenHash),
      () => confirmationRequests.delete(tokenHash)
    );
  }
  return confirmationRequests.get(tokenHash);
}

export default function ConfirmVendor() {
  const { tokenHash } = useParams();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tokenHash) return undefined;
    let cancelled = false;

    confirmVendorInvitationOnce(tokenHash)
      .then(() => {
        if (!cancelled) {
          window.location.replace('https://snackify.applywizz.ai/login?vendor_confirmed=1');
        }
      })
      .catch((confirmationError) => {
        if (!cancelled) {
          setError(confirmationError.message || 'Could not confirm this vendor account.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tokenHash]);

  return (
    <main className="min-h-screen grid place-items-center bg-slate-950 px-4 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">Confirmation unsuccessful</h1>
            <p className="mt-3 text-sm text-white/65">{error}</p>
            <a className="mt-6 inline-block text-sm font-semibold text-blue-300" href="https://snackify.applywizz.ai/login">
              Go to login
            </a>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Confirming your vendor account</h1>
            <p className="mt-3 text-sm text-white/65" role="status">
              Please wait while we activate your account.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
