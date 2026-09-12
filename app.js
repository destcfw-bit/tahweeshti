const cfg = window.TAHWEESHTI_CONFIG || {};
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const state = {
  entries: [],
  payments: [],
  editingId: null,
  paymentEntryId: null,
  pendingReceipt: null,
  authMode: 'setup',
  installPrompt: null
};

const LOCAL_KEY = 'tahweeshti_local_v3';
const PIN_HASH_KEY = 'tahweeshti_pin_hash';
const SESSION_KEY = 'tahweeshti_pin_session';
const OWNER_NAME = 'Yahya Saeed';
const JOD = n => `${Number(n||0).toLocaleString('ar-JO',{minimumFractionDigits:0,maximumFractionDigits:3})} ${cfg.currencyLabel||'د.أ'}`;
const today = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Amman'});
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function toast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}
function loading(on=true){ $('#loading').classList.toggle('hidden', !on); }
function openModal(id){ const m = $('#'+id); m.classList.add('open'); m.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
function closeModal(id){ const m = $('#'+id); m.classList.remove('open'); m.setAttribute('aria-hidden','true'); document.body.style.overflow=''; }
function localLoad(){
  const raw = localStorage.getItem(LOCAL_KEY);
  if(!raw) return {entries:[], payments:[]};
  try { return JSON.parse(raw); } catch { return {entries:[], payments:[]}; }
}
function localSave(){
  localStorage.setItem(LOCAL_KEY, JSON.stringify({entries: state.entries, payments: state.payments, version: 3, updatedAt: new Date().toISOString()}));
}
function empty(title, note){
  return `<div class="empty-state"><span>✦</span><b>${esc(title)}</b><div style="margin-top:8px">${esc(note)}</div></div>`;
}
function setMode(){
  $('#modeBadge').textContent = 'محلي آمن';
  $('#modeBadge').style.color = 'var(--emerald)';
  $('#connectionInfo').textContent = 'الوضع المحلي الآمن — بياناتك محفوظة على هذا الجهاز ومحميّة برمز دخول من 4 أرقام.';
  $('#accountInfo').textContent = `المالك: ${OWNER_NAME} — تسجيل الدخول برمز شخصي من 4 أرقام.`;
}

async function hashPin(pin){
  const txt = `tahweeshti:${pin}`;
  if (crypto?.subtle?.digest) {
    const data = new TextEncoder().encode(txt);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  return btoa(txt);
}
function isPinSet(){ return !!localStorage.getItem(PIN_HASH_KEY); }
function isLoggedIn(){ return localStorage.getItem(SESSION_KEY) === '1'; }
function startSession(){ localStorage.setItem(SESSION_KEY, '1'); }
function endSession(){ localStorage.removeItem(SESSION_KEY); }
function clearAuthInputs(){ $('#authPin').value=''; $('#authPinConfirm').value=''; $('#authMessage').textContent=''; }

function showAuth(){
  $('#app').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  state.authMode = isPinSet() ? 'login' : 'setup';
  updateAuthMode();
  clearAuthInputs();
}
async function enterApp(){
  loading(true);
  try {
    const data = localLoad();
    state.entries = data.entries || [];
    state.payments = data.payments || [];
    setMode();
    $('#authScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    navigate('dashboard');
    renderAll();
  } catch (e) {
    console.error(e);
    toast('تعذر تحميل البيانات');
  } finally {
    loading(false);
  }
}

function updateAuthMode(){
  const setup = state.authMode === 'setup';
  $('#pinLabel').textContent = setup ? 'أنشئ رمز الدخول' : 'رمز الدخول';
  $('#loginSubmit span').textContent = setup ? 'إنشاء حساب' : 'تسجيل الدخول';
  $('#authSubtitle').textContent = setup
    ? 'أنشئ رمز من 4 أرقام فقط، وبعدها تدخل مباشرة بكل بساطة.'
    : 'أدخل رمزك المكوّن من 4 أرقام للمتابعة.';
  $('#pinConfirmField').classList.toggle('hidden', !setup);
  $('#authPin').setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
  $('#authPinConfirm').required = setup;

  const switchWrap = $('.auth-switch');
  if (isPinSet()) {
    switchWrap.classList.remove('hidden');
    $('#authSwitchText').textContent = setup ? 'رجوع لوضع الدخول؟' : 'بدك تبدّل الرمز الحالي؟';
    $('#toggleAuthMode').textContent = setup ? 'تسجيل الدخول' : 'إعادة إنشاء الرمز';
  } else {
    switchWrap.classList.add('hidden');
  }
}

async function authSubmit(ev){
  ev.preventDefault();
  const pin = ($('#authPin').value || '').replace(/\D/g, '');
  const confirmPin = ($('#authPinConfirm').value || '').replace(/\D/g, '');
  $('#authMessage').textContent = '';
  if(pin.length !== 4) return $('#authMessage').textContent = 'الرمز لازم يكون 4 أرقام.';
  loading(true);
  try {
    if(state.authMode === 'setup'){
      if(confirmPin.length !== 4) throw new Error('أكد الرمز من 4 أرقام.');
      if(pin !== confirmPin) throw new Error('الرمزان غير متطابقين.');
      const hash = await hashPin(pin);
      localStorage.setItem(PIN_HASH_KEY, hash);
      startSession();
      await enterApp();
      toast('تم إنشاء الحساب بنجاح ✨');
    } else {
      const stored = localStorage.getItem(PIN_HASH_KEY);
      const hash = await hashPin(pin);
      if(hash !== stored) throw new Error('رمز الدخول غير صحيح.');
      startSession();
      await enterApp();
      toast('أهلًا فيك 👋');
    }
  } catch (e) {
    $('#authMessage').textContent = e.message || 'تعذر المتابعة';
  } finally {
    loading(false);
    clearAuthInputs();
  }
}

function logout(){
  endSession();
  showAuth();
  toast('تم تسجيل الخروج');
}

function entryPaid(id){ return state.payments.filter(p => p.entryId === id).reduce((a,p)=> a + Number(p.amount || 0), 0); }
function enrich(e){
  const paid = entryPaid(e.id);
  const debt = ['receivable','payable'].includes(e.type);
  const remaining = debt ? Math.max(0, Number(e.amount) - paid) : 0;
  const status = !debt ? 'na' : remaining <= .0001 ? 'paid' : paid > 0 ? 'partial' : 'open';
  return {...e, paid, remaining, status};
}
function allEntries(){ return state.entries.map(enrich); }
function totals(){
  let r=0,p=0,i=0,x=0;
  allEntries().forEach(e=>{
    if(e.type==='receivable') r += e.remaining;
    if(e.type==='payable') p += e.remaining;
    if(e.type==='income') i += e.amount;
    if(e.type==='expense') x += e.amount;
  });
  return {r,p,i,x,net:r-p+i-x};
}
const typeInfo = t => ({receivable:['💚','إلي','pos'],payable:['🔴','عليّ','neg'],income:['📈','إيراد','pos'],expense:['📉','مصروف','neg']}[t] || ['🧾','حركة','']);

function animateNumber(el, target){
  const from = Number(el.dataset.value || 0), start = performance.now(), dur = 520;
  el.dataset.value = target;
  const step = now => {
    const t = Math.min(1, (now - start) / dur), ease = 1 - Math.pow(1 - t, 3);
    const value = from + (target - from) * ease;
    el.textContent = JOD(value);
    if(t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderAll(){ renderStats(); renderRecent(); renderEntries(); renderDebts(); setMode(); }
function renderStats(){
  const t = totals();
  animateNumber($('#receivableTotal'), t.r);
  animateNumber($('#payableTotal'), t.p);
  animateNumber($('#incomeTotal'), t.i);
  animateNumber($('#expenseTotal'), t.x);
  animateNumber($('#netBalance'), t.net);
  $('#netBalance').classList.toggle('neg', t.net < 0);
  $('#netHint').textContent = state.entries.length ? `${state.entries.length} حركة مسجلة — آخر تحديث الآن` : 'ابدأ بإضافة أول حركة';
}
function renderRecent(){
  const arr = allEntries().sort((a,b)=> String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date))).slice(0,6);
  const box = $('#recentList');
  if(!arr.length){ box.innerHTML = empty('ما في حركات لسه', 'أضف أول حركة من زر +'); return; }
  box.innerHTML = arr.map((e,i)=>{
    const [ic,label,cls] = typeInfo(e.type), debt = ['receivable','payable'].includes(e.type), amount = debt ? e.remaining : e.amount;
    return `<div class="activity-row" style="--i:${i}"><div class="activity-icon">${ic}</div><div class="activity-main"><b>${esc(e.person || label)}</b><small>${label} · ${esc(e.date)}${e.note ? ' · '+esc(e.note) : ''}</small></div><div class="activity-amount ${cls}">${JOD(amount)}</div></div>`;
  }).join('');
}
function renderEntries(){
  const q = ($('#searchInput').value || '').trim().toLowerCase(), tf = $('#typeFilter').value, sf = $('#statusFilter').value;
  let arr = allEntries().sort((a,b)=> String(b.date).localeCompare(String(a.date)));
  arr = arr.filter(e => (!q || `${e.person} ${e.note}`.toLowerCase().includes(q)) && (tf === 'all' || e.type === tf) && (sf === 'all' || e.status === sf || (!['receivable','payable'].includes(e.type) && sf==='all')));
  const box = $('#entriesList');
  if(!arr.length){ box.innerHTML = empty('ما لقينا حركات مطابقة', 'غيّر الفلتر أو أضف حركة جديدة'); return; }
  box.innerHTML = arr.map((e,i)=>{
    const [ic,label,cls] = typeInfo(e.type), debt = ['receivable','payable'].includes(e.type), shown = debt ? e.remaining : e.amount;
    return `<article class="entry-card" style="--i:${Math.min(i,12)}"><div class="entry-badge">${ic}</div><div class="entry-main"><h4>${esc(e.person || label)}</h4><div class="entry-meta"><span>${label}</span><span>📅 ${esc(e.date)}</span>${e.note ? `<span>📝 ${esc(e.note)}</span>` : ''}${e.receiptPath ? '<span>📸 إيصال</span>' : ''}</div></div><div class="entry-money"><strong class="${cls}">${JOD(shown)}</strong>${debt ? `<small>الأصل ${JOD(e.amount)} · المدفوع ${JOD(e.paid)}</small>` : ''}</div><div class="entry-actions">${debt && e.remaining > 0 ? `<button class="tiny-btn" data-pay="${e.id}" title="دفعة">💳</button>` : ''}${e.receiptPath ? `<button class="tiny-btn" data-receipt="${e.id}" title="الإيصال">📸</button>` : ''}<button class="tiny-btn" data-edit="${e.id}" title="تعديل">✎</button></div></article>`;
  }).join('');
  bindDynamic();
}
function renderDebts(){
  const debts = allEntries().filter(e => ['receivable','payable'].includes(e.type) && e.remaining > 0).sort((a,b)=> b.remaining - a.remaining);
  const box = $('#debtsList'), prev = $('#debtPreview');
  if(!debts.length){
    box.innerHTML = empty('كل الديون مسكرة 🎉', 'ما عندك مبالغ مفتوحة حاليًا');
    prev.innerHTML = empty('ما في ديون مفتوحة', 'لما تضيف دين رح يظهر هون');
    return;
  }
  box.innerHTML = debts.map(e=>{
    const [ic,label,cls] = typeInfo(e.type), pct = Math.max(0, Math.min(100, (e.paid / e.amount) * 100));
    return `<article class="debt-card glass"><div class="debt-card-top"><span>${ic} ${label}</span><small>${esc(e.date)}</small></div><h4>${esc(e.person || 'بدون اسم')}</h4><div class="remaining ${cls}">${JOD(e.remaining)}</div><small>من أصل ${JOD(e.amount)} · مدفوع ${JOD(e.paid)}</small><div class="progress" style="margin-top:12px"><span style="width:${pct}%"></span></div><div class="debt-actions"><button class="btn secondary compact" data-pay="${e.id}">💳 تسجيل دفعة</button><button class="btn ghost compact" data-edit="${e.id}">تفاصيل</button></div></article>`;
  }).join('');
  prev.innerHTML = debts.slice(0,4).map(e=>{
    const pct = Math.max(0, Math.min(100, (e.paid / e.amount) * 100));
    return `<div class="debt-mini"><div class="debt-mini-head"><b>${esc(e.person || 'بدون اسم')}</b><small>${JOD(e.remaining)}</small></div><div class="progress"><span style="width:${pct}%"></span></div></div>`;
  }).join('');
  bindDynamic();
}

function pageTitle(view){
  return ({dashboard:'لوحة التحكم', transactions:'كل الحركات', debts:'الديون والدفعات', settings:'الإعدادات'})[view] || 'تحويشتي';
}
function navigate(view){
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  $('#pageTitle').textContent = pageTitle(view);
}

function resetEntryForm(){
  state.editingId = null;
  state.pendingReceipt = null;
  $('#entryForm').reset();
  $('#entryDate').value = today();
  $('#entryModalTitle').textContent = 'إضافة حركة';
  $('#deleteEntryBtn').classList.add('hidden');
  $('#receiptLabel').textContent = 'JPG / PNG / WEBP — حتى 5MB';
  $('#entryType').value = 'receivable';
  updatePersonLabel();
}
function quickEntry(type='receivable'){
  resetEntryForm();
  $('#entryType').value = type;
  updatePersonLabel();
  openModal('entryModal');
}
function editEntry(id){
  const e = state.entries.find(x => x.id === id);
  if(!e) return;
  state.editingId = id;
  state.pendingReceipt = null;
  $('#entryType').value = e.type;
  $('#entryAmount').value = e.amount;
  $('#entryPerson').value = e.person || '';
  $('#entryDate').value = e.date || today();
  $('#entryNote').value = e.note || '';
  $('#entryModalTitle').textContent = 'تعديل الحركة';
  $('#deleteEntryBtn').classList.remove('hidden');
  $('#receiptLabel').textContent = e.receiptPath ? '✅ يوجد إيصال محفوظ — اختر صورة لاستبداله' : 'JPG / PNG / WEBP — حتى 5MB';
  updatePersonLabel();
  openModal('entryModal');
}
function updatePersonLabel(){
  const t = $('#entryType').value, debt = ['receivable','payable'].includes(t);
  $('#personLabel').textContent = debt ? 'اسم الشخص' : 'الجهة / الوصف';
  $('#entryPerson').placeholder = debt ? 'مثال: أحمد' : 'مثال: راتب / سوبرماركت';
}
function bindDynamic(){
  $$('[data-edit]').forEach(b => b.onclick = () => editEntry(b.dataset.edit));
  $$('[data-pay]').forEach(b => b.onclick = () => startPayment(b.dataset.pay));
  $$('[data-receipt]').forEach(b => b.onclick = () => viewReceipt(b.dataset.receipt));
}

function fileToDataURL(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
async function uploadReceipt(file){
  if(!file) return '';
  if(file.size > 5 * 1024 * 1024) throw new Error('حجم الصورة أكبر من 5MB');
  return await fileToDataURL(file);
}
async function saveEntry(ev){
  ev.preventDefault();
  const type = $('#entryType').value;
  const amount = Number($('#entryAmount').value);
  const person = $('#entryPerson').value.trim();
  const date = $('#entryDate').value;
  const note = $('#entryNote').value.trim();
  if(!(amount > 0)) return toast('اكتب مبلغ صحيح');
  if(!date) return toast('اختر التاريخ');
  if(['receivable','payable'].includes(type) && !person) return toast('اكتب اسم الشخص');
  loading(true);
  try {
    const existing = state.editingId ? state.entries.find(x => x.id === state.editingId) : null;
    const id = existing?.id || uid();
    let receiptPath = existing?.receiptPath || '';
    if(state.pendingReceipt) receiptPath = await uploadReceipt(state.pendingReceipt);
    const now = new Date().toISOString();
    const obj = { id, type, person, amount, date, note, receiptPath, createdAt: existing?.createdAt || now, updatedAt: now };
    state.entries = existing ? state.entries.map(x => x.id === id ? obj : x) : [obj, ...state.entries];
    localSave();
    closeModal('entryModal');
    renderAll();
    toast(existing ? 'تم تعديل الحركة ✅' : 'تم حفظ الحركة ✅');
  } catch (e) {
    console.error(e);
    toast(e.message || 'تعذر حفظ الحركة');
  } finally {
    loading(false);
  }
}
async function deleteEntry(){
  if(!state.editingId || !confirm('متأكد من حذف الحركة وكل دفعاتها؟')) return;
  loading(true);
  try {
    state.entries = state.entries.filter(x => x.id !== state.editingId);
    state.payments = state.payments.filter(p => p.entryId !== state.editingId);
    localSave();
    closeModal('entryModal');
    renderAll();
    toast('تم حذف الحركة');
  } catch (e) {
    console.error(e);
    toast('تعذر الحذف');
  } finally {
    loading(false);
  }
}

function startPayment(id){
  const e = allEntries().find(x => x.id === id);
  if(!e) return;
  state.paymentEntryId = id;
  $('#paymentAmount').value = '';
  $('#paymentAmount').max = e.remaining;
  $('#paymentDate').value = today();
  $('#paymentNote').value = '';
  $('#paymentHint').textContent = `المتبقي على ${e.person || 'الحركة'}: ${JOD(e.remaining)}`;
  openModal('paymentModal');
}
async function savePayment(ev){
  ev.preventDefault();
  const e = allEntries().find(x => x.id === state.paymentEntryId);
  const amount = Number($('#paymentAmount').value);
  const date = $('#paymentDate').value;
  const note = $('#paymentNote').value.trim();
  if(!e) return;
  if(!(amount > 0) || amount > e.remaining + .0001) return toast('قيمة الدفعة غير صحيحة');
  loading(true);
  try {
    state.payments.unshift({ id: uid(), entryId: e.id, amount, date, note, createdAt: new Date().toISOString() });
    localSave();
    closeModal('paymentModal');
    renderAll();
    toast('تم تسجيل الدفعة 💳');
  } catch (err) {
    console.error(err);
    toast('تعذر حفظ الدفعة');
  } finally {
    loading(false);
  }
}

function viewReceipt(entryId){
  const e = state.entries.find(x => x.id === entryId);
  if(!e?.receiptPath) return;
  openModal('receiptModal');
  $('#receiptView').innerHTML = `<img src="${esc(e.receiptPath)}" alt="إيصال">`;
}

function exportBackup(){
  const blob = new Blob([JSON.stringify({version:3, exportedAt:new Date().toISOString(), entries:state.entries, payments:state.payments}, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tahweeshti-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('تم تنزيل النسخة الاحتياطية');
}
async function importBackup(file){
  if(!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('ملف النسخة غير صالح'); }
  if(!Array.isArray(data.entries) || !Array.isArray(data.payments)) return toast('صيغة النسخة غير صحيحة');
  if(!confirm('سيتم دمج/تحديث البيانات الموجودة حسب المعرفات. متابعة؟')) return;
  loading(true);
  try {
    const byId = new Map(state.entries.map(x => [x.id, x]));
    data.entries.forEach(x => byId.set(x.id, x));
    state.entries = [...byId.values()];
    const pby = new Map(state.payments.map(x => [x.id, x]));
    data.payments.forEach(x => pby.set(x.id, x));
    state.payments = [...pby.values()];
    localSave();
    renderAll();
    toast('تم استرجاع النسخة ✅');
  } catch (e) {
    console.error(e);
    toast('تعذر الاسترجاع');
  } finally {
    loading(false);
    $('#importFile').value = '';
  }
}

function bind(){
  $$('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.nav)));
  $$('[data-quick]').forEach(b => b.addEventListener('click', () => quickEntry(b.dataset.quick)));
  $('#quickAddTop').onclick = () => quickEntry('receivable');
  $('#addFromTransactions').onclick = () => quickEntry('receivable');
  $('#mobileAdd').onclick = () => quickEntry('receivable');
  $('#fab').onclick = () => quickEntry('receivable');
  $('#entryForm').addEventListener('submit', saveEntry);
  $('#entryType').onchange = updatePersonLabel;
  $('#deleteEntryBtn').onclick = deleteEntry;
  $('#entryReceipt').onchange = e => {
    const f = e.target.files[0];
    if(!f) return;
    state.pendingReceipt = f;
    $('#receiptLabel').textContent = `✅ ${f.name} — ${(f.size/1024/1024).toFixed(2)}MB`;
  };
  $('#paymentForm').addEventListener('submit', savePayment);
  $('#searchInput').oninput = renderEntries;
  $('#typeFilter').onchange = renderEntries;
  $('#statusFilter').onchange = renderEntries;
  $('#refreshBtn').onclick = () => {
    const d = localLoad();
    state.entries = d.entries || [];
    state.payments = d.payments || [];
    renderAll();
    toast('تم التحديث ↻');
  };
  $('#authForm').addEventListener('submit', authSubmit);
  $('#toggleAuthMode').onclick = async () => {
    if(!isPinSet()) return;
    state.authMode = state.authMode === 'login' ? 'setup' : 'login';
    updateAuthMode();
    clearAuthInputs();
  };
  $('#logoutBtn').onclick = logout;
  $('#settingsLogoutBtn').onclick = logout;
  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => importBackup(e.target.files[0]);
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.installPrompt = e;
    $('#installBtn').classList.remove('hidden');
  });
  $('#installBtn').onclick = async () => {
    if(!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    $('#installBtn').classList.add('hidden');
  };
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape') $$('.modal.open').forEach(m => closeModal(m.id));
  });
}

async function init(){
  setTimeout(() => $('#splash').classList.add('hide'), 1100);
  $('#entryDate').value = today();
  $('#paymentDate').value = today();
  $('#todayLabel').textContent = new Intl.DateTimeFormat('ar-JO',{weekday:'long', day:'numeric', month:'long', timeZone:'Asia/Amman'}).format(new Date());
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  bind();
  setMode();
  if(isPinSet() && isLoggedIn()) await enterApp();
  else showAuth();
}

init().catch(e => { console.error(e); toast('حدث خطأ أثناء تشغيل التطبيق'); });
