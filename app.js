const cfg = window.TAHWEESHTI_CONFIG || {};
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const state = {
  entries: [], payments: [], editingId: null, paymentEntryId: null,
  pendingReceipt: null, authMode: 'login', installPrompt: null,
  initialized: false, sessionToken: localStorage.getItem('tahweeshti_shared_session') || ''
};

const SESSION_KEY = 'tahweeshti_shared_session';
const OWNER_NAME = 'Yahya Saeed';
const JOD = n => `${Number(n||0).toLocaleString('ar-JO',{minimumFractionDigits:0,maximumFractionDigits:3})} ${cfg.currencyLabel||'د.أ'}`;
const today = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Amman'});
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2600)}
function loading(on=true){$('#loading').classList.toggle('hidden',!on)}
function openModal(id){const m=$('#'+id);m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.style.overflow='hidden'}
function closeModal(id){const m=$('#'+id);m.classList.remove('open');m.setAttribute('aria-hidden','true');document.body.style.overflow=''}
function empty(title,note){return `<div class="empty-state"><span>✦</span><b>${esc(title)}</b><div style="margin-top:8px">${esc(note)}</div></div>`}
function saveSession(token){state.sessionToken=token||''; if(token)localStorage.setItem(SESSION_KEY,token); else localStorage.removeItem(SESSION_KEY)}
function setMode(){
  $('#modeBadge').textContent='مزامنة مشتركة';
  $('#modeBadge').style.color='var(--emerald)';
  $('#connectionInfo').textContent='متصل بقاعدة البيانات المشتركة — أي جهاز يدخل نفس رمز الـ4 أرقام يشوف نفس البيانات مباشرة.';
  $('#accountInfo').textContent=`المالك: ${OWNER_NAME} — حساب واحد مشترك ومحمي برمز من 4 أرقام.`;
}

async function api(action,payload={},auth=true){
  const headers={'Content-Type':'application/json'};
  if(cfg.supabaseAnonKey) headers.apikey=cfg.supabaseAnonKey;
  if(auth && state.sessionToken) headers.Authorization=`Bearer ${state.sessionToken}`;
  const res=await fetch(cfg.apiUrl,{method:'POST',headers,body:JSON.stringify({action,...payload})});
  let data={}; try{data=await res.json()}catch{}
  if(res.status===401 && auth){saveSession('');showAuth(true)}
  if(!res.ok) throw new Error(data.error||'تعذر الاتصال بالخادم');
  return data;
}

function mapEntry(x){return {id:x.id,type:x.type,person:x.person||'',amount:Number(x.amount||0),date:x.entry_date,note:x.note||'',receiptPath:x.receipt_path||'',createdAt:x.created_at,updatedAt:x.updated_at}}
function mapPayment(x){return {id:x.id,entryId:x.entry_id,amount:Number(x.amount||0),date:x.payment_date,note:x.note||'',createdAt:x.created_at}}
async function fetchData(){
  const d=await api('list');
  state.entries=(d.entries||[]).map(mapEntry);
  state.payments=(d.payments||[]).map(mapPayment);
}
function entryPaid(id){return state.payments.filter(p=>p.entryId===id).reduce((a,p)=>a+Number(p.amount||0),0)}
function enrich(e){const paid=entryPaid(e.id),debt=['receivable','payable'].includes(e.type),remaining=debt?Math.max(0,Number(e.amount)-paid):0,status=!debt?'na':remaining<=.0001?'paid':paid>0?'partial':'open';return {...e,paid,remaining,status}}
function allEntries(){return state.entries.map(enrich)}
function totals(){let r=0,p=0,i=0,x=0;allEntries().forEach(e=>{if(e.type==='receivable')r+=e.remaining;if(e.type==='payable')p+=e.remaining;if(e.type==='income')i+=e.amount;if(e.type==='expense')x+=e.amount});return {r,p,i,x,net:r-p+i-x}}
const typeInfo=t=>({receivable:['💚','إلي','pos'],payable:['🔴','عليّ','neg'],income:['📈','إيراد','pos'],expense:['📉','مصروف','neg']}[t]||['🧾','حركة','']);

