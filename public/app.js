// ── Defaults & constants ──────────────────────────────────────────────────────
const DEFAULTS = [
  {id:'aws',label:'AWS Server',color:'#378ADD',order:0,
   presets:['Check server health','Review CloudWatch alerts','Check billing','Update security groups','Verify backups','Review EC2 usage','Check S3 buckets','Update IAM permissions']},
  {id:'eps',label:'ePS CC Server',color:'#7F77DD',order:1,
   presets:['Check server status','Review error logs','Restart services','Update config','Monitor performance','Check disk space','Clear cache','Review DB connections']},
  {id:'regression',label:'Regression',color:'#1D9E75',order:2,
   presets:['Run regression suite','Review test results','Log failed tests','Update test cases','Sign off release','Compare test runs','Re-run flaky tests','Smoke test deploy']},
  {id:'meetings',label:'Meetings',color:'#D85A30',order:3,
   presets:['Prepare agenda','Send invite','Take notes','Send follow-up','Update action items','Book room','Share recording']},
  {id:'calls',label:'Calls',color:'#BA7517',order:4,
   presets:['Prepare talking points','Log call notes','Send follow-up email','Schedule next call','Update contact info']},
  {id:'integrations',label:'Integrations',color:'#D4537E',order:5,
   presets:['Test API endpoint','Check integration logs','Update API keys','Document changes','Verify webhook','Review error rate','Check rate limits']},
];
const COLORS=['#378ADD','#7F77DD','#1D9E75','#D85A30','#BA7517','#D4537E','#0EA5E9','#8B5CF6','#10B981','#F59E0B','#EF4444','#636366'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DEFAULT_SCRUM=['DSM','Code Review','Backlog Refinement','Sprint Planning','Sprint Review','Retrospective'];

// ── State ─────────────────────────────────────────────────────────────────────
let activeTab='all', cats=[], tasks={};
let presetsOpen=false, recog=null, db=null, auth=null;
let selPri=null, addDate=null;
let calMode='add', calYear, calMonth;
let selColor=COLORS[0];
let timerInterval=null;
let settings={ jiraPrefix:'CTI-', jiraBaseUrl:'', casePrefix:'Case-', caseBaseUrl:'', scrumActivities:null, scrumCategoryId:'', timeFormat:'12h', autoRenameCats:[], maxTimerHours:4 };
let warnedSessions=new Set(), staleChecked=false;

// ── Firebase ──────────────────────────────────────────────────────────────────
// authState: 'loading' until Firebase answers, then 'in' / 'out'; 'local' = Firebase unavailable, device-only mode
let authState='loading';
function initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db=firebase.database();
    auth=firebase.auth();
    db.ref('.info/connected').on('value',s=>setSyncBadge(s.val()?'online':'offline'));
    auth.onAuthStateChanged(user=>{ user ? onSignedIn(user) : onSignedOut(); });
  } catch(e){
    console.error(e); db=null; auth=null; setSyncBadge('error');
    // Offline / init failure: allow local-only access on this device
    authState='local';
    cats=DEFAULTS; loadLocal(); applySettings(); checkTimer(); checkStaleTimer();
    route();
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
let listenersAttached=false;
function onSignedIn(user){
  authState='in';
  const err=document.getElementById('loginErr'); if(err)err.textContent='';
  const pass=document.getElementById('loginPass'); if(pass)pass.value='';
  const acct=document.getElementById('accountEmail'); if(acct)acct.textContent=user&&user.email?('Signed in as '+user.email):'';
  if(!listenersAttached){ attachDataListeners(); listenersAttached=true; }
  route();
}
function onSignedOut(){
  authState='out';
  route();
}
function doResetPassword(){
  const email=document.getElementById('resetEmail').value.trim();
  const err=document.getElementById('resetErr'), ok=document.getElementById('resetOk');
  err.textContent=''; ok.textContent='';
  if(!email){ err.textContent='Enter your email.'; return; }
  if(!auth){ err.textContent='Auth not ready — check your connection.'; return; }
  const btn=document.getElementById('resetBtn'); btn.disabled=true;
  const sent='If an account exists for '+email+', a reset link is on its way. Check your inbox.';
  auth.sendPasswordResetEmail(email)
    .then(()=>{ ok.textContent=sent; })
    .catch(e=>{
      const code=(e&&e.code)||'';
      if(code.includes('invalid-email')) err.textContent='That email looks invalid.';
      else if(code.includes('too-many-requests')) err.textContent='Too many attempts — try again later.';
      else if(code.includes('network')) err.textContent='Network error — check your connection.';
      else ok.textContent=sent;
    })
    .finally(()=>{ btn.disabled=false; });
}
function doLogin(){
  const email=document.getElementById('loginEmail').value.trim();
  const pass=document.getElementById('loginPass').value;
  const err=document.getElementById('loginErr');
  err.textContent='';
  if(!email||!pass){ err.textContent='Enter email and password.'; return; }
  if(!auth){ err.textContent='Auth not ready — check your connection.'; return; }
  auth.signInWithEmailAndPassword(email,pass)
    .catch(e=>{ err.textContent = (e&&e.code) ? loginErrMsg(e.code) : 'Sign-in failed.'; });
}
function loginErrMsg(code){
  if(code.includes('wrong-password')||code.includes('invalid-credential'))return 'Wrong email or password.';
  if(code.includes('user-not-found'))return 'No account with that email.';
  if(code.includes('too-many-requests'))return 'Too many attempts — try again later.';
  if(code.includes('invalid-email'))return 'That email looks invalid.';
  if(code.includes('network'))return 'Network error — check your connection.';
  return 'Sign-in failed ('+code+').';
}
function signOut(){
  if(findActiveSession()&&!confirm('A timer is still running. It keeps running while you are logged out.\n\nLog out anyway?'))return;
  const go=()=>location.replace('/login');
  if(auth) auth.signOut().then(go).catch(go);
  else go();
}

function attachDataListeners(){
  db.ref('settings').on('value', snap=>{
    const v=snap.val();
    if(v){ settings={...settings,...v}; applySettings(); }
  });
  db.ref('categories').on('value',snap=>{
    const v=snap.val();
    if(v&&Object.keys(v).length){
      cats=Object.values(v).sort((a,b)=>(a.order||0)-(b.order||0));
    } else {
      cats=DEFAULTS.map((c,i)=>({...c,order:i}));
      db.ref('categories').set(Object.fromEntries(cats.map(c=>[c.id,c])));
    }
    cats.forEach(c=>{if(!tasks[c.id])tasks[c.id]=[];});
    render();
  });
  db.ref('tasks').on('value',snap=>{
    const v=snap.val()||{};
    cats.forEach(c=>{tasks[c.id]=v[c.id]?Object.values(v[c.id]):[];});
    Object.keys(v).forEach(k=>{if(!tasks[k])tasks[k]=Object.values(v[k]);});
    normalizeSessions();
    checkTimer();
    checkStaleTimer();
    render();
  });
}

// Firebase may return session arrays as objects — restore them to arrays
function normalizeSessions(){
  Object.keys(tasks).forEach(k=>(tasks[k]||[]).forEach(t=>{
    if(t.sessions) t.sessions=Object.values(t.sessions);
  }));
}

function saveTasks(){
  if(!db){saveLocal();return;}
  const data={};
  cats.forEach(c=>{data[c.id]={};(tasks[c.id]||[]).forEach(t=>{data[c.id][t.id]=t;});});
  db.ref('tasks').set(data).catch(saveLocal);
}
function saveCats(){
  if(!db){saveLocal();return;}
  db.ref('categories').set(Object.fromEntries(cats.map((c,i)=>[c.id,{...c,order:i}])));
}
function saveSettingsRemote(){
  if(!db){saveLocal();return;}
  db.ref('settings').set(settings);
}
function saveLocal(){
  localStorage.setItem('tc_cats',JSON.stringify(cats));
  localStorage.setItem('tc_tasks',JSON.stringify(tasks));
  localStorage.setItem('tc_settings',JSON.stringify(settings));
}
function loadLocal(){
  try{cats=JSON.parse(localStorage.getItem('tc_cats'))||DEFAULTS;}catch{cats=DEFAULTS;}
  try{tasks=JSON.parse(localStorage.getItem('tc_tasks'))||{};}catch{tasks={};}
  try{const s=JSON.parse(localStorage.getItem('tc_settings'));if(s)settings={...settings,...s};}catch{}
  cats.forEach(c=>{if(!tasks[c.id])tasks[c.id]=[];});
  normalizeSessions();
}
function setSyncBadge(s){
  const b=document.getElementById('syncBadge');
  b.className='pill sync-badge '+s;
  b.textContent=s==='online'?'Live sync':s==='offline'?'Offline':'Sync error';
}
function applySettings(){
  document.getElementById('jiraPfxLbl').textContent=settings.jiraPrefix||'CTI-';
  const pfx=document.getElementById('jiraPrefixSetting');
  if(pfx&&pfx.value!==settings.jiraPrefix)pfx.value=settings.jiraPrefix||'CTI-';
  const url=document.getElementById('jiraUrlSetting');
  if(url&&url.value!==settings.jiraBaseUrl)url.value=settings.jiraBaseUrl||'';
  document.getElementById('casePfxLbl').textContent=settings.casePrefix||'Case-';
  const cp=document.getElementById('casePrefixSetting');
  if(cp&&cp.value!==settings.casePrefix)cp.value=settings.casePrefix||'Case-';
  const cu=document.getElementById('caseUrlSetting');
  if(cu&&cu.value!==settings.caseBaseUrl)cu.value=settings.caseBaseUrl||'';
  const tf=document.getElementById('timeFmtSel'); if(tf)tf.value=settings.timeFormat||'12h';
}
function updateJiraPrefix(){
  settings.jiraPrefix=document.getElementById('jiraPrefixSetting').value;
  document.getElementById('jiraPfxLbl').textContent=settings.jiraPrefix;
  saveSettingsRemote();
}
function updateCasePrefix(){
  settings.casePrefix=document.getElementById('casePrefixSetting').value;
  document.getElementById('casePfxLbl').textContent=settings.casePrefix;
  saveSettingsRemote();
}
function saveSettings(){
  settings.jiraBaseUrl=document.getElementById('jiraUrlSetting').value;
  settings.caseBaseUrl=document.getElementById('caseUrlSetting').value;
  saveSettingsRemote();
}
function setTimeFormat(){
  settings.timeFormat=document.getElementById('timeFmtSel').value;
  saveSettingsRemote();
  if(logCatId!==null){ renderSessionEditor(collectSessions()); }
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(){
  if(currentView==='tasks'&&activeTab!=='focus'&&activeTab!=='all'&&cats.length&&!getCat()){ navigate('/all',true); return; }
  renderSidebar(); updateDoneBadge(); updateTitle();
  if(currentView==='tasks'){
    renderSecTitle();
    activeTab==='focus'?renderFocus():(activeTab==='all'?renderAll():renderCat());
    renderComposer(); renderPresets(); updatePlusColor(); renderScrumBar();
    document.getElementById('todayLbl').textContent=
      new Date().toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'});
  } else if(currentView==='plan'){ renderDailyPlan(); }
  else if(currentView==='report'){ renderReport(); }
  else if(currentView==='settings'){ renderCatList(); renderScrumSettings(); }
}

// ── Sidebar (niluscap-style navigation) ──────────────────────────────────────
function navItem(path,label,iconHtml,extra,active){
  return `<li><a href="${path}" data-link class="${active?'active':''}" title="${esc(label)}">${iconHtml}<span class="sidebar-label">${esc(label)}</span>${extra||''}</a></li>`;
}
function renderSidebar(){
  const nav=document.getElementById('sideNav'); if(!nav)return;
  const tv=currentView==='tasks';
  const fItems=focusItems(), fN=fItems.length, hot=fItems.some(x=>x.g<=1);
  const allN=cats.reduce((n,c)=>n+(tasks[c.id]||[]).filter(t=>!t.done).length,0);
  let html='<ul>';
  html+=navItem('/','Focus',icon('bolt'),fN?`<span class="nav-count${hot?' hot':''}">${fN}</span>`:'',tv&&activeTab==='focus');
  html+=navItem('/all','All tasks',icon('list'),allN?`<span class="nav-num">${allN}</span>`:'',tv&&activeTab==='all');
  html+='</ul><div class="nav-heading sidebar-label">Categories</div><ul>';
  cats.forEach(c=>{
    const n=(tasks[c.id]||[]).filter(t=>!t.done).length;
    html+=navItem(catPath(c.id),c.label,`<span class="nav-dot" style="background:${c.color}"></span>`,n?`<span class="nav-num">${n}</span>`:'',tv&&activeTab===c.id);
  });
  if(!cats.length) html+='<li class="muted sidebar-label" style="padding:4px 10px;font-size:.85rem">No categories yet</li>';
  html+='</ul><ul>';
  html+=navItem('/plan','Daily plan',icon('calendar'),'',currentView==='plan');
  html+=navItem('/report','Time report',icon('chart'),'',currentView==='report');
  html+='</ul><ul>';
  html+=navItem('/settings','Settings',icon('settings'),'',currentView==='settings');
  html+='</ul>';
  nav.innerHTML=html;
}
function renderSecTitle(){
  let label,left;
  if(activeTab==='focus'){
    const n=focusItems().length;
    document.getElementById('secTitle').textContent=n?('Focus · '+n+' item'+(n!==1?'s':'')):'Focus';
    return;
  }
  if(activeTab==='all'){
    const total=cats.reduce((n,c)=>n+(tasks[c.id]||[]).length,0);
    const done=cats.reduce((n,c)=>n+(tasks[c.id]||[]).filter(t=>t.done).length,0);
    label='All tasks';left=total?` · ${total-done} open`:'';
  } else {
    const cat=getCat();if(!cat)return;
    const list=tasks[activeTab]||[],done=list.filter(t=>t.done).length;
    label=cat.label;left=list.length?` · ${list.length-done} open`:'';
  }
  document.getElementById('secTitle').textContent=label+left;
}
function renderAll(){
  const el=document.getElementById('taskList');
  const total=cats.reduce((n,c)=>n+(tasks[c.id]||[]).length,0);
  if(!total){el.innerHTML=`<div class="empty"><div class="empty-icon">🗂️</div><div class="empty-msg">Nothing yet.<br>Add your first task above.</div></div>`;return;}
  let html='';
  cats.forEach(c=>{
    const list=tasks[c.id]||[];if(!list.length)return;
    const open=list.filter(t=>!t.done).length;
    html+=`<div class="cat-group">
      <div class="cat-group-hdr"><div class="cat-dot" style="background:${c.color}"></div>
      <span class="cat-group-label">${esc(c.label)}</span>
      <span class="cat-group-count">${open} open</span></div>
      <div class="cat-group-tasks">${orderedList(c.id).map(x=>taskHtml(x.t,x.i,c)).join('')}</div>
    </div>`;
  });
  el.innerHTML=html;
}
function renderCat(){
  const el=document.getElementById('taskList');
  const cat=getCat();if(!cat)return;
  const list=tasks[activeTab]||[];
  if(!list.length){el.innerHTML=`<div class="empty"><div class="empty-icon">📋</div><div class="empty-msg">No tasks yet —<br>add one above or open Quick presets</div></div>`;return;}
  el.innerHTML=orderedList(activeTab).map(x=>taskHtml(x.t,x.i,cat)).join('');
}

function orderedList(catId){
  const list=tasks[catId]||[];
  const res=[];
  list.forEach((t,i)=>{
    if(t.parentId&&list.some(p=>p.id===t.parentId))return;
    res.push({t,i});
    list.forEach((c2,j)=>{ if(c2.parentId===t.id)res.push({t:c2,i:j}); });
  });
  return res;
}
function addSubtask(catId,parentId){
  const list=tasks[catId]||[];
  const parent=list.find(t=>t.id===parentId);
  if(!parent)return;
  const name=prompt('New subtask under "'+parent.text+'":');
  if(!name||!name.trim())return;
  const t={id:'t'+Date.now(),text:name.trim(),done:false,createdAt:Date.now(),parentId:parentId};
  if(parent.jiraNumber)t.jiraNumber=parent.jiraNumber;
  if(parent.caseNumber)t.caseNumber=parent.caseNumber;
  tasks[catId].push(t);
  saveTasks();render();
}
function focusItems(){
  const today=dateStr(new Date());
  const items=[];
  cats.forEach(c=>(tasks[c.id]||[]).forEach((t,i)=>{
    if(t.done)return;
    const running=!!(t.sessions&&t.sessions.some(s=>!s.end));
    let g=null;
    if(running)g=0;
    else if(t.dueDate&&t.dueDate<today)g=1;
    else if(t.dueDate===today)g=2;
    else if(t.priority===1)g=3;
    if(g!==null)items.push({cat:c,i,t,g});
  }));
  items.sort((a,b)=>a.g-b.g||((a.t.priority||9)-(b.t.priority||9))||String(a.t.dueDate||'9999').localeCompare(String(b.t.dueDate||'9999')));
  const p1=items.filter(x=>x.g===3);
  if(p1.length>3){const keep=new Set(p1.slice(0,3));return items.filter(x=>x.g!==3||keep.has(x));}
  return items;
}
const FOCUS_GROUPS={0:['now','⏱ Now running'],1:['overdue','⚠ Overdue'],2:['today','📅 Due today'],3:['p1','🔥 Top priority']};
function renderFocus(){
  const el=document.getElementById('taskList');
  const items=focusItems();
  const n=doneTodayCount();
  if(!items.length){
    el.innerHTML=`<div class="focus-empty"><div class="fe-icon">🎉</div>
      <div>All clear — nothing urgent.</div>
      <div style="margin-top:.4rem;font-size:13px;">${n?('You finished '+n+' task'+(n!==1?'s':'')+' today.'):'Add a task above or pick a category in the sidebar.'}</div></div>`;
    return;
  }
  let html='',last=null;
  items.forEach(x=>{
    if(x.g!==last){
      const[cls,lbl]=FOCUS_GROUPS[x.g];
      html+=`<div class="focus-sec ${cls}"><span class="focus-sec-lbl">${lbl}</span></div>`;
      last=x.g;
    }
    html+=taskHtml(x.t,x.i,x.cat,true);
  });
  el.innerHTML=html;
}
function doneTodayCount(){
  const today=dateStr(new Date());
  let n=0;
  Object.keys(tasks).forEach(k=>(tasks[k]||[]).forEach(t=>{
    if(t.done&&t.doneAt&&dateStr(new Date(t.doneAt))===today)n++;
  }));
  return n;
}
function updateDoneBadge(){
  const b=document.getElementById('doneBadge');
  const n=doneTodayCount();
  if(n>0){b.textContent='✓ '+n+' today';b.style.display='';}
  else b.style.display='none';
}

function taskHtml(t,i,cat,flat){
  const par=t.parentId?(tasks[cat.id]||[]).find(x=>x.id===t.parentId):null;
  const parentChip=(flat&&par)?`<span class="parent-chip">${esc(par.text)} ›</span>`:'';
  const subBtn=(!t.parentId)?`<button class="icon-button sub-add" onclick="addSubtask('${cat.id}','${t.id}')" title="Add subtask" aria-label="Add subtask">${icon('subtask')}</button>`:'';
  const activeSession=t.sessions&&t.sessions.find(s=>!s.end);
  const isRec=!!activeSession;
  const priTag=t.priority?`<span class="pri-tag p${t.priority}">P${t.priority}</span>`:'';
  const jiraTag=t.jiraNumber?buildJiraTag(t.jiraNumber):'';
  const caseTag=t.caseNumber?buildCaseTag(t.caseNumber):'';
  const due=dueBadge(t,i,cat.id);
  const created=fmtCreated(t.createdAt);
  const totalMs=getTotalMs(t);
  const sessCount=(t.sessions||[]).length;

  const elapsedHtml=isRec
    ?`<span class="timer-elapsed" id="el-${t.id}">${fmtElapsed(Date.now()-activeSession.start)}</span>`:'';
  const totalHtml=totalMs>0
    ?`<span class="timer-total">${fmtDuration(totalMs)} logged · <span class="link" onclick="openTimeLog('${cat.id}',${i})">${sessCount} session${sessCount!==1?'s':''}</span></span>`:'';
  const timerRow=(elapsedHtml||totalHtml)?`<div class="timer-row">${elapsedHtml}${totalHtml}</div>`:'';
  const lastNote=(t.sessions||[]).slice().reverse().find(s=>s.note&&String(s.note).trim());
  const noteHtml=lastNote?`<div class="task-note" onclick="openTimeLog('${cat.id}',${i})" title="What you did — click to edit">${esc(lastNote.note)}</div>`:'';

  return `<div class="task ${t.done?'done':''} ${isRec?'rec-active':''} ${(!flat&&par)?'subtask':''}" id="task-${t.id}">
    <div class="check" onclick="toggle('${cat.id}',${i})"
      style="${t.done?'background:'+cat.color+';border-color:'+cat.color:'border-color:'+cat.color+'88'}">${t.done?'✓':''}</div>
    <div class="task-body">
      <div class="task-lbl-row">
        <div class="task-lbl" title="Tap to rename" onclick="startRename('${cat.id}',${i})">${esc(t.text)}</div>
        <button class="icon-button rename-btn" onclick="startRename('${cat.id}',${i})" title="Rename" aria-label="Rename">${icon('edit',15)}</button>
      </div>
      <div class="task-meta">${parentChip}${priTag}${jiraTag}${caseTag}<span class="created-lbl">Added ${created}</span>${due}</div>
      ${timerRow}
      ${noteHtml}
    </div>
    <div class="task-actions">
      <button class="t-btn ${isRec?'on':''}" onclick="toggleTimer('${cat.id}',${i})" title="${isRec?'Stop':'Start'} timer" aria-label="${isRec?'Stop':'Start'} timer">${icon(isRec?'stop':'play',14,true)}</button>
      <button class="icon-button danger del" onclick="del('${cat.id}',${i})" title="Delete" aria-label="Delete">${icon('x',16)}</button>
      ${subBtn}
    </div>
  </div>`;
}

function buildJiraTag(num){
  const pfx=settings.jiraPrefix||'CTI-';
  const ticket=pfx+num;
  const base=settings.jiraBaseUrl||'';
  if(base){
    return `<a class="jira-tag linked" href="${esc(base+ticket)}" target="_blank" rel="noopener">${esc(ticket)}</a>`;
  }
  return `<span class="jira-tag">${esc(ticket)}</span>`;
}
function buildCaseTag(num){
  const pfx=settings.casePrefix||'Case-';
  const ticket=pfx+num;
  const base=settings.caseBaseUrl||'';
  if(base){
    return `<a class="case-tag linked" href="${esc(base+ticket)}" target="_blank" rel="noopener">${esc(ticket)}</a>`;
  }
  return `<span class="case-tag">${esc(ticket)}</span>`;
}

function dueBadge(t,i,catId){
  if(!t.dueDate)return `<span class="due-tag due-add" onclick="openCalEdit('${catId}',${i})">+ due date</span>`;
  const today=new Date();today.setHours(0,0,0,0);
  const due=new Date(t.dueDate+'T00:00:00');
  const diff=Math.round((due-today)/86400000);
  let cls,lbl;
  if(diff<0){cls='due-overdue';lbl=`Overdue · ${fmtDate(t.dueDate)}`;}
  else if(diff===0){cls='due-today';lbl='Due today';}
  else if(diff===1){cls='due-tomorrow';lbl='Tomorrow';}
  else if(diff<=7){cls='due-soon';lbl=`${diff}d · ${fmtDate(t.dueDate)}`;}
  else{cls='due-future';lbl=fmtDate(t.dueDate);}
  return `<span class="due-tag ${cls}" onclick="openCalEdit('${catId}',${i})">${lbl}</span>`;
}

function renderPresets(){
  const cat=cats.find(c=>c.id===targetCatId());
  document.getElementById('presetsScroll').innerHTML=cat
    ?((cat.presets||[]).map(p=>`<button class="chip" onclick="addTask(${esc(JSON.stringify(p))})">${esc(p)}</button>`).join('')
      ||'<span class="muted" style="font-size:.85rem">No presets for this category.</span>'):'';
}
function updatePlusColor(){
  const cat=cats.find(c=>c.id===targetCatId());
  const dot=document.getElementById('addToDot'); if(dot)dot.style.background=cat?cat.color:'transparent';
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function findActiveSession(){
  for(const c of cats){
    const list=tasks[c.id]||[];
    for(let i=0;i<list.length;i++){
      const t=list[i];
      if(t.sessions&&t.sessions.some(s=>!s.end)) return {catId:c.id,i,task:t};
    }
  }
  return null;
}

function toggleTimer(catId,i){
  const t=tasks[catId][i];
  const active=t.sessions&&t.sessions.some(s=>!s.end);
  if(active){
    t.sessions=t.sessions.map(s=>s.end?s:{...s,end:Date.now()});
  } else {
    const cur=findActiveSession();
    if(cur){
      tasks[cur.catId][cur.i].sessions=tasks[cur.catId][cur.i].sessions.map(s=>s.end?s:{...s,end:Date.now()});
    }
    if(!t.sessions)t.sessions=[];
    t.sessions.push({start:Date.now(),end:null});
  }
  saveTasks(); checkTimer(); render();
  if(active && (settings.autoRenameCats||[]).includes(catId))
    renameTaskPrompt(catId,i,'What was this about? Rename the task:');
}

function checkTimer(){
  const active=findActiveSession();
  if(active&&!timerInterval){
    timerInterval=setInterval(tick,1000);
  } else if(!active&&timerInterval){
    clearInterval(timerInterval); timerInterval=null;
  }
  updateGlobalBadge();
}

function checkStaleTimer(){
  if(staleChecked)return;
  const a=findActiveSession();
  if(!a)return;
  staleChecked=true;
  const s=a.task.sessions.find(x=>!x.end);
  if(!s)return;
  if(dateStr(new Date(s.start))!==dateStr(new Date())){
    const when=new Date(s.start).toLocaleString();
    if(confirm(`⏱ A timer for "${a.task.text}" has been running since ${when} (${fmtDuration(Date.now()-s.start)}).\n\nThat looks left over from an earlier session.\n\nOK = stop it now   ·   Cancel = keep running`))
      toggleTimer(a.catId,a.i);
  }
}
function tick(){
  const active=findActiveSession();
  if(!active){clearInterval(timerInterval);timerInterval=null;updateGlobalBadge();return;}
  const s=active.task.sessions.find(s=>!s.end);
  if(!s)return;
  const elapsed=Date.now()-s.start;
  const el=document.getElementById('el-'+active.task.id);
  if(el)el.textContent=fmtElapsed(elapsed);
  updateGlobalBadge();
  const maxMs=(settings.maxTimerHours||4)*3600000;
  if(elapsed>maxMs && !warnedSessions.has(s.start)){
    warnedSessions.add(s.start);
    if(confirm(`⏱ "${active.task.text}" has been timing for ${fmtDuration(elapsed)}.\n\nDid you forget to stop it?\n\nOK = stop it now   ·   Cancel = keep running`))
      toggleTimer(active.catId,active.i);
  }
}

function updateGlobalBadge(){
  const badge=document.getElementById('globalTimer');
  const active=findActiveSession();
  if(!active){badge.style.display='none';return;}
  const s=active.task.sessions.find(s=>!s.end);
  const elapsed=s?Date.now()-s.start:0;
  document.getElementById('gtTime').textContent=fmtElapsed(elapsed);
  document.getElementById('gtName').textContent=active.task.text;
  badge.style.display='flex';
}

function renameTaskPrompt(catId,i,msg){
  const t=tasks[catId]&&tasks[catId][i];
  if(!t)return;
  const name=prompt(msg||'Rename this task:',t.text);
  if(name===null)return;
  const v=name.trim();
  if(v&&v!==t.text){t.text=v;saveTasks();render();updateGlobalBadge();}
}
function renameActiveTask(e){
  if(e)e.stopPropagation();
  const active=findActiveSession();
  if(!active)return;
  renameTaskPrompt(active.catId,active.i);
}
function goToActiveTask(){
  const active=findActiveSession();
  if(!active)return;
  switchTab(active.catId);
  setTimeout(()=>{
    const el=document.getElementById('task-'+active.task.id);
    if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
  },120);
}

// ── Time log modal (editable) ─────────────────────────────────────────────────
let logCatId=null,logIdx=null;
function openTimeLog(catId,i){
  logCatId=catId;logIdx=i;
  const t=tasks[catId][i];
  document.getElementById('timeLogTask').textContent=t.text;
  renderSessionEditor(t.sessions||[]);
  document.getElementById('timeLogModal').classList.add('open');
}
function closeTimeLog(){
  document.getElementById('timeLogModal').classList.remove('open');
  logCatId=null;logIdx=null;
}
function minsOfDay(ts){const d=new Date(ts);return d.getHours()*60+d.getMinutes();}
function fmtClock(mins){
  mins=((mins%1440)+1440)%1440;
  const h=Math.floor(mins/60), m=mins%60;
  if((settings.timeFormat||'12h')==='24h') return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  const ap=h<12?'AM':'PM'; let hh=h%12; if(hh===0)hh=12;
  return hh+':'+String(m).padStart(2,'0')+' '+ap;
}
function parseClock(str){
  str=String(str).trim().toLowerCase();
  if(!str)return null;
  let ap=null;
  if(/p\.?m\.?/.test(str))ap='pm'; else if(/a\.?m\.?/.test(str))ap='am';
  str=str.replace(/[ap]\.?m\.?/g,'').trim();
  const m=str.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if(!m)return null;
  let h=parseInt(m[1],10), mm=m[2]!=null?parseInt(m[2],10):0;
  if(mm>59)return null;
  if(ap){ if(h<1||h>12)return null; if(ap==='pm'&&h!==12)h+=12; if(ap==='am'&&h===12)h=0; }
  else if(h>23)return null;
  return h*60+mm;
}
function sessionRowHtml(s){
  const start=s.start, end=s.end||Date.now();
  const live=!s.end?'<span class="sess-live">● live</span>':'';
  return `<div class="sess-edit-row">
    <input type="date" class="mini-input" data-f="date" value="${dateStr(new Date(start))}">
    <input type="text" class="mini-input sess-time" data-f="start" value="${fmtClock(minsOfDay(start))}" autocomplete="off">
    <span class="sess-arrow">→</span>
    <input type="text" class="mini-input sess-time" data-f="end" value="${fmtClock(minsOfDay(end))}" autocomplete="off">
    <span class="sess-dur" data-f="dur"></span>
    ${live}
    <button class="sess-del" onclick="this.closest('.sess-edit-row').remove();updateLogTotal()">🗑</button>
    <input type="text" class="mini-input sess-note" data-f="note" placeholder="What did you do? (optional)" value="${esc(s.note||'')}" autocomplete="off">
  </div>`;
}
function renderSessionEditor(sessions){
  const el=document.getElementById('sessionsList');
  el.innerHTML=sessions.length
    ? sessions.map(sessionRowHtml).join('')
    : '<div style="color:var(--muted);font-size:14px;">No sessions yet — add one below.</div>';
  el.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',updateLogTotal));
  updateLogTotal();
}
function addManualSession(){
  const el=document.getElementById('sessionsList');
  if(!el.querySelector('.sess-edit-row'))el.innerHTML='';
  const now=new Date();
  const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),now.getHours(),now.getMinutes());
  const end=new Date(start.getTime()+30*60000);
  const div=document.createElement('div');
  div.className='sess-edit-row';
  div.innerHTML=`
    <input type="date" class="mini-input" data-f="date" value="${dateStr(start)}">
    <input type="text" class="mini-input sess-time" data-f="start" value="${fmtClock(minsOfDay(start.getTime()))}" autocomplete="off">
    <span class="sess-arrow">→</span>
    <input type="text" class="mini-input sess-time" data-f="end" value="${fmtClock(minsOfDay(end.getTime()))}" autocomplete="off">
    <span class="sess-dur" data-f="dur"></span>
    <button class="sess-del" onclick="this.closest('.sess-edit-row').remove();updateLogTotal()">🗑</button>
    <input type="text" class="mini-input sess-note" data-f="note" placeholder="What did you do? (optional)" autocomplete="off">`;
  el.appendChild(div);
  div.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',updateLogTotal));
  updateLogTotal();
}
function sessMs(date,st,en){
  const sm=parseClock(st), em=parseClock(en);
  if(sm==null||em==null)return null;
  const base=new Date(date+'T00:00:00').getTime();
  if(isNaN(base))return null;
  let s=base+sm*60000, e=base+em*60000;
  if(e<s)e+=86400000;   // end before start = past midnight; same minute = 0m (was wrongly 24h)
  return {start:s,end:e};
}
function collectSessions(){
  return [...document.querySelectorAll('#sessionsList .sess-edit-row')].map(row=>{
    const date=row.querySelector('[data-f="date"]').value||dateStr(new Date());
    const st=row.querySelector('[data-f="start"]').value||'';
    const en=row.querySelector('[data-f="end"]').value||'';
    const noteEl=row.querySelector('[data-f="note"]');
    const note=noteEl?noteEl.value.trim():'';
    const r=sessMs(date,st,en);
    if(r&&note)r.note=note;
    return r;
  }).filter(x=>x&&x.end>=x.start);
}
function updateLogTotal(){
  let total=0;
  document.querySelectorAll('#sessionsList .sess-edit-row').forEach(row=>{
    const date=row.querySelector('[data-f="date"]').value;
    const st=row.querySelector('[data-f="start"]').value;
    const en=row.querySelector('[data-f="end"]').value;
    const r=(date&&st&&en)?sessMs(date,st,en):null;
    const ms=r?(r.end-r.start):0; total+=ms;
    const d=row.querySelector('[data-f="dur"]'); if(d)d.textContent=fmtDuration(ms);
  });
  document.getElementById('timeLogTotal').textContent='Total: '+fmtDuration(total);
}
function saveTimeLog(){
  if(logCatId===null)return;
  tasks[logCatId][logIdx].sessions=collectSessions();
  saveTasks(); closeTimeLog(); checkTimer(); render();
}

// ── Daily plan (printable) ────────────────────────────────────────────────────
function openPlan(){ navigate('/plan'); }
function closePlan(){ navigate(lastTaskPath); }
function printPlan(){ window.print(); }
function planItemHtml(x){
  const t=x.t;
  const parts=[];
  if(t.priority)parts.push(`<span class="${t.priority===1?'plan-p1':''}">P${t.priority}</span>`);
  if(t.jiraNumber)parts.push(esc((settings.jiraPrefix||'CTI-')+t.jiraNumber));
  if(t.caseNumber)parts.push(esc((settings.casePrefix||'Case-')+t.caseNumber));
  if(x.catLabel)parts.push(esc(x.catLabel));
  if(x.showDue&&t.dueDate)parts.push('📅 '+esc(fmtDate(t.dueDate)));
  const tags=parts.length?`<span class="plan-tags">${parts.join(' · ')}</span>`:'';
  return `<div class="plan-item ${x.sub?'sub':''}">
    <div class="plan-box"></div>
    <div class="plan-txt">${esc(t.text)}${tags}</div>
  </div>`;
}
function renderDailyPlan(){
  const today=dateStr(new Date());
  const todayD=new Date(today+'T00:00:00');
  const diff=ds=>Math.round((new Date(ds+'T00:00:00')-todayD)/86400000);
  const overdue=[],dueToday=[],upcoming=[],p1NoDue=[],otherNoDue=[];
  cats.forEach(c=>(tasks[c.id]||[]).forEach(t=>{
    if(t.done)return;
    const sub=!!t.parentId;
    const e={t,catLabel:c.label,sub};
    if(t.dueDate){
      const d=diff(t.dueDate);
      if(d<0){e.showDue=true;overdue.push(e);}
      else if(d===0)dueToday.push(e);
      else if(d<=7){e.showDue=true;upcoming.push(e);}
    } else if(t.priority===1){ p1NoDue.push(e); }
    else { otherNoDue.push(e); }
  }));
  const byPri=(a,b)=>((a.t.priority||9)-(b.t.priority||9))||a.catLabel.localeCompare(b.catLabel);
  const byDate=(a,b)=>String(a.t.dueDate).localeCompare(String(b.t.dueDate))||byPri(a,b);
  overdue.sort(byDate); upcoming.sort(byDate);
  dueToday.sort(byPri); p1NoDue.sort(byPri); otherNoDue.sort(byPri);

  const dstr=new Date().toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('planDateLbl').textContent=dstr;
  document.getElementById('planPrintDate').textContent=dstr;

  const section=(label,arr)=>arr.length
    ?`<div class="plan-sec">${label} <span style="font-weight:500;opacity:.7">(${arr.length})</span></div>`+arr.map(planItemHtml).join('')
    :'';
  let html='';
  html+=section('⚠ Overdue',overdue);
  html+=section('📅 Due today',dueToday);
  if(upcoming.length){
    html+=`<div class="plan-sec">🔜 Upcoming — next 7 days <span style="font-weight:500;opacity:.7">(${upcoming.length})</span></div>`;
    let lastDay=null;
    upcoming.forEach(x=>{
      if(x.t.dueDate!==lastDay){ lastDay=x.t.dueDate; html+=`<div class="plan-day">${weekdayLabel(lastDay)}</div>`; }
      html+=planItemHtml(x);
    });
  }
  html+=section('🔥 Top priority — no due date',p1NoDue);
  html+=section('📋 Other open — no due date',otherNoDue);
  if(!html)html='<div class="plan-empty">Nothing to plan — you\'re all caught up. 🎉</div>';
  document.getElementById('planBody').innerHTML=html;
}

// ── Daily report (for Tempo) ──────────────────────────────────────────────────
function openReport(){ navigate('/report'); }
function closeReport(){ navigate(lastTaskPath); }
function setRepRange(r){
  document.getElementById('repRange').value=r;
  document.getElementById('repRangeDay').classList.toggle('active',r==='day');
  document.getElementById('repRangeWeek').classList.toggle('active',r==='week');
  renderReport();
}

function repRange(){ const s=document.getElementById('repRange'); return s?s.value:'day'; }
function roundMs(ms){
  const s=document.getElementById('repRound');
  const r=s?parseInt(s.value,10):0;
  if(!r)return ms;
  const step=r*60000;
  return Math.round(ms/step)*step;
}
function reportDays(){
  const day=document.getElementById('repDate').value||dateStr(new Date());
  if(repRange()!=='week') return {days:[day],label:fmtDate(day),range:'day'};
  const d=new Date(day+'T00:00:00');
  const dow=(d.getDay()+6)%7;                 // 0 = Monday
  const mon=new Date(d); mon.setDate(d.getDate()-dow);
  const days=[];
  for(let k=0;k<7;k++){ const x=new Date(mon); x.setDate(mon.getDate()+k); days.push(dateStr(x)); }
  return {days, label:fmtDate(days[0])+' → '+fmtDate(days[6]), range:'week'};
}
function reportRows(days){
  const set=new Set(days), rows=[];
  cats.forEach(c=>(tasks[c.id]||[]).forEach(t=>{
    let ms=0; const segs=[];
    (t.sessions||[]).forEach(sess=>{
      const ds=dateStr(new Date(sess.start));
      if(set.has(ds)){
        const e=sess.end||Date.now();
        segs.push({start:sess.start,end:e,day:ds,note:sess.note||''});
        ms+=e-sess.start;
      }
    });
    if(ms>0){
      segs.sort((x,y)=>x.start-y.start);
      const jira=t.jiraNumber?((settings.jiraPrefix||'CTI-')+t.jiraNumber):'';
      const cas=t.caseNumber?((settings.casePrefix||'Case-')+t.caseNumber):'';
      const par=t.parentId?(tasks[c.id]||[]).find(x=>x.id===t.parentId):null;
      const label=par?(par.text+' › '+t.text):t.text;
      rows.push({cat:c.label,color:c.color,jira,cas,text:label,ms,segs});
    }
  }));
  return rows;
}
function renderReport(){
  const info=reportDays();
  const rows=reportRows(info.days);
  const el=document.getElementById('repBody');
  if(!rows.length){el.innerHTML=`<div class="rep-empty">No time logged in this ${info.range}.</div>`;return;}
  const byRef={};
  rows.forEach(r=>{ const k=r.jira||r.cas||'(no ticket)'; byRef[k]=(byRef[k]||0)+r.ms; });
  let total=0;
  let html=`<div class="rep-sec">${info.range==='week'?'Week: '+info.label+' — ':''}By ticket → for Tempo</div>`
    +'<table class="rep-table"><thead><tr><th>Ticket</th><th style="text-align:right">Hours</th><th style="text-align:right">H:MM</th></tr></thead><tbody>';
  Object.keys(byRef).sort().forEach(k=>{
    const ms=roundMs(byRef[k]); total+=ms;
    html+=`<tr><td class="rep-ref">${esc(k)}</td><td class="num">${decHours(ms)}</td><td class="num">${fmtDuration(ms)}</td></tr>`;
  });
  html+='</tbody></table>';
  if(info.range==='week'){
    const byDay={};
    rows.forEach(r=>r.segs.forEach(sg=>{byDay[sg.day]=(byDay[sg.day]||0)+(sg.end-sg.start);}));
    html+='<div class="rep-sec">By day</div>'
      +'<table class="rep-table"><thead><tr><th>Day</th><th style="text-align:right">Hours</th><th style="text-align:right">H:MM</th></tr></thead><tbody>';
    info.days.forEach(d=>{ if(byDay[d]>0){ const ms=roundMs(byDay[d]);
      html+=`<tr><td>${weekdayLabel(d)}</td><td class="num">${decHours(ms)}</td><td class="num">${fmtDuration(ms)}</td></tr>`; } });
    html+='</tbody></table>';
  }
  html+='<div class="rep-sec">Task detail</div>'
    +'<table class="rep-table"><thead><tr><th>Task</th><th style="text-align:right">Hours</th><th style="text-align:right">H:MM</th></tr></thead><tbody>';
  rows.forEach(r=>{
    const ms=roundMs(r.ms);
    const ref=(r.jira||r.cas)?`<span class="rep-ref">${esc(r.jira||r.cas)}</span> `:'';
    const segs=(info.range==='day')
      ?r.segs.map(sg=>`<div class="rep-seg">${fmtClock(minsOfDay(sg.start))} → ${fmtClock(minsOfDay(sg.end))} · ${fmtDuration(sg.end-sg.start)}${sg.note?` — <span class="rep-note">${esc(sg.note)}</span>`:''}</div>`).join('')
      :'';
    const notes=[...new Set(r.segs.map(s=>s.note).filter(Boolean))];
    const notesHtml=(info.range==='week'&&notes.length)?`<div class="rep-seg">📝 <span class="rep-note">${notes.map(esc).join(' · ')}</span></div>`:'';
    html+=`<tr><td><span class="rep-dot" style="background:${r.color}"></span>${ref}${esc(r.text)}
      <span style="color:var(--muted);font-size:11px;">· ${esc(r.cat)}</span>${segs}${notesHtml}</td>
      <td class="num">${decHours(ms)}</td><td class="num">${fmtDuration(ms)}</td></tr>`;
  });
  html+=`</tbody></table><div class="rep-grand">${info.range==='week'?'Week':'Day'} total: ${decHours(total)}h · ${fmtDuration(total)}</div>`;
  el.innerHTML=html;
}
function copyReport(){
  const info=reportDays();
  const rows=reportRows(info.days);
  if(!rows.length){toast('Nothing to copy for this '+info.range+'.');return;}
  const byRef={};
  rows.forEach(r=>{const k=r.jira||r.cas||'(no ticket)';byRef[k]=(byRef[k]||0)+r.ms;});
  let total=0;
  let out=`Time log — ${info.label}\n\nBy ticket (for Tempo):\n`;
  Object.keys(byRef).sort().forEach(k=>{const ms=roundMs(byRef[k]);total+=ms;out+=`${k}\t${decHours(ms)}h\t${fmtDuration(ms)}\n`;});
  if(info.range==='week'){
    const byDay={};
    rows.forEach(r=>r.segs.forEach(sg=>{byDay[sg.day]=(byDay[sg.day]||0)+(sg.end-sg.start);}));
    out+=`\nBy day:\n`;
    info.days.forEach(d=>{ if(byDay[d]>0){const ms=roundMs(byDay[d]);out+=`${d}\t${decHours(ms)}h\t${fmtDuration(ms)}\n`;} });
  }
  out+=`\nTask detail:\n`;
  rows.forEach(r=>{
    const ms=roundMs(r.ms);
    const ref=(r.jira||r.cas)?(r.jira||r.cas)+' ':'';
    out+=`${ref}${r.text}\t${decHours(ms)}h\t${fmtDuration(ms)}\t[${r.cat}]\n`;
    if(info.range==='day')
      r.segs.forEach(sg=>{out+=`    ${fmtClock(minsOfDay(sg.start))} → ${fmtClock(minsOfDay(sg.end))}\t${fmtDuration(sg.end-sg.start)}${sg.note?'\t'+sg.note:''}\n`;});
    else {
      const notes=[...new Set(r.segs.map(s=>s.note).filter(Boolean))];
      if(notes.length)out+=`    📝 ${notes.join(' · ')}\n`;
    }
  });
  out+=`\n${info.range==='week'?'Week':'Day'} total\t${decHours(total)}h\t${fmtDuration(total)}\n`;
  (navigator.clipboard?navigator.clipboard.writeText(out):Promise.reject())
    .then(()=>toast('Copied — paste into Tempo or a spreadsheet.'))
    .catch(()=>prompt('Copy the report below:',out));
}
function weekdayLabel(ds){ return new Date(ds+'T00:00:00').toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'}); }

// ── Actions ───────────────────────────────────────────────────────────────────
function switchTab(id){ navigate(tabPath(id)); }

function addTask(text){
  const catId=targetCatId();
  if(!catId){toast('Create a category first (Settings → Categories).');return;}
  const ti=document.getElementById('ti');
  const val=(text!==undefined?text:ti.value).trim();
  if(!val){ti.focus();return;}
  const jn=document.getElementById('jiraInput').value.trim();
  const cn=document.getElementById('caseInput').value.trim();
  const t={id:'t'+Date.now(),text:val,done:false,createdAt:Date.now()};
  if(addDate)t.dueDate=addDate;
  if(selPri)t.priority=selPri;
  if(jn)t.jiraNumber=jn;
  if(cn)t.caseNumber=cn;
  if(!tasks[catId])tasks[catId]=[];
  tasks[catId].unshift(t);
  saveTasks();
  if(catId!==activeTab){ const c=cats.find(x=>x.id===catId); toast('Added to '+(c?c.label:'category')+'.'); }
  if(text===undefined){
    ti.value='';
    document.getElementById('jiraInput').value='';
    document.getElementById('caseInput').value='';
  }
  render();
}

function startRename(catId,i){
  const t=tasks[catId]&&tasks[catId][i];
  if(!t)return;
  const lbl=document.querySelector('#task-'+t.id+' .task-lbl');
  if(!lbl||lbl.querySelector('input'))return;
  const input=document.createElement('input');
  input.type='text';input.className='rename-input';input.value=t.text;
  lbl.textContent='';lbl.appendChild(input);
  input.focus();input.select();
  let closed=false;
  const finish=(save)=>{
    if(closed)return;closed=true;
    const v=input.value.trim();
    if(save&&v&&v!==t.text){t.text=v;saveTasks();}
    render();updateGlobalBadge();
  };
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();finish(true);}
    else if(e.key==='Escape'){e.preventDefault();finish(false);}
  });
  input.addEventListener('blur',()=>finish(true));
}
function toggle(catId,i){
  const t=tasks[catId][i];
  t.done=!t.done;
  if(t.done)t.doneAt=Date.now(); else delete t.doneAt;
  saveTasks();render();
}
function del(catId,i){
  const t=tasks[catId][i];
  const kids=t?tasks[catId].filter(x=>x.parentId===t.id):[];
  if(kids.length){
    if(!confirm('Delete "'+t.text+'" and its '+kids.length+' subtask'+(kids.length>1?'s':'')+'?'))return;
    tasks[catId]=tasks[catId].filter((x,j)=>j!==i&&x.parentId!==t.id);
  } else {
    tasks[catId].splice(1*i,1);
  }
  saveTasks();render();
}
function clearDone(){
  if(activeTab==='all'||activeTab==='focus')cats.forEach(c=>{tasks[c.id]=(tasks[c.id]||[]).filter(t=>!t.done);});
  else tasks[activeTab]=(tasks[activeTab]||[]).filter(t=>!t.done);
  saveTasks();render();
}
function togglePresets(){
  if(!targetCatId())return;
  presetsOpen=!presetsOpen;
  document.getElementById('presetsWrap').classList.toggle('open',presetsOpen);
  document.getElementById('presetArr').textContent=presetsOpen?'▾':'▸';
}
function setPri(p){
  selPri=(selPri===p)?null:p;
  [1,2,3,4].forEach(n=>{document.getElementById('priBtn'+n).className='pri-btn'+(selPri===n?' sel-p'+n:'');});
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function openCalAdd(){
  calMode='add';
  const today=new Date();
  calYear=today.getFullYear();calMonth=today.getMonth();
  if(!addDate){
    const y=today.getFullYear(),m=String(today.getMonth()+1).padStart(2,'0'),d=String(today.getDate()).padStart(2,'0');
    addDate=`${y}-${m}-${d}`;updateDateBtn();
  } else {
    const p=addDate.split('-');calYear=+p[0];calMonth=+p[1]-1;
  }
  renderCalGrid();document.getElementById('calOverlay').classList.add('open');
}
function openCalEdit(catId,i){
  calMode={catId,i};
  const today=new Date();calYear=today.getFullYear();calMonth=today.getMonth();
  const t=tasks[catId][i];
  if(t.dueDate){const p=t.dueDate.split('-');calYear=+p[0];calMonth=+p[1]-1;}
  renderCalGrid();document.getElementById('calOverlay').classList.add('open');
}
function closeCal(){document.getElementById('calOverlay').classList.remove('open');}
function calNav(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  renderCalGrid();
}
function renderCalGrid(){
  document.getElementById('calMonthLbl').textContent=`${MONTHS[calMonth]} ${calYear}`;
  const today=new Date();today.setHours(0,0,0,0);
  const firstDow=new Date(calYear,calMonth,1).getDay();
  const days=new Date(calYear,calMonth+1,0).getDate();
  const offset=firstDow===0?6:firstDow-1;
  let curSel=calMode==='add'?addDate:(tasks[calMode.catId][calMode.i].dueDate||null);
  let html=['Mo','Tu','We','Th','Fr','Sa','Su'].map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<offset;i++)html+=`<div class="cal-day empty"></div>`;
  for(let d=1;d<=days;d++){
    const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dd=new Date(calYear,calMonth,d);
    const isTod=+dd===+today,isSel=ds===curSel,isPast=dd<today&&!isTod;
    let cls='cal-day';
    if(isSel)cls+=' selected';else if(isTod)cls+=' today';
    if(isPast&&!isSel)cls+=' past-day';
    const dot=isTod&&!isSel?'<div class="cal-today-dot"></div>':'';
    html+=`<div class="${cls}" onclick="calPickDate('${ds}')">${d}${dot}</div>`;
  }
  document.getElementById('calGrid').innerHTML=html;
}
function calPickDate(ds){
  if(calMode==='add'){addDate=ds;updateDateBtn();}
  else{tasks[calMode.catId][calMode.i].dueDate=ds;saveTasks();render();}
  closeCal();
}
function setCalToday(){
  const t=new Date();
  calPickDate(`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`);
}
function calClearDate(){
  if(calMode==='add'){addDate=null;updateDateBtn();}
  else{tasks[calMode.catId][calMode.i].dueDate=null;saveTasks();render();}
  closeCal();
}
function updateDateBtn(){
  const btn=document.getElementById('dateBtnEl'),x=document.getElementById('dateXBtn');
  if(!addDate){
    document.getElementById('dateBtnLbl').textContent='Due date';
    btn.classList.remove('has-date');x.style.display='none';return;
  }
  const today=new Date();today.setHours(0,0,0,0);
  const due=new Date(addDate+'T00:00:00');
  const diff=Math.round((due-today)/86400000);
  const lbl=diff<0?`Overdue · ${fmtDate(addDate)}`:diff===0?'Today':diff===1?'Tomorrow':fmtDate(addDate);
  document.getElementById('dateBtnLbl').textContent=lbl;
  btn.classList.add('has-date');x.style.display='';
}
function clearAddDate(){addDate=null;updateDateBtn();}

