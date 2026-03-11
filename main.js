
// --- ROUND TRIP AUTO SPLIT ---
function expandRoundTrips(list){
  const out=[];
  list.forEach(r=>{
    out.push(r);
    const hasReturn = reservationRoundTrip(r) && reservationReturnDateTime(r);
    if(hasReturn){
      const copy = {...r};
      copy.direction = "retour";
      copy.datetime = reservationReturnDateTime(r);
      copy.pickup = reservationDropoff(r);
      copy.dropoff = reservationPickup(r);
      copy._generatedReturn = true;
      out.push(copy);
    }
  });
  return out;
}

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
let driverQuickFilter = "all";

const NOTIFICATION_STORAGE_KEYS = {
  adminEnabled: 'taxi_admin_notifications_enabled',
  driverEnabled: 'taxi_driver_notifications_enabled'
};

let adminNotificationReady = false;
let driverNotificationReady = false;
let adminKnownReservationIds = new Set();
let driverKnownReservationIds = new Set();
let audioContext = null;


const STATUS_UI_MAP = {
  pending: 'pending',
  quote_request: 'quote_request',
  en_attente: 'pending',
  assigned: 'assigned',
  assignee: 'assigned',
  accepted: 'accepted',
  acceptee: 'accepted',
  on_the_way: 'on_the_way',
  en_route: 'on_the_way',
  arrivee_client: 'on_the_way',
  confirmee: 'accepted',
  en_cours: 'on_the_way',
  completed: 'completed',
  terminee: 'completed',
  cancelled: 'cancelled',
  annulee: 'cancelled'
};

function normalizeStatus(status) {
  return STATUS_UI_MAP[status] || status || 'pending';
}

function reservationName(item) {
  return item.clientName || item.nom || '';
}

function reservationPhone(item) {
  return item.phone || item.telephone || '';
}

function reservationPickup(item) {
  return item.pickup || item.depart || '';
}

function reservationDropoff(item) {
  return item.dropoff || item.arrivee || '';
}

function reservationDateTime(item) {
  return item.datetime || item.heure || item.date || '';
}

function reservationVehicle(item) {
  return item.vehicleType || item.vehicule || 'berline';
}

function reservationPassengers(item) {
  return item.passengers ?? item.passagers ?? '—';
}

function reservationLuggage(item) {
  return item.luggage ?? item.valises ?? '—';
}

function reservationFlightNumber(item) {
  return item.flightNumber || item.numeroVol || '';
}

function reservationRoundTrip(item) {
  return !!(item.roundTrip || item.allerRetour || item.retourDepart || item.retourArrivee || item.retourHeure || item.returnDate || item.returnTime);
}

function reservationReturnDateTime(item) {
  if (item.retourHeure) return item.retourHeure;
  if (item.returnDate && item.returnTime) return `${item.returnDate}T${item.returnTime}`;
  if (item.returnDate) return item.returnDate;
  return '';
}

function reservationDirection(item) {
  if (item.direction === 'aller' || item.direction === 'retour') return item.direction;
  return reservationRoundTrip(item) ? 'aller-retour' : 'aller-simple';
}

function cleanPhoneNumber(value) {
  return String(value || '').replace(/[^0-9+]/g, '');
}

function reservationSearchBlob(item) {
  return [
    reservationName(item), reservationPhone(item), reservationPickup(item), reservationDropoff(item), item.email, item.notes, item.adminNote, item.driverName
  ].join(' ').toLowerCase();
}

