/* ============================================================
   GradTracker v1.6.0
   [1] Sidebar collapse toggle fixed
   [2] Collapsible area background removed
   [3] Sub-link alignment fixed in CSS
   [4] Add Course button baseline-aligned via toolbar-btn-group
   [5] Dashboard pathway summary card
   [6] 5 PA Act 158 pathways (PA Cyber structure)
   [7] Overview pathway cards use req-card style
   ============================================================ */
'use strict';

const STORAGE_KEY = 'gradtracker_data_v1';

const DEFAULT_BENCHMARKS = {
  keystone: {
    algebra:    { prof: 736,  adv: 748,  bb: 659  },
    literature: { prof: 1500, adv: 1547, bb: 1340 },
    biology:    { prof: 800,  adv: 841,  bb: 722  }
  },
  // Pathway 4 alternative assessments
  p4: { act: 21, asvab: 31, psat: 970, sat: 1010 }
};

let state = {
  student:      { name: '', gradYear: '', school: '' },
  years:        [],
  requirements: [],
  courses:      [],
  benchmarks:   JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)),
  // Pathway data
  keystoneScores:     [],  // [{id, subject, date, score, level}]
  p3Records:          [],  // [{id, description, type, date, verified}]
  p4Records:          [],  // [{id, name, type, date, score, notes}]
  p5Evidence:         [],  // [{id, name, type, date, score, section}] section='S1'|'S2'
  plannedEvents:      []   // [{id, label, date, projectedScore}]
};

function loadData() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ── Constants ─────────────────────────────────────────────────
const GRADES            = ['A','B','C','D','F','P','NP','W','I','AU'];
const COURSE_TYPES      = ['Standard','VC','BC','AC'];
const KEYSTONE_SUBJECTS = ['Algebra I', 'Literature', 'Biology'];
const KEYSTONE_KEYS     = ['algebra', 'literature', 'biology'];

const P4_TYPES = [
  { key:'act',         label:'ACT',                              threshold:21,   scoreLabel:'Composite Score' },
  { key:'workkeys',    label:'ACT WorkKeys NCRC (Gold)',          threshold:null, scoreLabel:'Level achieved'  },
  { key:'asvab',       label:'ASVAB AFQT',                       threshold:31,   scoreLabel:'Composite Score' },
  { key:'psat',        label:'PSAT/NMSQT',                       threshold:970,  scoreLabel:'Total Score'     },
  { key:'sat',         label:'SAT',                              threshold:1010, scoreLabel:'Total Score'     },
  { key:'ap',          label:'AP Exam (≥3 per area)',             threshold:3,    scoreLabel:'Score'           },
  { key:'ib',          label:'IB Exam (≥4 per area)',             threshold:4,    scoreLabel:'Score'           },
  { key:'concurrent',  label:'Concurrent Enrollment',             threshold:null, scoreLabel:'Grade'           },
  { key:'college4yr',  label:'4-Year College Acceptance',         threshold:null, scoreLabel:'Institution'     },
  { key:'apprentice',  label:'Pre-Apprenticeship Program',        threshold:null, scoreLabel:'Program Name'    }
];

const P5_S1_TYPES = [
  { key:'sat-subj',   label:'SAT Subject Test',      threshold:630,  scoreLabel:'Score' },
  { key:'workkeys-s', label:'ACT WorkKeys (Silver)',  threshold:null, scoreLabel:'Level' },
  { key:'ap-s1',      label:'AP Exam',                threshold:3,    scoreLabel:'Score' },
  { key:'ib-s1',      label:'IB Exam',                threshold:3,    scoreLabel:'Score' },
  { key:'concurrent-s1', label:'Concurrent Enrollment', threshold:null, scoreLabel:'Grade' },
  { key:'college2yr', label:'2-Year College Acceptance', threshold:null, scoreLabel:'Institution' },
  { key:'credential', label:'Industry-Recognized Credential', threshold:null, scoreLabel:'Credential Name' }
];

const P5_S2_TYPES = [
  { key:'keystone-s2',  label:'Keystone Proficient+',         threshold:null, scoreLabel:'Score' },
  { key:'service',      label:'Service-Learning Project',      threshold:null, scoreLabel:'Description' },
  { key:'internship',   label:'Internship / Externship / Co-op', threshold:null, scoreLabel:'Hours/Details' },
  { key:'ncaa',         label:'NCAA Division II Requirements',  threshold:null, scoreLabel:'Confirmation' },
  { key:'military',     label:'Military Enlistment / Employment Letter', threshold:null, scoreLabel:'Details' }
];

// ── Globals (before init to avoid TDZ) ───────────────────────
let courseReqFilter = '';
let _sidebarOpen    = { pathways: false, settings: false };
let _groupClickInProgress = false; // (#1) toggle fix

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
(function init() {
  checkMobileGate();
  window.addEventListener('resize', checkMobileGate);

  const saved = loadData();
  if (saved) {
    if (!saved.benchmarks) saved.benchmarks = JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
    else {
      // Deep merge — keep defaults for missing keys
      saved.benchmarks = JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
      if (loadData()?.benchmarks) Object.assign(saved.benchmarks, loadData().benchmarks);
    }
    if (!saved.keystoneScores) saved.keystoneScores = [];
    if (!saved.p3Records)      saved.p3Records      = [];
    if (!saved.p4Records)      saved.p4Records      = [];
    if (!saved.p5Evidence)     saved.p5Evidence     = [];
    if (!saved.plannedEvents)  saved.plannedEvents  = [];
    // Migrate old pathway fields
    if (saved.standardizedScores || saved.advancedCourses || saved.careerActivities) {
      // silently drop old fields — data is in new structure after this version
    }
    if (saved.student && !saved.student.school) saved.student.school = '';
    if (saved.years) saved.years = saved.years.map(y => ({ school:'', ...y }));
    if (saved.requirements) saved.requirements = saved.requirements.map(r => ({
      ...r, subReqs: (r.subReqs||[]).map(sr => ({ credits:0, ...sr }))
    }));
    Object.assign(state, saved);
  }

  setupNavigation();
  setupSettingsListeners();
  setupCoursesListeners();
  renderAll();
  renderBenchmarkInputs();
  registerSW();
  navigateTo('dashboard');
  if (!state.student.name && state.courses.length === 0) showOnboarding();
})();

function checkMobileGate() {
  const narrow = window.innerWidth < 900;
  document.getElementById('mobile-gate').style.display    = narrow ? 'flex' : 'none';
  document.getElementById('sidebar').style.display        = narrow ? 'none' : '';
  document.getElementById('main-content').style.display   = narrow ? 'none' : '';
}

// ══════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page  = link.dataset.page;
      const group = link.dataset.group;
      if (group) {
        // (#1) Group header: toggle collapse state; navigate to default page
        // Set flag so navigateTo's openGroup does NOT re-open the group we just toggled
        _groupClickInProgress = true;
        toggleGroup(group);
        _groupClickInProgress = false;
        if (page) navigateTo(page, null, true /* fromGroupHeader */);
      } else if (page) {
        navigateTo(page);
      }
    });
  });

  document.querySelectorAll('.inline-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      if (page) navigateTo(page);
    });
  });
}

// (#1) Toggle: flip open/closed
function toggleGroup(group) {
  _sidebarOpen[group] = !_sidebarOpen[group];
  applyGroupState(group);
}

// openGroup: only opens (used by navigateTo for child pages)
function openGroup(group) {
  if (_sidebarOpen[group]) return; // already open — don't interfere
  _sidebarOpen[group] = true;
  applyGroupState(group);
}

function applyGroupState(group) {
  document.getElementById(`sub-${group}`)?.classList.toggle('open', _sidebarOpen[group]);
  document.getElementById(`chevron-${group}`)?.classList.toggle('rotated', _sidebarOpen[group]);
}

function navigateTo(page, extraData, fromGroupHeader = false) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  document.getElementById('page-' + page)?.classList.add('active');

  const exactLink = document.querySelector(`.nav-link[data-page="${page}"]:not([data-group])`);
  if (exactLink) exactLink.classList.add('active');

  // Highlight group header + open group when navigating to a child page
  // BUT: if called from the group header click, don't call openGroup (toggle already handled it)
  if (page.startsWith('pathways-')) {
    document.querySelector('.nav-link[data-group="pathways"]')?.classList.add('active');
    if (!fromGroupHeader) openGroup('pathways');
  } else if (page.startsWith('settings-')) {
    document.querySelector('.nav-link[data-group="settings"]')?.classList.add('active');
    if (!fromGroupHeader) openGroup('settings');
  }

  if (page === 'courses' && extraData?.reqId !== undefined) courseReqFilter = extraData.reqId;

  const renders = {
    'dashboard':             renderDashboard,
    'courses':               renderCourses,
    'stats':                 renderStats,
    'pathways-overview':     renderPathwayOverview,
    'pathways-p1':           renderP1,
    'pathways-p2':           renderP2,
    'pathways-p3':           renderP3,
    'pathways-p4':           renderP4,
    'pathways-p5':           renderP5,
    'pathways-projection':   renderProjection,
    'settings-student':      renderSettingsStudent,
    'settings-requirements': renderSettingsRequirements,
    'settings-benchmarks':   () => {},
    'data-management':       () => {}
  };
  renders[page]?.();
}

