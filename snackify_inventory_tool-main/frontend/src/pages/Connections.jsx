import { AlertCircle, CheckCircle2, Copy, MessageSquare, Plus, Send, Terminal } from 'lucide-react';
import { useState } from 'react';

export default function Connections() {
  const [copied, setCopied] = useState(false);
  const webhookUrl =
    import.meta.env.VITE_BILL_WEBHOOK_URL ||
    'https://inventory-ashen-theta.vercel.app/api/bills/webhook?key=app_wizz_secure_782';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Omnichannel Sync</h1>
        <p className="text-slate-500 mt-2">
          Skip the UI. Upload bills directly from your favorite chat apps.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* WhatsApp/Telegram Card */}
        <div className="card space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600">
              <MessageSquare size={24} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">WhatsApp & Telegram</h2>
              <p className="text-xs text-slate-500">Connect via Webhook</p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Your Unique Webhook URL
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 text-xs font-mono truncate">
                {webhookUrl}
              </div>
              <button
                onClick={copyToClipboard}
                className="p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shrink-0"
              >
                {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <div className="flex gap-3 text-xs text-slate-500 bg-amber-50 p-3 rounded-xl border border-amber-100">
            <AlertCircle size={16} className="text-amber-600 shrink-0" />
            <span>
              Use <strong>Zapier</strong> or <strong>Make.com</strong> to send your
              WhatsApp/Telegram PDFs to this URL. The AI will handle the rest.
            </span>
          </div>
        </div>

        {/* Microsoft Teams Card */}
        <div className="card space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
              <Send size={24} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Microsoft Teams</h2>
              <p className="text-xs text-slate-500">Direct Bot Integration</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-sm font-medium">Auto-Sync Channel Files</div>
              <div className="w-10 h-5 bg-brand rounded-full relative">
                <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full" />
              </div>
            </div>
            <p className="text-xs text-slate-500 italic">
              "Any PDF or bill image uploaded to the '#inventory-bills' private channel is extracted
              and sent for Admin verification."
            </p>
          </div>

          <button className="btn-secondary w-full py-3 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
            <Plus size={16} />
            Link New Channel
          </button>
        </div>
      </div>

      {/* Connection Guide */}
      <div className="card bg-slate-900 text-white">
        <h3 className="font-bold flex items-center gap-2 mb-4">
          <Terminal size={18} className="text-brand" />
          How it works
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="text-brand font-bold text-lg">01</div>
            <p className="text-xs text-slate-400">Share your PDF bill to the connected chat app.</p>
          </div>
          <div className="space-y-2">
            <div className="text-brand font-bold text-lg">02</div>
            <p className="text-xs text-slate-400">
              Our AI Vision reads the vendor, items, and total instantly.
            </p>
          </div>
          <div className="space-y-2">
            <div className="text-brand font-bold text-lg">03</div>
            <p className="text-xs text-slate-400">
              Stock levels are pushed to 'Available' and logged in Audit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
