/* ═══════════════════════════════════════
   DATA LAYER
═══════════════════════════════════════ */
const DB = {
  save(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  load(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } }
};

let profiles = DB.load('tl_profiles', []);
let currentProfileId = null;
let currentProfile = null;
let entries = [];

function getProfile(id) { return profiles.find(p => p.id === id); }

function loadProfile(id) {
  currentProfileId = id;
  currentProfile = getProfile(id);
  entries = DB.load('tl_entries_' + id, []);
}

function saveProfiles() { DB.save('tl_profiles', profiles); }
function saveEntries() { DB.save('tl_entries_' + currentProfileId, entries); }

function createProfile(name, mode, color) {
  const p = {
    id: Date.now().toString(),
    name, mode, color,
    settings: {
      normalRate: 0, otRate: 0, holidayRate: 0, monthlyBase: 0,
      otThresholdHrs: 8
    }
  };
  profiles.push(p);
  saveProfiles();
  return p;
}

function upsertEntry(dateStr, data) {
  const idx = entries.findIndex(e => e.date === dateStr);
  if (idx >= 0) entries[idx] = { ...entries[idx], ...data, date: dateStr };
  else entries.push({ date: dateStr, ...data });
  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveEntries();
}

function deleteEntry(dateStr) {
  entries = entries.filter(e => e.date !== dateStr);
  saveEntries();
}

function getEntry(dateStr) { return entries.find(e => e.date === dateStr) || null; }

/* ═══════════════════════════════════════
   TIME / CALC HELPERS
═══════════════════════════════════════ */
function toMins(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }
function fromMins(m) { return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }

function calcDay(entry, profile) {
  if (!entry || !entry.timeIn || !entry.timeOut) return null;
  const inM  = toMins(entry.timeIn);
  const outM = toMins(entry.timeOut);
  const lunchM = entry.lunchMins || 60;
  const totalM = outM - inM - lunchM;
  if (totalM <= 0) return null;
  const netHrs = totalM / 60;
  const s = profile.settings;

  if (entry.isHoliday) {
    // Holiday: all hours at holiday rate
    const pay = netHrs * s.holidayRate;
    return { netHrs, regularHrs: 0, otHrs: 0, holidayHrs: netHrs, pay, otPay: 0, holidayPay: pay, regularPay: 0 };
  }

  if (profile.mode === 'monthly') {
    // OT = anything after 18:00
    const otBoundary = toMins('18:00');
    const otMins = Math.max(0, outM - otBoundary);
    const otHrs  = otMins / 60;
    const regularHrs = netHrs - otHrs;
    const otPay  = otHrs * s.otRate;
    return { netHrs, regularHrs, otHrs, holidayHrs: 0, pay: otPay, otPay, holidayPay: 0, regularPay: 0 };
  } else {
    // Hourly: OT after threshold hours
    const thresh = s.otThresholdHrs || 8;
    const otHrs  = Math.max(0, netHrs - thresh);
    const regularHrs = netHrs - otHrs;
    const regularPay = regularHrs * s.normalRate;
    const otPay  = otHrs * s.otRate;
    return { netHrs, regularHrs, otHrs, holidayHrs: 0, pay: regularPay + otPay, otPay, holidayPay: 0, regularPay };
  }
}

