/* ============================================================
   GradTracker v1.4.0 — Application Logic
   Changes from v1.3.0:
   [1]  Desktop-only: mobile gate screen shown on narrow viewports
   [2]  Status column is a dropdown; planned→earned opens grade modal
   [3]  Sub-requirement name-match completion tracking in all views
   [4]  Student info: Current School field; School Years: school name
        auto-populated from student school, editable per year
   [5]  "Tracker" portion of logo text rendered in gold
   ============================================================ */

'use strict';

// ── Storage ───────────────────────────────────────────────────
const STORAGE_KEY = 'gradtracker_data_v1';
function loadData() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ── State ─────────────────────────────────────────────────────
let state = {
  student: { name: '', gradYear: '', school: '' },
  years: [],          // [{id, name, school}]
  requirements: [],   // [{id, name, credits, subReqs:[{id,name,credits}]}]
  courses: []         // [{id, name, yearId, credits, grade, type, reqId, subReqId, planned}]
};

// ── Constants ─────────────────────────────────────────────────
const GRADES       = ['A','B','C','D','F','P','NP','W','I','AU'];
const COURSE_TYPES = ['Standard','VC','BC','AC'];

// ── Globals declared before init() to avoid TDZ ───────────────
let courseReqFilter = '';
let _dotsReqId      = null;

// ═════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════
(function init() {
  // (#1) Mobile gate — show gate and hide app on narrow screens
  checkMobileGate();
  window.addEventListener('resize', checkMobileGate);

  const saved = loadData();
  if (saved) {
    // Migrate: ensure school field exists
    if (saved.student && !saved.student.school) saved.student.school = '';
    if (saved.years) saved.years = saved.years.map(y => ({ school: '', ...y }));
    if (saved.requirements) {
      saved.requirements = saved.requirements.map(r => ({
        ...r, subReqs: (r.subReqs || []).map(sr => ({ credits: 0, ...sr }))
      }));
    }
    Object.assign(state, saved);
  }

  setupNavigation();
  setupSettings();
  setupCourses();
  renderAll();
  registerSW();

  if (!state.student.name && state.courses.length === 0) showOnboarding();
})();

// ── (#1) Mobile gate ──────────────────────────────────────────
function checkMobileGate() {
  const gate    = document.getElementById('mobile-gate');
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main-content');
  const isMobile = window.innerWidth < 900;
  gate.style.display    = isMobile ? 'flex' : 'none';
  sidebar.style.display = isMobile ? 'none'  : '';
  main.style.display    = isMobile ? 'none'  : '';
}

// ═════════════════════════════════════════════════════════════
// NAVIGATION
// ═════════════════════════════════════════════════════════════
function setupNavigation() {
  document.querySelectorAll('.nav-link, .inline-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      if (page) navigateTo(page);
    });
  });
}

function navigateTo(page, extraData) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelector(`.nav-link[data-page="${page}"]`)?.classList.add('active');

  if (page === 'courses' && extraData?.reqId !== undefined) courseReqFilter = extraData.reqId;

  if (page === 'dashboard') renderDashboard();
  if (page === 'courses')   renderCourses();
  if (page === 'stats')     renderStats();
  if (page === 'settings')  renderSettings();
}

function renderAll() {
  renderDashboard(); renderCourses(); renderStats(); renderSettings();
}

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function getYear(id)    { return state.years.find(y => y.id === id); }
function getYearName(id){ return getYear(id)?.name || '—'; }
function getReq(id)     { return state.requirements.find(r => r.id === id); }
function getReqName(id) { return getReq(id)?.name || 'Uncategorized'; }

