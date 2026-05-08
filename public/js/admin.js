// ── State ──
let currentUser = null;
let modules = [];
let plans = [];
let softwares = [];
let editingId = null;

// ── Init ──
async function init() {
  try {
    const res = await fetch('/api/auth/me');
    currentUser = await res.json();
    if (currentUser.role !== 'admin') return window.location.href = '/dashboard.html';
    document.getElementById('userName').textContent = currentUser.name;
    loadUsers();
    loadModulesData();
    loadResources();
    loadProgress();
    loadPlans();
    loadSoftwares();
  } catch {
    window.location.href = '/login.html';
  }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ── Tabs ──
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll(`.sidebar-link[data-tab="${tab}"]`).forEach(l => l.classList.add('active'));
  document.querySelectorAll('.mobile-nav button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.mobile-nav button[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));

  if (tab === 'lessons') loadLessons();
  if (tab === 'progress') loadProgress();
  if (tab === 'approvals') loadApprovals();
  if (tab === 'calls') loadCalls();
}

document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', () => switchTab(link.dataset.tab));
});

// ── Toast ──
function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type + ' show';
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── API helper ──
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// ── Modal ──
async function openModal(type, data = null) {
  editingId = data ? data.id : null;
  const modal = document.getElementById('modalContent');
  const overlay = document.getElementById('modalOverlay');

  if (type === 'user') modal.innerHTML = await userForm(data);
  else if (type === 'module') modal.innerHTML = moduleForm(data);
  else if (type === 'lesson') modal.innerHTML = lessonForm(data);
  else if (type === 'resource') modal.innerHTML = resourceForm(data);
  else if (type === 'plan') modal.innerHTML = planForm(data);
  else if (type === 'software') modal.innerHTML = softwareForm(data);

  overlay.classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  editingId = null;
}