function renderAll() {
  renderDashboard(); renderCourses(); renderStats();
  renderPathwayOverview(); renderP1(); renderP2(); renderP3(); renderP4(); renderP5();
  renderProjection(); renderSettingsStudent(); renderSettingsRequirements();
  updatePathwayNavDots();
}

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════
function uid()     { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fmtDate(d){ if(!d) return '—'; const p=d.split('-'); return `${p[1]}/${p[2]}/${p[0]}`; }
function today()   { return new Date().toISOString().slice(0,10); }
function esc(str)  { return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n)    { const v=Number(n); return isNaN(v)?'0':parseFloat(v.toFixed(2)).toString(); }

function getYear(id)    { return state.years.find(y=>y.id===id); }
function getYearName(id){ return getYear(id)?.name||'—'; }
function getReq(id)     { return state.requirements.find(r=>r.id===id); }
function getReqName(id) { return getReq(id)?.name||'Uncategorized'; }

function creditsEarnedForReq(reqId){ return state.courses.filter(c=>c.reqId===reqId&&!c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function creditsPlannedForReq(reqId){ return state.courses.filter(c=>c.reqId===reqId&&c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalEarned()   { return state.courses.filter(c=>!c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalPlanned()  { return state.courses.filter(c=> c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalRequired() { return state.requirements.reduce((s,r)=>s+Number(r.credits||0),0); }

function creditsByYear() {
  const map={};
  state.years.forEach(y=>{map[y.id]={earned:0,planned:0};});
  state.courses.forEach(c=>{
    if(!c.yearId) return;
    if(!map[c.yearId]) map[c.yearId]={earned:0,planned:0};
    c.planned?map[c.yearId].planned+=Number(c.credits||0):map[c.yearId].earned+=Number(c.credits||0);
  });
  return map;
}

function subReqStatus(req,sr) {
  const n=sr.name.trim().toLowerCase();
  const m=state.courses.filter(c=>c.reqId===req.id&&c.name.trim().toLowerCase()===n);
  if(m.some(c=>!c.planned)) return 'earned';
  if(m.some(c=> c.planned)) return 'planned';
  return null;
}

// ── Keystone helpers ──────────────────────────────────────────
function calcKeystoneLevel(subject, score) {
  const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(subject)];
  const bm=state.benchmarks.keystone[key];
  if(!bm) return 'Basic';
  if(score>=bm.adv)  return 'Advanced';
  if(score>=bm.prof) return 'Proficient';
  if(bm.bb && score<=bm.bb) return 'Below Basic';
  return 'Basic';
}

function getKeystoneSubjectData() {
  const bm=state.benchmarks.keystone;
  const subjects={algebra:{met:false,belowBasic:false,best:null},literature:{met:false,belowBasic:false,best:null},biology:{met:false,belowBasic:false,best:null}};
  state.keystoneScores.forEach(s=>{
    const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(s.subject)];
    if(!key) return;
    const b=bm[key];
    if(!subjects[key].best||s.score>subjects[key].best) subjects[key].best=s.score;
    if(s.score>=b.prof) subjects[key].met=true;
    if(b.bb&&s.score<=b.bb) subjects[key].belowBasic=true;
  });
  return subjects;
}

// ══════════════════════════════════════════════════════════════
// PATHWAY STATUS COMPUTATIONS (5 pathways)
// ══════════════════════════════════════════════════════════════

function p1Status() {
  const subj=getKeystoneSubjectData();
  const allMet=Object.values(subj).every(s=>s.met);
  const anyMet=Object.values(subj).some(s=>s.met);
  return { subjects:subj, met:allMet, status:allMet?'met':anyMet?'partial':'none' };
}

function p2Status() {
  const subj=getKeystoneSubjectData();
  const keys=KEYSTONE_KEYS;
  const scores=keys.map(k=>subj[k].best).filter(x=>x!==null);
  const bm=state.benchmarks.keystone;

  if(scores.length===0) return {met:false,status:'none',mode:null,composite:0};

  const anyBelowBasic=keys.some(k=>subj[k].belowBasic);
  const anyProficient=keys.some(k=>subj[k].met);

  if(anyBelowBasic||!anyProficient) return {met:false,status:scores.length>0?'partial':'none',mode:null,composite:0};

  const composite3=scores.length>=3?scores.slice().sort((a,b)=>b-a).slice(0,3).reduce((s,x)=>s+x,0):null;
  const composite2=scores.length>=2?scores.slice().sort((a,b)=>b-a).slice(0,2).reduce((s,x)=>s+x,0):null;

  if(composite3!==null&&composite3>=4452) return {met:true,status:'met',mode:'3-score',composite:composite3};
  if(composite2!==null&&composite2>=2939) return {met:true,status:'met',mode:'2-score',composite:composite2};

  // partial: have scores but not meeting threshold
  const best=Math.max(...[composite3,composite2].filter(x=>x!==null));
  return {met:false,status:'partial',mode:null,composite:best};
}

function p3Status() {
  const verified=state.p3Records.filter(r=>r.verified);
  return {met:verified.length>0,status:verified.length>0?'met':state.p3Records.length?'partial':'none',count:verified.length};
}

function p4Status() {
  const bm=state.benchmarks.p4;
  const qualifying=state.p4Records.filter(r=>{
    const type=P4_TYPES.find(t=>t.key===r.type);
    if(!type) return false;
    if(type.threshold===null) return r.verified||r.score; // binary/qualitative
    return Number(r.score)>=type.threshold;
  });
  return {met:qualifying.length>0,status:qualifying.length>0?'met':state.p4Records.length?'partial':'none',qualifying};
}

function p5Status() {
  const s1=state.p5Evidence.filter(e=>e.section==='S1');
  const s2=state.p5Evidence.filter(e=>e.section==='S2');
  const total=s1.length+s2.length;
  const met=s1.length>=1&&total>=3;
  return {met,s1Count:s1.length,s2Count:s2.length,total,status:met?'met':total>0?'partial':'none'};
}

function allPathwayStatuses() {
  return { p1:p1Status(), p2:p2Status(), p3:p3Status(), p4:p4Status(), p5:p5Status() };
}

function isEligible(s) { return Object.values(s).some(x=>x.met); }

function updatePathwayNavDots() {
  const s=allPathwayStatuses();
  const dotMap={'pdot-p1':s.p1,'pdot-p2':s.p2,'pdot-p3':s.p3,'pdot-p4':s.p4,'pdot-p5':s.p5};
  Object.entries(dotMap).forEach(([id,st])=>{
    const el=document.getElementById(id);
    if(el) el.className='pathway-status-dot '+(st.status==='met'?'dot-met':st.status==='partial'?'dot-partial':'dot-none');
  });
  const eligible=isEligible(s),anyPartial=Object.values(s).some(x=>x.status==='partial');
  const el=document.getElementById('pdot-overall');
  if(el) el.className='pathway-status-dot '+(eligible?'dot-met':anyPartial?'dot-partial':'dot-none');
}

// ══════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════
function showOnboarding() {
  document.getElementById('onboard-overlay').classList.remove('hidden');
  document.getElementById('ob-name').focus();
}
function hideOnboarding() { document.getElementById('onboard-overlay').classList.add('hidden'); }

document.getElementById('ob-next').addEventListener('click', () => {
  const name=document.getElementById('ob-name').value.trim();
  const school=document.getElementById('ob-school').value.trim();
  const gradYear=document.getElementById('ob-grad-year').value.trim();
  state.student={name,school,gradYear};
  saveData();
  document.getElementById('student-name').value=name;
  document.getElementById('student-school').value=school;
  document.getElementById('grad-year').value=gradYear;
  document.getElementById('new-year-school').value=school;
  hideOnboarding();
  navigateTo('settings-requirements');
  renderDashboard();
  toast(`Welcome, ${name||'there'}! Now add your graduation requirements.`,'success');
});
document.getElementById('ob-skip').addEventListener('click', hideOnboarding);

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
function renderDashboard() {
  const earned=totalEarned(),planned=totalPlanned(),required=totalRequired();
  const pctE=required>0?Math.min(100,(earned/required)*100):0;
  const pctP=required>0?Math.min(100-pctE,(planned/required)*100):0;
  const pctWP=required>0?Math.min(100,((earned+planned)/required)*100):0;

  document.getElementById('dash-heading').textContent=state.student.name?`Welcome, ${state.student.name}`:'Dashboard';
  const sub=[];
  if(state.student.school)   sub.push(state.student.school);
  if(state.student.gradYear) sub.push(`Class of ${state.student.gradYear}`);
  document.getElementById('dash-subtitle').textContent=sub.length?sub.join(' · '):'Your graduation progress at a glance';

  document.getElementById('dash-earned').textContent=fmt(earned);
  document.getElementById('dash-required').textContent=fmt(required);
  document.getElementById('dash-pct').textContent=fmt(pctE)+'%';
  document.getElementById('dash-progress-bar').style.width=pctE+'%';
  document.getElementById('dash-planned-bar').style.width=pctP+'%';
  document.getElementById('dash-planned').textContent=fmt(planned);
  document.getElementById('dash-planned-wrap').style.visibility=planned>0?'visible':'hidden';
  document.getElementById('legend-planned-item').style.display=planned>0?'':'none';

  const pctEl=document.getElementById('dash-pct-with-planned');
  if(planned>0&&required>0){pctEl.textContent=fmt(pctWP)+'% with planned';pctEl.style.display='block';}
  else pctEl.style.display='none';

  document.getElementById('no-requirements-notice').classList.toggle('hidden',state.requirements.length>0);

  // (#5) Pathway summary card
  const s=allPathwayStatuses();
  const eligible=isEligible(s);
  const badge=document.getElementById('dash-pathway-elig-badge');
  if(eligible){
    badge.textContent='✓ Eligible';
    badge.className='dash-pathway-elig-badge elig-yes';
  } else if(Object.values(s).some(x=>x.status==='partial')){
    badge.textContent='In Progress';
    badge.className='dash-pathway-elig-badge elig-partial';
  } else {
    badge.textContent='Not Yet Determined';
    badge.className='dash-pathway-elig-badge elig-no';
  }

  const pways=[
    {id:'p1',label:'Pathway 1\nKeystone Proficiency'},
    {id:'p2',label:'Pathway 2\nComposite'},
    {id:'p3',label:'Pathway 3\nCTE'},
    {id:'p4',label:'Pathway 4\nAlt. Assessment'},
    {id:'p5',label:'Pathway 5\nEvidence-Based'}
  ];
  document.getElementById('dash-pathway-grid').innerHTML=pways.map(p=>{
    const st=s[p.id].status;
    const icon=st==='met'?'fa-circle-check':st==='partial'?'fa-hourglass-half':'fa-circle';
    const cls=st==='met'?'dp-met':st==='partial'?'dp-partial':'dp-none';
    const [line1,line2]=p.label.split('\n');
    return `<div class="dp-item ${cls}" onclick="event.stopPropagation();navigateTo('pathways-${p.id}')">
      <i class="fa-solid ${icon} dp-icon"></i>
      <div class="dp-label">${line1}<br><span>${line2}</span></div>
    </div>`;
  }).join('');

  // Requirements grid
  const grid=document.getElementById('dash-req-grid');
  grid.innerHTML='';
  state.requirements.forEach(req=>{
    const e=creditsEarnedForReq(req.id),p=creditsPlannedForReq(req.id);
    const pct=req.credits>0?Math.min(100,(e/req.credits)*100):0;
    const pctPp=req.credits>0?Math.min(100-pct,(p/req.credits)*100):0;
    const complete=e>=req.credits&&req.credits>0;
    const subHtml=(req.subReqs||[]).length?`
      <div class="req-card-subreqs">${req.subReqs.map(sr=>{
        const st=subReqStatus(req,sr);
        const cr=Number(sr.credits)>0?` (${fmt(sr.credits)})`:'';
        const cls=st==='earned'?'subreq-chip sr-met':st==='planned'?'subreq-chip sr-planned':'subreq-chip';
        return `<span class="${cls}">${st==='earned'?'✓ ':st==='planned'?'◷ ':''}${esc(sr.name)}${cr}</span>`;
      }).join('')}</div>`:''  ;
    grid.innerHTML+=`
      <div class="req-card ${complete?'complete':''}" role="button" tabindex="0"
           onclick="openReqCourses('${req.id}')" onkeydown="if(event.key==='Enter')openReqCourses('${req.id}')">
        <span class="req-badge">${complete?'✓ Met':fmt(pct)+'%'}</span>
        <div class="req-card-name">${esc(req.name)}</div>
        <div class="req-card-credits">${fmt(e)} <span>/ ${fmt(req.credits)} credits</span></div>
        ${p>0?`<div class="req-card-planned">+${fmt(p)} planned</div>`:''}
        ${subHtml}
        <div class="req-card-bar-wrap">
          <div class="req-card-bar" style="width:${pct}%"></div>
          <div class="req-card-bar planned-seg" style="width:${pctPp}%"></div>
        </div>
        <div class="req-card-click-hint">
          <svg viewBox="0 0 24 24" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          View courses
        </div>
      </div>`;
  });

  // Year cards
  const yearCards=document.getElementById('dash-year-cards');
  yearCards.innerHTML='';
  const byYear=creditsByYear();
  state.years.forEach(y=>{
    const {earned:e,planned:p}=byYear[y.id]||{earned:0,planned:0};
    const cnt=state.courses.filter(co=>co.yearId===y.id).length;
    yearCards.innerHTML+=`<div class="year-card">
      <div class="year-card-name">${esc(y.name)}</div>
      ${y.school?`<div class="year-card-school">${esc(y.school)}</div>`:''}
      <div class="year-card-credits">${fmt(e)}</div>
      ${p>0?`<div class="year-card-planned">+${fmt(p)} planned</div>`:''}
      <div class="year-card-sub">${cnt} course${cnt!==1?'s':''}</div>
    </div>`;
  });
  if(!state.years.length&&state.requirements.length>0)
    yearCards.innerHTML='<p class="text-muted" style="font-size:.85rem">No school years defined yet.</p>';
}

function openReqCourses(reqId){ courseReqFilter=reqId; navigateTo('courses',{reqId}); }

// ══════════════════════════════════════════════════════════════
// COURSES
// ══════════════════════════════════════════════════════════════
function setupCoursesListeners() {
  document.getElementById('btn-add-course').addEventListener('click',()=>openCourseModal());
  document.getElementById('filter-year').addEventListener('change',renderCourses);
  document.getElementById('filter-req').addEventListener('change',renderCourses);
  document.getElementById('filter-status').addEventListener('change',renderCourses);
}

function renderCourses() {
  const fyEl=document.getElementById('filter-year');
  const frEl=document.getElementById('filter-req');
  const fsEl=document.getElementById('filter-status');
  const savedY=fyEl.value,savedS=fsEl.value;

  fyEl.innerHTML='<option value="">All Years</option>';
  state.years.forEach(y=>{fyEl.innerHTML+=`<option value="${y.id}" ${savedY===y.id?'selected':''}>${esc(y.name)}</option>`;});

  const pendingR=courseReqFilter||frEl.value;
  frEl.innerHTML='<option value="">All Categories</option>';
  state.requirements.forEach(r=>{frEl.innerHTML+=`<option value="${r.id}" ${pendingR===r.id?'selected':''}>${esc(r.name)}</option>`;});
  if(courseReqFilter){frEl.value=courseReqFilter;courseReqFilter='';}

  let courses=state.courses.slice();
  if(fyEl.value) courses=courses.filter(c=>c.yearId===fyEl.value);
  if(frEl.value) courses=courses.filter(c=>c.reqId===frEl.value);
  if(savedS==='earned')  courses=courses.filter(c=>!c.planned);
  if(savedS==='planned') courses=courses.filter(c=> c.planned);

  const tbody=document.getElementById('courses-tbody');
  if(!courses.length){tbody.innerHTML='<tr class="empty-row"><td colspan="8">No courses match the current filters.</td></tr>';return;}

  const yo=state.years.reduce((m,y,i)=>{m[y.id]=i;return m;},{});
  courses.sort((a,b)=>{if(!!a.planned!==!!b.planned)return a.planned?1:-1;return(yo[a.yearId]??99)-(yo[b.yearId]??99);});

  tbody.innerHTML=courses.map(c=>{
    const gClass=['A','B','C','D','F','P'].includes(c.grade)?c.grade:'';
    const statusSel=`<select class="status-select ${c.planned?'sel-planned':'sel-earned'}" onchange="handleStatusChange('${c.id}',this.value)">
      <option value="earned" ${!c.planned?'selected':''}>✓ Earned</option>
      <option value="planned" ${c.planned?'selected':''}>◷ Planned</option></select>`;
    const typeBadge=c.type&&c.type!=='Standard'?`<span class="type-badge type-${c.type}">${esc(c.type)}</span>`:c.type==='Standard'?'<span class="type-badge type-std">Std</span>':'—';
    const req=getReq(c.reqId);
    let catDisplay=esc(getReqName(c.reqId));
    if(c.subReqId&&req){const sub=req.subReqs?.find(sr=>sr.id===c.subReqId);if(sub)catDisplay+=`<br><span class="subreq-label">${esc(sub.name)}</span>`;}
    let srMatch='';
    if(req){const mSr=req.subReqs?.find(sr=>sr.name.trim().toLowerCase()===c.name.trim().toLowerCase());if(mSr){const st=subReqStatus(req,mSr);if(st)srMatch=`<span class="sr-match-tag ${st==='earned'?'sr-match-earned':'sr-match-planned'}">${st==='earned'?'✓':'◷'} Sub-req</span>`;}}
    return `<tr class="${c.planned?'row-planned':''}">
      <td class="td-course-name">${esc(c.name)}${srMatch}</td>
      <td class="td-year">${esc(getYearName(c.yearId))}</td>
      <td class="col-center"><strong>${fmt(c.credits)}</strong></td>
      <td class="col-center">${c.grade?`<span class="grade-badge ${gClass}">${esc(c.grade)}</span>`:'—'}</td>
      <td class="col-center">${typeBadge}</td>
      <td class="td-cat">${catDisplay}</td>
      <td class="col-center">${statusSel}</td>
      <td><div class="action-btns">
        <button class="btn-icon" onclick="openCourseModal('${c.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="btn-icon delete" onclick="deleteCourse('${c.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

function handleStatusChange(courseId,newStatus) {
  const course=state.courses.find(c=>c.id===courseId);
  if(!course) return;
  if(newStatus==='earned'&&course.planned) openEarnedModal(courseId);
  else if(newStatus==='planned'&&!course.planned){course.planned=true;saveData();renderAll();toast('Course marked as Planned.','success');}
}

function openEarnedModal(courseId) {
  const c=state.courses.find(x=>x.id===courseId);if(!c) return;
  const gradeOpts=GRADES.map(g=>`<option value="${g}" ${c.grade===g?'selected':''}>${g}</option>`).join('');
  document.getElementById('modal-title').textContent='Mark as Earned';
  document.getElementById('modal-body').innerHTML=`
    <div class="earned-modal-info"><div class="earned-course-name">${esc(c.name)}</div>
      <div class="earned-course-meta">${fmt(c.credits)} credits · ${esc(getYearName(c.yearId))} · ${esc(getReqName(c.reqId))}</div></div>
    <div class="status-change-banner"><span class="status-badge planned">◷ Planned</span><span class="status-arrow">→</span><span class="status-badge earned">✓ Earned</span></div>
    <div class="form-group" style="margin-top:16px"><label>Grade Received</label>
      <select id="em-grade"><option value="">— Select grade —</option>${gradeOpts}</select></div>
    <div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="em-save">Save as Earned</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',()=>{closeModal();renderCourses();});
  document.getElementById('em-save').addEventListener('click',()=>{c.planned=false;c.grade=document.getElementById('em-grade').value||c.grade;saveData();closeModal();renderAll();toast('Course marked as Earned!','success');});
  openModal();
}

function openCourseModal(courseId) {
  const c=courseId?state.courses.find(x=>x.id===courseId):null;
  document.getElementById('modal-title').textContent=c?'Edit Course':'Add Course';
  const yearOpts=state.years.map(y=>`<option value="${y.id}" ${c?.yearId===y.id?'selected':''}>${esc(y.name)}</option>`).join('');
  const reqOpts=state.requirements.map(r=>{
    const subs=(r.subReqs||[]).map(sr=>{const cr=Number(sr.credits)>0?` (${fmt(sr.credits)} cr)`:'';return `<option value="${r.id}|${sr.id}" ${c?.reqId===r.id&&c?.subReqId===sr.id?'selected':''}>  ↳ ${esc(sr.name)}${cr}</option>`;}).join('');
    return `<option value="${r.id}" ${c?.reqId===r.id&&!c?.subReqId?'selected':''}>${esc(r.name)}</option>${subs}`;
  }).join('');
  const gradeOpts=GRADES.map(g=>`<option value="${g}" ${c?.grade===g?'selected':''}>${g}</option>`).join('');
  const typeOpts=COURSE_TYPES.map(t=>`<option value="${t}" ${(c?.type||'Standard')===t?'selected':''}>${t}</option>`).join('');
  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>Course Name *</label><input type="text" id="c-name" placeholder="e.g. Algebra II" value="${esc(c?.name||'')}" /></div>
    <div class="form-row">
      <div class="form-group"><label>School Year</label><select id="c-year"><option value="">— Select —</option>${yearOpts}</select></div>
      <div class="form-group"><label>Credits *</label><input type="number" id="c-credits" placeholder="1.0" min="0" step="0.5" value="${c?.credits??''}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Grade</label><select id="c-grade"><option value="">— Select —</option>${gradeOpts}</select></div>
      <div class="form-group"><label>Course Type</label><select id="c-type">${typeOpts}</select></div>
    </div>
    <div class="form-group"><label>Requirement Category</label><select id="c-req"><option value="">— Uncategorized —</option>${reqOpts}</select></div>
    <div class="form-group" style="margin-top:4px"><label class="toggle-label">
      <input type="checkbox" id="c-planned" ${c?.planned?'checked':''} />
      <span class="toggle-track"></span><span class="toggle-text">Mark as <strong>Planned</strong></span>
    </label></div>
    <div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-save">Save Course</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-save').addEventListener('click',()=>saveCourse(courseId));
  openModal();document.getElementById('c-name').focus();
}

function saveCourse(courseId) {
  const name=document.getElementById('c-name').value.trim();
  const credits=parseFloat(document.getElementById('c-credits').value);
  const yearId=document.getElementById('c-year').value;
  const grade=document.getElementById('c-grade').value;
  const type=document.getElementById('c-type').value;
  const planned=document.getElementById('c-planned').checked;
  const reqVal=document.getElementById('c-req').value;
  let reqId='',subReqId='';
  if(reqVal.includes('|'))[reqId,subReqId]=reqVal.split('|');else reqId=reqVal;
  if(!name){toast('Please enter a course name.','error');return;}
  if(isNaN(credits)||credits<0){toast('Please enter a valid credit value.','error');return;}
  const data={name,credits,yearId,grade,type,reqId,subReqId,planned};
  if(courseId)Object.assign(state.courses.find(c=>c.id===courseId),data);
  else state.courses.push({id:uid(),...data});
  saveData();closeModal();renderAll();
  toast(courseId?'Course updated.':'Course added.','success');
}

function deleteCourse(id){if(!confirm('Delete this course?'))return;state.courses=state.courses.filter(c=>c.id!==id);saveData();renderAll();toast('Course deleted.');}

// ══════════════════════════════════════════════════════════════
// STATISTICS
// ══════════════════════════════════════════════════════════════
function renderStats() {
  const earned=totalEarned(),planned=totalPlanned(),required=totalRequired();
  const remaining=Math.max(0,required-earned);
  const metCount=state.requirements.filter(r=>creditsEarnedForReq(r.id)>=r.credits&&r.credits>0).length;
  const pct=required>0?(earned/required)*100:0;
  const yearsW=state.years.filter(y=>state.courses.some(c=>c.yearId===y.id&&!c.planned));
  const avg=yearsW.length>0?earned/yearsW.length:0;
  document.getElementById('stat-total-courses').textContent=state.courses.length;
  document.getElementById('stat-credits-earned').textContent=fmt(earned);
  document.getElementById('stat-credits-remaining').textContent=fmt(remaining);
  document.getElementById('stat-credits-planned').textContent=fmt(planned);
  document.getElementById('stat-reqs-met').textContent=`${metCount} / ${state.requirements.length}`;
  document.getElementById('stat-completion').textContent=fmt(pct)+'%';
  document.getElementById('stat-avg-credits').textContent=fmt(avg);
  document.getElementById('stat-grad-year').textContent=state.student.gradYear||'—';

  const byYear=creditsByYear();
  const maxC=Math.max(...state.years.map(y=>(byYear[y.id]?.earned||0)+(byYear[y.id]?.planned||0)),1);
  document.getElementById('bar-chart-years').innerHTML=!state.years.length
    ?'<p class="text-muted" style="font-size:.85rem;padding:20px 0">No years defined.</p>'
    :state.years.map(y=>{const e=byYear[y.id]?.earned||0,p=byYear[y.id]?.planned||0;const hE=Math.round((e/maxC)*140),hP=Math.round((p/maxC)*140);
      return `<div class="bar-col"><div class="bar-col-val">${fmt(e)}${p>0?`<span class="bar-plan-label">+${fmt(p)}</span>`:''}</div>
        <div class="bar-col-inner-wrap" style="height:${hE+hP}px">${p>0?`<div class="bar-seg planned" style="height:${hP}px"></div>`:''}
        <div class="bar-seg earned" style="height:${hE}px"></div></div>
        <div class="bar-col-label">${esc(y.name)}</div></div>`;
    }).join('');

  document.getElementById('req-breakdown').innerHTML=!state.requirements.length
    ?'<p class="text-muted" style="font-size:.85rem">No requirements defined.</p>'
    :state.requirements.map(req=>{
      const e=creditsEarnedForReq(req.id),p=creditsPlannedForReq(req.id);
      const pct=req.credits>0?Math.min(100,(e/req.credits)*100):0;
      const pctP=req.credits>0?Math.min(100-pct,(p/req.credits)*100):0;
      const done=e>=req.credits&&req.credits>0;
      const subH=(req.subReqs||[]).length?`<div class="breakdown-subreqs">${req.subReqs.map(sr=>{const st=subReqStatus(req,sr);const cr=Number(sr.credits)>0?` (${fmt(sr.credits)})`:'';const cls=st==='earned'?'subreq-chip sm sr-met':st==='planned'?'subreq-chip sm sr-planned':'subreq-chip sm';return `<span class="${cls}">${st==='earned'?'✓ ':st==='planned'?'◷ ':''}${esc(sr.name)}${cr}</span>`;}).join('')}</div>`:'';
      return `<div class="req-row"><div class="req-row-name">${esc(req.name)}${subH}</div>
        <div class="req-row-bar-wrap"><div class="req-row-bar ${done?'done':''}" style="width:${pct}%"></div><div class="req-row-bar-gold" style="width:${pctP}%"></div></div>
        <div class="req-row-credits">${fmt(e)}${p>0?`<span class="plan-inline">+${fmt(p)}</span>`:''} / ${fmt(req.credits)}</div></div>`;
    }).join('');

  const gradesE={},gradesP={};
  state.courses.forEach(c=>{if(!c.grade)return;c.planned?gradesP[c.grade]=(gradesP[c.grade]||0)+1:gradesE[c.grade]=(gradesE[c.grade]||0)+1;});
  const og=GRADES.filter(g=>gradesE[g]||gradesP[g]);
  document.getElementById('grade-dist').innerHTML=og.length
    ?og.map(g=>`<div class="grade-dist-item"><div class="grade-dist-count">${gradesE[g]||0}</div>${gradesP[g]?`<div class="grade-planned-note">+${gradesP[g]}</div>`:''}<div class="grade-dist-label">${g}</div></div>`).join('')
    :'<p class="text-muted" style="font-size:.85rem">No grade data available.</p>';
}

// ══════════════════════════════════════════════════════════════
// PATHWAY OVERVIEW (#7 — req-card style)
// ══════════════════════════════════════════════════════════════
function renderPathwayOverview() {
  const s=allPathwayStatuses(),eligible=isEligible(s),anyPartial=Object.values(s).some(x=>x.status!=='none');
  updatePathwayNavDots();

  const banner=document.getElementById('eligibility-banner');
  const icon=banner.querySelector('.elig-icon');
  const metNames=Object.entries(s).filter(([,v])=>v.met).map(([k])=>({p1:'Pathway 1',p2:'Pathway 2',p3:'Pathway 3',p4:'Pathway 4',p5:'Pathway 5'}[k]||k));
  if(eligible){banner.className='eligibility-banner eligible';if(icon)icon.className='fa-solid fa-circle-check elig-icon';document.getElementById('eligibility-title').textContent='✓ Graduation Eligible — Pathway Requirement Met';document.getElementById('eligibility-detail').textContent='Completed: '+metNames.join(', ');}
  else if(anyPartial){banner.className='eligibility-banner partial';if(icon)icon.className='fa-solid fa-hourglass-half elig-icon';document.getElementById('eligibility-title').textContent='In Progress — Not Yet Eligible';document.getElementById('eligibility-detail').textContent='At least one pathway must be fully completed.';}
  else{banner.className='eligibility-banner not-eligible';if(icon)icon.className='fa-solid fa-circle-info elig-icon';document.getElementById('eligibility-title').textContent='Pathway Eligibility: Not Yet Determined';document.getElementById('eligibility-detail').textContent='Complete at least one full pathway to meet graduation requirements.';}

  // (#7) Cards styled like req-cards
  const pathways=[
    {key:'p1',page:'pathways-p1',icon:'fa-pencil',      label:'Pathway 1',name:'Keystone Proficiency',   desc:descP1(s.p1)},
    {key:'p2',page:'pathways-p2',icon:'fa-calculator',  label:'Pathway 2',name:'Keystone Composite',     desc:descP2(s.p2)},
    {key:'p3',page:'pathways-p3',icon:'fa-wrench',      label:'Pathway 3',name:'Career & Technical Ed',  desc:descP3(s.p3)},
    {key:'p4',page:'pathways-p4',icon:'fa-chart-bar',   label:'Pathway 4',name:'Alternative Assessment', desc:descP4(s.p4)},
    {key:'p5',page:'pathways-p5',icon:'fa-folder-open', label:'Pathway 5',name:'Evidence-Based',         desc:descP5(s.p5)}
  ];

  document.getElementById('pathway-overview-grid').innerHTML=pathways.map(p=>{
    const status=s[p.key].status;
    const complete=status==='met';
    const badgeTxt=complete?'✓ Met':status==='partial'?'◷ In Progress':'○ Not Started';
    const pct=complete?100:status==='partial'?50:0;
    return `<div class="req-card ${complete?'complete':''}" role="button" tabindex="0"
         onclick="navigateTo('${p.page}')" onkeydown="if(event.key==='Enter')navigateTo('${p.page}')">
      <span class="req-badge">${badgeTxt}</span>
      <div class="req-card-name"><i class="fa-solid ${p.icon}" style="margin-right:6px;color:var(--blue-lite)"></i>${p.label}</div>
      <div class="req-card-credits" style="font-size:.85rem;font-weight:600;color:var(--gray-800);margin-top:2px">${p.name}</div>
      <div class="req-card-planned" style="color:var(--gray-600);font-size:.75rem;font-weight:400;margin-top:4px">${p.desc}</div>
      <div class="req-card-bar-wrap" style="margin-top:10px">
        <div class="req-card-bar" style="width:${pct}%"></div>
      </div>
      <div class="req-card-click-hint">
        <svg viewBox="0 0 24 24" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        View details
      </div>
    </div>`;
  }).join('');

  const metCount=Object.values(s).filter(x=>x.met).length;
  document.getElementById('pathway-progress-card').innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:.87rem;color:var(--gray-600)">Pathways completed: <strong style="color:var(--blue-dark)">${metCount} / 5</strong></span>
      <span style="font-size:.87rem;color:var(--gray-600)">You only need <strong style="color:var(--green)">1</strong> to be eligible</span>
    </div>
    <div class="prog-wrap" style="height:12px"><div class="prog-bar ${metCount>0?'green':''}" style="width:${(metCount/5)*100}%"></div></div>`;
}

function descP1(s){ const n=Object.values(s.subjects).filter(x=>x.met).length;return `${n}/3 subjects Proficient or higher`; }
function descP2(s){ return s.met?`${s.mode} composite: ${s.composite}`:s.composite?`Best composite: ${s.composite} (need 4452 or 2939)`:'No qualifying scores yet'; }
function descP3(s){ return s.met?`${s.count} verified CTE record(s)`:s.count===0?'No CTE records logged':'Records logged — verification pending'; }
function descP4(s){ return s.met?`${s.qualifying.length} qualifying assessment(s)`:state.p4Records.length?`${state.p4Records.length} record(s) — none qualifying yet`:'No assessments logged'; }
function descP5(s){ return s.met?`${s.total} pieces of evidence (${s.s1Count} Section 1)`:`${s.total}/3 pieces (need ≥1 from Section 1)`; }

// ══════════════════════════════════════════════════════════════
// PATHWAY 1 — KEYSTONE PROFICIENCY
// ══════════════════════════════════════════════════════════════
function renderP1() {
  const s=p1Status(),bm=state.benchmarks.keystone;
  const badge=document.getElementById('p1-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');

  document.getElementById('p1-subjects').innerHTML=KEYSTONE_SUBJECTS.map((subj,i)=>{
    const key=KEYSTONE_KEYS[i],info=s.subjects[key],prof=bm[key]?.prof??0;
    const pct=info.best?Math.min(100,(info.best/(prof*1.15))*100):0;
    const badgeCls=info.met?'badge-met':info.best?'badge-partial':'badge-none';
    const label=info.met?`✓ Proficient`:info.best?`Best: ${info.best}`:'Not Taken';
    return `<div class="subject-row">
      <div class="subject-name">${subj}</div>
      <div><div class="prog-wrap"><div class="prog-bar ${info.met?'green':''}" style="width:${pct}%"></div></div></div>
      <div class="subject-score-info">Proficient: ≥ ${prof}</div>
      <div><span class="subject-badge ${badgeCls}">${label}</span></div>
    </div>`;
  }).join('');

  const tbody=document.getElementById('keystone-log-tbody');
  if(!state.keystoneScores.length){tbody.innerHTML='<tr class="empty-row"><td colspan="6">No scores logged yet.</td></tr>';return;}
  const sorted=[...state.keystoneScores].sort((a,b)=>new Date(b.date)-new Date(a.date));
  tbody.innerHTML=sorted.map(sc=>{
    const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(sc.subject)],prof=bm[key]?.prof??0,met=sc.score>=prof;
    return `<tr><td>${sc.subject}</td><td>${fmtDate(sc.date)}</td><td>${sc.score}</td>
      <td class="col-center"><span class="subject-badge ${sc.level==='Below Basic'?'badge-none':sc.level==='Basic'?'badge-none':'badge-met'}">${sc.level||'—'}</span></td>
      <td class="col-center"><span class="subject-badge ${met?'badge-met':'badge-none'}">${met?'✓ Proficient':'Below'}</span></td>
      <td><button class="btn-icon delete" onclick="deletePathwayEntry('keystoneScores','${sc.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></td></tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// PATHWAY 2 — KEYSTONE COMPOSITE
// ══════════════════════════════════════════════════════════════
function renderP2() {
  const s=p2Status(),subj=getKeystoneSubjectData(),bm=state.benchmarks.keystone;
  const badge=document.getElementById('p2-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');

  const keys=KEYSTONE_KEYS;
  const scores=keys.map(k=>subj[k].best).filter(x=>x!==null);
  const anyBB=keys.some(k=>subj[k].belowBasic);
  const anyProf=keys.some(k=>subj[k].met);

  let html='';
  // Subject breakdown
  html+=`<div style="margin-bottom:16px">`;
  html+=KEYSTONE_SUBJECTS.map((subjectName,i)=>{
    const key=KEYSTONE_KEYS[i],info=subj[key];
    const levelCls=info.belowBasic?'badge-none':info.met?'badge-met':info.best?'badge-partial':'badge-none';
    const levelTxt=info.belowBasic?'Below Basic':info.met?'Proficient+':info.best?`Basic (${info.best})`:'Not Taken';
    return `<div class="subject-row">
      <div class="subject-name">${subjectName}</div><div></div>
      <div class="subject-score-info">${info.best!==null?`Score: ${info.best}`:'—'}</div>
      <div><span class="subject-badge ${levelCls}">${levelTxt}</span></div>
    </div>`;
  }).join('');
  html+=`</div>`;

  // Composite results
  if(anyBB){html+=`<div class="info-callout" style="background:#fdecea;border-color:#f5a9a0"><i class="fa-solid fa-circle-exclamation" style="color:var(--danger)"></i><div><strong>Below Basic score present.</strong> Composite pathway requires no Below Basic scores. Address the below-basic subject to use this pathway.</div></div>`;}
  else if(!anyProf&&scores.length>0){html+=`<div class="info-callout"><i class="fa-solid fa-circle-info"></i><div>At least one score must be Proficient or higher to use the composite pathway.</div></div>`;}
  else if(scores.length>=2){
    const sorted3=scores.slice().sort((a,b)=>b-a);
    const c3=scores.length>=3?sorted3.slice(0,3).reduce((s,x)=>s+x,0):null;
    const c2=sorted3.slice(0,2).reduce((s,x)=>s+x,0);
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px">`;
    if(c3!==null)html+=`<div class="card" style="padding:14px;text-align:center;border-top:3px solid ${c3>=4452?'var(--green)':'var(--gray-200)'}">
      <div style="font-size:.78rem;color:var(--gray-600);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">3-Score Composite</div>
      <div style="font-size:2rem;font-weight:700;color:var(--blue-dark)">${c3}</div>
      <div style="font-size:.78rem;margin-top:4px"><span class="subject-badge ${c3>=4452?'badge-met':'badge-none'}">${c3>=4452?'✓ Meets 4452':'Need '+4452}</span></div>
    </div>`;
    html+=`<div class="card" style="padding:14px;text-align:center;border-top:3px solid ${c2>=2939?'var(--green)':'var(--gray-200)'}">
      <div style="font-size:.78rem;color:var(--gray-600);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">2-Score Composite</div>
      <div style="font-size:2rem;font-weight:700;color:var(--blue-dark)">${c2}</div>
      <div style="font-size:.78rem;margin-top:4px"><span class="subject-badge ${c2>=2939?'badge-met':'badge-none'}">${c2>=2939?'✓ Meets 2939':'Need '+2939}</span></div>
    </div>`;
    html+=`</div>`;
  } else {
    html+=`<p class="text-muted" style="padding:12px 0">Log Keystone scores in Pathway 1 to calculate your composite.</p>`;
  }

  document.getElementById('p2-composite-status').innerHTML=html;
}

// ══════════════════════════════════════════════════════════════
// PATHWAY 3 — CTE
// ══════════════════════════════════════════════════════════════
function renderP3() {
  const s=p3Status();
  const badge=document.getElementById('p3-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');

  const tbody=document.getElementById('p3-log-tbody');
  if(!state.p3Records.length){tbody.innerHTML='<tr class="empty-row"><td colspan="5">No CTE records logged yet.</td></tr>';return;}
  tbody.innerHTML=state.p3Records.map(r=>`<tr>
    <td>${esc(r.description)}</td><td>${esc(r.type||'—')}</td><td>${fmtDate(r.date)}</td>
    <td class="col-center"><span class="subject-badge ${r.verified?'badge-met':'badge-none'}">${r.verified?'✓ Verified':'Pending'}</span></td>
    <td><button class="btn-icon delete" onclick="deletePathwayEntry('p3Records','${r.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════════════════════
// PATHWAY 4 — ALTERNATIVE ASSESSMENT
// ══════════════════════════════════════════════════════════════
function renderP4() {
  const s=p4Status();
  const badge=document.getElementById('p4-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');

  const tbody=document.getElementById('p4-log-tbody');
  if(!state.p4Records.length){tbody.innerHTML='<tr class="empty-row"><td colspan="7">No assessments logged yet.</td></tr>';return;}
  tbody.innerHTML=state.p4Records.map(r=>{
    const type=P4_TYPES.find(t=>t.key===r.type);
    const qualifies=s.qualifying.some(q=>q.id===r.id);
    const thresh=type?.threshold!==null?`≥ ${type?.threshold}`:'Completion';
    return `<tr>
      <td>${esc(r.name)}</td><td>${esc(type?.label||r.type)}</td><td>${fmtDate(r.date)}</td>
      <td class="col-center">${esc(r.score||'—')}</td>
      <td class="col-center">${thresh}</td>
      <td class="col-center"><span class="subject-badge ${qualifies?'badge-met':'badge-none'}">${qualifies?'✓ Qualifies':'Not Yet'}</span></td>
      <td><button class="btn-icon delete" onclick="deletePathwayEntry('p4Records','${r.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// PATHWAY 5 — EVIDENCE-BASED
// ══════════════════════════════════════════════════════════════
function renderP5() {
  const s=p5Status();
  const badge=document.getElementById('p5-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');

  const summary=document.getElementById('p5-summary');
  const pct=Math.min(100,(s.total/3)*100);
  summary.innerHTML=`<div style="display:flex;align-items:center;gap:14px">
    <span style="font-size:.84rem;color:var(--gray-600)">${s.total}/3 pieces of evidence (${s.s1Count} from Section 1)</span>
    <div class="prog-wrap" style="flex:1;height:9px"><div class="prog-bar ${s.met?'green':''}" style="width:${pct}%"></div></div>
  </div>`;

  const renderEvidenceTable=(tbodyId,section)=>{
    const rows=state.p5Evidence.filter(e=>e.section===section);
    const tbody=document.getElementById(tbodyId);
    if(!rows.length){tbody.innerHTML=`<tr class="empty-row"><td colspan="6">No ${section} evidence logged.</td></tr>`;return;}
    tbody.innerHTML=rows.map(e=>`<tr>
      <td>${esc(e.name)}</td><td>${esc(e.type)}</td><td>${fmtDate(e.date)}</td>
      <td class="col-center">${esc(e.score||'—')}</td>
      <td class="col-center"><span class="subject-badge badge-partial">${e.section}</span></td>
      <td><button class="btn-icon delete" onclick="deletePathwayEntry('p5Evidence','${e.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></td>
    </tr>`).join('');
  };
  renderEvidenceTable('p5-s1-tbody','S1');
  renderEvidenceTable('p5-s2-tbody','S2');
}

// ══════════════════════════════════════════════════════════════
// PROJECTION
// ══════════════════════════════════════════════════════════════
function renderProjection() {
  const s=allPathwayStatuses(),eligible=isEligible(s);
  const pways=[
    {key:'p1',label:'Pathway 1 — Keystone Proficiency',page:'pathways-p1'},
    {key:'p2',label:'Pathway 2 — Keystone Composite',  page:'pathways-p2'},
    {key:'p3',label:'Pathway 3 — CTE',                 page:'pathways-p3'},
    {key:'p4',label:'Pathway 4 — Alternative Assessment',page:'pathways-p4'},
    {key:'p5',label:'Pathway 5 — Evidence-Based',      page:'pathways-p5'}
  ];
  document.getElementById('proj-checklist').innerHTML=pways.map(p=>{
    const status=s[p.key].status;
    const cls=status==='met'?'done':status==='partial'?'active':'todo';
    const icon=status==='met'?'fa-circle-check':status==='partial'?'fa-hourglass-half':'fa-circle';
    return `<div class="proj-step ${cls}" onclick="navigateTo('${p.page}')" style="cursor:pointer"><i class="fa-solid ${icon}"></i><span>${p.label}</span></div>`;
  }).join('');

  const steps=buildNextSteps(s,eligible);
  document.getElementById('proj-next-steps').innerHTML=steps.length
    ?steps.map(st=>`<div class="next-step-item ${st.priority?'priority':''}"><i class="fa-solid ${st.icon}"></i><div><strong>${st.label}</strong><br><span class="text-muted">${st.detail}</span></div></div>`).join('')
    :`<div class="next-step-item"><i class="fa-solid fa-star"></i><div><strong>All set!</strong><br><span class="text-muted">At least one pathway is complete. Graduation requirement satisfied.</span></div></div>`;

  const tl=document.getElementById('proj-timeline');
  if(!state.plannedEvents.length){tl.innerHTML='<p class="text-muted" style="padding:8px 0">No planned events yet. Add upcoming test dates or activities.</p>';return;}
  const sorted=[...state.plannedEvents].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const now=new Date();
  tl.innerHTML=sorted.map(ev=>{
    const evDate=new Date(ev.date),past=evDate<now,soon=!past&&(evDate-now)<30*24*60*60*1000;
    const dotCls=past?'tl-past':soon?'tl-soon':'tl-future';
    return `<div class="timeline-item"><div class="timeline-date">${fmtDate(ev.date)}</div><div class="timeline-dot ${dotCls}"></div>
      <div><strong>${esc(ev.label)}</strong>${ev.projectedScore?`<span class="text-muted"> — ${esc(ev.projectedScore)}</span>`:''}
        <button class="btn-icon delete" style="display:inline;margin-left:6px" onclick="deletePathwayEntry('plannedEvents','${ev.id}')"><svg viewBox="0 0 24 24" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div></div>`;
  }).join('');
}

function buildNextSteps(s,eligible) {
  if(eligible) return [];
  const steps=[];
  // P1: which subjects are missing
  const kSubj=getKeystoneSubjectData();
  const missingK=KEYSTONE_SUBJECTS.filter((_,i)=>!kSubj[KEYSTONE_KEYS[i]].met);
  if(missingK.length) steps.push({icon:'fa-pencil',label:'Pathway 1 — Keystone Exams',detail:`${missingK.join(', ')} not yet Proficient`,priority:missingK.length<3});
  // P2
  if(!s.p2.met&&s.p2.composite>0) steps.push({icon:'fa-calculator',label:'Pathway 2 — Composite',detail:`Current best composite: ${s.p2.composite}. Need 4452 (3-score) or 2939 (2-score)`,priority:true});
  if(!s.p4.met&&state.p4Records.length>0) steps.push({icon:'fa-chart-bar',label:'Pathway 4 — Alternative',detail:`${state.p4Records.length} record(s) logged but none yet qualifying`,priority:true});
  if(!s.p5.met) {
    const need=3-s.p5.total,needS1=s.p5.s1Count===0?1:0;
    steps.push({icon:'fa-folder-open',label:'Pathway 5 — Evidence-Based',detail:`${s.p5.total}/3 pieces. Need ${need} more${needS1?' (at least 1 from Section 1)':''}`,priority:s.p5.total>0});
  }
  if(!s.p3.met&&!state.p3Records.length) steps.push({icon:'fa-wrench',label:'Pathway 3 — CTE',detail:'Log CTE concentration records if applicable',priority:false});
  return steps.slice(0,6);
}

// ══════════════════════════════════════════════════════════════
// PATHWAY MODALS
// ══════════════════════════════════════════════════════════════
function openPathwayModal(type) {
  const body=document.getElementById('modal-body');
  const title=document.getElementById('modal-title');

  if(type==='keystone') {
    title.textContent='Log Keystone Score';
    const subjOpts=KEYSTONE_SUBJECTS.map(s=>`<option>${s}</option>`).join('');
    body.innerHTML=`
      <div class="form-row">
        <div class="form-group"><label>Subject</label><select id="m-subj">${subjOpts}</select></div>
        <div class="form-group"><label>Date Taken</label><input type="date" id="m-date" value="${today()}" /></div>
      </div>
      <div class="form-group"><label>Score</label><input type="number" id="m-score" placeholder="e.g. 1542" /></div>
      <div class="form-group" style="margin-top:8px;padding:10px 13px;background:var(--gray-100);border-radius:var(--radius-sm);font-size:.83rem;color:var(--gray-600)">
        <i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i>
        Performance level (Basic / Proficient / Advanced / Below Basic) is auto-calculated from your score and benchmarks.
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveKeystoneScore()">Save Score</button></div>`;
  }

  else if(type==='p3') {
    title.textContent='Log CTE Record';
    const typeOpts=['Industry-Based Competency Certification','High Likelihood of Success on Assessment','CTE Concentrator Readiness Demonstration','Transfer Record from Previous District'].map(t=>`<option>${t}</option>`).join('');
    body.innerHTML=`
      <div class="form-group"><label>Description</label><input type="text" id="m-name" placeholder="e.g. CompTIA IT Fundamentals certification" /></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="m-type">${typeOpts}</select></div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${today()}" /></div>
      </div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem"><input type="checkbox" id="m-verified" /> Mark as verified by advisor / district</label></div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveP3Record()">Save Record</button></div>`;
  }

  else if(type==='p4') {
    title.textContent='Log Alternative Assessment';
    const typeOpts=P4_TYPES.map(t=>`<option value="${t.key}">${t.label}</option>`).join('');
    body.innerHTML=`
      <div class="form-group"><label>Assessment / Activity Name</label><input type="text" id="m-name" placeholder="e.g. SAT — Spring 2024" /></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="m-type">${typeOpts}</select></div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${today()}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Score / Result</label><input type="text" id="m-score" placeholder="e.g. 1025 or Gold" /></div>
        <div class="form-group"><label>Notes (optional)</label><input type="text" id="m-notes" /></div>
      </div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem"><input type="checkbox" id="m-verified" /> Verified / completed</label></div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveP4Record()">Save Assessment</button></div>`;
  }

  else if(type==='p5') {
    title.textContent='Add Evidence (Pathway 5)';
    const s1Opts=P5_S1_TYPES.map(t=>`<option value="${t.key}">${t.label}</option>`).join('');
    const s2Opts=P5_S2_TYPES.map(t=>`<option value="${t.key}">${t.label}</option>`).join('');
    body.innerHTML=`
      <div class="form-group"><label>Evidence Description</label><input type="text" id="m-name" placeholder="e.g. AP Calculus Exam — Score 3" /></div>
      <div class="form-row">
        <div class="form-group"><label>Section</label>
          <select id="m-section" onchange="updateP5TypeOpts()">
            <option value="S1">Section 1</option><option value="S2">Section 2</option>
          </select>
        </div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${today()}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="m-type">${s1Opts}</select></div>
        <div class="form-group"><label>Score / Result</label><input type="text" id="m-score" placeholder="e.g. 3 or Gold" /></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveP5Evidence()">Add Evidence</button></div>`;
    // store opts for toggle
    window._p5s1Opts=s1Opts; window._p5s2Opts=s2Opts;
  }

  else if(type==='plan-event') {
    title.textContent='Add Planned Event';
    body.innerHTML=`
      <div class="form-group"><label>Event Label</label><input type="text" id="m-label" placeholder='e.g. "Keystone Retake — Algebra I"' /></div>
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="m-date" /></div>
        <div class="form-group"><label>Projected Score / Result (optional)</label><input type="text" id="m-proj" placeholder='e.g. "1550"' /></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePlannedEvent()">Add Event</button></div>`;
  }

  openModal();
}

function updateP5TypeOpts() {
  const sec=document.getElementById('m-section')?.value;
  const typeEl=document.getElementById('m-type');
  if(typeEl) typeEl.innerHTML=sec==='S1'?(window._p5s1Opts||''):(window._p5s2Opts||'');
}

// ── Pathway save handlers ─────────────────────────────────────
function saveKeystoneScore() {
  const subj=document.getElementById('m-subj')?.value;
  const date=document.getElementById('m-date')?.value;
  const score=Number(document.getElementById('m-score')?.value);
  if(!subj||!date||isNaN(score)||score<=0){toast('Please fill all fields.','error');return;}
  const level=calcKeystoneLevel(subj,score);
  state.keystoneScores.push({id:uid(),subject:subj,date,score,level});
  saveData();closeModal();renderP1();renderP2();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast(`Keystone score logged — ${level}.`,'success');
}

function saveP3Record() {
  const name=document.getElementById('m-name')?.value.trim();
  if(!name){toast('Please enter a description.','error');return;}
  state.p3Records.push({id:uid(),description:name,type:document.getElementById('m-type')?.value,date:document.getElementById('m-date')?.value,verified:document.getElementById('m-verified')?.checked});
  saveData();closeModal();renderP3();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast('CTE record saved.','success');
}

function saveP4Record() {
  const name=document.getElementById('m-name')?.value.trim();
  if(!name){toast('Please enter a name.','error');return;}
  state.p4Records.push({id:uid(),name,type:document.getElementById('m-type')?.value,date:document.getElementById('m-date')?.value,score:document.getElementById('m-score')?.value.trim(),notes:document.getElementById('m-notes')?.value.trim(),verified:document.getElementById('m-verified')?.checked});
  saveData();closeModal();renderP4();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast('Assessment logged.','success');
}

function saveP5Evidence() {
  const name=document.getElementById('m-name')?.value.trim();
  if(!name){toast('Please enter a description.','error');return;}
  state.p5Evidence.push({id:uid(),name,section:document.getElementById('m-section')?.value,type:document.getElementById('m-type')?.value,date:document.getElementById('m-date')?.value,score:document.getElementById('m-score')?.value.trim()});
  saveData();closeModal();renderP5();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast('Evidence added.','success');
}

function savePlannedEvent() {
  const label=document.getElementById('m-label')?.value.trim();
  const date=document.getElementById('m-date')?.value;
  if(!label||!date){toast('Please enter a label and date.','error');return;}
  state.plannedEvents.push({id:uid(),label,date,projectedScore:document.getElementById('m-proj')?.value.trim()});
  saveData();closeModal();renderProjection();
  toast('Planned event added.','success');
}

function deletePathwayEntry(listKey,id) {
  if(!confirm('Remove this entry?'))return;
  state[listKey]=state[listKey].filter(x=>x.id!==id);
  saveData();renderAll();toast('Entry removed.');
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════
function setupSettingsListeners() {
  document.getElementById('btn-save-student').addEventListener('click',()=>{
    state.student.name=document.getElementById('student-name').value.trim();
    state.student.gradYear=document.getElementById('grad-year').value.trim();
    state.student.school=document.getElementById('student-school').value.trim();
    saveData();renderDashboard();
    document.getElementById('new-year-school').value=state.student.school;
    toast('Student info saved.','success');
  });
  document.getElementById('btn-add-year').addEventListener('click',addYear);
  document.getElementById('new-year-name').addEventListener('keydown',e=>{if(e.key==='Enter')addYear();});
  document.getElementById('btn-add-req').addEventListener('click',addRequirement);
  document.getElementById('new-req-name').addEventListener('keydown',e=>{if(e.key==='Enter')addRequirement();});
  document.getElementById('btn-export').addEventListener('click',exportData);
  document.getElementById('import-file').addEventListener('change',importData);
  document.getElementById('btn-clear').addEventListener('click',clearData);
}

function renderSettingsStudent() {
  document.getElementById('student-name').value=state.student.name||'';
  document.getElementById('grad-year').value=state.student.gradYear||'';
  document.getElementById('student-school').value=state.student.school||'';
  const nys=document.getElementById('new-year-school');
  if(!nys.value&&state.student.school) nys.value=state.student.school;

  document.getElementById('years-list').innerHTML=state.years.length
    ?state.years.map(y=>`<div class="list-item">
        <div class="list-item-name-group"><span class="list-item-name">${esc(y.name)}</span>${y.school?`<span class="list-item-school">${esc(y.school)}</span>`:''}</div>
        <div class="list-item-actions">
          <button class="btn-icon" onclick="openEditYearModal('${y.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-icon delete" onclick="deleteYear('${y.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
        </div>
      </div>`).join('')
    :'<p class="text-muted" style="font-size:.85rem;padding:6px 0">No years added yet.</p>';
}

function renderSettingsRequirements() {
  document.getElementById('reqs-list').innerHTML=state.requirements.length
    ?state.requirements.map(r=>{
        const subList=(r.subReqs||[]).map(sr=>{
          const status=subReqStatus(r,sr),cr=Number(sr.credits)>0?`${fmt(sr.credits)} cr`:'0 cr';
          const dot=status==='earned'?'<span class="sr-dot sr-dot-earned">✓</span>':status==='planned'?'<span class="sr-dot sr-dot-planned">◷</span>':'<span class="sr-dot sr-dot-none">○</span>';
          return `<div class="subreq-item">${dot}<span class="subreq-item-name">${esc(sr.name)}</span><span class="subreq-item-credits">${cr}</span>
            <div class="subreq-item-actions">
              <button class="btn-icon" onclick="openEditSubReqModal('${r.id}','${sr.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="btn-icon delete" onclick="deleteSubReq('${r.id}','${sr.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
            </div></div>`;
        }).join('');
        return `<div class="req-list-block" id="req-block-${r.id}">
          <div class="list-item req-list-item"><span class="list-item-name">${esc(r.name)}</span><span class="list-item-credits">${fmt(r.credits)} cr</span>
            <div class="list-item-actions">
              <button class="btn-icon" onclick="openEditReqModal('${r.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
              <button class="btn-icon" onclick="toggleSubReqForm('${r.id}')"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
              <button class="btn-icon delete" onclick="deleteReq('${r.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
            </div></div>
          ${subList?`<div class="subreq-list">${subList}</div>`:''}
          <div class="subreq-add-form hidden" id="subreq-form-${r.id}">
            <input type="text" id="subreq-name-${r.id}" placeholder='Name (e.g. "Algebra I Required")' />
            <input type="number" id="subreq-credits-${r.id}" placeholder="Credits" min="0" step="0.5" class="input-credits-sm" />
            <button class="btn btn-secondary btn-sm" onclick="addSubReq('${r.id}')">Add</button>
            <button class="btn btn-outline btn-sm" onclick="toggleSubReqForm('${r.id}')">Cancel</button>
          </div></div>`;
      }).join('')
    :'<p class="text-muted" style="font-size:.85rem;padding:6px 0">No requirements added yet.</p>';
  document.getElementById('total-req-credits').textContent=fmt(totalRequired());
}

function renderBenchmarkInputs() {
  const bm=state.benchmarks;
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  set('bm-alg-prof',bm.keystone.algebra.prof); set('bm-alg-adv',bm.keystone.algebra.adv); set('bm-alg-bb',bm.keystone.algebra.bb);
  set('bm-lit-prof',bm.keystone.literature.prof); set('bm-lit-adv',bm.keystone.literature.adv); set('bm-lit-bb',bm.keystone.literature.bb);
  set('bm-bio-prof',bm.keystone.biology.prof); set('bm-bio-adv',bm.keystone.biology.adv); set('bm-bio-bb',bm.keystone.biology.bb);
  set('bm-act-composite',bm.p4?.act||21); set('bm-asvab',bm.p4?.asvab||31);
  set('bm-psat-composite',bm.p4?.psat||970); set('bm-sat-p4',bm.p4?.sat||1010);
}

function saveBenchmarks() {
  const g=id=>Number(document.getElementById(id)?.value)||0;
  state.benchmarks={
    keystone:{
      algebra:   {prof:g('bm-alg-prof'),adv:g('bm-alg-adv'),bb:g('bm-alg-bb')},
      literature:{prof:g('bm-lit-prof'),adv:g('bm-lit-adv'),bb:g('bm-lit-bb')},
      biology:   {prof:g('bm-bio-prof'),adv:g('bm-bio-adv'),bb:g('bm-bio-bb')}
    },
    p4:{act:g('bm-act-composite'),asvab:g('bm-asvab'),psat:g('bm-psat-composite'),sat:g('bm-sat-p4')}
  };
  saveData();renderAll();toast('Benchmarks saved.','success');
}

function resetBenchmarks() {
  if(!confirm('Reset all benchmarks to PA defaults?'))return;
  state.benchmarks=JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
  saveData();renderBenchmarkInputs();renderAll();toast('Benchmarks reset to PA defaults.','success');
}

// Year/Req CRUD
function openEditYearModal(yearId) {
  const y=state.years.find(x=>x.id===yearId);if(!y)return;
  document.getElementById('modal-title').textContent='Edit School Year';
  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>Year / Grade Label *</label><input type="text" id="edit-year-name" value="${esc(y.name)}" /></div>
    <div class="form-group" style="margin-top:12px"><label>School Name</label><input type="text" id="edit-year-school" value="${esc(y.school||'')}" /></div>
    <div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-save-year">Save</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-save-year').addEventListener('click',()=>{
    const name=document.getElementById('edit-year-name').value.trim();
    if(!name){toast('Please enter a year label.','error');return;}
    y.name=name;y.school=document.getElementById('edit-year-school').value.trim();
    saveData();closeModal();renderAll();toast('Year updated.','success');
  });
  openModal();document.getElementById('edit-year-name').focus();
}

function openEditReqModal(reqId) {
  const req=state.requirements.find(r=>r.id===reqId);if(!req)return;
  document.getElementById('modal-title').textContent='Edit Requirement';
  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>Name *</label><input type="text" id="edit-req-name" value="${esc(req.name)}" /></div>
    <div class="form-group" style="margin-top:12px"><label>Credits *</label><input type="number" id="edit-req-credits" value="${req.credits}" min="0" step="0.5" /></div>
    <div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-save-req">Save</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-save-req').addEventListener('click',()=>{
    const name=document.getElementById('edit-req-name').value.trim();
    const credits=parseFloat(document.getElementById('edit-req-credits').value);
    if(!name||isNaN(credits)||credits<0){toast('Please fill all fields correctly.','error');return;}
    req.name=name;req.credits=credits;saveData();closeModal();renderAll();toast('Requirement updated.','success');
  });
  openModal();document.getElementById('edit-req-name').focus();
}

function openEditSubReqModal(reqId,subId) {
  const req=state.requirements.find(r=>r.id===reqId);const sr=req?.subReqs?.find(s=>s.id===subId);if(!req||!sr)return;
  document.getElementById('modal-title').textContent='Edit Sub-Requirement';
  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>Name *</label><input type="text" id="edit-sub-name" value="${esc(sr.name)}" /></div>
    <p style="font-size:.78rem;color:var(--gray-600);margin:6px 0 10px"><i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i> Name is matched against course names to detect auto-completion.</p>
    <div class="form-group"><label>Credits (0 if informational)</label><input type="number" id="edit-sub-credits" value="${sr.credits||0}" min="0" step="0.5" /></div>
    <div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-save-sub">Save</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-save-sub').addEventListener('click',()=>{
    const name=document.getElementById('edit-sub-name').value.trim();
    if(!name){toast('Please enter a name.','error');return;}
    sr.name=name;sr.credits=parseFloat(document.getElementById('edit-sub-credits').value)||0;
    saveData();closeModal();renderAll();toast('Sub-requirement updated.','success');
  });
  openModal();document.getElementById('edit-sub-name').focus();
}

function toggleSubReqForm(reqId) {
  const form=document.getElementById(`subreq-form-${reqId}`);if(!form)return;
  form.classList.toggle('hidden');
  if(!form.classList.contains('hidden'))document.getElementById(`subreq-name-${reqId}`)?.focus();
}

function addSubReq(reqId) {
  const name=document.getElementById(`subreq-name-${reqId}`)?.value.trim();
  const credits=parseFloat(document.getElementById(`subreq-credits-${reqId}`)?.value)||0;
  if(!name){toast('Please enter a name.','error');return;}
  const req=state.requirements.find(r=>r.id===reqId);if(!req)return;
  req.subReqs=req.subReqs||[];
  if(req.subReqs.find(sr=>sr.name.toLowerCase()===name.toLowerCase())){toast('Sub-requirement already exists.','error');return;}
  req.subReqs.push({id:uid(),name,credits});
  saveData();renderAll();toast('Sub-requirement added.','success');
}

function deleteSubReq(reqId,subId) {
  const req=state.requirements.find(r=>r.id===reqId);if(!req)return;
  req.subReqs=(req.subReqs||[]).filter(sr=>sr.id!==subId);
  state.courses.forEach(c=>{if(c.reqId===reqId&&c.subReqId===subId)c.subReqId='';});
  saveData();renderAll();toast('Sub-requirement removed.');
}

function addYear() {
  const name=document.getElementById('new-year-name').value.trim();
  const school=document.getElementById('new-year-school').value.trim()||state.student.school||'';
  if(!name){toast('Please enter a year name.','error');return;}
  if(state.years.find(y=>y.name.toLowerCase()===name.toLowerCase())){toast('Year already exists.','error');return;}
  state.years.push({id:uid(),name,school});
  document.getElementById('new-year-name').value='';
  saveData();renderAll();toast('Year added.','success');
}

function deleteYear(yearId) {
  if(state.courses.some(c=>c.yearId===yearId)){if(!confirm('This year has courses. Deleting removes the year assignment. Continue?'))return;state.courses.forEach(c=>{if(c.yearId===yearId)c.yearId='';});}
  state.years=state.years.filter(y=>y.id!==yearId);saveData();renderAll();toast('Year removed.');
}

function addRequirement() {
  const name=document.getElementById('new-req-name').value.trim();
  const credits=parseFloat(document.getElementById('new-req-credits').value);
  if(!name){toast('Please enter a requirement name.','error');return;}
  if(isNaN(credits)||credits<=0){toast('Please enter a valid credit amount.','error');return;}
  if(state.requirements.find(r=>r.name.toLowerCase()===name.toLowerCase())){toast('Requirement already exists.','error');return;}
  state.requirements.push({id:uid(),name,credits,subReqs:[]});
  document.getElementById('new-req-name').value='';document.getElementById('new-req-credits').value='';
  saveData();renderAll();toast('Requirement added.','success');
}

function deleteReq(reqId) {
  if(state.courses.some(c=>c.reqId===reqId)){if(!confirm('Removing this will unassign courses. Continue?'))return;state.courses.forEach(c=>{if(c.reqId===reqId){c.reqId='';c.subReqId='';};});}
  state.requirements=state.requirements.filter(r=>r.id!==reqId);saveData();renderAll();toast('Requirement removed.');
}

// Import / Export
function exportData() {
  const a=Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),
    download:`gradtracker-${today()}.json`
  });a.click();toast('Data exported.','success');
}

function importData(e) {
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const parsed=JSON.parse(ev.target.result);
      if(!confirm('This will replace all current data. Continue?'))return;
      if(!parsed.benchmarks)parsed.benchmarks=JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
      ['keystoneScores','p3Records','p4Records','p5Evidence','plannedEvents'].forEach(k=>{if(!parsed[k])parsed[k]=[];});
      if(parsed.student&&!parsed.student.school)parsed.student.school='';
      if(parsed.years)parsed.years=parsed.years.map(y=>({school:'',...y}));
      if(parsed.requirements)parsed.requirements=parsed.requirements.map(r=>({...r,subReqs:(r.subReqs||[]).map(sr=>({credits:0,...sr}))}));
      Object.assign(state,parsed);saveData();renderAll();renderBenchmarkInputs();toast('Data imported.','success');
    }catch{toast('Invalid file format.','error');}
  };reader.readAsText(file);e.target.value='';
}

function clearData() {
  if(!confirm('Clear ALL data including courses, pathways, and benchmarks?'))return;
  state={student:{name:'',gradYear:'',school:''},years:[],requirements:[],courses:[],
    benchmarks:JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)),
    keystoneScores:[],p3Records:[],p4Records:[],p5Evidence:[],plannedEvents:[]};
  saveData();renderAll();renderBenchmarkInputs();toast('All data cleared.');
}

// Modal
function openModal(){document.getElementById('modal-overlay').classList.remove('hidden');document.body.style.overflow='hidden';}
function closeModal(){document.getElementById('modal-overlay').classList.add('hidden');document.body.style.overflow='';}
document.getElementById('modal-close').addEventListener('click',closeModal);
document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('modal-overlay'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

// Toast
let _toastTimer;
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className='toast'+(type?' '+type:'');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>{el.classList.add('toast-fade');setTimeout(()=>el.classList.add('hidden'),300);},2500);
}

function esc(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function registerSW(){if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});}
