// ── Firebase Config ──
const firebaseConfig = {
  apiKey: "AIzaSyDjtsuDe5LXIwBfd9Z6NqI2FiFvo9m5qzQ",
  authDomain: "extension-prime-outbound.firebaseapp.com",
  projectId: "extension-prime-outbound",
  storageBucket: "extension-prime-outbound.firebasestorage.app",
  messagingSenderId: "314906404713",
  appId: "1:314906404713:web:9a36ac254357784235bff8"
};

const fbApp = firebase.initializeApp(firebaseConfig, 'bots');
const fbAuth = fbApp.auth();
const fbDb = fbApp.firestore();

const ADMIN_EMAIL = 'juancruzbernal24@gmail.com';
let botClients = [];
let fbLoggedIn = false;
let adminPassword = '';

// ── Helpers ──
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function formatDateAR(d) {
  if (!d) return '-';
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString('es-AR');
}
function daysUntil(d) {
  if (!d) return -999;
  const date = d.toDate ? d.toDate() : new Date(d);
  return Math.ceil((date - new Date()) / (1000*60*60*24));
}

// ── Firebase Auth ──
async function botAdminLogin() {
  const modal = document.getElementById('modalContent');
  modal.innerHTML = `
    <h2 class="modal-title">🔑 Login Firebase Admin</h2>
    <form onsubmit="doBotLogin(event)" style="display:flex;flex-direction:column;gap:16px;">
      <div class="field"><label class="label">Email</label><input class="input" id="fb-email" value="${ADMIN_EMAIL}" readonly></div>
      <div class="field"><label class="label">Contraseña Firebase</label><input class="input" type="password" id="fb-pass" required placeholder="Tu contraseña de Firebase Auth"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="btn" style="background:#f59e0b;">Login</button>
      </div>
    </form>`;
  document.getElementById('modalOverlay').classList.add('active');
}