// ── USERS ──
async function loadUsers() {
  try {
    const users = await api('/api/admin/users');
    const tbody = document.getElementById('usersTable');
    tbody.innerHTML = users.map(u => {
      let expiryHtml = '-';
      if (u.expires_at) {
        const exp = new Date(u.expires_at);
        const days = Math.ceil((exp - new Date()) / (1000*60*60*24));
        if (days < 0) expiryHtml = `<span style="color:#e74c3c;font-weight:600;">Expirado</span>`;
        else if (days <= 7) expiryHtml = `<span style="color:#f59e0b;">${exp.toLocaleDateString('es-AR')} (${days}d)</span>`;
        else expiryHtml = `${exp.toLocaleDateString('es-AR')} <span style="color:rgba(255,255,255,0.3);">(${days}d)</span>`;
      }
      return `<tr>
        <td style="color:#fff;font-weight:600;">${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-client'}">${u.role}</span></td>
        <td>${u.plan_name ? esc(u.plan_name) : '<span style="color:#666;">Sin plan</span>'}</td>
        <td>${expiryHtml}</td>
        <td>${u.onboarding_completed ? '<span style="color:#25D366;">✓</span>' : '<span style="color:#f59e0b;">Pendiente</span>'}</td>
        <td>${new Date(u.created_at).toLocaleDateString('es-AR')}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-ghost" onclick='openModal("user", ${JSON.stringify(u)})'>Editar</button>
            ${u.role !== 'admin' ? `<button class="btn btn-sm" style="background:#2563eb;" onclick="resendWelcome(${u.id})" title="Reenviar email de bienvenida">📧</button>` : ''}
            ${u.role !== 'admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">Eliminar</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

let userCreds = {}; // {softwareId: {username, password, extra_info, links, enabled}}
let userSwLinks = {}; // {softwareId: [{name, url}]}

async function userForm(data) {
  userCreds = {};
  userSwLinks = {};
  if (data) {
    try {
      const creds = await api(`/api/admin/credentials/${data.id}`);
      creds.forEach(c => {
        userCreds[c.software_id] = { username: c.username||'', password: c.password||'', extra_info: c.extra_info||'', enabled: true };
        let lnks = c.links || [];
        if (typeof lnks === 'string') lnks = JSON.parse(lnks);
        userSwLinks[c.software_id] = Array.isArray(lnks) ? lnks : [];
      });
    } catch {}
  }

  const swCheckboxes = softwares.map(s => {
    const c = userCreds[s.id];
    const checked = c ? 'checked' : '';
    const show = c ? '' : 'display:none;';
    if (!userSwLinks[s.id]) userSwLinks[s.id] = [];
    return `
      <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:14px;margin-bottom:8px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:8px;">
          <input type="checkbox" class="sw-check" value="${s.id}" ${checked} onchange="toggleSwCreds(${s.id})" style="width:18px;height:18px;">
          <span style="font-weight:700;">${s.icon} ${esc(s.name)}</span>
        </label>
        <div id="sw-creds-${s.id}" style="${show}display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;gap:8px;">
            <input class="input" placeholder="Usuario" id="sw-user-${s.id}" value="${c?esc(c.username):''}" style="flex:1;">
            <input class="input" placeholder="Contraseña" id="sw-pass-${s.id}" value="${c?esc(c.password):''}" style="flex:1;">
          </div>
          <input class="input" placeholder="Info extra (opcional)" id="sw-extra-${s.id}" value="${c?esc(c.extra_info):''}">
          <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;margin-top:4px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:rgba(255,255,255,0.4);">Links del cliente</span>
              <button type="button" class="btn btn-sm" style="font-size:10px;padding:3px 8px;" onclick="addUserSwLink(${s.id})">+ Link</button>
            </div>
            <div id="sw-links-${s.id}">${renderUserSwLinks(s.id)}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <h2 class="modal-title">${data ? 'Editar' : 'Nuevo'} Usuario</h2>
    <form onsubmit="saveUser(event)" style="display:flex;flex-direction:column;gap:16px;max-height:75vh;overflow-y:auto;padding-right:4px;">
      <div class="field"><label class="label">Nombre</label><input class="input" id="f-name" value="${data ? esc(data.name) : ''}" required></div>
      <div class="field"><label class="label">Email</label><input class="input" type="email" id="f-email" value="${data ? esc(data.email) : ''}" required></div>
      <div class="field"><label class="label">Contraseña ${data ? '(dejar vacío para no cambiar)' : '(vacío = se genera automática)'}</label><input class="input" id="f-password" value="" placeholder="${data ? 'Dejar vacío para mantener' : 'Ej: Smart123 o dejar vacío'}"></div>
      <div class="field"><label class="label">Rol</label>
        <select class="select" id="f-role">
          <option value="client" ${data?.role === 'client' ? 'selected' : ''}>Cliente</option>
          <option value="admin" ${data?.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="field"><label class="label">Plan</label>
        <select class="select" id="f-plan">
          <option value="">Sin plan</option>
          ${plans.map(p => `<option value="${p.id}" ${data?.plan_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
      ${softwares.length ? `
      <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;">
        <label class="label" style="margin-bottom:12px;">Softwares & Credenciales</label>
        ${swCheckboxes}
      </div>` : ''}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>`;
}

function toggleSwCreds(swId) {
  const box = document.getElementById('sw-creds-' + swId);
  const check = document.querySelector(`.sw-check[value="${swId}"]`);
  box.style.display = check.checked ? 'flex' : 'none';
  // Auto-add "Panel" link if checking for first time and no links exist
  if (check.checked && (!userSwLinks[swId] || !userSwLinks[swId].length)) {
    userSwLinks[swId] = [{ name: 'Panel', url: '' }];
    document.getElementById('sw-links-' + swId).innerHTML = renderUserSwLinks(swId);
  }
}

function renderUserSwLinks(swId) {
  const links = userSwLinks[swId] || [];
  if (!links.length) return '<div style="font-size:11px;color:rgba(255,255,255,0.25);">Sin links para este cliente.</div>';
  return links.map((l, i) => {
    const isCopy = l.copyMode;
    const btnStyle = isCopy
      ? 'background:#25D366;color:#fff;border:none;'
      : 'background:transparent;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);';
    return `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
      <input class="input" placeholder="Nombre" value="${esc(l.name||'')}" data-swlink="${swId}" data-li="${i}" data-lf="name" style="flex:1;font-size:12px;padding:6px 10px;">
      <input class="input" placeholder="https://..." value="${esc(l.url||'')}" data-swlink="${swId}" data-li="${i}" data-lf="url" style="flex:2;font-size:12px;padding:6px 10px;">
      <button type="button" class="btn btn-sm" onclick="toggleCopyMode(${swId},${i})" style="padding:4px 8px;font-size:10px;${btnStyle}border-radius:6px;cursor:pointer;" title="${isCopy?'Click = copiar URL':'Click = abrir URL'}">📋</button>
      <button type="button" class="btn btn-sm btn-danger" onclick="removeUserSwLink(${swId},${i})" style="padding:4px 8px;font-size:10px;">✕</button>
    </div>`;
  }).join('');
}

function toggleCopyMode(swId, idx) {
  if (!userSwLinks[swId] || !userSwLinks[swId][idx]) return;
  userSwLinks[swId][idx].copyMode = !userSwLinks[swId][idx].copyMode;
  document.getElementById('sw-links-' + swId).innerHTML = renderUserSwLinks(swId);
  toast(userSwLinks[swId][idx].copyMode ? 'El cliente copiará esta URL al hacer click' : 'El cliente abrirá esta URL al hacer click');
}

function addUserSwLink(swId) {
  if (!userSwLinks[swId]) userSwLinks[swId] = [];
  userSwLinks[swId].push({ name: '', url: '' });
  document.getElementById('sw-links-' + swId).innerHTML = renderUserSwLinks(swId);
}

function removeUserSwLink(swId, idx) {
  userSwLinks[swId].splice(idx, 1);
  document.getElementById('sw-links-' + swId).innerHTML = renderUserSwLinks(swId);
}

function readUserSwLinks(swId) {
  const els = document.querySelectorAll(`[data-swlink="${swId}"]`);
  const links = userSwLinks[swId] || [];
  els.forEach(el => {
    const i = parseInt(el.dataset.li);
    const f = el.dataset.lf;
    if (links[i]) links[i][f] = el.value;
  });
  return links.filter(l => l.name && l.url).map(l => ({ name: l.name, url: l.url, copyMode: !!l.copyMode }));
}

async function saveUser(e) {
  e.preventDefault();
  const body = {
    name: document.getElementById('f-name').value,
    email: document.getElementById('f-email').value,
    role: document.getElementById('f-role').value,
    plan_id: document.getElementById('f-plan').value || null,
  };
  const pw = document.getElementById('f-password').value;
  if (pw) body.password = pw;

  let createdUser = null;
  try {
    let userId = editingId;
    if (editingId) {
      await api(`/api/admin/users/${editingId}`, { method: 'PUT', body });
    } else {
      createdUser = await api('/api/admin/users', { method: 'POST', body });
      userId = createdUser.id;
    }

    // Save software credentials
    if (userId && softwares.length) {
      const checks = document.querySelectorAll('.sw-check');
      // First delete all existing credentials for this user
      await api(`/api/admin/credentials/${userId}/clear`, { method: 'DELETE' });
      // Then save checked ones
      for (const check of checks) {
        if (check.checked) {
          const swId = parseInt(check.value);
          const username = document.getElementById('sw-user-' + swId).value;
          const password = document.getElementById('sw-pass-' + swId).value;
          const extra_info = document.getElementById('sw-extra-' + swId).value;
          const links = readUserSwLinks(swId);
          await api('/api/admin/credentials', { method: 'POST', body: { user_id: userId, software_id: swId, username, password, extra_info, links } });
        }
      }
    }

    closeModal(); loadUsers();
    if (editingId) {
      toast('Usuario actualizado');
    } else {
      const pw = createdUser?.generatedPassword;
      toast(pw ? 'Usuario creado — Pass: ' + pw + ' (email enviado)' : 'Usuario creado');
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function resendWelcome(id) {
  if (!confirm('¿Reenviar email de bienvenida? Se genera una nueva contraseña.')) return;
  try {
    const result = await api(`/api/admin/users/${id}/resend-welcome`, { method: 'POST' });
    toast('Email reenviado. Nueva contraseña: ' + result.password);
    loadUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteUser(id) {
  if (!confirm('¿Eliminar este usuario?')) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    loadUsers(); toast('Usuario eliminado');
  } catch (err) { toast(err.message, 'error'); }
}

// ── MODULES ──
async function loadModulesData() {
  try {
    modules = await api('/api/admin/modules');
    const tbody = document.getElementById('modulesTable');
    tbody.innerHTML = modules.map(m => `
      <tr>
        <td>${m.order_position}</td>
        <td style="font-size:24px;">${m.icon}</td>
        <td style="color:#fff;font-weight:600;">${esc(m.title)}</td>
        <td>${esc(m.description || '')}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-ghost" onclick='openModal("module", ${JSON.stringify(m)})'>Editar</button>
            <button class="btn btn-sm btn-danger" onclick="deleteModule(${m.id})">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');
    // Update lesson filter
    const filter = document.getElementById('lessonModuleFilter');
    filter.innerHTML = '<option value="">Todos los módulos</option>' +
      modules.map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function moduleForm(data) {
  return `
    <h2 class="modal-title">${data ? 'Editar' : 'Nuevo'} Módulo</h2>
    <form onsubmit="saveModule(event)" style="display:flex;flex-direction:column;gap:16px;">
      <div class="field"><label class="label">Título</label><input class="input" id="f-title" value="${data ? esc(data.title) : ''}" required></div>
      <div class="field"><label class="label">Descripción</label><textarea class="textarea" id="f-desc">${data ? esc(data.description || '') : ''}</textarea></div>
      <div class="field"><label class="label">Imagen de portada (URL)</label><input class="input" id="f-cover" value="${data ? esc(data.cover_image || '') : ''}" placeholder="https://... o dejar vacío"></div>
      <div class="field"><label class="label">Icono (emoji)</label><input class="input" id="f-icon" value="${data ? data.icon : '📚'}" maxlength="4"></div>
      <div class="field"><label class="label">Orden</label><input class="input" type="number" id="f-order" value="${data ? data.order_position : modules.length + 1}"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>`;
}

async function saveModule(e) {
  e.preventDefault();
  const body = {
    title: document.getElementById('f-title').value,
    description: document.getElementById('f-desc').value,
    cover_image: document.getElementById('f-cover').value,
    icon: document.getElementById('f-icon').value,
    order_position: parseInt(document.getElementById('f-order').value),
  };
  try {
    if (editingId) await api(`/api/admin/modules/${editingId}`, { method: 'PUT', body });
    else await api('/api/admin/modules', { method: 'POST', body });
    closeModal(); loadModulesData();
    toast(editingId ? 'Módulo actualizado' : 'Módulo creado');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteModule(id) {
  if (!confirm('¿Eliminar este módulo y todas sus lecciones?')) return;
  try {
    await api(`/api/admin/modules/${id}`, { method: 'DELETE' });
    loadModulesData(); toast('Módulo eliminado');
  } catch (err) { toast(err.message, 'error'); }
}

// ── LESSONS ──
async function loadLessons() {
  const moduleId = document.getElementById('lessonModuleFilter').value;
  try {
    const url = moduleId ? `/api/admin/lessons?module_id=${moduleId}` : '/api/admin/lessons';
    const lessons = await api(url);
    const tbody = document.getElementById('lessonsTable');
    tbody.innerHTML = lessons.map(l => {
      const mod = modules.find(m => m.id === l.module_id);
      return `
        <tr>
          <td>${l.order_position}</td>
          <td style="color:#fff;font-weight:600;">${esc(l.title)}</td>
          <td><span class="badge ${l.content_type === 'video' ? 'badge-admin' : 'badge-client'}">${l.content_type}</span></td>
          <td>${mod ? esc(mod.title) : '-'}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(l.content_url)}</td>
          <td>
            <div class="flex gap-8">
              <button class="btn btn-sm btn-ghost" onclick='openModal("lesson", ${JSON.stringify(l)})'>Editar</button>
              <button class="btn btn-sm btn-danger" onclick="deleteLesson(${l.id})">Eliminar</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function lessonForm(data) {
  const modOpts = modules.map(m =>
    `<option value="${m.id}" ${data?.module_id === m.id ? 'selected' : ''}>${esc(m.title)}</option>`
  ).join('');

  return `
    <h2 class="modal-title">${data ? 'Editar' : 'Nueva'} Lección</h2>
    <form onsubmit="saveLesson(event)" style="display:flex;flex-direction:column;gap:16px;">
      <div class="field"><label class="label">Módulo</label>
        <select class="select" id="f-module" required>${modOpts}</select>
      </div>
      <div class="field"><label class="label">Título</label><input class="input" id="f-title" value="${data ? esc(data.title) : ''}" required></div>
      <div class="field"><label class="label">Descripción</label><textarea class="textarea" id="f-desc">${data ? esc(data.description || '') : ''}</textarea></div>
      <div class="field"><label class="label">Tipo de contenido</label>
        <select class="select" id="f-type" onchange="toggleUpload()">
          <option value="video" ${data?.content_type === 'video' ? 'selected' : ''}>Video (Loom, YouTube, etc)</option>
          <option value="pdf" ${data?.content_type === 'pdf' ? 'selected' : ''}>PDF</option>
          <option value="link" ${data?.content_type === 'link' ? 'selected' : ''}>Link externo</option>
        </select>
      </div>
      <div class="field" id="urlField">
        <label class="label">URL del contenido</label>
        <input class="input" id="f-url" value="${data ? esc(data.content_url) : ''}" placeholder="https://www.loom.com/share/..." required>
      </div>
      <div class="field" id="uploadField" style="display:none;">
        <label class="label">O subir PDF</label>
        <input type="file" accept=".pdf" id="f-file" class="input" onchange="uploadPdf()">
        <div id="uploadStatus" style="font-size:12px;color:var(--text-muted);margin-top:4px;"></div>
      </div>
      <div class="field"><label class="label">Thumbnail (URL imagen)</label><input class="input" id="f-thumb" value="${data ? esc(data.thumbnail || '') : ''}" placeholder="https://... o dejar vacío"></div>
      <div class="field"><label class="label">Duración</label><input class="input" id="f-duration" value="${data ? esc(data.duration || '') : ''}" placeholder="ej: 12:30"></div>
      <div class="field"><label class="label">Orden</label><input class="input" type="number" id="f-order" value="${data ? data.order_position : '1'}"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>`;
}

function toggleUpload() {
  const type = document.getElementById('f-type').value;
  document.getElementById('uploadField').style.display = type === 'pdf' ? 'block' : 'none';
}

async function uploadPdf() {
  const file = document.getElementById('f-file').files[0];
  if (!file) return;
  const status = document.getElementById('uploadStatus');
  status.textContent = 'Subiendo...';
  const form = new FormData();
  form.append('pdf', file);
  try {
    const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('f-url').value = data.url;
    status.textContent = 'PDF subido correctamente';
    status.style.color = '#25D366';
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    status.style.color = '#E07070';
  }
}

async function saveLesson(e) {
  e.preventDefault();
  const body = {
    module_id: parseInt(document.getElementById('f-module').value),
    title: document.getElementById('f-title').value,
    description: document.getElementById('f-desc').value,
    content_type: document.getElementById('f-type').value,
    content_url: document.getElementById('f-url').value,
    thumbnail: document.getElementById('f-thumb').value,
    duration: document.getElementById('f-duration').value,
    order_position: parseInt(document.getElementById('f-order').value),
  };
  try {
    if (editingId) await api(`/api/admin/lessons/${editingId}`, { method: 'PUT', body });
    else await api('/api/admin/lessons', { method: 'POST', body });
    closeModal(); loadLessons();
    toast(editingId ? 'Lección actualizada' : 'Lección creada');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteLesson(id) {
  if (!confirm('¿Eliminar esta lección?')) return;
  try {
    await api(`/api/admin/lessons/${id}`, { method: 'DELETE' });
    loadLessons(); toast('Lección eliminada');
  } catch (err) { toast(err.message, 'error'); }
}

// ── RESOURCES ──
async function loadResources() {
  try {
    const resources = await api('/api/admin/resources');
    const tbody = document.getElementById('resourcesTable');
    tbody.innerHTML = resources.map(r => `
      <tr>
        <td style="color:#fff;font-weight:600;">${esc(r.title)}</td>
        <td><span class="badge ${r.resource_type === 'pdf' ? 'badge-client' : 'badge-admin'}">${r.resource_type}</span></td>
        <td>${esc(r.description || '')}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          <a href="${esc(r.file_url)}" target="_blank" style="color:var(--blue-mid);">${esc(r.file_url)}</a>
        </td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="deleteResource(${r.id})">Eliminar</button>
        </td>
      </tr>
    `).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function resourceForm(data) {
  return `
    <h2 class="modal-title">Nuevo Recurso</h2>
    <form onsubmit="saveResource(event)" style="display:flex;flex-direction:column;gap:16px;">
      <div class="field"><label class="label">Título</label><input class="input" id="f-title" required></div>
      <div class="field"><label class="label">Descripción</label><textarea class="textarea" id="f-desc"></textarea></div>
      <div class="field"><label class="label">Tipo</label>
        <select class="select" id="f-type" onchange="toggleResourceUpload()">
          <option value="pdf">PDF</option>
          <option value="link">Link</option>
        </select>
      </div>
      <div class="field"><label class="label">URL</label>
        <input class="input" id="f-url" placeholder="https://..." required>
      </div>
      <div class="field" id="resUploadField">
        <label class="label">O subir PDF</label>
        <input type="file" accept=".pdf" id="f-file" class="input" onchange="uploadResourcePdf()">
        <div id="resUploadStatus" style="font-size:12px;color:var(--text-muted);margin-top:4px;"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>`;
}

function toggleResourceUpload() {
  const type = document.getElementById('f-type').value;
  document.getElementById('resUploadField').style.display = type === 'pdf' ? 'block' : 'none';
}

async function uploadResourcePdf() {
  const file = document.getElementById('f-file').files[0];
  if (!file) return;
  const status = document.getElementById('resUploadStatus');
  status.textContent = 'Subiendo...';
  const form = new FormData();
  form.append('pdf', file);
  try {
    const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('f-url').value = data.url;
    status.textContent = 'PDF subido correctamente';
    status.style.color = '#25D366';
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    status.style.color = '#E07070';
  }
}

async function saveResource(e) {
  e.preventDefault();
  const body = {
    title: document.getElementById('f-title').value,
    description: document.getElementById('f-desc').value,
    resource_type: document.getElementById('f-type').value,
    file_url: document.getElementById('f-url').value,
  };
  try {
    await api('/api/admin/resources', { method: 'POST', body });
    closeModal(); loadResources();
    toast('Recurso creado');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteResource(id) {
  if (!confirm('¿Eliminar este recurso?')) return;
  try {
    await api(`/api/admin/resources/${id}`, { method: 'DELETE' });
    loadResources(); toast('Recurso eliminado');
  } catch (err) { toast(err.message, 'error'); }
}

// ── PROGRESS ──
async function loadProgress() {
  try {
    const data = await api('/api/admin/progress');
    const tbody = document.getElementById('progressTable');
    tbody.innerHTML = data.map(p => {
      const total = parseInt(p.total_lessons) || 0;
      const done = parseInt(p.completed_lessons) || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return `
        <tr>
          <td style="color:#fff;font-weight:600;">${esc(p.name)}</td>
          <td>${esc(p.email)}</td>
          <td>
            <div class="flex items-center gap-12">
              <div class="progress-bar" style="width:120px;"><div class="progress-fill" style="width:${pct}%"></div></div>
              <span style="font-size:13px;font-weight:600;color:var(--accent);">${pct}%</span>
            </div>
          </td>
          <td>${done} / ${total}</td>
        </tr>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

// ── PLANS ──
async function loadPlans() {
  try {
    plans = await api('/api/admin/plans');
    const tbody = document.getElementById('plansTable');
    if (!tbody) return;
    tbody.innerHTML = plans.map(p => `
      <tr>
        <td style="color:#fff;font-weight:600;">${esc(p.name)}</td>
        <td>${p.duration_months||1} meses</td>
        <td>${esc(p.description || '')}</td>
        <td>${(p.softwares||[]).map(s => s.icon + ' ' + esc(s.name)).join(', ') || '<span style="color:#666;">Ninguno</span>'}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-ghost" onclick='openModal("plan", ${JSON.stringify(p)})'>Editar</button>
            <button class="btn btn-sm" style="background:#1a5a2e;" onclick="openPlanSoftwaresModal(${p.id})">Softwares</button>
            <button class="btn btn-sm btn-danger" onclick="deletePlan(${p.id})">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function planForm(data) {
  const allowedMods = data?.allowed_modules ? (typeof data.allowed_modules==='string'?JSON.parse(data.allowed_modules):data.allowed_modules) : [];
  const assignedSwIds = data?.softwares ? data.softwares.map(s=>s.id) : [];
  return `
    <h2 class="modal-title">${data ? 'Editar' : 'Nuevo'} Plan</h2>
    <form onsubmit="savePlan(event)" style="display:flex;flex-direction:column;gap:16px;max-height:75vh;overflow-y:auto;padding-right:4px;">
      <div class="field"><label class="label">Nombre</label><input class="input" id="f-name" value="${data ? esc(data.name) : ''}" required placeholder="Ej: Premium 6 meses"></div>
      <div class="field"><label class="label">Duracion (meses)</label><input class="input" type="number" id="f-duration" value="${data ? (data.duration_months||1) : 1}" min="1" max="36" required></div>
      <div class="field"><label class="label">Descripcion</label><textarea class="textarea" id="f-desc">${data ? esc(data.description || '') : ''}</textarea></div>

      <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;display:flex;flex-direction:column;gap:8px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:8px;">
          <input type="checkbox" id="f-discord" ${data?.has_discord?'checked':''} style="width:18px;height:18px;">
          <span style="font-weight:700;color:#fff;">Acceso a Discord</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:8px;">
          <input type="checkbox" id="f-bot" ${data?.has_bot?'checked':''} onchange="document.getElementById('f-bot-limit-wrap').style.display=this.checked?'':'none'" style="width:18px;height:18px;">
          <span style="font-weight:700;color:#fff;">Incluye Bot (crear cuenta automatica en Firebase)</span>
        </label>
        <div id="f-bot-limit-wrap" style="${data?.has_bot?'':'display:none;'}padding-left:40px;display:flex;flex-direction:column;gap:8px;">
          <div><label class="label">Limite de mensajes/dia del bot</label>
          <input class="input" type="number" id="f-bot-limit" value="${data?.bot_message_limit||300}" min="1" style="max-width:150px;"></div>
          <div><label class="label">Software donde aparecen las credenciales del bot</label>
          <select class="select" id="f-bot-sw" style="max-width:300px;">
            <option value="">-- Seleccionar --</option>
            ${softwares.map(s => `<option value="${s.id}" ${data?.bot_credential_software_id===s.id?'selected':''}>${s.icon} ${esc(s.name)}</option>`).join('')}
          </select></div>
        </div>
      </div>

      ${modules.length ? `
      <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;">
        <label class="label" style="margin-bottom:10px;">Modulos incluidos</label>
        <div id="planModChecks" style="display:flex;flex-direction:column;gap:6px;">
          ${modules.map(m => `
            <label style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;">
              <input type="checkbox" value="${m.id}" ${allowedMods.includes(m.id)?'checked':''} style="width:16px;height:16px;">
              <span>${m.icon} ${esc(m.title)}</span>
            </label>
          `).join('')}
        </div>
      </div>` : ''}

      ${softwares.length ? `
      <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;">
        <label class="label" style="margin-bottom:10px;">Softwares incluidos</label>
        <div id="planSwChecks" style="display:flex;flex-direction:column;gap:6px;">
          ${softwares.map(s => `
            <label style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;">
              <input type="checkbox" value="${s.id}" ${assignedSwIds.includes(s.id)?'checked':''} style="width:16px;height:16px;">
              <span>${s.icon} ${esc(s.name)}</span>
            </label>
          `).join('')}
        </div>
      </div>` : ''}

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>`;
}

async function savePlan(e) {
  e.preventDefault();
  const modChecks = document.querySelectorAll('#planModChecks input[type=checkbox]:checked');
  const swChecks = document.querySelectorAll('#planSwChecks input[type=checkbox]:checked');
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-desc').value,
    duration_months: parseInt(document.getElementById('f-duration').value) || 1,
    has_discord: document.getElementById('f-discord').checked,
    has_bot: document.getElementById('f-bot').checked,
    bot_message_limit: parseInt(document.getElementById('f-bot-limit').value) || 300,
    bot_credential_software_id: parseInt(document.getElementById('f-bot-sw').value) || null,
    allowed_modules: Array.from(modChecks).map(c=>parseInt(c.value)),
    software_ids: Array.from(swChecks).map(c=>parseInt(c.value)),
  };
  try {
    if (editingId) await api(`/api/admin/plans/${editingId}`, { method: 'PUT', body });
    else await api('/api/admin/plans', { method: 'POST', body });
    closeModal(); loadPlans();
    toast(editingId ? 'Plan actualizado' : 'Plan creado');
  } catch (err) { toast(err.message, 'error'); }
}

async function deletePlan(id) {
  if (!confirm('¿Eliminar este plan?')) return;
  try { await api(`/api/admin/plans/${id}`, { method: 'DELETE' }); loadPlans(); toast('Plan eliminado'); }
  catch (err) { toast(err.message, 'error'); }
}

function openPlanSoftwaresModal(planId) {
  const plan = plans.find(p=>p.id===planId);
  const assignedIds = (plan.softwares||[]).map(s=>s.id);
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <h2 class="modal-title">Softwares del plan: ${esc(plan.name)}</h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:16px;">Marcá los softwares que incluye este plan</p>
    <div style="display:flex;flex-direction:column;gap:8px;" id="planSwChecks">
      ${softwares.map(s => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;">
          <input type="checkbox" value="${s.id}" ${assignedIds.includes(s.id)?'checked':''} style="width:18px;height:18px;">
          <span>${s.icon} ${esc(s.name)}</span>
        </label>
      `).join('')}
    </div>
    <div class="modal-actions" style="margin-top:20px;">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn" onclick="savePlanSoftwares(${planId})">Guardar</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

async function savePlanSoftwares(planId) {
  const checks = document.querySelectorAll('#planSwChecks input[type=checkbox]:checked');
  const software_ids = Array.from(checks).map(c => parseInt(c.value));
  try {
    await api(`/api/admin/plans/${planId}/softwares`, { method: 'PUT', body: { software_ids } });
    closeModal(); loadPlans();
    toast('Softwares del plan actualizados');
  } catch (err) { toast(err.message, 'error'); }
}

// ── SOFTWARES (admin) ──
async function loadSoftwares() {
  try {
    softwares = await api('/api/admin/softwares');
    const tbody = document.getElementById('softwaresTable');
    if (!tbody) return;
    tbody.innerHTML = softwares.map(s => `
      <tr>
        <td style="font-size:24px;">${s.icon}</td>
        <td style="color:#fff;font-weight:600;">${esc(s.name)}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">${s.download_url ? `<a href="${esc(s.download_url)}" target="_blank" style="color:var(--blue-mid);">Link</a>` : '-'}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">${s.tutorial_url ? `<a href="${esc(s.tutorial_url)}" target="_blank" style="color:var(--blue-mid);">Video</a>` : '-'}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-ghost" onclick='openModal("software", ${JSON.stringify(s)})'>Editar</button>
            <button class="btn btn-sm btn-danger" onclick="deleteSoftwareAdmin(${s.id})">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) { toast(err.message, 'error'); }
}

let swLinks = []; // temp array for software link editing

function softwareForm(data) {
  swLinks = data?.links ? (typeof data.links === 'string' ? JSON.parse(data.links) : data.links) : [];
  if (!Array.isArray(swLinks)) swLinks = [];
  return `
    <h2 class="modal-title">${data ? 'Editar' : 'Nuevo'} Software</h2>
    <form onsubmit="saveSoftwareAdmin(event)" style="display:flex;flex-direction:column;gap:16px;max-height:75vh;overflow-y:auto;padding-right:4px;">
      <div class="field"><label class="label">Nombre</label><input class="input" id="f-name" value="${data ? esc(data.name) : ''}" required></div>
      <div class="field"><label class="label">Descripción</label><textarea class="textarea" id="f-desc">${data ? esc(data.description || '') : ''}</textarea></div>
      <div class="field"><label class="label">URL Video Tutorial</label><input class="input" id="f-tutorial" value="${data ? esc(data.tutorial_url || '') : ''}" placeholder="https://www.loom.com/share/..."></div>
      <div class="field"><label class="label">Icono (emoji)</label><input class="input" id="f-icon" value="${data ? data.icon : '💻'}" style="width:60px;"></div>
      <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <label class="label" style="margin:0;">Links</label>
          <button type="button" class="btn btn-sm" onclick="addSwLink()" style="font-size:11px;">+ Agregar link</button>
        </div>
        <div id="sw-links-list">${renderSwLinks()}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>`;
}

function renderSwLinks() {
  if (!swLinks.length) return '<p style="font-size:12px;color:rgba(255,255,255,0.3);">Sin links. Agregá uno con el botón de arriba.</p>';
  return swLinks.map((l, i) => `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      <input class="input" placeholder="Nombre del link" value="${esc(l.name||'')}" onchange="swLinks[${i}].name=this.value" style="flex:1;">
      <input class="input" placeholder="https://..." value="${esc(l.url||'')}" onchange="swLinks[${i}].url=this.value" style="flex:2;">
      <button type="button" class="btn btn-sm btn-danger" onclick="removeSwLink(${i})" style="padding:6px 10px;">✕</button>
    </div>
  `).join('');
}

function addSwLink() {
  swLinks.push({ name: '', url: '' });
  document.getElementById('sw-links-list').innerHTML = renderSwLinks();
}

function removeSwLink(i) {
  swLinks.splice(i, 1);
  document.getElementById('sw-links-list').innerHTML = renderSwLinks();
}

async function saveSoftwareAdmin(e) {
  e.preventDefault();
  // Read current values from inputs before saving
  const linkEls = document.querySelectorAll('#sw-links-list .input');
  for (let i = 0; i < linkEls.length; i += 2) {
    const idx = Math.floor(i / 2);
    if (swLinks[idx]) {
      swLinks[idx].name = linkEls[i].value;
      swLinks[idx].url = linkEls[i + 1].value;
    }
  }
  const cleanLinks = swLinks.filter(l => l.name && l.url);
  const body = {
    name: document.getElementById('f-name').value,
    description: document.getElementById('f-desc').value,
    download_url: '',
    tutorial_url: document.getElementById('f-tutorial').value,
    icon: document.getElementById('f-icon').value || '💻',
    links: cleanLinks,
  };
  try {
    if (editingId) await api(`/api/admin/softwares/${editingId}`, { method: 'PUT', body });
    else await api('/api/admin/softwares', { method: 'POST', body });
    closeModal(); loadSoftwares();
    toast(editingId ? 'Software actualizado' : 'Software creado');
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteSoftwareAdmin(id) {
  if (!confirm('¿Eliminar este software?')) return;
  try { await api(`/api/admin/softwares/${id}`, { method: 'DELETE' }); loadSoftwares(); toast('Software eliminado'); }
  catch (err) { toast(err.message, 'error'); }
}

// ── CREDENTIALS ──
async function openCredentialsModal(userId, userName) {
  const creds = await api(`/api/admin/credentials/${userId}`);
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <h2 class="modal-title">Credenciales: ${esc(userName)}</h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:16px;">Asigná usuario/contraseña para cada software</p>
    <div id="credsForm" style="display:flex;flex-direction:column;gap:12px;">
      ${softwares.map(s => {
        const c = creds.find(x=>x.software_id===s.id);
        return `
          <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:14px;">
            <div style="font-size:13px;font-weight:700;margin-bottom:8px;">${s.icon} ${esc(s.name)}</div>
            <div style="display:flex;gap:8px;">
              <input class="input" placeholder="Usuario" data-sw="${s.id}" data-field="username" value="${c?esc(c.username||''):''}" style="flex:1;">
              <input class="input" placeholder="Contraseña" data-sw="${s.id}" data-field="password" value="${c?esc(c.password||''):''}" style="flex:1;">
            </div>
            <input class="input" placeholder="Info extra (opcional)" data-sw="${s.id}" data-field="extra" value="${c?esc(c.extra_info||''):''}" style="margin-top:6px;">
          </div>`;
      }).join('')}
    </div>
    <div class="modal-actions" style="margin-top:20px;">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn" onclick="saveCredentials(${userId})">Guardar Todo</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

async function saveCredentials(userId) {
  const form = document.getElementById('credsForm');
  const swIds = [...new Set(form.querySelectorAll('[data-sw]'))].map(el => el.dataset.sw);
  const uniqueIds = [...new Set(Array.from(form.querySelectorAll('[data-sw]')).map(el => el.dataset.sw))];
  try {
    for (const swId of uniqueIds) {
      const username = form.querySelector(`[data-sw="${swId}"][data-field="username"]`).value;
      const password = form.querySelector(`[data-sw="${swId}"][data-field="password"]`).value;
      const extra_info = form.querySelector(`[data-sw="${swId}"][data-field="extra"]`).value;
      if (username || password || extra_info) {
        await api('/api/admin/credentials', { method: 'POST', body: { user_id: userId, software_id: parseInt(swId), username, password, extra_info } });
      }
    }
    closeModal();
    toast('Credenciales guardadas');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Helpers ──
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── CALLS ──
async function connectCalendar() {
  window.open('/api/calendar/connect', '_blank');
}

async function loadCalls() {
  const dateInput = document.getElementById('callsDate');
  if (!dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
  const date = dateInput.value;

  // Check connection
  try {
    const status = await api('/api/calendar/status');
    const btn = document.getElementById('calConnectBtn');
    if (status.connected) {
      btn.textContent = '✅ Conectado';
      btn.style.background = '#25D366';
    }
  } catch {}

  // Load stats
  try {
    const stats = await api('/api/calendar/stats');
    document.getElementById('callStats').innerHTML = `
      <div class="card" style="flex:1;padding:16px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#fff;">${stats.total||0}</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;">Total</div></div>
      <div class="card" style="flex:1;padding:16px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#25D366;">${stats.closed||0}</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;">Cerradas</div></div>
      <div class="card" style="flex:1;padding:16px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#f59e0b;">${stats.interested||0}</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;">Interesados</div></div>
      <div class="card" style="flex:1;padding:16px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#e74c3c;">${stats.no_show||0}</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;">No Show</div></div>
      <div class="card" style="flex:1;padding:16px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#4ab8fe;">$${parseFloat(stats.revenue||0).toLocaleString()}</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;">Revenue</div></div>
    `;
  } catch {}

  // Load events from calendar
  const list = document.getElementById('callsList');
  try {
    const events = await api('/api/calendar/events?date=' + date);
    const tracked = await api('/api/calendar/calls?date=' + date);
    const trackedMap = {};
    tracked.forEach(t => { trackedMap[t.event_id] = t; });

    if (!events.length) { list.innerHTML = '<div class="card" style="padding:40px;text-align:center;color:rgba(255,255,255,0.3);">No hay reuniones para este dia.</div>'; return; }

    list.innerHTML = events.map(e => {
      const t = trackedMap[e.id];
      const time = e.start ? new Date(e.start).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
      const resultColors = { closed: '#25D366', interested: '#f59e0b', not_closed: '#e74c3c', no_show: '#666', rescheduled: '#4ab8fe', pending: 'rgba(255,255,255,0.2)' };
      const resultLabels = { closed: 'Cerrada', interested: 'Interesado', not_closed: 'No cerro', no_show: 'No Show', rescheduled: 'Reagendo', pending: 'Pendiente' };
      const currentResult = t?.result || 'pending';

      return `<div class="card" style="padding:20px;margin-bottom:12px;border-left:4px solid ${resultColors[currentResult]};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:16px;font-weight:700;color:#fff;">${time} — ${esc(e.title)}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px;">${e.attendees.map(a => esc(a.email || a.name)).join(', ') || 'Sin asistentes'}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${e.meetLink ? `<a href="${esc(e.meetLink)}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#1a73e8;text-decoration:none;">Unirse</a>` : ''}
            <span style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${resultColors[currentResult]}20;color:${resultColors[currentResult]};">${resultLabels[currentResult]}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
          ${['closed','interested','not_closed','no_show','rescheduled'].map(r => `
            <button class="btn btn-sm" style="background:${currentResult===r?resultColors[r]:'rgba(255,255,255,0.03)'};color:${currentResult===r?'#fff':resultColors[r]};border:1px solid ${resultColors[r]}30;" onclick="trackCall('${e.id}','${esc(e.title)}','${r}','${date}')">${resultLabels[r]}</button>
          `).join('')}
        </div>
        ${t?.notes ? `<div style="margin-top:10px;padding:10px 14px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:3px solid rgba(74,184,254,0.3);"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.3);margin-bottom:4px;">Notas del closer</div><div style="font-size:13px;color:rgba(255,255,255,0.7);">${esc(t.notes)}</div>${t.amount>0?'<div style="font-size:13px;color:#25d366;font-weight:700;margin-top:4px;">Monto: $'+parseFloat(t.amount).toLocaleString()+'</div>':''}</div>` : ''}
      </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="card" style="padding:20px;text-align:center;"><p style="color:#f59e0b;">Conecta Google Calendar para ver las reuniones.</p><button class="btn" style="background:#f59e0b;margin-top:12px;" onclick="connectCalendar()">Conectar Calendar</button></div>`;
  }
}

function trackCall(eventId, title, result, date) {
  const resultLabels = { closed: 'Cerrada', interested: 'Interesado', not_closed: 'No cerro', no_show: 'No Show', rescheduled: 'Reagendo' };
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <h2 class="modal-title">${resultLabels[result] || result}: ${esc(title)}</h2>
    <form onsubmit="confirmTrackCall(event,'${eventId}','${esc(title)}','${result}','${date}')" style="display:flex;flex-direction:column;gap:16px;">
      ${result === 'closed' ? '<div class="field"><label class="label">Monto cerrado (USD)</label><input class="input" type="number" id="call-amount" step="0.01" min="0" placeholder="Ej: 1000"></div>' : ''}
      <div class="field"><label class="label">Notas del closer</label><textarea class="textarea" id="call-notes" placeholder="Que paso en la llamada? Detalles importantes..." style="min-height:100px;"></textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn">Guardar</button>
      </div>
    </form>`;
  document.getElementById('modalOverlay').classList.add('active');
}

async function confirmTrackCall(e, eventId, title, result, date) {
  e.preventDefault();
  const notes = document.getElementById('call-notes').value;
  const amount = document.getElementById('call-amount')?.value || 0;
  try {
    await api('/api/calendar/calls', { method: 'POST', body: {
      event_id: eventId,
      client_name: title,
      result,
      amount: parseFloat(amount) || 0,
      notes,
      call_date: date + 'T12:00:00',
    }});
    closeModal();
    loadCalls();
  } catch (err) { toast(err.message, 'error'); }
}

// ── APPROVALS ──
async function loadApprovals() {
  try {
    const clients = await api('/api/admin/pending');
    const div = document.getElementById('approvalsContent');
    if (!clients.length) {
      div.innerHTML = '<div class="card" style="padding:40px;text-align:center;color:rgba(255,255,255,0.3);">No hay clientes pendientes de aprobacion.</div>';
      return;
    }
    div.innerHTML = clients.map(c => {
      const hasContract = !!c.full_name;
      const proofs = c.proofs || [];
      const isRes = c.access_type === 'reserve';
      return `<div class="card" style="padding:24px;margin-bottom:16px;${isRes?'border-left:4px solid #f59e0b;':''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
          <div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:18px;font-weight:700;color:#fff;">${esc(c.name||c.email)}</span>
              ${isRes?'<span style="padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);">RESERVA</span>':'<span style="padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:rgba(74,184,254,0.15);color:#4ab8fe;border:1px solid rgba(74,184,254,0.3);">COMPLETO</span>'}
            </div>
            <div style="font-size:13px;color:rgba(255,255,255,0.4);">${esc(c.email)}${c.phone?' · 📱 '+esc(c.phone):''} · Registrado: ${new Date(c.created_at).toLocaleDateString('es-AR')}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn" style="background:#25D366;" onclick="approveClient(${c.id})">✅ Aprobar</button>
            <button class="btn btn-danger" onclick="rejectClient(${c.id})">❌ Rechazar</button>
          </div>
        </div>
        ${c.closer_notes?`<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.15);border-radius:10px;padding:12px 16px;margin-bottom:16px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f59e0b;margin-bottom:4px;">Notas del closer</div><p style="font-size:13px;color:#fff;margin:0;">${esc(c.closer_notes)}</p></div>`:''}
        ${hasContract ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:14px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.3);margin-bottom:8px;">Datos del contrato</div>
            <p style="color:#fff;font-size:13px;margin:4px 0;"><strong>Nombre:</strong> ${esc(c.full_name)}</p>
            <p style="color:#fff;font-size:13px;margin:4px 0;"><strong>Documento:</strong> ${esc(c.document_id)}</p>
            <p style="color:#fff;font-size:13px;margin:4px 0;"><strong>Direccion:</strong> ${esc(c.address)}</p>
            <p style="color:#fff;font-size:13px;margin:4px 0;"><strong>Firmado:</strong> ${c.signed_at ? new Date(c.signed_at).toLocaleString('es-AR') : '-'}</p>
            <p style="color:rgba(255,255,255,0.3);font-size:11px;margin:4px 0;">IP: ${esc(c.ip_address||'')}</p>
          </div>
          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:14px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.3);margin-bottom:8px;">Pago declarado</div>
            <p style="font-size:28px;font-weight:800;color:${c.currency==='USD'?'#4ab8fe':'#25d366'};margin:8px 0;">${c.currency==='USD'?'USD':'ARS'} $${parseFloat(c.amount||0).toLocaleString()}</p>
            <p style="color:#fff;font-size:13px;margin:4px 0;"><strong>Fecha de pago:</strong> ${c.payment_date ? new Date(c.payment_date).toLocaleDateString('es-AR') : '-'}</p>
            <p style="color:#fff;font-size:13px;margin:4px 0;"><strong>Plan asignado:</strong> ${c.plan_name || '<span style="color:#f59e0b;">Sin plan</span>'}</p>
          </div>
        </div>` : '<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:14px;margin-bottom:16px;"><p style="color:#f59e0b;font-size:13px;">⚠️ Este cliente no firmo el contrato todavia.</p></div>'}
        ${proofs.length ? `
        <div style="margin-bottom:8px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.3);margin-bottom:8px;">Comprobantes de pago (${proofs.length})</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${proofs.map(p => `<a href="${esc(p.file_url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(74,184,254,0.06);border:1px solid rgba(74,184,254,0.15);border-radius:8px;color:#4ab8fe;font-size:12px;font-weight:600;text-decoration:none;">📎 ${esc(p.original_name)}</a>`).join('')}
          </div>
        </div>` : '<p style="color:#e74c3c;font-size:12px;">Sin comprobantes de pago subidos.</p>'}
      </div>`;
    }).join('');
  } catch (err) { toast(err.message, 'error'); }
}

function approveClient(id) {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <h2 class="modal-title">Aprobar Cliente</h2>
    <p style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:16px;">Selecciona el plan para este cliente:</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
      ${plans.map(p => `
        <label style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;cursor:pointer;transition:all 0.15s;" onmouseover="this.style.borderColor='rgba(74,184,254,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
          <input type="radio" name="approve-plan" value="${p.id}" style="width:18px;height:18px;">
          <div style="flex:1;">
            <div style="font-weight:700;color:#fff;">${esc(p.name)}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);">${p.duration_months} meses${p.has_discord?' · Discord':''} · ${(p.softwares||[]).length} sw${p.has_bot?' · 🤖 Bot ('+( p.bot_message_limit||300)+' msgs)':''}</div>
          </div>
        </label>
      `).join('')}
      ${!plans.length ? '<p style="color:#f59e0b;">No hay planes creados. Crea uno primero.</p>' : ''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn" style="background:#25D366;" onclick="confirmApprove(${id})">Aprobar</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('active');
}

async function confirmApprove(id) {
  const selected = document.querySelector('input[name="approve-plan"]:checked');
  if (!selected) { toast('Selecciona un plan', 'error'); return; }
  try {
    const result = await api(`/api/admin/approve/${id}`, { method: 'POST', body: { plan_id: parseInt(selected.value) } });
    closeModal();
    const botMsg = result.bot?.success ? ' + Bot creado automaticamente' : '';
    toast('Cliente aprobado con plan asignado' + botMsg);
    loadApprovals();
    loadUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function rejectClient(id) {
  if (!confirm('Rechazar este cliente?')) return;
  try {
    await api(`/api/admin/reject/${id}`, { method: 'POST' });
    toast('Cliente rechazado');
    loadApprovals();
    loadUsers();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Start ──
init();
