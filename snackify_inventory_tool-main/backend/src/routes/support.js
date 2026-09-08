import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendSupportTicketEmail } from '../lib/microsoftGraph.js';

const router = Router();

const KINDS = new Set(['coins', 'card_missing', 'other']);

router.post('/ticket', async (req, res, next) => {
  try {
    const kind = String(req.body?.kind || '').trim();
    const message = String(req.body?.message || '').trim().slice(0, 1000);
    if (!KINDS.has(kind)) {
      return res.status(400).json({ error: 'Pick request for coins, card is not showing, or other.' });
    }
    if (kind === 'other' && message.length < 4) {
      return res.status(400).json({ error: 'Please write a short message for Other.' });
    }

    const { data: me } = await supabaseAdmin
      .from('profiles')
      .select('email, preferred_name, full_name, cafeteria_card_number')
      .eq('id', req.user.id)
      .maybeSingle();

    const { data: managers } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('role', 'facility_manager');

    const digits = String(me?.cafeteria_card_number || '').replace(/\D/g, '');
    const employeeName = me?.preferred_name || me?.full_name || req.user.email || 'Applywizzian';
    const employeeEmail = me?.email || req.user.email;

    await sendSupportTicketEmail({
      toEmails: (managers || []).map((m) => m.email).filter(Boolean),
      replyTo: employeeEmail,
      employeeName,
      employeeEmail,
      cardLast4: digits.length === 12 ? digits.slice(-4) : '',
      kind,
      message: kind === 'other' ? message : message || '',
    });

    res.json({ ok: true, message: 'Ticket sent to facility manager. Dinesh is on CC.' });
  } catch (e) {
    next(e);
  }
});

export default router;