async function doBotLogin(e) {
  e.preventDefault();
  const pass = document.getElementById('fb-pass').value;
  try {
    await fbAuth.signInWithEmailAndPassword(ADMIN_EMAIL, pass);
    adminPassword = pass;
    fbLoggedIn = true;
    closeModal();
    toast('Conectado a Firebase');
    document.getElementById('botLoginBtn').textContent = '✅ Conectado';
    document.getElementById('botLoginBtn').style.background = '#25D366';
    loadBotClients();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Load clients ──
async function loadBotClients() {
  if (!fbLoggedIn) return;
  try {
    const snap = await fbDb.collection('users').orderBy('createdAt', 'desc').get();
    botClients = [];
    snap.forEach(doc => botClients.push({ id: doc.id, ...doc.data() }));
    updateBotStats();
    renderBotClients();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function updateBotStats() {
  const now = new Date();
  let total = botClients.length, active = 0, expiring = 0, expired = 0;
  botClients.forEach(c => {
    const exp = c.expiryDate ? (c.expiryDate.toDate ? c.expiryDate.toDate() : new Date(c.expiryDate)) : null;
    if (!exp || exp < now) expired++;
    else if (daysUntil(c.expiryDate) <= 7) { expiring++; active++; }
    else active++;
  });
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statActive').textContent = active;
  document.getElementById('statExpiring').textContent = expiring;
  document.getElementById('statExpired').textContent = expired;
}

function renderBotClients() {
  const search = (document.getElementById('botSearch')?.value || '').toLowerCase();
  const filtered = search
    ? botClients.filter(c => (c.email||'').toLowerCase().includes(search) || (c.name||'').toLowerCase().includes(search) || (c.notes||'').toLowerCase().includes(search))
    : botClients;

  const tbody = document.getElementById('botClientsTable');
  if (!tbody) return;
  tbody.innerHTML = filtered.map(c => {
    const days = daysUntil(c.expiryDate);
    let badge = '';
    if (days < 0) badge = '<span class="badge" style="background:rgba(231,76,60,0.15);color:#e74c3c;">Expirado</span>';
    else if (days <= 7) badge = '<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;">Por vencer</span>';
    else badge = '<span class="badge" style="background:rgba(37,211,102,0.15);color:#25D366;">Activo</span>';

    return `<tr>
      <td style="color:#fff;font-weight:600;">${esc(c.email||'')}</td>
      <td style="font-family:monospace;font-size:12px;color:rgba(255,255,255,0.6);cursor:pointer;" onclick="navigator.clipboard.writeText('${esc(c.password||'')}');toast('Contraseña copiada')" title="Click para copiar">${esc(c.password||'-')}</td>
      <td>${esc(c.name||'-')}</td>
      <td>${c.messagesSent||0}/${c.messageLimit||300}</td>
      <td>${formatDateAR(c.expiryDate)} ${days >= 0 ? '<span style="font-size:11px;color:rgba(255,255,255,0.3);">(' + days + 'd)</span>' : ''}</td>
      <td>${badge}</td>
      <td>
        <div class="flex gap-8">
          <button class="btn btn-sm btn-ghost" onclick="openBotModal('edit','${c.id}')">Editar</button>
          <button class="btn btn-sm" style="background:#1a5a2e;" onclick="openBotModal('extend','${c.id}')">+Días</button>
          <button class="btn btn-sm" style="background:#2563eb;" onclick="copyBotCreds('${c.id}')" title="Copiar credenciales">🔑</button>
          <button class="btn btn-sm btn-danger" onclick="deleteBotClient('${c.id}')">Eliminar</button>
        </div>
      </td>
    </tr>`;
  }).join('');
  if (!filtered.length) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:rgba(255,255,255,0.3);padding:20px;">No hay clientes</td></tr>';
}

function copyBotCreds(id) {
  const c = botClients.find(x => x.id === id);
  if (!c) return;
  navigator.clipboard.writeText('Email: ' + c.email + '\nContraseña: ' + (c.password||''));
  toast('Credenciales copiadas: ' + c.email);
}

// ── Modals ──
let quickGenPassword = '';

function openBotModal(type, clientId) {
  if (!fbLoggedIn) { toast('Primero logueate en Firebase', 'error'); return; }
  const c = clientId ? botClients.find(x => x.id === clientId) : null;
  const modal = document.getElementById('modalContent');

  if (type === 'quick') {
    quickGenPassword = '';
    modal.innerHTML = `
      <h2 class="modal-title">⚡ Creación Rápida</h2>
      <form onsubmit="quickCreateBot(event)" style="display:flex;flex-direction:column;gap:16px;">
        <div class="field"><label class="label">Email del cliente</label>
          <div class="flex gap-8"><input class="input" type="email" id="fb-q-email" required placeholder="cliente@email.com" style="flex:1;">
          <button type="button" class="btn" onclick="generateQuickPreview()">Generar</button></div>
        </div>
        <div id="quickPreview" style="display:none;">
          <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;color:rgba(255,255,255,0.4);width:90px;">Email:</span>
              <span style="font-size:13px;font-weight:600;color:#fff;" id="qp-email">-</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;color:rgba(255,255,255,0.4);width:90px;">Contraseña:</span>
              <span style="font-size:13px;font-weight:600;color:#25D366;font-family:monospace;" id="qp-pass">-</span>
              <button type="button" class="btn btn-sm btn-ghost" onclick="navigator.clipboard.writeText(document.getElementById('qp-pass').textContent);toast('Contraseña copiada')" style="font-size:10px;padding:2px 8px;">📋</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;color:rgba(255,255,255,0.4);width:90px;">Límite:</span>
              <span style="font-size:13px;font-weight:600;color:#fff;">300 msgs/día</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;color:rgba(255,255,255,0.4);width:90px;">Duración:</span>
              <span style="font-size:13px;font-weight:600;color:#fff;">120 días</span>
            </div>
          </div>
          <div class="field" style="margin-top:12px;"><label class="label">Nombre (opcional)</label><input class="input" id="fb-q-name" placeholder="Nombre del cliente"></div>
          <div class="field"><label class="label">Notas (opcional)</label><textarea class="textarea" id="fb-q-notes" placeholder="Ej: Plan premium, cliente recurrente..."></textarea></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn" id="quickCreateBtn" style="display:none;">Crear Cliente</button>
        </div>
      </form>`;
  } else if (type === 'create') {
    modal.innerHTML = `
      <h2 class="modal-title">Nuevo Cliente Bot</h2>
      <form onsubmit="createBotClient(event)" style="display:flex;flex-direction:column;gap:16px;">
        <div class="field"><label class="label">Email</label><input class="input" type="email" id="fb-c-email" required></div>
        <div class="field"><label class="label">Nombre</label><input class="input" id="fb-c-name"></div>
        <div class="field"><label class="label">Contraseña</label><input class="input" id="fb-c-pass" placeholder="Dejar vacío = auto"></div>
        <div class="field"><label class="label">Límite msgs/día</label><input class="input" type="number" id="fb-c-limit" value="300"></div>
        <div class="field"><label class="label">Días del plan</label><input class="input" type="number" id="fb-c-days" value="120"></div>
        <div class="field"><label class="label">Notas</label><textarea class="textarea" id="fb-c-notes"></textarea></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn">Crear</button>
        </div>
      </form>`;
  } else if (type === 'edit' && c) {
    const exp = c.expiryDate ? (c.expiryDate.toDate ? c.expiryDate.toDate() : new Date(c.expiryDate)) : new Date();
    modal.innerHTML = `
      <h2 class="modal-title">Editar: ${esc(c.email)}</h2>
      <form onsubmit="editBotClient(event,'${c.id}')" style="display:flex;flex-direction:column;gap:16px;">
        <div class="field"><label class="label">Nombre</label><input class="input" id="fb-e-name" value="${esc(c.name||'')}"></div>
        <div class="field"><label class="label">Límite msgs/día</label><input class="input" type="number" id="fb-e-limit" value="${c.messageLimit||300}"></div>
        <div class="field"><label class="label">Fecha expiración</label><input class="input" type="date" id="fb-e-expiry" value="${exp.toISOString().split('T')[0]}"></div>
        <div class="field"><label class="label">Notas</label><textarea class="textarea" id="fb-e-notes">${esc(c.notes||'')}</textarea></div>
        <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:4px;">Credenciales</div>
          <div style="font-size:13px;"><strong>Email:</strong> ${esc(c.email)} · <strong>Pass:</strong> ${esc(c.password||'')}</div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn">Guardar</button>
        </div>
      </form>`;
  } else if (type === 'extend' && c) {
    const days = daysUntil(c.expiryDate);
    modal.innerHTML = `
      <h2 class="modal-title">Extender: ${esc(c.email)}</h2>
      <p style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:16px;">Expira: ${formatDateAR(c.expiryDate)} (${days} días)</p>
      <form onsubmit="extendBotPlan(event,'${c.id}')" style="display:flex;flex-direction:column;gap:16px;">
        <div class="field"><label class="label">Agregar días</label><input class="input" type="number" id="fb-x-days" value="30" min="1"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn" style="background:#25D366;">Extender</button>
        </div>
      </form>`;
  }
  document.getElementById('modalOverlay').classList.add('active');
}

// ── Quick Create ──
function generateQuickPreview() {
  const email = document.getElementById('fb-q-email').value.trim();
  if (!email || !email.includes('@')) { toast('Poné un email válido', 'error'); return; }
  quickGenPassword = email.split('@')[0] + Math.floor(100 + Math.random() * 900);
  document.getElementById('qp-email').textContent = email;
  document.getElementById('qp-pass').textContent = quickGenPassword;
  document.getElementById('quickPreview').style.display = 'block';
  document.getElementById('quickCreateBtn').style.display = '';
}

async function quickCreateBot(e) {
  e.preventDefault();
  if (!quickGenPassword) { generateQuickPreview(); return; }
  const email = document.getElementById('fb-q-email').value.trim().toLowerCase();
  const name = document.getElementById('fb-q-name')?.value || '';
  const notes = document.getElementById('fb-q-notes')?.value || 'Creado con creación rápida';
  await _createInFirebase(email, quickGenPassword, name, 300, 120, notes);
  quickGenPassword = '';
}

// ── Full Create ──
async function createBotClient(e) {
  e.preventDefault();
  const email = document.getElementById('fb-c-email').value.trim().toLowerCase();
  let pw = document.getElementById('fb-c-pass').value;
  if (!pw) pw = email.split('@')[0] + Math.floor(100 + Math.random() * 900);
  const name = document.getElementById('fb-c-name').value;
  const limit = parseInt(document.getElementById('fb-c-limit').value) || 300;
  const days = parseInt(document.getElementById('fb-c-days').value) || 120;
  const notes = document.getElementById('fb-c-notes').value;
  await _createInFirebase(email, pw, name, limit, days, notes);
}

async function _createInFirebase(email, password, name, limit, days, notes) {
  try {
    toast('Creando en Firebase...');
    const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    const now = new Date();
    const expiry = addDays(now, days);
    const todayStr = now.toISOString().split('T')[0];

    await fbDb.collection('users').doc(uid).set({
      email, name: name || '', plan: 'custom', messageLimit: limit,
      messagesSent: 0, lastResetDate: firebase.firestore.Timestamp.fromDate(now),
      isActive: true, expiryDate: firebase.firestore.Timestamp.fromDate(expiry),
      notes: notes || '', createdAt: firebase.firestore.Timestamp.fromDate(now),
      createdBy: 'admin', password: password
    });

    await fbDb.collection('users').doc(uid).collection('dailyStats').doc(todayStr).set({
      globalMessageCount: 0, date: todayStr, userId: uid, userEmail: email, messageLimit: limit
    });

    // Re-login as admin
    await fbAuth.signInWithEmailAndPassword(ADMIN_EMAIL, adminPassword);
    closeModal();
    toast('Cliente creado: ' + email + ' (pass: ' + password + ')');
    loadBotClients();
  } catch (err) {
    try { await fbAuth.signInWithEmailAndPassword(ADMIN_EMAIL, adminPassword); } catch {}
    toast('Error: ' + err.message, 'error');
  }
}

// ── Edit ──
async function editBotClient(e, id) {
  e.preventDefault();
  try {
    await fbDb.collection('users').doc(id).update({
      name: document.getElementById('fb-e-name').value,
      messageLimit: parseInt(document.getElementById('fb-e-limit').value),
      expiryDate: firebase.firestore.Timestamp.fromDate(new Date(document.getElementById('fb-e-expiry').value)),
      notes: document.getElementById('fb-e-notes').value
    });
    closeModal(); toast('Cliente actualizado'); loadBotClients();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Extend ──
async function extendBotPlan(e, id) {
  e.preventDefault();
  const days = parseInt(document.getElementById('fb-x-days').value);
  const c = botClients.find(x => x.id === id);
  const currentExp = c.expiryDate ? (c.expiryDate.toDate ? c.expiryDate.toDate() : new Date(c.expiryDate)) : new Date();
  const base = currentExp > new Date() ? currentExp : new Date();
  const newExp = addDays(base, days);
  try {
    await fbDb.collection('users').doc(id).update({
      expiryDate: firebase.firestore.Timestamp.fromDate(newExp), isActive: true
    });
    closeModal(); toast('Plan extendido ' + days + ' días'); loadBotClients();
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Delete ──
async function deleteBotClient(id) {
  const c = botClients.find(x => x.id === id);
  if (!c || !confirm('¿Eliminar ' + c.email + '?')) return;
  try {
    toast('Eliminando...');
    if (c.password) {
      try {
        await fbAuth.signInWithEmailAndPassword(c.email, c.password);
        await fbAuth.currentUser.delete();
      } catch {}
      await fbAuth.signInWithEmailAndPassword(ADMIN_EMAIL, adminPassword);
    }
    try {
      const stats = await fbDb.collection('users').doc(id).collection('dailyStats').get();
      const batch = fbDb.batch();
      stats.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch {}
    await fbDb.collection('users').doc(id).delete();
    toast('Cliente eliminado'); loadBotClients();
  } catch (err) {
    try { await fbAuth.signInWithEmailAndPassword(ADMIN_EMAIL, adminPassword); } catch {}
    toast('Error: ' + err.message, 'error');
  }
}

// ── Clean expired ──
async function cleanExpiredBots() {
  const now = new Date();
  const expired = botClients.filter(c => {
    const d = daysUntil(c.expiryDate);
    return d < 0;
  });
  if (!expired.length) { toast('No hay expirados (todos tienen fecha vigente)'); return; }
  if (!confirm('¿Eliminar ' + expired.length + ' clientes expirados?')) return;
  toast('Eliminando ' + expired.length + '...');
  let del = 0;
  for (const c of expired) {
    try {
      if (c.password) {
        try { await fbAuth.signInWithEmailAndPassword(c.email, c.password); await fbAuth.currentUser.delete(); } catch {}
        await fbAuth.signInWithEmailAndPassword(ADMIN_EMAIL, adminPassword);
      }
      try { const s = await fbDb.collection('users').doc(c.id).collection('dailyStats').get(); const b = fbDb.batch(); s.forEach(d => b.delete(d.ref)); await b.commit(); } catch {}
      await fbDb.collection('users').doc(c.id).delete();
      del++;
    } catch { try { await fbAuth.signInWithEmailAndPassword(ADMIN_EMAIL, adminPassword); } catch {} }
  }
  toast(del + ' expirados eliminados'); loadBotClients();
}

// ── Auto-load on tab switch ──
const _origSwitchTab = window.switchTab;
if (_origSwitchTab) {
  window.switchTab = function(tab) {
    _origSwitchTab(tab);
    if (tab === 'bots' && fbLoggedIn) loadBotClients();
  };
}