// ── Backup: export / import ───────────────────────────────────────────────────
function exportData(){
  const data={ app:'nilusDO', version:1, exportedAt:new Date().toISOString(), cats, tasks, settings };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='nilusDO-backup-'+dateStr(new Date())+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function importData(e){
  const file=e.target.files&&e.target.files[0];
  e.target.value='';
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    let data;
    try{ data=JSON.parse(reader.result); }
    catch(err){ toast('Could not read that file: '+err.message); return; }
    if(!data||!Array.isArray(data.cats)||typeof data.tasks!=='object'){
      toast("That doesn't look like a nilusDO backup file."); return;
    }
    const when=data.exportedAt?new Date(data.exportedAt).toLocaleString():'unknown date';
    if(!confirm('Restore backup from '+when+'?\n\nThis REPLACES all current tasks, categories and settings on this account. Consider exporting a backup of the current state first.')) return;
    cats=data.cats;
    tasks=data.tasks||{};
    if(data.settings) settings={...settings,...data.settings};
    cats.forEach(c=>{if(!tasks[c.id])tasks[c.id]=[];});
    normalizeSessions();
    saveCats(); saveTasks(); saveSettingsRemote(); saveLocal();
    applySettings(); checkTimer(); render();
    toast('Backup restored.');
    navigate('/');
  };
  reader.readAsText(file);
}