function creditsEarnedForReq(reqId) {
  return state.courses.filter(c => c.reqId === reqId && !c.planned)
    .reduce((s,c) => s + Number(c.credits||0), 0);
}
function creditsPlannedForReq(reqId) {
  return state.courses.filter(c => c.reqId === reqId && c.planned)
    .reduce((s,c) => s + Number(c.credits||0), 0);
}
function totalEarned()   { return state.courses.filter(c=>!c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalPlanned()  { return state.courses.filter(c=> c.planned).reduce((s,c)=>s+Number(c.credits||0),0); }
function totalRequired() { return state.requirements.reduce((s,r)=>s+Number(r.credits||0),0); }

function creditsByYear() {
  const map = {};
  state.years.forEach(y => { map[y.id] = {earned:0, planned:0}; });
  state.courses.forEach(c => {
    if (!c.yearId) return;
    if (!map[c.yearId]) map[c.yearId] = {earned:0, planned:0};
    c.planned ? map[c.yearId].planned += Number(c.credits||0)
              : map[c.yearId].earned  += Number(c.credits||0);
  });
  return map;
}

function fmt(n) {
  const v = Number(n);
  if (isNaN(v)) return '0';
  return parseFloat(v.toFixed(2)).toString();
}

// ── (#3) Sub-requirement completion detection ─────────────────
// Rule: a sub-req is "satisfied" when at least one course has
//   • c.reqId === req.id  (same parent requirement)
//   • c.name (case-insensitive trimmed) === sr.name (case-insensitive trimmed)
// Returns 'earned' | 'planned' | null
function subReqStatus(req, sr) {
  const srName = sr.name.trim().toLowerCase();
  const matches = state.courses.filter(c =>
    c.reqId === req.id &&
    c.name.trim().toLowerCase() === srName
  );
  if (matches.some(c => !c.planned)) return 'earned';
  if (matches.some(c =>  c.planned)) return 'planned';
  return null;
}

// ═════════════════════════════════════════════════════════════
// ONBOARDING
// ═════════════════════════════════════════════════════════════
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
  // Pre-fill the year school field with current school
  document.getElementById('new-year-school').value = school;
  hideOnboarding();
  navigateTo('settings');
  renderDashboard();
  toast(`Welcome, ${name || 'there'}! Now add your graduation requirements.`, 'success');
});

document.getElementById('ob-skip').addEventListener('click', hideOnboarding);