function reservationMapUrl(item) {
  const pickup = reservationPickup(item) || '';
  const dropoff = reservationDropoff(item) || '';
  if (!pickup && !dropoff) return '#';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pickup)}&destination=${encodeURIComponent(dropoff)}`;
}

function reservationWhatsAppUrl(item) {
  const phone = cleanPhoneNumber(reservationPhone(item));
  if (!phone) return '';
  const text = `Bonjour ${reservationName(item) || ''}, Taxi Live Sorel-Tracy pour votre course du ${formatDateTime(reservationDateTime(item))}. Départ: ${reservationPickup(item) || '—'} | Arrivée: ${reservationDropoff(item) || '—'}.`;
  return `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(text)}`;
}

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

function isTomorrow(value) {
  let date = null;
  if (value && typeof value?.toDate === 'function') date = value.toDate();
  else if (value) date = new Date(value);
  if (!date || Number.isNaN(date.getTime())) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.getFullYear() === tomorrow.getFullYear()
    && date.getMonth() === tomorrow.getMonth()
    && date.getDate() === tomorrow.getDate();
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

function getStoredNotificationPreference(key) {
  return localStorage.getItem(key) === "1";
}

function setStoredNotificationPreference(key, value) {
  localStorage.setItem(key, value ? "1" : "0");
}

async function ensureAudioReady() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext.state === 'running';
  } catch {
    return false;
  }
}

async function playNotificationBeep() {
  try {
    const ready = await ensureAudioReady();
    if (!ready || !audioContext) return;
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(660, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
  } catch {}
}

async function showBrowserNotification(title, body, tag) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: tag || 'taxi-live-notification',
    renotify: true
  };

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {}

  try {
    new Notification(title, options);
  } catch {}
}

async function enableNotificationsForRole(role) {
  if (!('Notification' in window)) {
    alert('Les notifications ne sont pas supportées sur cet appareil.');
    return false;
  }

  const permission = await Notification.requestPermission();
  const granted = permission === 'granted';
  if (!granted) {
    alert('Autorise les notifications pour recevoir les nouvelles courses.');
    return false;
  }

  await ensureAudioReady();

  if (role === 'admin') {
    adminNotificationReady = true;
    setStoredNotificationPreference(NOTIFICATION_STORAGE_KEYS.adminEnabled, true);
    updateNotificationButtons();
    await showBrowserNotification('Notifications admin activées', 'Tu recevras une alerte pour chaque nouvelle réservation.', 'admin-enabled');
  } else if (role === 'driver') {
    driverNotificationReady = true;
    setStoredNotificationPreference(NOTIFICATION_STORAGE_KEYS.driverEnabled, true);
    updateNotificationButtons();
    await showBrowserNotification('Notifications chauffeur activées', 'Tu recevras une alerte quand une course te sera assignée.', 'driver-enabled');
  }

  await playNotificationBeep();
  return true;
}

function updateNotificationButtons() {
  const adminBtn = document.getElementById('enableAdminNotificationsBtn');
  if (adminBtn) {
    adminBtn.textContent = adminNotificationReady ? 'Notifications admin activées' : 'Activer les notifications admin';
  }
  const driverBtn = document.getElementById('enableDriverNotificationsBtn');
  if (driverBtn) {
    driverBtn.textContent = driverNotificationReady ? 'Notifications chauffeur activées' : 'Activer les notifications chauffeur';
  }
}

async function notifyAdminNewReservation(item) {
  const title = 'Nouvelle réservation 🚕';
  const body = `${reservationPickup(item) || 'Départ'} → ${reservationDropoff(item) || 'Arrivée'} • ${reservationName(item) || 'Client'}`;
  await showBrowserNotification(title, body, 'admin-new-reservation');
  await playNotificationBeep();
}

async function notifyDriverNewAssignment(item) {
  const title = 'Nouvelle course assignée 🚖';
  const body = `${reservationPickup(item) || 'Départ'} → ${reservationDropoff(item) || 'Arrivée'} • ${formatDateTime(reservationDateTime(item))}`;
  await showBrowserNotification(title, body, 'driver-new-assignment');
  await playNotificationBeep();
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

  adminNotificationReady = getStoredNotificationPreference(NOTIFICATION_STORAGE_KEYS.adminEnabled);
  driverNotificationReady = getStoredNotificationPreference(NOTIFICATION_STORAGE_KEYS.driverEnabled);
  updateNotificationButtons();
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

    const allerRetour = !!document.getElementById('allerRetour')?.checked;
    const retourNotes = [];
    const retourDepart = document.getElementById('retourDepart')?.value?.trim() || '';
    const retourArrivee = document.getElementById('retourArrivee')?.value?.trim() || '';
    const retourHeure = document.getElementById('retourHeure')?.value || '';
    const retourNumeroVol = document.getElementById('retourNumeroVol')?.value?.trim() || '';
    const retourDetails = document.getElementById('retourDetails')?.value?.trim() || '';
    if (allerRetour) {
      if (retourDepart) retourNotes.push(`Retour départ: ${retourDepart}`);
      if (retourArrivee) retourNotes.push(`Retour arrivée: ${retourArrivee}`);
      if (retourHeure) retourNotes.push(`Retour date/heure: ${retourHeure}`);
      if (retourNumeroVol) retourNotes.push(`Vol retour: ${retourNumeroVol}`);
      if (retourDetails) retourNotes.push(`Détails retour: ${retourDetails}`);
    }

    const baseReservation = {
      clientName: document.getElementById('nom')?.value?.trim() || '',
      phone: document.getElementById('telephone')?.value?.trim() || '',
      email: document.getElementById('email')?.value?.trim() || '',
      passengers: Number(document.getElementById('passagers')?.value || 1),
      flightNumber: document.getElementById('numeroVol')?.value?.trim() || '',
      pickup: document.getElementById('depart')?.value?.trim() || '',
      dropoff: document.getElementById('arrivee')?.value?.trim() || '',
      datetime: document.getElementById('heure')?.value || '',
      vehicleType: document.getElementById('vehicule')?.value || 'berline',
      luggage: Number(document.getElementById('valises')?.value || 0),
      notes: document.getElementById('notes')?.value?.trim() || '',
      status: 'pending',
      driverId: null,
      driverName: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      source: 'site-web'
    };

    try {
      if (allerRetour) {
        const groupId = `rt_${Date.now()}`;
        const reservations = db.collection(RESERVATIONS_COLLECTION);
        const allerRef = reservations.doc();
        const retourRef = reservations.doc();
        const batch = db.batch();

        batch.set(allerRef, {
          ...baseReservation,
          direction: 'aller',
          groupId,
          linkedTripId: retourRef.id,
          tripRole: 'round_trip_part'
        });

        batch.set(retourRef, {
          ...baseReservation,
          flightNumber: retourNumeroVol,
          pickup: retourDepart || baseReservation.dropoff,
          dropoff: retourArrivee || baseReservation.pickup,
          datetime: retourHeure || baseReservation.datetime,
          notes: retourDetails || '',
          direction: 'retour',
          groupId,
          linkedTripId: allerRef.id,
          tripRole: 'round_trip_part'
        });

        await batch.commit();
      } else {
        await db.collection(RESERVATIONS_COLLECTION).add({
          ...baseReservation,
          direction: 'aller-simple'
        });
      }
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
    reservationName(item), reservationPhone(item), item.email, reservationFlightNumber(item),
    reservationPickup(item), reservationDropoff(item), item.notes, item.status, item.driverName
  ].join(' ').toLowerCase();
}

function statusLabel(status) {
  const normalized = normalizeStatus(status);
  const labels = {
    pending: 'En attente',
    quote_request: 'Demande de prix',
    assigned: 'Assignée',
    accepted: 'Acceptée',
    on_the_way: 'En route',
    completed: 'Terminée',
    cancelled: 'Annulée'
  };
  return labels[normalized] || normalized || 'En attente';
}


function driverOptionsHtml(selectedId = '') {
  const activeDrivers = driversCache.filter((driver) => driver.active !== false);
  const base = '<option value="">Choisir un chauffeur</option>';
  return base + activeDrivers.map((driver) => `
    <option value="${escapeHtml(driver.id)}" ${driver.id === selectedId ? 'selected' : ''}>${escapeHtml(driver.name || 'Sans nom')} • ${escapeHtml(driver.phone || '')}</option>
  `).join('');
}


function reservationDateObject(item) {
  const value = reservationDateTime(item);
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function reservationIsUrgent(item) {
  if (item.urgent === true || item.priority === 'high') return true;
  const status = normalizeStatus(item.status);
  if (['completed','cancelled'].includes(status)) return false;
  const d = reservationDateObject(item);
  if (!d) return false;
  const diff = d.getTime() - Date.now();
  return diff >= 0 && diff <= 1000 * 60 * 180;
}

function dateFilterMatch(item, mode) {
  if (mode === 'all') return true;
  const d = reservationDateObject(item);
  if (!d) return false;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startAfterTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  if (mode === 'today') return d >= startToday && d < startTomorrow;
  if (mode === 'tomorrow') return d >= startTomorrow && d < startAfterTomorrow;
  if (mode === 'upcoming') return d >= startToday && d < nextWeek;
  if (mode === 'past') return d < startToday;
  return true;
}

function compareReservations(a, b, sortMode) {
  const ad = reservationDateObject(a)?.getTime() || 0;
  const bd = reservationDateObject(b)?.getTime() || 0;
  const ac = a.createdAt?.seconds || 0;
  const bc = b.createdAt?.seconds || 0;
  if (sortMode === 'datetime_desc') return bd - ad;
  if (sortMode === 'created_desc') return bc - ac;
  if (sortMode === 'client') return reservationName(a).localeCompare(reservationName(b), 'fr', {sensitivity:'base'});
  if (sortMode === 'status') return statusLabel(a.status).localeCompare(statusLabel(b.status), 'fr', {sensitivity:'base'}) || ad - bd;
  return ad - bd;
}

function driverFilterOptionsHtml(selected = 'all') {
  const base = ['<option value="all">Tous chauffeurs</option>','<option value="none">Sans chauffeur</option>'];
  driversCache.filter(d => d.active !== false).forEach((driver) => {
    base.push(`<option value="${escapeHtml(driver.id)}" ${selected === driver.id ? 'selected' : ''}>${escapeHtml(driver.name || 'Sans nom')}</option>`);
  });
  return base.join('');
}

function updateDriverFilterOptions() {
  const select = document.getElementById('driverFilter');
  if (!select) return;
  const current = select.value || 'all';
  select.innerHTML = driverFilterOptionsHtml(current);
  if (![...select.options].some(o => o.value === current)) select.value = 'all';
}

function applyQuickFilter(mode) {
  const statusFilter = document.getElementById('statusFilter');
  const dateFilter = document.getElementById('dateFilter');
  const driverFilter = document.getElementById('driverFilter');
  const search = document.getElementById('searchReservation');
  if (search) search.value = '';
  if (statusFilter) statusFilter.value = 'all';
  if (dateFilter) dateFilter.value = 'all';
  if (driverFilter) driverFilter.value = 'all';
  if (mode === 'pending' && statusFilter) statusFilter.value = 'pending';
  if (mode === 'today' && dateFilter) dateFilter.value = 'today';
  if (mode === 'unassigned' && driverFilter) driverFilter.value = 'none';
  if (mode === 'in_progress' && statusFilter) statusFilter.value = 'on_the_way';
  document.querySelectorAll('.quick-filter').forEach((btn) => btn.classList.toggle('active', btn.dataset.quick === mode));
  renderReservations();
}

function resetAdminFilters() {
  ['searchReservation','tripFilter','statusFilter','dateFilter','driverFilter','sortFilter'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'INPUT') el.value = '';
  });
  const trip = document.getElementById('tripFilter'); if (trip) trip.value = 'all';
  const status = document.getElementById('statusFilter'); if (status) status.value = 'all';
  const date = document.getElementById('dateFilter'); if (date) date.value = 'all';
  const driver = document.getElementById('driverFilter'); if (driver) driver.value = 'all';
  const sort = document.getElementById('sortFilter'); if (sort) sort.value = 'datetime_asc';
  applyQuickFilter('all');
}

function renderDriversMiniList() {
  const list = document.getElementById('driversList');
  if (!list) return;
  updateDriverFilterOptions();
  if (!driversCache.length) {
    list.innerHTML = '<p class="small-muted">Aucun chauffeur ajouté.</p>';
    return;
  }

  list.innerHTML = driversCache.map((driver) => {
    const assignedCount = reservationsCache.filter((r) => r.driverId === driver.id && ['assigned','accepted','on_the_way'].includes(normalizeStatus(r.status))).length;
    const doneCount = reservationsCache.filter((r) => r.driverId === driver.id && normalizeStatus(r.status) === 'completed').length;
    return `
      <div class="driver-mini-card ${driver.active === false ? 'driver-offline' : ''}">
        <div>
          <strong>${escapeHtml(driver.name || 'Sans nom')}</strong>
          <p>${escapeHtml(driver.phone || '—')} • ${escapeHtml(driver.car || '—')}</p>
          <div class="driver-mini-stats">
            <span>${driver.active === false ? 'Hors ligne' : 'Actif'}</span>
            <span>${assignedCount} course(s) active(s)</span>
            <span>${doneCount} terminée(s)</span>
          </div>
        </div>
        <div class="driver-mini-actions">
          ${driver.phone ? `<a class="action-link" href="tel:${escapeHtml(String(driver.phone).replace(/\s+/g,''))}"><i class="fa fa-phone"></i>Appeler</a>` : ''}
          <button class="secondary-btn small-btn toggle-driver-btn" data-driver-id="${escapeHtml(driver.id)}" data-driver-active="${driver.active === false ? '0' : '1'}">
            ${driver.active === false ? 'Réactiver' : 'Désactiver'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.toggle-driver-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-driver-id');
      const active = button.getAttribute('data-driver-active') === '1';
      if (!id || !db) return;
      try {
        const driverData = driversCache.find((item) => item.id === id) || {};
        await db.collection(DRIVERS_COLLECTION).doc(id).set({
          name: driverData.name || '',
          email: driverData.email || '',
          phone: driverData.phone || '',
          active: !active,
          createdAt: driverData.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
          carModel: driverData.carModel || driverData.car || '',
          plate: driverData.plate || '',
          photoUrl: driverData.photoUrl || ''
        });
      } catch (error) {
        alert('Impossible de modifier le chauffeur : ' + (error.message || 'erreur'));
      }
    });
  });
}


