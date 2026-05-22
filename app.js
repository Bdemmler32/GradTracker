/* ============================================================
   GradTracker v1.7.4
   - Exploring status (4th status, excluded from all calculations)
   - Updated PA Keystone benchmark defaults
   ============================================================ */
'use strict';

const STORAGE_KEY = 'gradtracker_data_v1';

const DEFAULT_BENCHMARKS = {
  keystone: {
    algebra:    { prof:1500, adv:1546, bb:1438 },
    literature: { prof:1500, adv:1584, bb:1443 },
    biology:    { prof:1500, adv:1549, bb:1459 }
  },
  p4: { act:21, asvab:31, psat:970, sat:1010 }
};

// ── State ─────────────────────────────────────────────────────
// courses[].status: 'earned' | 'working' | 'planned' | 'exploring'
// 'exploring' is excluded from ALL credit calculations — scratchpad only
// courses[].catalogRef: null | { catalogId, courseId }
let state = {
  student:      { name:'', gradYear:'', school:'' },
  years:        [],
  requirements: [],
  courses:      [],   // [{id,name,yearId,credits,grade,type,reqId,subReqId,status,catalogRef}]
  benchmarks:   JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)),
  keystoneScores:  [],
  p3Records:       [],
  p4Records:       [],
  p5Evidence:      [],
  plannedEvents:   []
};

// ── Catalog cache (session only — not persisted) ───────────────
let _catalogManifest  = [];          // [{file,school,school_id,year,catalog_id}]
let _catalogCache     = new Map();   // catalogId -> full catalog object
let _catalogsLoaded   = false;

function loadData() {
  try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; }
  catch { return null; }
}
function saveData() { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }

// ── Constants ─────────────────────────────────────────────────
const GRADES            = ['A','B','C','D','F','P','NP','W','I','AU'];
const COURSE_TYPES      = ['Standard','VC','BC','AC'];
const COURSE_STATUSES   = ['earned','working','planned','exploring'];
const KEYSTONE_SUBJECTS = ['Algebra I','Literature','Biology'];
const KEYSTONE_KEYS     = ['algebra','literature','biology'];

const P4_TYPES = [
  {key:'act',       label:'ACT',                       threshold:21,   scoreLabel:'Composite Score'},
  {key:'workkeys',  label:'ACT WorkKeys NCRC (Gold)',   threshold:null, scoreLabel:'Level achieved'},
  {key:'asvab',     label:'ASVAB AFQT',                threshold:31,   scoreLabel:'Composite Score'},
  {key:'psat',      label:'PSAT/NMSQT',                threshold:970,  scoreLabel:'Total Score'},
  {key:'sat',       label:'SAT',                       threshold:1010, scoreLabel:'Total Score'},
  {key:'ap',        label:'AP Exam (≥3 per area)',      threshold:3,    scoreLabel:'Score'},
  {key:'ib',        label:'IB Exam (≥4 per area)',      threshold:4,    scoreLabel:'Score'},
  {key:'concurrent',label:'Concurrent Enrollment',      threshold:null, scoreLabel:'Grade'},
  {key:'college4yr',label:'4-Year College Acceptance',  threshold:null, scoreLabel:'Institution'},
  {key:'apprentice',label:'Pre-Apprenticeship Program', threshold:null, scoreLabel:'Program Name'}
];
const P5_S1_TYPES = [
  {key:'sat-subj',    label:'SAT Subject Test',           threshold:630,  scoreLabel:'Score'},
  {key:'workkeys-s',  label:'ACT WorkKeys (Silver)',       threshold:null, scoreLabel:'Level'},
  {key:'ap-s1',       label:'AP Exam',                    threshold:3,    scoreLabel:'Score'},
  {key:'ib-s1',       label:'IB Exam',                    threshold:3,    scoreLabel:'Score'},
  {key:'concurrent-s1',label:'Concurrent Enrollment',     threshold:null, scoreLabel:'Grade'},
  {key:'college2yr',  label:'2-Year College Acceptance',  threshold:null, scoreLabel:'Institution'},
  {key:'credential',  label:'Industry-Recognized Credential',threshold:null,scoreLabel:'Credential Name'}
];
const P5_S2_TYPES = [
  {key:'keystone-s2', label:'Keystone Proficient+',               threshold:null, scoreLabel:'Score'},
  {key:'service',     label:'Service-Learning Project',            threshold:null, scoreLabel:'Description'},
  {key:'internship',  label:'Internship / Externship / Co-op',     threshold:null, scoreLabel:'Hours/Details'},
  {key:'ncaa',        label:'NCAA Division II Requirements',        threshold:null, scoreLabel:'Confirmation'},
  {key:'military',    label:'Military Enlistment / Employment Letter',threshold:null,scoreLabel:'Details'}
];

// ── Globals (before init — TDZ safety) ───────────────────────
let courseReqFilter       = '';
let _sidebarOpen          = { pathways:false, settings:false };
let _groupClickInProgress = false;
let _statsView            = 'progress'; // 'progress' | 'gap'
let _yearFilter           = '';

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
(async function init() {
  checkMobileGate();
  window.addEventListener('resize', checkMobileGate);

  const saved = loadData();
  if (saved) {
    if (!saved.benchmarks) saved.benchmarks = JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
    else saved.benchmarks = Object.assign(JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)), saved.benchmarks);
    ['keystoneScores','p3Records','p4Records','p5Evidence','plannedEvents'].forEach(k=>{if(!saved[k])saved[k]=[];});
    if (saved.student && !saved.student.school) saved.student.school='';
    if (saved.years) saved.years=saved.years.map(y=>({school:'',...y}));
    if (saved.requirements) saved.requirements=saved.requirements.map(r=>({...r,subReqs:(r.subReqs||[]).map(sr=>({credits:0,...sr}))}));
    // ── BATCH 1: Migrate planned bool → status string ──────────
    if (saved.courses) {
      saved.courses = saved.courses.map(c => {
        if (c.status) return c; // already migrated
        return {
          ...c,
          status: c.planned ? 'planned' : 'earned',
          catalogRef: c.catalogRef || null,
          planned: undefined // remove old field
        };
      });
    }
    Object.assign(state, saved);
  }

  setupNavigation();
  setupSettingsListeners();
  setupCoursesListeners();
  renderAll();
  renderBenchmarkInputs();
  registerSW();
  navigateTo('dashboard');
  if (!state.student.name && state.courses.length===0) showOnboarding();

  // Load catalog manifest async — non-blocking
  loadCatalogManifest().catch(()=>{});
})();

function checkMobileGate() {
  const narrow = window.innerWidth < 900;
  document.getElementById('mobile-gate').style.display  = narrow?'flex':'none';
  document.getElementById('sidebar').style.display      = narrow?'none':'';
  document.getElementById('main-content').style.display = narrow?'none':'';
}

// ══════════════════════════════════════════════════════════════
// CATALOG INFRASTRUCTURE  (Batch 3)
// ══════════════════════════════════════════════════════════════
async function loadCatalogManifest() {
  try {
    const r = await fetch('./catalogs/manifest.json');
    if (!r.ok) throw new Error('No manifest');
    _catalogManifest = await r.json();
    _catalogsLoaded  = true;
  } catch {
    _catalogManifest = [];
    _catalogsLoaded  = true;
  }
}

async function loadCatalog(catalogId) {
  if (_catalogCache.has(catalogId)) return _catalogCache.get(catalogId);
  const entry = _catalogManifest.find(m=>m.catalog_id===catalogId);
  if (!entry) return null;
  try {
    const r = await fetch(`./catalogs/${entry.file}`);
    if (!r.ok) throw new Error('Not found');
    const data = await r.json();
    _catalogCache.set(catalogId, data);
    return data;
  } catch { return null; }
}

// Parse "1.0 credit" → 1.0
function parseCreditStr(s) {
  const m = String(s||'').match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : 0;
}

// Get catalog entry referenced by a course
function getCatalogEntry(course) {
  if (!course.catalogRef) return null;
  const cat = _catalogCache.get(course.catalogRef.catalogId);
  if (!cat) return null;
  return cat.courses?.find(c=>c.course_id===course.catalogRef.courseId) || null;
}

// Auto-suggest catalog based on student school
function suggestedCatalogId() {
  if (!state.student.school) return null;
  const school = state.student.school.toLowerCase();
  const match = _catalogManifest.find(m =>
    m.school.toLowerCase().includes(school) ||
    school.includes(m.school_id.toLowerCase())
  );
  return match?.catalog_id || null;
}

// ══════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link=>{
    link.addEventListener('click',e=>{
      e.preventDefault();
      const page=link.dataset.page, group=link.dataset.group;
      if (group) {
        _groupClickInProgress=true;
        toggleGroup(group);
        _groupClickInProgress=false;
        if (page) navigateTo(page,null,true);
      } else if (page) navigateTo(page);
    });
  });
  document.querySelectorAll('.inline-link').forEach(link=>{
    link.addEventListener('click',e=>{e.preventDefault();const p=link.dataset.page;if(p)navigateTo(p);});
  });
}

function toggleGroup(g) { _sidebarOpen[g]=!_sidebarOpen[g]; applyGroupState(g); }
function openGroup(g)   { if(_sidebarOpen[g])return; _sidebarOpen[g]=true; applyGroupState(g); }
function applyGroupState(g) {
  document.getElementById(`sub-${g}`)?.classList.toggle('open',_sidebarOpen[g]);
  document.getElementById(`chevron-${g}`)?.classList.toggle('rotated',_sidebarOpen[g]);
}

function navigateTo(page, extraData, fromGroupHeader=false) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'));
  document.getElementById('page-'+page)?.classList.add('active');
  const exactLink=document.querySelector(`.nav-link[data-page="${page}"]:not([data-group])`);
  if(exactLink)exactLink.classList.add('active');
  if(page.startsWith('pathways-')){document.querySelector('.nav-link[data-group="pathways"]')?.classList.add('active');if(!fromGroupHeader)openGroup('pathways');}
  else if(page.startsWith('settings-')){document.querySelector('.nav-link[data-group="settings"]')?.classList.add('active');if(!fromGroupHeader)openGroup('settings');}
  if(page==='courses'&&extraData?.reqId!==undefined)courseReqFilter=extraData.reqId;
  const renders={
    'dashboard':renderDashboard,'courses':renderCourses,'stats':renderStats,
    'pathways-overview':renderPathwayOverview,'pathways-p1':renderP1,'pathways-p2':renderP2,
    'pathways-p3':renderP3,'pathways-p4':renderP4,'pathways-p5':renderP5,
    'pathways-projection':renderProjection,
    'settings-student':renderSettingsStudent,'settings-requirements':renderSettingsRequirements,
    'settings-benchmarks':()=>{},'data-management':()=>{}
  };
  renders[page]?.();
}

