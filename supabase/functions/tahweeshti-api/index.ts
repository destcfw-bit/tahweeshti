import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const enc = new TextEncoder();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const bytesToHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)?.map(x => parseInt(x, 16)) || []);
const randomHex = (n = 32) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return bytesToHex(b); };
const sha256 = async (s: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
const safeEq = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
};
const validPin = (pin: unknown) => typeof pin === 'string' && /^\d{4}$/.test(pin);
const asObj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};
const clampText = (v: unknown, n: number) => String(v ?? '').slice(0, n);
const isoDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';

async function derivePin(pin: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

function clientKey(req: Request) {
  const raw = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  return raw.split(',')[0].trim().slice(0, 120);
}
async function checkRateLimit(key: string) {
  const now = new Date();
  const { data } = await supabase.from('tahweeshti_login_attempts').select('*').eq('client_key', key).maybeSingle();
  if (!data) return { allowed: true, attempts: 0, windowStarted: now };
  if (data.blocked_until && new Date(data.blocked_until) > now) return { allowed: false, retryAt: data.blocked_until };
  const start = new Date(data.window_started_at);
  if (now.getTime() - start.getTime() > 10 * 60 * 1000) {
    await supabase.from('tahweeshti_login_attempts').upsert({ client_key: key, attempts: 0, window_started_at: now.toISOString(), blocked_until: null });
    return { allowed: true, attempts: 0, windowStarted: now };
  }
  return { allowed: true, attempts: Number(data.attempts || 0), windowStarted: start };
}
async function recordFailure(key: string, currentAttempts: number, windowStarted: Date) {
  const attempts = currentAttempts + 1;
  const blocked = attempts >= 5 ? new Date(Date.now() + 10 * 60 * 1000).toISOString() : null;
  await supabase.from('tahweeshti_login_attempts').upsert({ client_key: key, attempts, window_started_at: windowStarted.toISOString(), blocked_until: blocked });
  return blocked;
}
async function clearFailures(key: string) { await supabase.from('tahweeshti_login_attempts').delete().eq('client_key', key); }

async function makeSession() {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('tahweeshti_sessions').insert({ token_hash: tokenHash, expires_at: expires, admin_unlocked_until: null });
  if (error) throw error;
  return { token, expiresAt: expires };
}
async function requireSession(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const { data } = await supabase.from('tahweeshti_sessions')
    .select('id,expires_at,admin_unlocked_until')
    .eq('token_hash', tokenHash).gt('expires_at', now).maybeSingle();
  if (!data) return null;
  await supabase.from('tahweeshti_sessions').update({ last_seen_at: now }).eq('id', data.id);
  return { id: data.id, tokenHash, adminUnlockedUntil: data.admin_unlocked_until as string | null };
}
async function readBody(req: Request) { try { return await req.json(); } catch { return {}; } }

async function audit(action: string, entityType: string, entityId = '', summary = '', payload: Record<string, unknown> = {}) {
  await supabase.from('tahweeshti_audit').insert({ action, entity_type: entityType, entity_id: entityId || null, summary: summary.slice(0, 300), payload });
}
async function adminState(session: { id: string; adminUnlockedUntil: string | null }) {
  const { data: settings } = await supabase.from('tahweeshti_settings').select('admin_pin_hash').eq('id', 1).maybeSingle();
  const enabled = !!settings?.admin_pin_hash;
  const unlocked = enabled && !!session.adminUnlockedUntil && new Date(session.adminUnlockedUntil) > new Date();
  return { enabled, unlocked };
}
async function requireAdminIfEnabled(session: { id: string; adminUnlockedUntil: string | null }) {
  const s = await adminState(session);
  return !s.enabled || s.unlocked;
}

async function purgeOldTrash() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: oldEntries } = await supabase.from('tahweeshti_shared_entries').select('id,receipt_path').lt('deleted_at', cutoff).not('deleted_at', 'is', null);
  for (const e of oldEntries || []) if (e.receipt_path) await supabase.storage.from('receipts').remove([e.receipt_path]);
  await supabase.from('tahweeshti_shared_entries').delete().lt('deleted_at', cutoff).not('deleted_at', 'is', null);
  await supabase.from('tahweeshti_shared_payments').delete().lt('deleted_at', cutoff).not('deleted_at', 'is', null);
  await supabase.from('tahweeshti_documents').delete().lt('deleted_at', cutoff).not('deleted_at', 'is', null);
  await supabase.from('tahweeshti_sessions').delete().lt('expires_at', new Date().toISOString());
}