function showAuth(forceLogin=false){
  $('#app').classList.add('hidden');$('#authScreen').classList.remove('hidden');
  state.authMode=(state.initialized||forceLogin)?'login':'setup';
  updateAuthMode();
  $('#authPin').value='';$('#authPinConfirm').value='';$('#authMessage').textContent='';
}
function updateAuthMode(){
  const setup=state.authMode==='setup';
  $('#pinLabel').textContent=setup?'أنشئ رمز الدخول':'رمز الدخول';
  $('#loginSubmit span').textContent=setup?'إنشاء الحساب المشترك':'تسجيل الدخول';
  $('#authSubtitle').textContent=setup
    ?'اختر رمز من 4 أرقام مرة واحدة. بعدها أي جهاز يدخل نفس الرمز يشوف نفس الحساب والبيانات.'
    :'أدخل نفس الرمز من 4 أرقام، وبتظهر لك نفس البيانات من أي جهاز.';
  $('#pinConfirmField').classList.toggle('hidden',!setup);
  $('#authPinConfirm').required=setup;
  $('.auth-switch').classList.add('hidden');
  $('.auth-note').textContent='🔒 حساب واحد مشترك — بدون إيميل. نفس الرمز = نفس البيانات على كل الأجهزة.';
}
async function authSubmit(ev){
  ev.preventDefault();
  const pin=($('#authPin').value||'').replace(/\D/g,'');
  const confirmPin=($('#authPinConfirm').value||'').replace(/\D/g,'');
  $('#authMessage').textContent='';
  if(pin.length!==4){$('#authMessage').textContent='الرمز لازم يكون 4 أرقام.';return}
  loading(true);
  try{
    let d;
    if(state.authMode==='setup'){
      if(confirmPin.length!==4)throw new Error('أكد الرمز من 4 أرقام.');
      if(pin!==confirmPin)throw new Error('الرمزان غير متطابقين.');
      d=await api('setup',{pin},false);state.initialized=true;
    }else d=await api('login',{pin},false);
    saveSession(d.token);
    const wasSetup=state.authMode==='setup';
    await enterApp();
    toast(wasSetup?'تم إنشاء الحساب المشترك ✨':'أهلًا فيك 👋');
  }catch(e){$('#authMessage').textContent=e.message||'تعذر المتابعة'}
  finally{loading(false);$('#authPin').value='';$('#authPinConfirm').value=''}
}
async function enterApp(){
  loading(true);
  try{
    await fetchData();setMode();$('#authScreen').classList.add('hidden');$('#app').classList.remove('hidden');
    navigate('dashboard');renderAll();
  }catch(e){console.error(e);if(state.sessionToken)toast(e.message||'تعذر تحميل البيانات')}
  finally{loading(false)}
}
async function logout(){
  try{if(state.sessionToken)await api('logout')}catch{}
  saveSession('');showAuth(true);toast('تم تسجيل الخروج');
}

function showInstallButtons(show){
  ['installBtn','authInstallBtn','heroInstallBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.classList.toggle('hidden', !show);
  });
}

async function triggerInstall(){
  if(state.installPrompt){
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    showInstallButtons(false);
    return;
  }
  toast('إذا ما ظهر التنزيل، افتح خيارات المتصفح واختر إضافة إلى الشاشة الرئيسية');
}