function reservationDirectionValue(item) {
  const raw = String(item?.direction || '').toLowerCase();
  if (raw.includes('retour')) return 'retour';
  return 'aller';
}

function getFilteredReservationsData() {
  const searchValue = (document.getElementById('searchReservation')?.value || '').toLowerCase();
  const tripFilter = document.getElementById('tripFilter')?.value || 'all';
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  const dateFilter = document.getElementById('dateFilter')?.value || 'all';
  const driverFilter = document.getElementById('driverFilter')?.value || 'all';
  const sortFilter = document.getElementById('sortFilter')?.value || 'datetime_asc';
  const activeQuickFilter = document.querySelector('.quick-filter.active')?.dataset.quick || 'all';

  return reservationsCache.filter((item) => {
    const matchesSearch = reservationSearchBlob(item).includes(searchValue);
    const tripType = item.groupId ? 'aller-retour' : (reservationRoundTrip(item) ? 'aller-retour' : 'aller-simple');
    const matchesTrip = tripFilter === 'all' || tripFilter === tripType;
    const normalizedStatus = normalizeStatus(item.status);
    const matchesStatus = statusFilter === 'all' || normalizedStatus === statusFilter;
    const matchesDate = dateFilterMatch(item, dateFilter);
    const matchesDriver = driverFilter === 'all' || (driverFilter === 'none' ? !item.driverId : item.driverId === driverFilter);
    const matchesQuick = activeQuickFilter === 'all'
      || (activeQuickFilter === 'urgent' ? reservationIsUrgent(item) : true);
    return matchesSearch && matchesTrip && matchesStatus && matchesDate && matchesDriver && matchesQuick;
  }).sort((a, b) => compareReservations(a, b, sortFilter));
}

