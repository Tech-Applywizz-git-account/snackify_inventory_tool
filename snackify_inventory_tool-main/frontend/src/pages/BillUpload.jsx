import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { supabase } from '../lib/supabase.js';

export default function BillUpload() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [bills, setBills] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);

  const loadBills = useCallback(async () => {
    try {
      const data = await api.listBills();
      setBills(data);
    } catch (e) {
      console.error('Failed to load bills', e);
    }
  }, []);

  useEffect(() => {
    loadBills();
  }, [loadBills]);

  const onFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      setError('');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      // 1. Upload to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `bill_uploads/${fileName}`;

      const { data: _uploadData, error: uploadErr } = await supabase.storage
        .from('bills')
        .upload(filePath, file);

      if (uploadErr) throw uploadErr;

      const {
        data: { publicUrl },
      } = supabase.storage.from('bills').getPublicUrl(filePath);

      // 2. Call AI Extraction API
      setUploading(false);
      setExtracting(true);

      const _result = await api.extractBill(publicUrl);

      setSuccess(true);
      setFile(null);
      setPreviewUrl(null);
      loadBills();

      setTimeout(() => setSuccess(false), 5000);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setExtracting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Vendor Bill Management</h1>
        <p className="text-slate-500">
          Upload bills from HyperPure, Amazon, Blinkit, etc. for AI extraction.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Upload Card */}
        <div className="card space-y-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Upload size={20} className="text-brand" />
            Upload New Bill
          </h2>

          <div
            className={`
            border-2 border-dashed rounded-xl p-8 transition-colors text-center
            ${previewUrl ? 'border-brand bg-brand/5' : 'border-slate-200 hover:border-brand/40'}
          `}
          >
            {previewUrl ? (
              <div className="relative inline-block">
                <img src={previewUrl} className="max-h-64 rounded-lg shadow-md" alt="Preview" />
                <button
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl(null);
                  }}
                  className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 shadow-lg"
                >
                  <AlertCircle size={16} />
                </button>
              </div>
            ) : (
              <label className="cursor-pointer block">
                <div className="w-16 h-16 bg-brand/10 text-brand rounded-full flex items-center justify-center mx-auto mb-4">
                  <Camera size={32} />
                </div>
                <div className="text-slate-700 font-medium">Click to capture or select</div>
                <div className="text-xs text-slate-400 mt-1">Supports Image & PDF</div>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf"
                  onChange={onFileChange}
                />
              </label>
            )}
          </div>

          <button
            className="btn-primary w-full py-3 text-base"
            disabled={!file || uploading || extracting}
            onClick={handleUpload}
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin" size={20} /> Uploading...
              </>
            ) : extracting ? (
              <>
                <Loader2 className="animate-spin" size={20} /> AI Extracting...
              </>
            ) : (
              'Start AI Extraction'
            )}
          </button>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm flex gap-2"
              >
                <AlertCircle size={18} className="shrink-0" />
                {error}
              </motion.div>
            )}
            {success && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-50 text-emerald-700 p-3 rounded-lg text-sm flex gap-2"
              >
                <CheckCircle2 size={18} className="shrink-0" />
                Bill extracted and sent for Admin verification!
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Recent Bills List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText size={20} className="text-brand" />
            Recent Uploads
          </h2>

          <div className="space-y-3">
            {bills.length === 0 ? (
              <div className="text-slate-400 text-center py-12 border-2 border-dashed border-slate-100 rounded-xl">
                No bills uploaded yet.
              </div>
            ) : (
              bills.map((bill) => (
                <div
                  key={bill.id}
                  className="card p-4 hover:shadow-md transition-shadow cursor-pointer group"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {bill.vendor_name || 'Unknown Vendor'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(bill.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-slate-900">₹{bill.grand_total}</div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          bill.verification_status === 'Admin Verified'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {bill.verification_status}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                    <div>{bill.bill_items?.length || 0} items extracted</div>
                    <div className="group-hover:text-brand flex items-center gap-1 transition-colors">
                      View details <ChevronRight size={12} />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