function animateNumber(el,target){const from=Number(el.dataset.value||0),start=performance.now(),dur=500;el.dataset.value=target;const step=now=>{const t=Math.min(1,(now-start)/dur),e=1-Math.pow(1-t,3),v=from+(target-from)*e;el.textContent=JOD(v);if(t<1)requestAnimationFrame(step)};requestAnimationFrame(step)}
function renderAll(){renderStats();renderRecent();renderEntries();renderDebts();setMode()}
function renderStats(){const t=totals();animateNumber($('#receivableTotal'),t.r);animateNumber($('#payableTotal'),t.p);animateNumber($('#incomeTotal'),t.i);animateNumber($('#expenseTotal'),t.x);animateNumber($('#netBalance'),t.net);$('#netBalance').classList.toggle('neg',t.net<0);$('#netHint').textContent=state.entries.length?`${state.entries.length} حركة مسجلة — متزامنة الآن`:'ابدأ بإضافة أول حركة'}
function renderRecent(){const arr=allEntries().sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date))).slice(0,6),box=$('#recentList');if(!arr.length){box.innerHTML=empty('ما في حركات لسه','أضف أول حركة من زر +');return}box.innerHTML=arr.map((e,i)=>{const [ic,label,cls]=typeInfo(e.type),debt=['receivable','payable'].includes(e.type),amount=debt?e.remaining:e.amount;return `<div class="activity-row" style="--i:${i}"><div class="activity-icon">${ic}</div><div class="activity-main"><b>${esc(e.person||label)}</b><small>${label} · ${esc(e.date)}${e.note?' · '+esc(e.note):''}</small></div><div class="activity-amount ${cls}">${JOD(amount)}</div></div>`}).join('')}
function renderEntries(){const q=$('#searchInput').value.trim().toLowerCase(),tf=$('#typeFilter').value,sf=$('#statusFilter').value;let arr=allEntries().sort((a,b)=>String(b.date).localeCompare(String(a.date)));arr=arr.filter(e=>(!q||`${e.person} ${e.note}`.toLowerCase().includes(q))&&(tf==='all'||e.type===tf)&&(sf==='all'||e.status===sf||(!['receivable','payable'].includes(e.type)&&sf==='all')));const box=$('#entriesList');if(!arr.length){box.innerHTML=empty('ما لقينا حركات مطابقة','غيّر الفلتر أو أضف حركة جديدة');return}box.innerHTML=arr.map((e,i)=>{const [ic,label,cls]=typeInfo(e.type),debt=['receivable','payable'].includes(e.type),shown=debt?e.remaining:e.amount;return `<article class="entry-card" style="--i:${Math.min(i,12)}"><div class="entry-badge">${ic}</div><div class="entry-main"><h4>${esc(e.person||label)}</h4><div class="entry-meta"><span>${label}</span><span>📅 ${esc(e.date)}</span>${e.note?`<span>📝 ${esc(e.note)}</span>`:''}${e.receiptPath?'<span>📸 إيصال</span>':''}</div></div><div class="entry-money"><strong class="${cls}">${JOD(shown)}</strong>${debt?`<small>الأصل ${JOD(e.amount)} · المدفوع ${JOD(e.paid)}</small>`:''}</div><div class="entry-actions">${debt&&e.remaining>0?`<button class="tiny-btn" data-pay="${e.id}" title="دفعة">💳</button>`:''}${e.receiptPath?`<button class="tiny-btn" data-receipt="${e.id}" title="الإيصال">📸</button>`:''}<button class="tiny-btn" data-edit="${e.id}" title="تعديل">✎</button></div></article>`}).join('');bindDynamic()}
function renderDebts(){const debts=allEntries().filter(e=>['receivable','payable'].includes(e.type)&&e.remaining>0).sort((a,b)=>b.remaining-a.remaining),box=$('#debtsList'),prev=$('#debtPreview');if(!debts.length){box.innerHTML=empty('كل الديون مسكرة 🎉','ما عندك مبالغ مفتوحة حاليًا');prev.innerHTML=empty('ما في ديون مفتوحة','لما تضيف دين رح يظهر هون');return}box.innerHTML=debts.map(e=>{const [ic,label,cls]=typeInfo(e.type),pct=Math.max(0,Math.min(100,(e.paid/e.amount)*100));return `<article class="debt-card glass"><div class="debt-card-top"><span>${ic} ${label}</span><small>${esc(e.date)}</small></div><h4>${esc(e.person||'بدون اسم')}</h4><div class="remaining ${cls}">${JOD(e.remaining)}</div><small>من أصل ${JOD(e.amount)} · مدفوع ${JOD(e.paid)}</small><div class="progress" style="margin-top:12px"><span style="width:${pct}%"></span></div><div class="debt-actions"><button class="btn secondary compact" data-pay="${e.id}">💳 تسجيل دفعة</button><button class="btn ghost compact" data-edit="${e.id}">تفاصيل</button></div></article>`}).join('');prev.innerHTML=debts.slice(0,4).map(e=>{const pct=Math.max(0,Math.min(100,(e.paid/e.amount)*100));return `<div class="debt-mini"><div class="debt-mini-head"><b>${esc(e.person||'بدون اسم')}</b><small>${JOD(e.remaining)}</small></div><div class="progress"><span style="width:${pct}%"></span></div></div>`}).join('');bindDynamic()}