function exportReservationsCsv() {
  const rows = getFilteredReservationsData();
  const headers = [
    'Client','Telephone','Email','DateHeure','Direction','Statut','Chauffeur',
    'Depart','Arrivee','Passagers','Valises','Vol','Urgent','Groupe','CourseLiee','NoteAdmin'
  ];
  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const lines = [headers.join(',')];
  rows.forEach((item) => {
    lines.push([
      reservationName(item) || '',
      reservationPhone(item) || '',
      item.email || '',
      formatDateTime(reservationDateTime(item)),
      reservationDirection(item),
      statusLabel(item.status),
      item.driverName || '',
      reservationPickup(item) || '',
      reservationDropoff(item) || '',
      reservationPassengers(item),
      reservationLuggage(item),
      reservationFlightNumber(item) || '',
      reservationIsUrgent(item) ? 'Oui' : 'Non',
      item.groupId || '',
      item.linkedTripId || '',
      item.adminNote || item.notes || ''
    ].map(escapeCsv).join(','));
  });
  const csv = '\ufeff' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dispatch-taxi-live-sorel-tracy.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function printDispatchPlanning() {
  const rows = getFilteredReservationsData();
  const body = rows.map((item) => `
    <tr>
      <td>${escapeHtml(formatDateTime(reservationDateTime(item)))}</td>
      <td>${escapeHtml(reservationName(item) || '—')}</td>
      <td>${escapeHtml(reservationPhone(item) || '—')}</td>
      <td>${escapeHtml(reservationPickup(item) || '—')}</td>
      <td>${escapeHtml(reservationDropoff(item) || '—')}</td>
      <td>${escapeHtml(reservationDirection(item))}</td>
      <td>${escapeHtml(statusLabel(item.status))}</td>
      <td>${escapeHtml(item.driverName || 'Sans chauffeur')}</td>
    </tr>
  `).join('');
  const win = window.open('', '_blank');
  if (!win) return alert('Impossible d’ouvrir la fenêtre d’impression.');
  win.document.write(`
    <html><head><title>Planning dispatch</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111}
      h1{margin:0 0 8px}
      p{margin:0 0 18px;color:#555}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left;vertical-align:top}
      th{background:#f4f4f4}
    </style></head><body>
      <h1>Planning Dispatch - Taxi Live Sorel-Tracy</h1>
      <p>Généré le ${escapeHtml(formatDateTime(new Date()))}</p>
      <table>
        <thead><tr><th>Date/heure</th><th>Client</th><th>Téléphone</th><th>Départ</th><th>Arrivée</th><th>Direction</th><th>Statut</th><th>Chauffeur</th></tr></thead>
        <tbody>${body || '<tr><td colspan="8">Aucune réservation.</td></tr>'}</tbody>
      </table>
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function renderTodayTimeline() {
  const box = document.getElementById('todayTimeline');
  if (!box) return;
  const items = reservationsCache
    .filter((item) => {
      const d = reservationDateObject(item);
      return d && isToday(d);
    })
    .sort((a,b) => compareReservations(a,b,'datetime_asc'))
    .slice(0, 12);

  if (!items.length) {
    box.innerHTML = '<p class="small-muted">Aucune course aujourd’hui.</p>';
    return;
  }

  box.innerHTML = items.map((item) => {
    const d = reservationDateObject(item);
    const overdue = d && d.getTime() < Date.now() && !['completed','cancelled'].includes(normalizeStatus(item.status));
    const hhmm = d ? d.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit' }) : '—';
    return `
      <div class="timeline-item ${overdue ? 'overdue' : ''}">
        <div class="timeline-time">${escapeHtml(hhmm)}</div>
        <div class="timeline-route">
          <strong>${escapeHtml(reservationName(item) || 'Client')}</strong>
          ${escapeHtml(reservationPickup(item) || '—')} → ${escapeHtml(reservationDropoff(item) || '—')}
        </div>
        <div class="timeline-status">${escapeHtml(item.driverName || statusLabel(item.status))}</div>
      </div>
    `;
  }).join('');
}

function renderDriverLoadBoard() {
  const box = document.getElementById('driverLoadBoard');
  if (!box) return;
  if (!driversCache.length) {
    box.innerHTML = '<p class="small-muted">Aucun chauffeur ajouté.</p>';
    return;
  }
  const activeStatuses = ['assigned','accepted','on_the_way'];
  const totals = driversCache.map((driver) => {
    const activeCount = reservationsCache.filter((r) => r.driverId === driver.id && activeStatuses.includes(normalizeStatus(r.status))).length;
    const completedCount = reservationsCache.filter((r) => r.driverId === driver.id && normalizeStatus(r.status) === 'completed').length;
    return { driver, activeCount, completedCount };
  });
  const maxLoad = Math.max(1, ...totals.map((x) => x.activeCount));
  box.innerHTML = totals.map(({driver, activeCount, completedCount}) => {
    const pct = Math.max(8, Math.round((activeCount / maxLoad) * 100));
    return `
      <div class="driver-load-item">
        <div class="driver-load-top">
          <div>
            <strong>${escapeHtml(driver.name || 'Sans nom')}</strong>
            <div class="driver-load-meta">
              <span>${driver.active === false ? 'Hors ligne' : 'Actif'}</span>
              <span>${escapeHtml(driver.phone || '—')}</span>
              <span>${escapeHtml(driver.car || driver.carModel || '—')}</span>
            </div>
          </div>
          <div><strong>${activeCount}</strong> active(s)</div>
        </div>
        <div class="load-bar"><div class="load-bar-fill" style="width:${pct}%"></div></div>
        <div class="driver-load-meta" style="margin-top:.45rem;">
          <span>${completedCount} terminée(s)</span>
        </div>
      </div>
    `;
  }).join('');
}

function updateOperationsSummary() {
  const nextHour = reservationsCache.filter((item) => {
    const d = reservationDateObject(item);
    return d && d.getTime() >= Date.now() && d.getTime() <= Date.now() + 3600 * 1000 && !['completed','cancelled'].includes(normalizeStatus(item.status));
  }).length;
  const tomorrow = reservationsCache.filter((item) => dateFilterMatch(item, 'tomorrow')).length;
  const cancelled = reservationsCache.filter((item) => normalizeStatus(item.status) === 'cancelled').length;
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  setText('statNextHour', nextHour);
  setText('statTomorrow', tomorrow);
  setText('statCancelled', cancelled);
  renderTodayTimeline();
  renderDriverLoadBoard();
  renderPlanningBoards();
  renderClientsBoard();
}


function renderPlanningBoards() {
  const upcomingBoard = document.getElementById('upcomingTripsBoard');
  const delayedBoard = document.getElementById('delayedTripsBoard');
  const routeGroupsBoard = document.getElementById('routeGroupsBoard');
  const now = Date.now();
  if (upcomingBoard) {
    const upcoming = reservationsCache
      .map((item) => ({ item, d: reservationDateObject(item) }))
      .filter(({ d, item }) => d && d.getTime() >= now && d.getTime() <= now + 24 * 3600 * 1000 && !['completed','cancelled'].includes(normalizeStatus(item.status)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    upcomingBoard.innerHTML = upcoming.length ? upcoming.map(({ item, d }) => `
      <div class="timeline-item upcoming">
        <strong>${escapeHtml(formatDateTime(d))}</strong>
        <span>${escapeHtml(reservationName(item) || 'Sans nom')} • ${escapeHtml(reservationPickup(item) || '—')} → ${escapeHtml(reservationDropoff(item) || '—')}</span>
      </div>`).join('') : '<p class="small-muted">Aucune course dans les prochaines 24h.</p>';
  }
  if (delayedBoard) {
    const delayed = reservationsCache
      .map((item) => ({ item, d: reservationDateObject(item) }))
      .filter(({ d, item }) => d && d.getTime() < now && !['completed','cancelled'].includes(normalizeStatus(item.status)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    delayedBoard.innerHTML = delayed.length ? delayed.map(({ item, d }) => `
      <div class="timeline-item alert">
        <strong>${escapeHtml(formatDateTime(d))}</strong>
        <span>${escapeHtml(reservationName(item) || 'Sans nom')} • ${escapeHtml(item.driverName || 'Sans chauffeur')}</span>
      </div>`).join('') : '<p class="small-muted">Aucune course en retard.</p>';
  }
  if (routeGroupsBoard) {
    const groups = {};
    reservationsCache.forEach((item) => {
      const key = item.groupId || '';
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    const entries = Object.entries(groups).sort((a,b)=>b[1].length-a[1].length);
    routeGroupsBoard.innerHTML = entries.length ? entries.map(([groupId, rows]) => `
      <div class="route-group-card">
        <h4>Groupe ${escapeHtml(groupId)}</h4>
        <div class="route-group-list">${rows.sort((a,b)=>compareReservations(a,b,'datetime_asc')).map((item)=>`<div>${escapeHtml(formatDateTime(reservationDateTime(item)))} • ${escapeHtml(reservationDirection(item))} • ${escapeHtml(reservationPickup(item) || '—')} → ${escapeHtml(reservationDropoff(item) || '—')}</div>`).join('')}</div>
      </div>`).join('') : '<p class="small-muted">Aucun aller-retour lié pour le moment.</p>';
  }
}

function renderClientsBoard() {
  const directory = document.getElementById('clientDirectory');
  const recent = document.getElementById('clientRecentActivity');
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
  const map = new Map();
  reservationsCache.forEach((item) => {
    const name = reservationName(item) || 'Client sans nom';
    const phone = reservationPhone(item) || '';
    const email = item.email || '';
    const key = `${name.toLowerCase()}|${phone}|${email.toLowerCase()}`;
    const dt = reservationDateObject(item);
    if (!map.has(key)) map.set(key, { name, phone, email, total: 0, urgent: 0, upcoming: null, lastDate: null, lastItem: null });
    const row = map.get(key);
    row.total += 1;
    if (reservationIsUrgent(item)) row.urgent += 1;
    if (dt && (!row.lastDate || dt > row.lastDate)) { row.lastDate = dt; row.lastItem = item; }
    if (dt && dt.getTime() >= Date.now() && (!row.upcoming || dt < row.upcoming)) row.upcoming = dt;
  });
  const clients = Array.from(map.values()).sort((a,b)=> (b.lastDate?.getTime()||0) - (a.lastDate?.getTime()||0));
  setText('clientStatTotal', clients.length);
  setText('clientStatRecent', clients.filter(c => c.lastDate && c.lastDate.getTime() >= Date.now() - 30*24*3600*1000).length);
  setText('clientStatVip', clients.filter(c => c.total >= 3).length);
  setText('clientStatMissingPhone', clients.filter(c => !c.phone).length);
  if (directory) {
    directory.innerHTML = clients.length ? clients.slice(0,50).map((client) => `
      <article class="client-card">
        <div class="client-card-top">
          <div><h4>${escapeHtml(client.name)}</h4><div class="small-muted">${escapeHtml(client.email || 'Sans email')}</div></div>
          <span class="badge ${client.total >= 3 ? 'urgent' : 'assigned'}">${client.total} course${client.total>1?'s':''}</span>
        </div>
        <div class="client-meta">
          <div><strong>Téléphone :</strong> ${escapeHtml(client.phone || '—')}</div>
          <div><strong>Dernière activité :</strong> ${escapeHtml(client.lastDate ? formatDateTime(client.lastDate) : '—')}</div>
          <div><strong>Prochain trajet :</strong> ${escapeHtml(client.upcoming ? formatDateTime(client.upcoming) : 'Aucun')}</div>
          <div><strong>Urgences :</strong> ${escapeHtml(client.urgent)}</div>
        </div>
        <div class="client-actions">${client.phone ? `<a class="secondary-btn small-btn" href="tel:${escapeHtml(client.phone)}">Appeler</a>` : ''}${client.email ? `<a class="secondary-btn small-btn" href="mailto:${escapeHtml(client.email)}">Email</a>` : ''}</div>
      </article>`).join('') : '<p class="small-muted">Aucun client enregistré.</p>';
  }
  if (recent) {
    recent.innerHTML = clients.length ? clients.slice(0,12).map((client) => `
      <div class="timeline-item">
        <strong>${escapeHtml(client.name)}</strong>
        <span>${escapeHtml(client.lastDate ? formatDateTime(client.lastDate) : '—')} • ${escapeHtml(client.lastItem ? `${reservationPickup(client.lastItem) || '—'} → ${reservationDropoff(client.lastItem) || '—'}` : 'Aucun trajet')}</span>
      </div>`).join('') : '<p class="small-muted">Aucune activité récente.</p>';
  }
}

function renderReservations() {
  const list = document.getElementById('reservationsList');
  if (!list) return;

  const searchValue = (document.getElementById('searchReservation')?.value || '').toLowerCase();
  const tripFilter = document.getElementById('tripFilter')?.value || 'all';
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  const dateFilter = document.getElementById('dateFilter')?.value || 'all';
  const driverFilter = document.getElementById('driverFilter')?.value || 'all';
  const sortFilter = document.getElementById('sortFilter')?.value || 'datetime_asc';
  const activeQuickFilter = document.querySelector('.quick-filter.active')?.dataset.quick || 'all';
  const emptyState = document.getElementById('emptyState');

  updateDriverFilterOptions();

  const filtered = getFilteredReservationsData();
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  const groupedRoundTrips = new Set(reservationsCache.filter((item) => item.groupId).map((item) => item.groupId)).size;
  const legacyRoundTrips = reservationsCache.filter((item) => !item.groupId && (item.roundTrip || item.allerRetour)).length;
  const inProgressCount = reservationsCache.filter((item) => ['accepted','on_the_way'].includes(normalizeStatus(item.status))).length;
  const completedCount = reservationsCache.filter((item) => normalizeStatus(item.status) === 'completed').length;
  const urgentCount = reservationsCache.filter((item) => reservationIsUrgent(item)).length;
  const noDriverCount = reservationsCache.filter((item) => !item.driverId && !['completed','cancelled'].includes(normalizeStatus(item.status))).length;

  setText('statTotal', reservationsCache.length);
  setText('statRoundTrip', groupedRoundTrips + legacyRoundTrips);
  setText('statToday', reservationsCache.filter((item) => isToday(item.createdAt || item.createdAtClient || item.datetime)).length);
  setText('statPending', reservationsCache.filter((item) => normalizeStatus(item.status) === 'pending').length);
  setText('statAssigned', reservationsCache.filter((item) => normalizeStatus(item.status) === 'assigned').length);
  setText('statInProgress', inProgressCount);
  setText('statCompleted', completedCount);
  setText('statUrgent', urgentCount);
  setText('statNoDriver', noDriverCount);
  setText('statDrivers', driversCache.filter((driver) => driver.active !== false).length);
  setText('reservationsSummary', `${filtered.length} réservation(s) affichée(s)`);

  const nextUpcoming = reservationsCache
    .filter((item) => {
      const d = reservationDateObject(item);
      return d && d.getTime() >= Date.now() && !['completed','cancelled'].includes(normalizeStatus(item.status));
    })
    .sort((a,b) => compareReservations(a,b,'datetime_asc'))[0];
  const nextSummary = document.getElementById('nextCourseSummary');
  if (nextSummary) {
    nextSummary.textContent = nextUpcoming
      ? `Prochaine course : ${reservationName(nextUpcoming) || 'Client'} • ${formatDateTime(reservationDateTime(nextUpcoming))}`
      : 'Aucune course planifiée.';
  }

  renderDriversMiniList();
  updateOperationsSummary();

  if (!filtered.length) {
    list.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  list.innerHTML = filtered.map((item) => {
    const normalizedStatus = normalizeStatus(item.status);
    const urgent = reservationIsUrgent(item);
    const phone = (reservationPhone(item) || '').replace(/\s+/g, '');
    const pickup = reservationPickup(item) || '';
    const dropoff = reservationDropoff(item) || '';
    const mapUrl = pickup || dropoff
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pickup)}&destination=${encodeURIComponent(dropoff)}`
      : '#';
    return `
      <article class="reservation-card status-${escapeHtml(normalizedStatus)} ${urgent ? 'urgent' : ''}">
        <div class="reservation-header">
          <div>
            <h3>${escapeHtml(reservationName(item) || 'Sans nom')}</h3>
            <div class="reservation-meta">
              <span class="badge status-${escapeHtml(normalizedStatus)}">${escapeHtml(statusLabel(item.status))}</span>
              <span class="badge direction">${escapeHtml(reservationDirection(item))}</span>
              ${urgent ? '<span class="badge urgent"><i class="fa fa-bolt"></i>Urgente</span>' : ''}
              <span class="badge driver">${escapeHtml(item.driverName || 'Sans chauffeur')}</span>
              ${(() => { const d = reservationDateObject(item); if (!d) return ''; const diff = d.getTime() - Date.now(); const hours = Math.round(diff / 3600000); if (diff < 0 && !['completed','cancelled'].includes(normalizeStatus(item.status))) return '<span class="badge urgent">En retard</span>'; if (hours >= 0 && hours <= 2) return '<span class="badge status-assigned">Bientôt</span>'; return ''; })()}
            </div>
          </div>
          <button class="danger-btn small-btn" data-delete-id="${escapeHtml(item.id)}">Supprimer</button>
        </div>

        <div class="reservation-top-actions">
          ${phone ? `<a class="action-link" href="tel:${escapeHtml(phone)}"><i class="fa fa-phone"></i>Appeler</a>` : ''}
          ${reservationWhatsAppUrl(item) ? `<a class="action-link" target="_blank" rel="noopener" href="${reservationWhatsAppUrl(item)}"><i class="fa fa-brands fa-whatsapp"></i>WhatsApp</a>` : ''}
          ${item.email ? `<a class="action-link" href="mailto:${escapeHtml(item.email)}"><i class="fa fa-envelope"></i>Email</a>` : ''}
          ${pickup || dropoff ? `<a class="action-link" href="${mapUrl}" target="_blank" rel="noopener"><i class="fa fa-route"></i>Voir trajet</a>` : ''}
          <button type="button" class="action-link copy-dispatch-btn" data-copy-dispatch-id="${escapeHtml(item.id)}"><i class="fa fa-copy"></i>Copier</button>
          ${!item.driverId ? `<button type="button" class="action-link auto-assign-btn" data-auto-assign-id="${escapeHtml(item.id)}"><i class="fa fa-user-plus"></i>Assigner dispo</button>` : ''}
          <button type="button" class="action-link save-urgent-btn" data-urgent-id="${escapeHtml(item.id)}" data-urgent-value="${item.urgent ? '0' : '1'}"><i class="fa fa-star"></i>${item.urgent ? 'Retirer urgence' : 'Marquer urgent'}</button>
        </div>

        <h4 class="card-section-title">Détails course</h4>
        <div class="reservation-grid compact-grid">
          <div><strong>Téléphone :</strong> ${escapeHtml(reservationPhone(item) || '—')}</div>
          <div><strong>Email :</strong> ${escapeHtml(item.email || '—')}</div>
          <div><strong>Passagers :</strong> ${escapeHtml(reservationPassengers(item))}</div>
          <div><strong>Valises :</strong> ${escapeHtml(reservationLuggage(item))}</div>
          <div><strong>Vol :</strong> ${escapeHtml(reservationFlightNumber(item) || '—')}</div>
          <div><strong>Date/heure :</strong> ${escapeHtml(formatDateTime(reservationDateTime(item)))}</div>
          <div><strong>Départ :</strong> ${escapeHtml(pickup || '—')}</div>
          <div><strong>Arrivée :</strong> ${escapeHtml(dropoff || '—')}</div>
          <div><strong>Créée le :</strong> ${escapeHtml(formatDateTime(item.createdAt || item.createdAtClient))}</div>
          <div><strong>Source :</strong> ${escapeHtml(item.source || 'site-web')}</div>
          <div><strong>Groupe :</strong> ${escapeHtml(item.groupId || '—')}</div>
          <div><strong>Course liée :</strong> ${escapeHtml(item.linkedTripId || '—')}</div>
        </div>

        <h4 class="card-section-title">Gestion dispatch</h4>
        <div class="reservation-grid compact-grid">
          <div>
            <strong>Assigner :</strong>
            <select class="driver-select" data-driver-id="${escapeHtml(item.id)}">${driverOptionsHtml(item.driverId || '')}</select>
          </div>
          <div>
            <strong>Statut :</strong>
            <select class="status-select" data-status-id="${escapeHtml(item.id)}">
              <option value="pending" ${normalizedStatus === 'pending' ? 'selected' : ''}>En attente</option>
              <option value="assigned" ${normalizedStatus === 'assigned' ? 'selected' : ''}>Assignée</option>
              <option value="accepted" ${normalizedStatus === 'accepted' ? 'selected' : ''}>Acceptée</option>
              <option value="on_the_way" ${normalizedStatus === 'on_the_way' ? 'selected' : ''}>En route</option>
              <option value="completed" ${normalizedStatus === 'completed' ? 'selected' : ''}>Terminée</option>
              <option value="cancelled" ${normalizedStatus === 'cancelled' ? 'selected' : ''}>Annulée</option>
            </select>
          </div>
          <div class="admin-note-box" style="grid-column:1/-1;">
            <label><input type="checkbox" class="urgent-toggle" data-urgent-checkbox-id="${escapeHtml(item.id)}" ${item.urgent ? 'checked' : ''}> Priorité haute / urgence</label>
            <textarea class="admin-note-text" data-note-id="${escapeHtml(item.id)}" placeholder="Notes admin / consignes chauffeur / infos client...">${escapeHtml(item.adminNote || item.notes || '')}</textarea>
            <div class="reservation-inline-actions" style="margin-top:.6rem;">
              <button type="button" class="secondary-btn small-btn save-note-btn" data-save-note-id="${escapeHtml(item.id)}">Enregistrer la note</button>
            </div>
          </div>
        </div>

        <div class="quick-status-row" style="margin-top:1rem;">
          <button type="button" class="quick-status-btn" data-quick-status="pending" data-quick-id="${escapeHtml(item.id)}">Remettre en attente</button>
          <button type="button" class="quick-status-btn" data-quick-status="assigned" data-quick-id="${escapeHtml(item.id)}">Assigner</button>
          <button type="button" class="quick-status-btn" data-quick-status="on_the_way" data-quick-id="${escapeHtml(item.id)}">En route</button>
          <button type="button" class="quick-status-btn" data-quick-status="completed" data-quick-id="${escapeHtml(item.id)}">Terminer</button>
        </div>
      </article>
    `;
  }).join('');

  list.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-delete-id');
      if (!id || !db) return;
      if (!confirm('Supprimer cette réservation ?')) return;
      try { await db.collection(RESERVATIONS_COLLECTION).doc(id).delete(); }
      catch (error) { alert('Suppression impossible : ' + (error.message || 'erreur')); }
    });
  });

  list.querySelectorAll('[data-status-id]').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-status-id');
      if (!id || !db) return;
      try { await db.collection(RESERVATIONS_COLLECTION).doc(id).update({ status: select.value }); }
      catch (error) { alert('Mise à jour impossible : ' + (error.message || 'erreur')); }
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
          driverId: driverId || null,
          driverName: driver?.name || '',
          status: driverId ? 'assigned' : 'pending'
        });
      } catch (error) {
        alert('Assignation impossible : ' + (error.message || 'erreur'));
      }
    });
  });

  list.querySelectorAll('.copy-dispatch-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-copy-dispatch-id');
      const item = filtered.find((entry) => entry.id === id);
      if (!item) return;
      const text = `Taxi Live Dispatch
Client: ${reservationName(item) || '—'}
Téléphone: ${reservationPhone(item) || '—'}
Date: ${formatDateTime(reservationDateTime(item))}
Départ: ${reservationPickup(item) || '—'}
Arrivée: ${reservationDropoff(item) || '—'}
Chauffeur: ${item.driverName || 'Non assigné'}
Statut: ${statusLabel(item.status)}`;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copié';
        setTimeout(() => { button.innerHTML = '<i class="fa fa-copy"></i>Copier'; }, 900);
      } catch (error) {
        alert('Copie impossible');
      }
    });
  });

  list.querySelectorAll('.auto-assign-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-auto-assign-id');
      if (!id || !db) return;
      const availableDrivers = driversCache.filter((driver) => driver.active !== false).sort((a,b) => {
        const ac = reservationsCache.filter((r) => r.driverId === a.id && ['assigned','accepted','on_the_way'].includes(normalizeStatus(r.status))).length;
        const bc = reservationsCache.filter((r) => r.driverId === b.id && ['assigned','accepted','on_the_way'].includes(normalizeStatus(r.status))).length;
        return ac - bc;
      });
      const driver = availableDrivers[0];
      if (!driver) {
        alert('Aucun chauffeur actif disponible.');
        return;
      }
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).update({
          driverId: driver.id,
          driverName: driver.name || '',
          status: 'assigned'
        });
      } catch (error) {
        alert('Assignation impossible : ' + (error.message || 'erreur'));
      }
    });
  });

  list.querySelectorAll('.save-note-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-save-note-id');
      const textarea = list.querySelector(`.admin-note-text[data-note-id="${id}"]`);
      const urgent = list.querySelector(`.urgent-toggle[data-urgent-checkbox-id="${id}"]`)?.checked || false;
      if (!id || !db || !textarea) return;
      button.disabled = true;
      const old = button.textContent;
      button.textContent = 'Enregistrement...';
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).update({ adminNote: textarea.value.trim(), urgent });
        button.textContent = 'Enregistré';
        setTimeout(() => { button.textContent = old; button.disabled = false; }, 800);
      } catch (error) {
        button.disabled = false;
        button.textContent = old;
        alert('Enregistrement impossible : ' + (error.message || 'erreur'));
      }
    });
  });

  list.querySelectorAll('.save-urgent-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-urgent-id');
      const next = button.getAttribute('data-urgent-value') === '1';
      if (!id || !db) return;
      try { await db.collection(RESERVATIONS_COLLECTION).doc(id).update({ urgent: next }); }
      catch (error) { alert('Mise à jour impossible : ' + (error.message || 'erreur')); }
    });
  });

  list.querySelectorAll('[data-quick-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-quick-id');
      const status = button.getAttribute('data-quick-status');
      if (!id || !db || !status) return;
      try { await db.collection(RESERVATIONS_COLLECTION).doc(id).update({ status }); }
      catch (error) { alert('Mise à jour impossible : ' + (error.message || 'erreur')); }
    });
  });
}

