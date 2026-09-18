// ========== FIREBASE CONFIG ==========
const firebaseConfig = {
  apiKey: "AIzaSyAaMwKKhC5MSVsFlPuv7FKEBAJnGq7_DH8",
  authDomain: "safariat-x.firebaseapp.com",
  databaseURL: "https://safariat-x-default-rtdb.firebaseio.com",
  projectId: "safariat-x",
  storageBucket: "safariat-x.firebasestorage.app",
  messagingSenderId: "683181081137",
  appId: "1:683181081137:web:b4f51e26645b6485d98b10",
  measurementId: "G-ZW5QLHQTVR"
};

let firebaseReady = false;
let db = null;
let auth = null;
try {
  firebase.initializeApp(firebaseConfig);

  // ========== APP CHECK (reCAPTCHA Enterprise) ==========
  // معزول في try/catch مستقل: لو فشل، الموقع يكمل شغل عادي بدل ما يقف بالكامل
  try {
    const appCheck = firebase.appCheck();
    appCheck.activate(
      new firebase.appCheck.ReCaptchaEnterpriseProvider('6LeUpqItAAAAAJjBFRWxuMcmP-igWL2G-J8-L2AF'),
      true // isTokenAutoRefreshEnabled
    );
  } catch (appCheckErr) {
    console.error('App Check init error (booking will continue without it):', appCheckErr);
  }

  db = firebase.database();
  auth = firebase.auth();
  firebaseReady = true;
} catch (e) {
  console.error('Firebase init error:', e);
  firebaseReady = false;
}

// ========== نظام الأدوار: عميل (anonymous) / سائق / أدمن ==========
// window.__currentRole: null (لسه مش معروف) | 'client' | 'driver' | 'admin'
window.__currentRole = null;
window.__authReady = false; // بيبقى true أول ما نعرف حالة auth + role بشكل نهائي

function refreshCurrentRole(user) {
  if (!user) {
    window.__currentRole = null;
    window.__authReady = true;
    return Promise.resolve(null);
  }
  if (user.isAnonymous) {
    window.__currentRole = 'client';
    window.__authReady = true;
    return Promise.resolve('client');
  }
  // مستخدم حقيقي (إيميل/باسورد) - نتحقق من /roles/{uid} في الداتابيز
  return db.ref('roles/' + user.uid).once('value')
    .then((snap) => {
      const role = snap.val(); // 'admin' أو 'driver' أو null
      window.__currentRole = role || null;
      window.__authReady = true;
      return window.__currentRole;
    })
    .catch((err) => {
      console.error('تعذر قراءة role المستخدم:', err);
      window.__currentRole = null;
      window.__authReady = true;
      return null;
    });
}

if (firebaseReady) {
  auth.onAuthStateChanged((user) => {
    window.__authReady = false;
    if (!user) {
      // مفيش مستخدم مسجل خالص -> نسجله كـ anonymous تلقائيًا (عميل)
      auth.signInAnonymously().catch((err) => {
        console.error('فشل تسجيل الدخول التلقائي:', err);
        window.__authReady = true;
      });
      return; // هيدخل تاني onAuthStateChanged بعد ما signInAnonymously تنجح
    }
    refreshCurrentRole(user);
  });
}

// اختصار مخفي: 5 ضغطات على اللوجو خلال ثانيتين تفتح تسجيل دخول الأدمن
let __logoTapCount = 0;
let __logoTapTimer = null;
function handleLogoTap() {
  __logoTapCount++;
  if (__logoTapTimer) clearTimeout(__logoTapTimer);
  __logoTapTimer = setTimeout(() => { __logoTapCount = 0; }, 2000);
  if (__logoTapCount >= 5) {
    __logoTapCount = 0;
    clearTimeout(__logoTapTimer);
    openAdminPanel();
  }
}

// MAP INIT
let map, userMarker;
let currentInput = 'to';
let selectedLocation = '';
let carPrice = 8.5; // نفس سعر السيدان لأنها الاختيار الافتراضي

// Init main map
let fromMarker = null;
let destMarkerGlobal = null;
let userLat = 30.0444, userLng = 31.2357;

function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([30.0444, 31.2357], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  document.getElementById('location-text').textContent = '📡 جاري تحديد موقعك...';
  document.getElementById('from-text').textContent = 'جاري تحديد موقعك...';

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      map.setView([userLat, userLng], 15);

      const nearest = getNearestGov(userLat, userLng);
      if (fromMarker) map.removeLayer(fromMarker);
      fromMarker = L.marker([userLat, userLng], { icon: makeFromIcon() }).addTo(map);
      fromMarker.bindPopup(`<b>📍 موقعك: ${nearest}</b>`).openPopup();

      document.getElementById('location-text').textContent = '📍 ' + nearest;
      document.getElementById('from-text').textContent = nearest;
      document.getElementById('from-text').style.color = 'var(--text)';
      document.getElementById('from-gps-icon').textContent = '✓';
      autoCalcPrice();
    }, () => {
      document.getElementById('location-text').textContent = '📍 القاهرة، مصر';
      document.getElementById('from-text').textContent = 'القاهرة';
      document.getElementById('from-text').style.color = 'var(--text)';
    }, { enableHighAccuracy: true, timeout: 10000 });
  } else {
    document.getElementById('location-text').textContent = '📍 القاهرة، مصر';
    document.getElementById('from-text').textContent = 'القاهرة';
    document.getElementById('from-text').style.color = 'var(--text)';
  }
}

function getNearestGov(lat, lng) {
  let nearest = 'القاهرة';
  let minDist = Infinity;
  for (const [name, coords] of Object.entries(govCoords)) {
    const d = Math.sqrt(Math.pow(lat - coords[0], 2) + Math.pow(lng - coords[1], 2));
    if (d < minDist) { minDist = d; nearest = name; }
  }
  return nearest;
}

function openFromModal() {
  currentInput = 'from';
  document.getElementById('modal-title').textContent = 'اختار محافظة الانطلاق';
  const sugBox = document.getElementById('modal-suggestions');
  const gpsBtnId = 'gps-suggestion';
  if (!document.getElementById(gpsBtnId)) {
    const gpsDiv = document.createElement('div');
    gpsDiv.id = gpsBtnId;
    gpsDiv.className = 'suggestion';
    gpsDiv.style.background = 'rgba(217,119,87,0.12)';
    gpsDiv.style.borderRadius = '10px';
    gpsDiv.style.marginBottom = '0.5rem';
    gpsDiv.innerHTML = `<span class="sug-icon">📡</span><div><div class="sug-text" style="color:#d97757;font-weight:700;">تحديد تلقائي من GPS</div><div class="sug-sub">موقعك الحالي</div></div>`;
    gpsDiv.onclick = () => {
      useGPSForFrom();
      document.getElementById('input-modal').classList.remove('visible');
    };
    sugBox.insertBefore(gpsDiv, sugBox.firstChild);
  }
  document.getElementById('input-modal').classList.add('visible');
  document.getElementById('modal-input').value = '';
  filterSuggestions('');
}

function useGPSForFrom() {
  if (!navigator.geolocation) {
    showToast('الـ GPS مش شغال على جهازك');
    return;
  }
  showToast('📡 جاري تحديد موقعك...');
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    const nearest = getNearestGov(userLat, userLng);
    document.getElementById('from-text').textContent = nearest;
    document.getElementById('from-text').style.color = 'var(--text)';
    document.getElementById('from-gps-icon').textContent = '✓';
    document.getElementById('location-text').textContent = '📍 ' + nearest;
    if (fromMarker) map.removeLayer(fromMarker);
    fromMarker = L.marker([userLat, userLng], { icon: makeFromIcon() }).addTo(map);
    map.setView([userLat, userLng], 15);
    autoCalcPrice();
    showToast('✅ تم تحديد موقعك: ' + nearest);
  }, () => {
    showToast('❌ مقدرناش نحدد موقعك، اختاره بنفسك');
  }, { enableHighAccuracy: true, timeout: 8000 });
}

function makeFromIcon() {
  return L.divIcon({
    html: `<div style="width:18px;height:18px;background:#d97757;border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(217,119,87,0.8)"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9]
  });
}

// وضع "ظبط نقطة الانطلاق بدقة": بيثبت دبوس في نص الخريطة والمستخدم بيحرك الخريطة تحته
// (بالظبط زي أوبر/كريم) عشان يوصل لمكانه الفعلي لو الـ GPS مش دقيق 100%
let fineTuneMode = false;
function toggleFineTune() {
  const pin = document.getElementById('center-pin');
  const btn = document.getElementById('fine-tune-btn');
  fineTuneMode = !fineTuneMode;

  if (fineTuneMode) {
    if (fromMarker) { map.removeLayer(fromMarker); fromMarker = null; }
    pin.classList.add('active');
    btn.textContent = '✅ تأكيد نقطة الانطلاق';
    btn.style.background = 'var(--accent)';
    map.setView([userLat, userLng], 17);
    map.on('movestart', onFineTuneMoveStart);
    map.on('moveend', onFineTuneMoveEnd);
    showToast('📍 حرّك الخريطة عشان تظبط نقطة الانطلاق بالظبط');
  } else {
    map.off('movestart', onFineTuneMoveStart);
    map.off('moveend', onFineTuneMoveEnd);
    pin.classList.remove('active', 'dragging');

    const center = map.getCenter();
    userLat = center.lat;
    userLng = center.lng;
    const nearest = getNearestGov(userLat, userLng);
    document.getElementById('from-text').textContent = nearest;
    document.getElementById('from-text').style.color = 'var(--text)';
    document.getElementById('from-gps-icon').textContent = '✓';
    document.getElementById('location-text').textContent = '📍 ' + nearest;

    fromMarker = L.marker([userLat, userLng], { icon: makeFromIcon() }).addTo(map);
    btn.textContent = '🎯 ظبط نقطة الانطلاق بدقة';
    btn.style.background = '#d97757';
    autoCalcPrice();
    showToast('✅ اتحددت نقطة انطلاقك بدقة');
  }
}
function onFineTuneMoveStart() { document.getElementById('center-pin').classList.add('dragging'); }
function onFineTuneMoveEnd() { document.getElementById('center-pin').classList.remove('dragging'); }

function makeDestIcon() {
  return L.divIcon({
    html: `<div style="width:18px;height:18px;background:#d97757;border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(217,119,87,0.8)"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9]
  });
}

