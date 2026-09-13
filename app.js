const cfg = window.TAHWEESHTI_CONFIG || {};
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const SESSION_KEY = 'tahweeshti_shared_session';
const OWNER_NAME = 'Yahya Saeed';
const APP_VERSION = '7.4.1';
const DEFAULT_PREFS = {
  theme:'dark', hideAmounts:false, notifications:false, autoLockMinutes:15,
  hiddenCards:[], viewOnly:false, calendarMonth:'', dashboardCompact:false
};
const BUILTIN_CATEGORIES = [
  ['عام','🧾'],['أكل','🍔'],['بنزين','⛽'],['سيارة','🚗'],['بيت','🏠'],['فواتير','💡'],['تسوق','🛍️'],
  ['ترفيه','🎮'],['صحة','🩺'],['تعليم','📚'],['راتب','💼'],['شغل','🧰'],['سفر','✈️'],['أقساط','📆'],['اشتراكات','🔁'],['توفير','🎯']
];
const PAYMENT_METHODS = ['كاش','CliQ','بنك','محفظة','حوالة','بطاقة'];

const state = {
  entries:[], payments:[], documents:[], initialized:false,
  sessionToken:localStorage.getItem(SESSION_KEY)||'', installPrompt:null,
  view:'dashboard', editingEntryId:null, paymentEntryId:null, pendingReceipt:null,
  prefs:{...DEFAULT_PREFS}, admin:{enabled:false,unlocked:false},
  filters:{q:'',type:'all',status:'all',year:'all',category:'all',wallet:'all'},
  calendarCursor:new Date(), lastActivity:Date.now(), autoLockTimer:null,
  modalContext:null, lastUndo:null
};