function pageTitle(v){return ({dashboard:'لوحة التحكم',transactions:'كل الحركات',debts:'الديون والدفعات',settings:'الإعدادات'})[v]||'تحويشتي'}
function navigate(view){$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));$$('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));$('#pageTitle').textContent=pageTitle(view)}
function resetEntryForm(){state.editingId=null;state.pendingReceipt=null;$('#entryForm').reset();$('#entryDate').value=today();$('#entryModalTitle').textContent='إضافة حركة';$('#deleteEntryBtn').classList.add('hidden');$('#receiptLabel').textContent='JPG / PNG / WEBP — حتى 5MB';$('#entryType').value='receivable';updatePersonLabel()}
function quickEntry(type='receivable'){resetEntryForm();$('#entryType').value=type;updatePersonLabel();openModal('entryModal')}
function editEntry(id){const e=state.entries.find(x=>x.id===id);if(!e)return;state.editingId=id;state.pendingReceipt=null;$('#entryType').value=e.type;$('#entryAmount').value=e.amount;$('#entryPerson').value=e.person||'';$('#entryDate').value=e.date||today();$('#entryNote').value=e.note||'';$('#entryModalTitle').textContent='تعديل الحركة';$('#deleteEntryBtn').classList.remove('hidden');$('#receiptLabel').textContent=e.receiptPath?'✅ يوجد إيصال محفوظ — اختر صورة لاستبداله':'JPG / PNG / WEBP — حتى 5MB';updatePersonLabel();openModal('entryModal')}
function updatePersonLabel(){const t=$('#entryType').value,debt=['receivable','payable'].includes(t);$('#personLabel').textContent=debt?'اسم الشخص':'الجهة / الوصف';$('#entryPerson').placeholder=debt?'مثال: أحمد':'مثال: راتب / سوبرماركت'}
function bindDynamic(){$$('[data-edit]').forEach(b=>b.onclick=()=>editEntry(b.dataset.edit));$$('[data-pay]').forEach(b=>b.onclick=()=>startPayment(b.dataset.pay));$$('[data-receipt]').forEach(b=>b.onclick=()=>viewReceipt(b.dataset.receipt))}

function fileToBase64(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]||'');r.onerror=rej;r.readAsDataURL(file)})}
async function saveEntry(ev){
  ev.preventDefault();
  const type=$('#entryType').value,amount=Number($('#entryAmount').value),person=$('#entryPerson').value.trim(),date=$('#entryDate').value,note=$('#entryNote').value.trim();
  if(!(amount>0))return toast('اكتب مبلغ صحيح');if(!date)return toast('اختر التاريخ');if(['receivable','payable'].includes(type)&&!person)return toast('اكتب اسم الشخص');
  loading(true);
  try{
    const existing=state.editingId?state.entries.find(x=>x.id===state.editingId):null,id=existing?.id||uid();
    let receiptPath=existing?.receiptPath||'';
    if(state.pendingReceipt){
      if(state.pendingReceipt.size>5*1024*1024)throw new Error('حجم الصورة أكبر من 5MB');
      const base64=await fileToBase64(state.pendingReceipt);
      const u=await api('receipt_upload',{entryId:id,mime:state.pendingReceipt.type,base64});
      receiptPath=u.path;
    }
    await api('entry_upsert',{entry:{id,type,person,amount,date,note,receiptPath}});
    await fetchData();closeModal('entryModal');renderAll();toast(existing?'تم تعديل الحركة ✅':'تم حفظ الحركة ✅');
  }catch(e){console.error(e);toast(e.message||'تعذر حفظ الحركة')}finally{loading(false)}
}
async function deleteEntry(){
  if(!state.editingId||!confirm('متأكد من حذف الحركة وكل دفعاتها؟'))return;
  loading(true);try{await api('entry_delete',{id:state.editingId});await fetchData();closeModal('entryModal');renderAll();toast('تم حذف الحركة')}catch(e){toast(e.message||'تعذر الحذف')}finally{loading(false)}
}
function startPayment(id){const e=allEntries().find(x=>x.id===id);if(!e)return;state.paymentEntryId=id;$('#paymentAmount').value='';$('#paymentAmount').max=e.remaining;$('#paymentDate').value=today();$('#paymentNote').value='';$('#paymentHint').textContent=`المتبقي على ${e.person||'الحركة'}: ${JOD(e.remaining)}`;openModal('paymentModal')}
async function savePayment(ev){ev.preventDefault();const e=allEntries().find(x=>x.id===state.paymentEntryId),amount=Number($('#paymentAmount').value),date=$('#paymentDate').value,note=$('#paymentNote').value.trim();if(!e)return;if(!(amount>0)||amount>e.remaining+.0001)return toast('قيمة الدفعة غير صحيحة');loading(true);try{await api('payment_add',{payment:{entryId:e.id,amount,date,note}});await fetchData();closeModal('paymentModal');renderAll();toast('تم تسجيل الدفعة 💳')}catch(err){toast(err.message||'تعذر حفظ الدفعة')}finally{loading(false)}}
async function viewReceipt(entryId){const e=state.entries.find(x=>x.id===entryId);if(!e?.receiptPath)return;openModal('receiptModal');$('#receiptView').innerHTML='جاري تحميل الصورة...';try{const d=await api('receipt_url',{path:e.receiptPath});$('#receiptView').innerHTML=`<img src="${esc(d.url)}" alt="إيصال">`}catch(err){$('#receiptView').textContent='تعذر تحميل الصورة'}}