function centerMapOnGov(name) {
  if (!map || !govCoords[name]) return;
  const coords = govCoords[name];

  if (fromMarker) map.removeLayer(fromMarker);
  fromMarker = L.marker(coords, { icon: makeFromIcon() }).addTo(map);
  fromMarker.bindPopup(`
    <b>📍 الانطلاق: ${name}</b><br><br>
    <button onclick="openGoogleMaps(${coords[0]},${coords[1]})" 
      style="background:#d97757;color:white;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-family:Cairo,sans-serif;font-size:13px;width:100%">
      🗺️ افتح في Google Maps
    </button>
  `).openPopup();
  map.setView(coords, 9);
  userLat = coords[0];
  userLng = coords[1];
}

function showBothMarkers(toName) {
  if (!map || !govCoords[toName]) return;

  if (destMarkerGlobal) map.removeLayer(destMarkerGlobal);

  const destCoords = govCoords[toName];
  destMarkerGlobal = L.marker(destCoords, { icon: makeDestIcon() }).addTo(map);
  destMarkerGlobal.bindPopup(`
    <b>🎯 الوجهة: ${toName}</b><br><br>
    <button onclick="openGoogleMaps(${destCoords[0]},${destCoords[1]})"
      style="background:#d97757;color:white;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-family:Cairo,sans-serif;font-size:13px;width:100%">
      🗺️ افتح في Google Maps
    </button>
  `).openPopup();

  if (userLat && userLng) {
    const bounds = L.latLngBounds([[userLat, userLng], destCoords]);
    map.fitBounds(bounds, { padding: [80, 80] });
  } else {
    map.setView(destCoords, 9);
  }
}