const today = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Amman'});
const monthKey = () => today().slice(0,7);
const fmtDate = d => { try { return new Intl.DateTimeFormat('ar-JO',{year:'numeric',month:'short',day:'numeric',timeZone:'Asia/Amman'}).format(new Date(`${d}T12:00:00`)); } catch { return d; } };
const fmtDateTime = d => { try { return new Intl.DateTimeFormat('ar-JO',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Amman'}).format(new Date(d)); } catch { return d; } };
const esc = v => String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const refCode = () => `THW-${Date.now().toString(36).slice(-5).toUpperCase()}${Math.floor(Math.random()*90+10)}`;
const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
const normalizeDigits = s => String(s||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const money = n => state.prefs.hideAmounts ? '•••• د.أ' : `${Number(n||0).toLocaleString('ar-JO',{maximumFractionDigits:3})} ${cfg.currencyLabel||'د.أ'}`;
const percent = n => `${Math.round(Number(n||0))}%`;
const daysBetween = (a,b) => Math.ceil((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`))/86400000);

function addMonthsClamped(dateStr,months=1,anchorDay=0){
  const base=new Date(`${dateStr||today()}T12:00:00`);
  const wanted=Number(anchorDay||base.getDate());
  const y=base.getFullYear(),m=base.getMonth()+Number(months||1);
  const first=new Date(y,m,1,12,0,0);
  const last=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  return `${first.getFullYear()}-${String(first.getMonth()+1).padStart(2,'0')}-${String(Math.min(wanted,last)).padStart(2,'0')}`;
}
function subscriptionStatus(x){
  if(x.enabled===false)return {label:'متوقف',cls:'danger'};
  const d=daysBetween(today(),x.nextDate||today());
  if(d<0)return {label:`متأخر ${Math.abs(d)} يوم`,cls:'danger'};
  if(d===0)return {label:'موعده اليوم',cls:'warn'};
  if(d<=3)return {label:`بعد ${d} يوم`,cls:'warn'};
  return {label:`بعد ${d} يوم`,cls:'success'};
}

function toast(msg, actionLabel='', actionFn=null){
  const root=$('#toast'), text=$('#toastText'), btn=$('#toastAction');
  text.textContent=msg; root.classList.add('show'); clearTimeout(toast.t);
  if(actionLabel&&actionFn){btn.textContent=actionLabel;btn.classList.remove('hidden');btn.onclick=async()=>{btn.classList.add('hidden');root.classList.remove('show');await actionFn()}}
  else {btn.classList.add('hidden');btn.onclick=null}
  toast.t=setTimeout(()=>root.classList.remove('show'),4200);
}
function loading(on=true,msg='جاري التنفيذ...'){ $('#loading').classList.toggle('hidden',!on); const s=$('#loading span'); if(s)s.textContent=msg; }
function saveSession(token){state.sessionToken=token||''; if(token)localStorage.setItem(SESSION_KEY,token); else localStorage.removeItem(SESSION_KEY)}
function guardMutation(){ if(state.prefs.viewOnly){toast('وضع العرض فقط مفعّل 👁️');return false} return true; }

function empty(title,note=''){
  return `<div class="empty-state"><span>✦</span><b>${esc(title)}</b>${note?`<div>${esc(note)}</div>`:''}</div>`;
}

function openModal(title,eyebrow,html,{size='',context=null}={}){
  state.modalContext=context;
  $('#modalTitle').textContent=title; $('#modalEyebrow').textContent=eyebrow||''; $('#modalBody').innerHTML=html;
  const card=$('#modalRoot .modal-card'); card.className=`modal-card glass ${size}`.trim();
  $('#modalRoot').classList.add('open'); $('#modalRoot').setAttribute('aria-hidden','false'); document.body.style.overflow='hidden';
}
function closeModal(){ $('#modalRoot').classList.remove('open'); $('#modalRoot').setAttribute('aria-hidden','true'); document.body.style.overflow=''; state.modalContext=null; state.pendingReceipt=null; }

function validateShell(){
  const required=[
    '#splash','#authScreen','#app','#authForm','#authPin','#authPinConfirm','#loginSubmit',
    '#quickAddTop','#mobileAdd','#logoutBtn','#refreshBtn','#themeBtn','#privacyBtn',
    '#authInstallBtn','#createAccountBtn','#accountSwitchHint','#modalRoot','#modalBody','#loading','#toast','#toastText','#toastAction',
    '#view-dashboard','#view-transactions','#view-people','#view-goals','#view-planning','#view-subscriptions',
    '#view-analytics','#view-calendar','#view-settings','#pageTitle','#todayLabel','#modeBadge'
  ];
  const missing=required.filter(s=>!document.querySelector(s));
  if(missing.length) throw new Error(`واجهة غير متوافقة مع الكود: ${missing.join(', ')}`);
  if(!cfg.apiUrl) throw new Error('إعداد apiUrl غير موجود في config.js');
  return true;
}

async function api(action,payload={},auth=true){
  const headers={'Content-Type':'application/json'};
  if(cfg.supabaseAnonKey)headers.apikey=cfg.supabaseAnonKey;
  if(auth&&state.sessionToken)headers.Authorization=`Bearer ${state.sessionToken}`;
  const res=await fetch(cfg.apiUrl,{method:'POST',headers,body:JSON.stringify({action,...payload})});
  let data={}; try{data=await res.json()}catch{}
  if(res.status===401&&auth){saveSession('');showAuth(true)}
  if(!res.ok)throw new Error(data.error||'تعذر الاتصال بالخادم');
  return data;
}

function mapEntry(x){return {id:x.id,type:x.type,person:x.person||'',amount:Number(x.amount||0),date:x.entry_date,note:x.note||'',receiptPath:x.receipt_path||'',meta:x.meta||{},createdAt:x.created_at,updatedAt:x.updated_at}}
function mapPayment(x){return {id:x.id,entryId:x.entry_id,amount:Number(x.amount||0),date:x.payment_date,note:x.note||'',meta:x.meta||{},createdAt:x.created_at}}
function mapDoc(x){return {id:x.id,kind:x.kind,data:x.data||{},createdAt:x.created_at,updatedAt:x.updated_at}}
function docs(kind){return state.documents.filter(d=>d.kind===kind)}
function prefDoc(){return docs('preference')[0]||null}
function personProfile(name){return docs('person').find(d=>String(d.data.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase())}
function wallets(){return docs('wallet')}
function goals(){return docs('goal')}
function subscriptions(){return docs('subscription')}
function currentBudget(month=monthKey()){return docs('budget').find(d=>d.data.month===month)}
function categories(){
  const map=new Map(BUILTIN_CATEGORIES.map(([name,icon])=>[name,{name,icon}]));
  docs('category').forEach(d=>map.set(d.data.name,{name:d.data.name,icon:d.data.icon||'🏷️',id:d.id}));
  return [...map.values()];
}
function walletById(id){return wallets().find(w=>w.id===id)}
function entryPaid(id){return state.payments.filter(p=>p.entryId===id).reduce((a,p)=>a+Number(p.amount||0),0)}
function enrich(e){const paid=entryPaid(e.id),debt=['receivable','payable'].includes(e.type),remaining=debt?Math.max(0,e.amount-paid):0,status=!debt?'na':remaining<=.0001?'paid':paid>0?'partial':'open';return {...e,paid,remaining,status}}
function allEntries(){return state.entries.map(enrich)}
function typeInfo(t){return ({receivable:['💚','إلي','pos'],payable:['🔴','عليّ','neg'],income:['📈','إيراد','pos'],expense:['📉','مصروف','neg']}[t]||['🧾','حركة',''])}
function totals(){let r=0,p=0,i=0,x=0;allEntries().forEach(e=>{if(e.type==='receivable')r+=e.remaining;if(e.type==='payable')p+=e.remaining;if(e.type==='income')i+=e.amount;if(e.type==='expense')x+=e.amount});return {receivable:r,payable:p,income:i,expense:x,net:r-p+i-x}}
function entriesForMonth(month=monthKey()){return allEntries().filter(e=>String(e.date||'').startsWith(month))}
function monthTotals(month=monthKey()){let income=0,expense=0;entriesForMonth(month).forEach(e=>{if(e.type==='income')income+=e.amount;if(e.type==='expense')expense+=e.amount});return {income,expense,net:income-expense}}
function docOption(list,selected,placeholder='بدون'){return `<option value="">${placeholder}</option>`+list.map(d=>`<option value="${esc(d.id)}" ${d.id===selected?'selected':''}>${esc(d.data.name||d.data.title||'')}</option>`).join('')}
function categoryOptions(selected=''){return categories().map(c=>`<option value="${esc(c.name)}" ${c.name===selected?'selected':''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
function paymentOptions(selected=''){return PAYMENT_METHODS.map(x=>`<option value="${x}" ${x===selected?'selected':''}>${x}</option>`).join('')}

async function fetchData(){
  const d=await api('bootstrap');
  state.entries=(d.entries||[]).map(mapEntry); state.payments=(d.payments||[]).map(mapPayment); state.documents=(d.documents||[]).map(mapDoc);
  const p=prefDoc(); state.prefs={...DEFAULT_PREFS,...(p?.data||{})};
  applyPrefs();
}
function applyPrefs(){
  document.body.classList.toggle('light-theme',state.prefs.theme==='light');
  document.body.classList.toggle('amount-hidden',!!state.prefs.hideAmounts);
  document.body.classList.toggle('view-only',!!state.prefs.viewOnly);
  $('#themeBtn').textContent=state.prefs.theme==='light'?'☀':'☾';
  $('#privacyBtn').textContent=state.prefs.hideAmounts?'◌':'◉';
  resetAutoLock();
}
async function savePrefs(patch,rerender=true){
  const next={...state.prefs,...patch}; const d=prefDoc();
  await api('doc_upsert',{document:{id:d?.id,kind:'preference',data:next}});
  state.prefs=next; applyPrefs(); if(rerender)await refreshAll(false);
}
async function refreshAll(fetch=true){if(fetch)await fetchData();renderCurrent();}

function setAuthMode(mode='login'){
  const setup=mode==='setup';
  $('#authForm').dataset.mode=mode;
  $('#pinLabel').textContent=setup?'أنشئ رمز جديد':'رمز الدخول';
  $('#loginSubmit span').textContent=setup?'إنشاء الحساب':'تسجيل الدخول';
  $('#authSubtitle').textContent=setup
    ?'اختَر رمز من 4 أرقام غير مستخدم. هذا الرمز رح يكون حسابك ويفتح نفس بياناتك من أي جهاز.'
    :'أدخل رمز حسابك المكوّن من 4 أرقام لتظهر بياناتك من أي جهاز.';
  $('#pinConfirmField').classList.toggle('hidden',!setup);
  $('#authPinConfirm').required=setup;
  $('#createAccountBtn').textContent=setup?'← رجوع لتسجيل الدخول':'＋ إنشاء حساب جديد';
  $('#accountSwitchHint').textContent=setup?'عندك حساب من قبل؟':'أول مرة تستخدم تحويشتي؟';
  $('#authPin').value='';$('#authPinConfirm').value='';$('#authMessage').textContent='';
  setTimeout(()=>$('#authPin')?.focus(),80);
}
function showAuth(forceLogin=false){
  $('#app').classList.add('hidden');$('#authScreen').classList.remove('hidden');
  setAuthMode((!state.initialized&&!forceLogin)?'setup':'login');
}
async function authSubmit(ev){
  ev.preventDefault(); const mode=$('#authForm').dataset.mode||'login';
  const pin=normalizeDigits($('#authPin').value).replace(/\D/g,''),confirmPin=normalizeDigits($('#authPinConfirm').value).replace(/\D/g,'');
  $('#authMessage').textContent='';
  if(pin.length!==4){$('#authMessage').textContent='الرمز لازم يكون 4 أرقام.';return}
  loading(true,mode==='setup'?'جاري إنشاء الحساب...':'جاري تسجيل الدخول...');
  try{
    let d;
    if(mode==='setup'){
      if(confirmPin.length!==4)throw new Error('أكد الرمز من 4 أرقام.');
      if(confirmPin!==pin)throw new Error('الرمزان غير متطابقين.');
      d=await api('signup',{pin},false);state.initialized=true;
    }else d=await api('login',{pin},false);
    state.accountId=d.accountId||'';saveSession(d.token);
    await api('process_recurring',{today:today()});await enterApp();
    toast(mode==='setup'?'تم إنشاء حسابك الجديد ✨':'أهلًا فيك 👋');
  }catch(e){
    const msg=e?.message||'تعذر الدخول';
    $('#authMessage').textContent=msg;
    if(mode==='setup'&&msg.includes('مستخدم'))$('#authPin').focus();
  }finally{loading(false);$('#authPin').value='';$('#authPinConfirm').value=''}
}

async function enterApp(){
  loading(true,'جاري مزامنة بياناتك...');
  try{const sess=await api('session');state.accountId=sess.accountId||state.accountId;await fetchData();const s=await api('admin_status');state.admin=s;$('#authScreen').classList.add('hidden');$('#app').classList.remove('hidden');setMode();navigate('dashboard');maybeNotifyDue();handleQuickParam();}
  finally{loading(false)}
}
function setMode(){const m=$('#modeBadge');m.textContent='مزامنة مشتركة';m.style.color='var(--emerald)'}
async function logout(){try{if(state.sessionToken)await api('logout')}catch{}state.accountId='';saveSession('');showAuth(true);toast('تم تسجيل الخروج')}

function resetAutoLock(){clearTimeout(state.autoLockTimer);state.lastActivity=Date.now();const mins=Number(state.prefs.autoLockMinutes||0);if(mins>0&&state.sessionToken){state.autoLockTimer=setTimeout(async()=>{toast('تم قفل التطبيق تلقائيًا 🔒');await logout()},mins*60*1000)}}
function markActivity(){state.lastActivity=Date.now();resetAutoLock()}
async function requestNotifications(){
  if(!('Notification'in window))return toast('هذا المتصفح لا يدعم التنبيهات');
  const p=await Notification.requestPermission();await savePrefs({notifications:p==='granted'},false);toast(p==='granted'?'تم تفعيل التنبيهات 🔔':'لم يتم السماح بالتنبيهات');renderSettings();
}
function upcomingItems(){
  const arr=[];const now=today();
  allEntries().filter(e=>['receivable','payable'].includes(e.type)&&e.remaining>0&&e.meta?.dueDate).forEach(e=>arr.push({kind:'debt',title:e.person||'دين',date:e.meta.dueDate,amount:e.remaining,type:e.type,id:e.id}));
  docs('installment').forEach(d=>{const x=d.data;if(Number(x.paidInstallments||0)<Number(x.installments||0)&&x.nextDate)arr.push({kind:'installment',title:x.title,date:x.nextDate,amount:Number(x.installmentAmount||0),id:d.id})});
  subscriptions().forEach(d=>{const x=d.data;if(x.enabled!==false&&x.nextDate)arr.push({kind:'subscription',title:x.title||'اشتراك شهري',date:x.nextDate,amount:Number(x.amount||0),direction:x.direction||'outgoing',id:d.id})});
  return arr.sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(x=>({...x,days:daysBetween(now,x.date)}));
}
function maybeNotifyDue(){
  if(!state.prefs.notifications||!('Notification'in window)||Notification.permission!=='granted')return;
  const key=`tahweeshti_notified_${today()}`;if(localStorage.getItem(key))return;
  const due=upcomingItems().filter(x=>x.days>=0&&x.days<=3).slice(0,3);if(!due.length)return;
  new Notification('تحويشتي — تذكير مالي',{body:due.map(x=>`${x.title}: ${money(x.amount)} ${x.days===0?'اليوم':`خلال ${x.days} يوم`}`).join('\n'),icon:'assets/icon-192.png'});localStorage.setItem(key,'1');
}

function walletBalance(w){
  let bal=Number(w.data.startingBalance||0);const id=w.id;
  state.entries.forEach(e=>{if(e.meta?.walletId!==id)return;if(e.type==='income')bal+=e.amount;if(e.type==='expense')bal-=e.amount});
  state.payments.forEach(p=>{if(p.meta?.walletId!==id)return;const e=state.entries.find(x=>x.id===p.entryId);if(!e)return;if(e.type==='receivable')bal+=p.amount;if(e.type==='payable')bal-=p.amount});
  docs('transfer').forEach(t=>{const x=t.data,a=Number(x.amount||0);if(x.toWalletId===id)bal+=a;if(x.fromWalletId===id)bal-=a});
  return bal;
}
function savingsTotal(){return wallets().filter(w=>w.data.type==='savings').reduce((a,w)=>a+walletBalance(w),0)}
function budgetUsage(){const b=currentBudget(),mt=monthTotals();if(!b||!Number(b.data.limit))return {pct:0,spent:mt.expense,limit:0};return {pct:clamp(mt.expense/Number(b.data.limit)*100,0,999),spent:mt.expense,limit:Number(b.data.limit)}}
function healthScore(){const t=totals(),m=monthTotals(),b=budgetUsage();let score=70;if(t.net>=0)score+=10;else score-=15;if(m.income>0){const sr=(m.income-m.expense)/m.income;if(sr>.2)score+=10;if(sr<0)score-=12}if(b.limit&&b.pct>100)score-=15;if(t.payable>t.receivable+t.income)score-=10;return clamp(score,0,100)}
function decisionText(){
  const t=totals(),m=monthTotals(),b=budgetUsage(),due=upcomingItems().filter(x=>x.days>=0&&x.days<=7).reduce((a,x)=>a+x.amount,0);
  if(b.limit&&b.pct>=100)return 'وصلت حد ميزانية هذا الشهر. الأفضل توقف المصاريف غير الضرورية لباقي الشهر.';
  if(due>0&&t.net<due)return `عندك التزامات قريبة بقيمة ${money(due)}. خفّف الصرف لحد ما تغطيها.`;
  if(m.income>m.expense&&m.income>0){const free=Math.max(0,(m.income-m.expense-due)*.35);if(free>1)return `وضعك جيد هذا الشهر. تقدر تحوّش تقريبًا ${money(free)} بدون ضغط واضح على التزاماتك.`}
  if(t.net>=0)return 'وضعك المالي مستقر. ركّز على إغلاق الديون المفتوحة وتحويل جزء ثابت للتوفير.';
  return 'صافي وضعك حاليًا سالب. الأولوية تكون لتقليل المصاريف وإغلاق الالتزامات الأقرب.';
}
function monthSummaryText(){const m=monthTotals();if(!m.income&&!m.expense)return 'لسه ما في حركات دخل أو مصروف هذا الشهر.';const rate=m.income?((m.income-m.expense)/m.income*100):0;return `دخل ${money(m.income)} · صرف ${money(m.expense)} · نسبة الادخار ${Math.round(rate)}%`}

function renderCurrent(){
  try{
    ({dashboard:renderDashboard,transactions:renderTransactions,people:renderPeople,goals:renderGoals,planning:renderPlanning,subscriptions:renderSubscriptions,analytics:renderAnalytics,calendar:renderCalendar,settings:renderSettings}[state.view]||renderDashboard)();
  }catch(err){
    console.error('Tahweeshti render error:',err);
    const view=document.getElementById(`view-${state.view}`);
    if(view){
      view.innerHTML=`<article class="section-card glass render-error">
        <span class="eyebrow">صار خطأ بالعرض</span>
        <h3>تعذر عرض هذه الصفحة</h3>
        <p class="muted">${esc(err?.message||'خطأ غير معروف')}</p>
        <div class="row" style="justify-content:center;margin-top:14px">
          <button class="btn primary" data-nav="dashboard">الرجوع للرئيسية</button>
          <button class="btn ghost" onclick="location.reload()">تحديث الصفحة</button>
        </div>
      </article>`;
    }
    toast('صار خطأ في عرض الصفحة');
  }
}
function navigate(view){state.view=view;$$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));$$('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));$('#pageTitle').textContent=({dashboard:'لوحة التحكم',transactions:'كل الحركات',people:'الأشخاص',goals:'أهداف التحويش',planning:'التخطيط المالي',subscriptions:'الاشتراكات الشهرية',analytics:'الإحصائيات',calendar:'الرزنامة المالية',settings:'الإعدادات'})[view]||'تحويشتي';renderCurrent();window.scrollTo({top:0,behavior:'smooth'})}

function renderDashboard(){
  const t=totals(),health=healthScore(),b=budgetUsage(),due=upcomingItems().filter(x=>x.days<=14).slice(0,5),gs=goals().slice(0,3),hidden=new Set(state.prefs.hiddenCards||[]);
  const healthLabel=health>=75?'ممتاز':health>=55?'متوازن':'يحتاج انتباه';
  $('#view-dashboard').innerHTML=`
    <div class="hero-grid ${hidden.has('decision')?'hidden':''}">
      <article class="balance-card reveal"><div class="balance-shine"></div><span class="hero-label">وضعي اليوم</span><strong class="hero-amount ${t.net<0?'neg':''}" data-money>${money(t.net)}</strong><div class="hero-trend">إلي ${money(t.receivable)} · عليّ ${money(t.payable)}</div><div class="hero-actions"><button class="mini-action mutating" data-act="new-entry" data-type="receivable">＋ إلي</button><button class="mini-action mutating" data-act="new-entry" data-type="payable">− عليّ</button><button class="mini-action mutating" data-act="new-entry" data-type="income">↑ إيراد</button><button class="mini-action mutating" data-act="new-entry" data-type="expense">↓ مصروف</button><button class="mini-action install" data-act="install-app">⇩ تنزيل التطبيق</button></div></article>
      <article class="decision-card glass reveal delay-1"><div class="decision-icon">✦</div><span class="eyebrow">قراري اليوم</span><h3>${healthLabel}</h3><p>${esc(decisionText())}</p><div class="health-row"><span class="small-text">المؤشر ${health}/100</span><div class="health-meter"><span style="width:${health}%"></span></div></div></article>
    </div>
    <div class="stats-grid ${hidden.has('stats')?'hidden':''}">
      ${statCard('↙','green','إلي عند الناس',t.receivable,'مستحقاتك')}${statCard('↗','red','عليّ للناس',t.payable,'التزاماتك')}${statCard('＋','gold','دخل هذا الشهر',monthTotals().income,'إجمالي الداخل')}${statCard('−','blue','صرف هذا الشهر',monthTotals().expense,'إجمالي الخارج')}${statCard('◎','purple','بالتوفير',savingsTotal(),'محافظ التوفير')}
    </div>
    <div class="dash-grid">
      <article class="goal-preview glass ${hidden.has('goals')?'hidden':''}"><div class="section-head"><div><span class="eyebrow">أهداف التحويش</span><h3>تقدّمك</h3></div><button class="btn ghost small" data-nav="goals">عرض الكل</button></div><div class="stack">${gs.length?gs.map(goalMini).join(''):empty('ما في أهداف بعد','أضف أول هدف تحويش')}</div></article>
      <article class="due-preview glass ${hidden.has('dues')?'hidden':''}"><div class="section-head"><div><span class="eyebrow">القادم</span><h3>استحقاقات قريبة</h3></div><button class="btn ghost small" data-nav="calendar">الرزنامة</button></div><div class="stack">${due.length?due.map(dueItem).join(''):empty('ما في استحقاقات قريبة','أمورك مرتبة 👌')}</div></article>
    </div>
    <article class="section-card glass subscription-dashboard" style="margin-top:16px">
      <div class="section-head"><div><span class="eyebrow">الاشتراكات الشهرية</span><h3>دفعات ثابتة بموعد واضح</h3></div><button class="btn ghost small" data-nav="subscriptions">إدارة الاشتراكات</button></div>
      ${subscriptionDashboardHtml()}
    </article>
    <div class="grid-2" style="margin-top:16px">
      <article class="month-summary glass section-card ${hidden.has('summary')?'hidden':''}"><span class="eyebrow">هذا الشهر</span><h3>ملخص مالي</h3><p class="muted">${esc(monthSummaryText())}</p>${b.limit?`<div class="row"><span class="small-text">الميزانية</span><div class="progress spacer"><span style="width:${Math.min(100,b.pct)}%"></span></div><b>${Math.round(b.pct)}%</b></div>`:'<button class="btn secondary small mutating" data-act="budget-form">حدد ميزانية شهرية</button>'}</article>
      <article class="achievement-preview glass section-card ${hidden.has('achievements')?'hidden':''}"><div class="section-head"><div><span class="eyebrow">إنجازات</span><h3>تقدّمك المالي</h3></div><button class="btn ghost small" data-nav="analytics">تفاصيل</button></div><div class="achievement-grid">${achievements().slice(0,4).map(a=>`<div class="achievement ${a.done?'done':''}"><b>${a.icon} ${esc(a.title)}</b><small>${esc(a.note)}</small></div>`).join('')}</div></article>
    </div>`;
}
function statCard(icon,color,label,value,hint){return `<article class="stat-card glass reveal"><span class="stat-icon ${color}">${icon}</span><div><small>${label}</small><strong data-money>${money(value)}</strong><div class="tiny muted">${hint}</div></div></article>`}
function goalMini(d){const x=d.data,target=Number(x.target||0),saved=Number(x.saved||0),pct=target?saved/target*100:0;return `<div class="goal-mini"><div class="goal-mini-head"><b>${esc(x.icon||'🎯')} ${esc(x.title)}</b><span data-money>${money(saved)} / ${money(target)}</span></div><div class="progress"><span style="width:${Math.min(100,pct)}%"></span></div><div class="tiny muted">${Math.round(pct)}%${x.dueDate?` · الهدف ${fmtDate(x.dueDate)}`:''}</div></div>`}
function dueItem(x){const label=x.days<0?'متأخر':x.days===0?'اليوم':`بعد ${x.days} يوم`;return `<div class="due-item"><i class="due-dot"></i><div><b>${esc(x.title)}</b><div class="tiny muted">${label} · ${fmtDate(x.date)}</div></div><strong class="${x.days<0?'neg':'gold'}" data-money>${money(x.amount)}</strong></div>`}

function renderTransactions(){
  const years=[...new Set(state.entries.map(e=>String(e.date).slice(0,4)))].sort().reverse();
  let arr=allEntries().sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt).localeCompare(String(a.createdAt)));
  const f=state.filters;
  arr=arr.filter(e=>(!f.q||`${e.person} ${e.note} ${e.meta?.reference||''} ${(e.meta?.tags||[]).join(' ')}`.toLowerCase().includes(f.q.toLowerCase()))&&(f.type==='all'||e.type===f.type)&&(f.status==='all'||e.status===f.status)&&(f.year==='all'||String(e.date).startsWith(f.year))&&(f.category==='all'||e.meta?.category===f.category)&&(f.wallet==='all'||e.meta?.walletId===f.wallet));
  $('#view-transactions').innerHTML=`
    <div class="smart-box"><div class="section-head"><div><span class="eyebrow">إضافة ذكية</span><h3>اكتبها بطريقتك</h3><p>مثال: «أحمد أخذ 25 اليوم» أو «دفعت 12 بنزين»</p></div></div><div class="smart-row"><input id="smartInput" class="smart-input" placeholder="اكتب الحركة هنا..."><button class="btn secondary mutating" data-act="voice-smart">🎙️ صوت</button><button class="btn primary mutating" data-act="parse-smart">✨ فهم وإضافة</button></div></div>
    <article class="section-card glass"><div class="section-head"><div><span class="eyebrow">السجل الكامل</span><h3>كل الحركات</h3></div><button class="btn primary compact mutating" data-act="new-entry">＋ إضافة حركة</button></div>
      <div class="filters"><div class="search-box">⌕ <input id="filterQ" value="${esc(f.q)}" placeholder="اسم، ملاحظة، رقم مرجعي..."></div><select id="filterType"><option value="all">كل الأنواع</option>${['receivable','payable','income','expense'].map(t=>`<option value="${t}" ${f.type===t?'selected':''}>${typeInfo(t)[1]}</option>`).join('')}</select><select id="filterStatus"><option value="all">كل الحالات</option><option value="open" ${f.status==='open'?'selected':''}>مفتوح</option><option value="partial" ${f.status==='partial'?'selected':''}>جزئي</option><option value="paid" ${f.status==='paid'?'selected':''}>مسدد</option></select><select id="filterYear"><option value="all">كل السنوات</option>${years.map(y=>`<option ${f.year===y?'selected':''}>${y}</option>`).join('')}</select><select id="filterCategory"><option value="all">كل التصنيفات</option>${categories().map(c=>`<option value="${esc(c.name)}" ${f.category===c.name?'selected':''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select><select id="filterWallet"><option value="all">كل المحافظ</option>${wallets().map(w=>`<option value="${w.id}" ${f.wallet===w.id?'selected':''}>${esc(w.data.name)}</option>`).join('')}</select></div>
      <div class="entries-list">${arr.length?arr.map((e,i)=>entryCard(e,i)).join(''):empty('ما لقينا حركات مطابقة','غيّر الفلاتر أو أضف حركة جديدة')}</div>
    </article>`;
  bindFilterInputs();
}
function entryCard(e,i){const [ic,label,cls]=typeInfo(e.type),debt=['receivable','payable'].includes(e.type),shown=debt?e.remaining:e.amount,w=walletById(e.meta?.walletId);return `<article class="entry-card" style="--i:${Math.min(i,14)}"><div class="entry-badge">${ic}</div><div class="entry-main"><h4>${esc(e.person||label)}</h4><div class="entry-meta"><span>${label}</span><span>📅 ${fmtDate(e.date)}</span>${e.meta?.category?`<span>🏷 ${esc(e.meta.category)}</span>`:''}${w?`<span>💳 ${esc(w.data.name)}</span>`:''}${e.meta?.reference?`<span>#${esc(e.meta.reference)}</span>`:''}${e.receiptPath?'<span>📸 إيصال</span>':''}</div></div><div class="entry-money"><strong class="${cls}" data-money>${money(shown)}</strong>${debt?`<small>الأصل ${money(e.amount)} · المدفوع ${money(e.paid)}</small>`:''}</div><div class="entry-actions">${debt&&e.remaining>0?`<button class="tiny-btn mutating" data-act="pay-entry" data-id="${e.id}" title="دفعة">💳</button><button class="tiny-btn mutating" data-act="mark-paid" data-id="${e.id}" title="تم التسديد">✓</button>`:''}${e.receiptPath?`<button class="tiny-btn" data-act="receipt" data-id="${e.id}" title="الإيصال">📸</button>`:''}<button class="tiny-btn" data-act="share-entry" data-id="${e.id}" title="مشاركة">↗</button><button class="tiny-btn mutating" data-act="edit-entry" data-id="${e.id}" title="تعديل">✎</button></div></article>`}
function bindFilterInputs(){
  const q=$('#filterQ');if(q)q.oninput=e=>{state.filters.q=e.target.value;renderTransactions()};
  [['filterType','type'],['filterStatus','status'],['filterYear','year'],['filterCategory','category'],['filterWallet','wallet']].forEach(([id,k])=>{const el=$('#'+id);if(el)el.onchange=e=>{state.filters[k]=e.target.value;renderTransactions()}})
}

function peopleSummary(){
  const map=new Map();allEntries().filter(e=>['receivable','payable'].includes(e.type)).forEach(e=>{const n=(e.person||'بدون اسم').trim(),o=map.get(n)||{name:n,receivable:0,payable:0,total:0,last:e.date};if(e.type==='receivable')o.receivable+=e.remaining;else o.payable+=e.remaining;o.total++;if(String(e.date)>String(o.last))o.last=e.date;map.set(n,o)});
  docs('person').forEach(d=>{const n=String(d.data.name||'').trim();if(n&&!map.has(n))map.set(n,{name:n,receivable:0,payable:0,total:0,last:''})});
  return [...map.values()].map(o=>{const p=personProfile(o.name);return {...o,profile:p,net:o.receivable-o.payable}}).sort((a,b)=>Number(!!b.profile?.data?.pinned)-Number(!!a.profile?.data?.pinned)||Math.abs(b.net)-Math.abs(a.net));
}
function renderPeople(){const list=peopleSummary();$('#view-people').innerHTML=`<div class="section-head"><div><span class="eyebrow">دفتر الأشخاص</span><h3>كل حساباتك حسب الشخص</h3><p>كشف حساب، تسوية صافي، ملاحظات، مشاركة واتساب وطباعة PDF.</p></div><button class="btn secondary compact mutating" data-act="new-person">＋ شخص</button></div><div class="people-grid">${list.length?list.map(personCard).join(''):empty('ما في أشخاص بعد','أضف دين أو شخص جديد')}</div>`}
function personCard(p){const prof=p.profile?.data||{},status=p.net>0?'إلك عليه':p.net<0?'إله عليك':'مسدد';return `<article class="person-card glass" data-act="person-detail" data-name="${esc(p.name)}">${prof.pinned?'<span class="pin-star">★</span>':''}<div class="person-top"><div class="avatar">${esc(p.name[0]||'؟')}</div><div><h4>${esc(p.name)}</h4><small>${status}${p.last?` · آخر حركة ${fmtDate(p.last)}`:''}</small></div></div><div class="person-totals"><div class="person-total"><span>إلي</span><b class="pos" data-money>${money(p.receivable)}</b></div><div class="person-total"><span>عليّ</span><b class="neg" data-money>${money(p.payable)}</b></div></div><div class="row" style="margin-top:12px"><span class="badge ${p.net===0?'success':p.net>0?'warn':'danger'}">الصافي ${money(Math.abs(p.net))}</span><span class="spacer"></span><button class="btn ghost small">فتح الحساب ←</button></div></article>`}

function renderGoals(){const gs=goals();$('#view-goals').innerHTML=`<div class="section-head"><div><span class="eyebrow">أهداف أكبر</span><h3>أهداف التحويش</h3><p>حدد الهدف، قسّمه مراحل، وسجّل كل دفعة تحويش.</p></div><button class="btn primary compact mutating" data-act="goal-form">＋ هدف جديد</button></div><div class="goals-grid">${gs.length?gs.map(goalCard).join(''):empty('لسه ما عندك هدف','ابدأ بهدف بسيط وخليه يكبر معك')}</div>`}
function goalCard(d){const x=d.data,target=Number(x.target||0),saved=Number(x.saved||0),pct=target?saved/target*100:0,stages=Array.isArray(x.stages)?x.stages:[];return `<article class="goal-card glass"><div class="row"><div class="goal-icon">${esc(x.icon||'🎯')}</div><div><h4>${esc(x.title)}</h4><small class="muted">${x.dueDate?`الموعد ${fmtDate(x.dueDate)}`:'بدون موعد'}</small></div><span class="spacer"></span><button class="tiny-btn mutating" data-act="goal-edit" data-id="${d.id}">✎</button></div><div class="goal-value" data-money>${money(saved)} <span class="muted small-text">من ${money(target)}</span></div><div class="progress"><span style="width:${Math.min(100,pct)}%"></span></div><div class="row" style="margin-top:8px"><span class="badge success">${Math.round(pct)}%</span><span class="spacer"></span><button class="btn primary small mutating" data-act="goal-contribute" data-id="${d.id}">＋ تحويش</button></div>${stages.length?`<div class="goal-stages">${stages.map(s=>`<span class="stage-chip ${saved>=Number(s.amount||0)?'done':''}">${esc(s.title)} ${money(s.amount)}</span>`).join('')}</div>`:''}</article>`}

function renderPlanning(){
  const b=currentBudget(),bu=budgetUsage(),ws=wallets(),inst=docs('installment'),recs=docs('recurring'),cats=categories();
  $('#view-planning').innerHTML=`
    <div class="planning-block"><article class="section-card glass"><div class="section-head"><div><span class="eyebrow">الميزانية</span><h3>ميزانية ${new Intl.DateTimeFormat('ar-JO',{month:'long',year:'numeric'}).format(new Date())}</h3></div><button class="btn secondary small mutating" data-act="budget-form">${b?'تعديل':'تحديد'} الميزانية</button></div><div class="budget-hero"><div><h2 data-money>${b?money(b.data.limit):'غير محددة'}</h2><p class="muted">صرفت هذا الشهر ${money(bu.spent)}${b?` من ${money(bu.limit)}`:''}</p><div class="category-bars">${categoryBudgetBars(b)}</div></div><div class="budget-ring" style="--budget-pct:${Math.min(100,bu.pct)}%"><strong>${b?Math.round(bu.pct)+'%':'—'}</strong></div></div></article></div>
    <div class="planning-block"><div class="section-head"><div><span class="eyebrow">المحافظ</span><h3>فلوسك وين موجودة؟</h3></div><div class="row"><button class="btn ghost small mutating" data-act="transfer-form">↔ تحويل</button><button class="btn primary small mutating" data-act="wallet-form">＋ محفظة</button></div></div><div class="wallet-grid">${ws.length?ws.map(walletCard).join(''):empty('ما في محافظ','أضف كاش، بنك، CliQ أو محفظة توفير')}</div></div>
    <div class="planning-block"><div class="section-head"><div><span class="eyebrow">الأقساط</span><h3>خطط الأقساط</h3></div><button class="btn primary small mutating" data-act="installment-form">＋ قسط</button></div><div class="plan-grid">${inst.length?inst.map(installmentCard).join(''):empty('ما في أقساط','أضف خطة قسط وتابع المدفوع والمتبقي')}</div></div>
    <div class="planning-block"><article class="section-card glass"><div class="section-head"><div><span class="eyebrow">الاشتراكات</span><h3>اشتراكاتك الشهرية</h3></div><button class="btn primary small" data-nav="subscriptions">فتح الاشتراكات</button></div><p class="muted">أشخاص يحولولك كل شهر أو خدمات تنخصم منك، مع تجديد الموعد بضغطة واحدة.</p></article></div>
    <div class="planning-block"><div class="section-head"><div><span class="eyebrow">التلقائي</span><h3>الحركات المتكررة</h3></div><button class="btn primary small mutating" data-act="recurring-form">＋ حركة متكررة</button></div><div class="plan-grid">${recs.length?recs.map(recurringCard).join(''):empty('ما في حركات متكررة','راتب، إيجار، اشتراك… سجلها مرة وخليها تنزل تلقائيًا')}</div></div>
    <div class="planning-block"><article class="section-card glass"><div class="section-head"><div><span class="eyebrow">التصنيفات</span><h3>تصنيفاتك</h3></div><button class="btn secondary small mutating" data-act="category-form">＋ تصنيف</button></div><div class="row wrap">${cats.map(c=>`<span class="badge">${esc(c.icon)} ${esc(c.name)}</span>`).join('')}</div></article></div>`;
}
function categoryBudgetBars(b){const exp=entriesForMonth().filter(e=>e.type==='expense'),by={};exp.forEach(e=>{const c=e.meta?.category||'عام';by[c]=(by[c]||0)+e.amount});const limits=b?.data?.categoryLimits||{};const keys=[...new Set([...Object.keys(by),...Object.keys(limits)])].slice(0,6);if(!keys.length)return '<div class="muted small-text">أضف مصاريف مصنفة لتشوف التوزيع.</div>';return keys.map(k=>{const spend=by[k]||0,limit=Number(limits[k]||0),pct=limit?Math.min(100,spend/limit*100):Math.min(100,spend/Math.max(...Object.values(by),1)*100);return `<div class="category-row"><span>${esc(k)}</span><div class="bar"><span style="width:${pct}%"></span></div><b data-money>${money(spend)}</b></div>`}).join('')}
function walletCard(w){const x=w.data,b=walletBalance(w);return `<article class="wallet-card glass"><div class="row"><span class="badge">${x.type==='savings'?'🎯':x.type==='bank'?'🏦':x.type==='cliq'?'⚡':'💵'} ${esc(x.typeLabel||x.type||'محفظة')}</span><span class="spacer"></span><button class="tiny-btn mutating" data-act="wallet-edit" data-id="${w.id}">✎</button></div><h4>${esc(x.name)}</h4><div class="wallet-balance ${b<0?'neg':'pos'}" data-money>${money(b)}</div><div class="wallet-type">بداية الرصيد ${money(x.startingBalance||0)}</div></article>`}
function installmentCard(d){const x=d.data,total=Number(x.installments||0),paid=Number(x.paidInstallments||0),pct=total?paid/total*100:0;return `<article class="plan-card glass"><div class="row"><span class="badge warn">📆 قسط</span><span class="spacer"></span><button class="tiny-btn mutating" data-act="installment-edit" data-id="${d.id}">✎</button></div><h4>${esc(x.title)}</h4><div class="big" data-money>${money(Number(x.installmentAmount||0))}</div><div class="progress"><span style="width:${pct}%"></span></div><div class="tiny muted" style="margin-top:7px">${paid}/${total} أقساط · المتبقي ${money(Math.max(0,Number(x.total||0)-paid*Number(x.installmentAmount||0)))}</div><div class="plan-actions">${paid<total?`<button class="btn primary small mutating" data-act="installment-pay" data-id="${d.id}">✓ سجل قسط</button>`:''}<span class="badge">القادم ${x.nextDate?fmtDate(x.nextDate):'—'}</span></div></article>`}
function recurringCard(d){const x=d.data;return `<article class="plan-card glass"><div class="row"><span class="badge ${x.enabled===false?'danger':'success'}">${x.enabled===false?'متوقف':'نشط'}</span><span class="spacer"></span><button class="tiny-btn mutating" data-act="recurring-edit" data-id="${d.id}">✎</button></div><h4>${esc(x.title||x.person||typeInfo(x.type)[1])}</h4><div class="big" data-money>${money(x.amount)}</div><div class="tiny muted">${frequencyLabel(x.frequency)} · القادم ${x.nextDate?fmtDate(x.nextDate):'—'}</div></article>`}
function frequencyLabel(f){return ({daily:'يومي',weekly:'أسبوعي',monthly:'شهري',yearly:'سنوي'})[f]||'شهري'}

function subscriptionTotals(){
  let incoming=0,outgoing=0,active=0,overdue=0;
  subscriptions().forEach(d=>{const x=d.data;if(x.enabled===false)return;active++;if(x.direction==='incoming')incoming+=Number(x.amount||0);else outgoing+=Number(x.amount||0);if(x.nextDate&&daysBetween(today(),x.nextDate)<0)overdue++});
  return {incoming,outgoing,net:incoming-outgoing,active,overdue};
}
function subscriptionDashboardHtml(){
  const t=subscriptionTotals(),next=subscriptions().filter(d=>d.data.enabled!==false&&d.data.nextDate).sort((a,b)=>String(a.data.nextDate).localeCompare(String(b.data.nextDate))).slice(0,3);
  if(!subscriptions().length)return `<div class="empty-cta">${empty('ما عندك اشتراكات شهرية','أضف أشخاص يحولولك أو اشتراكات تنخصم منك كل شهر')}<button class="btn primary small mutating" data-act="subscription-form">＋ أول اشتراك</button></div>`;
  return `<div class="subscription-summary">
    <div><span>شهريًا إلك</span><b class="pos" data-money>${money(t.incoming)}</b></div>
    <div><span>شهريًا عليك</span><b class="neg" data-money>${money(t.outgoing)}</b></div>
    <div><span>الصافي الشهري</span><b class="${t.net<0?'neg':'gold'}" data-money>${money(t.net)}</b></div>
    <div><span>نشطة</span><b>${t.active}</b></div>
  </div>
  <div class="subscription-next">${next.map(d=>{const x=d.data,s=subscriptionStatus(x);return `<div class="due-item"><i class="due-dot"></i><div><b>${esc(x.title||'اشتراك')}</b><div class="tiny muted">${x.direction==='incoming'?'💚 راح يحولك':'🔴 راح ينخصم منك'} · ${fmtDate(x.nextDate)}</div></div><span class="badge ${s.cls}">${s.label}</span></div>`}).join('')}</div>`;
}
function renderSubscriptions(){
  const subs=subscriptions().sort((a,b)=>String(a.data.nextDate||'9999').localeCompare(String(b.data.nextDate||'9999'))),t=subscriptionTotals();
  const incoming=subs.filter(d=>d.data.direction==='incoming'),outgoing=subs.filter(d=>d.data.direction!=='incoming');
  $('#view-subscriptions').innerHTML=`
    <div class="subscription-hero glass">
      <div><span class="eyebrow">اشتراكات شهرية</span><h3>كل موعد بمكانه</h3><p class="muted">لما تضغط تم التحويل أو تم الخصم، نسجل الحركة وننقل الموعد للشهر الجاي تلقائيًا.</p></div>
      <button class="btn primary mutating" data-act="subscription-form">＋ اشتراك جديد</button>
    </div>
    <div class="stats-grid subscription-stats">
      ${statCard('↙','green','إجمالي شهري إلك',t.incoming,'اشتراكات راح تستلمها')}
      ${statCard('↗','red','إجمالي شهري عليك',t.outgoing,'اشتراكات راح تدفعها')}
      ${statCard('↔','gold','الصافي الشهري',t.net,'الفرق المتوقع شهريًا')}
      ${statCard('!','purple','متأخرة',t.overdue,'بحاجة لتأكيد')}
    </div>
    <div class="planning-block"><div class="section-head"><div><span class="eyebrow">إلك</span><h3>أشخاص يحولولك شهريًا</h3></div></div><div class="plan-grid">${incoming.length?incoming.map(subscriptionCard).join(''):empty('ما في اشتراكات إلك','مثال: شخص يحولك 20 د.أ كل يوم 5 بالشهر')}</div></div>
    <div class="planning-block"><div class="section-head"><div><span class="eyebrow">عليك</span><h3>اشتراكات تنخصم منك شهريًا</h3></div></div><div class="plan-grid">${outgoing.length?outgoing.map(subscriptionCard).join(''):empty('ما في اشتراكات عليك','مثال: نت، نادي، تطبيق، إيجار أو خدمة شهرية')}</div></div>`;
}
function subscriptionCard(d){
  const x=d.data,s=subscriptionStatus(x),hist=Array.isArray(x.history)?x.history:[],w=walletById(x.walletId);
  return `<article class="plan-card glass subscription-card ${x.enabled===false?'disabled':''}">
    <div class="row"><span class="badge ${x.direction==='incoming'?'success':'danger'}">${x.direction==='incoming'?'💚 إلك':'🔴 عليك'}</span><span class="badge ${s.cls}">${s.label}</span><span class="spacer"></span><button class="tiny-btn mutating" data-act="subscription-edit" data-id="${d.id}">✎</button></div>
    <h4>${esc(x.title||'اشتراك شهري')}</h4>
    <div class="big" data-money>${money(x.amount)}</div>
    <div class="subscription-date"><span>📅 الموعد القادم</span><b>${x.nextDate?fmtDate(x.nextDate):'—'}</b></div>
    <div class="tiny muted">${w?`💳 ${esc(w.data.name)} · `:''}${x.paymentMethod?`${esc(x.paymentMethod)} · `:''}${hist.length?`تم ${hist.length} مرة`:'لسه ما تم تأكيد دفعة'}</div>
    ${x.note?`<p class="tiny muted">${esc(x.note)}</p>`:''}
    <div class="plan-actions">${x.enabled===false?'<span class="badge danger">متوقف</span>':`<button class="btn primary small mutating" data-act="subscription-confirm" data-id="${d.id}">✓ ${x.direction==='incoming'?'تم التحويل':'تم الخصم'}</button>`}<span class="badge">يوم ${Number(x.anchorDay||String(x.nextDate||'').slice(-2)||1)} من الشهر</span></div>
  </article>`;
}

function analyticsMonths(){const arr=[];const d=new Date();for(let i=5;i>=0;i--){const x=new Date(d.getFullYear(),d.getMonth()-i,1),key=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`,label=new Intl.DateTimeFormat('ar-JO',{month:'short'}).format(x);arr.push({key,label,...monthTotals(key)})}return arr}
function achievements(){
  const saved=goals().reduce((a,g)=>a+Number(g.data.saved||0),0),openDebts=allEntries().filter(e=>['receivable','payable'].includes(e.type)&&e.remaining>0),halfGoal=goals().some(g=>Number(g.data.target)>0&&Number(g.data.saved)/Number(g.data.target)>=.5),fullGoal=goals().some(g=>Number(g.data.target)>0&&Number(g.data.saved)>=Number(g.data.target)),streak=savingStreak();
  return [
    {icon:'🌱',title:'أول 100 د.أ',note:'وصلت لأول مئة دينار تحويش',done:saved>=100},
    {icon:'🎯',title:'نص الطريق',note:'وصلت 50% من أحد أهدافك',done:halfGoal},
    {icon:'🏆',title:'الهدف تحقق',note:'أكملت هدف تحويش كامل',done:fullGoal},
    {icon:'✨',title:'بدون ديون',note:'ما عندك ديون مفتوحة',done:state.entries.length>0&&openDebts.length===0},
    {icon:'🔥',title:'استمرارية',note:`${streak} أسابيع تحويش متتالية`,done:streak>=3},
    {icon:'📊',title:'متابعة ممتازة',note:'سجلت 30 حركة أو أكثر',done:state.entries.length>=30}
  ];
}
function savingStreak(){const dates=[];goals().forEach(g=>(g.data.contributions||[]).forEach(c=>dates.push(c.date)));if(!dates.length)return 0;const weeks=[...new Set(dates.map(d=>{const x=new Date(`${d}T12:00:00`),y=new Date(x.getFullYear(),0,1),w=Math.floor((x-y)/604800000);return `${x.getFullYear()}-${w}`}))].sort().reverse();let s=0;let cur=new Date();for(let i=0;i<weeks.length;i++){const y=cur.getFullYear(),y0=new Date(y,0,1),w=Math.floor((cur-y0)/604800000),k=`${y}-${w-i}`;if(weeks.includes(k))s++;else break}return s}
function categorySpend(month=monthKey()){const out={};entriesForMonth(month).filter(e=>e.type==='expense').forEach(e=>{const c=e.meta?.category||'عام';out[c]=(out[c]||0)+e.amount});return out}
function forecast(){const m=monthTotals(),d=new Date(),day=d.getDate(),days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),projected=day?m.expense/day*days:m.expense;return {projected,end:m.income-projected}}
function insights(){const arr=[],cur=categorySpend(),d=new Date(),pd=new Date(d.getFullYear(),d.getMonth()-1,1),prevKey=`${pd.getFullYear()}-${String(pd.getMonth()+1).padStart(2,'0')}`,prev=categorySpend(prevKey);Object.entries(cur).forEach(([c,v])=>{const pv=Number(prev[c]||0);if(pv>0&&v>pv*1.5)arr.push(`صرفك على ${c} أعلى من الشهر الماضي بحوالي ${Math.round((v/pv-1)*100)}%.`)});const f=forecast();if(f.projected>monthTotals().income&&monthTotals().income>0)arr.push('على نفس وتيرة الصرف، ممكن تنهي الشهر بصرف أعلى من دخلك.');const due=upcomingItems().filter(x=>x.days>=0&&x.days<=7);if(due.length)arr.push(`عندك ${due.length} استحقاق قريب خلال 7 أيام.`);if(!arr.length)arr.push('ما في إشارات غير طبيعية واضحة حاليًا. استمر بنفس التنظيم.');return arr}
function renderAnalytics(){const months=analyticsMonths(),max=Math.max(...months.flatMap(m=>[m.income,m.expense]),1),cats=Object.entries(categorySpend()).sort((a,b)=>b[1]-a[1]).slice(0,7),f=forecast(),ach=achievements(),timeline=allEntries().slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,10);$('#view-analytics').innerHTML=`<div class="analytics-grid"><article class="chart-card glass"><div class="section-head"><div><span class="eyebrow">آخر 6 أشهر</span><h3>الدخل مقابل المصروف</h3></div><span class="badge">أخضر دخل · أحمر صرف</span></div><div class="bars-chart">${months.map(m=>`<div class="bar-group"><span class="bar-income" style="height:${m.income/max*100}%" title="${money(m.income)}"></span><span class="bar-expense" style="height:${m.expense/max*100}%" title="${money(m.expense)}"></span></div>`).join('')}</div><div class="bar-labels">${months.map(m=>`<span>${m.label}</span>`).join('')}</div></article><article class="chart-card glass"><span class="eyebrow">التوقع</span><h3>نهاية الشهر</h3><div class="goal-value" data-money>${money(f.end)}</div><p class="muted small-text">المصروف المتوقع ${money(f.projected)} إذا استمريت بنفس الوتيرة.</p><div class="insight-list">${insights().map(i=>`<div class="insight">💡 ${esc(i)}</div>`).join('')}</div></article></div><div class="grid-2" style="margin-top:15px"><article class="chart-card glass"><div class="section-head"><div><span class="eyebrow">المصاريف</span><h3>أعلى التصنيفات</h3></div></div><div class="category-bars">${cats.length?cats.map(([c,v])=>`<div class="category-row"><span>${esc(c)}</span><div class="bar"><span style="width:${v/Math.max(...cats.map(x=>x[1]),1)*100}%"></span></div><b>${money(v)}</b></div>`).join(''):empty('ما في مصاريف','لما تضيف مصاريف بتظهر هون')}</div></article><article class="chart-card glass"><div class="section-head"><div><span class="eyebrow">إنجازاتك</span><h3>الإنجازات</h3></div></div><div class="achievement-grid">${ach.map(a=>`<div class="achievement ${a.done?'done':''}"><b>${a.icon} ${esc(a.title)}</b><small>${esc(a.note)}</small></div>`).join('')}</div></article></div><article class="chart-card glass" style="margin-top:15px"><div class="section-head"><div><span class="eyebrow">Timeline</span><h3>الخط الزمني المالي</h3></div></div><div class="timeline">${timeline.map(e=>`<div class="timeline-item"><i class="timeline-dot"></i><div class="timeline-body"><b>${typeInfo(e.type)[0]} ${esc(e.person||typeInfo(e.type)[1])}</b><div class="tiny muted">${fmtDate(e.date)} · ${money(['receivable','payable'].includes(e.type)?e.remaining:e.amount)}</div></div></div>`).join('')}</div></article>`}

function renderCalendar(){const cur=state.calendarCursor,y=cur.getFullYear(),m=cur.getMonth(),first=new Date(y,m,1),start=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate(),prevDays=new Date(y,m,0).getDate(),cells=[];for(let i=0;i<42;i++){let day,date,outside=false;if(i<start){day=prevDays-start+i+1;date=new Date(y,m-1,day);outside=true}else if(i>=start+days){day=i-start-days+1;date=new Date(y,m+1,day);outside=true}else{day=i-start+1;date=new Date(y,m,day)}const ds=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,es=allEntries().filter(e=>e.date===ds),ss=subscriptions().filter(s=>s.data.enabled!==false&&s.data.nextDate===ds),income=es.filter(e=>e.type==='income').reduce((a,e)=>a+e.amount,0),expense=es.filter(e=>e.type==='expense').reduce((a,e)=>a+e.amount,0);cells.push(`<button class="day ${outside?'outside':''} ${ds===today()?'today':''}" data-act="calendar-day" data-date="${ds}"><span class="day-num">${day}</span>${es.length||ss.length?`<div class="tiny muted">${es.length?`${es.length} حركة`:''}${es.length&&ss.length?' · ':''}${ss.length?`${ss.length} اشتراك`:''}</div><div class="day-total"><span class="pos">${income?money(income):''}</span><span class="neg">${expense?money(expense):''}</span></div>`:''}</button>`)}const title=new Intl.DateTimeFormat('ar-JO',{month:'long',year:'numeric'}).format(cur);$('#view-calendar').innerHTML=`<article class="calendar-shell glass"><div class="calendar-head"><button class="icon-btn" data-act="calendar-next">→</button><h3>${title}</h3><button class="icon-btn" data-act="calendar-prev">←</button></div><div class="calendar-grid">${['الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'].map(x=>`<div class="weekday">${x}</div>`).join('')}${cells.join('')}</div></article>`}

function renderSettings(){const hidden=new Set(state.prefs.hiddenCards||[]);$('#view-settings').innerHTML=`<div class="settings-grid"><article class="setting-card glass"><span class="eyebrow">المظهر والخصوصية</span><h4>شكل التطبيق</h4><p>غيّر الوضع، أخفِ الأرقام، أو افتح وضع العرض فقط.</p><div class="switch-row"><span>الوضع الفاتح</span><button class="switch ${state.prefs.theme==='light'?'on':''}" data-act="toggle-theme"></button></div><div class="switch-row"><span>إخفاء المبالغ</span><button class="switch ${state.prefs.hideAmounts?'on':''}" data-act="toggle-privacy"></button></div><div class="switch-row"><span>عرض فقط</span><button class="switch ${state.prefs.viewOnly?'on':''}" data-act="toggle-viewonly"></button></div></article><article class="setting-card glass"><span class="eyebrow">الأمان</span><h4>القفل والحماية</h4><p>قفل تلقائي، تغيير رمز الدخول ورمز إدارة اختياري للحذف النهائي.</p><div class="row wrap"><button class="btn secondary small" data-act="autolock-form">⏱ القفل ${state.prefs.autoLockMinutes||0} د</button><button class="btn ghost small" data-act="change-pin">🔐 تغيير PIN</button><button class="btn ${state.admin.enabled?'secondary':'ghost'} small" data-act="admin-pin">🛡 ${state.admin.enabled?(state.admin.unlocked?'الإدارة مفتوحة':'فتح الإدارة'):'تفعيل رمز الإدارة'}</button></div></article><article class="setting-card glass"><span class="eyebrow">التنبيهات والتطبيق</span><h4>تجربة أسرع</h4><p>ثبّت التطبيق وفعّل تنبيهات الاستحقاقات القريبة.</p><div class="row wrap"><button class="btn secondary small" data-act="install-app">⇩ تثبيت التطبيق</button><button class="btn ghost small" data-act="notifications">🔔 ${state.prefs.notifications?'مفعلة':'تفعيل التنبيهات'}</button></div></article><article class="setting-card glass"><span class="eyebrow">النسخ الاحتياطي</span><h4>بياناتك معك</h4><p>تنزيل واسترجاع كل الحركات والأهداف والمحافظ والخطط.</p><div class="row wrap"><button class="btn secondary small" data-act="export-backup">⬇ نسخة</button><button class="btn ghost small mutating" data-act="import-backup">⬆ استرجاع</button><button class="btn ghost small" data-act="emergency-backup">🆘 طوارئ</button></div></article><article class="setting-card glass"><span class="eyebrow">لوحة التحكم</span><h4>خصص الرئيسية</h4><p>اخفِ الأقسام اللي ما بدك تشوفها.</p>${[['decision','قراري اليوم'],['stats','البطاقات المالية'],['goals','الأهداف'],['dues','الاستحقاقات'],['summary','ملخص الشهر'],['achievements','الإنجازات']].map(([k,l])=>`<div class="switch-row"><span>${l}</span><button class="switch ${!hidden.has(k)?'on':''}" data-act="toggle-card" data-card="${k}"></button></div>`).join('')}</article><article class="setting-card glass"><span class="eyebrow">السجل والصيانة</span><h4>تحكم كامل</h4><p>سلة المحذوفات 30 يوم وسجل تغييرات لكل العمليات.</p><div class="row wrap"><button class="btn secondary small" data-act="trash">🗑 السلة</button><button class="btn ghost small" data-act="audit">🕘 سجل التغييرات</button></div></article></div><article class="section-card glass" style="margin-top:15px"><div class="row"><div><span class="eyebrow">تحويشتي</span><h3>الإصدار ${APP_VERSION}</h3><p class="muted small-text">حساب مشترك برمز 4 أرقام · Supabase · PWA · الدينار الأردني</p></div><span class="spacer"></span><div class="small-text muted">© Yahya Saeed</div></div></article>`}

/* Forms */
function entryFormHtml(e={}){const m=e.meta||{},debt=['receivable','payable'].includes(e.type||'receivable');return `<form id="entryForm" class="form-grid"><label class="field"><span>نوع الحركة</span><select name="type"><option value="receivable" ${(e.type||'receivable')==='receivable'?'selected':''}>💚 إلي</option><option value="payable" ${e.type==='payable'?'selected':''}>🔴 عليّ</option><option value="income" ${e.type==='income'?'selected':''}>📈 إيراد</option><option value="expense" ${e.type==='expense'?'selected':''}>📉 مصروف</option></select></label><label class="field"><span>المبلغ بالدينار</span><input name="amount" type="number" min="0.001" step="0.001" inputmode="decimal" value="${e.amount??''}" required></label><label class="field"><span>الشخص / الجهة</span><input name="person" value="${esc(e.person||'')}" maxlength="120" placeholder="مثال: أحمد / راتب / سوبرماركت"></label><label class="field"><span>التاريخ</span><input name="date" type="date" value="${e.date||today()}" required></label><label class="field"><span>التصنيف</span><select name="category">${categoryOptions(m.category||'عام')}</select></label><label class="field"><span>المحفظة</span><select name="walletId">${docOption(wallets(),m.walletId,'بدون محفظة')}</select></label><label class="field"><span>طريقة الدفع</span><select name="paymentMethod"><option value="">غير محدد</option>${paymentOptions(m.paymentMethod)}</select></label><label class="field"><span>تاريخ الاستحقاق</span><input name="dueDate" type="date" value="${m.dueDate||''}"><small>مفيد للديون والتنبيهات</small></label><label class="field full"><span>الوسوم</span><input name="tags" value="${esc((m.tags||[]).join(', '))}" placeholder="شخصي، سيارة، مهم"></label><label class="field full"><span>ملاحظة</span><textarea name="note" rows="3" maxlength="800">${esc(e.note||'')}</textarea></label><div class="upload-zone full"><input id="receiptFile" type="file" accept="image/jpeg,image/png,image/webp"><label for="receiptFile"><b>📸 ${e.receiptPath?'استبدال الإيصال':'إضافة إيصال / حوالة'}</b><small id="receiptName">JPG / PNG / WEBP — حتى 5MB</small></label><div class="upload-tools"><button type="button" class="btn ghost small" data-act="ocr-receipt">🔍 قراءة المبلغ من الصورة</button></div></div><div class="modal-actions full">${e.id?`<button type="button" class="btn danger-soft mutating" data-act="delete-entry" data-id="${e.id}">حذف</button>`:''}<span class="spacer"></span><button type="button" class="btn ghost" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ</button></div></form>`}
function openEntryForm(id='',preset={}){if(!guardMutation())return;const e=id?state.entries.find(x=>x.id===id):{type:preset.type||'receivable',amount:preset.amount||'',person:preset.person||'',date:preset.date||today(),note:preset.note||'',meta:preset.meta||{}};state.editingEntryId=id||null;state.pendingReceipt=null;openModal(id?'تعديل الحركة':'حركة جديدة','حركة مالية',entryFormHtml(e),{context:{kind:'entry',id}});setTimeout(()=>{const f=$('#receiptFile');if(f)f.onchange=ev=>{state.pendingReceipt=ev.target.files[0]||null;$('#receiptName').textContent=state.pendingReceipt?`${state.pendingReceipt.name} — ${(state.pendingReceipt.size/1024/1024).toFixed(2)}MB`:'بدون ملف'}},0)}
function paymentFormHtml(e,full=false){return `<form id="paymentForm" class="form-grid"><label class="field"><span>المبلغ</span><input name="amount" type="number" min="0.001" max="${e.remaining}" step="0.001" value="${full?e.remaining:''}" required></label><label class="field"><span>التاريخ</span><input name="date" type="date" value="${today()}" required></label><label class="field"><span>المحفظة</span><select name="walletId">${docOption(wallets(),'','بدون محفظة')}</select></label><label class="field"><span>طريقة الدفع</span><select name="paymentMethod"><option value="">غير محدد</option>${paymentOptions('')}</select></label><label class="field full"><span>ملاحظة</span><textarea name="note" rows="3">${full?'تم التسديد بالكامل':''}</textarea></label><div class="detail-box full"><span>المتبقي حاليًا</span><b>${money(e.remaining)}</b></div><div class="modal-actions full"><span class="spacer"></span><button type="button" class="btn ghost" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">تسجيل الدفعة</button></div></form>`}
function openPaymentForm(id,full=false){if(!guardMutation())return;const e=allEntries().find(x=>x.id===id);if(!e)return;state.paymentEntryId=id;openModal(full?'تسديد كامل':'تسجيل دفعة',e.person||typeInfo(e.type)[1],paymentFormHtml(e,full),{size:'small',context:{kind:'payment',full}})}

function goalFormHtml(d){const x=d?.data||{},stages=(x.stages||[]).map(s=>`${s.title}:${s.amount}`).join('\n');return `<form id="goalForm" class="form-grid"><label class="field"><span>اسم الهدف</span><input name="title" value="${esc(x.title||'')}" required placeholder="مثال: سيارة"></label><label class="field"><span>أيقونة</span><input name="icon" value="${esc(x.icon||'🎯')}" maxlength="4"></label><label class="field"><span>المبلغ المستهدف</span><input name="target" type="number" min="1" step="0.001" value="${x.target||''}" required></label><label class="field"><span>موعد الهدف</span><input name="dueDate" type="date" value="${x.dueDate||''}"></label><label class="field full"><span>مراحل الهدف</span><textarea name="stages" rows="4" placeholder="عربون:1000\nتسجيل:250\nتأمين:300">${esc(stages)}</textarea><small>كل سطر: اسم المرحلة:المبلغ</small></label><div class="modal-actions full">${d?`<button type="button" class="btn danger-soft mutating" data-act="delete-doc" data-id="${d.id}">حذف</button>`:''}<span class="spacer"></span><button type="button" class="btn ghost" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ الهدف</button></div></form>`}
function openGoalForm(id=''){if(!guardMutation())return;const d=id?goals().find(x=>x.id===id):null;openModal(d?'تعديل الهدف':'هدف جديد','أهداف التحويش',goalFormHtml(d),{context:{kind:'goal',id}})}
function openGoalContribution(id){if(!guardMutation())return;const d=goals().find(x=>x.id===id);if(!d)return;openModal('إضافة تحويش',d.data.title,`<form id="goalContributionForm" class="form-grid"><label class="field"><span>المبلغ</span><input name="amount" type="number" min="0.001" step="0.001" required></label><label class="field"><span>التاريخ</span><input name="date" type="date" value="${today()}" required></label><label class="field full"><span>ملاحظة</span><input name="note" placeholder="اختياري"></label><div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">إضافة</button></div></form>`,{size:'small',context:{kind:'goal-contribution',id}})}

function walletFormHtml(d){const x=d?.data||{};return `<form id="walletForm" class="form-grid"><label class="field"><span>اسم المحفظة</span><input name="name" value="${esc(x.name||'')}" required placeholder="كاش / البنك"></label><label class="field"><span>النوع</span><select name="type"><option value="cash" ${x.type==='cash'?'selected':''}>💵 كاش</option><option value="bank" ${x.type==='bank'?'selected':''}>🏦 بنك</option><option value="cliq" ${x.type==='cliq'?'selected':''}>⚡ CliQ</option><option value="wallet" ${x.type==='wallet'?'selected':''}>📱 محفظة</option><option value="savings" ${x.type==='savings'?'selected':''}>🎯 توفير</option></select></label><label class="field full"><span>رصيد البداية</span><input name="startingBalance" type="number" step="0.001" value="${x.startingBalance||0}"></label><div class="modal-actions full">${d?`<button class="btn danger-soft mutating" type="button" data-act="delete-doc" data-id="${d.id}">حذف</button>`:''}<span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ</button></div></form>`}
function openWalletForm(id=''){if(!guardMutation())return;const d=id?wallets().find(x=>x.id===id):null;openModal(d?'تعديل المحفظة':'محفظة جديدة','المحافظ',walletFormHtml(d),{size:'small',context:{kind:'wallet',id}})}
function openTransferForm(){if(!guardMutation())return;if(wallets().length<2)return toast('أضف محفظتين على الأقل للتحويل');openModal('تحويل بين المحافظ','تحويل داخلي',`<form id="transferForm" class="form-grid"><label class="field"><span>من</span><select name="fromWalletId" required>${docOption(wallets(),'','اختر')}</select></label><label class="field"><span>إلى</span><select name="toWalletId" required>${docOption(wallets(),'','اختر')}</select></label><label class="field"><span>المبلغ</span><input name="amount" type="number" min="0.001" step="0.001" required></label><label class="field"><span>التاريخ</span><input name="date" type="date" value="${today()}" required></label><label class="field full"><span>ملاحظة</span><input name="note"></label><div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">تحويل</button></div></form>`,{size:'small',context:{kind:'transfer'}})}

function budgetFormHtml(d){const x=d?.data||{},limits=x.categoryLimits||{};return `<form id="budgetForm" class="form-grid"><label class="field"><span>الشهر</span><input name="month" type="month" value="${x.month||monthKey()}" required></label><label class="field"><span>الحد الشهري</span><input name="limit" type="number" min="0" step="0.001" value="${x.limit||''}" required></label><label class="field full"><span>حدود حسب التصنيف</span><textarea name="categoryLimits" rows="6" placeholder="أكل:120\nبنزين:80">${esc(Object.entries(limits).map(([k,v])=>`${k}:${v}`).join('\n'))}</textarea><small>اختياري — كل سطر: التصنيف:المبلغ</small></label><div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ الميزانية</button></div></form>`}
function openBudgetForm(){if(!guardMutation())return;const d=currentBudget();openModal('الميزانية الشهرية','خطة صرف',budgetFormHtml(d),{size:'small',context:{kind:'budget',id:d?.id}})}

function installmentFormHtml(d){const x=d?.data||{};return `<form id="installmentForm" class="form-grid"><label class="field"><span>اسم القسط</span><input name="title" value="${esc(x.title||'')}" required></label><label class="field"><span>المبلغ الكلي</span><input name="total" type="number" min="0.001" step="0.001" value="${x.total||''}" required></label><label class="field"><span>عدد الأقساط</span><input name="installments" type="number" min="1" step="1" value="${x.installments||''}" required></label><label class="field"><span>الأقساط المدفوعة</span><input name="paidInstallments" type="number" min="0" step="1" value="${x.paidInstallments||0}"></label><label class="field"><span>القسط القادم</span><input name="nextDate" type="date" value="${x.nextDate||today()}"></label><label class="field"><span>المحفظة</span><select name="walletId">${docOption(wallets(),x.walletId,'بدون')}</select></label><label class="field"><span>التصنيف</span><select name="category">${categoryOptions(x.category||'أقساط')}</select></label><label class="field"><span>الشخص / الجهة</span><input name="person" value="${esc(x.person||'')}"></label><label class="field full"><span>ملاحظة</span><textarea name="note" rows="2">${esc(x.note||'')}</textarea></label><div class="modal-actions full">${d?`<button class="btn danger-soft mutating" type="button" data-act="delete-doc" data-id="${d.id}">حذف</button>`:''}<span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ</button></div></form>`}
function openInstallmentForm(id=''){if(!guardMutation())return;const d=id?docs('installment').find(x=>x.id===id):null;openModal(d?'تعديل القسط':'خطة قسط جديدة','الأقساط',installmentFormHtml(d),{context:{kind:'installment',id}})}


function subscriptionFormHtml(d){
  const x=d?.data||{},date=x.nextDate||today();
  return `<form id="subscriptionForm" class="form-grid">
    <label class="field"><span>نوع الاشتراك</span><select name="direction"><option value="incoming" ${x.direction==='incoming'?'selected':''}>💚 شخص يحولي شهريًا</option><option value="outgoing" ${x.direction!=='incoming'?'selected':''}>🔴 ينخصم / أدفع شهريًا</option></select></label>
    <label class="field"><span>الاسم / الخدمة</span><input name="title" value="${esc(x.title||'')}" placeholder="أحمد / الإنترنت / النادي" required></label>
    <label class="field"><span>المبلغ الشهري</span><input name="amount" type="number" min="0.001" step="0.001" value="${x.amount||''}" required></label>
    <label class="field"><span>الموعد القادم</span><input name="nextDate" type="date" value="${date}" required><small>نفس اليوم رح يتكرر كل شهر</small></label>
    <label class="field"><span>المحفظة</span><select name="walletId">${docOption(wallets(),x.walletId,'بدون محفظة')}</select></label>
    <label class="field"><span>طريقة الدفع</span><select name="paymentMethod"><option value="">غير محدد</option>${paymentOptions(x.paymentMethod||'')}</select></label>
    <label class="field full"><span>ملاحظة</span><textarea name="note" rows="2" placeholder="مثال: يحول عادةً عن طريق CliQ">${esc(x.note||'')}</textarea></label>
    <label class="field full"><span>الحالة</span><select name="enabled"><option value="true" ${x.enabled!==false?'selected':''}>نشط</option><option value="false" ${x.enabled===false?'selected':''}>متوقف مؤقتًا</option></select></label>
    <div class="modal-actions full">${d?`<button class="btn danger-soft mutating" type="button" data-act="delete-doc" data-id="${d.id}">حذف</button>`:''}<span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ الاشتراك</button></div>
  </form>`;
}
function openSubscriptionForm(id=''){
  if(!guardMutation())return;
  const d=id?subscriptions().find(x=>x.id===id):null;
  openModal(d?'تعديل الاشتراك':'اشتراك شهري جديد','المواعيد الشهرية',subscriptionFormHtml(d),{context:{kind:'subscription',id}});
}

function recurringFormHtml(d){const x=d?.data||{};return `<form id="recurringForm" class="form-grid"><label class="field"><span>العنوان</span><input name="title" value="${esc(x.title||'')}" placeholder="راتب / إيجار"></label><label class="field"><span>النوع</span><select name="type"><option value="income" ${x.type==='income'?'selected':''}>📈 إيراد</option><option value="expense" ${x.type==='expense'?'selected':''}>📉 مصروف</option><option value="receivable" ${x.type==='receivable'?'selected':''}>💚 إلي</option><option value="payable" ${x.type==='payable'?'selected':''}>🔴 عليّ</option></select></label><label class="field"><span>المبلغ</span><input name="amount" type="number" min="0.001" step="0.001" value="${x.amount||''}" required></label><label class="field"><span>الشخص / الجهة</span><input name="person" value="${esc(x.person||'')}"></label><label class="field"><span>التكرار</span><select name="frequency"><option value="daily" ${x.frequency==='daily'?'selected':''}>يومي</option><option value="weekly" ${x.frequency==='weekly'?'selected':''}>أسبوعي</option><option value="monthly" ${!x.frequency||x.frequency==='monthly'?'selected':''}>شهري</option><option value="yearly" ${x.frequency==='yearly'?'selected':''}>سنوي</option></select></label><label class="field"><span>كل</span><input name="interval" type="number" min="1" max="24" value="${x.interval||1}"></label><label class="field"><span>الموعد القادم</span><input name="nextDate" type="date" value="${x.nextDate||today()}" required></label><label class="field"><span>التصنيف</span><select name="category">${categoryOptions(x.category||'عام')}</select></label><label class="field"><span>المحفظة</span><select name="walletId">${docOption(wallets(),x.walletId,'بدون')}</select></label><label class="field"><span>طريقة الدفع</span><select name="paymentMethod"><option value="">غير محدد</option>${paymentOptions(x.paymentMethod)}</select></label><label class="field full"><span>ملاحظة</span><textarea name="note" rows="2">${esc(x.note||'')}</textarea></label><label class="field full"><span>الحالة</span><select name="enabled"><option value="true" ${x.enabled!==false?'selected':''}>نشط</option><option value="false" ${x.enabled===false?'selected':''}>متوقف</option></select></label><div class="modal-actions full">${d?`<button class="btn danger-soft mutating" type="button" data-act="delete-doc" data-id="${d.id}">حذف</button>`:''}<span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ</button></div></form>`}
function openRecurringForm(id=''){if(!guardMutation())return;const d=id?docs('recurring').find(x=>x.id===id):null;openModal(d?'تعديل الحركة المتكررة':'حركة متكررة','التكرار التلقائي',recurringFormHtml(d),{context:{kind:'recurring',id}})}

function openCategoryForm(){if(!guardMutation())return;openModal('تصنيف جديد','تنظيم المصاريف',`<form id="categoryForm" class="form-grid"><label class="field"><span>الاسم</span><input name="name" required></label><label class="field"><span>الإيموجي</span><input name="icon" value="🏷️" maxlength="4"></label><div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">إضافة</button></div></form>`,{size:'small',context:{kind:'category'}})}

function openPersonDetail(name){const p=peopleSummary().find(x=>x.name===name);if(!p)return;const prof=p.profile?.data||{},es=allEntries().filter(e=>e.person===name).sort((a,b)=>String(b.date).localeCompare(String(a.date)));openModal(name,'كشف حساب شخص',`<div class="detail-grid"><div class="detail-box"><span>إلي عليه</span><b class="pos">${money(p.receivable)}</b></div><div class="detail-box"><span>عليّ إله</span><b class="neg">${money(p.payable)}</b></div><div class="detail-box"><span>الصافي</span><b>${money(Math.abs(p.net))}</b></div></div>${prof.note?`<div class="insight" style="margin-top:12px">📝 ${esc(prof.note)}</div>`:''}<div class="row wrap" style="margin:15px 0"><button class="btn secondary small" data-act="share-person" data-name="${esc(name)}">↗ واتساب</button><button class="btn ghost small" data-act="print-person" data-name="${esc(name)}">🧾 PDF / طباعة</button><button class="btn ghost small mutating" data-act="person-profile" data-name="${esc(name)}">✎ ملاحظات</button><button class="btn primary small mutating" data-act="settle-person" data-name="${esc(name)}">⚖ تسوية صافي</button></div><div class="entries-list">${es.length?es.map((e,i)=>entryCard(e,i)).join(''):empty('لا توجد حركات','')}</div>`,{size:'wide',context:{kind:'person',name}})}
function openPersonProfile(name){if(!guardMutation())return;const p=personProfile(name),x=p?.data||{};openModal('معلومات الشخص',name,`<form id="personProfileForm" class="form-grid"><label class="field"><span>الاسم</span><input name="name" value="${esc(name)}" required></label><label class="field"><span>الهاتف</span><input name="phone" value="${esc(x.phone||'')}"></label><label class="field full"><span>ملاحظات</span><textarea name="note" rows="4">${esc(x.note||'')}</textarea></label><label class="field full"><span>تثبيت بالأعلى</span><select name="pinned"><option value="false">لا</option><option value="true" ${x.pinned?'selected':''}>نعم</option></select></label><div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary mutating" type="submit">حفظ</button></div></form>`,{size:'small',context:{kind:'person-profile',id:p?.id,name}})}

/* Submit handlers */
async function uploadReceipt(file,entryId){if(!file)return '';if(file.size>5*1024*1024)throw new Error('حجم الصورة أكبر من 5MB');const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]||'');r.onerror=rej;r.readAsDataURL(file)});const d=await api('receipt_upload',{entryId,mime:file.type,base64});return d.path}
async function submitEntry(form){if(!guardMutation())return;const fd=new FormData(form),existing=state.editingEntryId?state.entries.find(x=>x.id===state.editingEntryId):null,id=existing?.id||uid();let receiptPath=existing?.receiptPath||'';loading(true,'جاري حفظ الحركة...');try{if(state.pendingReceipt)receiptPath=await uploadReceipt(state.pendingReceipt,id);const type=fd.get('type'),amount=Number(fd.get('amount')),person=String(fd.get('person')||'').trim();if(['receivable','payable'].includes(type)&&!person)throw new Error('اكتب اسم الشخص');const meta={category:fd.get('category')||'عام',walletId:fd.get('walletId')||'',paymentMethod:fd.get('paymentMethod')||'',dueDate:fd.get('dueDate')||'',tags:String(fd.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean),reference:existing?.meta?.reference||refCode()};await api('entry_upsert',{entry:{id,type,amount,person,date:fd.get('date'),note:fd.get('note')||'',receiptPath,meta}});closeModal();await fetchData();renderCurrent();toast(existing?'تم تعديل الحركة ✅':'تم حفظ الحركة ✅')}catch(e){toast(e.message||'تعذر الحفظ')}finally{loading(false)}}
async function submitPayment(form){if(!guardMutation())return;const fd=new FormData(form),e=allEntries().find(x=>x.id===state.paymentEntryId),amount=Number(fd.get('amount'));if(!e||amount<=0||amount>e.remaining+.0001)return toast('قيمة الدفعة غير صحيحة');loading(true);try{await api('payment_add',{payment:{entryId:e.id,amount,date:fd.get('date'),note:fd.get('note')||'',meta:{walletId:fd.get('walletId')||'',paymentMethod:fd.get('paymentMethod')||'',reference:refCode()}}});closeModal();await fetchData();renderCurrent();toast('تم تسجيل الدفعة 💳')}catch(e){toast(e.message||'تعذر حفظ الدفعة')}finally{loading(false)}}
function parseStages(s){return String(s||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const [title,...rest]=l.split(':');return {title:title.trim(),amount:Number(rest.join(':').trim()||0)}}).filter(x=>x.title&&x.amount>0)}
function parseLimits(s){const o={};String(s||'').split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{const [k,...r]=l.split(':');const v=Number(r.join(':').trim());if(k&&v>=0)o[k.trim()]=v});return o}
async function upsertDoc(kind,data,id=''){const r=await api('doc_upsert',{document:{id:id||undefined,kind,data}});return r.id}
async function submitDocForm(form){if(!guardMutation())return;const fd=new FormData(form),ctx=state.modalContext||{};loading(true);try{
  if(form.id==='goalForm'){const old=ctx.id?goals().find(x=>x.id===ctx.id)?.data||{}:{};await upsertDoc('goal',{...old,title:fd.get('title'),icon:fd.get('icon')||'🎯',target:Number(fd.get('target')),dueDate:fd.get('dueDate')||'',stages:parseStages(fd.get('stages')),saved:Number(old.saved||0),contributions:old.contributions||[]},ctx.id)}
  else if(form.id==='goalContributionForm'){const d=goals().find(x=>x.id===ctx.id),amt=Number(fd.get('amount'));if(!d||amt<=0)throw new Error('المبلغ غير صحيح');const contributions=[...(d.data.contributions||[]),{id:uid(),amount:amt,date:fd.get('date'),note:fd.get('note')||''}];await upsertDoc('goal',{...d.data,saved:Number(d.data.saved||0)+amt,contributions},d.id)}
  else if(form.id==='walletForm'){await upsertDoc('wallet',{name:fd.get('name'),type:fd.get('type'),startingBalance:Number(fd.get('startingBalance')||0)},ctx.id)}
  else if(form.id==='transferForm'){if(fd.get('fromWalletId')===fd.get('toWalletId'))throw new Error('اختر محفظتين مختلفتين');await upsertDoc('transfer',{fromWalletId:fd.get('fromWalletId'),toWalletId:fd.get('toWalletId'),amount:Number(fd.get('amount')),date:fd.get('date'),note:fd.get('note')||''})}
  else if(form.id==='budgetForm'){const existing=docs('budget').find(d=>d.data.month===fd.get('month'));await upsertDoc('budget',{month:fd.get('month'),limit:Number(fd.get('limit')||0),categoryLimits:parseLimits(fd.get('categoryLimits'))},existing?.id||ctx.id)}
  else if(form.id==='installmentForm'){const total=Number(fd.get('total')),count=Number(fd.get('installments'));await upsertDoc('installment',{title:fd.get('title'),total,installments:count,paidInstallments:Number(fd.get('paidInstallments')||0),installmentAmount:count?total/count:0,nextDate:fd.get('nextDate')||'',walletId:fd.get('walletId')||'',category:fd.get('category')||'أقساط',person:fd.get('person')||'',note:fd.get('note')||''},ctx.id)}
  else if(form.id==='subscriptionForm'){const old=ctx.id?subscriptions().find(x=>x.id===ctx.id)?.data||{}:{};const nextDate=fd.get('nextDate');await upsertDoc('subscription',{...old,title:fd.get('title'),direction:fd.get('direction'),amount:Number(fd.get('amount')),nextDate,anchorDay:Number(String(nextDate).slice(-2)||1),walletId:fd.get('walletId')||'',paymentMethod:fd.get('paymentMethod')||'',note:fd.get('note')||'',enabled:fd.get('enabled')==='true',history:old.history||[]},ctx.id)}
  else if(form.id==='recurringForm'){await upsertDoc('recurring',{title:fd.get('title')||'',type:fd.get('type'),amount:Number(fd.get('amount')),person:fd.get('person')||'',frequency:fd.get('frequency'),interval:Number(fd.get('interval')||1),nextDate:fd.get('nextDate'),category:fd.get('category')||'عام',walletId:fd.get('walletId')||'',paymentMethod:fd.get('paymentMethod')||'',note:fd.get('note')||'',enabled:fd.get('enabled')==='true'},ctx.id)}
  else if(form.id==='categoryForm'){await upsertDoc('category',{name:fd.get('name'),icon:fd.get('icon')||'🏷️'})}
  else if(form.id==='personProfileForm'){await upsertDoc('person',{name:fd.get('name'),phone:fd.get('phone')||'',note:fd.get('note')||'',pinned:fd.get('pinned')==='true'},ctx.id)}
  closeModal();await fetchData();renderCurrent();toast('تم الحفظ ✅')
}catch(e){toast(e.message||'تعذر الحفظ')}finally{loading(false)}}