function renderAll() {
  renderDashboard();renderCourses();renderStats();
  renderPathwayOverview();renderP1();renderP2();renderP3();renderP4();renderP5();
  renderProjection();renderSettingsStudent();renderSettingsRequirements();
  updatePathwayNavDots();
}

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════
function uid()    { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function fmtDate(d){ if(!d)return'—';const p=d.split('-');return`${p[1]}/${p[2]}/${p[0]}`; }
function today()  { return new Date().toISOString().slice(0,10); }
function esc(s)   { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n)   { const v=Number(n); return isNaN(v)?'0':parseFloat(v.toFixed(2)).toString(); }

function getYear(id)    { return state.years.find(y=>y.id===id); }
function getYearName(id){ return getYear(id)?.name||'—'; }
function getReq(id)     { return state.requirements.find(r=>r.id===id); }
function getReqName(id) { return getReq(id)?.name||'Uncategorized'; }

// ── BATCH 2: Status-aware credit helpers ──────────────────────
// earned   = status === 'earned'
// working  = status === 'working'  (counts toward projected/in-progress)
// planned  = status === 'planned'  (future intent)
function isEarned(c)    { return c.status==='earned'; }
function isWorking(c)   { return c.status==='working'; }
function isPlanned(c)   { return c.status==='planned'; }
function isExploring(c) { return c.status==='exploring'; }
function isNotEarned(c) { return c.status!=='earned'; }
// Courses that count toward any credit calculation (exploring is excluded)
function countsToward(c){ return c.status!=='exploring'; }

function creditsEarnedForReq(reqId)  { return state.courses.filter(c=>c.reqId===reqId&&isEarned(c)).reduce((s,c)=>s+Number(c.credits||0),0); }
function creditsWorkingForReq(reqId) { return state.courses.filter(c=>c.reqId===reqId&&isWorking(c)).reduce((s,c)=>s+Number(c.credits||0),0); }
function creditsPlannedForReq(reqId) { return state.courses.filter(c=>c.reqId===reqId&&isPlanned(c)).reduce((s,c)=>s+Number(c.credits||0),0); }

function totalEarned()  { return state.courses.filter(isEarned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalWorking() { return state.courses.filter(isWorking).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalPlanned() { return state.courses.filter(isPlanned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalRequired(){ return state.requirements.reduce((s,r)=>s+Number(r.credits||0),0); }

function creditsByYear() {
  const map={};
  state.years.forEach(y=>{map[y.id]={earned:0,working:0,planned:0};});
  state.courses.forEach(c=>{
    if(!c.yearId)return;
    if(!map[c.yearId])map[c.yearId]={earned:0,working:0,planned:0};
    const cr=Number(c.credits||0);
    if(isEarned(c))  map[c.yearId].earned+=cr;
    else if(isWorking(c)) map[c.yearId].working+=cr;
    else if(isPlanned(c)) map[c.yearId].planned+=cr;
  });
  return map;
}

// Sub-req status with working support
// Sub-req status — exploring courses never satisfy a sub-req
function subReqStatus(req,sr) {
  const n=sr.name.trim().toLowerCase();
  const m=state.courses.filter(c=>c.reqId===req.id&&c.name.trim().toLowerCase()===n&&!isExploring(c));
  if(m.some(isEarned))  return 'earned';
  if(m.some(isWorking)) return 'working';
  if(m.some(isPlanned)) return 'planned';
  return null;
}

// ── Keystone helpers ──────────────────────────────────────────
function calcKeystoneLevel(subject, score) {
  const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(subject)];
  const bm=state.benchmarks.keystone[key];
  if(!bm)return 'Basic';
  if(score>=bm.adv) return 'Advanced';
  if(score>=bm.prof)return 'Proficient';
  if(bm.bb&&score<=bm.bb)return 'Below Basic';
  return 'Basic';
}

function getKeystoneSubjectData() {
  const bm=state.benchmarks.keystone;
  const subj={algebra:{met:false,belowBasic:false,best:null},literature:{met:false,belowBasic:false,best:null},biology:{met:false,belowBasic:false,best:null}};
  state.keystoneScores.forEach(s=>{
    const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(s.subject)];if(!key)return;
    const b=bm[key];
    if(!subj[key].best||s.score>subj[key].best)subj[key].best=s.score;
    if(s.score>=b.prof)subj[key].met=true;
    if(b.bb&&s.score<=b.bb)subj[key].belowBasic=true;
  });
  return subj;
}

// ══════════════════════════════════════════════════════════════
// PATHWAY STATUS COMPUTATIONS
// ══════════════════════════════════════════════════════════════
function p1Status() {
  const subj=getKeystoneSubjectData();
  const allMet=Object.values(subj).every(s=>s.met);
  const anyMet=Object.values(subj).some(s=>s.met);
  return {subjects:subj,met:allMet,status:allMet?'met':anyMet?'partial':'none'};
}
function p2Status() {
  const subj=getKeystoneSubjectData();
  const scores=KEYSTONE_KEYS.map(k=>subj[k].best).filter(x=>x!==null);
  if(!scores.length)return{met:false,status:'none',mode:null,composite:0};
  const anyBB=KEYSTONE_KEYS.some(k=>subj[k].belowBasic);
  const anyProf=KEYSTONE_KEYS.some(k=>subj[k].met);
  if(anyBB||!anyProf)return{met:false,status:scores.length?'partial':'none',mode:null,composite:0};
  const c3=scores.length>=3?scores.slice().sort((a,b)=>b-a).slice(0,3).reduce((s,x)=>s+x,0):null;
  const c2=scores.length>=2?scores.slice().sort((a,b)=>b-a).slice(0,2).reduce((s,x)=>s+x,0):null;
  if(c3!==null&&c3>=4452)return{met:true,status:'met',mode:'3-score',composite:c3};
  if(c2!==null&&c2>=2939)return{met:true,status:'met',mode:'2-score',composite:c2};
  const best=Math.max(...[c3,c2].filter(x=>x!==null));
  return{met:false,status:'partial',mode:null,composite:best};
}
function p3Status() {
  const v=state.p3Records.filter(r=>r.verified);
  return{met:v.length>0,status:v.length>0?'met':state.p3Records.length?'partial':'none',count:v.length};
}
function p4Status() {
  const q=state.p4Records.filter(r=>{
    const t=P4_TYPES.find(x=>x.key===r.type);if(!t)return false;
    if(t.threshold===null)return r.verified||r.score;
    return Number(r.score)>=t.threshold;
  });
  return{met:q.length>0,status:q.length>0?'met':state.p4Records.length?'partial':'none',qualifying:q};
}
function p5Status() {
  const s1=state.p5Evidence.filter(e=>e.section==='S1');
  const s2=state.p5Evidence.filter(e=>e.section==='S2');
  const total=s1.length+s2.length;
  const met=s1.length>=1&&total>=3;
  return{met,s1Count:s1.length,s2Count:s2.length,total,status:met?'met':total>0?'partial':'none'};
}
function allPathwayStatuses() { return{p1:p1Status(),p2:p2Status(),p3:p3Status(),p4:p4Status(),p5:p5Status()}; }
function isPathwayEligible(s) { return Object.values(s).some(x=>x.met); }

function updatePathwayNavDots() {
  const s=allPathwayStatuses();
  const map={'pdot-p1':s.p1,'pdot-p2':s.p2,'pdot-p3':s.p3,'pdot-p4':s.p4,'pdot-p5':s.p5};
  Object.entries(map).forEach(([id,st])=>{const el=document.getElementById(id);if(el)el.className='pathway-status-dot '+(st.status==='met'?'dot-met':st.status==='partial'?'dot-partial':'dot-none');});
  const el=document.getElementById('pdot-overall');
  const elig=isPathwayEligible(s),any=Object.values(s).some(x=>x.status==='partial');
  if(el)el.className='pathway-status-dot '+(elig?'dot-met':any?'dot-partial':'dot-none');
}

// ══════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════
function showOnboarding(){document.getElementById('onboard-overlay').classList.remove('hidden');document.getElementById('ob-name').focus();}
function hideOnboarding(){document.getElementById('onboard-overlay').classList.add('hidden');}
document.getElementById('ob-next').addEventListener('click',()=>{
  const name=document.getElementById('ob-name').value.trim();
  const school=document.getElementById('ob-school').value.trim();
  const gradYear=document.getElementById('ob-grad-year').value.trim();
  state.student={name,school,gradYear};saveData();
  document.getElementById('student-name').value=name;
  document.getElementById('student-school').value=school;
  document.getElementById('grad-year').value=gradYear;
  document.getElementById('new-year-school').value=school;
  hideOnboarding();navigateTo('settings-requirements');renderDashboard();
  toast(`Welcome, ${name||'there'}! Now add your graduation requirements.`,'success');
});
document.getElementById('ob-skip').addEventListener('click',hideOnboarding);

// ══════════════════════════════════════════════════════════════
// DASHBOARD  (Batch 2 — tri-state bars)
// ══════════════════════════════════════════════════════════════
function renderDashboard() {
  const earned=totalEarned(),working=totalWorking(),planned=totalPlanned(),required=totalRequired();
  const pctE=required>0?Math.min(100,(earned/required)*100):0;
  const pctW=required>0?Math.min(100-pctE,(working/required)*100):0;
  const pctP=required>0?Math.min(100-pctE-pctW,(planned/required)*100):0;
  const pctAll=required>0?Math.min(100,((earned+working+planned)/required)*100):0;

  document.getElementById('dash-heading').textContent=state.student.name?`Welcome, ${state.student.name}`:'Dashboard';
  const sub=[];
  if(state.student.school)   sub.push(state.student.school);
  if(state.student.gradYear) sub.push(`Class of ${state.student.gradYear}`);
  document.getElementById('dash-subtitle').textContent=sub.length?sub.join(' · '):'Your graduation progress at a glance';

  document.getElementById('dash-earned').textContent=fmt(earned);
  document.getElementById('dash-required').textContent=fmt(required);
  document.getElementById('dash-pct').textContent=fmt(pctE)+'%';
  document.getElementById('dash-progress-bar').style.width=pctE+'%';
  document.getElementById('dash-working-bar').style.width=pctW+'%';
  document.getElementById('dash-planned-bar').style.width=pctP+'%';

  // Working row
  const workWrap=document.getElementById('dash-working-wrap');
  if(workWrap){workWrap.style.visibility=working>0?'visible':'hidden';const ws=document.getElementById('dash-working');if(ws)ws.textContent=fmt(working);}
  // Planned row
  const planWrap=document.getElementById('dash-planned-wrap');
  if(planWrap){planWrap.style.visibility=planned>0?'visible':'hidden';const ps=document.getElementById('dash-planned');if(ps)ps.textContent=fmt(planned);}
  // Legend visibility
  document.getElementById('legend-working-item').style.display=working>0?'':'none';
  document.getElementById('legend-planned-item').style.display=planned>0?'':'none';

  // Combined % below main
  const pctEl=document.getElementById('dash-pct-with-planned');
  if((working>0||planned>0)&&required>0){pctEl.textContent=fmt(pctAll)+'% projected';pctEl.style.display='block';}
  else pctEl.style.display='none';

  document.getElementById('no-requirements-notice').classList.toggle('hidden',state.requirements.length>0);

  // Pathway summary
  const s=allPathwayStatuses();
  const eligible=isPathwayEligible(s);
  const badge=document.getElementById('dash-pathway-elig-badge');
  if(eligible){badge.textContent='✓ Eligible';badge.className='dash-pathway-elig-badge elig-yes';}
  else if(Object.values(s).some(x=>x.status==='partial')){badge.textContent='In Progress';badge.className='dash-pathway-elig-badge elig-partial';}
  else{badge.textContent='Not Yet Determined';badge.className='dash-pathway-elig-badge elig-no';}

  const pways=[
    {id:'p1',label:'Pathway 1\nKeystone'},
    {id:'p2',label:'Pathway 2\nComposite'},
    {id:'p3',label:'Pathway 3\nCTE'},
    {id:'p4',label:'Pathway 4\nAlt.'},
    {id:'p5',label:'Pathway 5\nEvidence'}
  ];
  document.getElementById('dash-pathway-grid').innerHTML=pways.map(p=>{
    const st=s[p.id].status;
    const icon=st==='met'?'fa-circle-check':st==='partial'?'fa-hourglass-half':'fa-circle';
    const cls=st==='met'?'dp-met':st==='partial'?'dp-partial':'dp-none';
    const [l1,l2]=p.label.split('\n');
    return `<div class="dp-item ${cls}" onclick="event.stopPropagation();navigateTo('pathways-${p.id}')">
      <i class="fa-solid ${icon} dp-icon"></i>
      <div class="dp-label">${l1}<br><span>${l2}</span></div>
    </div>`;
  }).join('');

  // Requirement cards
  const grid=document.getElementById('dash-req-grid');
  grid.innerHTML='';
  state.requirements.forEach(req=>{
    const e=creditsEarnedForReq(req.id),w=creditsWorkingForReq(req.id),p=creditsPlannedForReq(req.id);
    const pct=req.credits>0?Math.min(100,(e/req.credits)*100):0;
    const pctW=req.credits>0?Math.min(100-pct,(w/req.credits)*100):0;
    const pctP=req.credits>0?Math.min(100-pct-pctW,(p/req.credits)*100):0;
    const complete=e>=req.credits&&req.credits>0;
    // (#1) still needed after earned+working+planned
    const stillNeeded=Math.max(0,req.credits-e-w-p);
    const subHtml=(req.subReqs||[]).length?`
      <div class="req-card-subreqs">${req.subReqs.map(sr=>{
        const st=subReqStatus(req,sr);
        const cr=Number(sr.credits)>0?` (${fmt(sr.credits)})`:'';
        const cls=st==='earned'?'subreq-chip sr-met':st==='working'?'subreq-chip sr-working':st==='planned'?'subreq-chip sr-planned':'subreq-chip';
        const icon=st==='earned'?'<i class="fa-solid fa-check"></i> ':st==='working'?'<i class="fa-solid fa-bolt"></i> ':st==='planned'?'<i class="fa-solid fa-clock"></i> ':'';
        return `<span class="${cls}">${icon}${esc(sr.name)}${cr}</span>`;
      }).join('')}</div>`:''  ;
    const notesHtml=w>0||p>0?`<div class="req-card-projected">${w>0?`<span class="proj-working"><i class="fa-solid fa-bolt"></i> ${fmt(w)} working</span>`:''} ${p>0?`<span class="proj-planned"><i class="fa-solid fa-clock"></i> ${fmt(p)} planned</span>`:''}</div>`:'';
    const neededHtml=!complete&&stillNeeded>0?`<div class="req-card-needed"><i class="fa-solid fa-hourglass-half"></i> ${fmt(stillNeeded)} still needed</div>`:'';
    grid.innerHTML+=`
      <div class="req-card ${complete?'complete':''}" role="button" tabindex="0"
           onclick="openReqCourses('${req.id}')" onkeydown="if(event.key==='Enter')openReqCourses('${req.id}')">
        <span class="req-badge">${complete?'✓ Met':fmt(pct)+'%'}</span>
        <div class="req-card-name">${esc(req.name)}</div>
        <div class="req-card-credits">${fmt(e)} <span>/ ${fmt(req.credits)} credits</span></div>
        ${notesHtml}${neededHtml}${subHtml}
        <div class="req-card-bar-wrap">
          <div class="req-card-bar" style="width:${pct}%"></div>
          <div class="req-card-bar working-seg" style="width:${pctW}%"></div>
          <div class="req-card-bar planned-seg" style="width:${pctP}%"></div>
        </div>
        <div class="req-card-click-hint">
          <svg viewBox="0 0 24 24" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          View courses
        </div>
      </div>`;
  });

  // (#9) "Other" virtual card — uncategorized courses (no reqId)
  const otherCourses=state.courses.filter(c=>!c.reqId&&!isExploring(c));
  if(otherCourses.length){
    const oE=otherCourses.filter(isEarned).reduce((s,c)=>s+Number(c.credits||0),0);
    const oW=otherCourses.filter(isWorking).reduce((s,c)=>s+Number(c.credits||0),0);
    const oP=otherCourses.filter(isPlanned).reduce((s,c)=>s+Number(c.credits||0),0);
    const notesHtml=oW>0||oP>0?`<div class="req-card-projected">${oW>0?`<span class="proj-working"><i class="fa-solid fa-bolt"></i> ${fmt(oW)} working</span>`:''} ${oP>0?`<span class="proj-planned"><i class="fa-solid fa-clock"></i> ${fmt(oP)} planned</span>`:''}</div>`:'';
    grid.innerHTML+=`
      <div class="req-card req-card-other" role="button" tabindex="0"
           onclick="openReqCourses('')" onkeydown="if(event.key==='Enter')openReqCourses('')">
        <span class="req-badge" style="background:var(--gray-100);color:var(--gray-500)">Other</span>
        <div class="req-card-name" style="color:var(--gray-600)">Other / Electives</div>
        <div class="req-card-credits">${fmt(oE)} <span>credits not applied to requirements</span></div>
        ${notesHtml}
        <div class="req-card-bar-wrap">
          <div class="req-card-bar" style="width:100%;background:var(--gray-300)"></div>
        </div>
        <div class="req-card-click-hint">
          <svg viewBox="0 0 24 24" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          View courses
        </div>
      </div>`;
  }

  // Year cards — (#4) clickable to filter courses, (#6) match req-grid column sizing
  const yearCards=document.getElementById('dash-year-cards');
  yearCards.innerHTML='';
  const byYear=creditsByYear();
  state.years.forEach(y=>{
    const {earned:e,working:w,planned:p}=byYear[y.id]||{earned:0,working:0,planned:0};
    const cnt=state.courses.filter(co=>co.yearId===y.id).length;
    yearCards.innerHTML+=`<div class="year-card" role="button" tabindex="0"
         onclick="openYearCourses('${y.id}')" onkeydown="if(event.key==='Enter')openYearCourses('${y.id}')">
      <div class="year-card-name">${esc(y.name)}</div>
      ${y.school?`<div class="year-card-school">${esc(y.school)}</div>`:''}
      <div class="year-card-credits">${fmt(e)}</div>
      ${w>0?`<div class="year-card-working"><i class="fa-solid fa-bolt"></i> ${fmt(w)} working</div>`:''}
      ${p>0?`<div class="year-card-planned"><i class="fa-solid fa-clock"></i> ${fmt(p)} planned</div>`:''}
      <div class="year-card-sub">${cnt} course${cnt!==1?'s':''}</div>
      <div class="req-card-click-hint" style="margin-top:6px">
        <svg viewBox="0 0 24 24" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        View courses
      </div>
    </div>`;
  });
  if(!state.years.length&&state.requirements.length>0)
    yearCards.innerHTML='<p class="text-muted" style="font-size:.85rem">No school years defined yet.</p>';

  // (#3) Total remaining in overall-card
  const totalRemaining=Math.max(0,required-earned-working-planned);
  const remEl=document.getElementById('dash-total-remaining');
  if(remEl){
    if(totalRemaining>0&&required>0){
      remEl.textContent=`${fmt(totalRemaining)} credits still needed`;
      remEl.style.display='block';
    } else {
      remEl.style.display='none';
    }
  }
}

function openReqCourses(reqId){courseReqFilter=reqId;navigateTo('courses',{reqId});}

// (#4) Filter courses by year
function openYearCourses(yearId){
  navigateTo('courses');
  const fyEl=document.getElementById('filter-year');
  if(fyEl){fyEl.value=yearId;renderCourses();}
}

// (#2) Stats view toggle
function toggleStatsView(){
  _statsView=_statsView==='progress'?'gap':'progress';
  const btn=document.getElementById('stats-view-toggle');
  if(btn){btn.textContent=_statsView==='gap'?'Show Progress View':'Show Gap View';}
  renderStats();
}

// ══════════════════════════════════════════════════════════════
// COURSES  (Batch 2+5 — status dropdown + catalog display)
// ══════════════════════════════════════════════════════════════
function setupCoursesListeners() {
  document.getElementById('btn-add-course').addEventListener('click',()=>openAddCourseChoice());
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
  if(fyEl.value)   courses=courses.filter(c=>c.yearId===fyEl.value);
  if(frEl.value)   courses=courses.filter(c=>c.reqId===frEl.value);
  if(savedS==='earned')     courses=courses.filter(c=>isEarned(c));
  if(savedS==='working')    courses=courses.filter(c=>isWorking(c));
  if(savedS==='planned')    courses=courses.filter(c=>isPlanned(c));
  if(savedS==='exploring')  courses=courses.filter(c=>isExploring(c));

  const tbody=document.getElementById('courses-tbody');
  if(!courses.length){tbody.innerHTML='<tr class="empty-row"><td colspan="9">No courses match the current filters.</td></tr>';return;}

  const yo=state.years.reduce((m,y,i)=>{m[y.id]=i;return m;},{});
  courses.sort((a,b)=>{
    const order={'earned':0,'working':1,'planned':2,'exploring':3};
    const od=(order[a.status]??0)-(order[b.status]??0);
    if(od!==0)return od;
    return(yo[a.yearId]??99)-(yo[b.yearId]??99);
  });

  tbody.innerHTML=courses.map(c=>{
    const gClass=['A','B','C','D','F','P'].includes(c.grade)?c.grade:'';
    const status=c.status||'earned';
    const statusSel=`<select class="status-select sel-${status}" onchange="handleStatusChange('${c.id}',this.value)">
      <option value="earned"    ${status==='earned'    ?'selected':''}>Earned</option>
      <option value="working"   ${status==='working'   ?'selected':''}>Working On</option>
      <option value="planned"   ${status==='planned'   ?'selected':''}>Planned</option>
      <option value="exploring" ${status==='exploring' ?'selected':''}>Exploring</option>
    </select>`;
    const typeBadge=c.type&&c.type!=='Standard'?`<span class="type-badge type-${c.type}">${esc(c.type)}</span>`:c.type==='Standard'?'<span class="type-badge type-std">Std</span>':'—';

    const req=getReq(c.reqId);
    let catDisplay=esc(getReqName(c.reqId));
    if(c.subReqId&&req){const sub=req.subReqs?.find(sr=>sr.id===c.subReqId);if(sub)catDisplay+=`<br><span class="subreq-label">${esc(sub.name)}</span>`;}

    let srMatch='';
    if(req&&!isExploring(c)){const mSr=req.subReqs?.find(sr=>sr.name.trim().toLowerCase()===c.name.trim().toLowerCase());if(mSr){const st=subReqStatus(req,mSr);if(st)srMatch=`<span class="sr-match-tag sr-match-${st}">${st==='earned'?'<i class="fa-solid fa-check"></i>':st==='working'?'<i class="fa-solid fa-bolt"></i>':'<i class="fa-solid fa-clock"></i>'} Sub-req</span>`;}}

    // Catalog action icon (no badge in name cell)
    const hasCatalogLink=!!c.catalogRef;

    const rowCls=status==='earned'?'':status==='working'?'row-working':status==='exploring'?'row-exploring':'row-planned';
    return `<tr class="${rowCls}">
      <td class="td-course-name">${esc(c.name)}${srMatch}</td>
      <td class="td-year">${esc(getYearName(c.yearId))}</td>
      <td class="col-center"><strong>${fmt(c.credits)}</strong></td>
      <td class="col-center">${c.grade?`<span class="grade-badge ${gClass}">${esc(c.grade)}</span>`:'—'}</td>
      <td class="col-center">${typeBadge}</td>
      <td class="td-cat">${catDisplay}</td>
      <td class="col-center">${statusSel}</td>
      <td><div class="action-btns">
        <button class="btn-icon" onclick="openCourseModal('${c.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        ${hasCatalogLink?`<button class="btn-icon" onclick="openCatalogLinkModal('${c.id}')" title="Catalog info"><i class="fa-solid fa-book-open" style="font-size:.75rem"></i></button>`:''}
        <button class="btn-icon delete" onclick="deleteCourse('${c.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

// ── (#2) Status change handler — tri-state ────────────────────
function handleStatusChange(courseId, newStatus) {
  const course=state.courses.find(c=>c.id===courseId);
  if(!course)return;
  const old=course.status||'earned';
  if(newStatus===old)return;
  if(newStatus==='earned'&&old!=='earned'){
    openEarnedModal(courseId,old);
  } else {
    course.status=newStatus;
    saveData();renderAll();
    const labels={working:'Working On',planned:'Planned',exploring:'Exploring'};
    toast(`Course marked as ${labels[newStatus]||newStatus}.`,'success');
  }
}

function openEarnedModal(courseId, fromStatus) {
  const c=state.courses.find(x=>x.id===courseId);if(!c)return;
  const gradeOpts=GRADES.map(g=>`<option value="${g}" ${c.grade===g?'selected':''}>${g}</option>`).join('');
  const fromLabels={working:'Working On',planned:'Planned',exploring:'Exploring'};
  const fromLabel=fromLabels[fromStatus]||fromStatus;
  document.getElementById('modal-title').textContent='Mark as Earned';
  document.getElementById('modal-body').innerHTML=`
    <div class="earned-modal-info"><div class="earned-course-name">${esc(c.name)}</div>
      <div class="earned-course-meta">${fmt(c.credits)} credits · ${esc(getYearName(c.yearId))} · ${esc(getReqName(c.reqId))}</div></div>
    <div class="status-change-banner">
      <span class="status-badge sel-${fromStatus}">${fromLabel}</span>
      <span class="status-arrow">→</span>
      <span class="status-badge sel-earned">Earned</span>
    </div>
    <div class="form-group" style="margin-top:16px"><label>Grade Received</label>
      <select id="em-grade"><option value="">— Select grade —</option>${gradeOpts}</select></div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="em-save">Save as Earned</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click',()=>{closeModal();renderCourses();});
  document.getElementById('em-save').addEventListener('click',()=>{
    c.status='earned';c.grade=document.getElementById('em-grade').value||c.grade;
    saveData();closeModal();renderAll();toast('Course marked as Earned!','success');
  });
  openModal();
}

// ══════════════════════════════════════════════════════════════
// ADD COURSE — TWO-PATH MODAL  (Batch 4)
// ══════════════════════════════════════════════════════════════

// Entry point — shows choice screen
function openAddCourseChoice() {
  // Fix #2: always reset mode flags when starting fresh add-course flow
  window._catBrowserMode = null;
  window._relinkCourseId = null;
  document.getElementById('modal-title').textContent='Add Course';
  document.getElementById('modal-body').innerHTML=`
    <p style="font-size:.85rem;color:var(--gray-600);margin-bottom:18px">How would you like to add this course?</p>
    <div class="add-choice-grid">
      <button class="add-choice-btn" onclick="openCourseModal(null)">
        <i class="fa-solid fa-pen-to-square add-choice-icon"></i>
        <div class="add-choice-label">Add Manually</div>
        <div class="add-choice-sub">Enter course details yourself</div>
      </button>
      <button class="add-choice-btn" onclick="openCatalogPicker()">
        <i class="fa-solid fa-book-open add-choice-icon"></i>
        <div class="add-choice-label">Add from School Catalog</div>
        <div class="add-choice-sub">Browse official course listings</div>
      </button>
    </div>`;
  openModal();
}

// Step 1 — catalog + school year picker
async function openCatalogPicker() {
  document.getElementById('modal-title').textContent='Select School Catalog';
  document.getElementById('modal-body').innerHTML=`<div style="text-align:center;padding:24px"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--blue-lite)"></i><p style="margin-top:8px;color:var(--gray-600);font-size:.85rem">Loading catalogs…</p></div>`;

  // Fix #1: always open the modal — needed when called from linkExistingCourseToCatalog
  // which closes the edit modal first before calling this
  openModal();

  if(!_catalogsLoaded) await loadCatalogManifest();

  if(!_catalogManifest.length){
    document.getElementById('modal-body').innerHTML=`
      <div class="info-callout"><i class="fa-solid fa-circle-info"></i>
        <div>No course catalogs found. Make sure catalog JSON files are in the <code>catalogs/</code> folder.</div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="forceCloseModal()">Close</button></div>`;
    return;
  }

  const suggested=suggestedCatalogId();
  const catalogOpts=_catalogManifest.map(m=>`<option value="${m.catalog_id}" ${m.catalog_id===suggested?'selected':''}>${esc(m.school)} — ${m.year}</option>`).join('');
  const yearOpts=state.years.map(y=>`<option value="${y.id}">${esc(y.name)}</option>`).join('');
  const isLinking=window._catBrowserMode==='link'||window._catBrowserMode==='relink';

  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>School Catalog</label>
      <select id="cat-picker">${catalogOpts}</select>
      ${suggested?`<div style="font-size:.76rem;color:var(--green);margin-top:4px"><i class="fa-solid fa-circle-check"></i> Auto-suggested based on your school</div>`:''}
    </div>
    <div class="form-group" style="margin-top:12px"><label>School Year to add courses to</label>
      <select id="cat-year-picker">
        <option value="">— Select Year —</option>${yearOpts}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="${isLinking?'forceCloseModal()':'openAddCourseChoice()'}">← Back</button>
      <button class="btn btn-primary" onclick="openCatalogBrowser()">Browse Courses →</button>
    </div>`;
}

// Step 2 — browse catalog courses
async function openCatalogBrowser() {
  const catalogId=document.getElementById('cat-picker')?.value||window._catBrowserCatalogId;
  const yearId=document.getElementById('cat-year-picker')?.value||window._catBrowserYearId;
  if(!catalogId){toast('Please select a catalog.','error');return;}

  // Store for step 3 — must persist before DOM is replaced
  window._catBrowserCatalogId=catalogId;
  window._catBrowserYearId=yearId;

  document.getElementById('modal-title').textContent='Browse Catalog Courses';
  document.getElementById('modal-body').innerHTML=`<div style="text-align:center;padding:24px"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--blue-lite)"></i></div>`;

  // Fix #4: protect modal — clicking outside or Escape won't lose catalog progress
  openModal(true);

  const catalog=await loadCatalog(catalogId);
  if(!catalog){
    document.getElementById('modal-body').innerHTML=`<div class="info-callout"><i class="fa-solid fa-circle-info"></i><div>Could not load catalog.</div></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="openCatalogPicker()">← Back</button>
        <button class="btn btn-outline" onclick="forceCloseModal()">Cancel</button>
      </div>`;
    return;
  }

  // Get categories
  const cats=[...new Set(catalog.courses.map(c=>c.category))].sort();
  const catOpts=cats.map(c=>`<option value="${c}">${esc(c)}</option>`).join('');

  document.getElementById('modal-body').innerHTML=`
    <div class="cat-browser-filters">
      <input type="text" id="cat-search" placeholder="Search courses…" oninput="filterCatalogBrowser()" style="flex:1" />
      <select id="cat-category" onchange="filterCatalogBrowser()">
        <option value="">All Categories</option>${catOpts}
      </select>
      <select id="cat-type" onchange="filterCatalogBrowser()">
        <option value="">All Types</option>
        <option value="VC">VC</option><option value="BC">BC</option><option value="AC">AC</option>
      </select>
    </div>
    <div id="cat-course-list" class="cat-course-list"></div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="openCatalogPicker()">← Back</button>
      <button class="btn btn-outline" onclick="forceCloseModal()">Cancel</button>
    </div>`;

  // Store courses for filter
  window._catBrowserCourses=catalog.courses;
  filterCatalogBrowser();
}

function filterCatalogBrowser() {
  const courses=window._catBrowserCourses||[];
  const search=(document.getElementById('cat-search')?.value||'').toLowerCase();
  const cat=document.getElementById('cat-category')?.value||'';
  const type=document.getElementById('cat-type')?.value||'';

  const filtered=courses.filter(c=>{
    if(cat&&c.category!==cat)return false;
    if(type&&!c.type?.includes(type))return false;
    if(search&&!c.course_name.toLowerCase().includes(search)&&!c.category.toLowerCase().includes(search))return false;
    return true;
  });

  const listEl=document.getElementById('cat-course-list');
  if(!listEl)return;
  if(!filtered.length){listEl.innerHTML='<p class="text-muted" style="padding:16px;text-align:center">No courses match the filters.</p>';return;}

  // Fix #1: use data-course-id attribute — avoids broken inline onclick when
  // course_id contains hyphens/special chars that corrupt the HTML string
  listEl.innerHTML=filtered.map(c=>{
    const types=(c.type||[]).map(t=>`<span class="type-badge type-${t}">${t}</span>`).join(' ');
    const credits=Object.entries(c.credits||{}).map(([t,v])=>`${t}: ${v}`).join(' / ');
    const alreadyAdded=state.courses.some(sc=>sc.catalogRef?.catalogId===window._catBrowserCatalogId&&sc.catalogRef?.courseId===c.course_id);
    return `<div class="cat-course-row ${alreadyAdded?'cat-added':''}">
      <div class="cat-course-info">
        <div class="cat-course-name">${esc(c.course_name)} ${alreadyAdded?'<span class="catalog-badge">Added</span>':''}</div>
        <div class="cat-course-meta">${esc(c.category)}${c.sub_category?` › ${esc(c.sub_category)}`:''} · ${credits} · ${types}</div>
        ${c.prerequisites&&c.prerequisites!=='None'?`<div class="cat-prereq"><i class="fa-solid fa-arrow-right-long" style="font-size:.65rem;color:var(--gray-400)"></i> Prereq: ${esc(c.prerequisites)}</div>`:''}
      </div>
      <button class="btn btn-secondary btn-sm cat-select-btn" data-course-id="${esc(c.course_id)}">Select →</button>
    </div>`;
  }).join('');

  // Bind listeners after render — course_id passed safely through DOM, not HTML string
  listEl.querySelectorAll('.cat-select-btn').forEach(btn=>{
    btn.addEventListener('click',()=>openCatalogCourseForm(btn.dataset.courseId));
  });
}

// Step 3 — confirm and fill course form from catalog entry
async function openCatalogCourseForm(courseId) {
  const catalog=_catalogCache.get(window._catBrowserCatalogId);
  if(!catalog)return;
  const entry=catalog.courses.find(c=>c.course_id===courseId);
  if(!entry)return;

  const mode=window._catBrowserMode; // 'link' | 'relink' | undefined(new)
  const isLinking=mode==='link'||mode==='relink';
  const existingCourse=isLinking?state.courses.find(c=>c.id===window._relinkCourseId):null;

  document.getElementById('modal-title').textContent=isLinking?'Link to Catalog Entry':'Add Catalog Course';

  // Determine available types and credits
  const types=entry.type||[];
  const typeOpts=types.map(t=>`<option value="${t}">${t} — ${entry.credits_raw?.[t]||entry.credits?.[t]+' cr'||''}</option>`).join('');
  const yearOpts=state.years.map(y=>`<option value="${y.id}" ${y.id===(window._catBrowserYearId||existingCourse?.yearId||'')?'selected':''}>${esc(y.name)}</option>`).join('');
  // Fix #3: auto-match requirement category from catalog entry category name
  const autoReqId=state.requirements.find(r=>
    r.name.toLowerCase()===entry.category.toLowerCase() ||
    entry.category.toLowerCase().includes(r.name.toLowerCase()) ||
    r.name.toLowerCase().includes(entry.category.toLowerCase())
  )?.id||'';

  const reqOpts=state.requirements.map(r=>{
    const subs=(r.subReqs||[]).map(sr=>`<option value="${r.id}|${sr.id}" ${existingCourse?.reqId===r.id&&existingCourse?.subReqId===sr.id?'selected':''}>  ↳ ${esc(sr.name)}</option>`).join('');
    const sel=existingCourse?existingCourse.reqId===r.id&&!existingCourse.subReqId:r.id===autoReqId;
    return `<option value="${r.id}" ${sel?'selected':''}>${esc(r.name)}</option>${subs}`;
  }).join('');
  // Fix #6: FA icons for status options
  const statusOpts=`<option value="planned" ${existingCourse?.status==='planned'?'selected':''}>Planned</option><option value="working" ${existingCourse?.status==='working'?'selected':''}>Working On</option><option value="exploring" ${existingCourse?.status==='exploring'?'selected':''}>Exploring</option><option value="earned" ${existingCourse?.status==='earned'||!existingCourse?'selected':''}>Earned</option>`;
  const gradeOpts=GRADES.map(g=>`<option value="${g}" ${existingCourse?.grade===g?'selected':''}>${g}</option>`).join('');

  // Merge options only shown when linking existing course
  const mergeSection=isLinking?`
    <div style="margin-top:8px;padding:10px 13px;background:var(--off-white);border-radius:var(--radius-sm);border:1px solid var(--gray-200);font-size:.8rem;color:var(--gray-600)">
      <strong>Merge options:</strong> what should be updated from the catalog?
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="merge" value="none" checked /> Keep my data as-is</label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="merge" value="name" /> Update name only</label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="merge" value="credits" /> Update credits only</label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" name="merge" value="all" /> Update name + credits</label>
      </div>
    </div>`:'';

  document.getElementById('modal-body').innerHTML=`
    <div class="cat-course-preview">
      <div class="cat-preview-name">${esc(entry.course_name)}</div>
      <div class="cat-preview-meta">${esc(entry.category)}${entry.sub_category?` › ${esc(entry.sub_category)}`:''}</div>
      ${entry.prerequisites&&entry.prerequisites!=='None'?`<div class="cat-prereq" style="margin-top:4px"><i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i> Prerequisite: ${esc(entry.prerequisites)}</div>`:''}
      ${entry.details?`<details style="margin-top:8px"><summary style="cursor:pointer;font-size:.76rem;color:var(--blue-lite);font-weight:600">Course Description</summary><p style="font-size:.78rem;color:var(--gray-600);line-height:1.5;margin-top:6px;max-height:80px;overflow-y:auto">${esc(entry.details)}</p></details>`:''}
    </div>
    ${isLinking&&existingCourse?`<div style="margin-top:8px;padding:8px 12px;background:var(--gray-100);border-radius:var(--radius-sm);font-size:.8rem;color:var(--gray-600)"><i class="fa-solid fa-arrow-right-arrow-left"></i> Linking to: <strong>${esc(existingCourse.name)}</strong></div>`:''}
    ${mergeSection}
    <div class="form-row" style="margin-top:14px">
      <div class="form-group"><label>Course Type *</label>
        <select id="cc-type" onchange="updateCatalogCredits()">
          ${typeOpts}
          ${!types.length?`<option value="Standard">Standard</option>`:''}
        </select>
      </div>
      <div class="form-group"><label>Credits</label>
        <input type="number" id="cc-credits" placeholder="0" min="0" step="0.5" value="${existingCourse?.credits||''}" />
      </div>
    </div>
    ${!isLinking?`
    <div class="form-row">
      <div class="form-group"><label>School Year</label>
        <select id="cc-year"><option value="">— Select —</option>${yearOpts}</select>
      </div>
      <div class="form-group"><label>Status *</label>
        <select id="cc-status">${statusOpts}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Grade (if earned)</label>
        <select id="cc-grade"><option value="">— Select —</option>${gradeOpts}</select>
      </div>
      <div class="form-group"><label>Requirement Category</label>
        <select id="cc-req"><option value="">— Uncategorized —</option>${reqOpts}</select>
      </div>
    </div>`:''}
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="openCatalogBrowser()">← Back</button>
      <button class="btn btn-outline" onclick="forceCloseModal()">Cancel</button>
      <button class="btn btn-primary" onclick="${isLinking?`confirmCatalogLink('${courseId}')`:`saveCatalogCourse('${courseId}')`}">${isLinking?'Link Course':'Add Course'}</button>
    </div>`;

  // Store entry for credit auto-fill
  window._catCurrentEntry=entry;
  updateCatalogCredits();
}

function updateCatalogCredits() {
  const entry=window._catCurrentEntry;if(!entry)return;
  const type=document.getElementById('cc-type')?.value;
  const cr=entry.credits?.[type];
  const credEl=document.getElementById('cc-credits');
  if(credEl&&cr!==undefined)credEl.value=cr;
}

async function saveCatalogCourse(courseId) {
  const type=document.getElementById('cc-type')?.value||'Standard';
  const credits=parseFloat(document.getElementById('cc-credits')?.value);
  const yearId=document.getElementById('cc-year')?.value;
  const status=document.getElementById('cc-status')?.value||'planned';
  const grade=document.getElementById('cc-grade')?.value;
  const reqVal=document.getElementById('cc-req')?.value;
  let reqId='',subReqId='';
  if(reqVal?.includes('|'))[reqId,subReqId]=reqVal.split('|');else reqId=reqVal||'';

  if(isNaN(credits)||credits<0){toast('Please select a course type to auto-fill credits.','error');return;}

  const entry=window._catCurrentEntry;
  state.courses.push({
    id:uid(),
    name:entry.course_name,
    yearId,credits,grade,type,reqId,subReqId,status,
    catalogRef:{catalogId:window._catBrowserCatalogId,courseId}
  });
  saveData();forceCloseModal();renderAll();
  toast(`${entry.course_name} added as ${status}.`,'success');
}

// Confirm linking an existing manually-entered course to a catalog entry
function confirmCatalogLink(catalogCourseId) {
  const c=state.courses.find(x=>x.id===window._relinkCourseId);
  if(!c){toast('Course not found.','error');return;}
  const entry=window._catCurrentEntry;
  if(!entry){toast('Catalog entry not found.','error');return;}

  // Apply selected merge option
  const mergeVal=document.querySelector('input[name="merge"]:checked')?.value||'none';
  if(mergeVal==='name'||mergeVal==='all') c.name=entry.course_name;
  if(mergeVal==='credits'||mergeVal==='all'){
    const type=document.getElementById('cc-type')?.value||c.type;
    const cr=entry.credits?.[type];
    if(cr!==undefined)c.credits=cr;
  }
  // Apply type from selector regardless
  const selectedType=document.getElementById('cc-type')?.value;
  if(selectedType)c.type=selectedType;

  // Set the catalog reference
  c.catalogRef={catalogId:window._catBrowserCatalogId,courseId:catalogCourseId};

  // Clear mode flags
  window._catBrowserMode=null;
  window._relinkCourseId=null;

  saveData();forceCloseModal();renderAll();
  toast(`${c.name} linked to catalog.`,'success');
}

// ── Catalog link / info modal (Batch 5) ───────────────────────
async function openCatalogLinkModal(courseId) {
  const c=state.courses.find(x=>x.id===courseId);if(!c)return;
  document.getElementById('modal-title').textContent='Catalog Entry';
  document.getElementById('modal-body').innerHTML=`<div style="text-align:center;padding:24px"><i class="fa-solid fa-spinner fa-spin" style="font-size:1.5rem;color:var(--blue-lite)"></i></div>`;
  openModal();

  // Bug fix: manifest may not be loaded yet if user hasn't browsed catalog this session
  if(!_catalogsLoaded) await loadCatalogManifest();

  const catalog=c.catalogRef?await loadCatalog(c.catalogRef.catalogId):null;
  const entry=catalog?.courses?.find(x=>x.course_id===c.catalogRef?.courseId);
  const mf=_catalogManifest.find(m=>m.catalog_id===c.catalogRef?.catalogId);

  if(!entry){
    document.getElementById('modal-body').innerHTML=`
      <p class="text-muted">Could not load catalog entry.</p>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Close</button>
      <button class="btn btn-secondary" onclick="relinkCatalogCourse('${courseId}')">Re-link to Catalog</button></div>`;
    openModal();return;
  }

  const credits=Object.entries(entry.credits_raw||entry.credits||{}).map(([t,v])=>`<strong>${t}</strong>: ${v}`).join(' / ');
  document.getElementById('modal-body').innerHTML=`
    <div class="cat-course-preview">
      <div class="cat-preview-name">${esc(entry.course_name)}</div>
      <div class="cat-preview-meta">${esc(mf?.school||'')} · ${esc(mf?.year||'')}</div>
    </div>
    <table style="width:100%;font-size:.83rem;margin-top:14px;border-collapse:collapse">
      <tr><td style="padding:5px 0;color:var(--gray-600);width:110px">Category</td><td>${esc(entry.category)}</td></tr>
      ${entry.sub_category?`<tr><td style="padding:5px 0;color:var(--gray-600)">Sub-category</td><td>${esc(entry.sub_category)}</td></tr>`:''}
      <tr><td style="padding:5px 0;color:var(--gray-600)">Credits</td><td>${credits}</td></tr>
      <tr><td style="padding:5px 0;color:var(--gray-600)">Prereqs</td><td>${esc(entry.prerequisites||'None')}</td></tr>
      <tr><td style="padding:5px 0;color:var(--gray-600)">Grade Levels</td><td>${(entry.grade_levels||[]).join(', ')||'—'}</td></tr>
      ${entry.ap_ib_course?'<tr><td colspan="2"><span class="type-badge type-VC">AP/IB Course</span></td></tr>':''}
    </table>
    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:.82rem;color:var(--blue-lite);font-weight:600">Course Description</summary>
      <p style="font-size:.81rem;color:var(--gray-600);line-height:1.6;margin-top:8px">${esc(entry.details||'')}</p>
    </details>
    <div style="margin-top:14px;padding:10px 13px;background:var(--off-white);border-radius:var(--radius-sm);font-size:.78rem;color:var(--gray-600)">
      <strong>Merge options:</strong>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="mergeCatalogData('${courseId}','name')">Update Name</button>
        <button class="btn btn-outline btn-sm" onclick="mergeCatalogData('${courseId}','credits')">Update Credits</button>
        <button class="btn btn-outline btn-sm" onclick="mergeCatalogData('${courseId}','all')">Update Name + Credits</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      <button class="btn btn-secondary" onclick="relinkCatalogCourse('${courseId}')">Re-link to Different Catalog</button>
    </div>`;
  openModal();
}

// Merge catalog data into existing course (Batch 5 — option 6)
async function mergeCatalogData(courseId, mergeType) {
  const c=state.courses.find(x=>x.id===courseId);if(!c||!c.catalogRef)return;
  if(!_catalogsLoaded) await loadCatalogManifest();
  const catalog=await loadCatalog(c.catalogRef.catalogId);
  const entry=catalog?.courses?.find(x=>x.course_id===c.catalogRef.courseId);
  if(!entry){toast('Catalog entry not found.','error');return;}
  if(mergeType==='name'||mergeType==='all') c.name=entry.course_name;
  if(mergeType==='credits'||mergeType==='all'){
    const cr=entry.credits?.[c.type];
    if(cr!==undefined)c.credits=cr;
  }
  saveData();closeModal();renderAll();toast('Course updated from catalog.','success');
}

// Re-link existing catalog-linked course to a different catalog entry
async function relinkCatalogCourse(courseId) {
  window._relinkCourseId=courseId;
  window._catBrowserMode='relink';
  closeModal();
  await openCatalogPicker();
}

// Link a manually entered course (no catalogRef) to a catalog entry
// Opens the full catalog browser — on Select the course is linked (not duplicated)
async function linkExistingCourseToCatalog(courseId) {
  window._relinkCourseId=courseId;
  window._catBrowserMode='link';
  closeModal();
  await openCatalogPicker();
}

// ── Manual course modal (enhanced with status) ────────────────
function openCourseModal(courseId) {
  const c=courseId?state.courses.find(x=>x.id===courseId):null;
  document.getElementById('modal-title').textContent=c?'Edit Course':'Add Course Manually';
  const yearOpts=state.years.map(y=>`<option value="${y.id}" ${c?.yearId===y.id?'selected':''}>${esc(y.name)}</option>`).join('');
  const reqOpts=state.requirements.map(r=>{
    const subs=(r.subReqs||[]).map(sr=>{const cr=Number(sr.credits)>0?` (${fmt(sr.credits)} cr)`:'';return `<option value="${r.id}|${sr.id}" ${c?.reqId===r.id&&c?.subReqId===sr.id?'selected':''}>  ↳ ${esc(sr.name)}${cr}</option>`;}).join('');
    return `<option value="${r.id}" ${c?.reqId===r.id&&!c?.subReqId?'selected':''}>${esc(r.name)}</option>${subs}`;
  }).join('');
  const gradeOpts=GRADES.map(g=>`<option value="${g}" ${c?.grade===g?'selected':''}>${g}</option>`).join('');
  const typeOpts=COURSE_TYPES.map(t=>`<option value="${t}" ${(c?.type||'Standard')===t?'selected':''}>${t}</option>`).join('');
  const curStatus=c?.status||'earned';
  const statusOpts=[
    {v:'earned',    l:'Earned'},
    {v:'working',   l:'Working On'},
    {v:'planned',   l:'Planned'},
    {v:'exploring', l:'Exploring'}
  ].map(s=>`<option value="${s.v}" ${curStatus===s.v?'selected':''}>${s.l}</option>`).join('');

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
    <div class="form-group" style="margin-top:8px"><label>Status</label><select id="c-status" class="status-select sel-${curStatus}"
      onchange="this.className='status-select sel-'+this.value">${statusOpts}</select></div>
    ${c?.catalogRef
      ? `<div style="font-size:.78rem;color:var(--gray-600);margin-top:8px;padding:8px 12px;background:var(--gray-100);border-radius:var(--radius-sm)">
          <i class="fa-solid fa-book-open" style="color:var(--blue-lite)"></i> Linked to catalog —
          <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:.74rem" onclick="openCatalogLinkModal('${c.id}');closeModal()">View / Merge</button>
        </div>`
      : c  // editing an existing unlinked course — show Link option
        ? `<div style="font-size:.78rem;color:var(--gray-600);margin-top:8px;padding:8px 12px;background:var(--off-white);border-radius:var(--radius-sm);border:1px solid var(--gray-200)">
            <i class="fa-solid fa-link" style="color:var(--gray-400)"></i> Not linked to a catalog —
            <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:.74rem;margin-left:4px" onclick="linkExistingCourseToCatalog('${c.id}')">Link to Catalog</button>
          </div>`
        : ''
    }
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
  const status=document.getElementById('c-status').value||'earned';
  const reqVal=document.getElementById('c-req').value;
  let reqId='',subReqId='';
  if(reqVal.includes('|'))[reqId,subReqId]=reqVal.split('|');else reqId=reqVal;
  if(!name){toast('Please enter a course name.','error');return;}
  if(isNaN(credits)||credits<0){toast('Please enter a valid credit value.','error');return;}
  const data={name,credits,yearId,grade,type,reqId,subReqId,status};
  if(courseId)Object.assign(state.courses.find(c=>c.id===courseId),data);
  else state.courses.push({id:uid(),...data,catalogRef:null});
  saveData();closeModal();renderAll();
  toast(courseId?'Course updated.':'Course added.','success');
}

function deleteCourse(id){if(!confirm('Delete this course?'))return;state.courses=state.courses.filter(c=>c.id!==id);saveData();renderAll();toast('Course deleted.');}

// ══════════════════════════════════════════════════════════════
// STATISTICS  (Batch 2 — tri-state)
// ══════════════════════════════════════════════════════════════
function renderStats() {
  const earned=totalEarned(),working=totalWorking(),planned=totalPlanned(),required=totalRequired();
  const remaining=Math.max(0,required-earned);
  const metCount=state.requirements.filter(r=>creditsEarnedForReq(r.id)>=r.credits&&r.credits>0).length;
  const pct=required>0?(earned/required)*100:0;
  const yearsW=state.years.filter(y=>state.courses.some(c=>c.yearId===y.id&&isEarned(c)));
  const avg=yearsW.length>0?earned/yearsW.length:0;

  document.getElementById('stat-total-courses').textContent=state.courses.length;
  document.getElementById('stat-credits-earned').textContent=fmt(earned);
  document.getElementById('stat-credits-remaining').textContent=fmt(remaining);
  document.getElementById('stat-credits-working').textContent=fmt(working);
  document.getElementById('stat-credits-planned').textContent=fmt(planned);
  document.getElementById('stat-reqs-met').textContent=`${metCount} / ${state.requirements.length}`;
  document.getElementById('stat-completion').textContent=fmt(pct)+'%';
  document.getElementById('stat-avg-credits').textContent=fmt(avg);
  document.getElementById('stat-grad-year').textContent=state.student.gradYear||'—';

  const byYear=creditsByYear();
  const maxC=Math.max(...state.years.map(y=>(byYear[y.id]?.earned||0)+(byYear[y.id]?.working||0)+(byYear[y.id]?.planned||0)),1);
  document.getElementById('bar-chart-years').innerHTML=!state.years.length
    ?'<p class="text-muted" style="font-size:.85rem;padding:20px 0">No years defined.</p>'
    :state.years.map(y=>{
        const e=byYear[y.id]?.earned||0,w=byYear[y.id]?.working||0,p=byYear[y.id]?.planned||0;
        const hE=Math.round((e/maxC)*140),hW=Math.round((w/maxC)*140),hP=Math.round((p/maxC)*140);
        return `<div class="bar-col">
          <div class="bar-col-val">${fmt(e)}${w>0?`<span class="bar-work-label"><i class="fa-solid fa-bolt"></i> ${fmt(w)}</span>`:''}${p>0?`<span class="bar-plan-label"><i class="fa-solid fa-clock"></i> ${fmt(p)}</span>`:''}</div>
          <div class="bar-col-inner-wrap" style="height:${hE+hW+hP}px">
            ${p>0?`<div class="bar-seg planned" style="height:${hP}px"></div>`:''}
            ${w>0?`<div class="bar-seg working" style="height:${hW}px"></div>`:''}
            <div class="bar-seg earned" style="height:${hE}px"></div>
          </div>
          <div class="bar-col-label">${esc(y.name)}</div>
        </div>`;
      }).join('');

  // (#7) Proportional bars: find max credits across all requirements
  const maxReqCredits=Math.max(...state.requirements.map(r=>Number(r.credits||0)),1);

  // (#2) Update toggle button label
  const toggleBtn=document.getElementById('stats-view-toggle');
  if(toggleBtn)toggleBtn.textContent=_statsView==='gap'?'Show Progress View':'Show Gap View';

  document.getElementById('req-breakdown').innerHTML=!state.requirements.length
    ?'<p class="text-muted" style="font-size:.85rem">No requirements defined.</p>'
    :state.requirements.map(req=>{
        const e=creditsEarnedForReq(req.id),w=creditsWorkingForReq(req.id),p=creditsPlannedForReq(req.id);
        const remaining=Math.max(0,req.credits-e-w-p);
        const done=e>=req.credits&&req.credits>0;

        // (#7) Container width proportional to this req's credits vs the largest req
        const containerPct=(req.credits/maxReqCredits)*100;

        // (#2) Gap view: bar shows remaining; Progress view: bar shows earned/working/planned
        let barHtml;
        if(_statsView==='gap'){
          const remPct=req.credits>0?(remaining/req.credits)*100:0;
          const coveredPct=100-remPct;
          barHtml=`
            <div class="req-row-bar ${done?'done':''}" style="width:${coveredPct}%"></div>
            ${remaining>0?`<div class="req-row-bar-remaining" style="width:${remPct}%"></div>`:''}`;
        } else {
          const pct=req.credits>0?Math.min(100,(e/req.credits)*100):0;
          const pctW=req.credits>0?Math.min(100-pct,(w/req.credits)*100):0;
          const pctP=req.credits>0?Math.min(100-pct-pctW,(p/req.credits)*100):0;
          barHtml=`
            <div class="req-row-bar ${done?'done':''}" style="width:${pct}%"></div>
            <div class="req-row-bar-working" style="width:${pctW}%"></div>
            <div class="req-row-bar-gold" style="width:${pctP}%"></div>`;
        }

        const creditLabel=_statsView==='gap'
          ?`${remaining>0?`<span class="req-row-remaining">${fmt(remaining)} needed</span>`:''} / ${fmt(req.credits)}`
          :`${fmt(e)}${w>0?`<span class="work-inline"><i class="fa-solid fa-bolt"></i> ${fmt(w)}</span>`:''}${p>0?`<span class="plan-inline"><i class="fa-solid fa-clock"></i> ${fmt(p)}</span>`:''} / ${fmt(req.credits)}`;

        const subH=(req.subReqs||[]).length?`<div class="breakdown-subreqs">${req.subReqs.map(sr=>{
          const st=subReqStatus(req,sr);const cr=Number(sr.credits)>0?` (${fmt(sr.credits)})`:'';
          const cls=st==='earned'?'subreq-chip sm sr-met':st==='working'?'subreq-chip sm sr-working':st==='planned'?'subreq-chip sm sr-planned':'subreq-chip sm';
          return `<span class="${cls}">${st==='earned'?'<i class="fa-solid fa-check"></i> ':st==='working'?'<i class="fa-solid fa-bolt"></i> ':st==='planned'?'<i class="fa-solid fa-clock"></i> ':''}${esc(sr.name)}${cr}</span>`;
        }).join('')}</div>`:'';

        return `<div class="req-row">
          <div class="req-row-name">${esc(req.name)}${subH}</div>
          <div class="req-row-bar-outer" style="width:${containerPct}%">
            <div class="req-row-bar-wrap">${barHtml}</div>
          </div>
          <div class="req-row-credits">${creditLabel}</div>
        </div>`;
      }).join('');

  const gradesE={},gradesW={},gradesP={};
  state.courses.forEach(c=>{
    if(!c.grade||isExploring(c))return;  // exploring excluded from grade dist
    if(isEarned(c))  gradesE[c.grade]=(gradesE[c.grade]||0)+1;
    else if(isWorking(c)) gradesW[c.grade]=(gradesW[c.grade]||0)+1;
    else if(isPlanned(c)) gradesP[c.grade]=(gradesP[c.grade]||0)+1;
  });
  const og=GRADES.filter(g=>gradesE[g]||gradesW[g]||gradesP[g]);
  document.getElementById('grade-dist').innerHTML=og.length
    ?og.map(g=>`<div class="grade-dist-item">
        <div class="grade-dist-count">${gradesE[g]||0}</div>
        ${gradesW[g]?`<div class="grade-working-note"><i class="fa-solid fa-bolt"></i> ${gradesW[g]}</div>`:''}
        ${gradesP[g]?`<div class="grade-planned-note"><i class="fa-solid fa-clock"></i> ${gradesP[g]}</div>`:''}
        <div class="grade-dist-label">${g}</div>
      </div>`).join('')
    :'<p class="text-muted" style="font-size:.85rem">No grade data available.</p>';
}

// ══════════════════════════════════════════════════════════════
// PATHWAY PAGES  (unchanged from v1.6.0)
// ══════════════════════════════════════════════════════════════
function renderPathwayOverview() {
  const s=allPathwayStatuses(),eligible=isPathwayEligible(s),anyPartial=Object.values(s).some(x=>x.status!=='none');
  updatePathwayNavDots();
  const banner=document.getElementById('eligibility-banner');
  const icon=banner?.querySelector('.elig-icon');
  const metNames=Object.entries(s).filter(([,v])=>v.met).map(([k])=>({p1:'Pathway 1',p2:'Pathway 2',p3:'Pathway 3',p4:'Pathway 4',p5:'Pathway 5'}[k]||k));
  if(eligible){banner.className='eligibility-banner eligible';if(icon)icon.className='fa-solid fa-circle-check elig-icon';document.getElementById('eligibility-title').textContent='✓ Graduation Eligible — Pathway Requirement Met';document.getElementById('eligibility-detail').textContent='Completed: '+metNames.join(', ');}
  else if(anyPartial){banner.className='eligibility-banner partial';if(icon)icon.className='fa-solid fa-hourglass-half elig-icon';document.getElementById('eligibility-title').textContent='In Progress — Not Yet Eligible';document.getElementById('eligibility-detail').textContent='At least one pathway must be fully completed.';}
  else{banner.className='eligibility-banner not-eligible';if(icon)icon.className='fa-solid fa-circle-info elig-icon';document.getElementById('eligibility-title').textContent='Pathway Eligibility: Not Yet Determined';document.getElementById('eligibility-detail').textContent='Complete at least one full pathway to meet graduation requirements.';}
  const pathways=[
    {key:'p1',page:'pathways-p1',icon:'fa-pencil',      label:'Pathway 1',name:'Keystone Proficiency',   desc:descP1(s.p1)},
    {key:'p2',page:'pathways-p2',icon:'fa-calculator',  label:'Pathway 2',name:'Keystone Composite',     desc:descP2(s.p2)},
    {key:'p3',page:'pathways-p3',icon:'fa-wrench',      label:'Pathway 3',name:'Career & Technical Ed',  desc:descP3(s.p3)},
    {key:'p4',page:'pathways-p4',icon:'fa-chart-bar',   label:'Pathway 4',name:'Alternative Assessment', desc:descP4(s.p4)},
    {key:'p5',page:'pathways-p5',icon:'fa-folder-open', label:'Pathway 5',name:'Evidence-Based',         desc:descP5(s.p5)}
  ];
  document.getElementById('pathway-overview-grid').innerHTML=pathways.map(p=>{
    const status=s[p.key].status,complete=status==='met';
    const badgeTxt=complete?'✓ Met':status==='partial'?'◷ In Progress':'○ Not Started';
    const pct=complete?100:status==='partial'?50:0;
    return `<div class="req-card ${complete?'complete':''}" role="button" tabindex="0"
         onclick="navigateTo('${p.page}')" onkeydown="if(event.key==='Enter')navigateTo('${p.page}')">
      <span class="req-badge">${badgeTxt}</span>
      <div class="req-card-name"><i class="fa-solid ${p.icon}" style="margin-right:6px;color:var(--blue-lite)"></i>${p.label}</div>
      <div class="req-card-credits" style="font-size:.85rem;font-weight:600;color:var(--gray-800);margin-top:2px">${p.name}</div>
      <div class="req-card-planned" style="color:var(--gray-600);font-size:.75rem;font-weight:400;margin-top:4px">${p.desc}</div>
      <div class="req-card-bar-wrap" style="margin-top:10px"><div class="req-card-bar" style="width:${pct}%"></div></div>
      <div class="req-card-click-hint"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View details</div>
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
function descP1(s){ return `${Object.values(s.subjects).filter(x=>x.met).length}/3 subjects Proficient or higher`; }
function descP2(s){ return s.met?`${s.mode} composite: ${s.composite}`:s.composite?`Best composite: ${s.composite}`:'No qualifying scores yet'; }
function descP3(s){ return s.met?`${s.count} verified CTE record(s)`:'No CTE records logged'; }
function descP4(s){ return s.met?`${s.qualifying.length} qualifying assessment(s)`:state.p4Records.length?`${state.p4Records.length} record(s) logged`:'No assessments logged'; }
function descP5(s){ return `${s.total}/3 pieces (need ≥1 from Section 1)`; }

function renderP1(){
  const s=p1Status(),bm=state.benchmarks.keystone;
  const badge=document.getElementById('p1-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');
  document.getElementById('p1-subjects').innerHTML=KEYSTONE_SUBJECTS.map((subj,i)=>{
    const key=KEYSTONE_KEYS[i],info=s.subjects[key],prof=bm[key]?.prof??0;
    const pct=info.best?Math.min(100,(info.best/(prof*1.15))*100):0;
    const bc=info.met?'badge-met':info.best?'badge-partial':'badge-none';
    return `<div class="subject-row"><div class="subject-name">${subj}</div><div><div class="prog-wrap"><div class="prog-bar ${info.met?'green':''}" style="width:${pct}%"></div></div></div><div class="subject-score-info">Proficient: ≥ ${prof}</div><div><span class="subject-badge ${bc}">${info.met?'✓ Proficient':info.best?`Best: ${info.best}`:'Not Taken'}</span></div></div>`;
  }).join('');
  const tbody=document.getElementById('keystone-log-tbody');
  if(!state.keystoneScores.length){tbody.innerHTML='<tr class="empty-row"><td colspan="6">No scores logged yet.</td></tr>';return;}
  tbody.innerHTML=[...state.keystoneScores].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(sc=>{
    const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(sc.subject)],prof=bm[key]?.prof??0;
    const pending=sc.score===null||sc.score===undefined||sc.score==='';
    const met=!pending&&Number(sc.score)>=prof;
    const levelBadge=pending?'<span class="subject-badge badge-partial">Pending</span>'
      :`<span class="subject-badge ${sc.level==='Below Basic'||sc.level==='Basic'?'badge-none':'badge-met'}">${sc.level||'—'}</span>`;
    const profBadge=pending?'<span class="subject-badge badge-partial">Pending</span>'
      :`<span class="subject-badge ${met?'badge-met':'badge-none'}">${met?'Proficient':'Below'}</span>`;
    return `<tr><td>${sc.subject}</td><td>${fmtDate(sc.date)}</td>
      <td>${pending?'<em style="color:var(--gray-400)">Pending</em>':sc.score}</td>
      <td class="col-center">${levelBadge}</td>
      <td class="col-center">${profBadge}</td>
      <td><div class="action-btns">
        <button class="btn-icon" onclick="editPathwayEntry('keystoneScores','${sc.id}')" title="Edit">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon delete" onclick="deletePathwayEntry('keystoneScores','${sc.id}')" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div></td></tr>`;
  }).join('');
}

function renderP2(){
  const s=p2Status(),subj=getKeystoneSubjectData(),bm=state.benchmarks.keystone;
  const badge=document.getElementById('p2-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');
  const scores=KEYSTONE_KEYS.map(k=>subj[k].best).filter(x=>x!==null);
  const anyBB=KEYSTONE_KEYS.some(k=>subj[k].belowBasic),anyProf=KEYSTONE_KEYS.some(k=>subj[k].met);
  let html=`<div style="margin-bottom:16px">`;
  html+=KEYSTONE_SUBJECTS.map((n,i)=>{const key=KEYSTONE_KEYS[i],info=subj[key];const lc=info.belowBasic?'badge-none':info.met?'badge-met':info.best?'badge-partial':'badge-none';const lt=info.belowBasic?'Below Basic':info.met?'Proficient+':info.best?`Basic (${info.best})`:'Not Taken';return `<div class="subject-row"><div class="subject-name">${n}</div><div></div><div class="subject-score-info">${info.best!==null?`Score: ${info.best}`:'—'}</div><div><span class="subject-badge ${lc}">${lt}</span></div></div>`;}).join('');
  html+=`</div>`;
  if(anyBB)html+=`<div class="info-callout" style="background:#fdecea;border-color:#f5a9a0"><i class="fa-solid fa-circle-exclamation" style="color:var(--danger)"></i><div><strong>Below Basic score present.</strong> Composite pathway requires no Below Basic scores.</div></div>`;
  else if(!anyProf&&scores.length>0)html+=`<div class="info-callout"><i class="fa-solid fa-circle-info"></i><div>At least one score must be Proficient or higher.</div></div>`;
  else if(scores.length>=2){
    const s3=scores.length>=3?scores.slice().sort((a,b)=>b-a).slice(0,3).reduce((s,x)=>s+x,0):null;
    const s2=scores.slice().sort((a,b)=>b-a).slice(0,2).reduce((s,x)=>s+x,0);
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px">`;
    if(s3!==null)html+=`<div class="card" style="padding:14px;text-align:center;border-top:3px solid ${s3>=4452?'var(--green)':'var(--gray-200)'}"><div style="font-size:.78rem;color:var(--gray-600);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">3-Score Composite</div><div style="font-size:2rem;font-weight:700;color:var(--blue-dark)">${s3}</div><div style="font-size:.78rem;margin-top:4px"><span class="subject-badge ${s3>=4452?'badge-met':'badge-none'}">${s3>=4452?'✓ Meets 4452':'Need '+4452}</span></div></div>`;
    html+=`<div class="card" style="padding:14px;text-align:center;border-top:3px solid ${s2>=2939?'var(--green)':'var(--gray-200)'}"><div style="font-size:.78rem;color:var(--gray-600);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">2-Score Composite</div><div style="font-size:2rem;font-weight:700;color:var(--blue-dark)">${s2}</div><div style="font-size:.78rem;margin-top:4px"><span class="subject-badge ${s2>=2939?'badge-met':'badge-none'}">${s2>=2939?'✓ Meets 2939':'Need '+2939}</span></div></div>`;
    html+=`</div>`;
  } else html+=`<p class="text-muted" style="padding:12px 0">Log Keystone scores in Pathway 1 to calculate your composite.</p>`;
  document.getElementById('p2-composite-status').innerHTML=html;
}

function renderP3(){
  const s=p3Status();const badge=document.getElementById('p3-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');
  const tbody=document.getElementById('p3-log-tbody');
  if(!state.p3Records.length){tbody.innerHTML='<tr class="empty-row"><td colspan="5">No CTE records logged yet.</td></tr>';return;}
  tbody.innerHTML=state.p3Records.map(r=>`<tr>
    <td>${esc(r.description)}</td><td>${esc(r.type||'—')}</td><td>${fmtDate(r.date)}</td>
    <td class="col-center"><span class="subject-badge ${r.verified?'badge-met':'badge-none'}">${r.verified?'✓ Verified':'Pending'}</span></td>
    <td><div class="action-btns">
      <button class="btn-icon" onclick="editPathwayEntry('p3Records','${r.id}')" title="Edit">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="btn-icon delete" onclick="deletePathwayEntry('p3Records','${r.id}')" title="Delete">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div></td></tr>`).join('');
}

function renderP4(){
  const s=p4Status();const badge=document.getElementById('p4-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');
  const tbody=document.getElementById('p4-log-tbody');
  if(!state.p4Records.length){tbody.innerHTML='<tr class="empty-row"><td colspan="7">No assessments logged yet.</td></tr>';return;}
  tbody.innerHTML=state.p4Records.map(r=>{
    const type=P4_TYPES.find(t=>t.key===r.type);const q=s.qualifying.some(x=>x.id===r.id);
    return `<tr><td>${esc(r.name)}</td><td>${esc(type?.label||r.type)}</td><td>${fmtDate(r.date)}</td>
      <td class="col-center">${r.score?esc(r.score):'<em style="color:var(--gray-400)">Pending</em>'}</td>
      <td class="col-center">${type?.threshold!==null?`≥ ${type?.threshold}`:'Completion'}</td>
      <td class="col-center"><span class="subject-badge ${q?'badge-met':r.score?'badge-none':'badge-partial'}">${q?'✓ Qualifies':r.score?'Not Yet':'Pending'}</span></td>
      <td><div class="action-btns">
        <button class="btn-icon" onclick="editPathwayEntry('p4Records','${r.id}')" title="Edit">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon delete" onclick="deletePathwayEntry('p4Records','${r.id}')" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div></td></tr>`;
  }).join('');
}

function renderP5(){
  const s=p5Status();const badge=document.getElementById('p5-badge');
  badge.textContent=s.met?'✓ Pathway Met':s.status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':s.status==='partial'?'badge-partial':'badge-none');
  const pct=Math.min(100,(s.total/3)*100);
  document.getElementById('p5-summary').innerHTML=`<div style="display:flex;align-items:center;gap:14px"><span style="font-size:.84rem;color:var(--gray-600)">${s.total}/3 pieces of evidence (${s.s1Count} from Section 1)</span><div class="prog-wrap" style="flex:1;height:9px"><div class="prog-bar ${s.met?'green':''}" style="width:${pct}%"></div></div></div>`;
  const renderTable=(id,section)=>{
    const rows=state.p5Evidence.filter(e=>e.section===section);
    const tbody=document.getElementById(id);
    if(!rows.length){tbody.innerHTML=`<tr class="empty-row"><td colspan="6">No ${section} evidence logged.</td></tr>`;return;}
    tbody.innerHTML=rows.map(e=>`<tr>
      <td>${esc(e.name)}</td><td>${esc(e.type)}</td><td>${fmtDate(e.date)}</td>
      <td class="col-center">${e.score?esc(e.score):'<em style="color:var(--gray-400)">—</em>'}</td>
      <td class="col-center"><span class="subject-badge badge-partial">${e.section}</span></td>
      <td><div class="action-btns">
        <button class="btn-icon" onclick="editPathwayEntry('p5Evidence','${e.id}')" title="Edit">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon delete" onclick="deletePathwayEntry('p5Evidence','${e.id}')" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div></td></tr>`).join('');
  };
  renderTable('p5-s1-tbody','S1');renderTable('p5-s2-tbody','S2');
}

function renderProjection(){
  const s=allPathwayStatuses(),eligible=isPathwayEligible(s);
  const pways=[{key:'p1',label:'Pathway 1 — Keystone Proficiency',page:'pathways-p1'},{key:'p2',label:'Pathway 2 — Keystone Composite',page:'pathways-p2'},{key:'p3',label:'Pathway 3 — CTE',page:'pathways-p3'},{key:'p4',label:'Pathway 4 — Alternative Assessment',page:'pathways-p4'},{key:'p5',label:'Pathway 5 — Evidence-Based',page:'pathways-p5'}];
  document.getElementById('proj-checklist').innerHTML=pways.map(p=>{const st=s[p.key].status;const cls=st==='met'?'done':st==='partial'?'active':'todo';const icon=st==='met'?'fa-circle-check':st==='partial'?'fa-hourglass-half':'fa-circle';return `<div class="proj-step ${cls}" onclick="navigateTo('${p.page}')" style="cursor:pointer"><i class="fa-solid ${icon}"></i><span>${p.label}</span></div>`;}).join('');
  const steps=buildNextSteps(s,eligible);
  document.getElementById('proj-next-steps').innerHTML=steps.length?steps.map(st=>`<div class="next-step-item ${st.priority?'priority':''}"><i class="fa-solid ${st.icon}"></i><div><strong>${st.label}</strong><br><span class="text-muted">${st.detail}</span></div></div>`).join(''):`<div class="next-step-item"><i class="fa-solid fa-star"></i><div><strong>All set!</strong><br><span class="text-muted">At least one pathway is complete.</span></div></div>`;
  const tl=document.getElementById('proj-timeline');
  if(!state.plannedEvents.length){tl.innerHTML='<p class="text-muted" style="padding:8px 0">No planned events yet.</p>';return;}
  const now=new Date();
  tl.innerHTML=[...state.plannedEvents].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(ev=>{
    const evDate=new Date(ev.date),past=evDate<now,soon=!past&&(evDate-now)<30*24*60*60*1000;
    const dotCls=past?'tl-past':soon?'tl-soon':'tl-future';
    return `<div class="timeline-item">
      <div class="timeline-date">${fmtDate(ev.date)}</div>
      <div class="timeline-dot ${dotCls}"></div>
      <div style="flex:1">
        <strong>${esc(ev.label)}</strong>
        ${ev.projectedScore?`<span class="text-muted"> — ${esc(ev.projectedScore)}</span>`:''}
      </div>
      <div class="action-btns">
        <button class="btn-icon" onclick="editPlannedEvent('${ev.id}')" title="Edit">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon delete" onclick="deletePathwayEntry('plannedEvents','${ev.id}')" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

function buildNextSteps(s,eligible){
  if(eligible)return[];const steps=[];
  const kSubj=getKeystoneSubjectData();
  const missing=KEYSTONE_SUBJECTS.filter((_,i)=>!kSubj[KEYSTONE_KEYS[i]].met);
  if(missing.length)steps.push({icon:'fa-pencil',label:'Pathway 1 — Keystone Exams',detail:`${missing.join(', ')} not yet Proficient`,priority:missing.length<3});
  if(!s.p2.met&&s.p2.composite>0)steps.push({icon:'fa-calculator',label:'Pathway 2 — Composite',detail:`Current best composite: ${s.p2.composite}. Need 4452 (3-score) or 2939 (2-score)`,priority:true});
  if(!s.p4.met&&state.p4Records.length>0)steps.push({icon:'fa-chart-bar',label:'Pathway 4 — Alternative',detail:`${state.p4Records.length} record(s) — none qualifying yet`,priority:true});
  if(!s.p5.met){const need=3-s.p5.total;steps.push({icon:'fa-folder-open',label:'Pathway 5 — Evidence-Based',detail:`${s.p5.total}/3 pieces. Need ${need} more${s.p5.s1Count===0?' (at least 1 from Section 1)':''}`,priority:s.p5.total>0});}
  if(!s.p3.met&&!state.p3Records.length)steps.push({icon:'fa-wrench',label:'Pathway 3 — CTE',detail:'Log CTE concentration records if applicable',priority:false});
  return steps.slice(0,6);
}

// Pathway modals — editId optional, pre-fills form for editing
function openPathwayModal(type, editId) {
  const body=document.getElementById('modal-body');
  const title=document.getElementById('modal-title');
  const isEdit=!!editId;

  if(type==='keystone'){
    const ex=isEdit?state.keystoneScores.find(x=>x.id===editId):null;
    title.textContent=isEdit?'Edit Keystone Score':'Log Keystone Score';
    const subjOpts=KEYSTONE_SUBJECTS.map(s=>`<option ${ex?.subject===s?'selected':''}>${s}</option>`).join('');
    body.innerHTML=`
      ${isEdit?`<input type="hidden" id="m-edit-id" value="${editId}" />`:''}
      <div class="form-row">
        <div class="form-group"><label>Subject</label><select id="m-subj">${subjOpts}</select></div>
        <div class="form-group"><label>Date Taken</label><input type="date" id="m-date" value="${ex?.date||today()}" /></div>
      </div>
      <div class="form-group">
        <label>Score <span style="font-size:.76rem;color:var(--gray-400)">(leave blank if awaiting results)</span></label>
        <input type="number" id="m-score" placeholder="e.g. 1542" value="${ex?.score??''}" />
      </div>
      <div class="form-group" style="margin-top:8px;padding:10px 13px;background:var(--gray-100);border-radius:var(--radius-sm);font-size:.83rem;color:var(--gray-600)">
        <i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i> Performance level auto-calculated. Leave score blank to log a placeholder.
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveKeystoneScore()">${isEdit?'Save Changes':'Save Score'}</button>
      </div>`;

  } else if(type==='p3'){
    const ex=isEdit?state.p3Records.find(x=>x.id===editId):null;
    title.textContent=isEdit?'Edit CTE Record':'Log CTE Record';
    const typeOpts=['Industry-Based Competency Certification','High Likelihood of Success on Assessment','CTE Concentrator Readiness Demonstration','Transfer Record from Previous District'].map(t=>`<option ${ex?.type===t?'selected':''}>${t}</option>`).join('');
    body.innerHTML=`
      ${isEdit?`<input type="hidden" id="m-edit-id" value="${editId}" />`:''}
      <div class="form-group"><label>Description</label><input type="text" id="m-name" value="${esc(ex?.description||'')}" placeholder="e.g. CompTIA IT Fundamentals certification" /></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="m-type">${typeOpts}</select></div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${ex?.date||today()}" /></div>
      </div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" id="m-verified" ${ex?.verified?'checked':''} /> Mark as verified by advisor / district
      </label></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveP3Record()">${isEdit?'Save Changes':'Save Record'}</button>
      </div>`;

  } else if(type==='p4'){
    const ex=isEdit?state.p4Records.find(x=>x.id===editId):null;
    title.textContent=isEdit?'Edit Assessment':'Log Alternative Assessment';
    const typeOpts=P4_TYPES.map(t=>`<option value="${t.key}" ${ex?.type===t.key?'selected':''}>${t.label}</option>`).join('');
    body.innerHTML=`
      ${isEdit?`<input type="hidden" id="m-edit-id" value="${editId}" />`:''}
      <div class="form-group"><label>Assessment / Activity Name</label><input type="text" id="m-name" value="${esc(ex?.name||'')}" placeholder="e.g. SAT — Spring 2024" /></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="m-type">${typeOpts}</select></div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${ex?.date||today()}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Score / Result <span style="font-size:.76rem;color:var(--gray-400)">(leave blank if pending)</span></label>
          <input type="text" id="m-score" value="${esc(ex?.score||'')}" placeholder="e.g. 1025 or Gold" />
        </div>
        <div class="form-group"><label>Notes (optional)</label><input type="text" id="m-notes" value="${esc(ex?.notes||'')}" /></div>
      </div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" id="m-verified" ${ex?.verified?'checked':''} /> Verified / completed
      </label></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveP4Record()">${isEdit?'Save Changes':'Save Assessment'}</button>
      </div>`;

  } else if(type==='p5'){
    const ex=isEdit?state.p5Evidence.find(x=>x.id===editId):null;
    title.textContent=isEdit?'Edit Evidence':'Add Evidence (Pathway 5)';
    const s1Opts=P5_S1_TYPES.map(t=>`<option value="${t.key}" ${ex?.type===t.key?'selected':''}>${t.label}</option>`).join('');
    const s2Opts=P5_S2_TYPES.map(t=>`<option value="${t.key}" ${ex?.type===t.key?'selected':''}>${t.label}</option>`).join('');
    const curSection=ex?.section||'S1';
    body.innerHTML=`
      ${isEdit?`<input type="hidden" id="m-edit-id" value="${editId}" />`:''}
      <div class="form-group"><label>Evidence Description</label><input type="text" id="m-name" value="${esc(ex?.name||'')}" placeholder="e.g. AP Calculus Exam — Score 3" /></div>
      <div class="form-row">
        <div class="form-group"><label>Section</label>
          <select id="m-section" onchange="updateP5TypeOpts()">
            <option value="S1" ${curSection==='S1'?'selected':''}>Section 1</option>
            <option value="S2" ${curSection==='S2'?'selected':''}>Section 2</option>
          </select>
        </div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${ex?.date||today()}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="m-type">${curSection==='S1'?s1Opts:s2Opts}</select></div>
        <div class="form-group"><label>Score / Result</label><input type="text" id="m-score" value="${esc(ex?.score||'')}" placeholder="e.g. 3 or Gold" /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveP5Evidence()">${isEdit?'Save Changes':'Add Evidence'}</button>
      </div>`;
    window._p5s1Opts=s1Opts;window._p5s2Opts=s2Opts;

  } else if(type==='plan-event'){
    title.textContent='Add Planned Event';
    body.innerHTML=`<div class="form-group"><label>Event Label</label><input type="text" id="m-label" placeholder='e.g. "Keystone Retake — Algebra I"' /></div><div class="form-row"><div class="form-group"><label>Date</label><input type="date" id="m-date" /></div><div class="form-group"><label>Projected Score / Result (optional)</label><input type="text" id="m-proj" placeholder='e.g. "1550"' /></div></div><div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="savePlannedEvent()">Add Event</button></div>`;
  }
  openModal();
}

function updateP5TypeOpts(){const sec=document.getElementById('m-section')?.value;const el=document.getElementById('m-type');if(el)el.innerHTML=sec==='S1'?(window._p5s1Opts||''):(window._p5s2Opts||'');}

function saveKeystoneScore(){
  const editId=document.getElementById('m-edit-id')?.value;
  const subj=document.getElementById('m-subj')?.value;
  const date=document.getElementById('m-date')?.value;
  const scoreRaw=document.getElementById('m-score')?.value;
  if(!subj||!date){toast('Please fill subject and date.','error');return;}
  const score=scoreRaw===''?null:Number(scoreRaw);
  const level=score!==null?calcKeystoneLevel(subj,score):null;
  if(editId){
    const ex=state.keystoneScores.find(x=>x.id===editId);
    if(ex){Object.assign(ex,{subject:subj,date,score,level});}
  } else {
    state.keystoneScores.push({id:uid(),subject:subj,date,score,level});
  }
  saveData();closeModal();renderP1();renderP2();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast(editId?'Score updated.':`Keystone score logged${level?` — ${level}`:' (pending)'}.`,'success');
}

function saveP3Record(){
  const editId=document.getElementById('m-edit-id')?.value;
  const name=document.getElementById('m-name')?.value.trim();
  if(!name){toast('Please enter a description.','error');return;}
  const data={description:name,type:document.getElementById('m-type')?.value,date:document.getElementById('m-date')?.value,verified:document.getElementById('m-verified')?.checked};
  if(editId){const ex=state.p3Records.find(x=>x.id===editId);if(ex)Object.assign(ex,data);}
  else state.p3Records.push({id:uid(),...data});
  saveData();closeModal();renderP3();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast(editId?'Record updated.':'CTE record saved.','success');
}

function saveP4Record(){
  const editId=document.getElementById('m-edit-id')?.value;
  const name=document.getElementById('m-name')?.value.trim();
  if(!name){toast('Please enter a name.','error');return;}
  const data={name,type:document.getElementById('m-type')?.value,date:document.getElementById('m-date')?.value,score:document.getElementById('m-score')?.value.trim(),notes:document.getElementById('m-notes')?.value.trim(),verified:document.getElementById('m-verified')?.checked};
  if(editId){const ex=state.p4Records.find(x=>x.id===editId);if(ex)Object.assign(ex,data);}
  else state.p4Records.push({id:uid(),...data});
  saveData();closeModal();renderP4();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast(editId?'Assessment updated.':'Assessment logged.','success');
}

function saveP5Evidence(){
  const editId=document.getElementById('m-edit-id')?.value;
  const name=document.getElementById('m-name')?.value.trim();
  if(!name){toast('Please enter a description.','error');return;}
  const data={name,section:document.getElementById('m-section')?.value,type:document.getElementById('m-type')?.value,date:document.getElementById('m-date')?.value,score:document.getElementById('m-score')?.value.trim()};
  if(editId){const ex=state.p5Evidence.find(x=>x.id===editId);if(ex)Object.assign(ex,data);}
  else state.p5Evidence.push({id:uid(),...data});
  saveData();closeModal();renderP5();renderPathwayOverview();updatePathwayNavDots();renderDashboard();
  toast(editId?'Evidence updated.':'Evidence added.','success');
}
function savePlannedEvent(){
  const label=document.getElementById('m-label')?.value.trim();
  const date=document.getElementById('m-date')?.value;
  if(!label||!date){toast('Please enter a label and date.','error');return;}
  const editId=document.getElementById('m-event-id')?.value;
  if(editId){
    const ev=state.plannedEvents.find(x=>x.id===editId);
    if(ev){ev.label=label;ev.date=date;ev.projectedScore=document.getElementById('m-proj')?.value.trim();}
  } else {
    state.plannedEvents.push({id:uid(),label,date,projectedScore:document.getElementById('m-proj')?.value.trim()});
  }
  saveData();closeModal();renderProjection();
  toast(editId?'Event updated.':'Planned event added.','success');
}

function editPlannedEvent(evId){
  const ev=state.plannedEvents.find(x=>x.id===evId);if(!ev)return;
  document.getElementById('modal-title').textContent='Edit Planned Event';
  document.getElementById('modal-body').innerHTML=`
    <input type="hidden" id="m-event-id" value="${ev.id}" />
    <div class="form-group"><label>Event Label</label><input type="text" id="m-label" value="${esc(ev.label)}" /></div>
    <div class="form-row">
      <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${ev.date}" /></div>
      <div class="form-group"><label>Projected Score / Result</label><input type="text" id="m-proj" value="${esc(ev.projectedScore||'')}" /></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="savePlannedEvent()">Save Changes</button>
    </div>`;
  openModal();
}
function deletePathwayEntry(k,id){if(!confirm('Remove this entry?'))return;state[k]=state[k].filter(x=>x.id!==id);saveData();renderAll();toast('Entry removed.');}

// Opens the appropriate edit modal for any pathway log entry
function editPathwayEntry(listKey, id) {
  if(listKey==='keystoneScores') openPathwayModal('keystone', id);
  else if(listKey==='p3Records')    openPathwayModal('p3', id);
  else if(listKey==='p4Records')    openPathwayModal('p4', id);
  else if(listKey==='p5Evidence')   openPathwayModal('p5', id);
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════
function setupSettingsListeners(){
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

function renderSettingsStudent(){
  document.getElementById('student-name').value=state.student.name||'';
  document.getElementById('grad-year').value=state.student.gradYear||'';
  document.getElementById('student-school').value=state.student.school||'';
  const nys=document.getElementById('new-year-school');
  if(!nys.value&&state.student.school)nys.value=state.student.school;
  document.getElementById('years-list').innerHTML=state.years.length
    ?state.years.map(y=>`<div class="list-item"><div class="list-item-name-group"><span class="list-item-name">${esc(y.name)}</span>${y.school?`<span class="list-item-school">${esc(y.school)}</span>`:''}</div><div class="list-item-actions"><button class="btn-icon" onclick="openEditYearModal('${y.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon delete" onclick="deleteYear('${y.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></div></div>`).join('')
    :'<p class="text-muted" style="font-size:.85rem;padding:6px 0">No years added yet.</p>';
}

function renderSettingsRequirements(){
  document.getElementById('reqs-list').innerHTML=state.requirements.length
    ?state.requirements.map(r=>{
        const subList=(r.subReqs||[]).map(sr=>{const status=subReqStatus(r,sr),cr=Number(sr.credits)>0?`${fmt(sr.credits)} cr`:'0 cr';const dot=status==='earned'?'<span class="sr-dot sr-dot-earned">✓</span>':status==='working'?'<span class="sr-dot sr-dot-working"><i class="fa-solid fa-bolt"></i></span>':status==='planned'?'<span class="sr-dot sr-dot-planned"><i class="fa-solid fa-clock"></i></span>':'<span class="sr-dot sr-dot-none">○</span>';return `<div class="subreq-item">${dot}<span class="subreq-item-name">${esc(sr.name)}</span><span class="subreq-item-credits">${cr}</span><div class="subreq-item-actions"><button class="btn-icon" onclick="openEditSubReqModal('${r.id}','${sr.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon delete" onclick="deleteSubReq('${r.id}','${sr.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></div></div>`;}).join('');
        return `<div class="req-list-block" id="req-block-${r.id}"><div class="list-item req-list-item"><span class="list-item-name">${esc(r.name)}</span><div class="list-item-right"><span class="list-item-credits">${fmt(r.credits)} cr</span><div class="list-item-actions"><button class="btn-icon" onclick="openEditReqModal('${r.id}')"><svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon" onclick="toggleSubReqForm('${r.id}')"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button><button class="btn-icon delete" onclick="deleteReq('${r.id}')"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></div></div></div>${subList?`<div class="subreq-list">${subList}</div>`:''}<div class="subreq-add-form hidden" id="subreq-form-${r.id}"><input type="text" id="subreq-name-${r.id}" placeholder='Name (e.g. "Algebra I Required")' /><input type="number" id="subreq-credits-${r.id}" placeholder="Credits" min="0" step="0.5" class="input-credits-sm" /><button class="btn btn-secondary btn-sm" onclick="addSubReq('${r.id}')">Add</button><button class="btn btn-outline btn-sm" onclick="toggleSubReqForm('${r.id}')">Cancel</button></div></div>`;
      }).join('')
    :'<p class="text-muted" style="font-size:.85rem;padding:6px 0">No requirements added yet.</p>';
  document.getElementById('total-req-credits').textContent=fmt(totalRequired());
}

function renderBenchmarkInputs(){
  const bm=state.benchmarks;
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  set('bm-alg-prof',bm.keystone.algebra.prof);set('bm-alg-adv',bm.keystone.algebra.adv);set('bm-alg-bb',bm.keystone.algebra.bb);
  set('bm-lit-prof',bm.keystone.literature.prof);set('bm-lit-adv',bm.keystone.literature.adv);set('bm-lit-bb',bm.keystone.literature.bb);
  set('bm-bio-prof',bm.keystone.biology.prof);set('bm-bio-adv',bm.keystone.biology.adv);set('bm-bio-bb',bm.keystone.biology.bb);
  set('bm-act-composite',bm.p4?.act||21);set('bm-asvab',bm.p4?.asvab||31);set('bm-psat-composite',bm.p4?.psat||970);set('bm-sat-p4',bm.p4?.sat||1010);
}
function saveBenchmarks(){
  const g=id=>Number(document.getElementById(id)?.value)||0;
  state.benchmarks={keystone:{algebra:{prof:g('bm-alg-prof'),adv:g('bm-alg-adv'),bb:g('bm-alg-bb')},literature:{prof:g('bm-lit-prof'),adv:g('bm-lit-adv'),bb:g('bm-lit-bb')},biology:{prof:g('bm-bio-prof'),adv:g('bm-bio-adv'),bb:g('bm-bio-bb')}},p4:{act:g('bm-act-composite'),asvab:g('bm-asvab'),psat:g('bm-psat-composite'),sat:g('bm-sat-p4')}};
  saveData();renderAll();toast('Benchmarks saved.','success');
}
function resetBenchmarks(){if(!confirm('Reset all benchmarks to PA defaults?'))return;state.benchmarks=JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));saveData();renderBenchmarkInputs();renderAll();toast('Benchmarks reset.','success');}

// Year / Req CRUD
function openEditYearModal(yearId){
  const y=state.years.find(x=>x.id===yearId);if(!y)return;
  document.getElementById('modal-title').textContent='Edit School Year';
  document.getElementById('modal-body').innerHTML=`<div class="form-group"><label>Year / Grade Label *</label><input type="text" id="edit-year-name" value="${esc(y.name)}" /></div><div class="form-group" style="margin-top:12px"><label>School Name</label><input type="text" id="edit-year-school" value="${esc(y.school||'')}" /></div><div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-save-year">Save</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-save-year').addEventListener('click',()=>{const name=document.getElementById('edit-year-name').value.trim();if(!name){toast('Please enter a year label.','error');return;}y.name=name;y.school=document.getElementById('edit-year-school').value.trim();saveData();closeModal();renderAll();toast('Year updated.','success');});
  openModal();document.getElementById('edit-year-name').focus();
}
function openEditReqModal(reqId){
  const req=state.requirements.find(r=>r.id===reqId);if(!req)return;
  document.getElementById('modal-title').textContent='Edit Requirement';
  document.getElementById('modal-body').innerHTML=`<div class="form-group"><label>Name *</label><input type="text" id="edit-req-name" value="${esc(req.name)}" /></div><div class="form-group" style="margin-top:12px"><label>Credits *</label><input type="number" id="edit-req-credits" value="${req.credits}" min="0" step="0.5" /></div><div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-save-req">Save</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-save-req').addEventListener('click',()=>{const name=document.getElementById('edit-req-name').value.trim();const credits=parseFloat(document.getElementById('edit-req-credits').value);if(!name||isNaN(credits)||credits<0){toast('Please fill all fields correctly.','error');return;}req.name=name;req.credits=credits;saveData();closeModal();renderAll();toast('Requirement updated.','success');});
  openModal();document.getElementById('edit-req-name').focus();
}
function openEditSubReqModal(reqId,subId){
  const req=state.requirements.find(r=>r.id===reqId);const sr=req?.subReqs?.find(s=>s.id===subId);if(!req||!sr)return;
  document.getElementById('modal-title').textContent='Edit Sub-Requirement';
  document.getElementById('modal-body').innerHTML=`<div class="form-group"><label>Name *</label><input type="text" id="edit-sub-name" value="${esc(sr.name)}" /></div><p style="font-size:.78rem;color:var(--gray-600);margin:6px 0 10px"><i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i> Name is matched against course names to detect auto-completion.</p><div class="form-group"><label>Credits (0 if informational)</label><input type="number" id="edit-sub-credits" value="${sr.credits||0}" min="0" step="0.5" /></div><div class="modal-footer"><button class="btn btn-outline" id="modal-cancel">Cancel</button><button class="btn btn-primary" id="modal-save-sub">Save</button></div>`;
  document.getElementById('modal-cancel').addEventListener('click',closeModal);
  document.getElementById('modal-save-sub').addEventListener('click',()=>{const name=document.getElementById('edit-sub-name').value.trim();if(!name){toast('Please enter a name.','error');return;}sr.name=name;sr.credits=parseFloat(document.getElementById('edit-sub-credits').value)||0;saveData();closeModal();renderAll();toast('Sub-requirement updated.','success');});
  openModal();document.getElementById('edit-sub-name').focus();
}
function toggleSubReqForm(reqId){const form=document.getElementById(`subreq-form-${reqId}`);if(!form)return;form.classList.toggle('hidden');if(!form.classList.contains('hidden'))document.getElementById(`subreq-name-${reqId}`)?.focus();}
function addSubReq(reqId){const name=document.getElementById(`subreq-name-${reqId}`)?.value.trim();const credits=parseFloat(document.getElementById(`subreq-credits-${reqId}`)?.value)||0;if(!name){toast('Please enter a name.','error');return;}const req=state.requirements.find(r=>r.id===reqId);if(!req)return;req.subReqs=req.subReqs||[];if(req.subReqs.find(sr=>sr.name.toLowerCase()===name.toLowerCase())){toast('Sub-requirement already exists.','error');return;}req.subReqs.push({id:uid(),name,credits});saveData();renderAll();toast('Sub-requirement added.','success');}
function deleteSubReq(reqId,subId){const req=state.requirements.find(r=>r.id===reqId);if(!req)return;req.subReqs=(req.subReqs||[]).filter(sr=>sr.id!==subId);state.courses.forEach(c=>{if(c.reqId===reqId&&c.subReqId===subId)c.subReqId='';});saveData();renderAll();toast('Sub-requirement removed.');}
function addYear(){const name=document.getElementById('new-year-name').value.trim();const school=document.getElementById('new-year-school').value.trim()||state.student.school||'';if(!name){toast('Please enter a year name.','error');return;}if(state.years.find(y=>y.name.toLowerCase()===name.toLowerCase())){toast('Year already exists.','error');return;}state.years.push({id:uid(),name,school});document.getElementById('new-year-name').value='';saveData();renderAll();toast('Year added.','success');}
function deleteYear(yearId){if(state.courses.some(c=>c.yearId===yearId)){if(!confirm('This year has courses. Deleting removes the year assignment. Continue?'))return;state.courses.forEach(c=>{if(c.yearId===yearId)c.yearId='';});}state.years=state.years.filter(y=>y.id!==yearId);saveData();renderAll();toast('Year removed.');}
function addRequirement(){const name=document.getElementById('new-req-name').value.trim();const credits=parseFloat(document.getElementById('new-req-credits').value);if(!name){toast('Please enter a requirement name.','error');return;}if(isNaN(credits)||credits<=0){toast('Please enter a valid credit amount.','error');return;}if(state.requirements.find(r=>r.name.toLowerCase()===name.toLowerCase())){toast('Requirement already exists.','error');return;}state.requirements.push({id:uid(),name,credits,subReqs:[]});document.getElementById('new-req-name').value='';document.getElementById('new-req-credits').value='';saveData();renderAll();toast('Requirement added.','success');}
function deleteReq(reqId){if(state.courses.some(c=>c.reqId===reqId)){if(!confirm('Removing this will unassign courses. Continue?'))return;state.courses.forEach(c=>{if(c.reqId===reqId){c.reqId='';c.subReqId='';}});}state.requirements=state.requirements.filter(r=>r.id!==reqId);saveData();renderAll();toast('Requirement removed.');}

// Import / Export
function exportData(){const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),download:`gradtracker-${today()}.json`});a.click();toast('Data exported.','success');}
function importData(e){
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
      // Migrate status on import
      if(parsed.courses)parsed.courses=parsed.courses.map(c=>({...c,status:c.status||(c.planned?'planned':'earned'),catalogRef:c.catalogRef||null}));
      Object.assign(state,parsed);saveData();renderAll();renderBenchmarkInputs();toast('Data imported.','success');
    }catch{toast('Invalid file format.','error');}
  };reader.readAsText(file);e.target.value='';
}
function clearData(){if(!confirm('Clear ALL data including courses, pathways, and benchmarks?'))return;state={student:{name:'',gradYear:'',school:''},years:[],requirements:[],courses:[],benchmarks:JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)),keystoneScores:[],p3Records:[],p4Records:[],p5Evidence:[],plannedEvents:[]};saveData();renderAll();renderBenchmarkInputs();toast('All data cleared.');}

// Modal
// _modalProtected: when true, clicking outside or pressing Escape won't close
// the modal — used during multi-step catalog browser to prevent losing progress.
let _modalProtected = false;

function openModal(protected_=false) {
  _modalProtected=protected_;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}
function closeModal() {
  if(_modalProtected)return;   // blocked during catalog browser flow
  _modalProtected=false;
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow='';
}
function forceCloseModal() {
  // Bypass protection — used by explicit Cancel/Close buttons inside protected modals
  _modalProtected=false;
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow='';
}
document.getElementById('modal-close').addEventListener('click',forceCloseModal);
document.getElementById('modal-overlay').addEventListener('click',e=>{
  if(e.target===document.getElementById('modal-overlay'))closeModal();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

// Toast
let _toastTimer;
function toast(msg,type=''){const el=document.getElementById('toast');el.textContent=msg;el.className='toast'+(type?' '+type:'');clearTimeout(_toastTimer);_toastTimer=setTimeout(()=>{el.classList.add('toast-fade');setTimeout(()=>el.classList.add('hidden'),300);},2500);}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function registerSW(){if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});}
