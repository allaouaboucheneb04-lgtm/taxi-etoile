const ADMINS_COLLECTION = 'admins';
const RESERVATIONS_COLLECTION = 'reservations';
const DRIVERS_COLLECTION = 'drivers';

let db = null;
let auth = null;
let reservationsCache = [];
let driversCache = [];
let driverReservationsCache = [];
let unsubscribeReservations = null;
let unsubscribeDrivers = null;
let unsubscribeDriverReservations = null;
let currentUser = null;
let currentAdminDoc = null;
let currentDriverDoc = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(value) {
  if (!value) return '—';
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString('fr-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('fr-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function isToday(value) {
  let date = null;
  if (value && typeof value?.toDate === 'function') date = value.toDate();
  else if (value) date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function showInlineMessage(id, text, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.toggle('error-message', !!isError);
  el.classList.toggle('success-message', !isError);
}

function hideInlineMessage(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
}

function initThemeAndPwa() {
  const selector = document.getElementById('themeSelector');
  if (selector) {
    const saved = localStorage.getItem('theme');
    if (saved) {
      document.body.classList.add('theme-' + saved);
      selector.value = saved;
    }
    selector.addEventListener('change', () => {
      const theme = selector.value;
      document.body.className = '';
      document.body.classList.add('theme-' + theme);
      localStorage.setItem('theme', theme);
    });
  }

  let deferredPrompt;
  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      installBtn.style.display = 'block';
    });

    installBtn.addEventListener('click', async () => {
      installBtn.style.display = 'none';
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
      }
    });
  }

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (('standalone' in window.navigator) && window.navigator.standalone);
  document.body.classList.toggle('standalone-app', !!isInStandaloneMode);
  const iosBanner = document.getElementById('iosBanner');
  if (iosBanner && isIos && !isInStandaloneMode) {
    iosBanner.style.display = 'block';
    const closeBtn = document.getElementById('closeIosBanner');
    if (closeBtn) closeBtn.addEventListener('click', () => { iosBanner.style.display = 'none'; });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }
}

function initFirebase() {
  if (!window.firebase || !window.FIREBASE_CONFIG) {
    console.error('Firebase SDK ou config absente.');
    return false;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }

  db = firebase.firestore();
  auth = firebase.auth();
  return true;
}

