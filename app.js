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
  if (!entry) return null;
  const s = profile.settings;

  // Holiday with no times: treat as a standard day (8hrs or threshold)
  if (entry.isHoliday && (!entry.timeIn || !entry.timeOut)) {
    const netHrs = s.otThresholdHrs || 8;
    if (profile.mode === 'monthly') {
      const holidayPay = netHrs * (s.holidayRate || 0);
      return { netHrs, regularHrs: netHrs, otHrs: 0, holidayHrs: netHrs, pay: holidayPay, otPay: 0, holidayPay, regularPay: 0 };
    } else {
      const holidayPay = netHrs * (s.holidayRate || 0);
      return { netHrs, regularHrs: 0, otHrs: 0, holidayHrs: netHrs, pay: holidayPay, otPay: 0, holidayPay, regularPay: 0 };
    }
  }

  if (!entry.timeIn || !entry.timeOut) return null;
  const inM  = toMins(entry.timeIn);
  const outM = toMins(entry.timeOut);
  const lunchM = entry.lunchMins || 60;
  const totalM = outM - inM - lunchM;
  if (totalM <= 0) return null;
  const netHrs = totalM / 60;

  if (entry.isHoliday) {
    if (profile.mode === 'monthly') {
      // Monthly holiday: base salary covers the day, holiday rate is extra on top
      const thresh     = s.otThresholdHrs || 8;
      const otHrs      = Math.max(0, netHrs - thresh);
      const regularHrs = netHrs - otHrs;
      const holidayPay = netHrs * (s.holidayRate || 0);
      const otPay      = otHrs  * (s.otRate      || 0);
      const pay        = holidayPay + otPay;
      return { netHrs, regularHrs, otHrs, holidayHrs: netHrs, pay, otPay, holidayPay, regularPay: 0 };
    } else {
      // Hourly holiday: paid entirely at holiday rate
      const pay = netHrs * (s.holidayRate || 0);
      return { netHrs, regularHrs: 0, otHrs: 0, holidayHrs: netHrs, pay, otPay: 0, holidayPay: pay, regularPay: 0 };
    }
  }

  if (profile.mode === 'monthly') {
    // OT = hours beyond daily threshold (default 8hrs)
    const thresh     = s.otThresholdHrs || 8;
    const otHrs      = Math.max(0, netHrs - thresh);
    const regularHrs = netHrs - otHrs;
    const otPay      = otHrs * (s.otRate || 0);
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
var appTheme    = DB.load('tl_theme', 'light');
var appFontSize = DB.load('tl_fontsize', 'medium');
var appBtnStyle = DB.load('tl_btnstyle', 'modern');

function applyAppearance() {
  document.documentElement.setAttribute('data-theme', appTheme);
  document.documentElement.setAttribute('data-fontsize', appFontSize);
  document.documentElement.setAttribute('data-btnstyle', appBtnStyle);
  document.getElementById('themeColorMeta').content = appTheme === 'dark' ? '#0f0f14' : '#f5f4f0';
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

  // Calendar tile: show current calMonth label e.g. "March 2026"
  const calLabel = new Date(calYear, calMonth).toLocaleDateString('en-US', {month:'long', year:'numeric'});
  document.getElementById('calTileMonth').textContent = calLabel;

  // Today tile
  const todayEntry = getEntry(todayStr());
  if (todayEntry && todayEntry.timeIn) {
    const calc = calcDay(todayEntry, currentProfile);
    document.getElementById('todayTileInfo').textContent = calc ? fmtHrs(calc.netHrs) + ' logged' : 'Entry exists';
  } else {
    document.getElementById('todayTileInfo').textContent = 'Tap to log today';
  }

  // Earnings tile — always synced to calMonth/calYear
  const mEntries = monthEntries(calYear, calMonth);
  let monthPay = 0;
  if (currentProfile.mode === 'monthly') {
    monthPay = currentProfile.settings.monthlyBase || 0;
  }
  mEntries.forEach(e => { const c = calcDay(e, currentProfile); if(c) monthPay += c.pay; });
  document.getElementById('earningsTileInfo').textContent = fmtYen(monthPay);
  document.getElementById('earningsTileSub').textContent = calLabel;

  // Settings tile info
  document.getElementById('settingsTileInfo').textContent = 'Profile & Theme';
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
  // Sync home tiles to new month immediately
  if (currentProfile) renderHome();
}

/* ═══════════════════════════════════════
   LOG ENTRY MODAL
═══════════════════════════════════════ */
function getPrevEntryWithTime(dateStr) {
  // Walk back up to 14 days to find last entry that has a timeIn
  const d = new Date(dateStr);
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() - 1);
    const ds = d.toISOString().slice(0, 10);
    const e = getEntry(ds);
    if (e && e.timeIn) return e;
  }
  return null;
}