function exportBackup(){const blob=new Blob([JSON.stringify({version:4,exportedAt:new Date().toISOString(),entries:state.entries,payments:state.payments},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`tahweeshti-backup-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('تم تنزيل النسخة الاحتياطية')}
async function importBackup(file){if(!file)return;let data;try{data=JSON.parse(await file.text())}catch{return toast('ملف النسخة غير صالح')}if(!Array.isArray(data.entries)||!Array.isArray(data.payments))return toast('صيغة النسخة غير صحيحة');if(!confirm('سيتم دمج/تحديث البيانات الموجودة. متابعة؟'))return;loading(true);try{await api('import',{entries:data.entries,payments:data.payments});await fetchData();renderAll();toast('تم استرجاع النسخة ✅')}catch(e){toast(e.message||'تعذر الاسترجاع')}finally{loading(false);$('#importFile').value=''}}

function bind(){
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
  $$('[data-quick]').forEach(b=>b.addEventListener('click',()=>quickEntry(b.dataset.quick)));
  $('#quickAddTop').onclick=()=>quickEntry('receivable');$('#addFromTransactions').onclick=()=>quickEntry('receivable');$('#mobileAdd').onclick=()=>quickEntry('receivable');$('#fab').onclick=()=>quickEntry('receivable');
  $('#entryForm').addEventListener('submit',saveEntry);$('#entryType').onchange=updatePersonLabel;$('#deleteEntryBtn').onclick=deleteEntry;
  $('#entryReceipt').onchange=e=>{const f=e.target.files[0];if(!f)return;state.pendingReceipt=f;$('#receiptLabel').textContent=`✅ ${f.name} — ${(f.size/1024/1024).toFixed(2)}MB`};
  $('#paymentForm').addEventListener('submit',savePayment);$('#searchInput').oninput=renderEntries;$('#typeFilter').onchange=renderEntries;$('#statusFilter').onchange=renderEntries;
  $('#refreshBtn').onclick=async()=>{loading(true);try{await fetchData();renderAll();toast('تم التحديث والمزامنة ↻')}catch(e){toast(e.message||'تعذر التحديث')}finally{loading(false)}};
  $('#authForm').addEventListener('submit',authSubmit);
  $('#toggleAuthMode').onclick=()=>{};
  $('#logoutBtn').onclick=logout;$('#settingsLogoutBtn').onclick=logout;$('#exportBtn').onclick=exportBackup;$('#importBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=e=>importBackup(e.target.files[0]);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;showInstallButtons(true)});
  ['installBtn','authInstallBtn','heroInstallBtn'].forEach(id=>{ const el=document.getElementById(id); if(el) el.onclick=()=>triggerInstall(); });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal.open').forEach(m=>closeModal(m.id))});
}

async function init(){
  setTimeout(()=>$('#splash').classList.add('hide'),1100);
  $('#entryDate').value=today();$('#paymentDate').value=today();
  $('#todayLabel').textContent=new Intl.DateTimeFormat('ar-JO',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Amman'}).format(new Date());
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  bind();setMode();
  try{
    const s=await api('status',{},false);state.initialized=!!s.initialized;
    if(state.sessionToken){try{await api('session');await enterApp();return}catch{saveSession('')}}
    showAuth();
  }catch(e){console.error(e);showAuth(true);$('#authMessage').textContent='تعذر الاتصال بالخادم. جرّب تحديث الصفحة.'}
}

init().catch(e=>{console.error(e);toast('حدث خطأ أثناء تشغيل التطبيق')});