async function searchAddress(query, container) {
  if (!container || query.length < 3) {
    if (container) container.style.display = 'none';
    return;
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5&countrycodes=ca`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    const results = await res.json();
    container.innerHTML = '';
    container.style.display = results.length ? 'block' : 'none';

    results.forEach((place) => {
      const div = document.createElement('div');
      div.textContent = place.display_name;
      div.addEventListener('click', () => {
        const input = container.previousElementSibling;
        input.value = place.display_name;
        container.style.display = 'none';
      });
      container.appendChild(div);
    });
  } catch {
    container.style.display = 'none';
  }
}

function setupAutocomplete(inputId, resultsId) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  if (!input || !results) return;

  input.addEventListener('input', () => searchAddress(input.value, results));
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) {
      results.style.display = 'none';
    }
  });
}

function initReservationPage() {
  const form = document.getElementById('reservationForm');
  if (!form) return;

  setupAutocomplete('depart', 'depart-results');
  setupAutocomplete('arrivee', 'arrivee-results');
  setupAutocomplete('retourDepart', 'retour-depart-results');
  setupAutocomplete('retourArrivee', 'retour-arrivee-results');

  const allerRetourCheckbox = document.getElementById('allerRetour');
  const retourFields = document.getElementById('retourFields');
  const retourRequiredFields = [
    document.getElementById('retourDepart'),
    document.getElementById('retourArrivee'),
    document.getElementById('retourHeure')
  ].filter(Boolean);
  const passagersInput = document.getElementById('passagers');
  const valisesInput = document.getElementById('valises');
  const vehiculeSelect = document.getElementById('vehicule');
  const submitBtn = document.getElementById('submitBtn');

  function toggleRetourFields() {
    const enabled = allerRetourCheckbox?.checked;
    retourFields?.classList.toggle('hidden', !enabled);
    retourRequiredFields.forEach((field) => { field.required = !!enabled; });
  }

  function suggestVehicle() {
    const passagers = Number(passagersInput?.value || 0);
    const valises = Number(valisesInput?.value || 0);
    if (!vehiculeSelect) return;
    vehiculeSelect.value = (passagers > 4 || valises > 3) ? 'van' : 'berline';
  }

  allerRetourCheckbox?.addEventListener('change', toggleRetourFields);
  passagersInput?.addEventListener('input', suggestVehicle);
  valisesInput?.addEventListener('input', suggestVehicle);
  toggleRetourFields();
  suggestVehicle();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideInlineMessage('confirmation');

    if (!db) {
      showInlineMessage('confirmation', 'Firebase n’est pas configuré.', true);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enregistrement...';
    }

    const reservation = {
      nom: document.getElementById('nom')?.value?.trim() || '',
      telephone: document.getElementById('telephone')?.value?.trim() || '',
      email: document.getElementById('email')?.value?.trim() || '',
      passagers: Number(document.getElementById('passagers')?.value || 1),
      numeroVol: document.getElementById('numeroVol')?.value?.trim() || '',
      depart: document.getElementById('depart')?.value?.trim() || '',
      arrivee: document.getElementById('arrivee')?.value?.trim() || '',
      heure: document.getElementById('heure')?.value || '',
      vehicule: document.getElementById('vehicule')?.value || 'berline',
      valises: Number(document.getElementById('valises')?.value || 0),
      notes: document.getElementById('notes')?.value?.trim() || '',
      allerRetour: !!document.getElementById('allerRetour')?.checked,
      retourDepart: document.getElementById('retourDepart')?.value?.trim() || '',
      retourArrivee: document.getElementById('retourArrivee')?.value?.trim() || '',
      retourHeure: document.getElementById('retourHeure')?.value || '',
      retourNumeroVol: document.getElementById('retourNumeroVol')?.value?.trim() || '',
      retourDetails: document.getElementById('retourDetails')?.value?.trim() || '',
      status: 'en_attente',
      driverId: '',
      driverName: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAtClient: new Date().toISOString(),
      source: 'site-web',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'client-site'
    };

    try {
      await db.collection(RESERVATIONS_COLLECTION).add(reservation);
      form.reset();
      toggleRetourFields();
      suggestVehicle();
      showInlineMessage('confirmation', '✅ Réservation envoyée et sauvegardée dans Firebase.', false);
    } catch (error) {
      showInlineMessage('confirmation', 'Erreur Firebase : ' + (error.message || 'enregistrement impossible'), true);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Réserver maintenant';
      }
    }
  });
}

function reservationSearchBlob(item) {
  return [
    item.nom, item.telephone, item.email, item.numeroVol, item.depart, item.arrivee,
    item.notes, item.retourNumeroVol, item.retourDepart, item.retourArrivee, item.status,
    item.driverName
  ].join(' ').toLowerCase();
}

function statusLabel(status) {
  const labels = {
    en_attente: 'En attente',
    assignee: 'Assignée',
    confirmee: 'Confirmée',
    en_cours: 'En cours',
    terminee: 'Terminée',
    annulee: 'Annulée'
  };
  return labels[status] || status || 'En attente';
}

function driverOptionsHtml(selectedId = '') {
  const activeDrivers = driversCache.filter((driver) => driver.active !== false);
  const base = '<option value="">Choisir un chauffeur</option>';
  return base + activeDrivers.map((driver) => `
    <option value="${escapeHtml(driver.id)}" ${driver.id === selectedId ? 'selected' : ''}>${escapeHtml(driver.name || 'Sans nom')} • ${escapeHtml(driver.phone || '')}</option>
  `).join('');
}

function renderDriversMiniList() {
  const list = document.getElementById('driversList');
  if (!list) return;
  if (!driversCache.length) {
    list.innerHTML = '<p class="small-muted">Aucun chauffeur ajouté.</p>';
    return;
  }

  list.innerHTML = driversCache.map((driver) => `
    <div class="driver-mini-card">
      <div>
        <strong>${escapeHtml(driver.name || 'Sans nom')}</strong>
        <p>${escapeHtml(driver.phone || '—')} • ${escapeHtml(driver.car || '—')}</p>
      </div>
      <button class="secondary-btn small-btn toggle-driver-btn" data-driver-id="${escapeHtml(driver.id)}" data-driver-active="${driver.active === false ? '0' : '1'}">
        ${driver.active === false ? 'Réactiver' : 'Désactiver'}
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.toggle-driver-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-driver-id');
      const active = button.getAttribute('data-driver-active') === '1';
      if (!id || !db) return;
      try {
        await db.collection(DRIVERS_COLLECTION).doc(id).update({
          active: !active,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (error) {
        alert('Impossible de modifier le chauffeur : ' + (error.message || 'erreur'));
      }
    });
  });
}