async function bootstrap() {
  await purgeOldTrash();
  const [e, p, d] = await Promise.all([
    supabase.from('tahweeshti_shared_entries').select('*').is('deleted_at', null).order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('tahweeshti_shared_payments').select('*').is('deleted_at', null).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('tahweeshti_documents').select('*').is('deleted_at', null).order('updated_at', { ascending: false })
  ]);
  if (e.error) throw e.error; if (p.error) throw p.error; if (d.error) throw d.error;
  return { entries: e.data || [], payments: p.data || [], documents: d.data || [] };
}

function advanceDate(dateStr: string, frequency: string, interval = 1) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const n = Math.max(1, Math.min(24, Number(interval) || 1));
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() + n);
  else if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + (7 * n));
  else if (frequency === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

async function processRecurring(todayStr: string) {
  if (!isoDate(todayStr)) return { created: 0 };
  const { data: docs, error } = await supabase.from('tahweeshti_documents').select('*').eq('kind', 'recurring').is('deleted_at', null);
  if (error) throw error;
  let created = 0;
  for (const doc of docs || []) {
    const data = asObj(doc.data);
    if (data.enabled === false) continue;
    let nextDate = isoDate(data.nextDate) || '';
    let guard = 0;
    while (nextDate && nextDate <= todayStr && guard < 12) {
      const type = String(data.type || 'expense');
      const amount = Number(data.amount || 0);
      if (['receivable', 'payable', 'income', 'expense'].includes(type) && amount > 0) {
        const id = crypto.randomUUID();
        const meta = {
          category: data.category || '', walletId: data.walletId || '', paymentMethod: data.paymentMethod || '',
          dueDate: data.dueDate || '', tags: Array.isArray(data.tags) ? data.tags : [],
          reference: `THW-R-${Date.now().toString(36).toUpperCase()}`, recurringId: doc.id, autoGenerated: true
        };
        const row = { id, type, person: clampText(data.person, 120), amount, entry_date: nextDate, note: clampText(data.note, 800), meta, updated_at: new Date().toISOString() };
        const ins = await supabase.from('tahweeshti_shared_entries').insert(row);
        if (!ins.error) { created++; await audit('create', 'entry', id, 'حركة متكررة تلقائية', { recurringId: doc.id }); }
      }
      nextDate = advanceDate(nextDate, String(data.frequency || 'monthly'), Number(data.interval || 1));
      guard++;
    }
    if (guard > 0) {
      const updated = { ...data, nextDate, lastRun: todayStr };
      await supabase.from('tahweeshti_documents').update({ data: updated, updated_at: new Date().toISOString() }).eq('id', doc.id);
    }
  }
  return { created };
}

async function remainingForEntry(entryId: string) {
  const { data: e } = await supabase.from('tahweeshti_shared_entries').select('amount').eq('id', entryId).is('deleted_at', null).maybeSingle();
  if (!e) return null;
  const { data: ps } = await supabase.from('tahweeshti_shared_payments').select('amount').eq('entry_id', entryId).is('deleted_at', null);
  const paid = (ps || []).reduce((a, x) => a + Number(x.amount || 0), 0);
  return Math.max(0, Number(e.amount) - paid);
}

async function distributeSettlement(entries: any[], amount: number, date: string, side: string) {
  let left = amount;
  for (const e of entries) {
    if (left <= 0.0001) break;
    const rem = await remainingForEntry(e.id);
    if (rem == null || rem <= 0) continue;
    const use = Math.min(rem, left);
    const { error } = await supabase.from('tahweeshti_shared_payments').insert({
      entry_id: e.id, amount: use, payment_date: date, note: 'تسوية صافي تلقائية',
      meta: { settlement: true, settlementSide: side }
    });
    if (!error) left -= use;
  }
  return amount - left;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = await readBody(req);
  const action = String(body.action || '');

  try {
    if (action === 'status') {
      const { data } = await supabase.from('tahweeshti_settings').select('id').eq('id', 1).maybeSingle();
      return json({ initialized: !!data });
    }

    if (action === 'setup') {
      if (!validPin(body.pin)) return json({ error: 'الرمز لازم يكون 4 أرقام.' }, 400);
      const { data: existing } = await supabase.from('tahweeshti_settings').select('id').eq('id', 1).maybeSingle();
      if (existing) return json({ error: 'تم إنشاء الحساب مسبقًا. سجل الدخول بالرمز.' }, 409);
      const salt = randomHex(16), iterations = 120000;
      const hash = await derivePin(body.pin, salt, iterations);
      const { error } = await supabase.from('tahweeshti_settings').insert({ id: 1, pin_salt: salt, pin_hash: hash, iterations });
      if (error) return json({ error: 'تعذر إنشاء الحساب.' }, 500);
      await audit('setup', 'account', '1', 'إنشاء حساب تحويشتي');
      const session = await makeSession();
      return json({ ok: true, ...session });
    }

    if (action === 'login') {
      if (!validPin(body.pin)) return json({ error: 'الرمز لازم يكون 4 أرقام.' }, 400);
      const key = clientKey(req);
      const rate = await checkRateLimit(key);
      if (!rate.allowed) return json({ error: 'محاولات كثيرة. جرّب بعد 10 دقائق.', retryAt: rate.retryAt }, 429);
      const { data: s } = await supabase.from('tahweeshti_settings').select('*').eq('id', 1).maybeSingle();
      if (!s) return json({ error: 'الحساب غير مهيأ بعد.' }, 404);
      const hash = await derivePin(body.pin, s.pin_salt, Number(s.iterations));
      if (!safeEq(hash, s.pin_hash)) {
        const blocked = await recordFailure(key, Number(rate.attempts || 0), rate.windowStarted || new Date());
        return json({ error: blocked ? 'تم إيقاف المحاولات 10 دقائق.' : 'رمز الدخول غير صحيح.' }, blocked ? 429 : 401);
      }
      await clearFailures(key);
      const session = await makeSession();
      return json({ ok: true, ...session });
    }

    const session = await requireSession(req);
    if (!session) return json({ error: 'انتهت الجلسة. سجّل الدخول من جديد.' }, 401);

    if (action === 'session') return json({ ok: true, admin: await adminState(session) });
    if (action === 'logout') {
      await supabase.from('tahweeshti_sessions').delete().eq('id', session.id);
      return json({ ok: true });
    }
    if (action === 'bootstrap' || action === 'list') return json(await bootstrap());

    if (action === 'entry_upsert') {
      const e = body.entry || {};
      if (!['receivable', 'payable', 'income', 'expense'].includes(e.type)) return json({ error: 'نوع الحركة غير صالح.' }, 400);
      if (!(Number(e.amount) > 0)) return json({ error: 'المبلغ غير صالح.' }, 400);
      if (!isoDate(e.date)) return json({ error: 'التاريخ غير صالح.' }, 400);
      if (['receivable', 'payable'].includes(e.type) && !String(e.person || '').trim()) return json({ error: 'اسم الشخص مطلوب.' }, 400);
      const id = e.id || crypto.randomUUID();
      const row = {
        id, type: e.type, person: clampText(e.person, 120), amount: Number(e.amount), entry_date: e.date,
        note: clampText(e.note, 800), receipt_path: e.receiptPath || null, meta: asObj(e.meta),
        deleted_at: null, updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('tahweeshti_shared_entries').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      await audit(e.id ? 'update' : 'create', 'entry', id, `${e.type} ${e.amount}`, { person: e.person || '' });
      return json({ ok: true, id });
    }

    if (action === 'entry_delete') {
      const id = String(body.id || '');
      const { error } = await supabase.from('tahweeshti_shared_entries').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await audit('delete', 'entry', id, 'نقل حركة إلى سلة المحذوفات');
      return json({ ok: true });
    }
    if (action === 'entry_restore') {
      const id = String(body.id || '');
      const { error } = await supabase.from('tahweeshti_shared_entries').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await audit('restore', 'entry', id, 'استرجاع حركة من السلة');
      return json({ ok: true });
    }
    if (action === 'entry_purge') {
      if (!(await requireAdminIfEnabled(session))) return json({ error: 'افتح صلاحيات الإدارة أولًا.' }, 403);
      const id = String(body.id || '');
      const { data: e } = await supabase.from('tahweeshti_shared_entries').select('receipt_path').eq('id', id).maybeSingle();
      if (e?.receipt_path) await supabase.storage.from('receipts').remove([e.receipt_path]);
      const { error } = await supabase.from('tahweeshti_shared_entries').delete().eq('id', id);
      if (error) throw error;
      await audit('purge', 'entry', id, 'حذف حركة نهائيًا');
      return json({ ok: true });
    }

    if (action === 'payment_add') {
      const p = body.payment || {};
      if (!(Number(p.amount) > 0)) return json({ error: 'المبلغ غير صالح.' }, 400);
      if (!isoDate(p.date)) return json({ error: 'التاريخ غير صالح.' }, 400);
      const { data, error } = await supabase.from('tahweeshti_shared_payments').insert({
        entry_id: p.entryId, amount: Number(p.amount), payment_date: p.date,
        note: clampText(p.note, 600), meta: asObj(p.meta), deleted_at: null
      }).select('id').single();
      if (error) return json({ error: error.message.includes('exceeds') ? 'الدفعة أكبر من المبلغ المتبقي.' : 'تعذر حفظ الدفعة.' }, 400);
      await audit('create', 'payment', data.id, `دفعة ${p.amount}`, { entryId: p.entryId });
      return json({ ok: true, id: data.id });
    }
    if (action === 'payment_delete') {
      const id = String(body.id || '');
      await supabase.from('tahweeshti_shared_payments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      await audit('delete', 'payment', id, 'حذف دفعة');
      return json({ ok: true });
    }
    if (action === 'mark_paid') {
      const id = String(body.entryId || '');
      const rem = await remainingForEntry(id);
      if (rem == null) return json({ error: 'الحركة غير موجودة.' }, 404);
      if (rem <= 0.0001) return json({ ok: true, amount: 0 });
      const date = isoDate(body.date) || new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('tahweeshti_shared_payments').insert({
        entry_id: id, amount: rem, payment_date: date, note: clampText(body.note || 'تم التسديد بالكامل', 600), meta: asObj(body.meta)
      });
      if (error) throw error;
      await audit('payoff', 'entry', id, `تسديد كامل ${rem}`);
      return json({ ok: true, amount: rem });
    }

    if (action === 'doc_upsert') {
      const doc = body.document || {};
      const kind = clampText(doc.kind, 60);
      if (!/^[a-z_]+$/i.test(kind)) return json({ error: 'نوع السجل غير صالح.' }, 400);
      const id = doc.id || crypto.randomUUID();
      const row = { id, kind, data: asObj(doc.data), deleted_at: null, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('tahweeshti_documents').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      await audit(doc.id ? 'update' : 'create', kind, id, clampText((doc.data || {}).title || (doc.data || {}).name || kind, 200));
      return json({ ok: true, id });
    }
    if (action === 'doc_delete') {
      const id = String(body.id || '');
      const { data: d } = await supabase.from('tahweeshti_documents').select('kind').eq('id', id).maybeSingle();
      await supabase.from('tahweeshti_documents').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
      await audit('delete', d?.kind || 'document', id, 'نقل للسلة');
      return json({ ok: true });
    }
    if (action === 'doc_restore') {
      const id = String(body.id || '');
      await supabase.from('tahweeshti_documents').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', id);
      await audit('restore', 'document', id, 'استرجاع من السلة');
      return json({ ok: true });
    }
    if (action === 'doc_purge') {
      if (!(await requireAdminIfEnabled(session))) return json({ error: 'افتح صلاحيات الإدارة أولًا.' }, 403);
      const id = String(body.id || '');
      await supabase.from('tahweeshti_documents').delete().eq('id', id);
      await audit('purge', 'document', id, 'حذف نهائي');
      return json({ ok: true });
    }

    if (action === 'trash_list') {
      const [e, d] = await Promise.all([
        supabase.from('tahweeshti_shared_entries').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
        supabase.from('tahweeshti_documents').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
      ]);
      return json({ entries: e.data || [], documents: d.data || [] });
    }
    if (action === 'audit_list') {
      const limit = Math.max(10, Math.min(200, Number(body.limit || 80)));
      const { data, error } = await supabase.from('tahweeshti_audit').select('*').order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return json({ audit: data || [] });
    }

    if (action === 'process_recurring') return json(await processRecurring(String(body.today || '')));

    if (action === 'settle_person') {
      const person = clampText(body.person, 120).trim();
      if (!person) return json({ error: 'اسم الشخص مطلوب.' }, 400);
      const date = isoDate(body.date) || new Date().toISOString().slice(0, 10);
      const { data: entries, error } = await supabase.from('tahweeshti_shared_entries').select('*').eq('person', person).in('type', ['receivable', 'payable']).is('deleted_at', null).order('entry_date', { ascending: true });
      if (error) throw error;
      const rec = (entries || []).filter((x: any) => x.type === 'receivable');
      const pay = (entries || []).filter((x: any) => x.type === 'payable');
      let recTotal = 0, payTotal = 0;
      for (const e of rec) recTotal += await remainingForEntry(e.id) || 0;
      for (const e of pay) payTotal += await remainingForEntry(e.id) || 0;
      const amount = Math.min(recTotal, payTotal);
      if (amount <= 0.0001) return json({ ok: true, amount: 0 });
      const a = await distributeSettlement(rec, amount, date, 'receivable');
      const b = await distributeSettlement(pay, amount, date, 'payable');
      const settled = Math.min(a, b);
      await audit('settlement', 'person', person, `تسوية صافي ${settled}`);
      return json({ ok: true, amount: settled });
    }

    if (action === 'receipt_upload') {
      const entryId = String(body.entryId || '');
      const mime = String(body.mime || '');
      const base64 = String(body.base64 || '');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return json({ error: 'نوع الصورة غير مدعوم.' }, 400);
      if (!base64 || base64.length > 7_200_000) return json({ error: 'حجم الصورة أكبر من 5MB.' }, 400);
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `shared/${entryId}/${Date.now()}-${randomHex(6)}.${ext}`;
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: 'حجم الصورة أكبر من 5MB.' }, 400);
      const { error } = await supabase.storage.from('receipts').upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw error;
      return json({ ok: true, path });
    }
    if (action === 'receipt_url') {
      const path = String(body.path || '');
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 120);
      if (error) throw error;
      return json({ url: data.signedUrl });
    }

    if (action === 'admin_status') return json(await adminState(session));
    if (action === 'admin_setup') {
      if (!validPin(body.pin)) return json({ error: 'رمز الإدارة لازم يكون 4 أرقام.' }, 400);
      const { data: s } = await supabase.from('tahweeshti_settings').select('admin_pin_hash').eq('id', 1).maybeSingle();
      if (s?.admin_pin_hash) return json({ error: 'رمز الإدارة مفعّل مسبقًا.' }, 409);
      const salt = randomHex(16), iterations = 120000, hash = await derivePin(body.pin, salt, iterations);
      await supabase.from('tahweeshti_settings').update({ admin_pin_salt: salt, admin_pin_hash: hash, admin_iterations: iterations, updated_at: new Date().toISOString() }).eq('id', 1);
      await supabase.from('tahweeshti_sessions').update({ admin_unlocked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString() }).eq('id', session.id);
      await audit('admin_setup', 'security', '1', 'تفعيل رمز الإدارة');
      return json({ ok: true, unlocked: true });
    }
    if (action === 'admin_unlock') {
      if (!validPin(body.pin)) return json({ error: 'رمز الإدارة لازم يكون 4 أرقام.' }, 400);
      const { data: s } = await supabase.from('tahweeshti_settings').select('*').eq('id', 1).maybeSingle();
      if (!s?.admin_pin_hash) return json({ error: 'رمز الإدارة غير مفعّل.' }, 404);
      const hash = await derivePin(body.pin, s.admin_pin_salt, Number(s.admin_iterations || 120000));
      if (!safeEq(hash, s.admin_pin_hash)) return json({ error: 'رمز الإدارة غير صحيح.' }, 401);
      const until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await supabase.from('tahweeshti_sessions').update({ admin_unlocked_until: until }).eq('id', session.id);
      return json({ ok: true, unlockedUntil: until });
    }
    if (action === 'admin_lock') {
      await supabase.from('tahweeshti_sessions').update({ admin_unlocked_until: null }).eq('id', session.id);
      return json({ ok: true });
    }

    if (action === 'change_pin') {
      if (!validPin(body.oldPin) || !validPin(body.newPin)) return json({ error: 'الرمز لازم يكون 4 أرقام.' }, 400);
      const { data: s } = await supabase.from('tahweeshti_settings').select('*').eq('id', 1).maybeSingle();
      const oldHash = await derivePin(body.oldPin, s.pin_salt, Number(s.iterations));
      if (!safeEq(oldHash, s.pin_hash)) return json({ error: 'الرمز الحالي غير صحيح.' }, 401);
      const salt = randomHex(16), iterations = 120000, hash = await derivePin(body.newPin, salt, iterations);
      await supabase.from('tahweeshti_settings').update({ pin_salt: salt, pin_hash: hash, iterations, updated_at: new Date().toISOString() }).eq('id', 1);
      await supabase.from('tahweeshti_sessions').delete().neq('id', session.id);
      await audit('change_pin', 'security', '1', 'تغيير رمز الدخول');
      return json({ ok: true });
    }

    if (action === 'import') {
      if (!(await requireAdminIfEnabled(session))) return json({ error: 'افتح صلاحيات الإدارة أولًا.' }, 403);
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const payments = Array.isArray(body.payments) ? body.payments : [];
      const documents = Array.isArray(body.documents) ? body.documents : [];
      if (entries.length) {
        const rows = entries.map((e: any) => ({
          id: e.id || crypto.randomUUID(), type: e.type, person: clampText(e.person, 120), amount: Number(e.amount || 0),
          entry_date: e.date || e.entry_date, note: clampText(e.note, 800), receipt_path: null, meta: asObj(e.meta),
          deleted_at: null, updated_at: new Date().toISOString()
        }));
        const { error } = await supabase.from('tahweeshti_shared_entries').upsert(rows, { onConflict: 'id' }); if (error) throw error;
      }
      if (payments.length) {
        const rows = payments.map((p: any) => ({
          id: p.id || crypto.randomUUID(), entry_id: p.entryId || p.entry_id, amount: Number(p.amount || 0),
          payment_date: p.date || p.payment_date, note: clampText(p.note, 600), meta: asObj(p.meta), deleted_at: null
        }));
        const { error } = await supabase.from('tahweeshti_shared_payments').upsert(rows, { onConflict: 'id' }); if (error) throw error;
      }
      if (documents.length) {
        const rows = documents.map((d: any) => ({ id: d.id || crypto.randomUUID(), kind: d.kind, data: asObj(d.data), deleted_at: null, updated_at: new Date().toISOString() }));
        const { error } = await supabase.from('tahweeshti_documents').upsert(rows, { onConflict: 'id' }); if (error) throw error;
      }
      await audit('import', 'backup', '', 'استرجاع نسخة احتياطية', { entries: entries.length, payments: payments.length, documents: documents.length });
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: 'حدث خطأ في الخادم.' }, 500);
  }
});