function applyDriverQuickFilter(mode = 'all') {
  driverQuickFilter = mode;
  document.querySelectorAll('.driver-quick-filter').forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.driverQuick || 'all') === mode);
  });
  renderDriverReservations();
}

function driverMatchesFilters(item) {
  const search = (document.getElementById('driverSearchReservation')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('driverStatusFilter')?.value || 'all';
  const dateFilter = document.getElementById('driverDateFilter')?.value || 'all';
  const status = normalizeStatus(item.status);
  const textOk = !search || reservationSearchBlob(item).includes(search);
  const statusOk = statusFilter === 'all' || status === statusFilter;
  const d = reservationDateObject(item);
  const todayOk = dateFilter === 'all' || (
    dateFilter === 'today' ? isToday(d) :
    dateFilter === 'tomorrow' ? isTomorrow(d) :
    dateFilter === 'upcoming' ? (d && d.getTime() >= Date.now()) :
    dateFilter === 'past' ? (d && d.getTime() < Date.now()) : true
  );
  let quickOk = true;
  if (driverQuickFilter === 'today') quickOk = isToday(d);
  else if (driverQuickFilter === 'active') quickOk = ['assigned','accepted','on_the_way'].includes(status);
  else if (driverQuickFilter === 'urgent') quickOk = reservationIsUrgent(item);
  else if (driverQuickFilter === 'done') quickOk = status === 'completed';
  return textOk && statusOk && todayOk && quickOk;
}

function updateDriverProfileUi() {
  const data = currentDriverDoc || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '—';
  };
  setText('driverProfileName', data.name || currentUser?.email || '—');
  setText('driverProfilePhone', data.phone || '—');
  setText('driverProfileCar', data.carModel || data.car || '—');
  setText('driverProfileUid', data.id || currentUser?.uid || '—');
  const badge = document.getElementById('driverAvailabilityBadge');
  const btn = document.getElementById('driverAvailabilityBtn');
  const available = data.active !== false;
  if (badge) {
    badge.textContent = available ? 'Actif' : 'Hors ligne';
    badge.className = `badge ${available ? 'status-assigned' : 'urgent'}`;
  }
  if (btn) btn.textContent = available ? 'Passer hors ligne' : 'Passer en ligne';
}