// TOAST NOTIFICATION
function showToast(msg) {
  let toast = document.getElementById('toast-msg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:0.7rem 1.2rem;border-radius:50px;font-size:0.9rem;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);transition:opacity 0.3s;white-space:nowrap;font-family:Cairo,sans-serif;border:1px solid rgba(217,119,87,0.3);';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  if (name === 'home' && !map) initMap();
  if (name === 'trips') renderTrips();
}

function renderTrips() {
  const list = document.getElementById('trips-list');
  const noTrips = document.getElementById('no-trips');
  if (!bookings || bookings.length === 0) {
    list.innerHTML = '';
    noTrips.style.display = 'block';
    return;
  }
  noTrips.style.display = 'none';
  const carIcon = { 'سيدان':'🚗', '7 ركاب':'🚙', '14 راكب':'🚌', 'VIP':'⭐' };
  list.innerHTML = [...bookings].reverse().map(b => {
    const isCancelled = b.status === 'ملغي';
    const statusColor = isCancelled ? 'var(--accent2)' : 'var(--accent)';
    const statusLabel = isCancelled ? 'ملغاة ✗' : (b.status === 'جديد' ? 'جديد 🕐' : 'مكتملة ✓');
    const icon = carIcon[b.car] || '🚗';
    return `
      <div class="trip-card">
        <div class="trip-icon ${isCancelled ? 'cancelled' : 'completed'}">${icon}</div>
        <div class="trip-info">
          <div class="trip-route">${b.from} ← ${b.to}</div>
          <div class="trip-date">${b.time} • ${b.car} • ${b.km}</div>
        </div>
        <div>
          <div class="trip-price">${isCancelled ? '--' : b.price}</div>
          <div style="font-size:0.68rem;color:${statusColor};text-align:left">${statusLabel}</div>
        </div>
      </div>`;
  }).join('');
}

// جدول المسافات الحقيقية بين المحافظات (بالكيلومتر)
const distances = {
  'القاهرة':        { 'الإسكندرية':220,'الجيزة':20,'الشرقية':90,'الدقهلية':120,'البحيرة':180,'المنوفية':80,'القليوبية':30,'الغربية':110,'كفر الشيخ':160,'دمياط':195,'بورسعيد':170,'الإسماعيلية':120,'السويس':135,'سيناء الشمالية':230,'سيناء الجنوبية':400,'البحر الأحمر':320,'الفيوم':100,'بني سويف':130,'المنيا':245,'أسيوط':380,'سوهاج':465,'قنا':580,'الأقصر':650,'أسوان':880,'مطروح':490,'الوادي الجديد':550 },
  'الإسكندرية':    { 'القاهرة':220,'الجيزة':230,'الشرقية':290,'الدقهلية':200,'البحيرة':60,'المنوفية':150,'القليوبية':240,'الغربية':140,'كفر الشيخ':100,'دمياط':230,'بورسعيد':320,'الإسماعيلية':310,'السويس':340,'سيناء الشمالية':410,'سيناء الجنوبية':590,'البحر الأحمر':510,'الفيوم':300,'بني سويف':330,'المنيا':440,'أسيوط':575,'سوهاج':660,'قنا':775,'الأقصر':840,'أسوان':1070,'مطروح':300,'الوادي الجديد':680 },
  'الجيزة':        { 'القاهرة':20,'الإسكندرية':230,'الشرقية':100,'الدقهلية':130,'البحيرة':190,'المنوفية':90,'القليوبية':40,'الغربية':120,'كفر الشيخ':170,'دمياط':205,'بورسعيد':180,'الإسماعيلية':130,'السويس':145,'سيناء الشمالية':240,'سيناء الجنوبية':410,'البحر الأحمر':330,'الفيوم':85,'بني سويف':115,'المنيا':230,'أسيوط':365,'سوهاج':450,'قنا':565,'الأقصر':635,'أسوان':865,'مطروح':475,'الوادي الجديد':535 },
  'مطار القاهرة':  { 'القاهرة':25,'الإسكندرية':240,'الجيزة':30,'الشرقية':95,'الدقهلية':135,'البحيرة':170,'المنوفية':85,'القليوبية':40,'الغربية':120,'كفر الشيخ':155,'دمياط':195,'بورسعيد':195,'الإسماعيلية':130,'السويس':145,'سيناء الشمالية':330,'سيناء الجنوبية':445,'البحر الأحمر':545,'الفيوم':135,'بني سويف':155,'المنيا':305,'أسيوط':425,'سوهاج':515,'قنا':595,'الأقصر':660,'أسوان':895,'مطروح':550,'الوادي الجديد':740,'مطار سفنكس':70,'مطار برج العرب':240 },
  'مطار سفنكس':    { 'القاهرة':45,'الإسكندرية':220,'الجيزة':40,'الشرقية':150,'الدقهلية':175,'البحيرة':150,'المنوفية':100,'القليوبية':70,'الغربية':140,'كفر الشيخ':170,'دمياط':245,'بورسعيد':260,'الإسماعيلية':200,'السويس':205,'سيناء الشمالية':400,'سيناء الجنوبية':480,'البحر الأحمر':565,'الفيوم':90,'بني سويف':125,'المنيا':265,'أسيوط':395,'سوهاج':495,'قنا':590,'الأقصر':650,'أسوان':880,'مطروح':500,'الوادي الجديد':690,'مطار القاهرة':70,'مطار برج العرب':210 },
  'مطار برج العرب':{ 'القاهرة':230,'الإسكندرية':50,'الجيزة':230,'الشرقية':245,'الدقهلية':210,'البحيرة':80,'المنوفية':165,'القليوبية':205,'الغربية':165,'كفر الشيخ':155,'دمياط':270,'بورسعيد':325,'الإسماعيلية':325,'السويس':380,'سيناء الشمالية':510,'سيناء الجنوبية':685,'البحر الأحمر':770,'الفيوم':275,'بني سويف':320,'المنيا':430,'أسيوط':570,'سوهاج':680,'قنا':790,'الأقصر':845,'أسوان':1070,'مطروح':310,'الوادي الجديد':795,'مطار القاهرة':240,'مطار سفنكس':210 },
  'الشرقية':       { 'القاهرة':90,'الإسكندرية':290,'الجيزة':100,'الدقهلية':80,'البحيرة':200,'المنوفية':100,'القليوبية':70,'الغربية':130,'كفر الشيخ':160,'دمياط':140,'بورسعيد':100,'الإسماعيلية':80,'السويس':110,'سيناء الشمالية':160,'سيناء الجنوبية':380,'البحر الأحمر':280,'الفيوم':190,'بني سويف':220,'المنيا':335,'أسيوط':470,'سوهاج':555,'قنا':670,'الأقصر':740,'أسوان':970,'مطروح':510,'الوادي الجديد':580 },
  'الدقهلية':      { 'القاهرة':120,'الإسكندرية':200,'الجيزة':130,'الشرقية':80,'البحيرة':160,'المنوفية':90,'القليوبية':100,'الغربية':80,'كفر الشيخ':90,'دمياط':60,'بورسعيد':130,'الإسماعيلية':150,'السويس':200,'سيناء الشمالية':250,'سيناء الجنوبية':470,'البحر الأحمر':370,'الفيوم':220,'بني سويف':250,'المنيا':365,'أسيوط':500,'سوهاج':585,'قنا':700,'الأقصر':770,'أسوان':1000,'مطروح':430,'الوادي الجديد':610 },
  'البحيرة':       { 'القاهرة':180,'الإسكندرية':60,'الجيزة':190,'الشرقية':200,'الدقهلية':160,'المنوفية':110,'القليوبية':190,'الغربية':90,'كفر الشيخ':80,'دمياط':195,'بورسعيد':290,'الإسماعيلية':280,'السويس':310,'سيناء الشمالية':380,'سيناء الجنوبية':560,'البحر الأحمر':480,'الفيوم':270,'بني سويف':300,'المنيا':415,'أسيوط':550,'سوهاج':635,'قنا':750,'الأقصر':820,'أسوان':1050,'مطروح':260,'الوادي الجديد':655 },
  'المنوفية':      { 'القاهرة':80,'الإسكندرية':150,'الجيزة':90,'الشرقية':100,'الدقهلية':90,'البحيرة':110,'القليوبية':70,'الغربية':50,'كفر الشيخ':100,'دمياط':155,'بورسعيد':230,'الإسماعيلية':200,'السويس':230,'سيناء الشمالية':300,'سيناء الجنوبية':480,'البحر الأحمر':400,'الفيوم':175,'بني سويف':205,'المنيا':320,'أسيوط':455,'سوهاج':540,'قنا':655,'الأقصر':725,'أسوان':955,'مطروح':380,'الوادي الجديد':560 },
  'القليوبية':     { 'القاهرة':30,'الإسكندرية':240,'الجيزة':40,'الشرقية':70,'الدقهلية':100,'البحيرة':190,'المنوفية':70,'الغربية':110,'كفر الشيخ':150,'دمياط':175,'بورسعيد':155,'الإسماعيلية':120,'السويس':155,'سيناء الشمالية':220,'سيناء الجنوبية':420,'البحر الأحمر':330,'الفيوم':125,'بني سويف':155,'المنيا':270,'أسيوط':405,'سوهاج':490,'قنا':605,'الأقصر':675,'أسوان':905,'مطروح':480,'الوادي الجديد':565 },
  'الغربية':       { 'القاهرة':110,'الإسكندرية':140,'الجيزة':120,'الشرقية':130,'الدقهلية':80,'البحيرة':90,'المنوفية':50,'القليوبية':110,'كفر الشيخ':70,'دمياط':135,'بورسعيد':240,'الإسماعيلية':220,'السويس':260,'سيناء الشمالية':330,'سيناء الجنوبية':510,'البحر الأحمر':430,'الفيوم':205,'بني سويف':235,'المنيا':350,'أسيوط':485,'سوهاج':570,'قنا':685,'الأقصر':755,'أسوان':985,'مطروح':340,'الوادي الجديد':590 },
  'كفر الشيخ':     { 'القاهرة':160,'الإسكندرية':100,'الجيزة':170,'الشرقية':160,'الدقهلية':90,'البحيرة':80,'المنوفية':100,'القليوبية':150,'الغربية':70,'دمياط':120,'بورسعيد':220,'الإسماعيلية':240,'السويس':280,'سيناء الشمالية':340,'سيناء الجنوبية':540,'البحر الأحمر':460,'الفيوم':255,'بني سويف':285,'المنيا':400,'أسيوط':535,'سوهاج':620,'قنا':735,'الأقصر':805,'أسوان':1035,'مطروح':280,'الوادي الجديد':640 },
  'دمياط':         { 'القاهرة':195,'الإسكندرية':230,'الجيزة':205,'الشرقية':140,'الدقهلية':60,'البحيرة':195,'المنوفية':155,'القليوبية':175,'الغربية':135,'كفر الشيخ':120,'بورسعيد':75,'الإسماعيلية':140,'السويس':190,'سيناء الشمالية':215,'سيناء الجنوبية':460,'البحر الأحمر':360,'الفيوم':295,'بني سويف':325,'المنيا':440,'أسيوط':575,'سوهاج':660,'قنا':775,'الأقصر':845,'أسوان':1075,'مطروح':425,'الوادي الجديد':685 },
  'بورسعيد':       { 'القاهرة':170,'الإسكندرية':320,'الجيزة':180,'الشرقية':100,'الدقهلية':130,'البحيرة':290,'المنوفية':230,'القليوبية':155,'الغربية':240,'كفر الشيخ':220,'دمياط':75,'الإسماعيلية':75,'السويس':115,'سيناء الشمالية':130,'سيناء الجنوبية':380,'البحر الأحمر':290,'الفيوم':270,'بني سويف':300,'المنيا':420,'أسيوط':555,'سوهاج':640,'قنا':755,'الأقصر':825,'أسوان':1055,'مطروح':500,'الوادي الجديد':665 },
  'الإسماعيلية':   { 'القاهرة':120,'الإسكندرية':310,'الجيزة':130,'الشرقية':80,'الدقهلية':150,'البحيرة':280,'المنوفية':200,'القليوبية':120,'الغربية':220,'كفر الشيخ':240,'دمياط':140,'بورسعيد':75,'السويس':50,'سيناء الشمالية':100,'سيناء الجنوبية':320,'البحر الأحمر':230,'الفيوم':220,'بني سويف':250,'المنيا':370,'أسيوط':505,'سوهاج':590,'قنا':705,'الأقصر':775,'أسوان':1005,'مطروح':480,'الوادي الجديد':615 },
  'السويس':        { 'القاهرة':135,'الإسكندرية':340,'الجيزة':145,'الشرقية':110,'الدقهلية':200,'البحيرة':310,'المنوفية':230,'القليوبية':155,'الغربية':260,'كفر الشيخ':280,'دمياط':190,'بورسعيد':115,'الإسماعيلية':50,'سيناء الشمالية':80,'سيناء الجنوبية':300,'البحر الأحمر':200,'الفيوم':235,'بني سويف':265,'المنيا':385,'أسيوط':520,'سوهاج':605,'قنا':720,'الأقصر':790,'أسوان':1020,'مطروح':500,'الوادي الجديد':630 },
  'سيناء الشمالية':{ 'القاهرة':230,'الإسكندرية':410,'الجيزة':240,'الشرقية':160,'الدقهلية':250,'البحيرة':380,'المنوفية':300,'القليوبية':220,'الغربية':330,'كفر الشيخ':340,'دمياط':215,'بورسعيد':130,'الإسماعيلية':100,'السويس':80,'سيناء الجنوبية':250,'البحر الأحمر':280,'الفيوم':330,'بني سويف':360,'المنيا':480,'أسيوط':615,'سوهاج':700,'قنا':815,'الأقصر':885,'أسوان':1115,'مطروح':580,'الوادي الجديد':725 },
  'سيناء الجنوبية':{ 'القاهرة':400,'الإسكندرية':590,'الجيزة':410,'الشرقية':380,'الدقهلية':470,'البحيرة':560,'المنوفية':480,'القليوبية':420,'الغربية':510,'كفر الشيخ':540,'دمياط':460,'بورسعيد':380,'الإسماعيلية':320,'السويس':300,'سيناء الشمالية':250,'البحر الأحمر':280,'الفيوم':500,'بني سويف':530,'المنيا':650,'أسيوط':785,'سوهاج':870,'قنا':985,'الأقصر':1055,'أسوان':1285,'مطروح':750,'الوادي الجديد':895 },
  'البحر الأحمر':  { 'القاهرة':320,'الإسكندرية':510,'الجيزة':330,'الشرقية':280,'الدقهلية':370,'البحيرة':480,'المنوفية':400,'القليوبية':330,'الغربية':430,'كفر الشيخ':460,'دمياط':360,'بورسعيد':290,'الإسماعيلية':230,'السويس':200,'سيناء الشمالية':280,'سيناء الجنوبية':280,'الفيوم':420,'بني سويف':390,'المنيا':450,'أسيوط':520,'سوهاج':580,'قنا':620,'الأقصر':650,'أسوان':750,'مطروح':680,'الوادي الجديد':520 },
  'الفيوم':        { 'القاهرة':100,'الإسكندرية':300,'الجيزة':85,'الشرقية':190,'الدقهلية':220,'البحيرة':270,'المنوفية':175,'القليوبية':125,'الغربية':205,'كفر الشيخ':255,'دمياط':295,'بورسعيد':270,'الإسماعيلية':220,'السويس':235,'سيناء الشمالية':330,'سيناء الجنوبية':500,'البحر الأحمر':420,'بني سويف':60,'المنيا':170,'أسيوط':305,'سوهاج':390,'قنا':505,'الأقصر':575,'أسوان':805,'مطروح':445,'الوادي الجديد':460 },
  'بني سويف':      { 'القاهرة':130,'الإسكندرية':330,'الجيزة':115,'الشرقية':220,'الدقهلية':250,'البحيرة':300,'المنوفية':205,'القليوبية':155,'الغربية':235,'كفر الشيخ':285,'دمياط':325,'بورسعيد':300,'الإسماعيلية':250,'السويس':265,'سيناء الشمالية':360,'سيناء الجنوبية':530,'البحر الأحمر':390,'الفيوم':60,'المنيا':115,'أسيوط':250,'سوهاج':335,'قنا':450,'الأقصر':520,'أسوان':750,'مطروح':480,'الوادي الجديد':405 },
  'المنيا':        { 'القاهرة':245,'الإسكندرية':440,'الجيزة':230,'الشرقية':335,'الدقهلية':365,'البحيرة':415,'المنوفية':320,'القليوبية':270,'الغربية':350,'كفر الشيخ':400,'دمياط':440,'بورسعيد':420,'الإسماعيلية':370,'السويس':385,'سيناء الشمالية':480,'سيناء الجنوبية':650,'البحر الأحمر':450,'الفيوم':170,'بني سويف':115,'أسيوط':135,'سوهاج':220,'قنا':335,'الأقصر':405,'أسوان':635,'مطروح':580,'الوادي الجديد':295 },
  'أسيوط':         { 'القاهرة':380,'الإسكندرية':575,'الجيزة':365,'الشرقية':470,'الدقهلية':500,'البحيرة':550,'المنوفية':455,'القليوبية':405,'الغربية':485,'كفر الشيخ':535,'دمياط':575,'بورسعيد':555,'الإسماعيلية':505,'السويس':520,'سيناء الشمالية':615,'سيناء الجنوبية':785,'البحر الأحمر':520,'الفيوم':305,'بني سويف':250,'المنيا':135,'سوهاج':90,'قنا':205,'الأقصر':275,'أسوان':505,'مطروح':700,'الوادي الجديد':175 },
  'سوهاج':         { 'القاهرة':465,'الإسكندرية':660,'الجيزة':450,'الشرقية':555,'الدقهلية':585,'البحيرة':635,'المنوفية':540,'القليوبية':490,'الغربية':570,'كفر الشيخ':620,'دمياط':660,'بورسعيد':640,'الإسماعيلية':590,'السويس':605,'سيناء الشمالية':700,'سيناء الجنوبية':870,'البحر الأحمر':580,'الفيوم':390,'بني سويف':335,'المنيا':220,'أسيوط':90,'قنا':115,'الأقصر':185,'أسوان':415,'مطروح':785,'الوادي الجديد':200 },
  'قنا':            { 'القاهرة':580,'الإسكندرية':775,'الجيزة':565,'الشرقية':670,'الدقهلية':700,'البحيرة':750,'المنوفية':655,'القليوبية':605,'الغربية':685,'كفر الشيخ':735,'دمياط':775,'بورسعيد':755,'الإسماعيلية':705,'السويس':720,'سيناء الشمالية':815,'سيناء الجنوبية':985,'البحر الأحمر':620,'الفيوم':505,'بني سويف':450,'المنيا':335,'أسيوط':205,'سوهاج':115,'الأقصر':70,'أسوان':300,'مطروح':900,'الوادي الجديد':280 },
  'الأقصر':        { 'القاهرة':650,'الإسكندرية':840,'الجيزة':635,'الشرقية':740,'الدقهلية':770,'البحيرة':820,'المنوفية':725,'القليوبية':675,'الغربية':755,'كفر الشيخ':805,'دمياط':845,'بورسعيد':825,'الإسماعيلية':775,'السويس':790,'سيناء الشمالية':885,'سيناء الجنوبية':1055,'البحر الأحمر':650,'الفيوم':575,'بني سويف':520,'المنيا':405,'أسيوط':275,'سوهاج':185,'قنا':70,'أسوان':230,'مطروح':970,'الوادي الجديد':340 },
  'أسوان':          { 'القاهرة':880,'الإسكندرية':1070,'الجيزة':865,'الشرقية':970,'الدقهلية':1000,'البحيرة':1050,'المنوفية':955,'القليوبية':905,'الغربية':985,'كفر الشيخ':1035,'دمياط':1075,'بورسعيد':1055,'الإسماعيلية':1005,'السويس':1020,'سيناء الشمالية':1115,'سيناء الجنوبية':1285,'البحر الأحمر':750,'الفيوم':805,'بني سويف':750,'المنيا':635,'أسيوط':505,'سوهاج':415,'قنا':300,'الأقصر':230,'مطروح':1200,'الوادي الجديد':560 },
  'مطروح':         { 'القاهرة':490,'الإسكندرية':300,'الجيزة':475,'الشرقية':510,'الدقهلية':430,'البحيرة':260,'المنوفية':380,'القليوبية':480,'الغربية':340,'كفر الشيخ':280,'دمياط':425,'بورسعيد':500,'الإسماعيلية':480,'السويس':500,'سيناء الشمالية':580,'سيناء الجنوبية':750,'البحر الأحمر':680,'الفيوم':445,'بني سويف':480,'المنيا':580,'أسيوط':700,'سوهاج':785,'قنا':900,'الأقصر':970,'أسوان':1200,'الوادي الجديد':870 },
  'الوادي الجديد':  { 'القاهرة':550,'الإسكندرية':680,'الجيزة':535,'الشرقية':580,'الدقهلية':610,'البحيرة':655,'المنوفية':560,'القليوبية':565,'الغربية':590,'كفر الشيخ':640,'دمياط':685,'بورسعيد':665,'الإسماعيلية':615,'السويس':630,'سيناء الشمالية':725,'سيناء الجنوبية':895,'البحر الأحمر':520,'الفيوم':460,'بني سويف':405,'المنيا':295,'أسيوط':175,'سوهاج':200,'قنا':280,'الأقصر':340,'أسوان':560,'مطروح':870 }
};

function getDistance(from, to) {
  if (from === to) return 0;
  if (distances[from] && distances[from][to]) return distances[from][to];
  if (distances[to] && distances[to][from]) return distances[to][from];
  return null;
}

let lastComputedPriceValue = null; // آخر سعر رقمي محسوب فعليًا - بيتبعت مع الحجز عشان تتأكد فايربيز منه

function autoCalcPrice() {
  const from = document.getElementById('from-text').textContent.trim();
  const to = document.getElementById('to-text').textContent.trim();
  const priceCard = document.getElementById('price-card');

  if (!to || to === 'اختار وجهتك') {
    priceCard.style.display = 'none';
    lastComputedPriceValue = null;
    return;
  }

  const km = getDistance(from, to);

  if (km === null || km === undefined) {
    priceCard.style.display = 'none';
    lastComputedPriceValue = null;
    return;
  }
  if (km === 0) {
    priceCard.style.display = 'block';
    document.getElementById('km-display').textContent = '0 كم';
    document.getElementById('price-est').textContent = '0 ج.م';
    document.getElementById('time-display').textContent = '0 دقيقة';
    document.getElementById('price-detail').textContent = 'نفس المحافظة';
    lastComputedPriceValue = 0;
    return;
  }
  let total = Math.round(km * carPrice);
  if (isAirportRoute(from, to)) {
    total = Math.max(total, AIRPORT_MIN_PRICE);
  }
  const mins = Math.round(km * 1.2);
  priceCard.style.display = 'block';
  document.getElementById('km-display').textContent = km + ' كم';
  document.getElementById('price-est').textContent = total.toLocaleString() + ' ج.م';
  document.getElementById('time-display').textContent = mins + ' دقيقة';
  document.getElementById('price-detail').textContent = km + ' كم × ' + carPrice + ' ج.م/كم = ' + total.toLocaleString() + ' ج.م';
  lastComputedPriceValue = total;
}

// أي رحلة من/إلى مطار سعرها ميقلش عن الحد الأدنى ده حتى لو السعر بالكيلومتر طلع أقل
const AIRPORT_NAMES = ['مطار القاهرة', 'مطار سفنكس', 'مطار برج العرب'];
const AIRPORT_MIN_PRICE = 800;
function isAirportRoute(from, to) {
  return AIRPORT_NAMES.includes(from) || AIRPORT_NAMES.includes(to);
}

// إحداثيات المحافظات
const govCoords = {
  'القاهرة':        [30.0444, 31.2357],
  'الإسكندرية':    [31.2001, 29.9187],
  'الجيزة':        [30.0131, 31.2089],
  'الشرقية':       [30.7444, 31.6572],
  'الدقهلية':      [31.0409, 31.3824],
  'البحيرة':       [30.8480, 30.3436],
  'المنوفية':      [30.5973, 30.9876],
  'القليوبية':     [30.3292, 31.2168],
  'الغربية':       [30.8748, 31.0326],
  'كفر الشيخ':     [31.1107, 30.9388],
  'دمياط':         [31.4165, 31.8133],
  'بورسعيد':       [31.2565, 32.2841],
  'الإسماعيلية':   [30.5965, 32.2715],
  'السويس':        [29.9668, 32.5498],
  'سيناء الشمالية':[31.1280, 33.7996],
  'سيناء الجنوبية':[28.2367, 34.1737],
  'البحر الأحمر':  [26.9959, 33.8335],
  'الفيوم':        [29.3084, 30.8428],
  'بني سويف':      [29.0661, 31.0994],
  'المنيا':        [28.0871, 30.7618],
  'أسيوط':         [27.1809, 31.1837],
  'سوهاج':         [26.5569, 31.6948],
  'قنا':            [26.1551, 32.7160],
  'الأقصر':        [25.6872, 32.6396],
  'أسوان':          [24.0889, 32.8998],
  'مطروح':         [31.3543, 27.2373],
  'الوادي الجديد':  [25.4492, 29.0026],
  'مطار القاهرة':   [30.1219, 31.4056],
  'مطار سفنكس':     [29.9186, 30.8974],
  'مطار برج العرب': [30.9175, 29.6966]
};

// INPUT MODAL
function openInputModal(type) {
  currentInput = type;
  document.getElementById('modal-title').textContent = type === 'from' ? 'اختار محافظة الانطلاق' : 'اختار الوجهة';
  const gpsBtn = document.getElementById('gps-suggestion');
  if (gpsBtn && type === 'to') gpsBtn.remove();
  document.getElementById('modal-input').value = '';
  filterSuggestions('');
  document.getElementById('input-modal').classList.add('visible');
  setTimeout(() => document.getElementById('modal-input').focus(), 300);
}

function closeInputModal(e) {
  if (e.target === document.getElementById('input-modal')) {
    document.getElementById('input-modal').classList.remove('visible');
  }
}

function selectLocation(loc) {
  const isFrom = currentInput === 'from';

  if (isFrom) {
    document.getElementById('from-text').textContent = loc;
    document.getElementById('from-text').style.color = 'var(--text)';
    centerMapOnGov(loc);
  } else {
    document.getElementById('to-text').textContent = loc;
    document.getElementById('to-text').style.color = 'var(--text)';
    showBothMarkers(loc);
  }

  autoCalcPrice();
  document.getElementById('input-modal').classList.remove('visible');
  document.getElementById('modal-input').value = '';
  selectedLocation = '';
}

function openGoogleMaps(lat, lng) {
  window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
}

let mapPickMode = null;
let mapClickHandler = null;

function startMapPick(type) {
  mapPickMode = type;
  document.getElementById('map-pick-bar').style.display = 'block';
  document.getElementById('map-pick-bar').innerHTML = `
    🎯 اضغط على الخريطة لتحديد ${type === 'from' ? 'نقطة الانطلاق' : 'الوجهة'}
    <span onclick="cancelMapPick()" style="float:left;cursor:pointer;font-size:1.1rem;">✕</span>
  `;

  document.getElementById('map').scrollIntoView({ behavior: 'smooth' });

  if (mapClickHandler) map.off('click', mapClickHandler);
  mapClickHandler = function(e) {
    const { lat, lng } = e.latlng;
    handleMapClick(lat, lng);
  };
  map.on('click', mapClickHandler);
  map.getContainer().style.cursor = 'crosshair';
}

function handleMapClick(lat, lng) {
  fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ar`)
    .then(r => r.json())
    .then(data => {
      const addr = data.address;
      const placeName = addr.suburb || addr.neighbourhood || addr.city_district || addr.city || addr.state || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      if (mapPickMode === 'from') {
        document.getElementById('from-text').textContent = placeName;
        document.getElementById('from-text').style.color = 'var(--text)';

        if (fromMarker) map.removeLayer(fromMarker);
        fromMarker = L.marker([lat, lng], { icon: makeFromIcon() }).addTo(map);
        fromMarker.bindPopup(`
          <b>📍 الانطلاق</b><br>${placeName}<br><br>
          <button onclick="openGoogleMaps(${lat},${lng})"
            style="background:#d97757;color:white;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px;width:100%">
            🗺️ افتح في Google Maps
          </button>
        `).openPopup();
        userLat = lat; userLng = lng;

      } else {
        document.getElementById('to-text').textContent = placeName;
        document.getElementById('to-text').style.color = 'var(--text)';

        if (destMarkerGlobal) map.removeLayer(destMarkerGlobal);
        destMarkerGlobal = L.marker([lat, lng], { icon: makeDestIcon() }).addTo(map);
        destMarkerGlobal.bindPopup(`
          <b>🎯 الوجهة</b><br>${placeName}<br><br>
          <button onclick="openGoogleMaps(${lat},${lng})"
            style="background:#d97757;color:white;border:none;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px;width:100%">
            🗺️ افتح في Google Maps
          </button>
        `).openPopup();

        if (userLat && userLng) {
          map.fitBounds(L.latLngBounds([[userLat, userLng], [lat, lng]]), { padding: [80, 80] });
        }
      }

      if (userLat && userLng && mapPickMode === 'to') {
        const km = calcRealDistance(userLat, userLng, lat, lng);
        let total = Math.round(km * carPrice);
        const fromNameForFloor = document.getElementById('from-text').textContent.trim();
        if (isAirportRoute(fromNameForFloor, placeName)) {
          total = Math.max(total, AIRPORT_MIN_PRICE);
        }
        document.getElementById('price-card').style.display = 'block';
        document.getElementById('km-display').textContent = km + ' كم';
        document.getElementById('price-est').textContent = total + ' ج.م';
        document.getElementById('time-display').textContent = Math.round(km * 1.2) + ' دقيقة';
        document.getElementById('price-detail').textContent = km + ' كم × ' + carPrice + ' ج.م/كم = ' + total + ' ج.م';
        lastComputedPriceValue = total;
      }

      cancelMapPick();
    })
    .catch(() => {
      const placeName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      if (mapPickMode === 'from') {
        document.getElementById('from-text').textContent = placeName;
        userLat = lat; userLng = lng;
      } else {
        document.getElementById('to-text').textContent = placeName;
      }
      cancelMapPick();
    });
}

function cancelMapPick() {
  if (mapClickHandler) map.off('click', mapClickHandler);
  mapClickHandler = null;
  mapPickMode = null;
  document.getElementById('map-pick-bar').style.display = 'none';
  map.getContainer().style.cursor = '';
}

function calcRealDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function confirmLocation() {
  const val = selectedLocation;
  if (val) {
    if (currentInput === 'from') {
      document.getElementById('from-text').textContent = val;
      document.getElementById('from-text').style.color = 'var(--text)';
      document.getElementById('from-gps-icon').textContent = '✎';
      centerMapOnGov(val);
    } else {
      document.getElementById('to-text').textContent = val;
      document.getElementById('to-text').style.color = 'var(--text)';
      showBothMarkers(val);
    }
    autoCalcPrice();
  }
  document.getElementById('input-modal').classList.remove('visible');
  document.getElementById('modal-input').value = '';
  selectedLocation = '';
}

function filterSuggestions(val) {
  const suggestions = document.querySelectorAll('.suggestion');
  suggestions.forEach(s => {
    const text = s.querySelector('.sug-text').textContent;
    s.style.display = text.includes(val) || val === '' ? 'flex' : 'none';
  });
}

// ========== BOOKINGS (Firebase + localStorage fallback) ==========
let bookings = JSON.parse(localStorage.getItem('safariat_bookings') || '[]');
let selectedCarType = 'سيدان';

function selectCar(el, type, price) {
  document.querySelectorAll('.car-type').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  carPrice = price;
  selectedCarType = type;
  autoCalcPrice();
}

// ========== تسجيل السائقين ==========
function openDriverModal() {
  document.getElementById('driver-form-error').textContent = '';
  document.getElementById('license-photo-preview').innerHTML = '';
  document.getElementById('driver-license-photo').value = '';
  document.getElementById('driver-modal').style.display = 'flex';
}

function closeDriverModal() {
  document.getElementById('driver-modal').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const photoInput = document.getElementById('driver-license-photo');
  if (photoInput) {
    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      const preview = document.getElementById('license-photo-preview');
      preview.innerHTML = '';
      if (file) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.style.cssText = 'max-width:100%;max-height:160px;border-radius:10px;border:1px solid var(--border);display:block;';
        preview.appendChild(img);
      }
    });
  }
});

function submitDriverRegistration() {
  const name = document.getElementById('driver-name').value.trim();
  const phone = document.getElementById('driver-phone').value.trim();
  const city = document.getElementById('driver-city').value.trim();
  const car = document.getElementById('driver-car').value.trim();
  const plate = document.getElementById('driver-plate').value.trim();
  const licenseNumber = document.getElementById('driver-license-number').value.trim();
  const licenseFile = document.getElementById('driver-license-photo').files[0];
  const errEl = document.getElementById('driver-form-error');

  if (!name || !phone || !city || !car || !plate || !licenseNumber) {
    errEl.textContent = 'املأ كل الخانات لو سمحت';
    return;
  }
  if (!/^01[0125][0-9]{8}$/.test(phone.replace(/\s|-/g, ''))) {
    errEl.textContent = 'رقم التليفون مش صح (مثال: 01012345678)';
    return;
  }
  if (!licenseFile) {
    errEl.textContent = 'ارفع صورة رخصة القيادة';
    return;
  }
  if (licenseFile.size > 5 * 1024 * 1024) {
    errEl.textContent = 'حجم الصورة كبير جدًا (الحد الأقصى 5 ميجا)';
    return;
  }
  errEl.textContent = '';

  const driverId = Date.now();
  const driver = {
    id: driverId,
    name, phone, city, car, plate,
    licenseNumber,
    verified: false,
    status: 'قيد المراجعة',
    time: new Date().toLocaleString('ar-EG'),
    driverUid: auth.currentUser ? auth.currentUser.uid : null
  };

  const btn = document.getElementById('submit-driver-btn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الرفع...';

  const finish = (saved) => {
    btn.disabled = false;
    btn.textContent = '📩 إرسال الطلب';
    if (saved) {
      closeDriverModal();
      ['driver-name','driver-phone','driver-city','driver-car','driver-plate','driver-license-number'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('license-photo-preview').innerHTML = '';
      showToast('✅ تم إرسال طلبك! هنتواصل معاك بعد التحقق من الرخصة');
    } else {
      errEl.textContent = 'حصل خطأ أثناء الإرسال، حاول تاني';
    }
  };

  if (!firebaseReady || !db || !firebase.storage) {
    finish(false);
    return;
  }

  const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  const storageRef = firebase.storage().ref('licenses/' + driverId + '.jpg');

  Promise.race([storageRef.put(licenseFile), timeoutPromise(20000)])
    .then(() => {
      driver.licensePhotoPath = 'licenses/' + driverId + '.jpg';
      return Promise.race([db.ref('drivers/' + driverId).set(driver), timeoutPromise(8000)]);
    })
    .then(() => finish(true))
    .catch((err) => {
      console.error('Driver registration error:', err);
      finish(false);
    });
}

function openClientModal() {
  const from = document.getElementById('from-text').textContent;
  const to = document.getElementById('to-text').textContent;
  if (to === 'اختار وجهتك') {
    showToast('⚠️ اختار الوجهة الأول');
    return;
  }
  if (from === 'جاري تحديد موقعك...') {
    showToast('⚠️ استنى تحديد موقعك أو اختاره بنفسك');
    return;
  }
  document.getElementById('sum-from').textContent = from;
  document.getElementById('sum-to').textContent = to;
  document.getElementById('sum-car').textContent = selectedCarType;
  document.getElementById('sum-price').textContent = document.getElementById('price-est').textContent;

  // نجهز تاريخ ووقت افتراضيين (النهارده والوقت الحالي) وميقدرش يختار تاريخ فات
  const dateInput = document.getElementById('client-trip-date');
  const timeInput = document.getElementById('client-trip-time');
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  dateInput.min = todayStr;
  if (!dateInput.value) dateInput.value = todayStr;
  if (!timeInput.value) timeInput.value = now.toTimeString().slice(0, 5);
  updateDateTimeSummary();

  // نعبّي الاسم والتليفون تلقائياً لو المستخدم حفظهم قبل كده من "تعديل الملف الشخصي"
  const savedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  if (savedProfile) {
    document.getElementById('client-name').value = savedProfile.name || '';
    document.getElementById('client-phone').value = savedProfile.phone || '';
  }
  document.getElementById('client-modal').style.display = 'flex';
}

function closeClientModal() {
  document.getElementById('client-modal').style.display = 'none';
}

// بيحدث سطر "الموعد" في ملخص الرحلة كل ما المستخدم يغيّر التاريخ أو الساعة
function updateDateTimeSummary() {
  const dateVal = document.getElementById('client-trip-date').value;
  const timeVal = document.getElementById('client-trip-time').value;
  if (dateVal && timeVal) {
    const d = new Date(dateVal + 'T' + timeVal);
    const dateFormatted = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
    document.getElementById('sum-datetime').textContent = `${dateFormatted} - ${timeVal}`;
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const dEl = document.getElementById('client-trip-date');
  const tEl = document.getElementById('client-trip-time');
  if (dEl) dEl.addEventListener('change', updateDateTimeSummary);
  if (tEl) tEl.addEventListener('change', updateDateTimeSummary);
});

// بيبعت تفاصيل الحجز لـ Pipedream عشان يوصل تنبيه واتساب فوري للأدمن
// "Fire and forget": مش بنستنى الرد ولا بنوقف حاجة لو فشل، التنبيه ثانوي والحجز الأساسي اتحفظ بالفعل
const WHATSAPP_NOTIFY_WEBHOOK = 'https://eo3m45xub7n29ib.m.pipedream.net';
function notifyWhatsAppNewBooking(booking) {
  fetch(WHATSAPP_NOTIFY_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: booking.name,
      phone: booking.phone,
      from: booking.from,
      to: booking.to,
      price: booking.price,
      car: booking.car,
      date: booking.tripDate,
      time: booking.tripTime,
      location: booking.locationLink
    })
  }).catch((err) => {
    // فشل إرسال التنبيه مش بيأثر على الحجز خالص - بس نسجله في الكونسول للمراجعة
    console.error('تعذر إرسال تنبيه واتساب:', err);
  });
}

// دالة الحجز - بتحاول تحفظ في Firebase الأول، ولو فشلت أو مش متاح تحفظ محلياً
function confirmBooking() {
  const name = document.getElementById('client-name').value.trim();
  const phone = document.getElementById('client-phone').value.trim();
  if (!name) {
    showToast('⚠️ اكتب اسمك');
    return;
  }
  if (name.length < 3) {
    showToast('⚠️ الاسم قصير أوي، اكتبه كامل');
    return;
  }
  if (!phone) {
    showToast('⚠️ اكتب رقم التليفون');
    return;
  }
  // تحقق أقوى: رقم مصري يبدأ بـ 01 وطوله 11 رقم
  const phoneClean = phone.replace(/\s|-/g, '');
  if (!/^01[0125][0-9]{8}$/.test(phoneClean)) {
    showToast('⚠️ رقم التليفون لازم يكون مصري صحيح (11 رقم ويبدأ بـ 01)');
    return;
  }

  const tripDate = document.getElementById('client-trip-date').value;
  const tripTime = document.getElementById('client-trip-time').value;
  if (!tripDate || !tripTime) {
    showToast('⚠️ اختار تاريخ ووقت المشوار');
    return;
  }
  // مش نسمح بتاريخ/وقت فات
  const selectedDT = new Date(tripDate + 'T' + tripTime);
  if (selectedDT.getTime() < Date.now() - 5 * 60 * 1000) { // سماحية 5 دقايق
    showToast('⚠️ مش ممكن تحجز ميعاد فات، اختار وقت قدام');
    return;
  }

  if (!auth.currentUser) {
    showToast('⚠️ جاري تجهيز الاتصال، حاول تاني بعد ثانية');
    return;
  }

  if (lastComputedPriceValue === null || lastComputedPriceValue === undefined || lastComputedPriceValue < 0) {
    showToast('⚠️ حصل خطأ في حساب السعر، اختار الوجهة تاني');
    return;
  }

  const booking = {
    id: Date.now(),
    name,
    phone: phoneClean,
    from: document.getElementById('from-text').textContent,
    to: document.getElementById('to-text').textContent,
    car: selectedCarType,
    price: document.getElementById('price-est').textContent,
    priceValue: lastComputedPriceValue,
    tripDate,
    tripTime,
    locationLink: `https://www.google.com/maps?q=${userLat},${userLng}`,
    km: document.getElementById('km-display').textContent,
    time: new Date().toLocaleString('ar-EG'),
    status: 'جديد',
    clientUid: auth.currentUser.uid
  };

  const btn = document.getElementById('confirm-booking-btn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الحجز...';

  const finishBooking = (savedToFirebase) => {
    btn.disabled = false;
    btn.textContent = '✅ تأكيد الحجز';
    closeClientModal();
    document.getElementById('client-name').value = '';
    document.getElementById('client-phone').value = '';
    if (savedToFirebase) {
      // الحجز اتسجل بنجاح - نعرض شاشة تأكيد بسيطة بدل شاشة تتبع السائق
      document.getElementById('success-msg').textContent =
        `هيتم التواصل معك على ${phoneClean} لتأكيد تفاصيل رحلتك.`;
      document.getElementById('booking-success-modal').classList.add('visible');
    }
    // لو فشل الحفظ على Firebase، مودال الخطأ (booking-error-modal) هو اللي ظاهر بالفعل ومفيهوش داعي لعرض تأكيد فوقه
  };

  if (firebaseReady && db) {
    // نحفظ الحجز في Firebase تحت /bookings/{id} علشان يبقى متاح من أي جهاز وللأدمن مباشرة
    // بنحط مهلة 8 ثواني: لو الاتصال بـ Firebase علّق (شبكة بتمنع الـ WebSocket مثلاً)
    // الزرار مش هيفضل واقف للأبد - هيرجع لحفظ محلي ويوضحلك في التوست
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 8000);
    });

    Promise.race([db.ref('bookings/' + booking.id).set(booking), timeoutPromise])
      .then(() => {
        // نحدث النسخة المحلية كمان (كـ cache للعرض السريع)
        bookings.unshift(booking);
        localStorage.setItem('safariat_bookings', JSON.stringify(bookings));
        finishBooking(true);
        // نبعت تنبيه واتساب فوري عبر Pipedream - مش حرج لو فشل (الحجز نفسه اتحفظ بنجاح بالفعل)
        notifyWhatsAppNewBooking(booking);
      })
      .catch((err) => {
        console.error('Firebase save error:', err);
        // فشل الحفظ على فايربيز (أو استنى كتير) - نحفظ محلياً كـ fallback عشان الحجز ميضيعش
        bookings.unshift(booking);
        localStorage.setItem('safariat_bookings', JSON.stringify(bookings));
        const detail = err.message === 'timeout'
          ? 'السبب: الاتصال بسيرفر Firebase استغرق أكتر من 8 ثواني (timeout). ده غالباً بسبب الشبكة بتمنع الاتصال، أو Realtime Database لسه مش متظبطة صح.'
          : 'كود الخطأ: ' + (err.code || 'غير معروف') + '\nالتفاصيل: ' + err.message;
        document.getElementById('booking-error-detail').textContent = detail;
        document.getElementById('booking-error-modal').style.display = 'flex';
        finishBooking(false);
      });
  } else {
    // Firebase مش مضبوط أو فشل التحميل من البداية - نحفظ محلياً بس، ولازم نوضح ده بوضوح للمستخدم
    bookings.unshift(booking);
    localStorage.setItem('safariat_bookings', JSON.stringify(bookings));
    document.getElementById('booking-error-detail').textContent =
      'السبب: مكتبة Firebase مقدرتش تتحمل في المتصفح أصلاً (firebaseReady = false من ساعة ما الصفحة فتحت). ' +
      'الاحتمالات: 1) في إضافة أو إعداد على المتصفح بيمنع تحميل سكريبتات من gstatic.com. ' +
      '2) في مشكلة في الشبكة وقت تحميل الصفحة. ' +
      'جرب تفتح الصفحة من متصفح تاني أو تقفل أي مانع إعلانات (Ad blocker) وجرب تاني.';
    document.getElementById('booking-error-modal').style.display = 'flex';
    finishBooking(false);
  }
}