/* Smart add / voice / OCR */
function parseSmart(text){
  let s=normalizeDigits(text).trim();const nums=[...s.matchAll(/\d+(?:[.,]\d+)?/g)].map(m=>Number(m[0].replace(',','.')));const amount=nums[0]||0;let type='receivable';
  if(/دفعت|اشتريت|مصروف|صرف|بنزين|اكل|أكل|سوبر|فاتورة/.test(s))type='expense';
  else if(/راتب|دخل|استلمت|ايراد|إيراد|قبضت/.test(s))type='income';
  else if(/عليّ|علي |استلفت|مدين|بدي ادفع|بدي أدفع/.test(s))type='payable';
  else if(/أخذ|اخذ|عليه|سلفت|اعطيت|أعطيت/.test(s))type='receivable';
  let clean=s.replace(/\d+(?:[.,]\d+)?/g,' ').replace(/دينار|دنانير|اليوم|امبارح|أمس|بكرا|غدا|غداً|دفعت|اشتريت|مصروف|صرف|راتب|دخل|استلمت|ايراد|إيراد|قبضت|عليّ|استلفت|مدين|أخذ|اخذ|عليه|سلفت|اعطيت|أعطيت/g,' ').replace(/\s+/g,' ').trim();
  return {type,amount,person:clean.slice(0,120),date:today(),note:text,meta:{category:/بنزين/.test(s)?'بنزين':/اكل|أكل/.test(s)?'أكل':'عام'}};
}
function startVoice(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return toast('المتصفح ما بدعم الإدخال الصوتي');const r=new SR();r.lang='ar-JO';r.interimResults=false;r.onstart=()=>toast('احكي الحركة الآن 🎙️');r.onresult=e=>{const t=e.results[0][0].transcript;$('#smartInput').value=t;toast('تم التقاط الكلام ✅')};r.onerror=()=>toast('تعذر التعرف على الصوت');r.start()}
function loadScript(src){return new Promise((res,rej)=>{if([...document.scripts].some(s=>s.src===src))return res();const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s)})}
async function ocrReceipt(){const file=state.pendingReceipt;if(!file)return toast('اختر صورة أولًا');loading(true,'جاري قراءة الصورة… قد تستغرق دقيقة');try{await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');const result=await window.Tesseract.recognize(file,'ara+eng');const text=result?.data?.text||'',nums=[...normalizeDigits(text).matchAll(/\b\d+(?:[.,]\d{1,3})?\b/g)].map(m=>Number(m[0].replace(',','.'))).filter(n=>n>0&&n<1000000);if(!nums.length)throw new Error('ما قدرت أتعرف على مبلغ واضح');const amount=Math.max(...nums);const inp=$('#entryForm [name="amount"]');if(inp)inp.value=amount;toast(`وجدت مبلغ محتمل: ${money(amount)} — راجعه قبل الحفظ`)}catch(e){toast(e.message||'تعذر قراءة الصورة')}finally{loading(false)}}

/* sharing */
function personStatement(name){const p=peopleSummary().find(x=>x.name===name),es=allEntries().filter(e=>e.person===name).sort((a,b)=>String(a.date).localeCompare(String(b.date)));const lines=[`كشف حساب تحويشتي — ${name}`,`إلي: ${money(p?.receivable||0)} | عليّ: ${money(p?.payable||0)} | الصافي: ${money(Math.abs(p?.net||0))}`,''];es.forEach(e=>lines.push(`${fmtDate(e.date)} — ${typeInfo(e.type)[1]} — ${money(['receivable','payable'].includes(e.type)?e.remaining:e.amount)}${e.note?` — ${e.note}`:''}`));lines.push('','© Yahya Saeed');return lines.join('\n')}
async function shareText(text){if(navigator.share){try{return await navigator.share({text})}catch{}}window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank')}
function printPerson(name){const text=personStatement(name).split('\n'),w=window.open('','_blank');if(!w)return toast('اسمح بالنوافذ المنبثقة للطباعة');w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>كشف حساب ${esc(name)}</title><style>body{font-family:Tahoma,Arial;padding:35px;color:#17372e}h1{color:#086a50}.box{border:1px solid #ddd;border-radius:12px;padding:18px;white-space:pre-line;line-height:1.9}footer{margin-top:30px;color:#777}</style></head><body><h1>تحويشتي — كشف حساب</h1><div class="box">${esc(text.join('\n'))}</div><footer>© Yahya Saeed</footer><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()}

/* backup / trash / audit / security */
function exportBackup(emergency=false){const data={version:7,exportedAt:new Date().toISOString(),entries:state.entries,payments:state.payments,documents:state.documents};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`tahweeshti-${emergency?'EMERGENCY-':''}${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast(emergency?'تم تنزيل نسخة طوارئ 🆘':'تم تنزيل النسخة الاحتياطية')}
function importBackup(){if(!guardMutation())return;const i=document.createElement('input');i.type='file';i.accept='application/json';i.onchange=async()=>{const f=i.files[0];if(!f)return;let d;try{d=JSON.parse(await f.text())}catch{return toast('الملف غير صالح')}if(!confirm('سيتم دمج النسخة مع البيانات الحالية. متابعة؟'))return;loading(true);try{await api('import',{entries:d.entries||[],payments:d.payments||[],documents:d.documents||[]});await fetchData();renderCurrent();toast('تم الاسترجاع ✅')}catch(e){toast(e.message||'تعذر الاسترجاع')}finally{loading(false)}};i.click()}
async function openTrash(){loading(true);try{const d=await api('trash_list');openModal('سلة المحذوفات','حذف تلقائي بعد 30 يوم',`<div class="stack">${(d.entries||[]).map(e=>`<div class="entry-card"><div class="entry-badge">🗑</div><div class="entry-main"><h4>${esc(e.person||typeInfo(e.type)[1])}</h4><div class="entry-meta">${fmtDate(e.entry_date)} · ${money(e.amount)}</div></div><div class="entry-actions"><button class="btn secondary small mutating" data-act="restore-entry" data-id="${e.id}">استرجاع</button><button class="btn danger-soft small mutating" data-act="purge-entry" data-id="${e.id}">نهائي</button></div></div>`).join('')}${(d.documents||[]).map(x=>`<div class="entry-card"><div class="entry-badge">🗃</div><div class="entry-main"><h4>${esc(x.data?.title||x.data?.name||x.kind)}</h4><div class="entry-meta">${esc(x.kind)}</div></div><div class="entry-actions"><button class="btn secondary small mutating" data-act="restore-doc" data-id="${x.id}">استرجاع</button><button class="btn danger-soft small mutating" data-act="purge-doc" data-id="${x.id}">نهائي</button></div></div>`).join('')||empty('السلة فارغة','')}</div>`,{size:'wide'})}catch(e){toast(e.message)}finally{loading(false)}}
async function openAudit(){loading(true);try{const d=await api('audit_list',{limit:120});openModal('سجل التغييرات','كل عملية مهمة محفوظة',`<div class="timeline">${(d.audit||[]).map(a=>`<div class="timeline-item"><i class="timeline-dot"></i><div class="timeline-body"><b>${esc(a.summary||a.action)}</b><div class="tiny muted">${esc(a.action)} · ${esc(a.entity_type)} · ${fmtDateTime(a.created_at)}</div></div></div>`).join('')||empty('ما في سجل','')}</div>`,{size:'wide'})}catch(e){toast(e.message)}finally{loading(false)}}
function openChangePin(){openModal('تغيير رمز الدخول','الأمان',`<form id="changePinForm" class="form-grid"><label class="field"><span>الرمز الحالي</span><input name="oldPin" type="password" inputmode="numeric" maxlength="4" required></label><label class="field"><span>الرمز الجديد</span><input name="newPin" type="password" inputmode="numeric" maxlength="4" required></label><label class="field full"><span>تأكيد الجديد</span><input name="confirmPin" type="password" inputmode="numeric" maxlength="4" required></label><div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary" type="submit">تغيير</button></div></form>`,{size:'small'})}
function openAdminPin(){const enabled=state.admin.enabled;openModal(enabled?'فتح صلاحيات الإدارة':'تفعيل رمز الإدارة','حماية الحذف النهائي',`<form id="adminPinForm" class="form-grid"><label class="field full"><span>${enabled?'رمز الإدارة':'اختر رمز إدارة من 4 أرقام'}</span><input name="pin" type="password" inputmode="numeric" maxlength="4" required></label>${!enabled?'<label class="field full"><span>تأكيد الرمز</span><input name="confirm" type="password" inputmode="numeric" maxlength="4" required></label>':''}<div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary" type="submit">${enabled?'فتح 15 دقيقة':'تفعيل'}</button></div></form>`,{size:'small',context:{kind:'admin',enabled}})}
function openAutolock(){openModal('القفل التلقائي','الأمان',`<form id="autoLockForm" class="form-grid"><label class="field full"><span>بعد كم دقيقة من عدم الاستخدام؟</span><select name="minutes"><option value="0">بدون قفل تلقائي</option>${[5,10,15,30,60].map(n=>`<option value="${n}" ${Number(state.prefs.autoLockMinutes)===n?'selected':''}>${n} دقيقة</option>`).join('')}</select></label><div class="modal-actions full"><span class="spacer"></span><button class="btn ghost" type="button" data-close-modal>إلغاء</button><button class="btn primary" type="submit">حفظ</button></div></form>`,{size:'small'})}

/* other actions */
async function deleteEntry(id){if(!guardMutation())return;if(!confirm('أنقل الحركة لسلة المحذوفات؟'))return;loading(true);try{await api('entry_delete',{id});closeModal();await fetchData();renderCurrent();toast('تم نقل الحركة للسلة','تراجع',async()=>{await api('entry_restore',{id});await fetchData();renderCurrent()})}catch(e){toast(e.message)}finally{loading(false)}}
async function deleteDoc(id){if(!guardMutation())return;if(!confirm('أنقل هذا العنصر لسلة المحذوفات؟'))return;loading(true);try{await api('doc_delete',{id});closeModal();await fetchData();renderCurrent();toast('تم النقل للسلة','تراجع',async()=>{await api('doc_restore',{id});await fetchData();renderCurrent()})}catch(e){toast(e.message)}finally{loading(false)}}
async function settlePerson(name){if(!guardMutation())return;if(!confirm(`تسوية الديون المتبادلة مع ${name} بدون حركة كاش؟`))return;loading(true);try{const d=await api('settle_person',{person:name,date:today()});await fetchData();renderCurrent();closeModal();toast(d.amount?`تمت تسوية ${money(d.amount)} ⚖`:'ما في مبالغ متبادلة قابلة للتسوية')}catch(e){toast(e.message)}finally{loading(false)}}
async function installmentPay(id){if(!guardMutation())return;const d=docs('installment').find(x=>x.id===id);if(!d)return;const x=d.data,paid=Number(x.paidInstallments||0),count=Number(x.installments||0);if(paid>=count)return toast('الخطة مكتملة');loading(true);try{await api('entry_upsert',{entry:{id:uid(),type:'expense',amount:Number(x.installmentAmount||0),person:x.person||x.title,date:today(),note:`قسط ${paid+1} من ${count} — ${x.title}`,receiptPath:'',meta:{category:x.category||'أقساط',walletId:x.walletId||'',paymentMethod:'',tags:['قسط'],reference:refCode(),installmentId:id}}});const next=new Date(`${x.nextDate||today()}T12:00:00`);next.setMonth(next.getMonth()+1);await upsertDoc('installment',{...x,paidInstallments:paid+1,nextDate:next.toISOString().slice(0,10)},id);await fetchData();renderCurrent();toast('تم تسجيل القسط ✅')}catch(e){toast(e.message)}finally{loading(false)}}

async function confirmSubscription(id){
  if(!guardMutation())return;
  const d=subscriptions().find(x=>x.id===id);if(!d)return;
  const x=d.data;if(x.enabled===false)return toast('هذا الاشتراك متوقف');
  const amount=Number(x.amount||0);if(!(amount>0))return toast('مبلغ الاشتراك غير صحيح');
  const scheduled=x.nextDate||today(),direction=x.direction==='incoming'?'incoming':'outgoing';
  loading(true,direction==='incoming'?'جاري تسجيل التحويل...':'جاري تسجيل الخصم...');
  try{
    await api('entry_upsert',{entry:{
      id:uid(),type:direction==='incoming'?'income':'expense',amount,person:x.title||'اشتراك شهري',date:today(),
      note:`اشتراك شهري — ${x.title||''}${x.note?` — ${x.note}`:''}`,receiptPath:'',
      meta:{category:'اشتراكات',walletId:x.walletId||'',paymentMethod:x.paymentMethod||'',tags:['اشتراك شهري'],reference:refCode(),subscriptionId:id,scheduledDate:scheduled}
    }});
    const history=[...(Array.isArray(x.history)?x.history:[]),{id:uid(),scheduledDate:scheduled,processedDate:today(),amount,action:direction==='incoming'?'transferred':'deducted'}];
    const nextDate=addMonthsClamped(scheduled,1,Number(x.anchorDay||String(scheduled).slice(-2)||1));
    await upsertDoc('subscription',{...x,nextDate,anchorDay:Number(x.anchorDay||String(scheduled).slice(-2)||1),history,lastProcessedAt:new Date().toISOString()},id);
    await fetchData();renderCurrent();toast(`${direction==='incoming'?'تم تسجيل التحويل':'تم تسجيل الخصم'} ✅ الموعد الجديد ${fmtDate(nextDate)}`);
  }catch(e){toast(e.message||'تعذر تحديث الاشتراك')}finally{loading(false)}
}
async function showReceipt(id){const e=state.entries.find(x=>x.id===id);if(!e?.receiptPath)return;loading(true);try{const d=await api('receipt_url',{path:e.receiptPath});openModal('الإيصال','صورة مرفقة',`<div class="receipt-view"><img src="${esc(d.url)}" alt="إيصال"></div>`,{size:'wide'})}catch(e){toast(e.message)}finally{loading(false)}}
async function markPaid(id){openPaymentForm(id,true)}
function shareEntry(id){const e=allEntries().find(x=>x.id===id);if(!e)return;shareText(`تحويشتي\n${e.person||typeInfo(e.type)[1]} — ${typeInfo(e.type)[1]} — ${money(['receivable','payable'].includes(e.type)?e.remaining:e.amount)}\nالتاريخ: ${fmtDate(e.date)}\nالمرجع: ${e.meta?.reference||'—'}${e.note?`\n${e.note}`:''}`)}

async function installApp(){if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;toast('تم إرسال طلب التثبيت ✅')}else toast('من قائمة المتصفح اختر: إضافة إلى الشاشة الرئيسية / Install app')}
function handleQuickParam(){const q=new URLSearchParams(location.search).get('quick');if(q&&['expense','income','receivable','payable'].includes(q)){setTimeout(()=>openEntryForm('',{type:q}),400);history.replaceState({},'',location.pathname)}}

/* delegated events */
document.addEventListener('click',async ev=>{
  markActivity();const close=ev.target.closest('[data-close-modal]');if(close){closeModal();return}
  const nav=ev.target.closest('[data-nav]');if(nav){navigate(nav.dataset.nav);return}
  const b=ev.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,id=b.dataset.id,name=b.dataset.name;
  try{
    if(a==='new-entry')openEntryForm('',{type:b.dataset.type||'receivable'});else if(a==='edit-entry')openEntryForm(id);else if(a==='delete-entry')await deleteEntry(id);else if(a==='pay-entry')openPaymentForm(id,false);else if(a==='mark-paid')markPaid(id);else if(a==='receipt')await showReceipt(id);else if(a==='share-entry')shareEntry(id);
    else if(a==='parse-smart'){const t=$('#smartInput')?.value.trim();if(!t)return toast('اكتب الحركة أولًا');const p=parseSmart(t);if(!p.amount)return toast('ما قدرت أحدد المبلغ');openEntryForm('',p)}else if(a==='voice-smart')startVoice();else if(a==='ocr-receipt')await ocrReceipt();
    else if(a==='person-detail')openPersonDetail(name);else if(a==='new-person')openPersonProfile('');else if(a==='person-profile')openPersonProfile(name);else if(a==='settle-person')await settlePerson(name);else if(a==='share-person')shareText(personStatement(name));else if(a==='print-person')printPerson(name);
    else if(a==='goal-form')openGoalForm();else if(a==='goal-edit')openGoalForm(id);else if(a==='goal-contribute')openGoalContribution(id);
    else if(a==='wallet-form')openWalletForm();else if(a==='wallet-edit')openWalletForm(id);else if(a==='transfer-form')openTransferForm();else if(a==='budget-form')openBudgetForm();else if(a==='installment-form')openInstallmentForm();else if(a==='installment-edit')openInstallmentForm(id);else if(a==='installment-pay')await installmentPay(id);else if(a==='subscription-form')openSubscriptionForm();else if(a==='subscription-edit')openSubscriptionForm(id);else if(a==='subscription-confirm')await confirmSubscription(id);else if(a==='recurring-form')openRecurringForm();else if(a==='recurring-edit')openRecurringForm(id);else if(a==='category-form')openCategoryForm();else if(a==='delete-doc')await deleteDoc(id);
    else if(a==='calendar-prev'){state.calendarCursor=new Date(state.calendarCursor.getFullYear(),state.calendarCursor.getMonth()-1,1);renderCalendar()}else if(a==='calendar-next'){state.calendarCursor=new Date(state.calendarCursor.getFullYear(),state.calendarCursor.getMonth()+1,1);renderCalendar()}else if(a==='calendar-day'){const ds=b.dataset.date,es=allEntries().filter(e=>e.date===ds),ss=subscriptions().filter(s=>s.data.enabled!==false&&s.data.nextDate===ds);openModal(fmtDate(ds),'حركات ومواعيد اليوم',`<div class="entries-list">${es.map((e,i)=>entryCard(e,i)).join('')}${ss.map(subscriptionCard).join('')}${!es.length&&!ss.length?empty('ما في حركات أو اشتراكات',''):''}</div>`,{size:'wide'})}
    else if(a==='toggle-theme')await savePrefs({theme:state.prefs.theme==='light'?'dark':'light'});else if(a==='toggle-privacy')await savePrefs({hideAmounts:!state.prefs.hideAmounts});else if(a==='toggle-viewonly')await savePrefs({viewOnly:!state.prefs.viewOnly});else if(a==='toggle-card'){const arr=new Set(state.prefs.hiddenCards||[]);arr.has(b.dataset.card)?arr.delete(b.dataset.card):arr.add(b.dataset.card);await savePrefs({hiddenCards:[...arr]})}
    else if(a==='notifications')await requestNotifications();else if(a==='install-app')await installApp();else if(a==='export-backup')exportBackup(false);else if(a==='emergency-backup')exportBackup(true);else if(a==='import-backup')importBackup();else if(a==='trash')await openTrash();else if(a==='audit')await openAudit();else if(a==='change-pin')openChangePin();else if(a==='admin-pin')openAdminPin();else if(a==='autolock-form')openAutolock();
    else if(a==='restore-entry'){await api('entry_restore',{id});await openTrash();await fetchData()}else if(a==='purge-entry'){if(!confirm('حذف نهائي؟'))return;await api('entry_purge',{id});await openTrash();await fetchData()}else if(a==='restore-doc'){await api('doc_restore',{id});await openTrash();await fetchData()}else if(a==='purge-doc'){if(!confirm('حذف نهائي؟'))return;await api('doc_purge',{id});await openTrash();await fetchData()}
  }catch(e){toast(e.message||'تعذر تنفيذ العملية')}
});
document.addEventListener('submit',async ev=>{markActivity();ev.preventDefault();const f=ev.target;if(f.id==='authForm')return authSubmit(ev);if(f.id==='entryForm')return submitEntry(f);if(f.id==='paymentForm')return submitPayment(f);if(['goalForm','goalContributionForm','walletForm','transferForm','budgetForm','installmentForm','subscriptionForm','recurringForm','categoryForm','personProfileForm'].includes(f.id))return submitDocForm(f);if(f.id==='changePinForm'){const fd=new FormData(f),oldPin=normalizeDigits(fd.get('oldPin')).replace(/\D/g,''),newPin=normalizeDigits(fd.get('newPin')).replace(/\D/g,''),confirmPin=normalizeDigits(fd.get('confirmPin')).replace(/\D/g,'');if(newPin.length!==4||newPin!==confirmPin)return toast('تأكد من الرمز الجديد');loading(true);try{await api('change_pin',{oldPin,newPin});closeModal();toast('تم تغيير رمز الدخول ✅')}catch(e){toast(e.message)}finally{loading(false)}}if(f.id==='adminPinForm'){const fd=new FormData(f),pin=normalizeDigits(fd.get('pin')).replace(/\D/g,'');if(pin.length!==4)return toast('الرمز لازم 4 أرقام');if(!state.admin.enabled&&pin!==normalizeDigits(fd.get('confirm')).replace(/\D/g,''))return toast('الرمزان غير متطابقين');loading(true);try{await api(state.admin.enabled?'admin_unlock':'admin_setup',{pin});state.admin=await api('admin_status');closeModal();renderSettings();toast('صلاحيات الإدارة جاهزة 🛡')}catch(e){toast(e.message)}finally{loading(false)}}if(f.id==='autoLockForm'){const mins=Number(new FormData(f).get('minutes'));await savePrefs({autoLockMinutes:mins});closeModal();toast('تم حفظ القفل التلقائي')}});

function bindTop(){
  $('#quickAddTop').onclick=()=>openEntryForm();$('#mobileAdd').onclick=()=>openEntryForm();$('#logoutBtn').onclick=logout;$('#refreshBtn').onclick=async()=>{loading(true);try{await api('process_recurring',{today:today()});await fetchData();renderCurrent();toast('تم التحديث والمزامنة ↻')}catch(e){toast(e.message)}finally{loading(false)}};$('#themeBtn').onclick=()=>savePrefs({theme:state.prefs.theme==='light'?'dark':'light'});$('#privacyBtn').onclick=()=>savePrefs({hideAmounts:!state.prefs.hideAmounts});$('#authInstallBtn').onclick=installApp; $('#createAccountBtn').onclick=()=>setAuthMode(($('#authForm').dataset.mode||'login')==='setup'?'login':'setup');
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e});['pointerdown','keydown','touchstart'].forEach(ev=>window.addEventListener(ev,markActivity,{passive:true}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#modalRoot').classList.contains('open'))closeModal()});
}

async function init(){
  const hideSplash=()=>{const s=$('#splash');if(s)s.classList.add('hide')};
  const splashTimer=setTimeout(hideSplash,1400);
  try{
    validateShell();
    $('#todayLabel').textContent=new Intl.DateTimeFormat('ar-JO',{weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Amman'}).format(new Date());
    if('serviceWorker'in navigator){
      navigator.serviceWorker.register('./service-worker.js?v=7.4.0').catch(err=>console.warn('SW registration failed',err));
    }
    bindTop();
    const s=await api('status',{},false);
    state.initialized=!!s.initialized;state.multiAccount=s.multiAccount!==false;
    if(state.sessionToken){
      try{
        const sess=await api('session');
        state.admin=sess.admin||state.admin;
        await api('process_recurring',{today:today()});
        await enterApp();
        return;
      }catch(err){
        console.warn('Saved session rejected',err);
        saveSession('');
      }
    }
    showAuth();
  }catch(e){
    console.error('Tahweeshti startup error:',e);
    try{
      showAuth(true);
      const box=$('#authMessage');
      if(box)box.textContent=`تعذر تشغيل التطبيق: ${e?.message||'خطأ غير معروف'}`;
    }catch{}
    toast(`خطأ بالتشغيل: ${e?.message||'غير معروف'}`);
  }finally{
    clearTimeout(splashTimer);
    setTimeout(hideSplash,350);
  }
}

window.addEventListener('error',e=>console.error('Window error:',e.error||e.message));
window.addEventListener('unhandledrejection',e=>console.error('Unhandled rejection:',e.reason));
init();