// ═════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════
function renderDashboard() {
  const earned   = totalEarned();
  const planned  = totalPlanned();
  const required = totalRequired();
  const pctE = required > 0 ? Math.min(100, (earned / required) * 100) : 0;
  const pctP = required > 0 ? Math.min(100 - pctE, (planned / required) * 100) : 0;
  const pctWP = required > 0 ? Math.min(100, ((earned + planned) / required) * 100) : 0;

  // Greeting + school subtitle (#4)
  document.getElementById('dash-heading').textContent =
    state.student.name ? `Welcome, ${state.student.name}` : 'Dashboard';
  const sub = [];
  if (state.student.school)   sub.push(state.student.school);
  if (state.student.gradYear) sub.push(`Class of ${state.student.gradYear}`);
  document.getElementById('dash-subtitle').textContent =
    sub.length ? sub.join(' · ') : 'Your graduation progress at a glance';

  document.getElementById('dash-earned').textContent   = fmt(earned);
  document.getElementById('dash-required').textContent = fmt(required);
  document.getElementById('dash-pct').textContent      = fmt(pctE) + '%';
  document.getElementById('dash-progress-bar').style.width = pctE + '%';
  document.getElementById('dash-planned-bar').style.width  = pctP + '%';
  document.getElementById('dash-planned').textContent  = fmt(planned);
  document.getElementById('dash-planned-wrap').style.visibility = planned > 0 ? 'visible' : 'hidden';
  document.getElementById('legend-planned-item').style.display  = planned > 0 ? ''       : 'none';

  const pctWPEl = document.getElementById('dash-pct-with-planned');
  if (planned > 0 && required > 0) {
    pctWPEl.textContent = fmt(pctWP) + '% with planned';
    pctWPEl.style.display = 'block';
  } else {
    pctWPEl.style.display = 'none';
  }

  document.getElementById('no-requirements-notice')
    .classList.toggle('hidden', state.requirements.length > 0);

  // Requirements grid — with sub-req status chips (#3)
  const grid = document.getElementById('dash-req-grid');
  grid.innerHTML = '';
  state.requirements.forEach(req => {
    const e    = creditsEarnedForReq(req.id);
    const p    = creditsPlannedForReq(req.id);
    const pct  = req.credits > 0 ? Math.min(100, (e / req.credits) * 100) : 0;
    const pctP = req.credits > 0 ? Math.min(100 - pct, (p / req.credits) * 100) : 0;
    const complete = e >= req.credits && req.credits > 0;

    const subReqsHtml = (req.subReqs||[]).length ? `
      <div class="req-card-subreqs">
        ${req.subReqs.map(sr => {
          const status = subReqStatus(req, sr);
          const crStr  = Number(sr.credits) > 0 ? ` (${fmt(sr.credits)})` : '';
          const cls    = status === 'earned'  ? 'subreq-chip sr-met'
                       : status === 'planned' ? 'subreq-chip sr-planned'
                       : 'subreq-chip';
          const icon   = status === 'earned'  ? '✓ '
                       : status === 'planned' ? '◷ '
                       : '';
          return `<span class="${cls}">${icon}${esc(sr.name)}${crStr}</span>`;
        }).join('')}
      </div>` : '';

    grid.innerHTML += `
      <div class="req-card ${complete?'complete':''}" role="button" tabindex="0"
           onclick="openReqCourses('${req.id}')"
           onkeydown="if(event.key==='Enter')openReqCourses('${req.id}')">
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
    const {earned: e, planned: p} = byYear[y.id] || {earned:0, planned:0};
    const cnt   = state.courses.filter(co => co.yearId === y.id).length;
    const school = y.school ? `<div class="year-card-school">${esc(y.school)}</div>` : '';
    yearCards.innerHTML += `
      <div class="year-card">
        <div class="year-card-name">${esc(y.name)}</div>
        ${school}
        <div class="year-card-credits">${fmt(e)}</div>
        ${p > 0 ? `<div class="year-card-planned">+${fmt(p)} planned</div>` : ''}
        <div class="year-card-sub">${cnt} course${cnt!==1?'s':''}</div>
      </div>`;
  });
  if (state.years.length === 0 && state.requirements.length > 0) {
    yearCards.innerHTML = '<p class="text-muted" style="font-size:.85rem">No school years defined yet. Add years in Settings.</p>';
  }
}

function openReqCourses(reqId) {
  courseReqFilter = reqId;
  navigateTo('courses', { reqId });
}

// ═════════════════════════════════════════════════════════════
// COURSES
// ═════════════════════════════════════════════════════════════
function setupCourses() {
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
  state.years.forEach(y => {
    fyEl.innerHTML += `<option value="${y.id}" ${savedY===y.id?'selected':''}>${esc(y.name)}</option>`;
  });

  const pendingR = courseReqFilter || frEl.value;
  frEl.innerHTML = '<option value="">All Categories</option>';
  state.requirements.forEach(r => {
    frEl.innerHTML += `<option value="${r.id}" ${pendingR===r.id?'selected':''}>${esc(r.name)}</option>`;
  });
  if (courseReqFilter) { frEl.value = courseReqFilter; courseReqFilter = ''; }

  let courses = state.courses.slice();
  if (fyEl.value) courses = courses.filter(c => c.yearId === fyEl.value);
  if (frEl.value) courses = courses.filter(c => c.reqId  === frEl.value);
  if (savedS === 'earned')  courses = courses.filter(c => !c.planned);
  if (savedS === 'planned') courses = courses.filter(c =>  c.planned);

  const tbody = document.getElementById('courses-tbody');
  if (!courses.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No courses match the current filters.</td></tr>';
    return;
  }

  const yo = state.years.reduce((m,y,i) => { m[y.id]=i; return m; }, {});
  courses.sort((a,b) => {
    if (!!a.planned !== !!b.planned) return a.planned ? 1 : -1;
    return (yo[a.yearId]??99) - (yo[b.yearId]??99);
  });

  tbody.innerHTML = courses.map(c => {
    const gClass = ['A','B','C','D','F','P'].includes(c.grade) ? c.grade : '';

    // (#2) Status dropdown instead of static badge
    const statusSelect = `
      <select class="status-select ${c.planned?'sel-planned':'sel-earned'}"
              onchange="handleStatusChange('${c.id}', this.value)"
              title="Change status">
        <option value="earned"  ${!c.planned?'selected':''}>✓ Earned</option>
        <option value="planned" ${ c.planned?'selected':''}>◷ Planned</option>
      </select>`;

    const typeBadge = c.type && c.type !== 'Standard'
      ? `<span class="type-badge type-${c.type}">${esc(c.type)}</span>`
      : (c.type === 'Standard' ? '<span class="type-badge type-std">Std</span>' : '—');

    // (#3) Category + sub-req with completion indicator
    const req = getReq(c.reqId);
    let catDisplay = esc(getReqName(c.reqId));
    if (c.subReqId && req) {
      const sub = req.subReqs?.find(sr => sr.id === c.subReqId);
      if (sub) catDisplay += `<br><span class="subreq-label">${esc(sub.name)}</span>`;
    }
    // Name-match sub-req indicator in course name column
    let srMatchHtml = '';
    if (req) {
      const matchedSr = req.subReqs?.find(sr =>
        sr.name.trim().toLowerCase() === c.name.trim().toLowerCase()
      );
      if (matchedSr) {
        const st = subReqStatus(req, matchedSr);
        if (st) {
          srMatchHtml = `<span class="sr-match-tag ${st==='earned'?'sr-match-earned':'sr-match-planned'}">
            ${st==='earned'?'✓':'◷'} Sub-req
          </span>`;
        }
      }
    }

    return `
    <tr class="${c.planned?'row-planned':''}">
      <td class="td-course-name">${esc(c.name)}${srMatchHtml}</td>
      <td class="td-year">${esc(getYearName(c.yearId))}</td>
      <td class="col-center"><strong>${fmt(c.credits)}</strong></td>
      <td class="col-center">${c.grade?`<span class="grade-badge ${gClass}">${esc(c.grade)}</span>`:'—'}</td>
      <td class="col-center">${typeBadge}</td>
      <td class="td-cat">${catDisplay}</td>
      <td class="col-center">${statusSelect}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" onclick="openCourseModal('${c.id}')" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete" onclick="deleteCourse('${c.id}')" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// (#2) Handle status dropdown change
function handleStatusChange(courseId, newStatus) {
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return;

  if (newStatus === 'earned' && course.planned) {
    // Planned → Earned: open grade modal
    openEarnedModal(courseId);
  } else if (newStatus === 'planned' && !course.planned) {
    // Earned → Planned: immediate flip
    course.planned = true;
    saveData(); renderAll();
    toast('Course marked as Planned.', 'success');
  }
}

// (#2) Modal shown when flipping planned → earned
function openEarnedModal(courseId) {
  const c = state.courses.find(x => x.id === courseId);
  if (!c) return;

  const gradeOpts = GRADES.map(g =>
    `<option value="${g}" ${c.grade===g?'selected':''}>${g}</option>`
  ).join('');

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
      <select id="em-grade">
        <option value="">— Select grade —</option>
        ${gradeOpts}
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="em-save">Save as Earned</button>
    </div>`;

  document.getElementById('modal-cancel').addEventListener('click', () => {
    closeModal();
    // Reset dropdown visually
    renderCourses();
  });
  document.getElementById('em-save').addEventListener('click', () => {
    const grade = document.getElementById('em-grade').value;
    c.planned = false;
    c.grade   = grade || c.grade;
    saveData(); closeModal(); renderAll();
    toast('Course marked as Earned!', 'success');
  });

  openModal();
}

function openCourseModal(courseId) {
  const c = courseId ? state.courses.find(x => x.id === courseId) : null;
  document.getElementById('modal-title').textContent = c ? 'Edit Course' : 'Add Course';

  const yearOpts = state.years.map(y =>
    `<option value="${y.id}" ${c?.yearId===y.id?'selected':''}>${esc(y.name)}</option>`
  ).join('');

  const reqOpts = state.requirements.map(r => {
    const subs = (r.subReqs||[]).map(sr => {
      const cr = Number(sr.credits)>0 ? ` (${fmt(sr.credits)} cr)` : '';
      return `<option value="${r.id}|${sr.id}" ${c?.reqId===r.id&&c?.subReqId===sr.id?'selected':''}>  ↳ ${esc(sr.name)}${cr}</option>`;
    }).join('');
    return `<option value="${r.id}" ${c?.reqId===r.id&&!c?.subReqId?'selected':''}>${esc(r.name)}</option>${subs}`;
  }).join('');

  const gradeOpts = GRADES.map(g => `<option value="${g}" ${c?.grade===g?'selected':''}>${g}</option>`).join('');
  const typeOpts  = COURSE_TYPES.map(t => `<option value="${t}" ${(c?.type||'Standard')===t?'selected':''}>${t}</option>`).join('');

  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label for="c-name">Course Name *</label>
      <input type="text" id="c-name" placeholder="e.g. Algebra II" value="${esc(c?.name||'')}" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="c-year">School Year</label>
        <select id="c-year"><option value="">— Select —</option>${yearOpts}</select>
      </div>
      <div class="form-group">
        <label for="c-credits">Credits *</label>
        <input type="number" id="c-credits" placeholder="1.0" min="0" step="0.5" value="${c?.credits??''}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="c-grade">Grade</label>
        <select id="c-grade"><option value="">— Select —</option>${gradeOpts}</select>
      </div>
      <div class="form-group">
        <label for="c-type">Course Type</label>
        <select id="c-type">${typeOpts}</select>
      </div>
    </div>
    <div class="form-group">
      <label for="c-req">Requirement Category</label>
      <select id="c-req"><option value="">— Uncategorized —</option>${reqOpts}</select>
    </div>
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
  if (reqVal.includes('|')) [reqId,subReqId] = reqVal.split('|');
  else reqId = reqVal;

  if (!name) { toast('Please enter a course name.', 'error'); return; }
  if (isNaN(credits)||credits<0) { toast('Please enter a valid credit value.', 'error'); return; }

  const data = { name, credits, yearId, grade, type, reqId, subReqId, planned };
  if (courseId) Object.assign(state.courses.find(c=>c.id===courseId), data);
  else state.courses.push({ id: uid(), ...data });

  saveData(); closeModal(); renderAll();
  toast(courseId ? 'Course updated.' : 'Course added.', 'success');
}

function deleteCourse(id) {
  if (!confirm('Delete this course?')) return;
  state.courses = state.courses.filter(c => c.id !== id);
  saveData(); renderAll(); toast('Course deleted.');
}

// ═════════════════════════════════════════════════════════════
// STATS
// ═════════════════════════════════════════════════════════════
function renderStats() {
  const earned    = totalEarned();
  const planned   = totalPlanned();
  const required  = totalRequired();
  const remaining = Math.max(0, required - earned);
  const metCount  = state.requirements.filter(r => creditsEarnedForReq(r.id) >= r.credits && r.credits > 0).length;
  const pct  = required > 0 ? (earned / required) * 100 : 0;
  const yearsW = state.years.filter(y => state.courses.some(c => c.yearId===y.id && !c.planned));
  const avg  = yearsW.length > 0 ? earned / yearsW.length : 0;

  document.getElementById('stat-total-courses').textContent     = state.courses.length;
  document.getElementById('stat-credits-earned').textContent    = fmt(earned);
  document.getElementById('stat-credits-remaining').textContent = fmt(remaining);
  document.getElementById('stat-credits-planned').textContent   = fmt(planned);
  document.getElementById('stat-reqs-met').textContent          = `${metCount} / ${state.requirements.length}`;
  document.getElementById('stat-completion').textContent        = fmt(pct) + '%';
  document.getElementById('stat-avg-credits').textContent       = fmt(avg);
  document.getElementById('stat-grad-year').textContent         = state.student.gradYear || '—';

  // Bar chart
  const byYear = creditsByYear();
  const maxC   = Math.max(...state.years.map(y=>(byYear[y.id]?.earned||0)+(byYear[y.id]?.planned||0)), 1);
  document.getElementById('bar-chart-years').innerHTML = state.years.length === 0
    ? '<p class="text-muted" style="font-size:.85rem;padding:20px 0">No years defined.</p>'
    : state.years.map(y => {
        const e = byYear[y.id]?.earned  || 0;
        const p = byYear[y.id]?.planned || 0;
        const hE = Math.round((e/maxC)*140);
        const hP = Math.round((p/maxC)*140);
        return `
        <div class="bar-col">
          <div class="bar-col-val">${fmt(e)}${p>0?`<span class="bar-plan-label">+${fmt(p)}</span>`:''}</div>
          <div class="bar-col-inner-wrap" style="height:${hE+hP}px">
            ${p>0?`<div class="bar-seg planned" style="height:${hP}px"></div>`:''}
            <div class="bar-seg earned" style="height:${hE}px"></div>
          </div>
          <div class="bar-col-label">${esc(y.name)}</div>
        </div>`;
      }).join('');

  // Requirement breakdown — sub-req chips with status (#3)
  document.getElementById('req-breakdown').innerHTML = state.requirements.length === 0
    ? '<p class="text-muted" style="font-size:.85rem">No requirements defined.</p>'
    : state.requirements.map(req => {
        const e    = creditsEarnedForReq(req.id);
        const p    = creditsPlannedForReq(req.id);
        const pct  = req.credits > 0 ? Math.min(100, (e/req.credits)*100) : 0;
        const pctP = req.credits > 0 ? Math.min(100-pct, (p/req.credits)*100) : 0;
        const done = e >= req.credits && req.credits > 0;

        const subH = (req.subReqs||[]).length
          ? `<div class="breakdown-subreqs">${req.subReqs.map(sr => {
              const status = subReqStatus(req, sr);
              const cr     = Number(sr.credits)>0 ? ` (${fmt(sr.credits)})` : '';
              const cls    = status==='earned'  ? 'subreq-chip sm sr-met'
                           : status==='planned' ? 'subreq-chip sm sr-planned'
                           : 'subreq-chip sm';
              const icon   = status==='earned' ? '✓ ' : status==='planned' ? '◷ ' : '';
              return `<span class="${cls}">${icon}${esc(sr.name)}${cr}</span>`;
            }).join('')}</div>` : '';

        return `
        <div class="req-row">
          <div class="req-row-name">${esc(req.name)}${subH}</div>
          <div class="req-row-bar-wrap">
            <div class="req-row-bar ${done?'done':''}" style="width:${pct}%"></div>
            <div class="req-row-bar-gold" style="width:${pctP}%"></div>
          </div>
          <div class="req-row-credits">${fmt(e)}${p>0?`<span class="plan-inline">+${fmt(p)}</span>`:''} / ${fmt(req.credits)}</div>
        </div>`;
      }).join('');

  // Grade distribution
  const gradesE = {}, gradesP = {};
  state.courses.forEach(c => {
    if (!c.grade) return;
    if (c.planned) gradesP[c.grade] = (gradesP[c.grade]||0) + 1;
    else           gradesE[c.grade] = (gradesE[c.grade]||0) + 1;
  });
  const orderedGrades = GRADES.filter(g => gradesE[g] || gradesP[g]);
  document.getElementById('grade-dist').innerHTML = orderedGrades.length
    ? orderedGrades.map(g => `
        <div class="grade-dist-item">
          <div class="grade-dist-count">${gradesE[g]||0}</div>
          ${gradesP[g] ? `<div class="grade-planned-note">+${gradesP[g]}</div>` : ''}
          <div class="grade-dist-label">${g}</div>
        </div>`).join('')
    : '<p class="text-muted" style="font-size:.85rem">No grade data available.</p>';
}

// ═════════════════════════════════════════════════════════════
// SETTINGS
// ═════════════════════════════════════════════════════════════
function setupSettings() {
  document.getElementById('btn-save-student').addEventListener('click', () => {
    state.student.name    = document.getElementById('student-name').value.trim();
    state.student.gradYear = document.getElementById('grad-year').value.trim();
    state.student.school  = document.getElementById('student-school').value.trim();
    saveData(); renderDashboard();
    // Auto-fill school in year add field
    document.getElementById('new-year-school').value = state.student.school;
    toast('Student info saved.', 'success');
  });
  document.getElementById('btn-add-year').addEventListener('click', addYear);
  document.getElementById('new-year-name').addEventListener('keydown', e => { if(e.key==='Enter') addYear(); });
  document.getElementById('btn-add-req').addEventListener('click', addRequirement);
  document.getElementById('new-req-name').addEventListener('keydown', e => { if(e.key==='Enter') addRequirement(); });
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('import-file').addEventListener('change', importData);
  document.getElementById('btn-clear').addEventListener('click', clearData);
}

function renderSettings() {
  document.getElementById('student-name').value   = state.student.name    || '';
  document.getElementById('grad-year').value      = state.student.gradYear || '';
  document.getElementById('student-school').value = state.student.school  || '';

  // Pre-fill school in add-year input if empty
  const nySchool = document.getElementById('new-year-school');
  if (!nySchool.value && state.student.school) nySchool.value = state.student.school;

  // Years list — show school name (#4)
  document.getElementById('years-list').innerHTML = state.years.length
    ? state.years.map(y => `
      <div class="list-item">
        <div class="list-item-name-group">
          <span class="list-item-name">${esc(y.name)}</span>
          ${y.school ? `<span class="list-item-school">${esc(y.school)}</span>` : ''}
        </div>
        <div class="list-item-actions">
          <button class="btn-icon" onclick="openEditYearModal('${y.id}')" title="Edit year">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon delete" onclick="deleteYear('${y.id}')" title="Delete year">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`).join('')
    : '<p class="text-muted" style="font-size:.85rem;padding:6px 0">No years added yet.</p>';

  // Requirements list
  document.getElementById('reqs-list').innerHTML = state.requirements.length
    ? state.requirements.map(r => {
        const subList = (r.subReqs||[]).map(sr => {
          const status = subReqStatus(r, sr);
          const cr     = Number(sr.credits)>0 ? `${fmt(sr.credits)} cr` : '0 cr';
          const statusDot = status==='earned'  ? '<span class="sr-dot sr-dot-earned" title="Requirement met">✓</span>'
                          : status==='planned' ? '<span class="sr-dot sr-dot-planned" title="Course planned">◷</span>'
                          : '<span class="sr-dot sr-dot-none" title="Not started">○</span>';
          return `
          <div class="subreq-item">
            ${statusDot}
            <span class="subreq-item-name">${esc(sr.name)}</span>
            <span class="subreq-item-credits">${cr}</span>
            <div class="subreq-item-actions">
              <button class="btn-icon" onclick="openEditSubReqModal('${r.id}','${sr.id}')" title="Edit sub-requirement">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon delete" onclick="deleteSubReq('${r.id}','${sr.id}')" title="Remove">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </div>`;
        }).join('');

        return `
        <div class="req-list-block" id="req-block-${r.id}">
          <div class="list-item req-list-item">
            <span class="list-item-name">${esc(r.name)}</span>
            <span class="list-item-credits">${fmt(r.credits)} cr</span>
            <div class="list-item-actions">
              <button class="btn-icon" onclick="openEditReqModal('${r.id}')" title="Edit">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon" onclick="toggleSubReqForm('${r.id}')" title="Add sub-req">
                <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button class="btn-icon delete" onclick="deleteReq('${r.id}')" title="Delete">
                <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </div>
          ${subList ? `<div class="subreq-list">${subList}</div>` : ''}
          <div class="subreq-add-form hidden" id="subreq-form-${r.id}">
            <input type="text" id="subreq-name-${r.id}" placeholder='Name (e.g. "Algebra I Required")' />
            <input type="number" id="subreq-credits-${r.id}" placeholder="Credits" min="0" step="0.5" class="input-credits-sm" />
            <button class="btn btn-secondary btn-sm" onclick="addSubReq('${r.id}')">Add</button>
            <button class="btn btn-outline btn-sm" onclick="toggleSubReqForm('${r.id}')">Cancel</button>
          </div>
        </div>`;
      }).join('')
    : '<p class="text-muted" style="font-size:.85rem;padding:6px 0">No requirements added yet.</p>';

  document.getElementById('total-req-credits').textContent = fmt(totalRequired());
}

// ── Edit Year Modal (#4) ──────────────────────────────────────
function openEditYearModal(yearId) {
  const y = state.years.find(x => x.id === yearId);
  if (!y) return;
  document.getElementById('modal-title').textContent = 'Edit School Year';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label for="edit-year-name">Year / Grade Label *</label>
      <input type="text" id="edit-year-name" value="${esc(y.name)}" placeholder='e.g. "9th Grade"' />
    </div>
    <div class="form-group" style="margin-top:12px">
      <label for="edit-year-school">School Name</label>
      <input type="text" id="edit-year-school" value="${esc(y.school||'')}" placeholder="e.g. Valley High School" />
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save-year">Save Changes</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save-year').addEventListener('click', () => {
    const name   = document.getElementById('edit-year-name').value.trim();
    const school = document.getElementById('edit-year-school').value.trim();
    if (!name) { toast('Please enter a year label.', 'error'); return; }
    y.name   = name;
    y.school = school;
    saveData(); closeModal(); renderAll();
    toast('Year updated.', 'success');
  });
  openModal();
  document.getElementById('edit-year-name').focus();
}

// ── Edit Req Modal ────────────────────────────────────────────
function openEditReqModal(reqId) {
  const req = state.requirements.find(r => r.id === reqId);
  if (!req) return;
  document.getElementById('modal-title').textContent = 'Edit Requirement';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label for="edit-req-name">Requirement Name *</label>
      <input type="text" id="edit-req-name" value="${esc(req.name)}" placeholder="e.g. Mathematics" />
    </div>
    <div class="form-group" style="margin-top:12px">
      <label for="edit-req-credits">Total Credits Required *</label>
      <input type="number" id="edit-req-credits" value="${req.credits}" min="0" step="0.5" />
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save-req">Save Changes</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save-req').addEventListener('click', () => {
    const name    = document.getElementById('edit-req-name').value.trim();
    const credits = parseFloat(document.getElementById('edit-req-credits').value);
    if (!name) { toast('Please enter a requirement name.', 'error'); return; }
    if (isNaN(credits)||credits<0) { toast('Please enter a valid credit amount.', 'error'); return; }
    req.name = name; req.credits = credits;
    saveData(); closeModal(); renderAll();
    toast('Requirement updated.', 'success');
  });
  openModal();
  document.getElementById('edit-req-name').focus();
}

