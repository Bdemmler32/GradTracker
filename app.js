/* ============================================================
   GradTracker v1.5.0 — Application Logic
   Changes from v1.4.0:
   - Graduation Pathways rolled into main app
   - Unified state: one storage key, one JSON export
   - Collapsible sidebar groups (Pathways, Settings)
   - Settings split into 3 sub-pages
   - Data Management as standalone sidebar item
   - Keystone performance level auto-calculated from score
   ============================================================ */
'use strict';

// ══════════════════════════════════════════════════════════════
// STORAGE & STATE
// ══════════════════════════════════════════════════════════════
const STORAGE_KEY = 'gradtracker_data_v1';

// Default PA Act 158 benchmarks
const DEFAULT_BENCHMARKS = {
  keystone: {
    algebra:    { prof: 736,  adv: 748  },
    literature: { prof: 1500, adv: 1547 },
    biology:    { prof: 800,  adv: 841  }
  },
  sat:  { ebrw: 480, math: 530 },
  act:  { english: 18, math: 22, reading: 23, science: 23 },
  psat: { ebrw: 430, math: 480 }
};

let state = {
  // Credits tracker
  student:      { name: '', gradYear: '', school: '' },
  years:        [],   // [{id, name, school}]
  requirements: [],   // [{id, name, credits, subReqs:[{id,name,credits}]}]
  courses:      [],   // [{id, name, yearId, credits, grade, type, reqId, subReqId, planned}]
  // Pathways tracker
  benchmarks:         JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)),
  keystoneScores:     [],  // [{id, subject, date, score, level}]
  standardizedScores: [],  // [{id, test, section, date, score}]
  advancedCourses:    [],  // [{id, name, type, term, scoreRaw, notes, completed}]
  careerActivities:   [],  // [{id, type, name, date, hours, notes, completed}]
  plannedEvents:      []   // [{id, label, date, projectedScore}]
};

function loadData() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ── Constants ─────────────────────────────────────────────────
const GRADES           = ['A','B','C','D','F','P','NP','W','I','AU'];
const COURSE_TYPES     = ['Standard','VC','BC','AC'];
const KEYSTONE_SUBJECTS = ['Algebra I', 'Literature', 'Biology'];
const KEYSTONE_KEYS     = ['algebra', 'literature', 'biology'];
const SAT_SECTIONS      = ['EBRW', 'Math'];
const ACT_SECTIONS      = ['English', 'Math', 'Reading', 'Science'];
const PSAT_SECTIONS     = ['EBRW', 'Math'];
const ADVANCED_TYPES    = ['AP', 'IB', 'Dual Enrollment', 'CTE Concentration', 'SAT Subject Test'];
const CAREER_TYPES      = [
  { key: 'internship',   label: 'Internship / Co-op',          icon: 'fa-briefcase',       unit: 'hours',  threshold: 65  },
  { key: 'military',     label: 'Military Enlistment',          icon: 'fa-shield-halved',   unit: 'binary', threshold: 1   },
  { key: 'credential',   label: 'Industry Credential',          icon: 'fa-certificate',     unit: 'binary', threshold: 1   },
  { key: 'volunteering', label: 'Volunteering (Evidence-Based)', icon: 'fa-hands-helping',  unit: 'hours',  threshold: 200 },
  { key: 'program',      label: 'PA-Approved Program',          icon: 'fa-clipboard-check', unit: 'binary', threshold: 1   }
];

// ── Globals before init (TDZ safety) ─────────────────────────
let courseReqFilter  = '';
let _sidebarOpen     = { pathways: false, settings: false };

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
(function init() {
  checkMobileGate();
  window.addEventListener('resize', checkMobileGate);

  const saved = loadData();
  if (saved) {
    // Migrate older saves that lack pathways or benchmarks
    if (!saved.benchmarks) saved.benchmarks = JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
    else saved.benchmarks = Object.assign(JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)), saved.benchmarks);
    if (!saved.keystoneScores)     saved.keystoneScores     = [];
    if (!saved.standardizedScores) saved.standardizedScores = [];
    if (!saved.advancedCourses)    saved.advancedCourses    = [];
    if (!saved.careerActivities)   saved.careerActivities   = [];
    if (!saved.plannedEvents)      saved.plannedEvents      = [];
    if (saved.student && !saved.student.school) saved.student.school = '';
    if (saved.years) saved.years = saved.years.map(y => ({ school: '', ...y }));
    if (saved.requirements) saved.requirements = saved.requirements.map(r => ({
      ...r, subReqs: (r.subReqs || []).map(sr => ({ credits: 0, ...sr }))
    }));
    Object.assign(state, saved);
  }

  setupNavigation();
  setupSettingsListeners();
  setupCoursesListeners();
  renderAll();
  renderBenchmarkInputs();
  registerSW();

  // Default active page
  navigateTo('dashboard');

  if (!state.student.name && state.courses.length === 0) showOnboarding();
})();

// ── Mobile gate ───────────────────────────────────────────────
function checkMobileGate() {
  const gate    = document.getElementById('mobile-gate');
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main-content');
  const narrow  = window.innerWidth < 900;
  gate.style.display    = narrow ? 'flex' : 'none';
  sidebar.style.display = narrow ? 'none'  : '';
  main.style.display    = narrow ? 'none'  : '';
}

// ══════════════════════════════════════════════════════════════
// NAVIGATION — collapsible sidebar groups
// ══════════════════════════════════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page  = link.dataset.page;
      const group = link.dataset.group;

      if (group) {
        // It's a group header — toggle group AND navigate to default page
        toggleGroup(group);
        if (page) navigateTo(page);
      } else if (page) {
        navigateTo(page);
      }
    });
  });

  // Inline links inside page content
  document.querySelectorAll('.inline-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      if (page) navigateTo(page);
    });
  });
}

function toggleGroup(group) {
  _sidebarOpen[group] = !_sidebarOpen[group];
  const sub     = document.getElementById(`sub-${group}`);
  const chevron = document.getElementById(`chevron-${group}`);
  if (sub)     sub.classList.toggle('open', _sidebarOpen[group]);
  if (chevron) chevron.classList.toggle('rotated', _sidebarOpen[group]);
}

function openGroup(group) {
  if (_sidebarOpen[group]) return;
  _sidebarOpen[group] = true;
  document.getElementById(`sub-${group}`)?.classList.add('open');
  document.getElementById(`chevron-${group}`)?.classList.add('rotated');
}

function navigateTo(page, extraData) {
  // Deactivate all
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  // Activate target page
  document.getElementById('page-' + page)?.classList.add('active');

  // Activate nav link (group header or sub-link)
  const exactLink = document.querySelector(`.nav-link[data-page="${page}"]:not([data-group])`);
  if (exactLink) exactLink.classList.add('active');
  // Also highlight group header when a child is active
  if (page.startsWith('pathways-')) {
    document.querySelector('.nav-link[data-group="pathways"]')?.classList.add('active');
    openGroup('pathways');
  } else if (page.startsWith('settings-')) {
    document.querySelector('.nav-link[data-group="settings"]')?.classList.add('active');
    openGroup('settings');
  }

  if (page === 'courses' && extraData?.reqId !== undefined) courseReqFilter = extraData.reqId;

  // Render the right page
  const renders = {
    'dashboard':              renderDashboard,
    'courses':                renderCourses,
    'stats':                  renderStats,
    'pathways-overview':      renderPathwayOverview,
    'pathways-keystones':     renderKeystones,
    'pathways-standardized':  renderStandardized,
    'pathways-advanced':      renderAdvanced,
    'pathways-career':        renderCareer,
    'pathways-projection':    renderProjection,
    'settings-student':       renderSettingsStudent,
    'settings-requirements':  renderSettingsRequirements,
    'settings-benchmarks':    () => {},   // static, inputs always in DOM
    'data-management':        () => {}    // static
  };
  renders[page]?.();
}

function renderAll() {
  renderDashboard();
  renderCourses();
  renderStats();
  renderPathwayOverview();
  renderKeystones();
  renderStandardized();
  renderAdvanced();
  renderCareer();
  renderProjection();
  renderSettingsStudent();
  renderSettingsRequirements();
  updatePathwayNavDots();
}