function fmtHrs(h) {
  if (!h || h <= 0) return '0h';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function fmtYen(n) {
  if (!n || isNaN(n)) return '¥0';
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

function todayStr() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function fmtDate(str) {
  const [y,m,d] = str.split('-');
  return new Date(+y,+m-1,+d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

function monthEntries(year, month) {
  const prefix = year+'-'+String(month+1).padStart(2,'0');
  return entries.filter(e => e.date.startsWith(prefix));
}

/* ═══════════════════════════════════════
   THEME / APPEARANCE
═══════════════════════════════════════ */
let appTheme    = DB.load('tl_theme', 'light');
let appFontSize = DB.load('tl_fontsize', 'medium');
let appBtnStyle = DB.load('tl_btnstyle', 'modern');

function applyAppearance() {
  document.documentElement.setAttribute('data-theme', appTheme);
  document.documentElement.setAttribute('data-fontsize', appFontSize);
  document.documentElement.setAttribute('data-btnstyle', appBtnStyle);
  document.getElementById('themeColorMeta').content = appTheme === 'dark' ? '#0f0f14' : '#f5f4f0';
  // sync toggles if settings screen open
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) themeToggle.checked = appTheme === 'dark';
}

function saveAppearance() {
  DB.save('tl_theme', appTheme);
  DB.save('tl_fontsize', appFontSize);
  DB.save('tl_btnstyle', appBtnStyle);
}

/* ═══════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════ */
let currentScreen = 'login';

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
  currentScreen = id;
}

/* ═══════════════════════════════════════
   PROFILE COLORS
═══════════════════════════════════════ */
const COLORS = ['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#059669'];

/* ═══════════════════════════════════════
   CALENDAR STATE
═══════════════════════════════════════ */
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedDate = todayStr();

/* ═══════════════════════════════════════
   RENDER: LOGIN SCREEN
═══════════════════════════════════════ */
function renderLogin() {
  const grid = document.getElementById('profilesGrid');
  grid.innerHTML = '';

  profiles.forEach(p => {
    const tile = document.createElement('div');
    tile.className = 'profile-tile';
    tile.innerHTML = `
      <div class="profile-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <div class="profile-name">${p.name}</div>
      <div class="profile-mode-badge ${p.mode === 'monthly' ? 'badge-monthly' : 'badge-hourly'}">
        ${p.mode === 'monthly' ? '📅 Monthly' : '⏱ Hourly'}
      </div>`;
    tile.onclick = () => { loadProfile(p.id); showScreen('home'); renderHome(); };
    grid.appendChild(tile);
  });

  // Add profile tile
  const addTile = document.createElement('div');
  addTile.className = 'add-profile-tile';
  addTile.innerHTML = `<div class="plus-icon">＋</div><span>New Profile</span>`;
  addTile.onclick = () => showScreen('onboard');
  grid.appendChild(addTile);
}

/* ═══════════════════════════════════════
   RENDER: ONBOARDING
═══════════════════════════════════════ */
let onboardMode = 'monthly';
let onboardColor = COLORS[0];

function renderOnboard() {
  document.getElementById('onboardColorDots').innerHTML = COLORS.map((c,i) =>
    `<div class="color-dot${c===onboardColor?' selected':''}" style="background:${c}" onclick="selectOnboardColor('${c}')"></div>`
  ).join('');
  document.querySelectorAll('.mode-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.mode === onboardMode);
  });
}

function selectOnboardColor(c) { onboardColor = c; renderOnboard(); }

function submitOnboard() {
  const name = document.getElementById('onboardName').value.trim();
  if (!name) { alert('Please enter your name.'); return; }
  const p = createProfile(name, onboardMode, onboardColor);
  loadProfile(p.id);
  showScreen('home');
  renderHome();
}

/* ═══════════════════════════════════════
   RENDER: HOME SCREEN
═══════════════════════════════════════ */
function renderHome() {
  document.getElementById('homeProfileName').textContent = currentProfile.name;
  document.getElementById('homeProfileInitial').textContent = currentProfile.name.charAt(0).toUpperCase();
  document.getElementById('homeProfileInitial').style.background = currentProfile.color;
  document.getElementById('homeModeBadge').textContent = currentProfile.mode === 'monthly' ? '📅 Monthly' : '⏱ Hourly';

  // Today tile
  const todayEntry = getEntry(todayStr());
  if (todayEntry && todayEntry.timeIn) {
    const calc = calcDay(todayEntry, currentProfile);
    document.getElementById('todayTileInfo').textContent = calc ? fmtHrs(calc.netHrs) + ' logged' : 'Entry exists';
  } else {
    document.getElementById('todayTileInfo').textContent = 'Tap to log today';
  }

  // Earnings tile
  const now = new Date();
  const mEntries = monthEntries(now.getFullYear(), now.getMonth());
  let monthPay = 0;
  if (currentProfile.mode === 'monthly') {
    monthPay = currentProfile.settings.monthlyBase || 0;
    mEntries.forEach(e => { const c = calcDay(e, currentProfile); if(c) monthPay += c.pay; });
  } else {
    mEntries.forEach(e => { const c = calcDay(e, currentProfile); if(c) monthPay += c.pay; });
  }
  document.getElementById('earningsTileInfo').textContent = fmtYen(monthPay);
}

/* ═══════════════════════════════════════
   RENDER: CALENDAR SCREEN
═══════════════════════════════════════ */
function renderCalendar() {
  const label = new Date(calYear, calMonth).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  document.getElementById('calMonthLabel').textContent = label;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  const today = todayStr();

  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(dl => {
    const el = document.createElement('div');
    el.className = 'cal-day-label';
    el.textContent = dl;
    grid.appendChild(el);
  });

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds = calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const entry = getEntry(ds);
    const calc = entry ? calcDay(entry, currentProfile) : null;
    const isToday = ds === today;
    const isSel = ds === selectedDate;

    let dotColor = '';
    if (entry) {
      if (entry.isHoliday && !entry.timeIn) dotColor = 'var(--red)';
      else if (entry.isHoliday && entry.timeIn) dotColor = 'var(--amber)';
      else if (calc && calc.otHrs > 0) dotColor = 'var(--blue)';
      else if (entry.timeIn) dotColor = 'var(--green)';
    }

    const el = document.createElement('div');
    el.className = 'cal-day' + (isToday ? ' today' : '') + (isSel ? ' selected' : '');
    el.innerHTML = `
      <span class="cal-day-num">${d}</span>
      ${calc ? `<span class="cal-day-hrs">${fmtHrs(calc.netHrs)}</span>` : (entry && entry.isHoliday ? '<span class="cal-day-holiday">off</span>' : '')}
      ${dotColor ? `<span class="cal-dot" style="background:${dotColor}"></span>` : ''}
    `;
    el.onclick = () => { selectedDate = ds; renderCalendar(); openLogEntry(ds); };
    grid.appendChild(el);
  }

  // Month summary bar
  const mE = monthEntries(calYear, calMonth);
  let totalHrs = 0, totalPay = 0;
  if (currentProfile.mode === 'monthly') {
    totalPay = currentProfile.settings.monthlyBase || 0;
  }
  mE.forEach(e => { const c = calcDay(e, currentProfile); if(c){totalHrs+=c.netHrs; totalPay+=c.pay;} });
  document.getElementById('calSummaryHrs').textContent = fmtHrs(totalHrs);
  document.getElementById('calSummaryPay').textContent = fmtYen(totalPay);
}