function renderReservations() {
  const list = document.getElementById('reservationsList');
  if (!list) return;

  const searchValue = (document.getElementById('searchReservation')?.value || '').toLowerCase();
  const tripFilter = document.getElementById('tripFilter')?.value || 'all';
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  const emptyState = document.getElementById('emptyState');

  const filtered = reservationsCache.filter((item) => {
    const matchesSearch = reservationSearchBlob(item).includes(searchValue);
    const tripType = item.allerRetour ? 'aller-retour' : 'aller-simple';
    const matchesTrip = tripFilter === 'all' || tripFilter === tripType;
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    return matchesSearch && matchesTrip && matchesStatus;
  });

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  setText('statTotal', reservationsCache.length);
  setText('statRoundTrip', reservationsCache.filter((item) => item.allerRetour).length);
  setText('statToday', reservationsCache.filter((item) => isToday(item.createdAt || item.createdAtClient)).length);
  setText('statPending', reservationsCache.filter((item) => item.status === 'en_attente').length);
  setText('statAssigned', reservationsCache.filter((item) => item.status === 'assignee').length);
  setText('statDrivers', driversCache.filter((driver) => driver.active !== false).length);

  renderDriversMiniList();

  if (!filtered.length) {
    list.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  list.innerHTML = filtered.map((item) => `
    <article class="reservation-card">
      <div class="reservation-header">
        <div>
          <h3>${escapeHtml(item.nom || 'Sans nom')}</h3>
          <p>${escapeHtml(item.allerRetour ? 'Aller-retour' : 'Aller simple')} • ${escapeHtml(item.vehicule || 'berline')} • ${escapeHtml(item.statusLabel)}</p>
        </div>
        <button class="danger-btn small-btn" data-delete-id="${escapeHtml(item.id)}">Supprimer</button>
      </div>
      <div class="reservation-grid">
        <div><strong>Téléphone :</strong> ${escapeHtml(item.telephone || '—')}</div>
        <div><strong>Email :</strong> ${escapeHtml(item.email || '—')}</div>
        <div><strong>Passagers :</strong> ${escapeHtml(item.passagers || '—')}</div>
        <div><strong>Valises :</strong> ${escapeHtml(item.valises || '—')}</div>
        <div><strong>Vol :</strong> ${escapeHtml(item.numeroVol || '—')}</div>
        <div><strong>Date/heure :</strong> ${escapeHtml(formatDateTime(item.heure))}</div>
        <div><strong>Départ :</strong> ${escapeHtml(item.depart || '—')}</div>
        <div><strong>Arrivée :</strong> ${escapeHtml(item.arrivee || '—')}</div>
        <div><strong>Créée le :</strong> ${escapeHtml(formatDateTime(item.createdAt || item.createdAtClient))}</div>
        <div><strong>Notes :</strong> ${escapeHtml(item.notes || '—')}</div>
        <div><strong>Chauffeur :</strong> ${escapeHtml(item.driverName || 'Non assigné')}</div>
        <div>
          <strong>Assigner :</strong>
          <select class="driver-select" data-driver-id="${escapeHtml(item.id)}">${driverOptionsHtml(item.driverId || '')}</select>
        </div>
        <div>
          <strong>Statut :</strong>
          <select class="status-select" data-status-id="${escapeHtml(item.id)}">
            <option value="en_attente" ${item.status === 'en_attente' ? 'selected' : ''}>En attente</option>
            <option value="assignee" ${item.status === 'assignee' ? 'selected' : ''}>Assignée</option>
            <option value="confirmee" ${item.status === 'confirmee' ? 'selected' : ''}>Confirmée</option>
            <option value="en_cours" ${item.status === 'en_cours' ? 'selected' : ''}>En cours</option>
            <option value="terminee" ${item.status === 'terminee' ? 'selected' : ''}>Terminée</option>
            <option value="annulee" ${item.status === 'annulee' ? 'selected' : ''}>Annulée</option>
          </select>
        </div>
      </div>
      ${item.allerRetour ? `
        <div class="retour-summary">
          <h4>Retour</h4>
          <p><strong>Départ :</strong> ${escapeHtml(item.retourDepart || '—')}</p>
          <p><strong>Arrivée :</strong> ${escapeHtml(item.retourArrivee || '—')}</p>
          <p><strong>Date/heure :</strong> ${escapeHtml(formatDateTime(item.retourHeure))}</p>
          <p><strong>Vol retour :</strong> ${escapeHtml(item.retourNumeroVol || '—')}</p>
          <p><strong>Détails :</strong> ${escapeHtml(item.retourDetails || '—')}</p>
        </div>
      ` : ''}
    </article>
  `).join('');

  list.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-delete-id');
      if (!id || !db) return;
      if (!confirm('Supprimer cette réservation ?')) return;
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).delete();
      } catch (error) {
        alert('Suppression impossible : ' + (error.message || 'erreur'));
      }
    });
  });

  list.querySelectorAll('[data-status-id]').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-status-id');
      if (!id || !db) return;
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).update({
          status: select.value,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: currentUser?.email || ''
        });
      } catch (error) {
        alert('Mise à jour impossible : ' + (error.message || 'erreur'));
      }
    });
  });

  list.querySelectorAll('[data-driver-id]').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-driver-id');
      const driverId = select.value;
      if (!id || !db) return;
      const driver = driversCache.find((item) => item.id === driverId);
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).update({
          driverId: driverId || '',
          driverName: driver?.name || '',
          status: driverId ? 'assignee' : 'en_attente',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: currentUser?.email || ''
        });
      } catch (error) {
        alert('Assignation impossible : ' + (error.message || 'erreur'));
      }
    });
  });
}