// ========== لوحة الأدمن (Firebase Authentication حقيقي - إيميل + كلمة سر) ==========
// كلمة السر بقت متحققة عن طريق سيرفرات Firebase نفسها، مش مقارنة نص في المتصفح.
// الحماية الحقيقية جاية من Security Rules على الـ Database (auth != null للقراءة/التعديل).
let adminBookingsRef = null;
let adminDriversRef = null;
let drivers = [];

function isAdminAuthed() {
  return firebaseReady && auth.currentUser !== null && !auth.currentUser.isAnonymous && window.__currentRole === 'admin';
}

function switchAdminTab(tab) {
  const bookingsBtn = document.getElementById('admin-tab-bookings-btn');
  const driversBtn = document.getElementById('admin-tab-drivers-btn');
  const bookingsPane = document.getElementById('admin-tab-bookings');
  const driversPane = document.getElementById('admin-tab-drivers');
  if (tab === 'drivers') {
    driversPane.style.display = 'block';
    bookingsPane.style.display = 'none';
    driversBtn.style.border = '1px solid var(--accent)';
    driversBtn.style.background = 'rgba(217,119,87,0.15)';
    driversBtn.style.color = 'var(--accent)';
    bookingsBtn.style.border = '1px solid var(--border)';
    bookingsBtn.style.background = 'var(--card)';
    bookingsBtn.style.color = 'var(--text)';
  } else {
    bookingsPane.style.display = 'block';
    driversPane.style.display = 'none';
    bookingsBtn.style.border = '1px solid var(--accent)';
    bookingsBtn.style.background = 'rgba(217,119,87,0.15)';
    bookingsBtn.style.color = 'var(--accent)';
    driversBtn.style.border = '1px solid var(--border)';
    driversBtn.style.background = 'var(--card)';
    driversBtn.style.color = 'var(--text)';
  }
}