function shiftMonth(dir) {
  calMonth += dir;
  if (calMonth < 0) { calMonth=11; calYear--; }
  if (calMonth > 11) { calMonth=0; calYear++; }
  renderCalendar();
}

/* ═══════════════════════════════════════
   LOG ENTRY MODAL
═══════════════════════════════════════ */
function openLogEntry(dateStr) {
  selectedDate = dateStr;
  document.getElementById('logEntryDate').textContent = fmtDate(dateStr);
  const entry = getEntry(dateStr) || {};

  document.getElementById('logTimeIn').value  = entry.timeIn  || '';
  document.getElementById('logTimeOut').value = entry.timeOut || '';
  document.getElementById('logLunch').value   = entry.lunchMins || 60;
  document.getElementById('logHoliday').checked = entry.isHoliday || false;

  updateLogPreview();
  document.getElementById('logModal').classList.add('open');
}

function closeLogModal() { document.getElementById('logModal').classList.remove('open'); }

function updateLogPreview() {
  const tIn  = document.getElementById('logTimeIn').value;
  const tOut = document.getElementById('logTimeOut').value;
  const lunchMins = parseInt(document.getElementById('logLunch').value) || 60;
  const isHoliday = document.getElementById('logHoliday').checked;
  const el = document.getElementById('logPreview');

  if (!tIn || !tOut) { el.textContent = '—'; return; }
  const totalMins = toMins(tOut) - toMins(tIn) - lunchMins;
  if (totalMins <= 0) { el.textContent = 'Invalid'; return; }
  const netHrs = totalMins/60;

  if (isHoliday) {
    const pay = netHrs * (currentProfile.settings.holidayRate || 0);
    el.textContent = `${fmtHrs(netHrs)} · ${fmtYen(pay)} (holiday)`;
  } else if (currentProfile.mode === 'monthly') {
    const otBoundary = toMins('18:00');
    const outM = toMins(tOut);
    const otHrs = Math.max(0,(outM-otBoundary)/60);
    const regularHrs = netHrs - otHrs;
    const otPay = otHrs * (currentProfile.settings.otRate || 0);
    el.textContent = `${fmtHrs(netHrs)} · OT: ${fmtHrs(otHrs)} · ${fmtYen(otPay)}`;
  } else {
    const thresh = currentProfile.settings.otThresholdHrs || 8;
    const otHrs = Math.max(0, netHrs - thresh);
    const regHrs = netHrs - otHrs;
    const pay = regHrs*(currentProfile.settings.normalRate||0) + otHrs*(currentProfile.settings.otRate||0);
    el.textContent = `${fmtHrs(netHrs)} · OT: ${fmtHrs(otHrs)} · ${fmtYen(pay)}`;
  }
}

