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

type Session = { id: string; accountId: string; tokenHash: string; adminUnlockedUntil: string | null };

async function derivePin(pin: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function pinLookup(pin: string) {
  // Deterministic only on the server, peppered by the service-role secret.
  return await sha256(`tahweeshti-account:${SERVICE_ROLE_KEY}:${pin}`);
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

async function pinAlreadyUsed(pin: string, exceptAccountId = '') {
  const lookup = await pinLookup(pin);
  let q = supabase.from('tahweeshti_accounts').select('id').eq('pin_lookup', lookup);
  if (exceptAccountId) q = q.neq('id', exceptAccountId);
  const { data: direct } = await q.maybeSingle();
  if (direct) return true;
  // Legacy account may not have a lookup until first successful login/change.
  let legacyQ = supabase.from('tahweeshti_accounts').select('id,pin_salt,pin_hash,iterations').is('pin_lookup', null);
  if (exceptAccountId) legacyQ = legacyQ.neq('id', exceptAccountId);
  const { data: legacy } = await legacyQ;
  for (const a of legacy || []) {
    const h = await derivePin(pin, a.pin_salt, Number(a.iterations || 120000));
    if (safeEq(h, a.pin_hash)) return true;
  }
  return false;
}
async function findAccountByPin(pin: string) {
  const lookup = await pinLookup(pin);
  const { data: direct } = await supabase.from('tahweeshti_accounts').select('*').eq('pin_lookup', lookup).maybeSingle();
  if (direct) {
    const h = await derivePin(pin, direct.pin_salt, Number(direct.iterations || 120000));
    return safeEq(h, direct.pin_hash) ? direct : null;
  }
  const { data: legacy } = await supabase.from('tahweeshti_accounts').select('*').is('pin_lookup', null);
  for (const a of legacy || []) {
    const h = await derivePin(pin, a.pin_salt, Number(a.iterations || 120000));
    if (safeEq(h, a.pin_hash)) {
      await supabase.from('tahweeshti_accounts').update({ pin_lookup: lookup, updated_at: new Date().toISOString() }).eq('id', a.id);
      return { ...a, pin_lookup: lookup };
    }
  }
  return null;
}

async function makeSession(accountId: string) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('tahweeshti_sessions').insert({ account_id: accountId, token_hash: tokenHash, expires_at: expires, admin_unlocked_until: null });
  if (error) throw error;
  return { token, expiresAt: expires };
}
async function requireSession(req: Request): Promise<Session | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const { data } = await supabase.from('tahweeshti_sessions')
    .select('id,account_id,expires_at,admin_unlocked_until')
    .eq('token_hash', tokenHash).gt('expires_at', now).maybeSingle();
  if (!data?.account_id) return null;
  await supabase.from('tahweeshti_sessions').update({ last_seen_at: now }).eq('id', data.id).eq('account_id', data.account_id);
  return { id: data.id, accountId: data.account_id, tokenHash, adminUnlockedUntil: data.admin_unlocked_until as string | null };
}
async function readBody(req: Request) { try { return await req.json(); } catch { return {}; } }