function openAdminPanel() {
  if (!firebaseReady) {
    document.getElementById('booking-error-detail').textContent =
      'مكتبة Firebase مقدرتش تتحمل في المتصفح أصلاً (firebaseReady = false). ' +
      'جرب تفتح الصفحة من متصفح تاني، أو اقفل أي مانع إعلانات (Ad blocker)، أو تأكد إن النت شغال، وجرب تاني.';
    document.getElementById('booking-error-modal').style.display = 'flex';
    return;
  }
  if (!window.__authReady) {
    // لسه بنتحقق من الـ role - نستنى شوية بدل ما نحكم بالغلط
    setTimeout(openAdminPanel, 300);
    return;
  }
  if (isAdminAuthed()) {
    enterAdminPanel();
    return;
  }
  document.getElementById('admin-login-email').value = '';
  document.getElementById('admin-login-pass').value = '';
  document.getElementById('admin-login-error').textContent = '';
  document.getElementById('admin-login-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('admin-login-email').focus(), 200);
}

function closeAdminLoginModal() {
  document.getElementById('admin-login-modal').style.display = 'none';
}

function submitAdminLogin() {
  const email = document.getElementById('admin-login-email').value.trim();
  const pass = document.getElementById('admin-login-pass').value;
  const errEl = document.getElementById('admin-login-error');
  const btn = document.getElementById('admin-login-btn');

  if (!email || !pass) {
    errEl.textContent = '⚠️ اكتب الإيميل وكلمة السر';
    return;
  }

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = '⏳ جاري الدخول...';

  auth.signInWithEmailAndPassword(email, pass)
    .then((cred) => refreshCurrentRole(cred.user))
    .then((role) => {
      btn.disabled = false;
      btn.textContent = 'دخول';
      if (role !== 'admin') {
        // مسجل دخول صح بس مش أدمن - نرفض الدخول للوحة ونسجله خروج
        auth.signOut();
        errEl.textContent = '❌ الحساب ده مش عنده صلاحية أدمن';
        return;
      }
      closeAdminLoginModal();
      enterAdminPanel();
    })
    .catch((err) => {
      btn.disabled = false;
      btn.textContent = 'دخول';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        errEl.textContent = '❌ الإيميل أو كلمة السر غلط';
      } else if (err.code === 'auth/too-many-requests') {
        errEl.textContent = '⚠️ محاولات كتير غلط - جرب تاني بعد شوية';
      } else {
        errEl.textContent = '❌ حصل خطأ: ' + err.message;
      }
    });
}

