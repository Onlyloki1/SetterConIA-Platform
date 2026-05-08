// ── State ──
let currentUser = null;
let allModules = [];
let currentModuleId = null;
let currentLessons = [];

// ── Init ──
async function init() {
  try {
    const res = await fetch('/api/auth/me');
    currentUser = await res.json();
    if (currentUser.role === 'admin') return window.location.href = '/admin.html';
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('welcomeName').textContent = currentUser.name.split(' ')[0];
    loadHome();
    loadNotifications();
    // Poll notifications every 60 seconds
    setInterval(loadNotificationCount, 60000);
  } catch {
    window.location.href = '/login.html';
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ── Views ──
function showView(id) {
  document.querySelectorAll('[id^="view-"]').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + id).classList.remove('hidden');
  window.scrollTo(0, 0);
}

function switchTab(tab) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll(`.sidebar-link[data-tab="${tab}"]`).forEach(l => l.classList.add('active'));
  document.querySelectorAll('.mobile-nav button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.mobile-nav button[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));

  if (tab === 'home') { showView('home'); loadHome(); }
  else if (tab === 'modules') { showView('modules'); loadModules(); }
  else if (tab === 'resources') { showView('resources'); loadResources(); }
}

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', () => switchTab(link.dataset.tab));
});

function goBack() {
  showView('modules');
  switchTab('modules');
}