function saveLogEntry() {
  const tIn  = document.getElementById('logTimeIn').value;
  const tOut = document.getElementById('logTimeOut').value;
  const lunchMins = parseInt(document.getElementById('logLunch').value) || 60;
  const isHoliday = document.getElementById('logHoliday').checked;

  if (!isHoliday && (!tIn || !tOut)) { alert('Enter time in and time out.'); return; }
  if (tIn && tOut && toMins(tOut) - toMins(tIn) - lunchMins <= 0) { alert('Check your times — net hours must be positive.'); return; }

  upsertEntry(selectedDate, { timeIn: tIn, timeOut: tOut, lunchMins, isHoliday });
  closeLogModal();
  renderCalendar();
  if (currentScreen === 'home') renderHome();
}

function deleteLogEntry() {
  if (!confirm('Delete this entry?')) return;
  deleteEntry(selectedDate);
  closeLogModal();
  renderCalendar();
  if (currentScreen === 'home') renderHome();
}

/* ═══════════════════════════════════════
   RENDER: EARNINGS SCREEN
═══════════════════════════════════════ */
function renderEarnings() {
  const now = new Date();
  const mE = monthEntries(calYear, calMonth);
  const label = new Date(calYear,calMonth).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  document.getElementById('earningsMonthLabel').textContent = label;

  let regularHrs=0, otHrs=0, holidayHrs=0;
  let regularPay=0, otPay=0, holidayPay=0;
  let baseSalary = 0;

  if (currentProfile.mode === 'monthly') {
    baseSalary = currentProfile.settings.monthlyBase || 0;
  }

  mE.forEach(e => {
    const c = calcDay(e, currentProfile);
    if (!c) return;
    regularHrs  += c.regularHrs;
    otHrs       += c.otHrs;
    holidayHrs  += c.holidayHrs;
    regularPay  += c.regularPay;
    otPay       += c.otPay;
    holidayPay  += c.holidayPay;
  });

  const gross = baseSalary + regularPay + otPay + holidayPay;

  const rows = [];
  if (currentProfile.mode === 'monthly') {
    rows.push({ label: 'Base Salary', hours: null, amount: baseSalary, color: 'var(--blue)' });
    rows.push({ label: 'OT Pay', hours: otHrs, amount: otPay, color: 'var(--amber)', rate: currentProfile.settings.otRate });
  } else {
    rows.push({ label: 'Regular Pay', hours: regularHrs, amount: regularPay, color: 'var(--green)', rate: currentProfile.settings.normalRate });
    rows.push({ label: 'OT Pay', hours: otHrs, amount: otPay, color: 'var(--amber)', rate: currentProfile.settings.otRate });
  }
  rows.push({ label: 'Holiday Pay', hours: holidayHrs, amount: holidayPay, color: 'var(--red)', rate: currentProfile.settings.holidayRate });

  document.getElementById('earningsGross').textContent = fmtYen(gross);
  document.getElementById('earningsRows').innerHTML = rows.map(r => `
    <div class="earnings-row">
      <div class="er-left">
        <span class="er-dot" style="background:${r.color}"></span>
        <div>
          <div class="er-label">${r.label}</div>
          ${r.hours != null ? `<div class="er-hrs">${fmtHrs(r.hours)}${r.rate ? ' × '+fmtYen(r.rate)+'/hr' : ''}</div>` : ''}
        </div>
      </div>
      <div class="er-amount ${r.amount > 0 ? '' : 'er-zero'}">${fmtYen(r.amount)}</div>
    </div>
  `).join('');

  document.getElementById('earningsWorkDays').textContent = mE.filter(e=>e.timeIn && !e.isHoliday).length + ' days';
  document.getElementById('earningsHolidays').textContent = mE.filter(e=>e.isHoliday).length + ' days';
  document.getElementById('earningsTotalHrs').textContent = fmtHrs(regularHrs+otHrs+holidayHrs);
}