function adminLogout() {
  auth.signOut().then(() => {
    closeAdminPanel();
    showToast('تم تسجيل الخروج');
  });
}

function enterAdminPanel() {
  document.getElementById('admin-panel').style.display = 'flex';
  const banner = document.getElementById('firebase-status-banner');
  banner.style.display = 'none';
  // نعمل listener حي (realtime) على /bookings عشان أي حجز جديد يظهر فوراً
  if (adminBookingsRef) adminBookingsRef.off();
  // بنجيب آخر 100 حجز بس (مش كل الحجوزات من الأول) عشان الأداء واستهلاك البيانات
  // ده شغال كويس لأن مفتاح كل حجز هو Date.now()، يعني ترتيب المفاتيح = ترتيب الوقت فعليًا
  adminBookingsRef = db.ref('bookings').orderByKey().limitToLast(100);
  adminBookingsRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    bookings = Object.values(data).sort((a, b) => b.id - a.id);
    localStorage.setItem('safariat_bookings', JSON.stringify(bookings));
    renderBookings();
  }, (err) => {
    console.error('Firebase read error:', err);
    banner.style.display = 'block';
    banner.textContent = '⚠️ متقدرش تقرا الحجوزات - راجع صلاحيات (Security Rules) أو إنك لسه مسجل دخول';
    renderBookings();
  });

  // نفس الفكرة بالظبط لطلبات تسجيل السائقين
  if (adminDriversRef) adminDriversRef.off();
  adminDriversRef = db.ref('drivers');
  adminDriversRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    drivers = Object.values(data).sort((a, b) => b.id - a.id);
    renderDrivers();
  }, (err) => {
    console.error('Firebase drivers read error:', err);
    renderDrivers();
  });
}