// ── Toast ──
function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── HOME ──
async function loadHome() {
  try {
    const [modulesRes, progressRes] = await Promise.all([
      fetch('/api/client/modules').then(r => r.json()),
      fetch('/api/client/progress').then(r => r.json())
    ]);
    allModules = modulesRes;
    const total = parseInt(progressRes.total) || 0;
    const done = parseInt(progressRes.completed) || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card">
        <div class="stat-value" style="color:var(--accent);">${pct}%</div>
        <div class="stat-label">Progreso total</div>
        <div class="progress-bar" style="margin-top:12px;"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${done}<span style="font-size:16px;color:var(--text-muted);font-weight:400;">/${total}</span></div>
        <div class="stat-label">Lecciones completadas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${allModules.length}</div>
        <div class="stat-label">Módulos disponibles</div>
      </div>
    `;

    renderModuleCards('homeModules', allModules);
  } catch (err) { toast(err.message, 'error'); }
}

// ── MODULES ──
async function loadModules() {
  try {
    allModules = await fetch('/api/client/modules').then(r => r.json());
    renderModuleCards('modulesGrid', allModules);
  } catch (err) { toast(err.message, 'error'); }
}

function renderModuleCards(containerId, modules) {
  const container = document.getElementById(containerId);
  container.innerHTML = modules.map((m, i) => {
    const total = parseInt(m.total_lessons) || 0;
    const done = parseInt(m.completed_lessons) || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const coverStyle = m.cover_image
      ? `background-image:url('${esc(m.cover_image)}')`
      : `background:linear-gradient(135deg, #0a1929 0%, #1D4A72 100%)`;
    const moduleNum = String(i + 1).padStart(2, '0');
    return `
      <div class="module-card" onclick="openModule(${m.id})">
        <div class="module-cover" style="${coverStyle}">
          <div class="module-cover-badge">M\u00f3dulo ${moduleNum}</div>
          <div class="module-cover-overlay">
            <div class="module-cover-title">${esc(m.title)}</div>
          </div>
        </div>
        <div class="module-body">
          <div class="module-title">${esc(m.title)}</div>
          <div class="module-desc">${esc(m.description || '')}</div>
          <div class="module-meta">
            <span>${total} lecciones</span>
            <span style="color:var(--accent);font-weight:600;">${pct}%</span>
          </div>
          <div class="module-progress-bar"><div class="module-progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }).join('');
}

// ── MODULE DETAIL (Skool-style: sidebar + content) ──
let activeLessonId = null;

async function openModule(id) {
  currentModuleId = id;
  activeLessonId = null;
  const mod = allModules.find(m => m.id === id);
  if (!mod) return;

  document.getElementById('moduleTitle').textContent = mod.title.toUpperCase();
  showView('lessons');

  try {
    currentLessons = await fetch(`/api/client/modules/${id}/lessons`).then(r => r.json());
    const total = currentLessons.length;
    const done = currentLessons.filter(l => l.completed).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    document.getElementById('moduleProgress').style.width = pct + '%';
    document.getElementById('moduleProgressText').textContent = `${done}/${total} completadas`;

    renderLessonSidebar();

    // Reset content area
    document.getElementById('lessonTitle').textContent = 'Seleccioná una lección';
    document.getElementById('lessonDesc').textContent = '';
    document.getElementById('lessonCompletedTag').innerHTML = '';
    document.getElementById('lessonActions').innerHTML = '';
    document.getElementById('lessonContent').innerHTML = `
      <div class="course-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        <p>Elegí una lección del panel izquierdo para empezar</p>
      </div>`;

    // Auto-open first incomplete lesson
    const firstIncomplete = currentLessons.find(l => !l.completed);
    if (firstIncomplete) openLesson(firstIncomplete.id);
    else if (currentLessons.length > 0) openLesson(currentLessons[0].id);
  } catch (err) { toast(err.message, 'error'); }
}

function renderLessonSidebar() {
  const sidebar = document.getElementById('lessonsSidebar');
  sidebar.innerHTML = currentLessons.map(l => `
    <div class="course-lesson-item ${l.completed ? 'done' : ''} ${l.id === activeLessonId ? 'active' : ''}"
         onclick="openLesson(${l.id})" id="sidebar-lesson-${l.id}">
      <div class="cl-check ${l.completed ? 'done' : ''}">
        ${l.completed ? '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </div>
      <div class="cl-info">
        <div class="cl-title">${esc(l.title)}</div>
        <div class="cl-meta">
          <span>${typeLabel(l.content_type)}</span>
          ${l.duration ? `<span>${esc(l.duration)}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function typeLabel(type) {
  if (type === 'video') return '▶ Video';
  if (type === 'pdf') return '📄 PDF';
  return '🔗 Link';
}

// ── LESSON VIEWER (loads in right panel) ──
function openLesson(id) {
  const lesson = currentLessons.find(l => l.id === id);
  if (!lesson) return;
  activeLessonId = id;

  // Update sidebar active state
  document.querySelectorAll('.course-lesson-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.getElementById('sidebar-lesson-' + id);
  if (activeEl) activeEl.classList.add('active');

  document.getElementById('lessonTitle').textContent = lesson.title;
  document.getElementById('lessonDesc').textContent = lesson.description || '';

  // Completed tag
  document.getElementById('lessonCompletedTag').innerHTML = lesson.completed
    ? '<div class="completed-tag" style="margin-top:12px;display:inline-flex;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Completada</div>'
    : '';

  // Content
  const contentEl = document.getElementById('lessonContent');
  if (lesson.content_type === 'video') {
    contentEl.innerHTML = `
      <div class="video-protected" id="videoProtected">
        <div class="video-protected-overlay"></div>
        <iframe id="videoFrame" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>
        <div class="video-protected-shield"></div>
      </div>`;
    loadProtectedVideo(lesson.id);
  } else if (lesson.content_type === 'pdf') {
    contentEl.innerHTML = `
      <div class="viewer viewer-pdf" style="border:1px solid rgba(55,140,216,0.2);">
        <iframe src="${esc(lesson.content_url)}#toolbar=1&navpanes=0"></iframe>
      </div>`;
  } else {
    contentEl.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <p style="margin-bottom:16px;color:var(--text-fade);">Este contenido se abre en una nueva pestaña</p>
        <a href="${esc(lesson.content_url)}" target="_blank" rel="noopener" class="btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Abrir Link
        </a>
      </div>`;
  }

  // Actions
  document.getElementById('lessonActions').innerHTML = `
    <div style="display:flex;gap:12px;margin-top:16px;">
      <button class="btn btn-sm ${lesson.completed ? 'btn-ghost' : ''}" onclick="toggleComplete(${lesson.id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        ${lesson.completed ? 'Desmarcar' : 'Completar'}
      </button>
      ${lesson.content_type === 'pdf' ? `
        <a href="${esc(lesson.content_url)}" download class="btn btn-sm btn-ghost">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Descargar
        </a>` : ''}
    </div>
  `;
}

// ── Protected video loader ──
// Fetches a signed token from the proxy, then loads video through our server
// The client NEVER sees the real Loom/YouTube URL
async function loadProtectedVideo(lessonId) {
  try {
    const res = await fetch(`/api/proxy/video/${lessonId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const frame = document.getElementById('videoFrame');
    frame.src = `/api/proxy/embed/${data.token}`;
  } catch (err) {
    document.getElementById('videoProtected').innerHTML = `
      <div class="card" style="text-align:center;padding:48px;">
        <p style="color:var(--red);">Error al cargar el video. Recargá la página.</p>
      </div>`;
  }
}

// Block right-click on video area
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.video-protected')) e.preventDefault();
});

async function toggleComplete(lessonId) {
  try {
    await fetch(`/api/client/progress/${lessonId}`, { method: 'POST' });
    // Refresh lesson data + sidebar + progress bar
    currentLessons = await fetch(`/api/client/modules/${currentModuleId}/lessons`).then(r => r.json());
    const total = currentLessons.length;
    const done = currentLessons.filter(l => l.completed).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('moduleProgress').style.width = pct + '%';
    document.getElementById('moduleProgressText').textContent = `${done}/${total} completadas`;
    renderLessonSidebar();
    openLesson(lessonId);
    toast('Progreso actualizado');
  } catch (err) { toast(err.message, 'error'); }
}

// ── RESOURCES ──
async function loadResources() {
  try {
    const resources = await fetch('/api/client/resources').then(r => r.json());
    document.getElementById('resourcesGrid').innerHTML = resources.map(r => {
      const isPdf = r.resource_type === 'pdf';
      return `
        <a href="${esc(r.file_url)}" target="${isPdf ? '_self' : '_blank'}" ${isPdf ? 'download' : 'rel="noopener"'} class="resource-card" style="text-decoration:none;color:inherit;">
          <div class="resource-icon ${isPdf ? 'pdf-icon' : 'link-icon'}">
            ${isPdf
              ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
              : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
            }
          </div>
          <div>
            <div class="resource-title">${esc(r.title)}</div>
            <div class="resource-desc">${esc(r.description || (isPdf ? 'Documento PDF' : 'Link externo'))}</div>
          </div>
        </a>`;
    }).join('');
    if (resources.length === 0) {
      document.getElementById('resourcesGrid').innerHTML = `
        <div class="card" style="text-align:center;padding:48px;grid-column:1/-1;">
          <p style="color:var(--text-muted);">Todavía no hay recursos disponibles.</p>
        </div>`;
    }
  } catch (err) { toast(err.message, 'error'); }
}

// ── NOTIFICATIONS ──
let notifOpen = false;

async function loadNotifications() {
  try {
    const notifs = await fetch('/api/client/notifications').then(r => r.json());
    const list = document.getElementById('notifList');

    if (notifs.length === 0) {
      list.innerHTML = '<div class="notif-empty">No tenés notificaciones</div>';
    } else {
      list.innerHTML = notifs.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead(${n.id}, this)">
          <div class="notif-dot ${n.read ? 'read' : ''}"></div>
          <div class="notif-item-content">
            <div class="notif-item-title">${esc(n.title)}</div>
            ${n.message ? `<div class="notif-item-msg">${esc(n.message)}</div>` : ''}
            <div class="notif-item-time">${timeAgo(n.created_at)}</div>
          </div>
        </div>
      `).join('');
    }

    loadNotificationCount();
  } catch (err) { console.error('Notif error:', err); }
}

async function loadNotificationCount() {
  try {
    const data = await fetch('/api/client/notifications/unread-count').then(r => r.json());
    const badge = document.getElementById('notifBadge');
    if (data.count > 0) {
      badge.textContent = data.count > 99 ? '99+' : data.count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* silent */ }
}

function toggleNotifPanel() {
  notifOpen = !notifOpen;
  document.getElementById('notifPanel').classList.toggle('hidden', !notifOpen);
  document.getElementById('notifOverlay').classList.toggle('hidden', !notifOpen);
  if (notifOpen) loadNotifications();
}

async function markNotifRead(id, el) {
  try {
    await fetch(`/api/client/notifications/${id}/read`, { method: 'POST' });
    el.classList.remove('unread');
    el.querySelector('.notif-dot').classList.add('read');
    loadNotificationCount();
  } catch { /* silent */ }
}

async function markAllRead() {
  try {
    await fetch('/api/client/notifications/read-all', { method: 'POST' });
    document.querySelectorAll('.notif-item').forEach(el => {
      el.classList.remove('unread');
      el.querySelector('.notif-dot')?.classList.add('read');
    });
    loadNotificationCount();
  } catch { /* silent */ }
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Hace ${days}d`;
  return new Date(dateStr).toLocaleDateString('es-AR');
}

// ── Helpers ──
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Start ──
init();