function renderDriverNextTripBox(items) {
  const box = document.getElementById('driverNextTripBox');
  if (!box) return;
  const next = [...items]
    .filter((item) => {
      const d = reservationDateObject(item);
      return d && normalizeStatus(item.status) !== 'completed' && normalizeStatus(item.status) !== 'cancelled';
    })
    .sort((a,b) => compareReservations(a,b,'datetime_asc'))[0];
  if (!next) {
    box.innerHTML = '<p class="small-muted">Aucune course active pour le moment.</p>';
    return;
  }
  const phone = cleanPhoneNumber(reservationPhone(next));
  const wa = reservationWhatsAppUrl(next);
  box.innerHTML = `
    <div class="next-trip-content">
      <div class="next-trip-main">
        <strong>${escapeHtml(reservationName(next) || 'Client')}</strong>
        <span>${escapeHtml(formatDateTime(reservationDateTime(next)))}</span>
      </div>
      <div class="next-trip-route">${escapeHtml(reservationPickup(next) || '—')} <i class="fa fa-arrow-right"></i> ${escapeHtml(reservationDropoff(next) || '—')}</div>
      <div class="reservation-top-actions compact-actions">
        ${phone ? `<a class="action-link" href="tel:${escapeHtml(phone)}"><i class="fa fa-phone"></i>Appeler</a>` : ''}
        ${wa ? `<a class="action-link" target="_blank" rel="noopener" href="${wa}"><i class="fa fa-brands fa-whatsapp"></i>WhatsApp</a>` : ''}
        <a class="action-link" target="_blank" rel="noopener" href="${reservationMapUrl(next)}"><i class="fa fa-route"></i>Trajet</a>
      </div>
    </div>`;
}