function changeAdminPassword() {
  document.getElementById('cp-current').value = '';
  document.getElementById('cp-new').value = '';
  document.getElementById('cp-confirm').value = '';
  document.getElementById('cp-error').textContent = '';
  document.getElementById('change-pass-modal').style.display = 'flex';
}

function closeChangePassModal() {
  document.getElementById('change-pass-modal').style.display = 'none';
}

function confirmChangePass() {
  const current = document.getElementById('cp-current').value;
  const newPass = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  const errEl = document.getElementById('cp-error');

  if (!auth.currentUser) {
    errEl.textContent = '❌ لازم تكون مسجل دخول';
    return;
  }
  if (!newPass || newPass.length < 6) {
    errEl.textContent = '⚠️ كلمة السر لازم تكون 6 أحرف على الأقل!';
    return;
  }
  if (newPass !== confirm) {
    errEl.textContent = '❌ كلمتا السر مش متطابقتين!';
    return;
  }

  // Firebase بيطلب "إعادة تحقق" (reauthenticate) بكلمة السر الحالية قبل ما يسمح بتغييرها،
  // ده إجراء أمان حقيقي بيمنع أي حد قاعد على جهاز مفتوح إنه يغير الباسورد من غير ما يعرفها
  const cred = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, current);
  auth.currentUser.reauthenticateWithCredential(cred)
    .then(() => auth.currentUser.updatePassword(newPass))
    .then(() => {
      closeChangePassModal();
      showToast('✅ تم تغيير كلمة السر بنجاح!');
    })
    .catch((err) => {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        errEl.textContent = '❌ كلمة السر الحالية غلط!';
      } else {
        errEl.textContent = '❌ حصل خطأ: ' + err.message;
      }
    });
}