async function audit(accountId: string, action: string, entityType: string, entityId = '', summary = '', payload: Record<string, unknown> = {}) {
  await supabase.from('tahweeshti_audit').insert({ account_id: accountId, action, entity_type: entityType, entity_id: entityId || null, summary: summary.slice(0, 300), payload });
}
async function adminState(session: Session) {
  const { data: a } = await supabase.from('tahweeshti_accounts').select('admin_pin_hash').eq('id', session.accountId).maybeSingle();
  const enabled = !!a?.admin_pin_hash;
  const unlocked = enabled && !!session.adminUnlockedUntil && new Date(session.adminUnlockedUntil) > new Date();
  return { enabled, unlocked };
}
async function requireAdminIfEnabled(session: Session) {
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

async function bootstrap(accountId: string) {
  await purgeOldTrash();
  const [e, p, d] = await Promise.all([
    supabase.from('tahweeshti_shared_entries').select('*').eq('account_id', accountId).is('deleted_at', null).order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('tahweeshti_shared_payments').select('*').eq('account_id', accountId).is('deleted_at', null).order('payment_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('tahweeshti_documents').select('*').eq('account_id', accountId).is('deleted_at', null).order('updated_at', { ascending: false })
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

async function processRecurring(accountId: string, todayStr: string) {
  if (!isoDate(todayStr)) return { created: 0 };
  const { data: docs, error } = await supabase.from('tahweeshti_documents').select('*').eq('account_id', accountId).eq('kind', 'recurring').is('deleted_at', null);
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
        const row = { account_id: accountId, id, type, person: clampText(data.person, 120), amount, entry_date: nextDate, note: clampText(data.note, 800), meta, updated_at: new Date().toISOString() };
        const ins = await supabase.from('tahweeshti_shared_entries').insert(row);
        if (!ins.error) { created++; await audit(accountId, 'create', 'entry', id, 'حركة متكررة تلقائية', { recurringId: doc.id }); }
      }
      nextDate = advanceDate(nextDate, String(data.frequency || 'monthly'), Number(data.interval || 1));
      guard++;
    }
    if (guard > 0) {
      const updated = { ...data, nextDate, lastRun: todayStr };
      await supabase.from('tahweeshti_documents').update({ data: updated, updated_at: new Date().toISOString() }).eq('id', doc.id).eq('account_id', accountId);
    }
  }
  return { created };
}

async function remainingForEntry(accountId: string, entryId: string) {
  const { data: e } = await supabase.from('tahweeshti_shared_entries').select('amount').eq('id', entryId).eq('account_id', accountId).is('deleted_at', null).maybeSingle();
  if (!e) return null;
  const { data: ps } = await supabase.from('tahweeshti_shared_payments').select('amount').eq('entry_id', entryId).eq('account_id', accountId).is('deleted_at', null);
  const paid = (ps || []).reduce((a, x) => a + Number(x.amount || 0), 0);
  return Math.max(0, Number(e.amount) - paid);
}
async function distributeSettlement(accountId: string, entries: any[], amount: number, date: string, side: string) {
  let left = amount;
  for (const e of entries) {
    if (left <= 0.0001) break;
    const rem = await remainingForEntry(accountId, e.id);
    if (rem == null || rem <= 0) continue;
    const use = Math.min(rem, left);
    const { error } = await supabase.from('tahweeshti_shared_payments').insert({
      account_id: accountId, entry_id: e.id, amount: use, payment_date: date, note: 'تسوية صافي تلقائية',
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
      const { count } = await supabase.from('tahweeshti_accounts').select('id', { count: 'exact', head: true });
      return json({ initialized: Number(count || 0) > 0, multiAccount: true });
    }

    if (action === 'setup' || action === 'signup') {
      if (!validPin(body.pin)) return json({ error: 'الرمز لازم يكون 4 أرقام.' }, 400);
      if (await pinAlreadyUsed(body.pin)) return json({ error: 'هذا الرمز مستخدم بالفعل، اختر رمز ثاني.' }, 409);
      const salt = randomHex(16), iterations = 120000;
      const hash = await derivePin(body.pin, salt, iterations);
      const lookup = await pinLookup(body.pin);
      const { data: account, error } = await supabase.from('tahweeshti_accounts').insert({ pin_lookup: lookup, pin_salt: salt, pin_hash: hash, iterations }).select('id').single();
      if (error) {
        if (String(error.message || '').toLowerCase().includes('unique')) return json({ error: 'هذا الرمز مستخدم بالفعل، اختر رمز ثاني.' }, 409);
        throw error;
      }
      await audit(account.id, 'setup', 'account', account.id, 'إنشاء حساب تحويشتي جديد');
      const session = await makeSession(account.id);
      return json({ ok: true, accountId: account.id, ...session });
    }

    if (action === 'login') {
      if (!validPin(body.pin)) return json({ error: 'الرمز لازم يكون 4 أرقام.' }, 400);
      const key = clientKey(req);
      const rate = await checkRateLimit(key);
      if (!rate.allowed) return json({ error: 'محاولات كثيرة. جرّب بعد 10 دقائق.', retryAt: rate.retryAt }, 429);
      const account = await findAccountByPin(body.pin);
      if (!account) {
        const blocked = await recordFailure(key, Number(rate.attempts || 0), rate.windowStarted || new Date());
        return json({ error: blocked ? 'تم إيقاف المحاولات 10 دقائق.' : 'رمز الدخول غير صحيح أو غير موجود.' }, blocked ? 429 : 401);
      }
      await clearFailures(key);
      const session = await makeSession(account.id);
      return json({ ok: true, accountId: account.id, ...session });
    }

    const session = await requireSession(req);
    if (!session) return json({ error: 'انتهت الجلسة. سجّل الدخول من جديد.' }, 401);
    const accountId = session.accountId;

    if (action === 'session') return json({ ok: true, accountId, admin: await adminState(session) });
    if (action === 'logout') {
      await supabase.from('tahweeshti_sessions').delete().eq('id', session.id).eq('account_id', accountId);
      return json({ ok: true });
    }
    if (action === 'bootstrap' || action === 'list') return json(await bootstrap(accountId));

    if (action === 'entry_upsert') {
      const e = body.entry || {};
      if (!['receivable', 'payable', 'income', 'expense'].includes(e.type)) return json({ error: 'نوع الحركة غير صالح.' }, 400);
      if (!(Number(e.amount) > 0)) return json({ error: 'المبلغ غير صالح.' }, 400);
      if (!isoDate(e.date)) return json({ error: 'التاريخ غير صالح.' }, 400);
      if (['receivable', 'payable'].includes(e.type) && !String(e.person || '').trim()) return json({ error: 'اسم الشخص مطلوب.' }, 400);
      const id = e.id || crypto.randomUUID();
      if (e.id) {
        const { data: owned } = await supabase.from('tahweeshti_shared_entries').select('id').eq('id', id).eq('account_id', accountId).maybeSingle();
        if (!owned) return json({ error: 'الحركة غير موجودة في هذا الحساب.' }, 404);
      }
      const row = {
        account_id: accountId, id, type: e.type, person: clampText(e.person, 120), amount: Number(e.amount), entry_date: e.date,
        note: clampText(e.note, 800), receipt_path: e.receiptPath || null, meta: asObj(e.meta),
        deleted_at: null, updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('tahweeshti_shared_entries').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      await audit(accountId, e.id ? 'update' : 'create', 'entry', id, `${e.type} ${e.amount}`, { person: e.person || '' });
      return json({ ok: true, id });
    }

    if (action === 'entry_delete') {
      const id = String(body.id || '');
      const { error } = await supabase.from('tahweeshti_shared_entries').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).eq('account_id', accountId);
      if (error) throw error;
      await audit(accountId, 'delete', 'entry', id, 'نقل حركة إلى سلة المحذوفات');
      return json({ ok: true });
    }
    if (action === 'entry_restore') {
      const id = String(body.id || '');
      const { error } = await supabase.from('tahweeshti_shared_entries').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', id).eq('account_id', accountId);
      if (error) throw error;
      await audit(accountId, 'restore', 'entry', id, 'استرجاع حركة من السلة');
      return json({ ok: true });
    }
    if (action === 'entry_purge') {
      if (!(await requireAdminIfEnabled(session))) return json({ error: 'افتح صلاحيات الإدارة أولًا.' }, 403);
      const id = String(body.id || '');
      const { data: e } = await supabase.from('tahweeshti_shared_entries').select('receipt_path').eq('id', id).eq('account_id', accountId).maybeSingle();
      if (e?.receipt_path) await supabase.storage.from('receipts').remove([e.receipt_path]);
      const { error } = await supabase.from('tahweeshti_shared_entries').delete().eq('id', id).eq('account_id', accountId);
      if (error) throw error;
      await audit(accountId, 'purge', 'entry', id, 'حذف حركة نهائيًا');
      return json({ ok: true });
    }

    if (action === 'payment_add') {
      const p = body.payment || {};
      if (!(Number(p.amount) > 0)) return json({ error: 'المبلغ غير صالح.' }, 400);
      if (!isoDate(p.date)) return json({ error: 'التاريخ غير صالح.' }, 400);
      const { data: owned } = await supabase.from('tahweeshti_shared_entries').select('id').eq('id', p.entryId).eq('account_id', accountId).is('deleted_at', null).maybeSingle();
      if (!owned) return json({ error: 'الحركة غير موجودة في هذا الحساب.' }, 404);
      const { data, error } = await supabase.from('tahweeshti_shared_payments').insert({
        account_id: accountId, entry_id: p.entryId, amount: Number(p.amount), payment_date: p.date,
        note: clampText(p.note, 600), meta: asObj(p.meta), deleted_at: null
      }).select('id').single();
      if (error) return json({ error: String(error.message || '').includes('exceeds') ? 'الدفعة أكبر من المبلغ المتبقي.' : 'تعذر حفظ الدفعة.' }, 400);
      await audit(accountId, 'create', 'payment', data.id, `دفعة ${p.amount}`, { entryId: p.entryId });
      return json({ ok: true, id: data.id });
    }
    if (action === 'payment_delete') {
      const id = String(body.id || '');
      await supabase.from('tahweeshti_shared_payments').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('account_id', accountId);
      await audit(accountId, 'delete', 'payment', id, 'حذف دفعة');
      return json({ ok: true });
    }
    if (action === 'mark_paid') {
      const id = String(body.entryId || '');
      const rem = await remainingForEntry(accountId, id);
      if (rem == null) return json({ error: 'الحركة غير موجودة.' }, 404);
      if (rem <= 0.0001) return json({ ok: true, amount: 0 });
      const date = isoDate(body.date) || new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('tahweeshti_shared_payments').insert({
        account_id: accountId, entry_id: id, amount: rem, payment_date: date, note: clampText(body.note || 'تم التسديد بالكامل', 600), meta: asObj(body.meta)
      });
      if (error) throw error;
      await audit(accountId, 'payoff', 'entry', id, `تسديد كامل ${rem}`);
      return json({ ok: true, amount: rem });
    }

    if (action === 'doc_upsert') {
      const doc = body.document || {};
      const kind = clampText(doc.kind, 60);
      if (!/^[a-z_]+$/i.test(kind)) return json({ error: 'نوع السجل غير صالح.' }, 400);
      const id = doc.id || crypto.randomUUID();
      if (doc.id) {
        const { data: owned } = await supabase.from('tahweeshti_documents').select('id').eq('id', id).eq('account_id', accountId).maybeSingle();
        if (!owned) return json({ error: 'السجل غير موجود في هذا الحساب.' }, 404);
      }
      const row = { account_id: accountId, id, kind, data: asObj(doc.data), deleted_at: null, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('tahweeshti_documents').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      await audit(accountId, doc.id ? 'update' : 'create', kind, id, clampText((doc.data || {}).title || (doc.data || {}).name || kind, 200));
      return json({ ok: true, id });
    }
    if (action === 'doc_delete') {
      const id = String(body.id || '');
      const { data: d } = await supabase.from('tahweeshti_documents').select('kind').eq('id', id).eq('account_id', accountId).maybeSingle();
      await supabase.from('tahweeshti_documents').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).eq('account_id', accountId);
      await audit(accountId, 'delete', d?.kind || 'document', id, 'نقل للسلة');
      return json({ ok: true });
    }
    if (action === 'doc_restore') {
      const id = String(body.id || '');
      await supabase.from('tahweeshti_documents').update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', id).eq('account_id', accountId);
      await audit(accountId, 'restore', 'document', id, 'استرجاع من السلة');
      return json({ ok: true });
    }
    if (action === 'doc_purge') {
      if (!(await requireAdminIfEnabled(session))) return json({ error: 'افتح صلاحيات الإدارة أولًا.' }, 403);
      const id = String(body.id || '');
      await supabase.from('tahweeshti_documents').delete().eq('id', id).eq('account_id', accountId);
      await audit(accountId, 'purge', 'document', id, 'حذف نهائي');
      return json({ ok: true });
    }

    if (action === 'trash_list') {
      const [e, d] = await Promise.all([
        supabase.from('tahweeshti_shared_entries').select('*').eq('account_id', accountId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
        supabase.from('tahweeshti_documents').select('*').eq('account_id', accountId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
      ]);
      return json({ entries: e.data || [], documents: d.data || [] });
    }
    if (action === 'audit_list') {
      const limit = Math.max(10, Math.min(200, Number(body.limit || 80)));
      const { data, error } = await supabase.from('tahweeshti_audit').select('*').eq('account_id', accountId).order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;
      return json({ audit: data || [] });
    }

    if (action === 'process_recurring') return json(await processRecurring(accountId, String(body.today || '')));

    if (action === 'settle_person') {
      const person = clampText(body.person, 120).trim();
      if (!person) return json({ error: 'اسم الشخص مطلوب.' }, 400);
      const date = isoDate(body.date) || new Date().toISOString().slice(0, 10);
      const { data: entries, error } = await supabase.from('tahweeshti_shared_entries').select('*').eq('account_id', accountId).eq('person', person).in('type', ['receivable', 'payable']).is('deleted_at', null).order('entry_date', { ascending: true });
      if (error) throw error;
      const rec = (entries || []).filter((x: any) => x.type === 'receivable');
      const pay = (entries || []).filter((x: any) => x.type === 'payable');
      let recTotal = 0, payTotal = 0;
      for (const e of rec) recTotal += await remainingForEntry(accountId, e.id) || 0;
      for (const e of pay) payTotal += await remainingForEntry(accountId, e.id) || 0;
      const amount = Math.min(recTotal, payTotal);
      if (amount <= 0.0001) return json({ ok: true, amount: 0 });
      const a = await distributeSettlement(accountId, rec, amount, date, 'receivable');
      const b = await distributeSettlement(accountId, pay, amount, date, 'payable');
      const settled = Math.min(a, b);
      await audit(accountId, 'settlement', 'person', person, `تسوية صافي ${settled}`);
      return json({ ok: true, amount: settled });
    }

    if (action === 'receipt_upload') {
      const entryId = String(body.entryId || '');
      const mime = String(body.mime || '');
      const base64 = String(body.base64 || '');
      const { data: owned } = await supabase.from('tahweeshti_shared_entries').select('id').eq('id', entryId).eq('account_id', accountId).maybeSingle();
      if (!owned) return json({ error: 'الحركة غير موجودة في هذا الحساب.' }, 404);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return json({ error: 'نوع الصورة غير مدعوم.' }, 400);
      if (!base64 || base64.length > 7_200_000) return json({ error: 'حجم الصورة أكبر من 5MB.' }, 400);
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `${accountId}/${entryId}/${Date.now()}-${randomHex(6)}.${ext}`;
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: 'حجم الصورة أكبر من 5MB.' }, 400);
      const { error } = await supabase.storage.from('receipts').upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw error;
      return json({ ok: true, path });
    }
    if (action === 'receipt_url') {
      const path = String(body.path || '');
      if (!path.startsWith(`${accountId}/`) && !path.startsWith('shared/')) return json({ error: 'لا تملك صلاحية على هذا الإيصال.' }, 403);
      if (path.startsWith('shared/')) {
        const { data: owned } = await supabase.from('tahweeshti_shared_entries').select('id').eq('account_id', accountId).eq('receipt_path', path).maybeSingle();
        if (!owned) return json({ error: 'لا تملك صلاحية على هذا الإيصال.' }, 403);
      }
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 120);
      if (error) throw error;
      return json({ url: data.signedUrl });
    }

    if (action === 'admin_status') return json(await adminState(session));
    if (action === 'admin_setup') {
      if (!validPin(body.pin)) return json({ error: 'رمز الإدارة لازم يكون 4 أرقام.' }, 400);
      const { data: a } = await supabase.from('tahweeshti_accounts').select('admin_pin_hash').eq('id', accountId).maybeSingle();
      if (a?.admin_pin_hash) return json({ error: 'رمز الإدارة مفعّل مسبقًا.' }, 409);
      const salt = randomHex(16), iterations = 120000, hash = await derivePin(body.pin, salt, iterations);
      await supabase.from('tahweeshti_accounts').update({ admin_pin_salt: salt, admin_pin_hash: hash, admin_iterations: iterations, updated_at: new Date().toISOString() }).eq('id', accountId);
      await supabase.from('tahweeshti_sessions').update({ admin_unlocked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString() }).eq('id', session.id).eq('account_id', accountId);
      await audit(accountId, 'admin_setup', 'security', accountId, 'تفعيل رمز الإدارة');
      return json({ ok: true, unlocked: true });
    }
    if (action === 'admin_unlock') {
      if (!validPin(body.pin)) return json({ error: 'رمز الإدارة لازم يكون 4 أرقام.' }, 400);
      const { data: a } = await supabase.from('tahweeshti_accounts').select('*').eq('id', accountId).maybeSingle();
      if (!a?.admin_pin_hash) return json({ error: 'رمز الإدارة غير مفعّل.' }, 404);
      const hash = await derivePin(body.pin, a.admin_pin_salt, Number(a.admin_iterations || 120000));
      if (!safeEq(hash, a.admin_pin_hash)) return json({ error: 'رمز الإدارة غير صحيح.' }, 401);
      const until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await supabase.from('tahweeshti_sessions').update({ admin_unlocked_until: until }).eq('id', session.id).eq('account_id', accountId);
      return json({ ok: true, unlockedUntil: until });
    }
    if (action === 'admin_lock') {
      await supabase.from('tahweeshti_sessions').update({ admin_unlocked_until: null }).eq('id', session.id).eq('account_id', accountId);
      return json({ ok: true });
    }

    if (action === 'change_pin') {
      if (!validPin(body.oldPin) || !validPin(body.newPin)) return json({ error: 'الرمز لازم يكون 4 أرقام.' }, 400);
      const { data: a } = await supabase.from('tahweeshti_accounts').select('*').eq('id', accountId).maybeSingle();
      if (!a) return json({ error: 'الحساب غير موجود.' }, 404);
      const oldHash = await derivePin(body.oldPin, a.pin_salt, Number(a.iterations || 120000));
      if (!safeEq(oldHash, a.pin_hash)) return json({ error: 'الرمز الحالي غير صحيح.' }, 401);
      if (body.newPin !== body.oldPin && await pinAlreadyUsed(body.newPin, accountId)) return json({ error: 'الرمز الجديد مستخدم بحساب ثاني، اختر رمز آخر.' }, 409);
      const salt = randomHex(16), iterations = 120000, hash = await derivePin(body.newPin, salt, iterations), lookup = await pinLookup(body.newPin);
      await supabase.from('tahweeshti_accounts').update({ pin_lookup: lookup, pin_salt: salt, pin_hash: hash, iterations, updated_at: new Date().toISOString() }).eq('id', accountId);
      await supabase.from('tahweeshti_sessions').delete().eq('account_id', accountId).neq('id', session.id);
      await audit(accountId, 'change_pin', 'security', accountId, 'تغيير رمز الدخول');
      return json({ ok: true });
    }

    if (action === 'import') {
      if (!(await requireAdminIfEnabled(session))) return json({ error: 'افتح صلاحيات الإدارة أولًا.' }, 403);
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const payments = Array.isArray(body.payments) ? body.payments : [];
      const documents = Array.isArray(body.documents) ? body.documents : [];
      if (entries.length) {
        const rows = entries.map((e: any) => ({
          account_id: accountId, id: e.id || crypto.randomUUID(), type: e.type, person: clampText(e.person, 120), amount: Number(e.amount || 0),
          entry_date: e.date || e.entry_date, note: clampText(e.note, 800), receipt_path: null, meta: asObj(e.meta),
          deleted_at: null, updated_at: new Date().toISOString()
        }));
        const { error } = await supabase.from('tahweeshti_shared_entries').upsert(rows, { onConflict: 'id' }); if (error) throw error;
      }
      if (payments.length) {
        const rows = payments.map((p: any) => ({
          account_id: accountId, id: p.id || crypto.randomUUID(), entry_id: p.entryId || p.entry_id, amount: Number(p.amount || 0),
          payment_date: p.date || p.payment_date, note: clampText(p.note, 600), meta: asObj(p.meta), deleted_at: null
        }));
        const { error } = await supabase.from('tahweeshti_shared_payments').upsert(rows, { onConflict: 'id' }); if (error) throw error;
      }
      if (documents.length) {
        const rows = documents.map((d: any) => ({ account_id: accountId, id: d.id || crypto.randomUUID(), kind: d.kind, data: asObj(d.data), deleted_at: null, updated_at: new Date().toISOString() }));
        const { error } = await supabase.from('tahweeshti_documents').upsert(rows, { onConflict: 'id' }); if (error) throw error;
      }
      await audit(accountId, 'import', 'backup', '', 'استرجاع نسخة احتياطية', { entries: entries.length, payments: payments.length, documents: documents.length });
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: 'حدث خطأ في الخادم.' }, 500);
  }
});