function renderDriverReservations() {
  const list = document.getElementById('driverReservationsList');
  if (!list) return;
  const emptyState = document.getElementById('driverEmptyState');

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };

  const todayCount = driverReservationsCache.filter((item) => isToday(reservationDateObject(item))).length;
  const urgentCount = driverReservationsCache.filter((item) => reservationIsUrgent(item)).length;
  setText('driverStatTotal', driverReservationsCache.length);
  setText('driverStatAssigned', driverReservationsCache.filter((item) => normalizeStatus(item.status) === 'assigned').length);
  setText('driverStatInProgress', driverReservationsCache.filter((item) => ['accepted', 'on_the_way'].includes(normalizeStatus(item.status))).length);
  setText('driverStatDone', driverReservationsCache.filter((item) => normalizeStatus(item.status) === 'completed').length);
  setText('driverStatToday', todayCount);
  setText('driverStatUrgent', urgentCount);

  updateDriverProfileUi();
  renderDriverNextTripBox(driverReservationsCache);

  const filtered = driverReservationsCache.filter(driverMatchesFilters).sort((a,b) => compareReservations(a,b,'datetime_asc'));

  if (!filtered.length) {
    list.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  list.innerHTML = filtered.map((item) => {
    const phone = cleanPhoneNumber(reservationPhone(item));
    const wa = reservationWhatsAppUrl(item);
    const status = normalizeStatus(item.status);
    const late = (() => {
      const d = reservationDateObject(item);
      return d && d.getTime() < Date.now() && !['completed','cancelled'].includes(status);
    })();
    return `
    <article class="reservation-card driver-reservation-card status-${escapeHtml(status)} ${reservationIsUrgent(item) ? 'urgent' : ''}">
      <div class="reservation-header">
        <div>
          <h3>${escapeHtml(reservationName(item) || 'Sans nom')}</h3>
          <div class="reservation-meta">
            <span class="badge status-${escapeHtml(status)}">${escapeHtml(statusLabel(item.status))}</span>
            <span class="badge direction">${escapeHtml(reservationDirection(item))}</span>
            ${reservationIsUrgent(item) ? '<span class="badge urgent"><i class="fa fa-bolt"></i>Urgente</span>' : ''}
            ${late ? '<span class="badge urgent">En retard</span>' : ''}
          </div>
        </div>
        <div class="driver-card-time">${escapeHtml(formatDateTime(reservationDateTime(item)))}</div>
      </div>
      <div class="driver-route-panel">
        <div><strong>Départ</strong><span>${escapeHtml(reservationPickup(item) || '—')}</span></div>
        <div class="route-arrow"><i class="fa fa-arrow-right"></i></div>
        <div><strong>Arrivée</strong><span>${escapeHtml(reservationDropoff(item) || '—')}</span></div>
      </div>
      <div class="reservation-top-actions">
        ${phone ? `<a class="action-link" href="tel:${escapeHtml(phone)}"><i class="fa fa-phone"></i>Appeler client</a>` : ''}
        ${wa ? `<a class="action-link" target="_blank" rel="noopener" href="${wa}"><i class="fa fa-brands fa-whatsapp"></i>WhatsApp</a>` : ''}
        <a class="action-link" target="_blank" rel="noopener" href="${reservationMapUrl(item)}"><i class="fa fa-route"></i>Itinéraire</a>
        <button type="button" class="action-link copy-trip-btn" data-copy-id="${escapeHtml(item.id)}"><i class="fa fa-copy"></i>Copier</button>
      </div>
      <div class="reservation-grid compact-grid">
        <div><strong>Téléphone :</strong> ${escapeHtml(reservationPhone(item) || '—')}</div>
        <div><strong>Passagers :</strong> ${escapeHtml(reservationPassengers(item))}</div>
        <div><strong>Valises :</strong> ${escapeHtml(reservationLuggage(item))}</div>
        <div><strong>Vol :</strong> ${escapeHtml(reservationFlightNumber(item) || '—')}</div>
        <div><strong>Groupe :</strong> ${escapeHtml(item.groupId || '—')}</div>
        <div><strong>Course liée :</strong> ${escapeHtml(item.linkedTripId || '—')}</div>
        <div style="grid-column:1/-1;"><strong>Notes :</strong> ${escapeHtml(item.adminNote || item.notes || '—')}</div>
      </div>
      <div class="driver-status-actions">
        <button type="button" class="quick-status-btn driver-quick-status-btn" data-driver-status-id="${escapeHtml(item.id)}" data-driver-status-value="accepted">Accepter</button>
        <button type="button" class="quick-status-btn driver-quick-status-btn" data-driver-status-id="${escapeHtml(item.id)}" data-driver-status-value="on_the_way">En route</button>
        <button type="button" class="quick-status-btn driver-quick-status-btn" data-driver-status-id="${escapeHtml(item.id)}" data-driver-status-value="completed">Terminer</button>
      </div>
      <div class="reservation-grid compact-grid" style="margin-top:.8rem;">
        <div>
          <strong>Statut :</strong>
          <select class="driver-status-select" data-status-id="${escapeHtml(item.id)}">
            <option value="assigned" ${status === 'assigned' ? 'selected' : ''}>Assignée</option>
            <option value="accepted" ${status === 'accepted' ? 'selected' : ''}>Acceptée</option>
            <option value="on_the_way" ${status === 'on_the_way' ? 'selected' : ''}>En route</option>
            <option value="completed" ${status === 'completed' ? 'selected' : ''}>Terminée</option>
            <option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Annulée</option>
          </select>
        </div>
      </div>
    </article>`;
  }).join('');

  list.querySelectorAll('.driver-status-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.getAttribute('data-status-id');
      if (!id || !db) return;
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).update({ status: select.value });
      } catch (error) {
        alert('Mise à jour impossible : ' + (error.message || 'erreur'));
      }
    });
  });

  list.querySelectorAll('.driver-quick-status-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-driver-status-id');
      const value = button.getAttribute('data-driver-status-value');
      if (!id || !db || !value) return;
      try {
        await db.collection(RESERVATIONS_COLLECTION).doc(id).update({ status: value });
      } catch (error) {
        alert('Mise à jour impossible : ' + (error.message || 'erreur'));
      }
    });
  });

  list.querySelectorAll('.copy-trip-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-copy-id');
      const item = filtered.find((entry) => entry.id === id);
      if (!item) return;
      const text = `Taxi Live
Client: ${reservationName(item) || '—'}
Téléphone: ${reservationPhone(item) || '—'}
Date: ${formatDateTime(reservationDateTime(item))}
Départ: ${reservationPickup(item) || '—'}
Arrivée: ${reservationDropoff(item) || '—'}
Notes: ${item.adminNote || item.notes || '—'}`;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copié';
        setTimeout(() => { button.innerHTML = '<i class="fa fa-copy"></i>Copier'; }, 900);
      } catch (error) {
        alert('Copie impossible');
      }
    });
  });
}