// ── Edit Sub-Req Modal ────────────────────────────────────────
function openEditSubReqModal(reqId, subId) {
  const req = state.requirements.find(r => r.id === reqId);
  const sr  = req?.subReqs?.find(s => s.id === subId);
  if (!req || !sr) return;
  document.getElementById('modal-title').textContent = 'Edit Sub-Requirement';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-group">
      <label for="edit-sub-name">Sub-Requirement Name *</label>
      <input type="text" id="edit-sub-name" value="${esc(sr.name)}" placeholder="e.g. Algebra I Required" />
    </div>
    <p class="settings-hint" style="margin-top:6px;font-size:.78rem">
      <i class="fa-solid fa-circle-info" style="color:var(--blue-lite)"></i>
      This name is compared to course names to detect automatic completion.
    </p>
    <div class="form-group" style="margin-top:10px">
      <label for="edit-sub-credits">Credits (0 if informational)</label>
      <input type="number" id="edit-sub-credits" value="${sr.credits||0}" min="0" step="0.5" />
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save-sub">Save Changes</button>
    </div>`;
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save-sub').addEventListener('click', () => {
    const name    = document.getElementById('edit-sub-name').value.trim();
    const credits = parseFloat(document.getElementById('edit-sub-credits').value) || 0;
    if (!name) { toast('Please enter a name.', 'error'); return; }
    sr.name = name; sr.credits = credits;
    saveData(); closeModal(); renderAll();
    toast('Sub-requirement updated.', 'success');
  });
  openModal();
  document.getElementById('edit-sub-name').focus();
}

// ── Sub-req form ──────────────────────────────────────────────
function toggleSubReqForm(reqId) {
  const form = document.getElementById(`subreq-form-${reqId}`);
  if (!form) return;
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) document.getElementById(`subreq-name-${reqId}`)?.focus();
}

function addSubReq(reqId) {
  const name    = document.getElementById(`subreq-name-${reqId}`)?.value.trim();
  const credits = parseFloat(document.getElementById(`subreq-credits-${reqId}`)?.value) || 0;
  if (!name) { toast('Please enter a sub-requirement name.', 'error'); return; }
  const req = state.requirements.find(r => r.id === reqId);
  if (!req) return;
  req.subReqs = req.subReqs || [];
  if (req.subReqs.find(sr => sr.name.toLowerCase()===name.toLowerCase())) {
    toast('Sub-requirement already exists.', 'error'); return;
  }
  req.subReqs.push({ id: uid(), name, credits });
  saveData(); renderAll();
  toast('Sub-requirement added.', 'success');
}

function deleteSubReq(reqId, subId) {
  const req = state.requirements.find(r => r.id === reqId);
  if (!req) return;
  req.subReqs = (req.subReqs||[]).filter(sr => sr.id !== subId);
  state.courses.forEach(c => { if (c.reqId===reqId && c.subReqId===subId) c.subReqId=''; });
  saveData(); renderAll(); toast('Sub-requirement removed.');
}

// ── Years / Requirements ──────────────────────────────────────
function addYear() {
  const name   = document.getElementById('new-year-name').value.trim();
  const school = document.getElementById('new-year-school').value.trim() || state.student.school || '';
  if (!name) { toast('Please enter a year name.', 'error'); return; }
  if (state.years.find(y=>y.name.toLowerCase()===name.toLowerCase())) { toast('Year already exists.', 'error'); return; }
  state.years.push({ id: uid(), name, school });
  document.getElementById('new-year-name').value = '';
  saveData(); renderAll(); toast('Year added.', 'success');
}

function deleteYear(yearId) {
  if (state.courses.some(c => c.yearId===yearId)) {
    if (!confirm('This year has courses. Deleting removes the year assignment. Continue?')) return;
    state.courses.forEach(c => { if (c.yearId===yearId) c.yearId=''; });
  }
  state.years = state.years.filter(y => y.id !== yearId);
  saveData(); renderAll(); toast('Year removed.');
}

function addRequirement() {
  const name    = document.getElementById('new-req-name').value.trim();
  const credits = parseFloat(document.getElementById('new-req-credits').value);
  if (!name) { toast('Please enter a requirement name.', 'error'); return; }
  if (isNaN(credits)||credits<=0) { toast('Please enter a valid credit amount.', 'error'); return; }
  if (state.requirements.find(r=>r.name.toLowerCase()===name.toLowerCase())) { toast('Requirement already exists.', 'error'); return; }
  state.requirements.push({ id: uid(), name, credits, subReqs: [] });
  document.getElementById('new-req-name').value    = '';
  document.getElementById('new-req-credits').value = '';
  saveData(); renderAll(); toast('Requirement added.', 'success');
}

function deleteReq(reqId) {
  if (state.courses.some(c => c.reqId===reqId)) {
    if (!confirm('Some courses use this requirement. Removing it will unassign those courses. Continue?')) return;
    state.courses.forEach(c => { if (c.reqId===reqId) { c.reqId=''; c.subReqId=''; } });
  }
  state.requirements = state.requirements.filter(r => r.id !== reqId);
  saveData(); renderAll(); toast('Requirement removed.');
}

// ── Import / Export ───────────────────────────────────────────
function exportData() {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),
    download: `gradtracker-${new Date().toISOString().slice(0,10)}.json`
  });
  a.click(); toast('Data exported.', 'success');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!confirm('This will replace all current data. Continue?')) return;
      if (parsed.student && !parsed.student.school) parsed.student.school = '';
      if (parsed.years) parsed.years = parsed.years.map(y => ({school:'',...y}));
      if (parsed.requirements) parsed.requirements = parsed.requirements.map(r => ({ ...r, subReqs:(r.subReqs||[]).map(sr=>({credits:0,...sr})) }));
      Object.assign(state, parsed);
      saveData(); renderAll(); toast('Data imported.', 'success');
    } catch { toast('Invalid file format.', 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function clearData() {
  if (!confirm('This will permanently delete ALL data. Are you sure?')) return;
  state = { student:{name:'',gradYear:'',school:''}, years:[], requirements:[], courses:[] };
  saveData(); renderAll(); toast('All data cleared.');
}

// ── Modal ──────────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key==='Escape') closeModal(); });

// ── Toast ──────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' '+type : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.add('toast-fade');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, 2500);
}

// ── Utilities ──────────────────────────────────────────────────
function esc(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}