function addMinsToTime(timeStr, mins) {
  const total = toMins(timeStr) + mins;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

function snapTo15(timeStr) {
  // Round to nearest 15-min option available in the select
  const t = toMins(timeStr);
  const snapped = Math.round(t / 15) * 15;
  const h = Math.floor(snapped / 60) % 24;
  const m = snapped % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

function openLogEntry(dateStr) {
  selectedDate = dateStr;
  document.getElementById('logEntryDate').textContent = fmtDate(dateStr);
  const entry = getEntry(dateStr) || {};

  // Smart defaults: use previous day's timeIn if no existing entry
  const prevEntry = entry.timeIn ? null : getPrevEntryWithTime(dateStr);
  const defaultTimeIn = entry.timeIn || (prevEntry ? prevEntry.timeIn : '09:00');
  const defaultTimeOut = entry.timeOut || snapTo15(addMinsToTime(defaultTimeIn, 9 * 60));

  document.getElementById('logTimeIn').value  = defaultTimeIn;
  document.getElementById('logTimeOut').value = defaultTimeOut;
  document.getElementById('logLunch').value   = entry.lunchMins || (prevEntry ? prevEntry.lunchMins : 60);
  document.getElementById('logHoliday').checked = entry.isHoliday || false;

  // Reset preview detail
  document.getElementById('previewDetail').style.display = 'none';
  if (typeof previewDetailOpen !== 'undefined') previewDetailOpen = false;
  const hint = document.querySelector('.log-preview-hint');
  if (hint) hint.textContent = ' · tap for detail ▾';

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

  // Hide all detail rows first
  ['pdRegular','pdOT','pdHoliday'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('pdTotal').textContent = '—';

  const s = currentProfile.settings;

  // Holiday with no times: show pay based on standard day
  if (isHoliday && (!tIn || !tOut)) {
    const netHrs = s.otThresholdHrs || 8;
    const holidayPay = netHrs * (s.holidayRate || 0);
    el.textContent = `${netHrs}h (full day)  ·  ${fmtYen(holidayPay)}`;
    document.getElementById('pdHoliday').style.display = 'flex';
    document.getElementById('pdHolidayVal').textContent = `${netHrs}h × ${fmtYen(s.holidayRate||0)}/hr = ${fmtYen(holidayPay)}`;
    document.getElementById('pdTotal').textContent = fmtYen(holidayPay);
    return;
  }

  if (!tIn || !tOut) { el.textContent = '—'; return; }
  const totalMins = toMins(tOut) - toMins(tIn) - lunchMins;
  if (totalMins <= 0) { el.textContent = 'Invalid times'; return; }
  const netHrs = totalMins / 60;

  if (isHoliday && currentProfile.mode === 'monthly') {
    // Monthly holiday: holiday pay (extra) + OT if beyond threshold
    const thresh      = s.otThresholdHrs || 8;
    const otHrs       = Math.max(0, netHrs - thresh);
    const regHrs      = netHrs - otHrs;
    const holidayPay  = netHrs * (s.holidayRate || 0);
    const otPay       = otHrs  * (s.otRate      || 0);
    const total       = holidayPay + otPay;
    el.textContent = `${fmtHrs(netHrs)}  ·  Holiday + OT ${fmtYen(total)}`;
    document.getElementById('pdHoliday').style.display = 'flex';
    document.getElementById('pdHolidayVal').textContent = `${fmtHrs(netHrs)} × ${fmtYen(s.holidayRate||0)}/hr = ${fmtYen(holidayPay)} (extra on base)`;
    document.getElementById('pdRegular').style.display = 'flex';
    document.getElementById('pdRegularVal').textContent = `${fmtHrs(regHrs)} (base salary covers)`;
    if (otHrs > 0) {
      document.getElementById('pdOT').style.display = 'flex';
      document.getElementById('pdOTVal').textContent = `${fmtHrs(otHrs)} × ${fmtYen(s.otRate||0)}/hr = ${fmtYen(otPay)}`;
    }
    document.getElementById('pdTotal').textContent = fmtYen(total);

  } else if (isHoliday) {
    // Hourly holiday: fully paid at holiday rate
    const rate = s.holidayRate || 0;
    const pay  = netHrs * rate;
    el.textContent = `${fmtHrs(netHrs)}  ·  ${fmtYen(pay)}`;
    document.getElementById('pdHoliday').style.display = 'flex';
    document.getElementById('pdHolidayVal').textContent = `${fmtHrs(netHrs)} × ${fmtYen(rate)}/hr = ${fmtYen(pay)}`;
    document.getElementById('pdTotal').textContent = fmtYen(pay);

  } else if (currentProfile.mode === 'monthly') {
    // Monthly normal day: base covers regular hrs, OT is extra
    const thresh = s.otThresholdHrs || 8;
    const otHrs  = Math.max(0, netHrs - thresh);
    const regHrs = netHrs - otHrs;
    const otPay  = otHrs * (s.otRate || 0);
    el.textContent = `${fmtHrs(netHrs)}  ·  OT ${fmtHrs(otHrs)}  ·  ${fmtYen(otPay)}`;
    document.getElementById('pdRegular').style.display = 'flex';
    document.getElementById('pdRegularVal').textContent = `${fmtHrs(regHrs)} (base salary covers)`;
    if (otHrs > 0) {
      document.getElementById('pdOT').style.display = 'flex';
      document.getElementById('pdOTVal').textContent = `${fmtHrs(otHrs)} × ${fmtYen(s.otRate||0)}/hr = ${fmtYen(otPay)}`;
    }
    document.getElementById('pdTotal').textContent = fmtYen(otPay);

  } else {
    const thresh  = s.otThresholdHrs || 8;
    const otHrs   = Math.max(0, netHrs - thresh);
    const regHrs  = netHrs - otHrs;
    const regPay  = regHrs * (s.normalRate || 0);
    const otPay   = otHrs  * (s.otRate     || 0);
    const total   = regPay + otPay;
    el.textContent = `${fmtHrs(netHrs)}  ·  OT ${fmtHrs(otHrs)}  ·  ${fmtYen(total)}`;
    // Detail
    document.getElementById('pdRegular').style.display = 'flex';
    document.getElementById('pdRegularVal').textContent = `${fmtHrs(regHrs)} × ${fmtYen(s.normalRate||0)}/hr = ${fmtYen(regPay)}`;
    if (otHrs > 0) {
      document.getElementById('pdOT').style.display = 'flex';
      document.getElementById('pdOTVal').textContent = `${fmtHrs(otHrs)} × ${fmtYen(s.otRate||0)}/hr = ${fmtYen(otPay)}`;
    }
    document.getElementById('pdTotal').textContent = fmtYen(total);
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
    rows.push({ label: 'Base Salary',  hours: null,        amount: baseSalary, color: 'var(--blue)' });
    rows.push({ label: 'OT Pay',       hours: otHrs,       amount: otPay,      color: 'var(--amber)', rate: currentProfile.settings.otRate });
    rows.push({ label: 'Holiday Pay',  hours: holidayHrs,  amount: holidayPay, color: 'var(--red)',   rate: currentProfile.settings.holidayRate });
  } else {
    rows.push({ label: 'Regular Pay', hours: regularHrs, amount: regularPay, color: 'var(--green)', rate: currentProfile.settings.normalRate });
    rows.push({ label: 'OT Pay',      hours: otHrs,      amount: otPay,      color: 'var(--amber)', rate: currentProfile.settings.otRate });
    rows.push({ label: 'Holiday Pay', hours: holidayHrs, amount: holidayPay, color: 'var(--red)',   rate: currentProfile.settings.holidayRate });
  }

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
   RENDER: SETTINGS (profile - handled in inline script)
   RATES & THEME: handled in inline script
═══════════════════════════════════════ */
// renderSettings, renderRates, renderTheme, saveRates, saveTheme defined in inline script

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