function closeAdminPanel() {
  document.getElementById('admin-panel').style.display = 'none';
  if (adminBookingsRef) { adminBookingsRef.off(); adminBookingsRef = null; }
  if (adminDriversRef) { adminDriversRef.off(); adminDriversRef = null; }
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBookings() {
  const list = document.getElementById('bookings-list');
  const noBookings = document.getElementById('no-bookings');
  document.getElementById('bookings-count').textContent = bookings.length + ' حجز';

  if (bookings.length === 0) {
    list.innerHTML = '';
    noBookings.style.display = 'block';
    return;
  }

  noBookings.style.display = 'none';
  list.innerHTML = bookings.map(b => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:1rem;margin-bottom:0.8rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
        <div style="font-size:1rem;font-weight:700;">👤 ${escapeHtml(b.name)}</div>
        <div style="background:${b.status==='جديد'?'rgba(168,230,61,0.2)':'rgba(217,119,87,0.25)'};color:${b.status==='جديد'?'var(--accent)':'var(--accent2)'};border-radius:50px;padding:0.2rem 0.7rem;font-size:0.75rem;font-weight:700;">${escapeHtml(b.status)}</div>
      </div>
      <div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.3rem;">📞 ${escapeHtml(b.phone)}</div>
      <div style="font-size:0.82rem;margin-bottom:0.2rem;">📍 <b>${escapeHtml(b.from)}</b> ← 🎯 <b>${escapeHtml(b.to)}</b></div>
      <div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.2rem;">🚗 ${escapeHtml(b.car)} • ${escapeHtml(b.km)}</div>
      ${b.tripDate && b.tripTime ? `<div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.2rem;">📅 موعد المشوار: ${escapeHtml(b.tripDate)} - ${escapeHtml(b.tripTime)}</div>` : ''}
      ${b.locationLink ? `<div style="font-size:0.82rem;margin-bottom:0.2rem;"><a href="${escapeHtml(b.locationLink)}" target="_blank" style="color:var(--accent);">🗺️ لوكيشن الانطلاق</a></div>` : ''}
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.5rem;">🕐 وقت تسجيل الحجز: ${escapeHtml(b.time)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:1.1rem;font-weight:900;color:var(--accent);">${escapeHtml(b.price)}</div>
        <div style="display:flex;gap:0.5rem;">
          <button onclick="updateStatus(${b.id},'قيد التنفيذ')" style="padding:0.4rem 0.7rem;background:rgba(168,230,61,0.15);border:1px solid var(--accent);border-radius:8px;color:var(--accent);font-family:'Cairo',sans-serif;font-size:0.75rem;cursor:pointer;">✅ قبول</button>
          <button onclick="updateStatus(${b.id},'ملغي')" style="padding:0.4rem 0.7rem;background:rgba(217,119,87,0.12);border:1px solid var(--accent2);border-radius:8px;color:var(--accent2);font-family:'Cairo',sans-serif;font-size:0.75rem;cursor:pointer;">❌ إلغاء</button>
          <button onclick="deleteBooking(${b.id})" style="padding:0.4rem 0.7rem;background:rgba(255,0,0,0.1);border:1px solid red;border-radius:8px;color:red;font-family:'Cairo',sans-serif;font-size:0.75rem;cursor:pointer;">🗑️</button>
        </div>
      </div>
    </div>
  `).join('');
}

function updateStatus(id, status) {
  if (firebaseReady && db) {
    db.ref('bookings/' + id + '/status').set(status).catch(err => console.error('update error:', err));
    // مفيش داعي نعمل حاجة تانية - الـ listener هيحدث القائمة تلقائياً
  } else {
    bookings = bookings.map(b => b.id === id ? {...b, status} : b);
    localStorage.setItem('safariat_bookings', JSON.stringify(bookings));
    renderBookings();
  }
}

function deleteBooking(id) {
  if (firebaseReady && db) {
    db.ref('bookings/' + id).remove().catch(err => console.error('delete error:', err));
  } else {
    bookings = bookings.filter(b => b.id !== id);
    localStorage.setItem('safariat_bookings', JSON.stringify(bookings));
    renderBookings();
  }
}

// ========== طلبات تسجيل السائقين (مراجعة وتوثيق الرخصة) ==========
function renderDrivers() {
  const list = document.getElementById('drivers-list');
  const noDrivers = document.getElementById('no-drivers');
  const badge = document.getElementById('pending-drivers-badge');
  const pendingCount = drivers.filter(d => d.status === 'قيد المراجعة').length;

  if (pendingCount > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = pendingCount;
  } else {
    badge.style.display = 'none';
  }

  if (drivers.length === 0) {
    list.innerHTML = '';
    noDrivers.style.display = 'block';
    return;
  }

  noDrivers.style.display = 'none';
  list.innerHTML = drivers.map(d => {
    const statusColor = d.status === 'نشط' ? 'var(--accent)' : (d.status === 'مرفوض' ? '#ff6666' : 'var(--accent2)');
    const statusBg = d.status === 'نشط' ? 'rgba(217,119,87,0.2)' : (d.status === 'مرفوض' ? 'rgba(255,60,60,0.15)' : 'rgba(226,150,125,0.2)');
    return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:1rem;margin-bottom:0.8rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
        <div style="font-size:1rem;font-weight:700;">👤 ${escapeHtml(d.name)} ${d.verified ? '✅' : ''}</div>
        <div style="background:${statusBg};color:${statusColor};border-radius:50px;padding:0.2rem 0.7rem;font-size:0.75rem;font-weight:700;">${escapeHtml(d.status)}</div>
      </div>
      <div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.3rem;">📞 ${escapeHtml(d.phone)} • 📍 ${escapeHtml(d.city)}</div>
      <div style="font-size:0.82rem;margin-bottom:0.3rem;">🚗 ${escapeHtml(d.car)} • 🔢 ${escapeHtml(d.plate)}</div>
      <div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.6rem;">🪪 رقم الرخصة: ${escapeHtml(d.licenseNumber)}</div>
      <div id="license-img-${d.id}" style="margin-bottom:0.8rem;background:var(--card);border-radius:10px;padding:0.6rem;text-align:center;font-size:0.78rem;color:var(--muted);cursor:pointer;" onclick="loadLicensePhoto(${d.id}, '${escapeHtml(d.licensePhotoPath || '')}')">📷 دوس لعرض صورة الرخصة</div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:0.72rem;color:var(--muted);">${escapeHtml(d.time)}</div>
        <div style="display:flex;gap:0.5rem;">
          ${!d.verified ? `<button onclick="verifyDriver(${d.id})" style="padding:0.4rem 0.7rem;background:rgba(217,119,87,0.15);border:1px solid var(--accent);border-radius:8px;color:var(--accent);font-family:'Cairo',sans-serif;font-size:0.75rem;cursor:pointer;">✅ توثيق</button>` : ''}
          ${d.status !== 'مرفوض' ? `<button onclick="rejectDriver(${d.id})" style="padding:0.4rem 0.7rem;background:rgba(217,119,87,0.12);border:1px solid var(--accent2);border-radius:8px;color:var(--accent2);font-family:'Cairo',sans-serif;font-size:0.75rem;cursor:pointer;">❌ رفض</button>` : ''}
          <button onclick="deleteDriver(${d.id})" style="padding:0.4rem 0.7rem;background:rgba(255,0,0,0.1);border:1px solid red;border-radius:8px;color:red;font-family:'Cairo',sans-serif;font-size:0.75rem;cursor:pointer;">🗑️</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

function loadLicensePhoto(id, path) {
  const container = document.getElementById('license-img-' + id);
  if (!path || !firebase.storage) {
    container.textContent = '⚠️ مفيش صورة مرفوعة';
    return;
  }
  container.textContent = '⏳ جاري تحميل الصورة...';
  firebase.storage().ref(path).getDownloadURL()
    .then(url => {
      container.innerHTML = `<img src="${url}" style="max-width:100%;max-height:220px;border-radius:8px;">`;
    })
    .catch(err => {
      console.error('License photo load error:', err);
      container.textContent = '❌ مقدرش يحمل الصورة (راجع Storage Security Rules)';
    });
}

function verifyDriver(id) {
  if (firebaseReady && db) {
    db.ref('drivers/' + id).update({ verified: true, status: 'نشط' })
      .catch(err => console.error('verify error:', err));
  }
}

function rejectDriver(id) {
  if (firebaseReady && db) {
    db.ref('drivers/' + id).update({ verified: false, status: 'مرفوض' })
      .catch(err => console.error('reject error:', err));
  }
}

function deleteDriver(id) {
  if (firebaseReady && db) {
    db.ref('drivers/' + id).remove().catch(err => console.error('delete driver error:', err));
  }
}

// ========== الملف الشخصي المحلي (اسم ورقم المستخدم، محفوظين على الجهاز) ==========
const PROFILE_KEY = 'safariat_profile';
// رقم واتساب الدعم الفني - غيّره لرقمك الحقيقي (بصيغة دولية بدون + أو أصفار، مثال: 201001234567)
const SUPPORT_WHATSAPP_NUMBER = '201098403012';

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (saved && saved.name) {
      document.getElementById('profile-name-display').textContent = saved.name;
      document.getElementById('profile-phone-display').textContent = saved.phone || 'لم يتم إضافة رقم';
      const initial = saved.name.trim().charAt(0) || 'م';
      document.getElementById('profile-avatar-initial').textContent = initial;
      document.getElementById('topbar-avatar-initial').textContent = initial;
    }
  } catch (e) {
    console.error('profile load error:', e);
  }
}

function openEditProfileModal() {
  const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null') || {};
  document.getElementById('edit-profile-name').value = saved.name || document.getElementById('profile-name-display').textContent;
  document.getElementById('edit-profile-phone').value = saved.phone || '';
  document.getElementById('edit-profile-modal').classList.add('visible');
}

function closeEditProfileModal() {
  document.getElementById('edit-profile-modal').classList.remove('visible');
}

function saveProfile() {
  const name = document.getElementById('edit-profile-name').value.trim();
  const phone = document.getElementById('edit-profile-phone').value.trim();
  if (!name) {
    showToast('⚠️ اكتب اسمك الأول');
    return;
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, phone }));
  loadProfile();
  closeEditProfileModal();
  showToast('✅ تم حفظ بياناتك، وهتتملى تلقائياً وقت الحجز');
}

function openSupportChat() {
  const msg = encodeURIComponent('مرحباً، محتاج مساعدة بخصوص تطبيق سفريات اكس 🚗');
  window.open(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${msg}`, '_blank');
}

function logoutUser() {
  localStorage.removeItem(PROFILE_KEY);
  document.getElementById('profile-name-display').textContent = 'ضيف';
  document.getElementById('profile-phone-display').textContent = 'لم يتم إضافة رقم';
  document.getElementById('profile-avatar-initial').textContent = 'ض';
  document.getElementById('topbar-avatar-initial').textContent = 'ض';
  showScreen('home');
  showToast('👋 تم تسجيل الخروج ومسح بياناتك المحفوظة على الجهاز ده');
}

function closeSuccessModal() {
  document.getElementById('booking-success-modal').classList.remove('visible');
  showScreen('home');
}

function toggleMenu() {
  const menu = document.getElementById('side-menu');
  const overlay = document.getElementById('menu-overlay');
  const isOpen = menu.style.transform === 'translateX(0%)';
  menu.style.transform = isOpen ? 'translateX(100%)' : 'translateX(0%)';
  overlay.style.display = isOpen ? 'none' : 'block';
}

function showNotif() {
  showToast('🔔 مفيش إشعارات جديدة');
}

// INIT
window.onload = () => {
  loadProfile();
  setTimeout(() => {
    initMap();
    showScreen('home');
  }, 3100);
};

// تسجيل Service Worker عشان التطبيق يبقى PWA قابل للتثبيت
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('Service Worker registered:', reg.scope);
    }).catch(err => {
      console.log('Service Worker registration failed:', err);
    });
  });
}
