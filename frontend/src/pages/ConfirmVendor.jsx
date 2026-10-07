import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const confirmationRequests = new Map();

function confirmVendorInvitationOnce(tokenHash) {
  if (!confirmationRequests.has(tokenHash)) {
    const request = api.confirmVendorInvitation(tokenHash);
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
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tokenHash) return undefined;
    let cancelled = false;

    confirmVendorInvitationOnce(tokenHash)
      .then(() => {
        if (!cancelled) {
          navigate('/login?vendor_confirmed=1', { replace: true });
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
  }, [navigate, tokenHash]);

  return (
    <main className="min-h-screen grid place-items-center bg-slate-950 px-4 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">Confirmation unsuccessful</h1>
            <p className="mt-3 text-sm text-white/65">{error}</p>
            <Link className="mt-6 inline-block text-sm font-semibold text-blue-300" to="/login">
              Go to login
            </Link>
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