function renderDriverReservations() {
  const list = document.getElementById('driverReservationsList');
  if (!list) return;
  const emptyState = document.getElementById('driverEmptyState');

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  setText('driverStatTotal', driverReservationsCache.length);
  setText('driverStatAssigned', driverReservationsCache.filter((item) => item.status === 'assignee').length);
  setText('driverStatInProgress', driverReservationsCache.filter((item) => item.status === 'en_cours').length);
  setText('driverStatDone', driverReservationsCache.filter((item) => item.status === 'terminee').length);

  if (!driverReservationsCache.length) {
    list.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  list.innerHTML = driverReservationsCache.map((item) => `
    <article class="reservation-card">
      <div class="reservation-header">
        <div>
          <h3>${escapeHtml(item.nom || 'Sans nom')}</h3>
          <p>${escapeHtml(statusLabel(item.status))}</p>
        </div>
      </div>
      <div class="reservation-grid">
        <div><strong>Téléphone :</strong> ${escapeHtml(item.telephone || '—')}</div>
        <div><strong>Date/heure :</strong> ${escapeHtml(formatDateTime(item.heure))}</div>
        <div><strong>Départ :</strong> ${escapeHtml(item.depart || '—')}</div>
        <div><strong>Arrivée :</strong> ${escapeHtml(item.arrivee || '—')}</div>
        <div><strong>Notes :</strong> ${escapeHtml(item.notes || '—')}</div>
        <div>
          <strong>Statut :</strong>
          <select class="driver-status-select" data-status-id="${escapeHtml(item.id)}">
            <option value="assignee" ${item.status === 'assignee' ? 'selected' : ''}>Assignée</option>
            <option value="confirmee" ${item.status === 'confirmee' ? 'selected' : ''}>Confirmée</option>
            <option value="en_cours" ${item.status === 'en_cours' ? 'selected' : ''}>En cours</option>
            <option value="terminee" ${item.status === 'terminee' ? 'selected' : ''}>Terminée</option>
          </select>
        </div>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('.driver-status-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-status-id');
      if (!id || !db) return;
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).update({
          status: select.value,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: currentUser?.email || ''
        });
      } catch (error) {
        alert('Mise à jour impossible : ' + (error.message || 'erreur'));
      }
    });
  });
}

function mapReservationDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    status: data.status || 'en_attente',
    statusLabel: statusLabel(data.status || 'en_attente')
  };
}

function mapDriverDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    name: data.name || '',
    phone: data.phone || '',
    car: data.car || '',
    active: data.active !== false
  };
}

async function verifyAdminAccess(user) {
  const doc = await db.collection(ADMINS_COLLECTION).doc(user.uid).get();
  if (!doc.exists) {
    throw new Error('Ton compte existe dans Firebase Auth, mais pas dans la collection admins.');
  }
  const data = doc.data() || {};
  if (!data.active) {
    throw new Error('Ton compte admin est désactivé.');
  }
  currentAdminDoc = data;
  const badge = document.getElementById('adminBadge');
  if (badge) badge.textContent = `${user.email} • ${data.role || 'admin'}`;
}

async function verifyDriverAccess(user) {
  const doc = await db.collection(DRIVERS_COLLECTION).doc(user.uid).get();
  if (!doc.exists) {
    throw new Error('Ton compte Auth existe, mais pas dans la collection drivers.');
  }
  const data = doc.data() || {};
  if (data.active === false) {
    throw new Error('Ton compte chauffeur est désactivé.');
  }
  currentDriverDoc = { id: doc.id, ...data };
  const badge = document.getElementById('driverBadge');
  if (badge) badge.textContent = `${data.name || user.email} • ${data.phone || ''} • ${data.car || ''}`;
}

function subscribeDrivers() {
  if (unsubscribeDrivers) unsubscribeDrivers();
  unsubscribeDrivers = db.collection(DRIVERS_COLLECTION)
    .orderBy('name', 'asc')
    .onSnapshot((snapshot) => {
      driversCache = snapshot.docs.map(mapDriverDoc);
      renderReservations();
    });
}

function subscribeReservations() {
  if (unsubscribeReservations) unsubscribeReservations();
  unsubscribeReservations = db.collection(RESERVATIONS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .onSnapshot((snapshot) => {
      reservationsCache = snapshot.docs.map(mapReservationDoc);
      renderReservations();
    }, (error) => {
      const syncStatus = document.getElementById('syncStatus');
      if (syncStatus) syncStatus.textContent = 'Erreur de synchronisation : ' + (error.message || 'lecture impossible');
    });
}

function subscribeDriverReservations(uid) {
  if (unsubscribeDriverReservations) unsubscribeDriverReservations();
  unsubscribeDriverReservations = db.collection(RESERVATIONS_COLLECTION)
    .where('driverId', '==', uid)
    .onSnapshot((snapshot) => {
      driverReservationsCache = snapshot.docs.map(mapReservationDoc).sort((a, b) => {
        const ta = a.createdAt?.seconds || 0;
        const tb = b.createdAt?.seconds || 0;
        return tb - ta;
      });
      renderDriverReservations();
    }, (error) => {
      const syncStatus = document.getElementById('driverSyncStatus');
      if (syncStatus) syncStatus.textContent = 'Erreur de synchronisation : ' + (error.message || 'lecture impossible');
    });
}

function setDashboardVisibility(loggedIn) {
  const loginCard = document.getElementById('loginCard');
  const dashboardCard = document.getElementById('dashboardCard');
  if (loginCard) loginCard.classList.toggle('hidden', loggedIn);
  if (dashboardCard) dashboardCard.classList.toggle('hidden', !loggedIn);
}

function setDriverDashboardVisibility(loggedIn) {
  const loginCard = document.getElementById('driverLoginCard');
  const dashboardCard = document.getElementById('driverDashboardCard');
  if (loginCard) loginCard.classList.toggle('hidden', loggedIn);
  if (dashboardCard) dashboardCard.classList.toggle('hidden', !loggedIn);
}

function initDashboardPage() {
  const loginCard = document.getElementById('loginCard');
  const dashboardCard = document.getElementById('dashboardCard');
  if (!loginCard || !dashboardCard) return;

  if (!auth || !db) {
    showInlineMessage('loginError', 'Firebase n’est pas configuré.', true);
    return;
  }

  document.getElementById('loginBtn')?.addEventListener('click', async () => {
    hideInlineMessage('loginError');
    const email = document.getElementById('adminUser')?.value?.trim();
    const pass = document.getElementById('adminPass')?.value;
    try {
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (error) {
      showInlineMessage('loginError', error.message || 'Connexion impossible.', true);
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await auth.signOut();
  });

  document.getElementById('searchReservation')?.addEventListener('input', renderReservations);
  document.getElementById('tripFilter')?.addEventListener('change', renderReservations);
  document.getElementById('statusFilter')?.addEventListener('change', renderReservations);

  document.getElementById('driverForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideInlineMessage('driverMsg');
    const name = document.getElementById('driverName')?.value?.trim();
    const phone = document.getElementById('driverPhone')?.value?.trim();
    const uid = document.getElementById('driverUid')?.value?.trim();
    const car = document.getElementById('driverCar')?.value?.trim();
    if (!name || !phone || !car) return;
    try {
      const driverPayload = {
        name,
        phone,
        car,
        plate: '',
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser?.email || ''
      };
      if (uid) {
        await db.collection(DRIVERS_COLLECTION).doc(uid).set(driverPayload, { merge: true });
      } else {
        await db.collection(DRIVERS_COLLECTION).add(driverPayload);
      }
      document.getElementById('driverForm').reset();
      showInlineMessage('driverMsg', 'Chauffeur ajouté.', false);
    } catch (error) {
      showInlineMessage('driverMsg', 'Erreur ajout chauffeur : ' + (error.message || 'erreur'), true);
    }
  });

  document.getElementById('clearBtn')?.addEventListener('click', async () => {
    if (!db || !reservationsCache.length) return;
    if (!confirm('Supprimer toutes les réservations visibles ?')) return;
    const batch = db.batch();
    reservationsCache.forEach((item) => {
      batch.delete(db.collection(RESERVATIONS_COLLECTION).doc(item.id));
    });
    try {
      await batch.commit();
    } catch (error) {
      alert('Suppression globale impossible : ' + (error.message || 'erreur'));
    }
  });

  document.getElementById('exportBtn')?.addEventListener('click', () => {
    const data = JSON.stringify(reservationsCache, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reservations-taxi-etoile-firebase.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  auth.onAuthStateChanged(async (user) => {
    const syncStatus = document.getElementById('syncStatus');
    currentUser = user || null;
    currentAdminDoc = null;
    if (!user) {
      setDashboardVisibility(false);
      reservationsCache = [];
      driversCache = [];
      renderReservations();
      if (unsubscribeReservations) { unsubscribeReservations(); unsubscribeReservations = null; }
      if (unsubscribeDrivers) { unsubscribeDrivers(); unsubscribeDrivers = null; }
      if (syncStatus) syncStatus.textContent = 'Non connecté';
      return;
    }

    try {
      await verifyAdminAccess(user);
      setDashboardVisibility(true);
      if (syncStatus) syncStatus.textContent = 'Synchronisé en temps réel avec Firebase';
      subscribeDrivers();
      subscribeReservations();
    } catch (error) {
      await auth.signOut();
      showInlineMessage('loginError', error.message || 'Accès refusé.', true);
      setDashboardVisibility(false);
    }
  });
}

function initDriverPage() {
  const loginCard = document.getElementById('driverLoginCard');
  const dashboardCard = document.getElementById('driverDashboardCard');
  if (!loginCard || !dashboardCard) return;

  if (!auth || !db) {
    showInlineMessage('driverLoginError', 'Firebase n’est pas configuré.', true);
    return;
  }

  document.getElementById('driverLoginBtn')?.addEventListener('click', async () => {
    hideInlineMessage('driverLoginError');
    const email = document.getElementById('driverUser')?.value?.trim();
    const pass = document.getElementById('driverPass')?.value;
    try {
      await auth.signInWithEmailAndPassword(email, pass);
    } catch (error) {
      showInlineMessage('driverLoginError', error.message || 'Connexion impossible.', true);
    }
  });

  document.getElementById('driverLogoutBtn')?.addEventListener('click', async () => {
    await auth.signOut();
  });

  auth.onAuthStateChanged(async (user) => {
    const syncStatus = document.getElementById('driverSyncStatus');
    currentUser = user || null;
    currentDriverDoc = null;
    if (!user) {
      setDriverDashboardVisibility(false);
      driverReservationsCache = [];
      renderDriverReservations();
      if (unsubscribeDriverReservations) { unsubscribeDriverReservations(); unsubscribeDriverReservations = null; }
      if (syncStatus) syncStatus.textContent = 'Non connecté';
      return;
    }

    try {
      await verifyDriverAccess(user);
      setDriverDashboardVisibility(true);
      if (syncStatus) syncStatus.textContent = 'Synchronisé en temps réel avec Firebase';
      subscribeDriverReservations(user.uid);
    } catch (error) {
      await auth.signOut();
      showInlineMessage('driverLoginError', error.message || 'Accès refusé.', true);
      setDriverDashboardVisibility(false);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initThemeAndPwa();
  initFirebase();
  initReservationPage();
  initDashboardPage();
  initDriverPage();
});