/* ═══════════════════════════════════════
   RENDER: SETTINGS SCREEN
═══════════════════════════════════════ */
function renderSettings() {
  const s = currentProfile.settings;
  document.getElementById('settingProfileName').textContent = currentProfile.name;
  document.getElementById('settingModeBadge').textContent = currentProfile.mode === 'monthly' ? '📅 Monthly' : '⏱ Hourly';

  // Show/hide relevant rate fields
  document.getElementById('rowNormalRate').style.display  = currentProfile.mode === 'hourly' ? '' : 'none';
  document.getElementById('rowMonthlyBase').style.display = currentProfile.mode === 'monthly' ? '' : 'none';
  document.getElementById('rowOtThreshold').style.display = currentProfile.mode === 'hourly' ? '' : 'none';

  document.getElementById('setNormalRate').value    = s.normalRate    || '';
  document.getElementById('setOtRate').value        = s.otRate        || '';
  document.getElementById('setHolidayRate').value   = s.holidayRate   || '';
  document.getElementById('setMonthlyBase').value   = s.monthlyBase   || '';
  document.getElementById('setOtThreshold').value   = s.otThresholdHrs || 8;

  document.getElementById('themeToggle').checked   = appTheme === 'dark';
  // chip sync handled in inline script override
}

function saveSettings() {
  const s = currentProfile.settings;
  s.normalRate      = parseFloat(document.getElementById('setNormalRate').value)   || 0;
  s.otRate          = parseFloat(document.getElementById('setOtRate').value)        || 0;
  s.holidayRate     = parseFloat(document.getElementById('setHolidayRate').value)   || 0;
  s.monthlyBase     = parseFloat(document.getElementById('setMonthlyBase').value)   || 0;
  s.otThresholdHrs  = parseFloat(document.getElementById('setOtThreshold').value)   || 8;

  appTheme    = document.getElementById('themeToggle').checked ? 'dark' : 'light';
  // appFontSize and appBtnStyle set by chip selectors directly

  saveProfiles();
  saveAppearance();
  applyAppearance();

  // Flash confirmation
  const btn = document.getElementById('btnSaveSettings');
  btn.textContent = '✓ Saved!';
  setTimeout(() => { btn.textContent = 'Save Settings'; }, 1800);
}

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  applyAppearance();

  // Mode card selection in onboarding
  document.querySelectorAll('.mode-card').forEach(c => {
    c.onclick = () => { onboardMode = c.dataset.mode; renderOnboard(); };
  });

  if (profiles.length === 0) {
    showScreen('onboard');
    renderOnboard();
  } else {
    showScreen('login');
    renderLogin();
  }

  // Log modal listeners
  ['logTimeIn','logTimeOut','logLunch','logHoliday'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateLogPreview);
    document.getElementById(id).addEventListener('change', updateLogPreview);
  });

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
});