// ── Category management ───────────────────────────────────────────────────────
function openMgmt(){ navigate('/settings'); }
function closeMgmt(){ navigate(lastTaskPath); }
function renderCatList(){
  document.getElementById('catListEl').innerHTML=cats.map((c,i)=>{
    const n=(tasks[c.id]||[]).length;
    const up=i>0?`<button class="cat-li-move" onclick="moveCat('${c.id}',-1)" title="Move up">▲</button>`:`<span class="cat-li-move" style="opacity:.25">▲</span>`;
    const dn=i<cats.length-1?`<button class="cat-li-move" onclick="moveCat('${c.id}',1)" title="Move down">▼</button>`:`<span class="cat-li-move" style="opacity:.25">▼</span>`;
    const ar=(settings.autoRenameCats||[]).includes(c.id);
    const arBtn=`<button class="cat-li-move" onclick="toggleAutoRename('${c.id}')" title="${ar?'On: ask to rename when a timer in this category stops':'Off: tap to ask for a name when a timer stops (great for meetings)'}" style="width:auto;padding:0 6px;font-size:13px;opacity:${ar?1:.3}">✏️</button>`;
    return `<li class="cat-li">
      <div class="cat-li-dot" style="background:${c.color}"></div>
      <span class="cat-li-name">${esc(c.label)}</span>
      <span class="cat-li-count">${n} task${n!==1?'s':''}</span>
      ${arBtn}${up}${dn}
      <button class="cat-li-del" onclick="deleteCat('${c.id}')" title="Delete category" aria-label="Delete category">✕</button>
    </li>`;
  }).join('');
}
function renderSwatches(){
  document.getElementById('swatchEl').innerHTML=COLORS.map(c=>
    `<div class="swatch ${c===selColor?'sel':''}" style="background:${c}" onclick="pickColor('${c}')"></div>`
  ).join('');
}
function pickColor(c){selColor=c;renderSwatches();}
function addCategory(){
  const name=document.getElementById('newCatName').value.trim();
  if(!name){toast('Enter a name.');return;}
  const id='cat_'+Date.now();
  cats.push({id,label:name,color:selColor,presets:[],order:cats.length});
  tasks[id]=[];saveCats();saveTasks();
  document.getElementById('newCatName').value='';renderCatList();renderSwatches();render();
}
function toggleAutoRename(id){
  const list=settings.autoRenameCats||(settings.autoRenameCats=[]);
  const i=list.indexOf(id);
  if(i>=0)list.splice(i,1); else list.push(id);
  saveSettingsRemote();renderCatList();
}
function deleteCat(id){
  const cat=cats.find(c=>c.id===id),n=(tasks[id]||[]).length;
  if(!confirm(n?`Delete "${cat.label}"? It has ${n} tasks. All data will be lost.`:`Delete "${cat.label}"?`))return;
  cats=cats.filter(c=>c.id!==id);delete tasks[id];
  if(addTarget===id)addTarget=null;
  saveCats();saveTasks();renderCatList();render();
}