// ══════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════
function uid()     { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fmtDate(d){ if (!d) return '—'; const p=d.split('-'); return `${p[1]}/${p[2]}/${p[0]}`; }
function today()   { return new Date().toISOString().slice(0,10); }
function esc(str)  { return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n) {
  const v = Number(n);
  if (isNaN(v)) return '0';
  return parseFloat(v.toFixed(2)).toString();
}

// Credits helpers
function getYear(id)    { return state.years.find(y => y.id === id); }
function getYearName(id){ return getYear(id)?.name || '—'; }
function getReq(id)     { return state.requirements.find(r => r.id === id); }
function getReqName(id) { return getReq(id)?.name || 'Uncategorized'; }

function creditsEarnedForReq(reqId) { return state.courses.filter(c=>c.reqId===reqId&&!c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function creditsPlannedForReq(reqId){ return state.courses.filter(c=>c.reqId===reqId&&c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalEarned()   { return state.courses.filter(c=>!c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalPlanned()  { return state.courses.filter(c=> c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalRequired() { return state.requirements.reduce((s,r)=>s+Number(r.credits||0),0); }

function creditsByYear() {
  const map = {};
  state.years.forEach(y => { map[y.id] = {earned:0,planned:0}; });
  state.courses.forEach(c => {
    if (!c.yearId) return;
    if (!map[c.yearId]) map[c.yearId] = {earned:0,planned:0};
    c.planned ? map[c.yearId].planned += Number(c.credits||0)
              : map[c.yearId].earned  += Number(c.credits||0);
  });
  return map;
}

function subReqStatus(req, sr) {
  const srName = sr.name.trim().toLowerCase();
  const matches = state.courses.filter(c => c.reqId===req.id && c.name.trim().toLowerCase()===srName);
  if (matches.some(c=>!c.planned)) return 'earned';
  if (matches.some(c=> c.planned)) return 'planned';
  return null;
}

// ── Keystone level auto-calculation ──────────────────────────
function calcKeystoneLevel(subject, score) {
  const key = KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(subject)];
  const bm  = state.benchmarks.keystone[key];
  if (!bm) return 'Basic';
  if (score >= bm.adv)  return 'Advanced';
  if (score >= bm.prof) return 'Proficient';
  return 'Basic';
}

// ══════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════
function showOnboarding() {
  document.getElementById('onboard-overlay').classList.remove('hidden');
  document.getElementById('ob-name').focus();
}
function hideOnboarding() {
  document.getElementById('onboard-overlay').classList.add('hidden');
}
document.getElementById('ob-next').addEventListener('click', () => {
  const name     = document.getElementById('ob-name').value.trim();
  const school   = document.getElementById('ob-school').value.trim();
  const gradYear = document.getElementById('ob-grad-year').value.trim();
  state.student.name    = name;
  state.student.school  = school;
  state.student.gradYear = gradYear;
  saveData();
  document.getElementById('student-name').value   = name;
  document.getElementById('student-school').value = school;
  document.getElementById('grad-year').value      = gradYear;
  document.getElementById('new-year-school').value = school;
  hideOnboarding();
  navigateTo('settings-requirements');
  renderDashboard();
  toast(`Welcome, ${name||'there'}! Now add your graduation requirements.`, 'success');
});
document.getElementById('ob-skip').addEventListener('click', hideOnboarding);

// ══════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════
function renderDashboard() {
  const earned   = totalEarned();
  const planned  = totalPlanned();
  const required = totalRequired();
  const pctE  = required > 0 ? Math.min(100, (earned / required) * 100) : 0;
  const pctP  = required > 0 ? Math.min(100 - pctE, (planned / required) * 100) : 0;
  const pctWP = required > 0 ? Math.min(100, ((earned + planned) / required) * 100) : 0;

  document.getElementById('dash-heading').textContent = state.student.name ? `Welcome, ${state.student.name}` : 'Dashboard';
  const sub = [];
  if (state.student.school)   sub.push(state.student.school);
  if (state.student.gradYear) sub.push(`Class of ${state.student.gradYear}`);
  document.getElementById('dash-subtitle').textContent = sub.length ? sub.join(' · ') : 'Your graduation progress at a glance';

  document.getElementById('dash-earned').textContent   = fmt(earned);
  document.getElementById('dash-required').textContent = fmt(required);
  document.getElementById('dash-pct').textContent      = fmt(pctE) + '%';
  document.getElementById('dash-progress-bar').style.width = pctE + '%';
  document.getElementById('dash-planned-bar').style.width  = pctP + '%';
  document.getElementById('dash-planned').textContent  = fmt(planned);
  document.getElementById('dash-planned-wrap').style.visibility = planned > 0 ? 'visible' : 'hidden';
  document.getElementById('legend-planned-item').style.display  = planned > 0 ? '' : 'none';

  const pctWPEl = document.getElementById('dash-pct-with-planned');
  if (planned > 0 && required > 0) { pctWPEl.textContent = fmt(pctWP) + '% with planned'; pctWPEl.style.display = 'block'; }
  else pctWPEl.style.display = 'none';

  document.getElementById('no-requirements-notice').classList.toggle('hidden', state.requirements.length > 0);

  // Requirements grid
  const grid = document.getElementById('dash-req-grid');
  grid.innerHTML = '';
  state.requirements.forEach(req => {
    const e = creditsEarnedForReq(req.id), p = creditsPlannedForReq(req.id);
    const pct  = req.credits > 0 ? Math.min(100, (e/req.credits)*100) : 0;
    const pctP = req.credits > 0 ? Math.min(100-pct, (p/req.credits)*100) : 0;
    const complete = e >= req.credits && req.credits > 0;

    const subReqsHtml = (req.subReqs||[]).length ? `
      <div class="req-card-subreqs">${req.subReqs.map(sr => {
        const status = subReqStatus(req, sr);
        const crStr  = Number(sr.credits) > 0 ? ` (${fmt(sr.credits)})` : '';
        const cls    = status==='earned' ? 'subreq-chip sr-met' : status==='planned' ? 'subreq-chip sr-planned' : 'subreq-chip';
        const icon   = status==='earned' ? '✓ ' : status==='planned' ? '◷ ' : '';
        return `<span class="${cls}">${icon}${esc(sr.name)}${crStr}</span>`;
      }).join('')}</div>` : '';

    grid.innerHTML += `
      <div class="req-card ${complete?'complete':''}" role="button" tabindex="0"
           onclick="openReqCourses('${req.id}')" onkeydown="if(event.key==='Enter')openReqCourses('${req.id}')">
        <span class="req-badge">${complete ? '✓ Met' : fmt(pct) + '%'}</span>
        <div class="req-card-name">${esc(req.name)}</div>
        <div class="req-card-credits">${fmt(e)} <span>/ ${fmt(req.credits)} credits</span></div>
        ${p > 0 ? `<div class="req-card-planned">+${fmt(p)} planned</div>` : ''}
        ${subReqsHtml}
        <div class="req-card-bar-wrap">
          <div class="req-card-bar" style="width:${pct}%"></div>
          <div class="req-card-bar planned-seg" style="width:${pctP}%"></div>
        </div>
        <div class="req-card-click-hint">
          <svg viewBox="0 0 24 24" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          View courses
        </div>
      </div>`;
  });

  // Year cards
  const yearCards = document.getElementById('dash-year-cards');
  yearCards.innerHTML = '';
  const byYear = creditsByYear();
  state.years.forEach(y => {
    const {earned:e, planned:p} = byYear[y.id]||{earned:0,planned:0};
    const cnt = state.courses.filter(co=>co.yearId===y.id).length;
    yearCards.innerHTML += `
      <div class="year-card">
        <div class="year-card-name">${esc(y.name)}</div>
        ${y.school ? `<div class="year-card-school">${esc(y.school)}</div>` : ''}
        <div class="year-card-credits">${fmt(e)}</div>
        ${p > 0 ? `<div class="year-card-planned">+${fmt(p)} planned</div>` : ''}
        <div class="year-card-sub">${cnt} course${cnt!==1?'s':''}</div>
      </div>`;
  });
  if (!state.years.length && state.requirements.length > 0)
    yearCards.innerHTML = '<p class="text-muted" style="font-size:.85rem">No school years defined yet. Add years in Student Information.</p>';
}

function openReqCourses(reqId) { courseReqFilter = reqId; navigateTo('courses', { reqId }); }

// ══════════════════════════════════════════════════════════════
// COURSES
// ══════════════════════════════════════════════════════════════
function setupCoursesListeners() {
  document.getElementById('btn-add-course').addEventListener('click', () => openCourseModal());
  document.getElementById('filter-year').addEventListener('change', renderCourses);
  document.getElementById('filter-req').addEventListener('change', renderCourses);
  document.getElementById('filter-status').addEventListener('change', renderCourses);
}

function renderCourses() {
  const fyEl = document.getElementById('filter-year');
  const frEl = document.getElementById('filter-req');
  const fsEl = document.getElementById('filter-status');
  const savedY = fyEl.value, savedS = fsEl.value;

  fyEl.innerHTML = '<option value="">All Years</option>';
  state.years.forEach(y => { fyEl.innerHTML += `<option value="${y.id}" ${savedY===y.id?'selected':''}>${esc(y.name)}</option>`; });

  const pendingR = courseReqFilter || frEl.value;
  frEl.innerHTML = '<option value="">All Categories</option>';
  state.requirements.forEach(r => { frEl.innerHTML += `<option value="${r.id}" ${pendingR===r.id?'selected':''}>${esc(r.name)}</option>`; });
  if (courseReqFilter) { frEl.value = courseReqFilter; courseReqFilter = ''; }

  let courses = state.courses.slice();
  if (fyEl.value)            courses = courses.filter(c => c.yearId===fyEl.value);
  if (frEl.value)            courses = courses.filter(c => c.reqId===frEl.value);
  if (savedS==='earned')     courses = courses.filter(c => !c.planned);
  if (savedS==='planned')    courses = courses.filter(c =>  c.planned);

  const tbody = document.getElementById('courses-tbody');
  if (!courses.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No courses match the current filters.</td></tr>'; return; }

  const yo = state.years.reduce((m,y,i) => { m[y.id]=i; return m; }, {});
  courses.sort((a,b) => {
    if (!!a.planned !== !!b.planned) return a.planned ? 1 : -1;
    return (yo[a.yearId]??99) - (yo[b.yearId]??99);
  });

  tbody.innerHTML = courses.map(c => {
    const gClass = ['A','B','C','D','F','P'].includes(c.grade) ? c.grade : '';
    const statusSelect = `<select class="status-select ${c.planned?'sel-planned':'sel-earned'}" onchange="handleStatusChange('${c.id}',this.value)">
      <option value="earned"  ${!c.planned?'selected':''}>✓ Earned</option>
      <option value="planned" ${ c.planned?'selected':''}>◷ Planned</option></select>`;
    const typeBadge = c.type && c.type!=='Standard'
      ? `<span class="type-badge type-${c.type}">${esc(c.type)}</span>`
      : (c.type==='Standard' ? '<span class="type-badge type-std">Std</span>' : '—');

    const req = getReq(c.reqId);
    let catDisplay = esc(getReqName(c.reqId));
    if (c.subReqId && req) {
      const sub = req.subReqs?.find(sr=>sr.id===c.subReqId);
      if (sub) catDisplay += `<br><span class="subreq-label">${esc(sub.name)}</span>`;
    }
    let srMatchHtml = '';
    if (req) {
      const matchedSr = req.subReqs?.find(sr=>sr.name.trim().toLowerCase()===c.name.trim().toLowerCase());
      if (matchedSr) {
        const st = subReqStatus(req, matchedSr);
        if (st) srMatchHtml = `<span class="sr-match-tag ${st==='earned'?'sr-match-earned':'sr-match-planned'}">${st==='earned'?'✓':'◷'} Sub-req</span>`;
      }
    }

    return `<tr class="${c.planned?'row-planned':''}">
      <td class="td-course-name">${esc(c.name)}${srMatchHtml}</td>
      <td class="td-year">${esc(getYearName(c.yearId))}</td>
      <td class="col-center"><strong>${fmt(c.credits)}</strong></td>
      <td class="col-center">${c.grade?`<span class="grade-badge ${gClass}">${esc(c.grade)}</span>`:'—'}</td>
      <td class="col-center">${typeBadge}</td>
      <td class="td-cat">${catDisplay}</td>
      <td class="col-center">${statusSelect}</td>
      <td><div class="action-btns">
        <button class="btn-icon" onclick="openCourseModal('${c.id}')" title="Edit">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon delete" onclick="deleteCourse('${c.id}')" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
}

function handleStatusChange(courseId, newStatus) {
  const course = state.courses.find(c=>c.id===courseId);
  if (!course) return;
  if (newStatus==='earned' && course.planned) openEarnedModal(courseId);
  else if (newStatus==='planned' && !course.planned) { course.planned=true; saveData(); renderAll(); toast('Course marked as Planned.','success'); }
}

function openEarnedModal(courseId) {
  const c = state.courses.find(x=>x.id===courseId);
  if (!c) return;
  const gradeOpts = GRADES.map(g=>`<option value="${g}" ${c.grade===g?'selected':''}>${g}</option>`).join('');
  document.getElementById('modal-title').textContent = 'Mark as Earned';
  document.getElementById('modal-body').innerHTML = `
    <div class="earned-modal-info">
      <div class="earned-course-name">${esc(c.name)}</div>
      <div class="earned-course-meta">${fmt(c.credits)} credits · ${esc(getYearName(c.yearId))} · ${esc(getReqName(c.reqId))}</div>
    </div>
    <div class="status-change-banner">
      <span class="status-badge planned" style="font-size:.78rem">◷ Planned</span>
      <span class="status-arrow">→</span>
      <span class="status-badge earned" style="font-size:.78rem">✓ Earned</span>
    </div>
    <div class="form-group" style="margin-top:16px">
      <label for="em-grade">Grade Received</label>
      <select id="em-grade"><option value="">— Select grade —</option>${gradeOpts}</select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="em-save">Save as Earned</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', () => { closeModal(); renderCourses(); });
  document.getElementById('em-save').addEventListener('click', () => {
    c.planned=false; c.grade=document.getElementById('em-grade').value||c.grade;
    saveData(); closeModal(); renderAll(); toast('Course marked as Earned!','success');
  });
  openModal();
}

function openCourseModal(courseId) {
  const c = courseId ? state.courses.find(x=>x.id===courseId) : null;
  document.getElementById('modal-title').textContent = c ? 'Edit Course' : 'Add Course';

  const yearOpts = state.years.map(y=>`<option value="${y.id}" ${c?.yearId===y.id?'selected':''}>${esc(y.name)}</option>`).join('');
  const reqOpts  = state.requirements.map(r => {
    const subs = (r.subReqs||[]).map(sr=>{
      const cr = Number(sr.credits)>0?` (${fmt(sr.credits)} cr)`:'';
      return `<option value="${r.id}|${sr.id}" ${c?.reqId===r.id&&c?.subReqId===sr.id?'selected':''}>  ↳ ${esc(sr.name)}${cr}</option>`;
    }).join('');
    return `<option value="${r.id}" ${c?.reqId===r.id&&!c?.subReqId?'selected':''}>${esc(r.name)}</option>${subs}`;
  }).join('');
  const gradeOpts = GRADES.map(g=>`<option value="${g}" ${c?.grade===g?'selected':''}>${g}</option>`).join('');
  const typeOpts  = COURSE_TYPES.map(t=>`<option value="${t}" ${(c?.type||'Standard')===t?'selected':''}>${t}</option>`).join('');

  document.getElementById('modal-body').innerHTML = `
    <div class="form-group"><label for="c-name">Course Name *</label>
      <input type="text" id="c-name" placeholder="e.g. Algebra II" value="${esc(c?.name||'')}" /></div>
    <div class="form-row">
      <div class="form-group"><label for="c-year">School Year</label>
        <select id="c-year"><option value="">— Select —</option>${yearOpts}</select></div>
      <div class="form-group"><label for="c-credits">Credits *</label>
        <input type="number" id="c-credits" placeholder="1.0" min="0" step="0.5" value="${c?.credits??''}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label for="c-grade">Grade</label>
        <select id="c-grade"><option value="">— Select —</option>${gradeOpts}</select></div>
      <div class="form-group"><label for="c-type">Course Type</label>
        <select id="c-type">${typeOpts}</select></div>
    </div>
    <div class="form-group"><label for="c-req">Requirement Category</label>
      <select id="c-req"><option value="">— Uncategorized —</option>${reqOpts}</select></div>
    <div class="form-group" style="margin-top:4px">
      <label class="toggle-label">
        <input type="checkbox" id="c-planned" ${c?.planned?'checked':''} />
        <span class="toggle-track"></span>
        <span class="toggle-text">Mark as <strong>Planned</strong> (not yet earned)</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save Course</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', () => saveCourse(courseId));
  openModal();
  document.getElementById('c-name').focus();
}

function saveCourse(courseId) {
  const name    = document.getElementById('c-name').value.trim();
  const credits = parseFloat(document.getElementById('c-credits').value);
  const yearId  = document.getElementById('c-year').value;
  const grade   = document.getElementById('c-grade').value;
  const type    = document.getElementById('c-type').value;
  const planned = document.getElementById('c-planned').checked;
  const reqVal  = document.getElementById('c-req').value;
  let reqId='', subReqId='';
  if (reqVal.includes('|')) [reqId,subReqId]=reqVal.split('|'); else reqId=reqVal;

  if (!name) { toast('Please enter a course name.','error'); return; }
  if (isNaN(credits)||credits<0) { toast('Please enter a valid credit value.','error'); return; }

  const data = { name, credits, yearId, grade, type, reqId, subReqId, planned };
  if (courseId) Object.assign(state.courses.find(c=>c.id===courseId), data);
  else state.courses.push({ id:uid(), ...data });
  saveData(); closeModal(); renderAll();
  toast(courseId?'Course updated.':'Course added.','success');
}

function deleteCourse(id) {
  if (!confirm('Delete this course?')) return;
  state.courses = state.courses.filter(c=>c.id!==id);
  saveData(); renderAll(); toast('Course deleted.');
}

// ══════════════════════════════════════════════════════════════
// STATISTICS
// ══════════════════════════════════════════════════════════════
function renderStats() {
  const earned = totalEarned(), planned = totalPlanned(), required = totalRequired();
  const remaining = Math.max(0, required-earned);
  const metCount = state.requirements.filter(r=>creditsEarnedForReq(r.id)>=r.credits&&r.credits>0).length;
  const pct = required>0 ? (earned/required)*100 : 0;
  const yearsW = state.years.filter(y=>state.courses.some(c=>c.yearId===y.id&&!c.planned));
  const avg  = yearsW.length>0 ? earned/yearsW.length : 0;

  document.getElementById('stat-total-courses').textContent     = state.courses.length;
  document.getElementById('stat-credits-earned').textContent    = fmt(earned);
  document.getElementById('stat-credits-remaining').textContent = fmt(remaining);
  document.getElementById('stat-credits-planned').textContent   = fmt(planned);
  document.getElementById('stat-reqs-met').textContent          = `${metCount} / ${state.requirements.length}`;
  document.getElementById('stat-completion').textContent        = fmt(pct)+'%';
  document.getElementById('stat-avg-credits').textContent       = fmt(avg);
  document.getElementById('stat-grad-year').textContent         = state.student.gradYear||'—';

  // Bar chart
  const byYear = creditsByYear();
  const maxC   = Math.max(...state.years.map(y=>(byYear[y.id]?.earned||0)+(byYear[y.id]?.planned||0)),1);
  document.getElementById('bar-chart-years').innerHTML = !state.years.length
    ? '<p class="text-muted" style="font-size:.85rem;padding:20px 0">No years defined.</p>'
    : state.years.map(y=>{
        const e=byYear[y.id]?.earned||0, p=byYear[y.id]?.planned||0;
        const hE=Math.round((e/maxC)*140), hP=Math.round((p/maxC)*140);
        return `<div class="bar-col">
          <div class="bar-col-val">${fmt(e)}${p>0?`<span class="bar-plan-label">+${fmt(p)}</span>`:''}</div>
          <div class="bar-col-inner-wrap" style="height:${hE+hP}px">
            ${p>0?`<div class="bar-seg planned" style="height:${hP}px"></div>`:''}
            <div class="bar-seg earned" style="height:${hE}px"></div>
          </div>
          <div class="bar-col-label">${esc(y.name)}</div>
        </div>`;
      }).join('');

  // Req breakdown
  document.getElementById('req-breakdown').innerHTML = !state.requirements.length
    ? '<p class="text-muted" style="font-size:.85rem">No requirements defined.</p>'
    : state.requirements.map(req=>{
        const e=creditsEarnedForReq(req.id), p=creditsPlannedForReq(req.id);
        const pct=req.credits>0?Math.min(100,(e/req.credits)*100):0;
        const pctP=req.credits>0?Math.min(100-pct,(p/req.credits)*100):0;
        const done=e>=req.credits&&req.credits>0;
        const subH=(req.subReqs||[]).length
          ?`<div class="breakdown-subreqs">${req.subReqs.map(sr=>{
              const st=subReqStatus(req,sr); const cr=Number(sr.credits)>0?` (${fmt(sr.credits)})`:'';
              const cls=st==='earned'?'subreq-chip sm sr-met':st==='planned'?'subreq-chip sm sr-planned':'subreq-chip sm';
              return `<span class="${cls}">${st==='earned'?'✓ ':st==='planned'?'◷ ':''}${esc(sr.name)}${cr}</span>`;
            }).join('')}</div>`:''
        ;
        return `<div class="req-row">
          <div class="req-row-name">${esc(req.name)}${subH}</div>
          <div class="req-row-bar-wrap">
            <div class="req-row-bar ${done?'done':''}" style="width:${pct}%"></div>
            <div class="req-row-bar-gold" style="width:${pctP}%"></div>
          </div>
          <div class="req-row-credits">${fmt(e)}${p>0?`<span class="plan-inline">+${fmt(p)}</span>`:''} / ${fmt(req.credits)}</div>
        </div>`;
      }).join('');

  // Grade dist
  const gradesE={}, gradesP={};
  state.courses.forEach(c=>{ if(!c.grade) return; c.planned ? gradesP[c.grade]=(gradesP[c.grade]||0)+1 : gradesE[c.grade]=(gradesE[c.grade]||0)+1; });
  const og = GRADES.filter(g=>gradesE[g]||gradesP[g]);
  document.getElementById('grade-dist').innerHTML = og.length
    ? og.map(g=>`<div class="grade-dist-item">
        <div class="grade-dist-count">${gradesE[g]||0}</div>
        ${gradesP[g]?`<div class="grade-planned-note">+${gradesP[g]}</div>`:''}
        <div class="grade-dist-label">${g}</div>
      </div>`).join('')
    : '<p class="text-muted" style="font-size:.85rem">No grade data available.</p>';
}

// ══════════════════════════════════════════════════════════════
// PATHWAY STATUS COMPUTATIONS
// ══════════════════════════════════════════════════════════════
function keystoneStatus() {
  const bm = state.benchmarks.keystone;
  const subjects = { algebra:{met:false,best:null}, literature:{met:false,best:null}, biology:{met:false,best:null} };
  state.keystoneScores.forEach(s=>{
    const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(s.subject)];
    if(!key) return;
    if(!subjects[key].best||s.score>subjects[key].best) subjects[key].best=s.score;
    if(s.score>=bm[key].prof) subjects[key].met=true;
  });
  const allMet=Object.values(subjects).every(s=>s.met);
  const anyMet=Object.values(subjects).some(s=>s.met);
  return { subjects, allMet, anyMet, status:allMet?'met':anyMet?'partial':'none' };
}

function satStatus() {
  const bm=state.benchmarks.sat;
  const best={EBRW:null,Math:null};
  state.standardizedScores.filter(s=>s.test==='SAT').forEach(s=>{ if(!best[s.section]||s.score>best[s.section]) best[s.section]=s.score; });
  const ebrwMet=best.EBRW!==null&&best.EBRW>=bm.ebrw, mathMet=best.Math!==null&&best.Math>=bm.math;
  return { best, ebrwMet, mathMet, met:ebrwMet&&mathMet, sections:best, status:(ebrwMet&&mathMet)?'met':(ebrwMet||mathMet)?'partial':'none' };
}

function actStatus() {
  const bm=state.benchmarks.act;
  const keys={English:'english',Math:'math',Reading:'reading',Science:'science'};
  const best={English:null,Math:null,Reading:null,Science:null};
  state.standardizedScores.filter(s=>s.test==='ACT').forEach(s=>{ if(!best[s.section]||s.score>best[s.section]) best[s.section]=s.score; });
  const sectionMet={};
  ACT_SECTIONS.forEach(sec=>{ sectionMet[sec]=best[sec]!==null&&best[sec]>=bm[keys[sec]]; });
  const met=ACT_SECTIONS.every(s=>sectionMet[s]);
  return { best, sectionMet, met, status:met?'met':ACT_SECTIONS.some(s=>sectionMet[s])?'partial':'none' };
}

function psatStatus() {
  const bm=state.benchmarks.psat;
  const best={EBRW:null,Math:null};
  state.standardizedScores.filter(s=>s.test==='PSAT').forEach(s=>{ if(!best[s.section]||s.score>best[s.section]) best[s.section]=s.score; });
  const ebrwMet=best.EBRW!==null&&best.EBRW>=bm.ebrw, mathMet=best.Math!==null&&best.Math>=bm.math;
  return { best, ebrwMet, mathMet, met:ebrwMet&&mathMet, status:(ebrwMet&&mathMet)?'met':(ebrwMet||mathMet)?'partial':'none' };
}

function standardizedStatus() {
  const sat=satStatus(),act=actStatus(),psat=psatStatus();
  const met=sat.met||act.met||psat.met;
  const partial=sat.status!=='none'||act.status!=='none'||psat.status!=='none';
  return { sat, act, psat, met, status:met?'met':partial?'partial':'none' };
}

function advancedStatus() {
  const thresh={AP:3,IB:4,'Dual Enrollment':null,'CTE Concentration':null,'SAT Subject Test':630};
  const qualifying=state.advancedCourses.filter(c=>{
    if(c.type==='Dual Enrollment') return gradeQualifies(c.scoreRaw);
    if(c.type==='CTE Concentration') return c.completed;
    const min=thresh[c.type]; return min!==null&&Number(c.scoreRaw)>=min;
  });
  return { qualifying, met:qualifying.length>0, status:qualifying.length>0?'met':state.advancedCourses.length?'partial':'none' };
}

function gradeQualifies(grade) {
  if(!grade) return false;
  return ['A+','A','A-','B+','B','B-','C+','C'].includes(String(grade).trim().toUpperCase());
}

function careerStatus() {
  const typeStatus={};
  CAREER_TYPES.forEach(t=>{
    const items=state.careerActivities.filter(a=>a.type===t.key);
    if(t.unit==='binary') typeStatus[t.key]={met:items.some(a=>a.completed),count:items.filter(a=>a.completed).length,total:items.length};
    else { const hrs=items.reduce((s,a)=>s+Number(a.hours||0),0); typeStatus[t.key]={met:hrs>=t.threshold,hours:hrs,threshold:t.threshold}; }
  });
  return { typeStatus, met:Object.values(typeStatus).some(s=>s.met), status:Object.values(typeStatus).some(s=>s.met)?'met':state.careerActivities.length?'partial':'none' };
}

function allPathwayStatuses() {
  return { keystones:keystoneStatus(), standardized:standardizedStatus(), advanced:advancedStatus(), career:careerStatus() };
}

function isEligible(s) { return Object.values(s).some(x=>x.met); }

function updatePathwayNavDots() {
  const s=allPathwayStatuses();
  const map={'pdot-keystones':s.keystones.status,'pdot-standardized':s.standardized.status,'pdot-advanced':s.advanced.status,'pdot-career':s.career.status};
  Object.entries(map).forEach(([id,status])=>{
    const el=document.getElementById(id);
    if(el) el.className='pathway-status-dot '+(status==='met'?'dot-met':status==='partial'?'dot-partial':'dot-none');
  });
  const eligible=isEligible(s), anyPartial=Object.values(s).some(x=>x.status==='partial');
  const overall=document.getElementById('pdot-overall');
  if(overall) overall.className='pathway-status-dot '+(eligible?'dot-met':anyPartial?'dot-partial':'dot-none');
}

// ══════════════════════════════════════════════════════════════
// PATHWAY PAGES
// ══════════════════════════════════════════════════════════════
function renderPathwayOverview() {
  const s=allPathwayStatuses(), eligible=isEligible(s), anyPartial=Object.values(s).some(x=>x.status!=='none');
  updatePathwayNavDots();

  // Banner
  const banner=document.getElementById('eligibility-banner');
  const title=document.getElementById('eligibility-title');
  const detail=document.getElementById('eligibility-detail');
  const icon=banner.querySelector('.elig-icon');
  const metNames=Object.entries(s).filter(([,v])=>v.met).map(([k])=>pathwayLabel(k));
  if(eligible) {
    banner.className='eligibility-banner eligible';
    if(icon) icon.className='fa-solid fa-circle-check elig-icon';
    title.textContent='✓ Graduation Eligible — Pathway Requirement Met';
    detail.textContent='Completed: '+metNames.join(', ');
  } else if(anyPartial) {
    banner.className='eligibility-banner partial';
    if(icon) icon.className='fa-solid fa-hourglass-half elig-icon';
    title.textContent='In Progress — Not Yet Eligible';
    detail.textContent='At least one pathway must be fully completed.';
  } else {
    banner.className='eligibility-banner not-eligible';
    if(icon) icon.className='fa-solid fa-circle-info elig-icon';
    title.textContent='Pathway Eligibility: Not Yet Determined';
    detail.textContent='Complete at least one full pathway to meet graduation requirements.';
  }

  // Pathway cards
  const pathways=[
    {key:'keystones',    icon:'fa-pencil',        label:'Keystone Exams',      desc:descKeystone(s.keystones),    page:'pathways-keystones'},
    {key:'standardized', icon:'fa-chart-bar',      label:'SAT / ACT / PSAT',    desc:descStandard(s.standardized), page:'pathways-standardized'},
    {key:'advanced',     icon:'fa-graduation-cap', label:'Advanced Coursework', desc:descAdvanced(s.advanced),     page:'pathways-advanced'},
    {key:'career',       icon:'fa-briefcase',      label:'Career & Military',   desc:descCareer(s.career),         page:'pathways-career'}
  ];
  document.getElementById('pathway-overview-grid').innerHTML = pathways.map(p=>{
    const status=s[p.key].status;
    const lbl=status==='met'?'✓ Met':status==='partial'?'◷ In Progress':'○ Not Started';
    return `<div class="pathway-card status-${status}" onclick="navigateTo('${p.page}')" role="button" tabindex="0">
      <div class="pathway-card-icon"><i class="fa-solid ${p.icon}"></i></div>
      <div class="pathway-card-name">${p.label}</div>
      <div class="pathway-card-status">${lbl}</div>
      <div class="pathway-card-detail">${p.desc}</div>
      <div class="pathway-card-cta mt-8">Click to view details →</div>
    </div>`;
  }).join('');

  // Progress card
  const metCount=Object.values(s).filter(x=>x.met).length;
  document.getElementById('pathway-progress-card').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:.87rem;color:var(--gray-600)">Pathways completed: <strong style="color:var(--blue-dark)">${metCount} / 4</strong></span>
      <span style="font-size:.87rem;color:var(--gray-600)">You only need <strong style="color:var(--green)">1</strong> to be eligible</span>
    </div>
    <div class="prog-wrap" style="height:12px">
      <div class="prog-bar ${metCount>0?'green':''}" style="width:${(metCount/4)*100}%"></div>
    </div>`;
}

function pathwayLabel(key) { return {keystones:'Keystone Exams',standardized:'SAT/ACT/PSAT',advanced:'Advanced Coursework',career:'Career & Military'}[key]||key; }
function descKeystone(s)   { return `${Object.values(s.subjects).filter(x=>x.met).length}/3 subjects Proficient or higher`; }
function descStandard(s)   { const w=[s.sat.met&&'SAT',s.act.met&&'ACT',s.psat.met&&'PSAT'].filter(Boolean); return w.length?w.join(', ')+' benchmarks met':'No test fully met benchmarks yet'; }
function descAdvanced(s)   { return s.qualifying.length?`${s.qualifying.length} qualifying entr${s.qualifying.length===1?'y':'ies'} on record`:'No qualifying entry yet'; }
function descCareer(s)     { return Object.values(s.typeStatus).some(x=>x.met)?'At least one activity type met':'No qualifying activity completed'; }

function renderKeystones() {
  const s=keystoneStatus(), bm=state.benchmarks.keystone;
  const badge=document.getElementById('keystone-pathway-badge');
  badge.textContent=s.allMet?'✓ Pathway Met':s.anyMet?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(s.allMet?'badge-met':s.anyMet?'badge-partial':'badge-none');

  document.getElementById('keystone-subjects').innerHTML = KEYSTONE_SUBJECTS.map((subj,i)=>{
    const key=KEYSTONE_KEYS[i], info=s.subjects[key], prof=bm[key]?.prof??0;
    const pct=info.best?Math.min(100,(info.best/(prof*1.15))*100):0;
    const badge=info.met?'badge-met':info.best?'badge-partial':'badge-none';
    const label=info.met?`✓ Proficient`:info.best?`Best: ${info.best}`:'Not Taken';
    return `<div class="subject-row">
      <div class="subject-name">${subj}</div>
      <div><div class="prog-wrap"><div class="prog-bar ${info.met?'green':''}" style="width:${pct}%"></div></div></div>
      <div class="subject-score-info">Benchmark: ≥ ${prof}</div>
      <div><span class="subject-badge ${badge}">${label}</span></div>
    </div>`;
  }).join('');

  const tbody=document.getElementById('keystone-log-tbody');
  if(!state.keystoneScores.length) { tbody.innerHTML='<tr class="empty-row"><td colspan="6">No scores logged yet.</td></tr>'; return; }
  const sorted=[...state.keystoneScores].sort((a,b)=>new Date(b.date)-new Date(a.date));
  tbody.innerHTML=sorted.map(s=>{
    const key=KEYSTONE_KEYS[KEYSTONE_SUBJECTS.indexOf(s.subject)], prof=bm[key]?.prof??0;
    const met=s.score>=prof;
    return `<tr><td>${s.subject}</td><td>${fmtDate(s.date)}</td><td>${s.score}</td>
      <td class="col-center"><span class="subject-badge ${s.level==='Advanced'?'badge-met':s.level==='Proficient'?'badge-met':'badge-none'}">${s.level||'—'}</span></td>
      <td class="col-center"><span class="subject-badge ${met?'badge-met':'badge-none'}">${met?'✓ Proficient':'Below'}</span></td>
      <td><button class="btn-icon delete" onclick="deletePathwayEntry('keystoneScores','${s.id}')">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button></td></tr>`;
  }).join('');
}

function renderStandardized() {
  const sat=satStatus(), act=actStatus(), psat=psatStatus(), bm=state.benchmarks;
  renderTestSections('sat-subjects','sat-badge',sat.met,sat.status,
    SAT_SECTIONS.map(sec=>({label:sec,best:sat.sections[sec],benchmark:bm.sat[sec.toLowerCase()],met:sec==='EBRW'?sat.ebrwMet:sat.mathMet})));
  const actMap={English:'english',Math:'math',Reading:'reading',Science:'science'};
  renderTestSections('act-subjects','act-badge',act.met,act.status,
    ACT_SECTIONS.map(sec=>({label:sec,best:act.best[sec],benchmark:bm.act[actMap[sec]],met:act.sectionMet[sec]})));
  renderTestSections('psat-subjects','psat-badge',psat.met,psat.status,
    PSAT_SECTIONS.map(sec=>({label:sec,best:psat.best[sec],benchmark:bm.psat[sec.toLowerCase()],met:sec==='EBRW'?psat.ebrwMet:psat.mathMet})));

  const tbody=document.getElementById('standardized-log-tbody');
  if(!state.standardizedScores.length) { tbody.innerHTML='<tr class="empty-row"><td colspan="7">No scores logged yet.</td></tr>'; return; }
  const sorted=[...state.standardizedScores].sort((a,b)=>new Date(b.date)-new Date(a.date));
  tbody.innerHTML=sorted.map(s=>{
    const bmVal=getBenchmarkForScore(s.test,s.section);
    const met=bmVal!==null&&s.score>=bmVal;
    return `<tr><td>${s.test}</td><td>${fmtDate(s.date)}</td><td>${s.section}</td>
      <td class="col-center">${s.score}</td>
      <td class="col-center">${bmVal!==null?'≥ '+bmVal:'—'}</td>
      <td class="col-center"><span class="subject-badge ${met?'badge-met':'badge-none'}">${met?'✓ Met':'Below'}</span></td>
      <td><button class="btn-icon delete" onclick="deletePathwayEntry('standardizedScores','${s.id}')">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button></td></tr>`;
  }).join('');
}

function renderTestSections(containerId,badgeId,met,status,sections) {
  const badge=document.getElementById(badgeId);
  badge.textContent=met?'✓ Pathway Met':status==='partial'?'◷ Partial':'○ Not Met';
  badge.className='subject-badge '+(met?'badge-met':status==='partial'?'badge-partial':'badge-none');
  document.getElementById(containerId).innerHTML=sections.map(s=>{
    const pct=s.best?Math.min(100,(s.best/(s.benchmark*1.2))*100):0;
    const label=s.met?`✓ ${s.best}`:s.best?`Best: ${s.best}`:'Not Taken';
    return `<div class="subject-row">
      <div class="subject-name">${s.label}</div>
      <div><div class="prog-wrap"><div class="prog-bar ${s.met?'green':''}" style="width:${pct}%"></div></div></div>
      <div class="subject-score-info">Benchmark: ≥ ${s.benchmark}</div>
      <div><span class="subject-badge ${s.met?'badge-met':s.best?'badge-partial':'badge-none'}">${label}</span></div>
    </div>`;
  }).join('');
}

function getBenchmarkForScore(test,section) {
  const bm=state.benchmarks;
  if(test==='SAT')  { if(section==='EBRW') return bm.sat.ebrw; if(section==='Math') return bm.sat.math; }
  if(test==='ACT')  { const m={English:'english',Math:'math',Reading:'reading',Science:'science'}; return bm.act[m[section]]??null; }
  if(test==='PSAT') { if(section==='EBRW') return bm.psat.ebrw; if(section==='Math') return bm.psat.math; }
  return null;
}

function renderAdvanced() {
  const s=advancedStatus();
  const badge=document.getElementById('advanced-badge');
  badge.textContent=s.met?'✓ Pathway Met':state.advancedCourses.length?'◷ Entries logged':'○ Not Met';
  badge.className='subject-badge '+(s.met?'badge-met':state.advancedCourses.length?'badge-partial':'badge-none');
  const thresh={AP:'≥ 3',IB:'≥ 4','Dual Enrollment':'Grade C+','CTE Concentration':'Completed','SAT Subject Test':'≥ 630'};
  const tbody=document.getElementById('advanced-log-tbody');
  if(!state.advancedCourses.length) { tbody.innerHTML='<tr class="empty-row"><td colspan="7">No entries logged yet.</td></tr>'; return; }
  tbody.innerHTML=state.advancedCourses.map(c=>{
    const qualifies=s.qualifying.some(q=>q.id===c.id);
    return `<tr><td>${esc(c.name)}</td><td>${esc(c.type)}</td><td>${esc(c.term||'—')}</td>
      <td class="col-center">${esc(c.scoreRaw||'—')}</td>
      <td class="col-center">${thresh[c.type]||'—'}</td>
      <td class="col-center"><span class="subject-badge ${qualifies?'badge-met':'badge-none'}">${qualifies?'✓ Qualifies':'Not Yet'}</span></td>
      <td><button class="btn-icon delete" onclick="deletePathwayEntry('advancedCourses','${c.id}')">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button></td></tr>`;
  }).join('');
}

function renderCareer() {
  const s=careerStatus();
  document.getElementById('career-activity-blocks').innerHTML=CAREER_TYPES.map(t=>{
    const items=state.careerActivities.filter(a=>a.type===t.key);
    const ts=s.typeStatus[t.key];
    const statusCls=ts.met?'badge-met':items.length?'badge-partial':'badge-none';
    const statusLbl=ts.met?'✓ Met':items.length?'◷ In Progress':'○ Not Started';
    let progressHtml='';
    if(t.unit==='hours') {
      const pct=Math.min(100,(ts.hours/t.threshold)*100);
      progressHtml=`<div style="padding:10px 14px;border-bottom:1px solid var(--gray-100)">
        <div style="display:flex;align-items:center;gap:10px;font-size:.8rem;color:var(--gray-600)">
          <span style="white-space:nowrap">${ts.hours} / ${t.threshold} hrs</span>
          <div class="prog-wrap" style="flex:1;height:7px"><div class="prog-bar ${ts.met?'green':'gold'}" style="width:${pct}%"></div></div>
        </div></div>`;
    }
    const itemsHtml=items.length
      ?items.map(a=>`<div class="activity-item">
          <div class="activity-item-name">${esc(a.name)}</div>
          <div class="activity-item-meta">${a.date?fmtDate(a.date):''}${a.hours?' · '+a.hours+' hrs':''}</div>
          <span class="subject-badge ${a.completed?'badge-met':'badge-partial'}">${a.completed?'✓ Done':'In Progress'}</span>
          <button class="btn-icon delete" onclick="deletePathwayEntry('careerActivities','${a.id}')">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>`).join('')
      :`<div style="padding:14px;font-size:.83rem;color:var(--gray-400);font-style:italic">No entries yet — click Log Activity to add one.</div>`;
    return `<div class="activity-type-block">
      <div class="activity-type-header">
        <div class="activity-type-title"><i class="fa-solid ${t.icon}"></i> ${t.label}
          ${t.unit==='hours'?`<span style="font-size:.73rem;color:var(--gray-600);font-weight:400">(${t.threshold} hrs required)</span>`:''}
        </div>
        <span class="subject-badge ${statusCls}">${statusLbl}</span>
      </div>
      <div class="activity-type-body">${progressHtml}${itemsHtml}</div>
    </div>`;
  }).join('');
}

function renderProjection() {
  const s=allPathwayStatuses(), eligible=isEligible(s);
  const pathways=[
    {key:'keystones',    label:'Keystone Exams',      page:'pathways-keystones'},
    {key:'standardized', label:'SAT / ACT / PSAT',    page:'pathways-standardized'},
    {key:'advanced',     label:'Advanced Coursework', page:'pathways-advanced'},
    {key:'career',       label:'Career & Military',   page:'pathways-career'}
  ];
  document.getElementById('proj-checklist').innerHTML=pathways.map(p=>{
    const status=s[p.key].status;
    const cls=status==='met'?'done':status==='partial'?'active':'todo';
    const icon=status==='met'?'fa-circle-check':status==='partial'?'fa-hourglass-half':'fa-circle';
    return `<div class="proj-step ${cls}" onclick="navigateTo('${p.page}')" style="cursor:pointer">
      <i class="fa-solid ${icon}"></i><span>${p.label}</span></div>`;
  }).join('');

  const steps=buildNextSteps(s, eligible);
  document.getElementById('proj-next-steps').innerHTML=steps.length
    ?steps.map(step=>`<div class="next-step-item ${step.priority?'priority':''}">
        <i class="fa-solid ${step.icon}"></i>
        <div><strong>${step.label}</strong><br><span class="text-muted">${step.detail}</span></div>
      </div>`).join('')
    :`<div class="next-step-item"><i class="fa-solid fa-star"></i>
        <div><strong>All set!</strong><br><span class="text-muted">You have met at least one pathway. Graduation requirement satisfied.</span></div>
      </div>`;

  const tl=document.getElementById('proj-timeline');
  if(!state.plannedEvents.length) {
    tl.innerHTML='<p class="text-muted" style="padding:8px 0">No planned events yet. Add upcoming test dates or activities.</p>';
  } else {
    const sorted=[...state.plannedEvents].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const now=new Date();
    tl.innerHTML=sorted.map(ev=>{
      const evDate=new Date(ev.date);
      const past=evDate<now, soon=!past&&(evDate-now)<30*24*60*60*1000;
      const dotCls=past?'tl-past':soon?'tl-soon':'tl-future';
      return `<div class="timeline-item">
        <div class="timeline-date">${fmtDate(ev.date)}</div>
        <div class="timeline-dot ${dotCls}"></div>
        <div><strong>${esc(ev.label)}</strong>${ev.projectedScore?`<span class="text-muted"> — Projected: ${esc(ev.projectedScore)}</span>`:''}
          <button class="btn-icon delete" style="display:inline;margin-left:6px" onclick="deletePathwayEntry('plannedEvents','${ev.id}')">
            <svg viewBox="0 0 24 24" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');
  }

  const scenario=document.getElementById('proj-scenario');
  if(!state.plannedEvents.length) scenario.innerHTML='<p class="text-muted">Add planned events above to see projected eligibility scenarios.</p>';
  else if(eligible) scenario.innerHTML='<p style="color:var(--green);font-weight:700"><i class="fa-solid fa-circle-check"></i> Already eligible — no additional events needed.</p>';
  else scenario.innerHTML=`<p style="font-size:.87rem;color:var(--gray-600);line-height:1.6">
    <i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i>
    You have <strong>${state.plannedEvents.length}</strong> planned event(s). If projected scores meet benchmarks, eligibility may be achieved after those dates.</p>`;
}

function buildNextSteps(s, eligible) {
  if(eligible) return [];
  const steps=[];
  const ks=s.keystones;
  if(!ks.allMet) {
    const missing=KEYSTONE_SUBJECTS.filter((_,i)=>!ks.subjects[KEYSTONE_KEYS[i]].met);
    steps.push({icon:'fa-pencil',label:'Keystone Exams',detail:`${missing.join(', ')} not yet Proficient`,priority:true});
  }
  const std=s.standardized;
  if(!std.met) {
    if(!std.sat.met) {
      const gaps=[];
      if(!std.sat.ebrwMet) gaps.push(`EBRW (need ≥${state.benchmarks.sat.ebrw})`);
      if(!std.sat.mathMet) gaps.push(`Math (need ≥${state.benchmarks.sat.math})`);
      if(gaps.length) steps.push({icon:'fa-chart-bar',label:'SAT',detail:gaps.join(' · '),priority:gaps.length<2});
    }
    if(!std.act.met) {
      const gaps=ACT_SECTIONS.filter(sec=>!std.act.sectionMet[sec]);
      if(gaps.length<4) steps.push({icon:'fa-chart-bar',label:'ACT',detail:gaps.join(', ')+' section(s) below benchmark',priority:gaps.length<=2});
    }
  }
  if(!s.advanced.met) steps.push({icon:'fa-graduation-cap',label:'Advanced Coursework',detail:'Log an AP (≥3), IB (≥4), dual enrollment (C+), or CTE completion',priority:false});
  if(!s.career.met) {
    CAREER_TYPES.forEach(t=>{
      const ts=s.career.typeStatus[t.key];
      if(!ts.met&&t.unit==='hours'&&ts.hours>0) steps.push({icon:t.icon,label:t.label,detail:`${ts.hours}/${t.threshold} hrs — ${t.threshold-ts.hours} more needed`,priority:ts.hours/t.threshold>0.5});
    });
    if(!steps.some(st=>CAREER_TYPES.some(t=>st.label===t.label)))
      steps.push({icon:'fa-briefcase',label:'Career & Military Readiness',detail:'Internship, credential, volunteering, or military enlistment',priority:false});
  }
  return steps.sort((a,b)=>(b.priority?1:0)-(a.priority?1:0)).slice(0,6);
}

// ── Pathway modal ─────────────────────────────────────────────
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
      <div class="form-group"><label>Score</label><input type="number" id="m-score" placeholder="e.g. 750" /></div>
      <div class="form-group" style="margin-top:8px;padding:10px 13px;background:var(--gray-100);border-radius:var(--radius-sm);font-size:.83rem;color:var(--gray-600)">
        <i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i>
        Performance level (Basic / Proficient / Advanced) is calculated automatically from your score and the configured benchmarks.
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveKeystoneScore()">Save Score</button>
      </div>`;
  }

  else if(type==='standardized') {
    title.textContent='Log Standardized Test Score';
    body.innerHTML=`
      <div class="form-row">
        <div class="form-group"><label>Test</label>
          <select id="m-test" onchange="updateSectionOpts()"><option>SAT</option><option>ACT</option><option>PSAT</option></select>
        </div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${today()}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Section</label><select id="m-section"></select></div>
        <div class="form-group"><label>Score</label><input type="number" id="m-score" placeholder="Score" /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveStandardizedScore()">Save Score</button>
      </div>`;
    updateSectionOpts();
  }

  else if(type==='advanced') {
    title.textContent='Log Advanced Coursework';
    const typeOpts=ADVANCED_TYPES.map(t=>`<option>${t}</option>`).join('');
    body.innerHTML=`
      <div class="form-group"><label>Course / Program Name</label><input type="text" id="m-name" placeholder="e.g. AP Calculus AB" /></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="m-type">${typeOpts}</select></div>
        <div class="form-group"><label>Term / Year</label><input type="text" id="m-term" placeholder='e.g. Spring 2024' /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Score / Grade</label><input type="text" id="m-score" placeholder='e.g. 4 or "B+"' /></div>
        <div class="form-group"><label>Notes (optional)</label><input type="text" id="m-notes" /></div>
      </div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" id="m-completed" /> Mark as completed (for CTE)
      </label></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveAdvancedEntry()">Save Entry</button>
      </div>`;
  }

  else if(type==='career') {
    title.textContent='Log Career & Military Activity';
    const typeOpts=CAREER_TYPES.map(t=>`<option value="${t.key}">${t.label}</option>`).join('');
    body.innerHTML=`
      <div class="form-row">
        <div class="form-group"><label>Activity Type</label><select id="m-type">${typeOpts}</select></div>
        <div class="form-group"><label>Date</label><input type="date" id="m-date" value="${today()}" /></div>
      </div>
      <div class="form-group"><label>Name / Description</label><input type="text" id="m-name" placeholder="e.g. ABC Company Internship" /></div>
      <div class="form-row">
        <div class="form-group"><label>Hours Logged</label><input type="number" id="m-hours" placeholder="0" min="0" /></div>
        <div class="form-group"><label>Notes (optional)</label><input type="text" id="m-notes" /></div>
      </div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
        <input type="checkbox" id="m-completed" /> Mark as completed / earned
      </label></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveCareerActivity()">Save Activity</button>
      </div>`;
  }

  else if(type==='plan-event') {
    title.textContent='Add Planned Event';
    body.innerHTML=`
      <div class="form-group"><label>Event Label</label><input type="text" id="m-label" placeholder='e.g. "SAT Retake" or "AP Exam — Calculus"' /></div>
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="m-date" /></div>
        <div class="form-group"><label>Projected Score / Result (optional)</label><input type="text" id="m-proj" placeholder='e.g. "550 Math"' /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="savePlannedEvent()">Add Event</button>
      </div>`;
  }

  openModal();
}

function updateSectionOpts() {
  const test=document.getElementById('m-test')?.value;
  const secEl=document.getElementById('m-section');
  if(!secEl) return;
  const opts=test==='SAT'?SAT_SECTIONS:test==='ACT'?ACT_SECTIONS:PSAT_SECTIONS;
  secEl.innerHTML=opts.map(s=>`<option>${s}</option>`).join('');
}

function saveKeystoneScore() {
  const subj=document.getElementById('m-subj')?.value;
  const date=document.getElementById('m-date')?.value;
  const score=Number(document.getElementById('m-score')?.value);
  if(!subj||!date||isNaN(score)||score<=0) { toast('Please fill all fields.','error'); return; }
  const level=calcKeystoneLevel(subj, score);
  state.keystoneScores.push({id:uid(),subject:subj,date,score,level});
  saveData(); closeModal(); renderKeystones(); renderPathwayOverview(); updatePathwayNavDots();
  toast(`Keystone score logged — ${level}.`,'success');
}

function saveStandardizedScore() {
  const test=document.getElementById('m-test')?.value;
  const date=document.getElementById('m-date')?.value;
  const section=document.getElementById('m-section')?.value;
  const score=Number(document.getElementById('m-score')?.value);
  if(!test||!date||!section||isNaN(score)||score<=0) { toast('Please fill all fields.','error'); return; }
  state.standardizedScores.push({id:uid(),test,date,section,score});
  saveData(); closeModal(); renderStandardized(); renderPathwayOverview(); updatePathwayNavDots();
  toast(`${test} score logged.`,'success');
}

function saveAdvancedEntry() {
  const name=document.getElementById('m-name')?.value.trim();
  if(!name) { toast('Please enter a course/program name.','error'); return; }
  state.advancedCourses.push({id:uid(),name,type:document.getElementById('m-type')?.value,
    term:document.getElementById('m-term')?.value.trim(),scoreRaw:document.getElementById('m-score')?.value.trim(),
    notes:document.getElementById('m-notes')?.value.trim(),completed:document.getElementById('m-completed')?.checked});
  saveData(); closeModal(); renderAdvanced(); renderPathwayOverview(); updatePathwayNavDots();
  toast('Advanced coursework entry saved.','success');
}

function saveCareerActivity() {
  const name=document.getElementById('m-name')?.value.trim();
  if(!name) { toast('Please enter a name or description.','error'); return; }
  state.careerActivities.push({id:uid(),type:document.getElementById('m-type')?.value,
    date:document.getElementById('m-date')?.value,name,hours:Number(document.getElementById('m-hours')?.value)||0,
    notes:document.getElementById('m-notes')?.value.trim(),completed:document.getElementById('m-completed')?.checked});
  saveData(); closeModal(); renderCareer(); renderPathwayOverview(); updatePathwayNavDots();
  toast('Activity logged.','success');
}

function savePlannedEvent() {
  const label=document.getElementById('m-label')?.value.trim();
  const date=document.getElementById('m-date')?.value;
  if(!label||!date) { toast('Please enter a label and date.','error'); return; }
  state.plannedEvents.push({id:uid(),label,date,projectedScore:document.getElementById('m-proj')?.value.trim()});
  saveData(); closeModal(); renderProjection();
  toast('Planned event added.','success');
}

function deletePathwayEntry(listKey, id) {
  if(!confirm('Remove this entry?')) return;
  state[listKey]=state[listKey].filter(x=>x.id!==id);
  saveData(); renderAll();
  toast('Entry removed.');
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════
function setupSettingsListeners() {
  document.getElementById('btn-save-student').addEventListener('click', () => {
    state.student.name    = document.getElementById('student-name').value.trim();
    state.student.gradYear = document.getElementById('grad-year').value.trim();
    state.student.school  = document.getElementById('student-school').value.trim();
    saveData(); renderDashboard();
    document.getElementById('new-year-school').value = state.student.school;
    toast('Student info saved.','success');
  });
  document.getElementById('btn-add-year').addEventListener('click', addYear);
  document.getElementById('new-year-name').addEventListener('keydown', e=>{ if(e.key==='Enter') addYear(); });
  document.getElementById('btn-add-req').addEventListener('click', addRequirement);
  document.getElementById('new-req-name').addEventListener('keydown', e=>{ if(e.key==='Enter') addRequirement(); });
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('import-file').addEventListener('change', importData);
  document.getElementById('btn-clear').addEventListener('click', clearData);
}

function renderSettingsStudent() {
  document.getElementById('student-name').value   = state.student.name    || '';
  document.getElementById('grad-year').value      = state.student.gradYear || '';
  document.getElementById('student-school').value = state.student.school  || '';

  const nySchool=document.getElementById('new-year-school');
  if(!nySchool.value && state.student.school) nySchool.value=state.student.school;

  document.getElementById('years-list').innerHTML = state.years.length
    ?state.years.map(y=>`
      <div class="list-item">
        <div class="list-item-name-group">
          <span class="list-item-name">${esc(y.name)}</span>
          ${y.school?`<span class="list-item-school">${esc(y.school)}</span>`:''}
        </div>
        <div class="list-item-actions">
          <button class="btn-icon" onclick="openEditYearModal('${y.id}')" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete" onclick="deleteYear('${y.id}')" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`).join('')
    :'<p class="text-muted" style="font-size:.85rem;padding:6px 0">No years added yet.</p>';
}

function renderSettingsRequirements() {
  document.getElementById('reqs-list').innerHTML = state.requirements.length
    ?state.requirements.map(r=>{
        const subList=(r.subReqs||[]).map(sr=>{
          const status=subReqStatus(r,sr), cr=Number(sr.credits)>0?`${fmt(sr.credits)} cr`:'0 cr';
          const dot=status==='earned'?'<span class="sr-dot sr-dot-earned">✓</span>'
                   :status==='planned'?'<span class="sr-dot sr-dot-planned">◷</span>'
                   :'<span class="sr-dot sr-dot-none">○</span>';
          return `<div class="subreq-item">${dot}
            <span class="subreq-item-name">${esc(sr.name)}</span>
            <span class="subreq-item-credits">${cr}</span>
            <div class="subreq-item-actions">
              <button class="btn-icon" onclick="openEditSubReqModal('${r.id}','${sr.id}')">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon delete" onclick="deleteSubReq('${r.id}','${sr.id}')">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </div>`;
        }).join('');
        return `<div class="req-list-block" id="req-block-${r.id}">
          <div class="list-item req-list-item">
            <span class="list-item-name">${esc(r.name)}</span>
            <span class="list-item-credits">${fmt(r.credits)} cr</span>
            <div class="list-item-actions">
              <button class="btn-icon" onclick="openEditReqModal('${r.id}')">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon" onclick="toggleSubReqForm('${r.id}')">
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button class="btn-icon delete" onclick="deleteReq('${r.id}')">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </div>
          ${subList?`<div class="subreq-list">${subList}</div>`:''}
          <div class="subreq-add-form hidden" id="subreq-form-${r.id}">
            <input type="text" id="subreq-name-${r.id}" placeholder='Name (e.g. "Algebra I Required")' />
            <input type="number" id="subreq-credits-${r.id}" placeholder="Credits" min="0" step="0.5" class="input-credits-sm" />
            <button class="btn btn-secondary btn-sm" onclick="addSubReq('${r.id}')">Add</button>
            <button class="btn btn-outline btn-sm" onclick="toggleSubReqForm('${r.id}')">Cancel</button>
          </div>
        </div>`;
      }).join('')
    :'<p class="text-muted" style="font-size:.85rem;padding:6px 0">No requirements added yet.</p>';
  document.getElementById('total-req-credits').textContent=fmt(totalRequired());
}

// Benchmarks
function renderBenchmarkInputs() {
  const bm=state.benchmarks;
  const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.value=val; };
  set('bm-alg-prof',bm.keystone.algebra.prof);    set('bm-alg-adv',bm.keystone.algebra.adv);
  set('bm-lit-prof',bm.keystone.literature.prof); set('bm-lit-adv',bm.keystone.literature.adv);
  set('bm-bio-prof',bm.keystone.biology.prof);    set('bm-bio-adv',bm.keystone.biology.adv);
  set('bm-sat-ebrw',bm.sat.ebrw);                 set('bm-sat-math',bm.sat.math);
  set('bm-act-english',bm.act.english);            set('bm-act-math',bm.act.math);
  set('bm-act-reading',bm.act.reading);            set('bm-act-science',bm.act.science);
  set('bm-psat-ebrw',bm.psat.ebrw);               set('bm-psat-math',bm.psat.math);
}

function saveBenchmarks() {
  const g=id=>Number(document.getElementById(id)?.value)||0;
  state.benchmarks={
    keystone:{
      algebra:    {prof:g('bm-alg-prof'),adv:g('bm-alg-adv')},
      literature: {prof:g('bm-lit-prof'),adv:g('bm-lit-adv')},
      biology:    {prof:g('bm-bio-prof'),adv:g('bm-bio-adv')}
    },
    sat:  {ebrw:g('bm-sat-ebrw'),math:g('bm-sat-math')},
    act:  {english:g('bm-act-english'),math:g('bm-act-math'),reading:g('bm-act-reading'),science:g('bm-act-science')},
    psat: {ebrw:g('bm-psat-ebrw'),math:g('bm-psat-math')}
  };
  saveData(); renderAll(); toast('Benchmarks saved.','success');
}

function resetBenchmarks() {
  if(!confirm('Reset all benchmarks to PA defaults?')) return;
  state.benchmarks=JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
  saveData(); renderBenchmarkInputs(); renderAll(); toast('Benchmarks reset to PA defaults.','success');
}

// ── Year / Req CRUD ───────────────────────────────────────────
function openEditYearModal(yearId) {
  const y=state.years.find(x=>x.id===yearId); if(!y) return;
  document.getElementById('modal-title').textContent='Edit School Year';
  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>Year / Grade Label *</label><input type="text" id="edit-year-name" value="${esc(y.name)}" /></div>
    <div class="form-group" style="margin-top:12px"><label>School Name</label><input type="text" id="edit-year-school" value="${esc(y.school||'')}" /></div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save-year">Save Changes</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save-year').addEventListener('click', ()=>{
    const name=document.getElementById('edit-year-name').value.trim();
    if(!name) { toast('Please enter a year label.','error'); return; }
    y.name=name; y.school=document.getElementById('edit-year-school').value.trim();
    saveData(); closeModal(); renderAll(); toast('Year updated.','success');
  });
  openModal(); document.getElementById('edit-year-name').focus();
}

function openEditReqModal(reqId) {
  const req=state.requirements.find(r=>r.id===reqId); if(!req) return;
  document.getElementById('modal-title').textContent='Edit Requirement';
  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>Requirement Name *</label><input type="text" id="edit-req-name" value="${esc(req.name)}" /></div>
    <div class="form-group" style="margin-top:12px"><label>Total Credits Required *</label><input type="number" id="edit-req-credits" value="${req.credits}" min="0" step="0.5" /></div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save-req">Save Changes</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save-req').addEventListener('click', ()=>{
    const name=document.getElementById('edit-req-name').value.trim();
    const credits=parseFloat(document.getElementById('edit-req-credits').value);
    if(!name) { toast('Please enter a name.','error'); return; }
    if(isNaN(credits)||credits<0) { toast('Please enter a valid credit amount.','error'); return; }
    req.name=name; req.credits=credits;
    saveData(); closeModal(); renderAll(); toast('Requirement updated.','success');
  });
  openModal(); document.getElementById('edit-req-name').focus();
}

function openEditSubReqModal(reqId, subId) {
  const req=state.requirements.find(r=>r.id===reqId);
  const sr=req?.subReqs?.find(s=>s.id===subId);
  if(!req||!sr) return;
  document.getElementById('modal-title').textContent='Edit Sub-Requirement';
  document.getElementById('modal-body').innerHTML=`
    <div class="form-group"><label>Sub-Requirement Name *</label><input type="text" id="edit-sub-name" value="${esc(sr.name)}" /></div>
    <p style="font-size:.78rem;color:var(--gray-600);margin:6px 0 10px"><i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i> This name is matched against course names to detect automatic completion.</p>
    <div class="form-group"><label>Credits (0 if informational)</label><input type="number" id="edit-sub-credits" value="${sr.credits||0}" min="0" step="0.5" /></div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save-sub">Save Changes</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save-sub').addEventListener('click', ()=>{
    const name=document.getElementById('edit-sub-name').value.trim();
    if(!name) { toast('Please enter a name.','error'); return; }
    sr.name=name; sr.credits=parseFloat(document.getElementById('edit-sub-credits').value)||0;
    saveData(); closeModal(); renderAll(); toast('Sub-requirement updated.','success');
  });
  openModal(); document.getElementById('edit-sub-name').focus();
}

function toggleSubReqForm(reqId) {
  const form=document.getElementById(`subreq-form-${reqId}`); if(!form) return;
  form.classList.toggle('hidden');
  if(!form.classList.contains('hidden')) document.getElementById(`subreq-name-${reqId}`)?.focus();
}

function addSubReq(reqId) {
  const name=document.getElementById(`subreq-name-${reqId}`)?.value.trim();
  const credits=parseFloat(document.getElementById(`subreq-credits-${reqId}`)?.value)||0;
  if(!name) { toast('Please enter a name.','error'); return; }
  const req=state.requirements.find(r=>r.id===reqId); if(!req) return;
  req.subReqs=req.subReqs||[];
  if(req.subReqs.find(sr=>sr.name.toLowerCase()===name.toLowerCase())) { toast('Sub-requirement already exists.','error'); return; }
  req.subReqs.push({id:uid(),name,credits});
  saveData(); renderAll(); toast('Sub-requirement added.','success');
}

function deleteSubReq(reqId, subId) {
  const req=state.requirements.find(r=>r.id===reqId); if(!req) return;
  req.subReqs=(req.subReqs||[]).filter(sr=>sr.id!==subId);
  state.courses.forEach(c=>{ if(c.reqId===reqId&&c.subReqId===subId) c.subReqId=''; });
  saveData(); renderAll(); toast('Sub-requirement removed.');
}

function addYear() {
  const name=document.getElementById('new-year-name').value.trim();
  const school=document.getElementById('new-year-school').value.trim()||state.student.school||'';
  if(!name) { toast('Please enter a year name.','error'); return; }
  if(state.years.find(y=>y.name.toLowerCase()===name.toLowerCase())) { toast('Year already exists.','error'); return; }
  state.years.push({id:uid(),name,school});
  document.getElementById('new-year-name').value='';
  saveData(); renderAll(); toast('Year added.','success');
}

function deleteYear(yearId) {
  if(state.courses.some(c=>c.yearId===yearId)) {
    if(!confirm('This year has courses. Deleting removes the year assignment. Continue?')) return;
    state.courses.forEach(c=>{ if(c.yearId===yearId) c.yearId=''; });
  }
  state.years=state.years.filter(y=>y.id!==yearId);
  saveData(); renderAll(); toast('Year removed.');
}

function addRequirement() {
  const name=document.getElementById('new-req-name').value.trim();
  const credits=parseFloat(document.getElementById('new-req-credits').value);
  if(!name) { toast('Please enter a requirement name.','error'); return; }
  if(isNaN(credits)||credits<=0) { toast('Please enter a valid credit amount.','error'); return; }
  if(state.requirements.find(r=>r.name.toLowerCase()===name.toLowerCase())) { toast('Requirement already exists.','error'); return; }
  state.requirements.push({id:uid(),name,credits,subReqs:[]});
  document.getElementById('new-req-name').value='';
  document.getElementById('new-req-credits').value='';
  saveData(); renderAll(); toast('Requirement added.','success');
}

function deleteReq(reqId) {
  if(state.courses.some(c=>c.reqId===reqId)) {
    if(!confirm('Some courses use this requirement. Removing it will unassign those courses. Continue?')) return;
    state.courses.forEach(c=>{ if(c.reqId===reqId){c.reqId='';c.subReqId='';} });
  }
  state.requirements=state.requirements.filter(r=>r.id!==reqId);
  saveData(); renderAll(); toast('Requirement removed.');
}

// ── Import / Export ───────────────────────────────────────────
function exportData() {
  const a=Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),
    download:`gradtracker-${today()}.json`
  });
  a.click(); toast('Data exported.','success');
}

function importData(e) {
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try {
      const parsed=JSON.parse(ev.target.result);
      if(!confirm('This will replace all current data. Continue?')) return;
      if(!parsed.benchmarks) parsed.benchmarks=JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS));
      if(!parsed.keystoneScores)     parsed.keystoneScores=[];
      if(!parsed.standardizedScores) parsed.standardizedScores=[];
      if(!parsed.advancedCourses)    parsed.advancedCourses=[];
      if(!parsed.careerActivities)   parsed.careerActivities=[];
      if(!parsed.plannedEvents)      parsed.plannedEvents=[];
      if(parsed.student&&!parsed.student.school) parsed.student.school='';
      if(parsed.years) parsed.years=parsed.years.map(y=>({school:'',...y}));
      if(parsed.requirements) parsed.requirements=parsed.requirements.map(r=>({...r,subReqs:(r.subReqs||[]).map(sr=>({credits:0,...sr}))}));
      Object.assign(state,parsed);
      saveData(); renderAll(); renderBenchmarkInputs(); toast('Data imported.','success');
    } catch { toast('Invalid file format.','error'); }
  };
  reader.readAsText(file); e.target.value='';
}

function clearData() {
  if(!confirm('This will permanently delete ALL data including pathways and benchmarks. Are you sure?')) return;
  state={
    student:{name:'',gradYear:'',school:''}, years:[], requirements:[], courses:[],
    benchmarks:JSON.parse(JSON.stringify(DEFAULT_BENCHMARKS)),
    keystoneScores:[], standardizedScores:[], advancedCourses:[], careerActivities:[], plannedEvents:[]
  };
  saveData(); renderAll(); renderBenchmarkInputs(); toast('All data cleared.');
}

// ── Modal ──────────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow='';
}
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e=>{ if(e.target===document.getElementById('modal-overlay')) closeModal(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

// ── Toast ──────────────────────────────────────────────────────
let _toastTimer;
function toast(msg,type='') {
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='toast'+(type?' '+type:'');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>{ el.classList.add('toast-fade'); setTimeout(()=>el.classList.add('hidden'),300); },2500);
}

function registerSW() {
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}