function mapReservationDoc(doc) {
  const data = doc.data() || {};
  const mapped = {
    id: doc.id,
    ...data,
    status: normalizeStatus(data.status || 'pending'),
    statusLabel: statusLabel(data.status || 'pending')
  };
  if (mapped.direction === 'aller-simple') mapped.direction = 'aller';
  return mapped;
}

function mapDriverDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    name: data.name || '',
    phone: data.phone || '',
    car: data.carModel || data.car || '',
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
  if (badge) badge.textContent = `${data.name || user.email} • ${data.phone || ''} • ${data.carModel || data.car || ''}`;
  updateDriverProfileUi();
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
      const nextReservations = snapshot.docs.map(mapReservationDoc);
      const nextIds = new Set(nextReservations.map((item) => item.id));
      if (adminNotificationReady) {
        if (adminKnownReservationIds.size) {
          const newItems = nextReservations.filter((item) => !adminKnownReservationIds.has(item.id));
          newItems.forEach((item) => { notifyAdminNewReservation(item); });
        }
        adminKnownReservationIds = nextIds;
      } else {
        adminKnownReservationIds = nextIds;
      }
      reservationsCache = nextReservations;
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
      const nextReservations = snapshot.docs.map(mapReservationDoc).sort((a, b) => {
        const ta = a.createdAt?.seconds || 0;
        const tb = b.createdAt?.seconds || 0;
        return tb - ta;
      });
      const nextIds = new Set(nextReservations.map((item) => item.id));
      if (driverNotificationReady) {
        if (driverKnownReservationIds.size) {
          const newItems = nextReservations.filter((item) => !driverKnownReservationIds.has(item.id));
          newItems.forEach((item) => { notifyDriverNewAssignment(item); });
        }
        driverKnownReservationIds = nextIds;
      } else {
        driverKnownReservationIds = nextIds;
      }
      driverReservationsCache = nextReservations;
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

  document.getElementById('enableAdminNotificationsBtn')?.addEventListener('click', async () => {
    await enableNotificationsForRole('admin');
  });

  document.getElementById('searchReservation')?.addEventListener('input', renderReservations);
  document.getElementById('tripFilter')?.addEventListener('change', renderReservations);
  document.getElementById('statusFilter')?.addEventListener('change', renderReservations);
  document.getElementById('dateFilter')?.addEventListener('change', renderReservations);
  document.getElementById('driverFilter')?.addEventListener('change', renderReservations);
  document.getElementById('sortFilter')?.addEventListener('change', renderReservations);
  document.getElementById('resetFiltersBtn')?.addEventListener('click', resetAdminFilters);
  document.querySelectorAll('.quick-filter').forEach((btn) => {
    btn.addEventListener('click', () => applyQuickFilter(btn.dataset.quick || 'all'));
  });

  document.getElementById('driverForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideInlineMessage('driverMsg');
    const name = document.getElementById('driverName')?.value?.trim();
    const email = document.getElementById('driverEmail')?.value?.trim();
    const phone = document.getElementById('driverPhone')?.value?.trim();
    const uid = document.getElementById('driverUid')?.value?.trim();
    const car = document.getElementById('driverCar')?.value?.trim();
    if (!name || !email || !phone || !car || !uid) {
      showInlineMessage('driverMsg', 'Nom, email, téléphone, UID Firebase et voiture/plaque sont obligatoires.', true);
      return;
    }
    try {
      const driverPayload = {
        name,
        email,
        phone,
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        carModel: car,
        plate: '',
        photoUrl: ''
      };
      await db.collection(DRIVERS_COLLECTION).doc(uid).set(driverPayload);
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

  document.getElementById('exportCsvBtn')?.addEventListener('click', exportReservationsCsv);
  document.getElementById('printDispatchBtn')?.addEventListener('click', printDispatchPlanning);
  document.getElementById('showTodayBtn')?.addEventListener('click', () => {
    const date = document.getElementById('dateFilter');
    if (date) date.value = 'today';
    applyQuickFilter('today');
  });
  document.getElementById('showUnassignedBtn')?.addEventListener('click', () => {
    const driver = document.getElementById('driverFilter');
    if (driver) driver.value = 'none';
    applyQuickFilter('unassigned');
  });

  auth.onAuthStateChanged(async (user) => {
    const syncStatus = document.getElementById('syncStatus');
    currentUser = user || null;
    currentAdminDoc = null;
    if (!user) {
      setDashboardVisibility(false);
      reservationsCache = [];
      driversCache = [];
      adminKnownReservationIds = new Set();
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

  document.getElementById('enableDriverNotificationsBtn')?.addEventListener('click', async () => {
    await enableNotificationsForRole('driver');
  });

  document.getElementById('driverAvailabilityBtn')?.addEventListener('click', async () => {
    if (!db || !currentUser) return;
    const next = !(currentDriverDoc?.active !== false);
    try {
      await db.collection(DRIVERS_COLLECTION).doc(currentUser.uid).set({
        name: currentDriverDoc?.name || '',
        email: currentDriverDoc?.email || currentUser.email || '',
        phone: currentDriverDoc?.phone || '',
        carModel: currentDriverDoc?.carModel || currentDriverDoc?.car || '',
        active: next,
        createdAt: currentDriverDoc?.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
        plate: currentDriverDoc?.plate || '',
        photoUrl: currentDriverDoc?.photoUrl || ''
      }, { merge: true });
      currentDriverDoc = { ...(currentDriverDoc || {}), active: next };
      updateDriverProfileUi();
    } catch (error) {
      alert('Impossible de changer le statut : ' + (error.message || 'erreur'));
    }
  });

  document.getElementById('driverSearchReservation')?.addEventListener('input', renderDriverReservations);
  document.getElementById('driverStatusFilter')?.addEventListener('change', renderDriverReservations);
  document.getElementById('driverDateFilter')?.addEventListener('change', renderDriverReservations);
  document.querySelectorAll('.driver-quick-filter').forEach((btn) => {
    btn.addEventListener('click', () => applyDriverQuickFilter(btn.dataset.driverQuick || 'all'));
  });

  auth.onAuthStateChanged(async (user) => {
    const syncStatus = document.getElementById('driverSyncStatus');
    currentUser = user || null;
    currentDriverDoc = null;
    if (!user) {
      setDriverDashboardVisibility(false);
      driverReservationsCache = [];
      driverKnownReservationIds = new Set();
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


function initSecretLauncher() {
  const logo = document.querySelector('.logo');
  if (!logo || document.getElementById('secretLauncher')) return;

  const launcher = document.createElement('div');
  launcher.id = 'secretLauncher';
  launcher.className = 'secret-launcher';
  launcher.innerHTML = `
    <div class="secret-launcher-card">
      <h3>Accès rapide</h3>
      <p>Ouvre directement l'espace admin ou chauffeur.</p>
      <div class="secret-launcher-actions">
        <a href="acces-admin-taxi-live.html">Admin</a>
        <a href="chauffeurs.html">Chauffeur</a>
        <button type="button" class="secondary" id="secretLauncherClose">Fermer</button>
      </div>
      <div class="secret-hint">Astuce : touche l'étoile 5 fois pour rouvrir ce menu.</div>
    </div>`;
  document.body.appendChild(launcher);

  const closeBtn = launcher.querySelector('#secretLauncherClose');
  closeBtn?.addEventListener('click', () => launcher.classList.remove('open'));
  launcher.addEventListener('click', (e) => {
    if (e.target === launcher) launcher.classList.remove('open');
  });

  let tapCount = 0;
  let tapTimer = null;
  logo.addEventListener('click', () => {
    tapCount += 1;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 1600);
    if (tapCount >= 5) {
      tapCount = 0;
      launcher.classList.add('open');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initThemeAndPwa();
  initFirebase();
  initSecretLauncher();
  initReservationPage();
  initDashboardPage();
  initDriverPage();
});