// ── Scrum quick-actions ───────────────────────────────────────────────────────
function scrumCat(){
  if(settings.scrumCategoryId){ const c=cats.find(x=>x.id===settings.scrumCategoryId); if(c)return c; }
  return cats.find(c=>/scrum/i.test(c.label))||null;
}
function renderScrumBar(){
  const el=document.getElementById('scrumBar');
  const cat=scrumCat();
  const acts=settings.scrumActivities||DEFAULT_SCRUM;
  if(!cat||!acts.length){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='flex';
  el.innerHTML=acts.map(a=>{
    const safe=String(a).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    return `<button class="scrum-btn" onclick="startScrumActivity('${safe}')"><span class="s-ico">▶</span>${esc(a)}</button>`;
  }).join('');
}
function startScrumActivity(name){
  const cat=scrumCat();
  if(!cat){ toast('No Scrum category found. Create a category named "Scrum", or pick one in Settings → Scrum quick-actions.'); return; }
  // stop any running timer first (one active timer at a time)
  const cur=findActiveSession();
  if(cur){ tasks[cur.catId][cur.i].sessions=tasks[cur.catId][cur.i].sessions.map(s=>s.end?s:{...s,end:Date.now()}); }
  const t={id:'t'+Date.now(),text:name,done:false,createdAt:Date.now(),sessions:[{start:Date.now(),end:null}]};
  if(!tasks[cat.id])tasks[cat.id]=[];
  tasks[cat.id].unshift(t);
  saveTasks(); checkTimer();
  if(currentView==='tasks'&&activeTab===cat.id) render(); else switchTab(cat.id);
}
function renderScrumSettings(){
  const sel=document.getElementById('scrumCatSel');
  if(sel){
    sel.innerHTML='<option value="">(auto: category named Scrum)</option>'+
      cats.map(c=>`<option value="${c.id}" ${settings.scrumCategoryId===c.id?'selected':''}>${esc(c.label)}</option>`).join('');
  }
  const list=document.getElementById('scrumActList');
  const acts=settings.scrumActivities||DEFAULT_SCRUM;
  if(list){
    list.innerHTML=acts.length
      ? acts.map((a,i)=>`<li class="cat-li"><span class="cat-li-name">${esc(a)}</span><button class="cat-li-del" onclick="removeScrumActivity(${i})" aria-label="Remove">✕</button></li>`).join('')
      : '<li class="muted" style="padding:8px 0">No activities.</li>';
  }
}
function setScrumCategory(){
  settings.scrumCategoryId=document.getElementById('scrumCatSel').value||'';
  saveSettingsRemote(); render();
}
function addScrumActivity(){
  const inp=document.getElementById('newScrumAct');
  const v=inp.value.trim(); if(!v)return;
  const acts=(settings.scrumActivities||DEFAULT_SCRUM).slice();
  acts.push(v); settings.scrumActivities=acts;
  inp.value=''; saveSettingsRemote(); renderScrumSettings(); render();
}
function removeScrumActivity(i){
  const acts=(settings.scrumActivities||DEFAULT_SCRUM).slice();
  acts.splice(i,1); settings.scrumActivities=acts;
  saveSettingsRemote(); renderScrumSettings(); render();
}
function moveCat(id,dir){
  const i=cats.findIndex(c=>c.id===id); const j=i+dir;
  if(i<0||j<0||j>=cats.length)return;
  const tmp=cats[i]; cats[i]=cats[j]; cats[j]=tmp;
  cats.forEach((c,k)=>c.order=k);
  saveCats(); renderCatList(); render();
}

// ── Voice ─────────────────────────────────────────────────────────────────────
function toggleVoice(){
  if(!targetCatId()){toast('Create a category first (Settings → Categories).');return;}
  const btn=document.getElementById('mic');
  if(recog){recog.stop();recog=null;btn.classList.remove('on');return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){toast('Voice works in Chrome and Safari.');return;}
  recog=new SR();recog.lang='en-US';recog.interimResults=false;
  recog.onresult=e=>{addTask(e.results[0][0].transcript);};
  recog.onend=()=>{btn.classList.remove('on');recog=null;};
  recog.onerror=()=>{btn.classList.remove('on');recog=null;};
  recog.start();btn.classList.add('on');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function getCat(){return cats.find(c=>c.id===activeTab);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(s){return new Date(s+'T00:00:00').toLocaleDateString('en',{month:'short',day:'numeric'});}
function dateStr(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function decHours(ms){return (ms/3600000).toFixed(2);}
function fmtCreated(ts){
  if(!ts)return 'today';
  const td=new Date();td.setHours(0,0,0,0);
  const yd=new Date(td);yd.setDate(td.getDate()-1);
  const dd=new Date(ts);dd.setHours(0,0,0,0);
  if(+dd===+td)return 'today';
  if(+dd===+yd)return 'yesterday';
  return new Date(ts).toLocaleDateString('en',{month:'short',day:'numeric'});
}
function fmtElapsed(ms){
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  if(h>0)return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function fmtDuration(ms){
  const m=Math.floor(ms/60000),h=Math.floor(m/60),rm=m%60;
  if(h>0)return `${h}h ${rm}m`;
  return m>0?`${m}m`:'<1m';
}
function getTotalMs(t){
  return (t.sessions||[]).reduce((sum,s)=>sum+(s.end?s.end-s.start:Date.now()-s.start),0);
}

// ── Icons (same set and style as nilusCap) ───────────────────────────────────
const ICONS={
  bolt:'M13 2L4 14h7l-1 8 9-12h-7z',
  list:'M9 6h12 M9 12h12 M9 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  calendar:'M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4',
  chart:'M4 20V11 M10 20V5 M16 20v-6 M3 20h18',
  settings:'M12 9a3 3 0 100 6 3 3 0 000-6z M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  logout:'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
  collapse:'M3 3h18v18H3z M9 3v18 M16 15l-3-3 3-3',
  expand:'M3 3h18v18H3z M9 3v18 M14 9l3 3-3 3',
  edit:'M12 20h9 M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  x:'M6 6l12 12 M18 6L6 18',
  subtask:'M5 4v8a3 3 0 003 3h11 M15 11l4 4-4 4',
  mic:'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z M5 11a7 7 0 0014 0 M12 18v3',
  copy:'M9 9h11v11H9z M5 15H4V4h11v1',
  print:'M6 9V3h12v6 M6 18H4a1 1 0 01-1-1v-6a2 2 0 012-2h14a2 2 0 012 2v6a1 1 0 01-1 1h-2 M6 14h12v7H6z',
  play:'M8 5v14l11-7z',
  stop:'M7 7h10v10H7z'
};
function icon(name,size,filled){
  const s=size||18;
  return `<svg class="icon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="${filled?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}
function hydrateIcons(root){
  (root||document).querySelectorAll('[data-icon]').forEach(el=>{ el.outerHTML=icon(el.dataset.icon); });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer=null;
function toast(msg){
  const r=document.getElementById('toastRegion'); if(!r)return;
  r.innerHTML=`<div class="toast"><span>${esc(msg)}</span></div>`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ r.innerHTML=''; },5000);
}

// ── Theme + sidebar preferences (per device) ─────────────────────────────────
const THEME_KEY='nilusdo.theme', SIDEBAR_KEY='nilusdo.sidebarCollapsed';
function getThemeMode(){ try{ const t=localStorage.getItem(THEME_KEY); if(t==='light'||t==='dark')return t; }catch{} return 'system'; }
function setThemeMode(mode){
  const el=document.documentElement;
  if(mode==='system')delete el.dataset.theme; else el.dataset.theme=mode;
  try{ mode==='system'?localStorage.removeItem(THEME_KEY):localStorage.setItem(THEME_KEY,mode); }catch{}
  document.querySelectorAll('#themeSeg button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
}
function applySidebarState(collapsed){
  document.getElementById('app').classList.toggle('sidebar-collapsed',collapsed);
  const b=document.getElementById('sidebarToggle');
  b.innerHTML=icon(collapsed?'expand':'collapse');
  const lbl=collapsed?'Expand sidebar':'Collapse sidebar'; b.title=lbl; b.setAttribute('aria-label',lbl);
}
function toggleSidebar(){
  const collapsed=!document.getElementById('app').classList.contains('sidebar-collapsed');
  try{ localStorage.setItem(SIDEBAR_KEY,collapsed?'1':'0'); }catch{}
  applySidebarState(collapsed);
}
function openMenu(){ document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').hidden=false; }
function closeMenu(){ document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').hidden=true; }

// ── Composer target ("Add to" on Focus / All) ────────────────────────────────
let addTarget=null;
function targetCatId(){
  if(activeTab!=='focus'&&activeTab!=='all') return getCat()?activeTab:null;
  if(addTarget&&cats.some(c=>c.id===addTarget)) return addTarget;
  return cats[0]?cats[0].id:null;
}
function setAddTarget(id){ addTarget=id; renderPresets(); updatePlusColor(); updateComposerPlaceholder(); }
function updateComposerPlaceholder(){
  const c=cats.find(x=>x.id===targetCatId());
  document.getElementById('ti').placeholder=c?('Add to '+c.label+'…'):'Create a category in Settings to add tasks';
}
function renderComposer(){
  const multi=activeTab==='focus'||activeTab==='all';
  const wrap=document.getElementById('addToWrap'), sel=document.getElementById('addToSel');
  wrap.hidden=!multi||!cats.length;
  if(multi){
    const cur=targetCatId();
    sel.innerHTML=cats.map(c=>`<option value="${c.id}" ${c.id===cur?'selected':''}>${esc(c.label)}</option>`).join('');
  }
  updateComposerPlaceholder();
}
function quickAdd(){
  if(currentView!=='tasks') navigate(lastTaskPath);
  closeMenu();
  setTimeout(()=>{ const ti=document.getElementById('ti'); ti.focus(); ti.scrollIntoView({block:'center',behavior:'smooth'}); },30);
}

// ── Router (real URLs like nilusCap: /login, /c/<category>, /plan …) ─────────
let currentView='tasks', lastTaskPath='/', loginReturnTo='/';
const PAGE_TITLES={plan:'Daily plan',report:'Time report',settings:'Settings'};
function catPath(id){ return '/c/'+encodeURIComponent(id); }
function tabPath(id){ return id==='focus'?'/':id==='all'?'/all':catPath(id); }
function navigate(path,replace){
  if(path!==location.pathname+location.search){
    history[replace?'replaceState':'pushState'](null,'',path);
  }
  route();
}
function parsePath(path){
  if(path==='/'||path==='/index.html'||path==='/tasks.html') return {view:'tasks',tab:'focus'};
  if(path==='/all') return {view:'tasks',tab:'all'};
  const m=path.match(/^\/c\/([^/]+)\/?$/);
  if(m) return {view:'tasks',tab:decodeURIComponent(m[1])};
  if(path==='/plan'||path==='/report'||path==='/settings') return {view:path.slice(1)};
  if(path==='/login'||path==='/forgot-password') return {view:path.slice(1)};
  return null;
}
function show(id,on){ document.getElementById(id).hidden=!on; }
function route(){
  const path=location.pathname;
  const r=parsePath(path);
  if(!r){ navigate('/',true); return; }
  const signedIn=authState==='in'||authState==='local';
  show('splash',authState==='loading');
  if(authState==='loading'){ show('loginPage',false); show('forgotPage',false); show('app',false); return; }

  if(r.view==='login'||r.view==='forgot-password'){
    if(signedIn){ const to=loginReturnTo; loginReturnTo='/'; navigate(to,true); return; }
    show('app',false); show('loginPage',r.view==='login'); show('forgotPage',r.view==='forgot-password');
    document.title='nilusDO';
    const target=document.getElementById(r.view==='login'?'loginEmail':'resetEmail');
    if(r.view==='forgot-password'){
      const le=document.getElementById('loginEmail').value; const re=document.getElementById('resetEmail');
      if(le&&!re.value)re.value=le;
      document.getElementById('resetErr').textContent=''; document.getElementById('resetOk').textContent='';
    }
    setTimeout(()=>target.focus(),0);
    return;
  }
  if(!signedIn){ loginReturnTo=path+location.search; navigate('/login',true); return; }

  show('loginPage',false); show('forgotPage',false); show('app',true);
  const prevTab=activeTab, prevView=currentView;
  currentView=r.view;
  document.body.className='view-'+r.view;
  ['tasks','plan','report','settings'].forEach(v=>show('view-'+v,v===r.view));
  if(r.view==='tasks'){
    activeTab=r.tab; lastTaskPath=path;
    if(prevTab!==activeTab||prevView!=='tasks'){
      presetsOpen=false;
      document.getElementById('presetsWrap').classList.remove('open');
      document.getElementById('presetArr').textContent='▸';
    }
  } else if(r.view==='report'){
    const d=document.getElementById('repDate'); if(!d.value)d.value=dateStr(new Date());
  } else if(r.view==='settings'){
    renderSwatches(); applySettings(); setThemeMode(getThemeMode());
  }
  closeMenu();
  if(prevView!==currentView||prevTab!==activeTab) document.querySelector('.content').scrollTop=0, window.scrollTo(0,0);
  render();
}
function updateTitle(){
  let t;
  if(currentView==='tasks'){
    if(activeTab==='focus')t='Focus'; else if(activeTab==='all')t='All tasks';
    else { const c=getCat(); t=c?c.label:''; }
  } else t=PAGE_TITLES[currentView]||'';
  const el=document.getElementById('pageTitle');
  const c=(currentView==='tasks')?getCat():null;
  el.innerHTML=(c?`<span class="nav-dot" style="background:${c.color};margin:0"></span>`:'')+esc(t);
  document.title=t?(t+' · nilusDO'):'nilusDO';
}

// Internal links (sidebar, auth pages) use the router instead of reloading
document.addEventListener('click',e=>{
  const a=e.target.closest('a[data-link]');
  if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  e.preventDefault(); navigate(a.getAttribute('href'));
});
window.addEventListener('popstate',route);
// Ctrl/⌘+Shift+Space = new task (same shortcut as nilusCap's quick capture); Esc closes dialogs/menu
window.addEventListener('keydown',e=>{
  if(e.code==='Space'&&e.shiftKey&&(e.metaKey||e.ctrlKey)&&authState!=='out'&&authState!=='loading'){ e.preventDefault(); quickAdd(); }
  if(e.key==='Escape'){
    if(document.getElementById('calOverlay').classList.contains('open'))closeCal();
    else if(document.getElementById('timeLogModal').classList.contains('open'))closeTimeLog();
    else closeMenu();
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('beforeunload',e=>{
  if(findActiveSession()){ e.preventDefault(); e.returnValue=''; }
});
hydrateIcons();
try{ applySidebarState(localStorage.getItem(SIDEBAR_KEY)==='1'); }catch{ applySidebarState(false); }
setThemeMode(getThemeMode());
route();
initFirebase();
