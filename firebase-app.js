// firebase-app.js — Sadewa Elektronik
// Firebase + semua logic utama (cart, payment, produk, admin)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, query, orderBy,
  enableIndexedDbPersistence, doc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, setDoc, increment, getDocs, getDoc, where, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ── Firebase Init ──
const firebaseConfig = {
  apiKey: "AIzaSyDu21X_Cr7RoTMUnMS9oZCAVOS15D3ssyI",
  authDomain: "sadewa-2.firebaseapp.com",
  projectId: "sadewa-2",
  storageBucket: "sadewa-2.firebasestorage.app",
  messagingSenderId: "325894971034",
  appId: "1:325894971034:web:f0c3cca5083f53d6008923",
  measurementId: "G-2M9X5453L4"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
// ── Google Login ──
const googleProvider = new GoogleAuthProvider();
// Selalu tampilkan daftar pilihan akun Google (account chooser), bukan
// langsung masuk pakai akun terakhir yang tersimpan di browser. Penting
// karena banyak orang punya lebih dari satu akun Gmail (pribadi/kerja/dll)
// dan perlu bisa memilih akun yang mana yang dipakai belanja.
googleProvider.setCustomParameters({ prompt: 'select_account' });

window.loginWithGoogle = async function () {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    console.log("Login berhasil:", result.user);
    if (typeof window.showBuyerToast === 'function') {
      window.showBuyerToast(`✅ Login berhasil sebagai ${result.user.email}`);
    }
  } catch (err) {
    console.error("Login gagal:", err);
    // popup-closed-by-user / cancelled: jangan tampilkan sebagai error mengganggu
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      if (typeof window.showBuyerToast === 'function') {
        window.showBuyerToast('❌ Login Google gagal, silakan coba lagi', true);
      }
    }
  }
};

// ── Logout Google (buyer) ──
// Hanya sign-out dari Firebase Auth. Tidak menghapus keranjang/localStorage
// pembeli (cartItems, alamat tersimpan) supaya belanjaan tidak hilang saat
// user cuma ingin ganti akun / menjaga privasi di perangkat bersama.
window.logoutGoogle = async function () {
  try {
    await signOut(auth);
    if (typeof window.showBuyerToast === 'function') {
      window.showBuyerToast('👋 Anda telah logout');
    }
  } catch (err) {
    console.error('logoutGoogle error:', err);
  }
};

// ── UI: tombol Login <-> alamat Gmail + tombol Logout ──
// Dipanggil setiap kali status auth berubah (lihat onAuthStateChanged di bawah).
function updateBuyerAuthUI(user) {
  const btn = document.getElementById('btnLoginGoogle');
  const label = document.getElementById('btnLoginGoogleLabel');
  const logoutBtn = document.getElementById('btnLogoutGoogle');
  if (!btn || !label) return;

  const isGoogleBuyer = !!(user && user.providerData &&
    user.providerData.some(p => p.providerId === 'google.com'));

  if (isGoogleBuyer) {
    label.textContent = user.email;
    btn.title = user.email;
    btn.classList.add('logged-in');
    btn.onclick = null; // tidak ada aksi klik saat sudah login (info saja)
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
  } else {
    label.textContent = 'Login';
    btn.title = 'Login dengan Google';
    btn.classList.remove('logged-in');
    btn.onclick = window.loginWithGoogle;
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

// Wajib login Google sebelum transaksi. Dipanggil di titik masuk checkout
// (openPaymentModal & buyDirectly). Mengembalikan true kalau boleh lanjut.
function requireBuyerLogin() {
  const isGoogleBuyer = !!(currentUser && currentUser.providerData &&
    currentUser.providerData.some(p => p.providerId === 'google.com'));
  if (!isGoogleBuyer) {
    if (typeof window.showBuyerToast === 'function') {
      window.showBuyerToast('🔒 Silakan login dengan Google terlebih dahulu untuk melanjutkan transaksi', true);
    } else {
      alert('Silakan login dengan Google terlebih dahulu untuk melanjutkan transaksi');
    }
    window.loginWithGoogle();
    return false;
  }
  return true;
}
const prodCol = collection(db, "sadewaProducts");

try {
  enableIndexedDbPersistence(db);
} catch (err) {
  if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
    console.error('Persistence error:', err);
  }
}

// ── State ──
let products = [];
let lastSearchQuery = '';
let activeCategory = 'all';
let filteredProducts = null;
let cartItems = [];
let adminAuthenticated = false;
let currentUser = null;
let variantImages = {};
let mainImageBase64 = '';
let mainVideoBase64 = '';
let variantCounter = 0;

// [PATCH KEAMANAN] Kredensial admin hardcoded (ADMIN_USER/ADMIN_PASS) DIHAPUS.
// Alasan: file .js ini dikirim ke browser SIAPA SAJA yang membuka situs — artinya
// username & password admin sebelumnya bisa dibaca langsung lewat "View Source",
// tanpa perlu hacking sama sekali. Login admin sekarang WAJIB lewat Firebase
// Authentication (signInWithEmailAndPassword). Buat akun admin di Firebase Console
// > Authentication > Add user, dengan email format: <username>@sadewa-admin.local

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  // Catatan: auth instance ini dipakai bareng oleh login Google (pembeli) dan
  // login email/password (admin, lihat handleLogin()). updateBuyerAuthUI akan
  // otomatis mendeteksi apakah user yang sedang login itu akun Google
  // (providerId 'google.com') sebelum menampilkan alamat gmail di tombol.
  updateBuyerAuthUI(user);
});

// ============================================================
// CART
// ============================================================
function loadCartFromStorage() {
  const saved = localStorage.getItem('sadewaCart');
  if (saved) { try { cartItems = JSON.parse(saved); updateCartBadge(); } catch (e) { cartItems = []; } }
  window._sadewaCart = cartItems.map(item => ({ weight: item.weight || 1000, qty: item.quantity || 1 }));
}
function saveCartToStorage() {
  localStorage.setItem('sadewaCart', JSON.stringify(cartItems));
  // Jembatan ke ongkir-integration.js: cartItems asli pakai field price/quantity,
  // ongkir butuh weight/qty. Default 1000gr per item kalau produk belum punya berat.
  window._sadewaCart = cartItems.map(item => ({
    weight: item.weight || 1000,
    qty: item.quantity || 1
  }));
}

window.toggleCart = function () {
  const modal = document.getElementById('cartModal');
  modal.classList.toggle('active');
  if (modal.classList.contains('active')) renderCart();
};
window.closeCartOnOverlay = function (event) {
  if (event.target.id === 'cartModal') toggleCart();
};

function getVariantOptions(category) {
  const variantMap = {
    'Lampu': ['5 Watt', '7 Watt', '10 Watt', '15 Watt', '20 Watt', '25 Watt', '30 Watt', '40 Watt', '50 Watt', '60 Watt'],
    'Kabel': ['1.5mm', '2.5mm', '4mm', '6mm', '10mm'],
    'Kipas Angin': ['12 inch', '16 inch', '18 inch', '20 inch'],
    'Saklar': ['1 Gang', '2 Gang', '3 Gang', '4 Gang'],
    'Stopkontak': ['2 Lubang', '3 Lubang', '4 Lubang', 'Universal']
  };
  return variantMap[category] || [];
}

// ============================================================
// TOAST NOTIFIKASI (KERANJANG) — menggantikan alert() bawaan browser
// agar konsisten dengan gaya UI/UX situs (memakai elemen #toastNotif
// yang sudah ada di index.html).
// ============================================================
let _toastTimer = null;
window.showBuyerToast = function (msg, isError) {
  const el = document.getElementById('toastNotif');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('toast-notification--error', !!isError);
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
};

window.removeFromCart = function (index) {
  cartItems.splice(index, 1); saveCartToStorage(); updateCartBadge(); renderCart();
};
window.updateQuantity = function (index, change) {
  cartItems[index].quantity += change;
  if (cartItems[index].quantity <= 0) window.removeFromCart(index);
  else { saveCartToStorage(); renderCart(); }
};
function getShippingCost() { return (window._sadewaShippingCost && window._sadewaShippingCost.cost) || 0; }
function calculateTotal() { return cartItems.reduce((s, i) => s + (i.price * i.quantity), 0) + getShippingCost(); }

function updateCartBadge() {
  const count = cartItems.reduce((s, i) => s + i.quantity, 0);
  const b = document.getElementById('cartBadge'); if (b) b.textContent = count;
  const mb = document.getElementById('mbnCartBadge'); if (mb) mb.textContent = count;
}

function renderCart() {
  const container = document.getElementById('cartItemsContainer');
  const totalEl = document.getElementById('cartTotalValue');
  if (!container || !totalEl) return;
  if (cartItems.length === 0) {
    container.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><p class="cart-empty-text">Keranjang masih kosong</p></div>';
    totalEl.textContent = 'Rp 0'; return;
  }
  container.innerHTML = cartItems.map((item, index) => {
    const media = item.media && item.media.startsWith('data:image')
      ? `<img src="${item.media}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;margin-right:12px;">`
      : `<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;font-size:2rem;margin-right:12px;">${item.media || '⚡'}</div>`;
    return `<div class="cart-item">
      <div class="cart-item-header">
        <div style="display:flex;align-items:center;flex:1;">${media}
          <div><div class="cart-item-name">${item.name}</div>${item.variant ? `<div class="cart-item-variant">Varian: ${item.variant}</div>` : ''}</div>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart(${index})">🗑️</button>
      </div>
      <div class="cart-item-footer">
        <div class="cart-item-quantity">
          <button class="qty-btn" onclick="updateQuantity(${index},-1)">-</button>
          <span class="qty-value">${item.quantity}</span>
          <button class="qty-btn" onclick="updateQuantity(${index},1)">+</button>
        </div>
        <div class="cart-item-price">Rp ${(item.price * item.quantity).toLocaleString('id-ID')}</div>
      </div>
    </div>`;
  }).join('');
  totalEl.textContent = 'Rp ' + calculateTotal().toLocaleString('id-ID');
}

window.clearCart = function () {
  if (confirm('Yakin ingin mengosongkan keranjang?')) {
    cartItems = []; saveCartToStorage(); updateCartBadge(); renderCart();
  }
};

// ============================================================
// PAYMENT
// ============================================================
let selectedPaymentMethod = 'bank', selectedPaymentProvider = 'bri';
// true setelah tombol "Konfirmasi Pembayaran" ditekan & detail (rekening/QRIS)
// sudah ditampilkan ke pembeli. Direset setiap kali tab/opsi pembayaran diganti.
let paymentDetailsRevealed = false;
// Cache hasil fetch dari Firestore (sadewaSettings/payment), supaya tidak
// query berulang setiap kali reveal dipanggil dalam 1 sesi checkout.
let _sadewaPaymentSettings = null;

// Nilai default/fallback kalau dokumen Firestore "sadewaSettings/payment"
// belum dibuat atau gagal diambil (misal offline) -- supaya checkout TIDAK
// pernah rusak total. Admin mengubah nomor rekening/QRIS asli lewat Firestore
// Console: collection "sadewaSettings" -> dokumen "payment". Lihat catatan
// struktur dokumen di bagian bawah file ini / dokumentasi yang menyertai.
const DEFAULT_PAYMENT_SETTINGS = {
  banks: {
    bri: { bankName: 'BRI', accountNumber: '3456-01-001829-50-2', accountName: 'AI JULAEHA' }
  },
  qris: {
    imageUrl: '/qris-sadewa.jpeg',
    merchantName: 'SADEWA ELEKTRONIK CIDAHU',
    nmid: 'ID1024348386623 \u00b7 A01'
  }
};

// Ambil pengaturan pembayaran dari Firestore, di-cache di memori selama sesi.
async function getPaymentSettings() {
  if (_sadewaPaymentSettings) return _sadewaPaymentSettings;
  try {
    const snap = await getDoc(doc(db, 'sadewaSettings', 'payment'));
    _sadewaPaymentSettings = snap.exists()
      ? { ...DEFAULT_PAYMENT_SETTINGS, ...snap.data(), banks: { ...DEFAULT_PAYMENT_SETTINGS.banks, ...(snap.data().banks || {}) } }
      : DEFAULT_PAYMENT_SETTINGS;
  } catch (err) {
    console.error('getPaymentSettings:', err);
    _sadewaPaymentSettings = DEFAULT_PAYMENT_SETTINGS;
  }
  return _sadewaPaymentSettings;
}

window.refreshPaymentTotals = function () {
  const items = window.isBuyNowMode ? (window.tempBuyNowCart || []) : cartItems;
  const orderItemsEl = document.getElementById('paymentOrderItems');
  if (orderItemsEl) {
    orderItemsEl.innerHTML = items.map(item =>
      `<div class="order-item"><span>${item.name} ${item.variant ? '(' + item.variant + ')' : ''} x${item.quantity}</span><span>Rp ${(item.price * item.quantity).toLocaleString('id-ID')}</span></div>`
    ).join('') + (getShippingCost() > 0
      ? `<div class="order-item"><span>Ongkos Kirim (${window._sadewaShippingCost.courier} - ${window._sadewaShippingCost.service})</span><span>Rp ${getShippingCost().toLocaleString('id-ID')}</span></div>`
      : '');
  }
  const total = items.reduce((s, i) => s + (i.price * i.quantity), 0) + getShippingCost();
  const totalEl = document.getElementById('paymentTotal');
  const transferEl = document.getElementById('transferAmount');
  const ewalletEl = document.getElementById('ewalletTransferAmount');
  if (totalEl) totalEl.textContent = 'Rp ' + total.toLocaleString('id-ID');
  if (transferEl) transferEl.textContent = 'Rp ' + total.toLocaleString('id-ID');
  if (ewalletEl) ewalletEl.textContent = 'Rp ' + total.toLocaleString('id-ID');
};

window.openPaymentModal = function () {
  if (cartItems.length === 0) { alert('Keranjang Anda masih kosong!'); return; }
  if (!requireBuyerLogin()) return;
  if (typeof window.resetOngkirSelection === 'function') window.resetOngkirSelection();
  resetPaymentReveal();
  window.refreshPaymentTotals();
  document.getElementById('checkoutStep1').style.display = 'block';
  document.getElementById('checkoutStep2').style.display = 'none';
  document.getElementById('paymentActionContainer').style.display = 'none';
  document.getElementById('checkoutTitle').innerHTML = '📍 Alamat Pengiriman';
  document.getElementById('paymentModal').classList.add('active');
};

window.goToPaymentStep = function () {
  const name = document.getElementById('shipName').value.trim();
  const phone = document.getElementById('shipPhone').value.trim();
  const region = document.getElementById('shipRegion').value.trim();
  const address = document.getElementById('shipAddress').value.trim();
  if (!name || !phone || !region || !address) { alert('Mohon lengkapi semua kolom bertanda * (wajib diisi)'); return; }
  if (phone.length < 10) { alert('Nomor HP tidak valid!'); return; }
  resetPaymentReveal();
  window.refreshPaymentTotals();
  document.getElementById('checkoutStep1').style.display = 'none';
  document.getElementById('checkoutStep2').style.display = 'block';
  document.getElementById('paymentActionContainer').style.display = 'block';
  document.getElementById('checkoutTitle').innerHTML = '💳 Pembayaran';
};

window.goToAddressStep = function () {
  document.getElementById('checkoutStep2').style.display = 'none';
  document.getElementById('paymentActionContainer').style.display = 'none';
  document.getElementById('checkoutStep1').style.display = 'block';
  document.getElementById('checkoutTitle').innerHTML = '📍 Alamat Pengiriman';
};

// Reset field2 form pembayaran (nama pengirim/pembayar + file bukti) supaya
// tidak "nyangkut" dari transaksi sebelumnya dan lolos validasi tanpa upload ulang.
function resetPaymentForm() {
  const senderName = document.getElementById('senderName');
  const transferProof = document.getElementById('transferProof');
  const qrisName = document.getElementById('qrisName');
  const qrisProof = document.getElementById('qrisProof');
  if (senderName) senderName.value = '';
  if (transferProof) transferProof.value = '';
  if (qrisName) qrisName.value = '';
  if (qrisProof) qrisProof.value = '';
}

window.closePaymentModal = function () {
  document.getElementById('paymentModal').classList.remove('active');
  window.isBuyNowMode = false;
  window.tempBuyNowCart = [];
  resetPaymentForm();
};

window.switchPaymentTab = function (tab, clickedEl) {
  document.querySelectorAll('.payment-tab').forEach(t => t.classList.remove('active'));
  if (clickedEl) clickedEl.classList.add('active');
  document.querySelectorAll('.payment-content').forEach(c => c.classList.remove('active'));
  selectedPaymentMethod = tab;
  if (tab === 'bank') { document.getElementById('bankPayment').classList.add('active'); selectedPaymentProvider = 'bri'; }
  else if (tab === 'ewallet') { document.getElementById('ewalletPayment').classList.add('active'); selectedPaymentProvider = 'gopay'; }
  else if (tab === 'qris') { document.getElementById('qrisPayment').classList.add('active'); selectedPaymentProvider = 'qris'; }
  // Ganti metode/tab -> detail (rekening/QRIS) yg mungkin sudah terbuka harus
  // disembunyikan lagi sampai pembeli menekan "Konfirmasi Pembayaran" ulang.
  resetPaymentReveal();
};

window.selectPaymentOption = function (element, provider) {
  element.parentElement.querySelectorAll('.payment-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected'); selectedPaymentProvider = provider;
  resetPaymentReveal();
};

function updateBankInfo(bank, settings) {
  const b = (settings && settings.banks && settings.banks[bank]) || DEFAULT_PAYMENT_SETTINGS.banks[bank];
  if (b) {
    document.getElementById('selectedBankName').textContent = b.bankName || '-';
    document.getElementById('bankAccountNumber').textContent = b.accountNumber || '-';
    const nameEl = document.getElementById('selectedBankAccountName');
    if (nameEl) nameEl.textContent = b.accountName || 'SADEWA ELEKTRONIK';
  }
}

// Sembunyikan lagi kotak detail (rekening/QRIS) & kembalikan placeholder +
// label tombol ke kondisi awal. Dipanggil setiap kali metode/opsi pembayaran
// diganti, supaya detail lama tidak nyangkut kebawa ke metode yang baru dipilih.
function resetPaymentReveal() {
  paymentDetailsRevealed = false;
  const bankPh = document.getElementById('bankDetailPlaceholder');
  const bankBox = document.getElementById('bankDetailBox');
  const qrisPh = document.getElementById('qrisDetailPlaceholder');
  const qrisBox = document.getElementById('qrisDetailBox');
  if (bankPh) bankPh.style.display = 'block';
  if (bankBox) bankBox.style.display = 'none';
  if (qrisPh) qrisPh.style.display = 'block';
  if (qrisBox) qrisBox.style.display = 'none';
  const btn = document.getElementById('paymentSubmitBtn');
  if (btn) btn.textContent = 'Konfirmasi Pembayaran';
}

// Dipanggil dari processPayment() saat tombol "Konfirmasi Pembayaran" diklik
// PERTAMA KALI: ambil data rekening/QRIS dari Firestore lalu tampilkan.
// Klik KEDUA baru benar-benar mengirim pesanan (lihat processPayment()).
async function revealPaymentDetails() {
  const settings = await getPaymentSettings();
  if (selectedPaymentMethod === 'bank') {
    updateBankInfo(selectedPaymentProvider, settings);
    document.getElementById('bankDetailPlaceholder').style.display = 'none';
    document.getElementById('bankDetailBox').style.display = 'block';
  } else if (selectedPaymentMethod === 'qris') {
    const q = settings.qris || DEFAULT_PAYMENT_SETTINGS.qris;
    const img = document.getElementById('qrisImage');
    if (img && q.imageUrl) img.src = q.imageUrl;
    document.getElementById('qrisDetailPlaceholder').style.display = 'none';
    document.getElementById('qrisDetailBox').style.display = 'block';
  }
  paymentDetailsRevealed = true;
  const btn = document.getElementById('paymentSubmitBtn');
  if (btn) btn.textContent = '\u2705 Saya Sudah Bayar, Kirim Konfirmasi';
}

window.copyToClipboard = function (elementId) {
  const t = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(t).then(() => alert('Disalin: ' + t));
};
window.copyTransferAmount = function () {
  const a = calculateTotal();
  navigator.clipboard.writeText(a.toString()).then(() => alert('Jumlah disalin: Rp ' + a.toLocaleString('id-ID')));
};
window.copyEwalletAmount = window.copyTransferAmount;

window.downloadQRIS = function () {
  const qrisImgSrc = document.getElementById('qrisImage').src;
  const a = document.createElement('a');
  a.href = qrisImgSrc; a.download = 'QRIS_Sadewa_Elektronik.png';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

window.processPayment = async function () {
  const btn = document.getElementById('paymentSubmitBtn');
  // Klik PERTAMA: baru tampilkan nomor rekening / kode QRIS, jangan kirim
  // pesanan dulu. Klik KEDUA (label tombol sudah berubah) baru lanjut kirim.
  if (!paymentDetailsRevealed) {
    btn.disabled = true; btn.textContent = 'Memuat...';
    await revealPaymentDetails();
    btn.disabled = false;
    return;
  }
  btn.disabled = true; btn.textContent = 'Memproses...';
  let isValid = true, message = '';
  if (selectedPaymentMethod === 'bank') {
    const senderName = document.getElementById('senderName').value.trim();
    const proofFile = document.getElementById('transferProof').files[0];
    if (!senderName) { isValid = false; message = 'Mohon masukkan nama pengirim!'; }
    else if (!proofFile) { isValid = false; message = 'Mohon upload bukti transfer terlebih dahulu!'; }
  } else if (selectedPaymentMethod === 'ewallet') {
    const ph = document.getElementById('ewalletPhone').value;
    const nm = document.getElementById('ewalletName').value;
    if (!ph || !nm) { isValid = false; message = 'Mohon lengkapi data e-wallet!'; }
    else if (ph.length < 10) { isValid = false; message = 'Nomor HP tidak valid!'; }
  } else if (selectedPaymentMethod === 'qris') {
    const qrisName = document.getElementById('qrisName').value.trim();
    const proofFile = document.getElementById('qrisProof').files[0];
    if (!qrisName) { isValid = false; message = 'Mohon masukkan nama pembayar!'; }
    else if (!proofFile) { isValid = false; message = 'Mohon upload bukti pembayaran terlebih dahulu!'; }
  }
  setTimeout(() => {
    if (!isValid) { alert(message); btn.disabled = false; btn.textContent = '\u2705 Saya Sudah Bayar, Kirim Konfirmasi'; return; }
    window._pendingOrder = {
      items: window.isBuyNowMode ? (window.tempBuyNowCart || []) : [...cartItems],
      method: selectedPaymentMethod,
      isBuyNow: window.isBuyNowMode
    };
    window._pendingOrder.total = window._pendingOrder.items.reduce((s, i) => s + (i.price * i.quantity), 0) + getShippingCost();
    window._pendingOrder.shipping = window._sadewaShippingCost || null;
    btn.disabled = false; btn.textContent = '\u2705 Saya Sudah Bayar, Kirim Konfirmasi';
    window.showChannelChoice();
  }, 500);
};

window.showChannelChoice = function () {
  document.getElementById('channelChoiceOverlay').classList.add('active');
};
window.closeChannelChoice = function () {
  document.getElementById('channelChoiceOverlay').classList.remove('active');
};

window.sendViaWhatsApp = async function () {
  window.closeChannelChoice();
  const order = window._pendingOrder;
  const saved = await _saveOrderToFirestore(order.items, order.total, order.method, 'whatsapp');
  sendPaymentToWhatsApp(saved.invoiceNumber);
  if (!order.isBuyNow) { cartItems = []; saveCartToStorage(); updateCartBadge(); }
  window.closePaymentModal();
  window.isBuyNowMode = false; window.tempBuyNowCart = [];
  window._pendingOrder = null;
  window.openInvoiceModal(saved);
};

window.sendViaChat = async function () {
  window.closeChannelChoice();
  const order = window._pendingOrder;
  const saved = await _saveOrderToFirestore(order.items, order.total, order.method, 'chat');
  if (!order.isBuyNow) { cartItems = []; saveCartToStorage(); updateCartBadge(); }
  window.closePaymentModal();
  const chatBtn = document.getElementById('chatBubbleBtn');
  if (chatBtn) chatBtn.style.display = 'flex';
  await window.afterPaymentSuccessChat(order.items, order.total, order.method);
  if (!_buyerChatOpen) window.toggleBuyerChat();
  window.isBuyNowMode = false; window.tempBuyNowCart = [];
  window._pendingOrder = null;
  window.openInvoiceModal(saved);
};

function sendPaymentToWhatsApp(invoiceNumber) {
  const shipName = document.getElementById('shipName').value.trim();
  const shipPhone = document.getElementById('shipPhone').value.trim();
  const shipRegion = document.getElementById('shipRegion').value.trim();
  const shipAddress = document.getElementById('shipAddress').value.trim();
  const shipDetail = document.getElementById('shipDetail').value.trim();
  const shipNote = document.getElementById('shipNote').value.trim();
  let message = '💳 *PESANAN BARU (SADEWA ELEKTRONIK)*\n';
  if (invoiceNumber) message += `No. Invoice: ${invoiceNumber}\n`;
  message += '━━━━━━━━━━━━━━━━━━━━\n\n*📍 Alamat Pengiriman:*\n';
  message += `Nama: ${shipName}\nNo. HP: ${shipPhone}\nProv/Kota/Kec: ${shipRegion}\nAlamat Lengkap:\n${shipAddress}\n`;
  if (shipDetail) message += `Patokan: ${shipDetail}\n`;
  if (shipNote) message += `Catatan Kurir: ${shipNote}\n`;
  message += '\n━━━━━━━━━━━━━━━━━━━━\n*📦 Detail Pesanan:*\n';
  const items = window.isBuyNowMode ? (window.tempBuyNowCart || []) : cartItems;
  items.forEach((item, i) => {
    message += `${i + 1}. ${item.name}`;
    if (item.variant) message += ` (${item.variant})`;
    message += `\n   ${item.quantity} pcs × Rp ${item.price.toLocaleString('id-ID')}\n   Subtotal: Rp ${(item.price * item.quantity).toLocaleString('id-ID')}\n\n`;
  });
  const subtotal = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
  const shipping = window._sadewaShippingCost;
  if (shipping && shipping.cost > 0) {
    message += `\n*🚚 Pengiriman:*\n${shipping.courier} - ${shipping.service}\nTujuan: ${shipping.destinationLabel}\nOngkir: Rp ${shipping.cost.toLocaleString('id-ID')}\n`;
  }
  const total = subtotal + (shipping && shipping.cost > 0 ? shipping.cost : 0);
  message += `━━━━━━━━━━━━━━━━━━━━\n*Total: Rp ${total.toLocaleString('id-ID')}*\n\n*Metode Pembayaran:*\n`;
  if (selectedPaymentMethod === 'bank') message += `🏦 Transfer ${((_sadewaPaymentSettings && _sadewaPaymentSettings.banks[selectedPaymentProvider]) || DEFAULT_PAYMENT_SETTINGS.banks[selectedPaymentProvider])?.bankName || ''}\nNama: ${document.getElementById('senderName').value}\n`;
  else if (selectedPaymentMethod === 'ewallet') message += `📱 ${selectedPaymentProvider.toUpperCase()}\nNomor: ${document.getElementById('ewalletPhone').value}\nNama: ${document.getElementById('ewalletName').value}\n`;
  else if (selectedPaymentMethod === 'qris') message += `📲 QRIS\nNama: ${document.getElementById('qrisName').value || '-'}\n`;
  message += '\n━━━━━━━━━━━━━━━━━━━━\n🙏 Terima kasih berbelanja di Sadewa Elektronik!';
  window.open(`https://wa.me/6285872189172?text=${encodeURIComponent(message)}`, '_blank');
}

window.checkoutWithPayment = function () {
  if (cartItems.length === 0) { alert('Keranjang Anda masih kosong!'); return; }
  window.isBuyNowMode = false; window.tempBuyNowCart = [];
  window.toggleCart();
  window.openPaymentModal();
};

window.toggleHelpModal = function () {
  document.getElementById('helpModal').classList.toggle('active');
};
document.addEventListener('click', function (e) {
  const m = document.getElementById('helpModal');
  if (m && e.target === m) m.classList.remove('active');
});

// ============================================================
// PRODUK & SEARCH
// ============================================================
let currentPage = 1;
const itemsPerPage = 12;

function init() {
  window._sadewaDb = db;
  window._sadewaFirestore = {
    collection, query, orderBy, onSnapshot, where, getDocs,
    updateDoc, doc, addDoc, setDoc, serverTimestamp, increment, writeBatch
  };
  // Dibutuhkan Script.js (Chat Page System) untuk dapat ID sesi pembeli.
  // Sengaja tidak pakai Firebase Auth UID — _getBuyerSession() sudah
  // membuat & menyimpan ID unik sendiri di localStorage, jadi tinggal
  // dibungkus jadi Promise biar cocok dengan `await ...WaitForUID()`.
  window._sadewaWaitForUID = async function () { return _getBuyerSession(); };

  // initChat() dijalankan PALING AWAL & dibungkus try/catch di dalamnya (lihat definisi
  // initChat) supaya tombol fitur pesan (chat bubble) tetap pasti muncul & bisa dibuka,
  // walaupun ada gangguan koneksi/izin Firestore saat memuat riwayat chat.
  initChat();
  initSearchBar();
  loadCartFromStorage();

  try {
    onSnapshot(query(prodCol, orderBy("createdAt", "desc")), (snapshot) => {
      products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      window._sadewaProducts = products;
      applyFilters();
      if (adminAuthenticated) { renderAdminProductList(); updateAdminStats(); }
    });
  } catch (e) { console.error('init: gagal memuat produk', e); }
}

window.filterCategory = function (category, btn) {
  activeCategory = category;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelectorAll('.cat-btn').forEach(b => {
    if (b.textContent.toLowerCase().includes(category.toLowerCase())) b.classList.add('active');
  });
  currentPage = 1;
  applyFilters();
};

// Filter gabungan beberapa kategori sekaligus (dipakai oleh shortcut kategori di hero:
// "Peralatan Rumah Tangga", "Peralatan Listrik", "Peralatan Pertukangan"). Tidak mengganggu
// filterCategory() yang dipakai tombol kategori tunggal di category bar.
window.filterCategoryGroup = function (categories) {
  activeCategory = categories; // array = mode filter grup
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  currentPage = 1;
  applyFilters();
};

window.applyFilters = function () {
  const q = lastSearchQuery.trim().toLowerCase();
  filteredProducts = products.filter(p => {
    const passCat = activeCategory === 'all' ? true
      : Array.isArray(activeCategory) ? activeCategory.includes(p.category)
      : p.category === activeCategory;
    const passSearch = q ? [p.name, p.description].some(s => s && s.toLowerCase().includes(q)) : true;
    return passCat && passSearch;
  });
  renderProducts();
  const sm = document.getElementById('searchMeta');
  if (sm) sm.textContent = `Menampilkan ${filteredProducts.length} dari ${products.length}`;
};

function initSearchBar() {
  const si = document.getElementById('productSearch');
  const cb = document.getElementById('clearSearchBtn');
  if (cb) cb.classList.toggle('visible', !!(si && si.value));
  if (si) si.oninput = (e) => {
    lastSearchQuery = e.target.value;
    if (cb) cb.classList.toggle('visible', !!e.target.value);
    window.applyFilters();
  };
  if (cb) cb.onclick = () => { si.value = ''; lastSearchQuery = ''; cb.classList.remove('visible'); window.applyFilters(); };
}

window.renderProducts = function () {
  const grid = document.getElementById('productGrid');
  const list = filteredProducts || products;
  if (!list.length) {
    grid.innerHTML = `<p style="text-align:center;grid-column:1/-1;color:var(--gray);">Produk tidak ditemukan.</p>`;
    document.getElementById('paginationContainer').innerHTML = ''; return;
  }
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedList = list.slice(startIndex, startIndex + itemsPerPage);
  grid.innerHTML = paginatedList.map(p => {
    const mediaContent = p.media && p.media.startsWith('data:image')
      ? `<img src="${p.media}" style="width:100%;height:100%;object-fit:cover;">`
      : `<div style="font-size:5rem;display:flex;align-items:center;justify-content:center;height:100%;">${p.media || '⚡'}</div>`;
    const priceToShow = p.displayPrice || `Rp ${p.price.toLocaleString('id-ID')}`;
    const descFull = p.description || '';
    const descIsLong = descFull.length > 60;
    const descPreview = descIsLong
      ? descFull.substring(0, 60) + '... '
      : descFull;
    const readMoreLink = descIsLong
      ? `<span class="desc-readmore" onclick="event.stopPropagation(); openProductDetail('${p.id}')">Lihat selengkapnya</span>`
      : '';
    return `<div class="product-card" onclick="openProductDetail('${p.id}')" style="cursor:pointer;">
      <div class="product-image" id="productImg-${p.id}" style="height:200px;overflow:hidden;position:relative;">
        ${mediaContent}
        ${p.video && p.video.startsWith('data:video') ? '<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.7);color:white;padding:4px 8px;border-radius:4px;font-size:0.8rem;z-index:5;">🎬 Video</div>' : ''}
      </div>
      <div class="product-info">
        <h3 class="product-title">${p.name}</h3>
        <p class="product-desc">${descPreview}${readMoreLink}</p>
        <div class="product-price-wrapper">
          <div class="product-price" id="productPrice-${p.id}" style="margin-bottom:0">${priceToShow}</div>
          <button class="btn-add-cart" onclick="event.stopPropagation(); addToCart('${p.id}')" title="Tambah ke Keranjang">🛒</button>
        </div>
        <button class="btn" onclick="event.stopPropagation(); buyDirectly('${p.id}')">Beli Sekarang</button>
      </div>
    </div>`;
  }).join('');
  renderPagination(list.length);
};

function renderPagination(totalItems) {
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const container = document.getElementById('paginationContainer');
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  let html = `<div class="pagination-info">Menampilkan <span>${startItem}–${endItem}</span> dari <span>${totalItems}</span> &nbsp;·&nbsp; Hal <span>${currentPage}</span>/<span>${totalPages}</span></div>`;
  html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">&#8249;</button>`;
  const pages = [];
  if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
  else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    const rs = Math.max(2, currentPage - 1), re = Math.min(totalPages - 1, currentPage + 1);
    for (let i = rs; i <= re; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }
  pages.forEach(p => {
    if (p === '...') html += `<span class="page-ellipsis">&middot;&middot;&middot;</span>`;
    else html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p})">${p}</button>`;
  });
  html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">&#8250;</button>`;
  container.innerHTML = html;
}

window.goToPage = function (page) {
  const list = filteredProducts || products;
  const totalPages = Math.ceil(list.length / itemsPerPage);
  if (page >= 1 && page <= totalPages) {
    currentPage = page;
    window.renderProducts();
    document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
  }
};

window.updateProductImage = function () {};

// ============================================================
// PRODUCT DETAIL MODAL (Shopee-style)
// Menampilkan deskripsi produk LENGKAP (tidak dipotong ke 60 karakter
// seperti di kartu produk), lengkap dengan galeri media & pilihan varian.
// ============================================================
window.currentDetailProductId = null;

function _detailVariantOptions(product) {
  const opts = [];
  if (product.video && product.video.startsWith('data:video')) opts.push('🎬 Video Produk');
  if (product.variantPrices && Object.keys(product.variantPrices).length > 0) opts.push(...Object.keys(product.variantPrices));
  else opts.push(...getVariantOptions(product.category));
  return opts;
}

window.openProductDetail = function (productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  window.currentDetailProductId = productId;

  document.getElementById('detailCategory').textContent = p.category || '';
  document.getElementById('detailTitle').textContent = p.name || '';
  document.getElementById('detailPrice').textContent = p.displayPrice || `Rp ${p.price.toLocaleString('id-ID')}`;
  document.getElementById('detailStock').textContent = (typeof p.stock === 'number') ? `Stok tersedia: ${p.stock}` : '';

  // Deskripsi LENGKAP — pakai textContent (bukan substring) supaya tidak terpotong sama sekali.
  document.getElementById('detailDesc').textContent = p.description || 'Belum ada deskripsi untuk produk ini.';

  // -- Galeri media (gambar utama, video, gambar varian) --
  const mainView = document.getElementById('detailMainView');
  const thumbStrip = document.getElementById('detailThumbStrip');
  const thumbs = [];
  if (p.media && p.media.startsWith('data:image')) thumbs.push({ type: 'image', src: p.media, label: 'Utama' });
  if (p.video && p.video.startsWith('data:video')) thumbs.push({ type: 'video', src: p.video, label: 'Video' });
  if (p.variantImages) {
    Object.entries(p.variantImages).forEach(([vname, vimg]) => {
      if (vimg && vimg.startsWith('data:image')) thumbs.push({ type: 'image', src: vimg, label: vname });
    });
  }

  function showMedia(item) {
    if (!item) {
      mainView.innerHTML = `<div style="font-size:6rem;display:flex;align-items:center;justify-content:center;height:100%;">${p.media || '⚡'}</div>`;
      return;
    }
    mainView.innerHTML = item.type === 'video'
      ? `<video src="${item.src}" controls playsinline></video>`
      : `<img src="${item.src}" alt="${p.name}">`;
  }
  showMedia(thumbs[0]);

  thumbStrip.style.display = thumbs.length > 1 ? 'flex' : 'none';
  thumbStrip.innerHTML = thumbs.map((t, idx) => `
    <div class="thumb-item ${idx === 0 ? 'active' : ''}" data-idx="${idx}">
      ${t.type === 'video' ? `<video src="${t.src}"></video><div class="thumb-play-icon">▶</div>` : `<img src="${t.src}" alt="${t.label}">`}
    </div>`).join('');
  thumbStrip.querySelectorAll('.thumb-item').forEach(el => {
    el.addEventListener('click', () => {
      thumbStrip.querySelectorAll('.thumb-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      showMedia(thumbs[Number(el.dataset.idx)]);
    });
  });

  // -- Pilihan varian (kalau ada) --
  const variantOptions = _detailVariantOptions(p);
  const variantsBox = document.getElementById('detailVariants');
  variantsBox.innerHTML = variantOptions.length
    ? `<div class="detail-variant-label">Pilih Varian</div>
       <select class="detail-variant-select" id="variant-${p.id}">
         ${variantOptions.map(v => `<option value="${v}">${v}</option>`).join('')}
       </select>`
    : '';

  document.getElementById('productDetailModal').classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeProductDetail = function () {
  document.getElementById('productDetailModal').classList.remove('active');
  document.body.style.overflow = '';
  window.currentDetailProductId = null;
};

function _resolveVariant(product, variantFromModal) {
  let variantOptions = [];
  if (product.video && product.video.startsWith('data:video')) variantOptions.push('🎬 Video Produk');
  if (product.variantPrices && Object.keys(product.variantPrices).length > 0)
    variantOptions.push(...Object.keys(product.variantPrices));
  else {
    const autoOpts = getVariantOptions(product.category);
    if (autoOpts.length > 0) variantOptions.push(...autoOpts);
  }
  let selectedVariant = variantFromModal || '';
  if (!selectedVariant && variantOptions.length > 0) {
    // Jika ada elemen pilihan varian (mis. di modal detail produk) dan sudah dipilih user, hormati pilihan itu.
    // Jika tidak ada / belum dipilih, varian PERTAMA otomatis jadi default agar Beli Sekarang / Tambah Keranjang
    // tetap berfungsi dengan 1 klik tanpa mewajibkan user memilih varian dulu.
    const selectEl = document.getElementById('variant-' + product.id);
    selectedVariant = (selectEl && selectEl.value) ? selectEl.value : variantOptions[0];
  }
  let finalPrice = product.price;
  if (selectedVariant && product.variantPrices && product.variantPrices[selectedVariant])
    finalPrice = product.variantPrices[selectedVariant];
  let itemMedia = product.media;
  if (selectedVariant && product.variantImages && product.variantImages[selectedVariant])
    itemMedia = product.variantImages[selectedVariant];
  else if (selectedVariant === '🎬 Video Produk' && product.video)
    itemMedia = product.video;
  return { selectedVariant, finalPrice, itemMedia };
}

function playAddToCartSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Master gain supaya volume keseluruhan bel tetap terkontrol & tidak pecah
    const master = ctx.createGain();
    master.gain.setValueAtTime(1, now);
    master.connect(ctx.destination);

    // Frekuensi dasar bel + beberapa overtone tidak-harmonis (inharmonic)
    // supaya terdengar seperti bel/lonceng sungguhan, bukan bunyi "bip" elektronik.
    const bellPartials = [
      { freq: 830,  gain: 0.30, decay: 1.1 },  // nada dasar bel
      { freq: 1660, gain: 0.16, decay: 0.9 },  // oktaf
      { freq: 2270, gain: 0.11, decay: 0.7 },  // overtone khas lonceng
      { freq: 3110, gain: 0.07, decay: 0.55 }, // shimmer atas
      { freq: 4150, gain: 0.045, decay: 0.4 }  // kilau tinggi, cepat hilang
    ];

    bellPartials.forEach(p => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, now);
      // Serangan (attack) sangat cepat khas dentingan bel dipukul
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(p.gain, now + 0.008);
      // Peluruhan (decay) natural menyerupai dengungan bel
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + p.decay + 0.05);
    });
  } catch (e) { /* abaikan kalau browser tidak mendukung audio */ }
}

window.addToCart = function (productId, variantFromModal) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  const resolved = _resolveVariant(product, variantFromModal);
  if (resolved === null) return;
  const { selectedVariant, finalPrice, itemMedia } = resolved;
  const existingIndex = cartItems.findIndex(item => item.id === productId && item.variant === selectedVariant);
  if (existingIndex > -1) { cartItems[existingIndex].quantity += 1; cartItems[existingIndex].price = finalPrice; }
  else cartItems.push({ id: productId, name: product.name, price: finalPrice, variant: selectedVariant, quantity: 1, media: itemMedia });
  saveCartToStorage(); updateCartBadge(); renderCart();
  playAddToCartSound();
  window.showBuyerToast(`✅ ${product.name}${selectedVariant ? ' (' + selectedVariant + ')' : ''} ditambahkan ke keranjang`);
};

window.buyDirectly = function (productId, variantFromModal) {
  if (!requireBuyerLogin()) return;
  const product = products.find(p => p.id === productId);
  if (!product) return;
  const resolved = _resolveVariant(product, variantFromModal);
  if (resolved === null) return;
  const { selectedVariant, finalPrice, itemMedia } = resolved;
  const tempCartItem = { id: productId, name: product.name, price: finalPrice, variant: selectedVariant, quantity: 1, media: itemMedia };
  window.tempBuyNowCart = [tempCartItem];
  window.isBuyNowMode = true;
  document.getElementById('paymentOrderItems').innerHTML = `<div class="order-item"><span>${tempCartItem.name} ${tempCartItem.variant ? '(' + tempCartItem.variant + ')' : ''} x1</span><span>Rp ${tempCartItem.price.toLocaleString('id-ID')}</span></div>`;
  document.getElementById('paymentTotal').textContent = 'Rp ' + tempCartItem.price.toLocaleString('id-ID');
  document.getElementById('transferAmount').textContent = 'Rp ' + tempCartItem.price.toLocaleString('id-ID');
  const ewalletTransferEl = document.getElementById('ewalletTransferAmount');
  if (ewalletTransferEl) ewalletTransferEl.textContent = 'Rp ' + tempCartItem.price.toLocaleString('id-ID');
  document.getElementById('paymentModal').classList.add('active');
};

// ============================================================
// ADMIN LOGIN / LOGOUT
// ============================================================
window.showLoginModal = function () {
  document.getElementById('loginModal').classList.add('active');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  setTimeout(() => document.getElementById('loginUsername').focus(), 300);
};
window.closeLoginModal = function () {
  document.getElementById('loginModal').classList.remove('active');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
};

window.handleLogin = async function () {
  const user = document.getElementById('loginUsername').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const loginBtn = document.querySelector('.btn-login');
  if (!user || !pass) { alert('⚠️ Silakan isi username dan password!'); return; }
  if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = '⏳ Memverifikasi...'; }
  try {
    // [PATCH KEAMANAN] Satu-satunya jalur login sekarang Firebase Authentication.
    // Tidak ada lagi fallback password lokal yang bisa dibaca dari source code.
    const email = user.toLowerCase() + '@sadewa-admin.local';
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    if (userCredential?.user) {
      currentUser = userCredential.user;
      adminAuthenticated = true;
      document.getElementById('loginUsername').value = '';
      document.getElementById('loginPassword').value = '';
      window.closeLoginModal();
      document.getElementById('mainWebsite').classList.remove('active');
      document.getElementById('adminPage').classList.add('active');
      renderAdminProductList();
      updateAdminStats();
      window.loadAdminOrders();
      showAdminNotif('✅ Login berhasil');
    }
  } catch (error) {
    console.error('handleLogin:', error);
    showAdminNotif('❌ Username atau password salah!', true);
  } finally {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Masuk'; }
  }
};

window.adminLogout = async function () {
  try {
    if (currentUser) await signOut(auth);
    currentUser = null; adminAuthenticated = false;
    document.getElementById('adminPage').classList.remove('active');
    document.getElementById('mainWebsite').classList.add('active');
    window.resetAdminForm();
    showAdminNotif('👋 Logout berhasil');
  } catch (error) {
    adminAuthenticated = false;
    document.getElementById('adminPage').classList.remove('active');
    document.getElementById('mainWebsite').classList.add('active');
  }
};

window.goToWebsite = function () {
  document.getElementById('adminPage').classList.remove('active');
  document.getElementById('mainWebsite').classList.add('active');
};

document.addEventListener('DOMContentLoaded', () => {
  const lp = document.getElementById('loginPassword');
  if (lp) lp.addEventListener('keydown', e => { if (e.key === 'Enter') window.handleLogin(); });
  const lu = document.getElementById('loginUsername');
  if (lu) lu.addEventListener('keydown', e => { if (e.key === 'Enter') window.handleLogin(); });
});

// ============================================================
// ADMIN: STATS & PRODUCT LIST
// ============================================================
function updateAdminStats() {
  document.getElementById('statTotalProd').textContent = products.length;
  document.getElementById('statLampu').textContent = products.filter(p => p.category === 'Lampu').length;
  document.getElementById('statKipas').textContent = products.filter(p => p.category === 'Kipas Angin').length;
  document.getElementById('statKabel').textContent = products.filter(p => p.category === 'Kabel').length;
  document.getElementById('statLainnya').textContent = products.filter(p => !['Lampu', 'Kipas Angin', 'Kabel'].includes(p.category)).length;
}

window.renderAdminProductList = function () {
  const searchQ = (document.getElementById('adminSearch')?.value || '').toLowerCase().trim();
  const catFilter = document.getElementById('adminFilterCat')?.value || 'all';
  const list = products.filter(p => {
    const matchCat = catFilter === 'all' || p.category === catFilter;
    const matchSearch = !searchQ || p.name.toLowerCase().includes(searchQ);
    return matchCat && matchSearch;
  });
  document.getElementById('productCountLabel').textContent = list.length;
  const container = document.getElementById('adminProductList');
  if (!list.length) { container.innerHTML = '<div class="admin-empty-state"><div class="admin-empty-icon">📦</div><p>Tidak ada produk.</p></div>'; return; }
  container.innerHTML = list.map(p => {
    const thumb = p.media && p.media.startsWith('data:image')
      ? `<div class="admin-product-thumb"><img src="${p.media}" alt="${p.name}"></div>`
      : `<div class="admin-product-thumb" style="background:var(--surface2);">${p.media || '⚡'}</div>`;
    const varCount = p.variantPrices ? Object.keys(p.variantPrices).length : 0;
    return `<div class="admin-product-item">${thumb}
      <div class="admin-product-meta">
        <div class="admin-product-name">${p.name}</div>
        <div class="admin-product-sub">${p.category}${varCount > 0 ? ' · ' + varCount + ' varian' : ''} · Stok: ${p.stock || 0}</div>
      </div>
      <div class="admin-product-price">Rp ${p.price.toLocaleString('id-ID')}</div>
      <div class="admin-product-actions">
        <button class="admin-btn-edit" onclick="editProduct('${p.id}')">✏️ Edit</button>
        <button class="admin-btn-danger" onclick="deleteProduct('${p.id}','${p.name.replace(/'/g, "\\'")}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
};

// ============================================================
// ADMIN: VARIANT MANAGER
// ============================================================
window.toggleVariantManager = function () {
  const checked = document.getElementById('hasVariants').checked;
  document.getElementById('variantManagerSection').style.display = checked ? 'block' : 'none';
  if (checked && document.getElementById('variantList').children.length === 0) window.addVariantRow();
};

window.addVariantRow = function () {
  variantCounter++;
  const id = 'variant_' + variantCounter;
  const div = document.createElement('div');
  div.className = 'variant-block'; div.id = 'vblock_' + id;
  div.innerHTML = `
    <div class="variant-block-header">
      <span class="variant-block-name">Varian #${variantCounter}</span>
      <button type="button" class="admin-btn-danger" onclick="removeVariantRow('${id}')">✕ Hapus</button>
    </div>
    <div class="admin-form-row">
      <div>
        <div class="variant-row-label">Nama Varian</div>
        <input type="text" id="vname_${id}" placeholder="Contoh: 5 Watt" oninput="updateVariantLabel('${id}',this.value)">
      </div>
      <div>
        <div class="variant-row-label">Harga (Rp)</div>
        <input type="text" id="vprice_${id}" placeholder="15.000" inputmode="numeric" oninput="formatRupiahInput(this)">
      </div>
    </div>
    <div class="variant-img-label">📷 Gambar Varian (opsional)</div>
    <div class="variant-img-upload-row">
      <div class="variant-img-preview" id="vimgpreview_${id}">🖼️</div>
      <div style="flex:1;">
        <input type="file" id="vimg_${id}" accept="image/*" style="display:none;" onchange="previewVariantImage('${id}',this)">
        <button type="button" class="admin-btn-secondary" style="width:100%;font-size:0.78rem;" onclick="document.getElementById('vimg_${id}').click()">📁 Upload Gambar Varian</button>
        <button type="button" class="admin-btn-secondary" style="width:100%;font-size:0.75rem;margin-top:0.3rem;color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="clearVariantImage('${id}')">✕ Hapus Gambar</button>
      </div>
    </div>`;
  document.getElementById('variantList').appendChild(div);
};

window.updateVariantLabel = function (id, val) {
  const block = document.getElementById('vblock_' + id);
  if (block) block.querySelector('.variant-block-name').textContent = val || 'Varian';
};
window.removeVariantRow = function (id) {
  const block = document.getElementById('vblock_' + id);
  if (block) block.remove();
  delete variantImages[id];
};

function collectVariants() {
  const variantPrices = {}, variantImagesOut = {};
  document.querySelectorAll('#variantList .variant-block').forEach(block => {
    const id = block.id.replace('vblock_', '');
    const name = (document.getElementById('vname_' + id)?.value || '').trim();
    const price = parseFloat((document.getElementById('vprice_' + id)?.value || '0').replace(/\./g, '').replace(',', '.'));
    if (name && price > 0) {
      variantPrices[name] = price;
      if (variantImages[id]) variantImagesOut[name] = variantImages[id];
    }
  });
  return { variantPrices, variantImages: variantImagesOut };
}

// ============================================================
// ADMIN: IMAGE & VIDEO
// ============================================================
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1024, MAX_IMAGE_HEIGHT = 1024;

window.compressImage = function (base64String, callback, maxW = MAX_IMAGE_WIDTH, maxH = MAX_IMAGE_HEIGHT) {
  const img = new Image();
  img.onload = function () {
    const canvas = document.createElement('canvas');
    let w = img.width, h = img.height;
    if (w > h) { if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; } }
    else { if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; } }
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    let compressed = canvas.toDataURL('image/jpeg', 0.85);
    if (compressed.length > MAX_FILE_SIZE) compressed = canvas.toDataURL('image/jpeg', 0.7);
    callback(compressed);
  };
  img.onerror = () => callback(base64String);
  img.src = base64String;
};

window.previewMainImage = function (input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > MAX_FILE_SIZE) { showAdminNotif('❌ File terlalu besar!', true); input.value = ''; return; }
  if (!file.type.startsWith('image/')) { showAdminNotif('❌ File harus berupa gambar!', true); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const box = document.getElementById('mainImgPreviewBox');
    box.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;">⏳</div>';
    window.compressImage(e.target.result, compressed => {
      mainImageBase64 = compressed;
      document.getElementById('mainImgPreviewBox').innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:cover;">`;
      showAdminNotif(`✅ Gambar berhasil dimuat!`);
    });
  };
  reader.onerror = () => { showAdminNotif('❌ Gagal membaca file!', true); input.value = ''; };
  reader.readAsDataURL(file);
};

window.previewVariantImage = function (id, input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > MAX_FILE_SIZE || !file.type.startsWith('image/')) {
    showAdminNotif('❌ File tidak valid!', true); input.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    window.compressImage(e.target.result, compressed => {
      variantImages[id] = compressed;
      const prev = document.getElementById('vimgpreview_' + id);
      if (prev) prev.innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`;
      showAdminNotif('✅ Gambar varian dimuat!');
    });
  };
  reader.onerror = () => { showAdminNotif('❌ Gagal membaca file!', true); input.value = ''; };
  reader.readAsDataURL(file);
};

window.clearVariantImage = function (id) {
  delete variantImages[id];
  const prev = document.getElementById('vimgpreview_' + id);
  if (prev) prev.innerHTML = '🖼️';
  const input = document.getElementById('vimg_' + id);
  if (input) input.value = '';
};

window.previewMainVideo = function (input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > MAX_FILE_SIZE) { showAdminNotif(`❌ File terlalu besar!`, true); input.value = ''; return; }
  if (!file.type.startsWith('video/')) { showAdminNotif('❌ Harus berupa video!', true); input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    mainVideoBase64 = e.target.result;
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    document.getElementById('mainVideoPreviewBox').innerHTML = `
      <div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
        <video style="width:100%;height:100%;object-fit:contain;background:#000;" controls>
          <source src="${e.target.result}" type="${file.type}">
        </video>
        <div style="position:absolute;top:5px;right:5px;background:rgba(0,0,0,0.7);color:#fff;padding:3px 8px;border-radius:4px;font-size:0.75rem;">${sizeMB}MB</div>
      </div>`;
    document.getElementById('clearVideoBtn').style.display = 'block';
    showAdminNotif(`✅ Video berhasil dimuat! (${sizeMB}MB)`);
  };
  reader.onerror = () => { showAdminNotif('❌ Gagal membaca video!', true); input.value = ''; };
  reader.readAsDataURL(file);
};

window.clearMainVideo = function () {
  mainVideoBase64 = '';
  document.getElementById('mainVideoPreviewBox').innerHTML = '<div class="placeholder-text">🎬<br>Klik untuk upload video<br><span style="font-size:0.7rem;color:var(--gray);">Maks 500MB</span></div>';
  document.getElementById('adminMainVideo').value = '';
  document.getElementById('clearVideoBtn').style.display = 'none';
  showAdminNotif('🗑️ Video dihapus');
};

// ============================================================
// ADMIN: SAVE / EDIT / DELETE / RESET
// ============================================================
window.saveProduct = async function () {
  const name = document.getElementById('adminName').value.trim();
  const category = document.getElementById('adminCategory').value;
  const price = parseFloat(document.getElementById('adminPrice').value.replace(/\./g, '').replace(',', '.'));
  const stock = parseInt(document.getElementById('adminStock').value) || 0;
  const desc = document.getElementById('adminDesc').value.trim();
  const displayPrice = document.getElementById('adminDisplayPrice').value.trim();
  const emoji = document.getElementById('adminEmoji').value.trim();
  const editId = document.getElementById('editProductId').value;
  const saveBtn = document.querySelector('[onclick="saveProduct()"]');
  if (!name) { showAdminNotif('❌ Nama produk wajib diisi!', true); return; }
  if (!category) { showAdminNotif('❌ Kategori wajib dipilih!', true); return; }
  if (!price || price <= 0) { showAdminNotif('❌ Harga harus lebih dari 0!', true); return; }
  if (!adminAuthenticated) { showAdminNotif('❌ Login sebagai admin terlebih dahulu!', true); return; }
  const hasVar = document.getElementById('hasVariants').checked;
  let variantPrices = {}, variantImgsData = {};
  if (hasVar) {
    const collected = collectVariants();
    variantPrices = collected.variantPrices; variantImgsData = collected.variantImages;
    if (!Object.keys(variantPrices).length) { showAdminNotif('❌ Tambahkan minimal 1 varian!', true); return; }
  }
  const data = {
    name, category, price, stock, description: desc,
    displayPrice: displayPrice || '', media: mainImageBase64 || emoji || '⚡',
    video: mainVideoBase64 || '',
    variantPrices: hasVar ? variantPrices : {},
    variantImages: hasVar ? variantImgsData : {},
    updatedAt: serverTimestamp(), lastModifiedBy: currentUser?.uid || 'system'
  };
  try {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Menyimpan...'; }
    if (editId) { await updateDoc(doc(db, 'sadewaProducts', editId), data); showAdminNotif('✅ Produk diperbarui!'); }
    else { data.createdAt = serverTimestamp(); data.createdBy = currentUser?.uid || 'system'; await addDoc(prodCol, data); showAdminNotif('✅ Produk ditambahkan!'); }
    window.resetAdminForm();
  } catch (e) {
    let msg = '❌ Gagal menyimpan produk!\n';
    if (e.code === 'permission-denied') msg += '🔒 Cek Firestore Rules di Firebase Console.';
    else if (e.code === 'unavailable') msg += '📡 Periksa koneksi internet Anda.';
    else msg += e.message || 'Error tidak diketahui';
    showAdminNotif(msg, true);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Simpan Produk'; }
  }
};

window.editProduct = function (productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  window.resetAdminForm(true);
  document.getElementById('editProductId').value = p.id;
  document.getElementById('adminName').value = p.name || '';
  document.getElementById('adminCategory').value = p.category || '';
  document.getElementById('adminPrice').value = p.price ? p.price.toLocaleString('id-ID') : '';
  document.getElementById('adminStock').value = p.stock || 0;
  document.getElementById('adminDesc').value = p.description || '';
  document.getElementById('adminDisplayPrice').value = p.displayPrice || '';
  if (p.media?.startsWith('data:image')) {
    mainImageBase64 = p.media;
    document.getElementById('mainImgPreviewBox').innerHTML = `<img src="${p.media}" style="width:100%;height:100%;object-fit:cover;">`;
    document.getElementById('adminEmoji').value = '';
  } else {
    mainImageBase64 = '';
    document.getElementById('adminEmoji').value = p.media || '';
    document.getElementById('mainImgPreviewBox').innerHTML = `<div class="placeholder-text">🖼️<br>Klik untuk upload gambar</div>`;
  }
  if (p.video?.startsWith('data:video')) {
    mainVideoBase64 = p.video;
    const videoSize = (p.video.length / (1024 * 1024)).toFixed(2);
    document.getElementById('mainVideoPreviewBox').innerHTML = `<video controls style="width:100%;height:100%;border-radius:6px;"><source src="${p.video}" type="video/mp4"></video><div style="margin-top:0.3rem;font-size:0.8rem;color:var(--gray);">📹 ${videoSize}MB</div>`;
    document.getElementById('clearVideoBtn').style.display = 'block';
  }
  if (p.variantPrices && Object.keys(p.variantPrices).length > 0) {
    document.getElementById('hasVariants').checked = true;
    window.toggleVariantManager();
    document.getElementById('variantList').innerHTML = '';
    Object.entries(p.variantPrices).forEach(([vname, vprice]) => {
      variantCounter++;
      const id = 'variant_' + variantCounter;
      const existingImg = p.variantImages?.[vname] || '';
      const div = document.createElement('div');
      div.className = 'variant-block'; div.id = 'vblock_' + id;
      if (existingImg) variantImages[id] = existingImg;
      div.innerHTML = `
        <div class="variant-block-header">
          <span class="variant-block-name">${vname}</span>
          <button type="button" class="admin-btn-danger" onclick="removeVariantRow('${id}')">✕ Hapus</button>
        </div>
        <div class="admin-form-row">
          <div><div class="variant-row-label">Nama Varian</div><input type="text" id="vname_${id}" value="${vname}" oninput="updateVariantLabel('${id}',this.value)"></div>
          <div><div class="variant-row-label">Harga (Rp)</div><input type="text" id="vprice_${id}" value="${vprice ? vprice.toLocaleString('id-ID') : ''}" inputmode="numeric" oninput="formatRupiahInput(this)"></div>
        </div>
        <div class="variant-img-label">📷 Gambar Varian</div>
        <div class="variant-img-upload-row">
          <div class="variant-img-preview" id="vimgpreview_${id}">${existingImg ? `<img src="${existingImg}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">` : '🖼️'}</div>
          <div style="flex:1;">
            <input type="file" id="vimg_${id}" accept="image/*" style="display:none;" onchange="previewVariantImage('${id}',this)">
            <button type="button" class="admin-btn-secondary" style="width:100%;font-size:0.78rem;" onclick="document.getElementById('vimg_${id}').click()">📁 Upload</button>
            <button type="button" class="admin-btn-secondary" style="width:100%;font-size:0.75rem;margin-top:0.3rem;color:#ef4444;" onclick="clearVariantImage('${id}')">✕ Hapus</button>
          </div>
        </div>`;
      document.getElementById('variantList').appendChild(div);
    });
  }
  document.getElementById('formCardTitle').textContent = '✏️ Edit Produk';
  document.getElementById('formResetBtn').style.display = 'block';
  document.querySelector('.admin-grid')?.scrollIntoView({ behavior: 'smooth' });
};

window.deleteProduct = async function (productId, productName) {
  if (!adminAuthenticated) { showAdminNotif('❌ Login sebagai admin!', true); return; }
  if (!confirm(`Hapus produk "${productName}"?\n\nTidak dapat dibatalkan.`)) return;
  try {
    await deleteDoc(doc(db, 'sadewaProducts', productId));
    showAdminNotif('🗑️ Produk dihapus!');
  } catch (e) {
    let msg = '❌ Gagal menghapus!\n';
    if (e.code === 'permission-denied') msg += '🔒 Cek Firestore Rules.';
    else msg += e.message || 'Error tidak diketahui';
    showAdminNotif(msg, true);
  }
};

window.resetAdminForm = function (silent) {
  ['editProductId', 'adminName', 'adminCategory', 'adminPrice', 'adminStock', 'adminDesc', 'adminDisplayPrice', 'adminEmoji'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  mainImageBase64 = ''; mainVideoBase64 = ''; variantImages = {}; variantCounter = 0;
  document.getElementById('mainImgPreviewBox').innerHTML = '<div class="placeholder-text">🖼️<br>Klik untuk upload gambar</div>';
  document.getElementById('mainVideoPreviewBox').innerHTML = '<div class="placeholder-text">🎬<br>Klik untuk upload video<br><span style="font-size:0.7rem;color:var(--gray);">Maks 500MB</span></div>';
  document.getElementById('clearVideoBtn').style.display = 'none';
  document.getElementById('hasVariants').checked = false;
  document.getElementById('variantManagerSection').style.display = 'none';
  document.getElementById('variantList').innerHTML = '';
  document.getElementById('formCardTitle').textContent = '➕ Tambah Produk Baru';
  document.getElementById('formResetBtn').style.display = 'none';
  if (!silent) showAdminNotif('🔄 Form direset.');
};

window.handleCategoryChange = function () {
  const catEmojiMap = { 'Lampu': '💡', 'Kipas Angin': '💨', 'Kabel': '🔌', 'Saklar': '🎛️', 'Antena': '📡', 'Stopkontak': '🔋', 'Lainnya': '📦' };
  const cat = document.getElementById('adminCategory').value;
  const emojiInput = document.getElementById('adminEmoji');
  if (cat && catEmojiMap[cat] && !emojiInput.value) emojiInput.value = catEmojiMap[cat];
};

window.formatRupiahInput = function (input) {
  const raw = input.value.replace(/\D/g, '');
  input.value = raw ? parseInt(raw, 10).toLocaleString('id-ID') : '';
};

function showAdminNotif(msg, isError) {
  const notif = document.getElementById('adminNotif');
  if (!notif) return;
  notif.textContent = msg;
  notif.className = 'admin-notif' + (isError ? ' error' : ' success');
  notif.classList.add('show');
  setTimeout(() => notif.classList.remove('show'), 3000);
}

// ============================================================
// INVOICE & RIWAYAT PESANAN
// ============================================================
function _fmtRp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
function _fmtInvDate(d) {
  const dt = d && d.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
  if (isNaN(dt.getTime())) return '-';
  return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) + ' \u00b7 ' + dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
// 'Ditangguhkan' = gerbang wajib untuk SEMUA order baru. Admin harus cek manual
// satu-satu (nama/HP/alamat masuk akal, bukan bot/iseng) sebelum menggesernya
// ke 'Diproses'. Order tidak bisa "lompat" masuk antrian proses tanpa diverifikasi.
const ORDER_STATUSES = ['Ditangguhkan', 'Diproses', 'Dikirim', 'Selesai', 'Dibatalkan'];
function _statusIcon(s) {
  const map = { 'Ditangguhkan': '\u23f8\ufe0f', 'Diproses': '\ud83d\udce6', 'Dikirim': '\ud83d\ude9a', 'Selesai': '\u2705', 'Dibatalkan': '\u274c' };
  return (map[s] || '\u23f8\ufe0f') + ' ' + (s || 'Ditangguhkan');
}
function _paymentLabel(method, provider) {
  const labels = { bank: '<img src="./icon/bri-logo.png" alt="BRI" class="inv-pay-icon inv-pay-icon-bank">', ewallet: '\ud83d\udcf1 E-Wallet', qris: '<img src="./icon/qris-logo.png" alt="QRIS" class="inv-pay-icon">' };
  let base = labels[method] || (method || '-');
  const _banks = (_sadewaPaymentSettings && _sadewaPaymentSettings.banks) || DEFAULT_PAYMENT_SETTINGS.banks;
  if (method === 'bank' && _banks[provider]) base += ' \u2014 ' + _banks[provider].bankName;
  else if (method === 'ewallet' && provider) base += ' \u2014 ' + provider.toUpperCase();
  return base;
}

// Nomor invoice sequential & atomic, dijamin tidak bentrok walau ada
// beberapa pesanan masuk hampir bersamaan (pakai Firestore transaction).
async function _nextInvoiceNumber() {
  const counterRef = doc(db, 'sadewaCounters', 'invoiceCounter');
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data().count || 0) : 0;
    const val = current + 1;
    tx.set(counterRef, { count: val }, { merge: true });
    return val;
  });
  return `INV-${new Date().getFullYear()}-${String(next).padStart(5, '0')}`;
}

async function _saveOrderToFirestore(items, total, method, channel) {
  const shipName = document.getElementById('shipName')?.value?.trim() || _getBuyerName();
  const shipPhone = document.getElementById('shipPhone')?.value?.trim() || '';
  const shipRegion = document.getElementById('shipRegion')?.value?.trim() || '';
  const shipAddress = document.getElementById('shipAddress')?.value?.trim() || '';
  const shipDetail = document.getElementById('shipDetail')?.value?.trim() || '';
  const shipNote = document.getElementById('shipNote')?.value?.trim() || '';
  _setBuyerName(shipName);
  const shipping = window._sadewaShippingCost || null;
  const subtotal = items.reduce((s, i) => s + (i.price * i.quantity), 0);
  let invoiceNumber = 'INV-' + Date.now();
  try { invoiceNumber = await _nextInvoiceNumber(); } catch (e) { console.error('_nextInvoiceNumber:', e); }
  const orderData = {
    invoiceNumber,
    buyerUid: _getBuyerSession(),
    // Akun Google yang login saat transaksi (diwajibkan oleh requireBuyerLogin()
    // di openPaymentModal/buyDirectly). Dicatat terpisah dari buyerUid (sesi lokal)
    // supaya tiap pesanan bisa ditelusuri ke akun Gmail pembeli yang sebenarnya.
    buyerGoogleEmail: (currentUser && currentUser.providerData &&
      currentUser.providerData.some(p => p.providerId === 'google.com')) ? currentUser.email : null,
    buyerGoogleUid: (currentUser && currentUser.providerData &&
      currentUser.providerData.some(p => p.providerId === 'google.com')) ? currentUser.uid : null,
    buyerName: shipName, buyerPhone: shipPhone, buyerRegion: shipRegion,
    buyerAddress: shipAddress, buyerDetail: shipDetail, buyerNote: shipNote,
    items: items.map(i => ({ name: i.name, variant: i.variant || '', qty: i.quantity, price: i.price })),
    subtotal,
    shippingCost: shipping ? (shipping.cost || 0) : 0,
    shippingCourier: shipping ? (shipping.courier || '') : '',
    shippingService: shipping ? (shipping.service || '') : '',
    total,
    paymentMethod: method,
    paymentProvider: selectedPaymentProvider || '',
    channel,
    // Semua order baru WAJIB masuk sini dulu (bukan langsung 'Diproses').
    // Admin baru boleh menggesernya lewat dropdown di panel admin setelah
    // memastikan ini pembeli asli, bukan spam bot / iseng.
    status: 'Ditangguhkan',
    createdAt: serverTimestamp()
  };
  let savedId = null;
  try {
    const docRef = await addDoc(collection(db, 'sadewaOrders'), orderData);
    savedId = docRef.id;
  } catch (e) { console.error('_saveOrderToFirestore:', e); }
  // Pakai Date lokal untuk tampilan invoice langsung (serverTimestamp belum resolve di client sampai reload)
  return { id: savedId, ...orderData, createdAt: new Date() };
}

function _buildInvoiceHtml(order) {
  const itemsRows = (order.items || []).map(i => `
    <tr>
      <td>${_esc(i.name)}${i.variant ? ' <span class="inv-variant">(' + _esc(i.variant) + ')</span>' : ''}</td>
      <td class="inv-center">${i.qty}</td>
      <td class="inv-right">${_fmtRp(i.price)}</td>
      <td class="inv-right">${_fmtRp(i.price * i.qty)}</td>
    </tr>`).join('');
  const shippingRow = (order.shippingCost || 0) > 0 ? `
    <div class="inv-total-row"><span>Ongkos Kirim${order.shippingCourier ? ' (' + _esc(order.shippingCourier) + (order.shippingService ? ' - ' + _esc(order.shippingService) : '') + ')' : ''}</span><span>${_fmtRp(order.shippingCost)}</span></div>` : '';
  return `
    <div class="invoice-print-area" id="invoicePrintArea">
      <div class="inv-header">
        <div class="inv-brand">
          <img src="./logo-sadewa.png" alt="Sadewa" class="inv-logo" onerror="this.style.display='none'" />
          <div>
            <div class="inv-brand-name">Sadewa Elektronik</div>
            <div class="inv-brand-sub">Cidahu, Sukabumi &middot; wa.me/6285872189172</div>
          </div>
        </div>
        <div class="inv-meta">
          <div class="inv-title">INVOICE</div>
          <div><b>No:</b> ${_esc(order.invoiceNumber)}</div>
          <div><b>Tanggal:</b> ${_fmtInvDate(order.createdAt)}</div>
          <div class="inv-status-line"><b>Status:</b> ${_statusIcon(order.status)}</div>
        </div>
      </div>
      <div class="inv-parties">
        <div>
          <div class="inv-label">Ditagihkan Kepada</div>
          <div class="inv-buyer-name">${_esc(order.buyerName)}</div>
          <div>${_esc(order.buyerPhone)}</div>
          <div>${_esc(order.buyerRegion)}</div>
          <div>${_esc(order.buyerAddress)}${order.buyerDetail ? ', ' + _esc(order.buyerDetail) : ''}</div>
        </div>
        <div>
          <div class="inv-label">Metode Pembayaran</div>
          <div>${_paymentLabel(order.paymentMethod, order.paymentProvider)}</div>
          <div class="inv-label" style="margin-top:.75rem">Dikirim via</div>
          <div>${order.channel === 'whatsapp' ? '<img src="./icon/whatsapp-logo.png" alt="WhatsApp" class="inv-pay-icon"> WhatsApp' : '<img src="./icon/whatsapp-logo.png" alt="WhatsApp" class="inv-pay-icon"> Chat Langsung'}</div>
        </div>
      </div>
      <table class="inv-table">
        <thead><tr><th>Produk</th><th class="inv-center">Qty</th><th class="inv-right">Harga</th><th class="inv-right">Subtotal</th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <div class="inv-totals">
        <div class="inv-total-row"><span>Subtotal</span><span>${_fmtRp(order.subtotal)}</span></div>
        ${shippingRow}
        <div class="inv-total-row inv-grand-total"><span>Total</span><span>${_fmtRp(order.total)}</span></div>
      </div>
      <div class="inv-footer">\ud83d\ude4f Terima kasih telah berbelanja di Sadewa Elektronik!</div>
    </div>`;
}

window.openInvoiceModal = function (order) {
  window._currentInvoiceOrder = order;
  const c = document.getElementById('invoiceContent');
  if (c) c.innerHTML = _buildInvoiceHtml(order);
  document.getElementById('invoiceModal')?.classList.add('active');
};
window.closeInvoiceModal = function () {
  document.getElementById('invoiceModal')?.classList.remove('active');
};
window.closeInvoiceOnOverlay = function (event) {
  if (event.target === event.currentTarget) window.closeInvoiceModal();
};
window.printInvoice = function () { window.print(); };

// ── Riwayat Pesanan (Buyer) ──
window.openRiwayatModal = async function () {
  document.getElementById('riwayatModal')?.classList.add('active');
  const listEl = document.getElementById('riwayatList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="riwayat-loading">\u23f3 Memuat riwayat pesanan...</div>';
  try {
    const sid = _getBuyerSession();
    const qy = query(collection(db, 'sadewaOrders'), where('buyerUid', '==', sid), orderBy('createdAt', 'desc'));
    const snap = await getDocs(qy);
    if (snap.empty) {
      listEl.innerHTML = '<div class="riwayat-empty">\ud83d\udced Belum ada riwayat pesanan.</div>';
      return;
    }
    window._riwayatOrders = {};
    listEl.innerHTML = snap.docs.map(d => {
      const o = { id: d.id, ...d.data() };
      window._riwayatOrders[d.id] = o;
      return `<div class="riwayat-item" onclick="viewInvoiceFromRiwayat('${d.id}')">
        <div class="riwayat-item-top">
          <span class="riwayat-inv-no">\ud83e\uddfe ${_esc(o.invoiceNumber)}</span>
          <span class="riwayat-status">${_statusIcon(o.status)}</span>
        </div>
        <div class="riwayat-item-mid">${(o.items || []).length} produk &middot; ${_fmtInvDate(o.createdAt)}</div>
        <div class="riwayat-item-bottom"><span class="riwayat-total">${_fmtRp(o.total)}</span><span class="riwayat-arrow">Lihat Invoice \u203a</span></div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('openRiwayatModal:', e);
    listEl.innerHTML = '<div class="riwayat-empty">\u26a0\ufe0f Gagal memuat riwayat. Periksa koneksi &amp; coba lagi.<br><small style="opacity:.7">Jika ini pertama kali, buka Console (F12) &mdash; mungkin perlu buat index Firestore, klik link yang muncul di sana.</small></div>';
  }
};
window.closeRiwayatModal = function () { document.getElementById('riwayatModal')?.classList.remove('active'); };
window.closeRiwayatOnOverlay = function (event) { if (event.target === event.currentTarget) window.closeRiwayatModal(); };
window.viewInvoiceFromRiwayat = function (id) {
  const o = window._riwayatOrders?.[id];
  if (o) window.openInvoiceModal(o);
};

// ── Pesanan & Invoice (Admin) ──
window._adminOrders = [];
window.loadAdminOrders = async function () {
  const listEl = document.getElementById('adminOrderList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="admin-empty-state"><p>\u23f3 Memuat pesanan...</p></div>';
  try {
    const qy = query(collection(db, 'sadewaOrders'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(qy);
    window._adminOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.renderAdminOrders();
  } catch (e) {
    console.error('loadAdminOrders:', e);
    listEl.innerHTML = '<div class="admin-empty-state"><p>\u26a0\ufe0f Gagal memuat pesanan.</p></div>';
  }
};
// Helper tanggal lokal (bukan UTC) supaya cocok dengan nilai <input type="date">
// dan tidak meleset karena selisih zona waktu WIB (UTC+7).
function _localDateStr(dt) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// Satu sumber logika filter dipakai bareng oleh renderAdminOrders() &
// exportOrdersToCSV(), supaya daftar yang tampil di layar dan isi file CSV
// SELALU sinkron (tidak ada kasus "kok yang ke-download beda sama yang di layar").
// overrideStatus dipakai oleh tombol "Export Produk Terjual" untuk memaksa
// status = 'Selesai' tanpa perlu mengubah dropdown filter di layar.
function _getFilteredAdminOrders(overrideStatus) {
  const kw = (document.getElementById('adminOrderSearch')?.value || '').toLowerCase();
  const filterStatus = overrideStatus || document.getElementById('adminOrderFilterStatus')?.value || 'all';
  const dateFrom = document.getElementById('adminOrderDateFrom')?.value || '';
  const dateTo = document.getElementById('adminOrderDateTo')?.value || '';

  let orders = window._adminOrders || [];
  if (kw) orders = orders.filter(o => (o.buyerName || '').toLowerCase().includes(kw) || (o.invoiceNumber || '').toLowerCase().includes(kw) || (o.buyerPhone || '').includes(kw));
  if (filterStatus !== 'all') orders = orders.filter(o => o.status === filterStatus);
  if (dateFrom || dateTo) {
    orders = orders.filter(o => {
      const raw = o.createdAt;
      const dt = raw && raw.toDate ? raw.toDate() : (raw instanceof Date ? raw : new Date(raw));
      if (isNaN(dt.getTime())) return false;
      const dayStr = _localDateStr(dt);
      if (dateFrom && dayStr < dateFrom) return false;
      if (dateTo && dayStr > dateTo) return false;
      return true;
    });
  }
  return orders;
}

window.renderAdminOrders = function () {
  const listEl = document.getElementById('adminOrderList');
  if (!listEl) return;
  const orders = _getFilteredAdminOrders();
  const countLabel = document.getElementById('adminOrderCountLabel');
  if (countLabel) countLabel.textContent = orders.length;
  if (!orders.length) { listEl.innerHTML = '<div class="admin-empty-state"><div class="admin-empty-icon">\ud83e\uddfe</div><p>Tidak ada pesanan yang cocok dengan filter.</p></div>'; return; }
  listEl.innerHTML = orders.map(o => `
    <div class="admin-order-item${o.status === 'Ditangguhkan' ? ' is-pending-review' : ''}">
      <div class="admin-order-main">
        <div class="admin-order-top">
          <span class="admin-order-inv">\ud83e\uddfe ${_esc(o.invoiceNumber)}${o.status === 'Ditangguhkan' ? '<span class="admin-order-pending-badge">\u26a0\ufe0f Perlu Verifikasi</span>' : ''}</span>
          <span class="admin-order-date">${_fmtInvDate(o.createdAt)}</span>
        </div>
        <div class="admin-order-buyer">${_esc(o.buyerName)} &middot; ${_esc(o.buyerPhone)}</div>
        <div class="admin-order-items">${(o.items || []).map(i => _esc(i.name) + ' x' + i.qty).join(', ')}</div>
      </div>
      <div class="admin-order-side">
        <div class="admin-order-total">${_fmtRp(o.total)}</div>
        <select class="admin-order-status-select" onchange="updateOrderStatus('${o.id}', this.value)">
          ${ORDER_STATUSES.map(s => `<option value="${s}"${s === o.status ? ' selected' : ''}>${_statusIcon(s)}</option>`).join('')}
        </select>
        <button class="admin-btn-view" style="padding:.5rem .85rem;font-size:.78rem" onclick="viewInvoiceFromAdmin('${o.id}')">\ud83e\uddfe Invoice</button>
      </div>
    </div>`).join('');
};
window.filterAdminOrders = function () { window.renderAdminOrders(); };

// ── Export Pesanan & Pelanggan ke CSV (Excel/Google Sheets) ──
// Mengikuti kata kunci pencarian & filter status yang sedang aktif di panel
// admin, jadi kalau admin sudah mempersempit tampilan (misal cuma status
// "Selesai"), file CSV yang di-download juga cuma berisi itu saja.
function _csvEscape(value) {
  const s = (value === null || value === undefined) ? '' : String(value);
  // Kalau ada koma, kutip dua, atau baris baru -> wajib dibungkus tanda kutip
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

window.exportOrdersToCSV = function (overrideStatus, filenameTag) {
  let orders = _getFilteredAdminOrders(overrideStatus);

  // Alur pasti: hanya pelanggan yang BENAR-BENAR sudah login Google DAN
  // sudah menyelesaikan transaksi (ada dokumen order = pasti sudah checkout,
  // lihat requireBuyerLogin() di openPaymentModal/buyDirectly) yang boleh
  // masuk daftar export. Order lama (dibuat sebelum fitur wajib-login
  // diaktifkan) tidak punya buyerGoogleEmail -> di-skip, bukan diikutkan
  // dengan placeholder, supaya daftar customer ini bersih & bisa dipercaya.
  const totalBeforeFilter = orders.length;
  orders = orders.filter(o => !!o.buyerGoogleEmail);
  const skippedCount = totalBeforeFilter - orders.length;

  if (!orders.length) {
    const msg = skippedCount > 0
      ? `⚠️ Tidak ada pelanggan valid untuk di-export (${skippedCount} order lama dilewati karena belum ada data login Google)`
      : '⚠️ Tidak ada data untuk di-export';
    if (typeof window.showAdminNotif === 'function') showAdminNotif(msg, true);
    else alert(msg);
    return;
  }

  const headers = [
    'No. Invoice', 'Tanggal', 'Nama Pembeli', 'Email Gmail', 'No. HP',
    'Wilayah', 'Alamat Lengkap', 'Produk', 'Subtotal', 'Ongkir', 'Total',
    'Metode Pembayaran', 'Status'
  ];

  const rows = orders.map(o => [
    o.invoiceNumber || '',
    _fmtInvDate(o.createdAt),
    o.buyerName || '',
    o.buyerGoogleEmail,
    o.buyerPhone || '',
    o.buyerRegion || '',
    o.buyerAddress || '',
    (o.items || []).map(i => `${i.name}${i.variant ? ' (' + i.variant + ')' : ''} x${i.qty}`).join('; '),
    o.subtotal || 0,
    o.shippingCost || 0,
    o.total || 0,
    o.paymentMethod || '',
    o.status || ''
  ]);

  // \ufeff (BOM) di depan supaya Excel langsung baca huruf/simbol Indonesia
  // dengan benar (bukan karakter aneh), khususnya di Excel Windows.
  const csvContent = '\ufeff' + [headers, ...rows]
    .map(row => row.map(_csvEscape).join(','))
    .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const todayStr = _localDateStr(new Date());
  const tag = filenameTag ? `-${filenameTag}` : '';
  a.href = url;
  a.download = `Sadewa-Elektronik-Pesanan${tag}-${todayStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (typeof window.showAdminNotif === 'function') {
    const extra = skippedCount > 0 ? ` (${skippedCount} order lama dilewati)` : '';
    showAdminNotif(`✅ ${orders.length} data pelanggan berhasil di-export${extra}`);
  }
};

// ── Tombol utama: "Export Produk Terjual" ──
// Ini yang dipakai admin untuk kebutuhan "download CSV produk yang berhasil
// dijual ke customer". Dipaksa ke status 'Selesai' (bukan sekadar mengikuti
// dropdown), lalu dropdown ikut disetel ke 'Selesai' juga supaya tampilan
// layar & isi file yang di-download selalu sinkron dan tidak membingungkan.
window.exportSoldProducts = function () {
  const statusSelect = document.getElementById('adminOrderFilterStatus');
  if (statusSelect) statusSelect.value = 'Selesai';
  window.renderAdminOrders();
  window.exportOrdersToCSV('Selesai', 'Produk-Terjual');
};
window.viewInvoiceFromAdmin = function (id) {
  const o = (window._adminOrders || []).find(x => x.id === id);
  if (o) window.openInvoiceModal(o);
};
window.updateOrderStatus = async function (id, status) {
  try {
    await updateDoc(doc(db, 'sadewaOrders', id), { status });
    const o = (window._adminOrders || []).find(x => x.id === id);
    if (o) o.status = status;
    showAdminNotif('\u2705 Status pesanan diperbarui');
  } catch (e) {
    console.error('updateOrderStatus:', e);
    showAdminNotif('\u274c Gagal memperbarui status', true);
  }
};

// ============================================================
// CHAT SYSTEM
// ============================================================
let _buyerSessionId = null;
let _buyerChatOpen = false;
let _acpActiveConvId = null;
let _allConvs = [];
let _adminChatUnread = 0;
let _buyerUnread = 0;
let _adminMsgUnsub = null;
// Guard supaya _listenBuyerMsgs() tidak pernah menumpuk: simpan fungsi
// unsubscribe listener yang sedang aktif + sid yang sedang didengarkan.
let _buyerMsgUnsub = null;
let _buyerMsgListenerSid = null;

function _getBuyerSession() {
  if (!_buyerSessionId) {
    _buyerSessionId = localStorage.getItem('sadewaChatSession');
    if (!_buyerSessionId) {
      _buyerSessionId = 'buyer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('sadewaChatSession', _buyerSessionId);
    }
  }
  return _buyerSessionId;
}
function _getBuyerName() { return localStorage.getItem('sadewaBuyerName') || 'Pelanggan'; }
function _setBuyerName(n) { if (n) localStorage.setItem('sadewaBuyerName', n); }

function _fmtTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date(), diff = now - d;
  if (diff < 60000) return 'Baru saja';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' mnt';
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}
function _fmtShort(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}
function _esc(t) {
  return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function _buildOrderCard(order) {
  const items = (order.items || []).map(i =>
    `<div class="bcw-order-card-item">• ${_esc(i.name)}${i.variant ? ` (${_esc(i.variant)})` : ''} ×${i.qty} — Rp ${Number(i.price).toLocaleString('id-ID')}</div>`
  ).join('');
  return `<div class="bcw-order-card">
    <div class="bcw-order-card-title">🧾 Detail Pesanan</div>
    ${items}
    <div class="bcw-order-card-total">Total: Rp ${Number(order.total).toLocaleString('id-ID')}</div>
    <div class="bcw-order-status">✅ Pesanan Dikonfirmasi</div>
  </div>`;
}

window.toggleBuyerChat = function () {
  _buyerChatOpen = !_buyerChatOpen;
  const win = document.getElementById('buyerChatWindow');
  if (!win) return;
  if (_buyerChatOpen) {
    win.classList.add('open');
    _buyerUnread = 0; _updateBuyerBadge();
    _scrollBcw(); _markBuyerRead();
  } else { win.classList.remove('open'); }
};

function _updateBuyerBadge() {
  const b = document.getElementById('chatBubbleUnread');
  if (!b) return;
  if (_buyerUnread > 0) { b.textContent = _buyerUnread; b.classList.add('visible'); }
  else b.classList.remove('visible');
}
function _scrollBcw() { setTimeout(() => { const m = document.getElementById('bcwMessages'); if (m) m.scrollTop = m.scrollHeight; }, 60); }

window.autoResizeBcw = function (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 90) + 'px'; };
window.handleBcwKey = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendBuyerMessage(); } };

function _playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

function _listenBuyerMsgs(sid) {
  // 1 chat session = 1 listener aktif. Jika listener untuk sid yang sama
  // masih aktif, jangan buat listener baru (mencegah listener menumpuk saat
  // initChat()/afterPaymentSuccessChat() dipanggil berkali-kali).
  if (_buyerMsgUnsub && _buyerMsgListenerSid === sid) return;
  // Session/chat berbeda dari yang sedang didengarkan -> hentikan listener
  // lama dulu sebelum membuat yang baru, supaya tidak ada listener "hantu".
  if (_buyerMsgUnsub) { _buyerMsgUnsub(); _buyerMsgUnsub = null; }
  _buyerMsgListenerSid = sid;
  const q2 = query(collection(db, 'sadewaChats', sid, 'messages'), orderBy('createdAt', 'asc'));
  _buyerMsgUnsub = onSnapshot(q2, snap => {
    const container = document.getElementById('bcwMessages');
    if (!container) return;
    // Incremental rendering: jangan innerHTML='' + render ulang semua pesan.
    // Cukup terapkan perubahan (added/modified/removed) ke elemen terkait,
    // memakai ID pesan Firestore sebagai identifier DOM (data-message-id).
    snap.docChanges().forEach(change => {
      const msgId = change.doc.id;
      const msg = change.doc.data();
      if (change.type === 'added') {
        if (!container.querySelector(`[data-message-id="${msgId}"]`)) {
          _appendBuyerMsg(msg, msgId, container);
        }
      } else if (change.type === 'modified') {
        _updateBuyerMsgEl(msg, msgId, container);
      } else if (change.type === 'removed') {
        const el = container.querySelector(`[data-message-id="${msgId}"]`);
        if (el) el.remove();
      }
    });
    if (_buyerChatOpen) { _scrollBcw(); _markBuyerRead(); }
    else {
      const newUnread = snap.docs.filter(d => d.data().sender === 'seller' && !d.data().readByBuyer).length;
      if (newUnread > _buyerUnread) _playNotifSound();
      _buyerUnread = newUnread; _updateBuyerBadge();
    }
  });
}

function _buyerMsgHtml(msg) {
  const sent = msg.sender === 'buyer';
  const content = msg.orderCard ? _buildOrderCard(msg.orderCard) : `<div class="bcw-bubble">${_esc(msg.text)}</div>`;
  return content + `<div class="bcw-time">${sent ? 'Anda' : 'Sadewa'} · ${_fmtShort(msg.createdAt)}</div>`;
}

function _appendBuyerMsg(msg, msgId, container) {
  const sent = msg.sender === 'buyer';
  const div = document.createElement('div');
  div.className = 'bcw-msg ' + (sent ? 'sent' : 'recv');
  if (msgId) div.dataset.messageId = msgId;
  div.innerHTML = _buyerMsgHtml(msg);
  container.appendChild(div);
}

function _updateBuyerMsgEl(msg, msgId, container) {
  const el = container.querySelector(`[data-message-id="${msgId}"]`);
  if (!el) { _appendBuyerMsg(msg, msgId, container); return; }
  el.className = 'bcw-msg ' + (msg.sender === 'buyer' ? 'sent' : 'recv');
  el.innerHTML = _buyerMsgHtml(msg);
}

async function _markBuyerRead() {
  const sid = _getBuyerSession();
  try {
    const snap = await getDocs(query(collection(db, 'sadewaChats', sid, 'messages'), where('sender', '==', 'seller'), where('readByBuyer', '==', false)));
    if (snap.empty) return;
    // Tandai semua pesan unread sekaligus lewat writeBatch (bukan updateDoc
    // satu-satu) supaya jumlah request & trigger onSnapshot jauh berkurang.
    // Di-chunk per 450 operasi untuk aman terhadap batas 500 operasi/batch Firestore.
    const docsToMark = snap.docs;
    const CHUNK_SIZE = 450;
    for (let i = 0; i < docsToMark.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      docsToMark.slice(i, i + CHUNK_SIZE).forEach(d => {
        batch.update(doc(db, 'sadewaChats', sid, 'messages', d.id), { readByBuyer: true });
      });
      await batch.commit();
    }
  } catch (e) {}
}

window.sendBuyerMessage = async function () {
  const input = document.getElementById('bcwInput');
  const text = (input?.value || '').trim();
  if (!text) return;
  const btn = document.getElementById('bcwSendBtn');
  if (btn) btn.disabled = true;
  input.value = ''; input.style.height = 'auto';
  const sid = _getBuyerSession(), name = _getBuyerName();
  try {
    await setDoc(doc(db, 'sadewaChats', sid), { sessionId: sid, buyerName: name, lastMessage: text, lastMessageAt: serverTimestamp(), adminUnread: increment(1), updatedAt: serverTimestamp() }, { merge: true });
    await addDoc(collection(db, 'sadewaChats', sid, 'messages'), { text, sender: 'buyer', senderName: name, createdAt: serverTimestamp(), readByAdmin: false, readByBuyer: true });
  } catch (e) { console.error('sendBuyerMsg:', e); }
  finally { if (btn) btn.disabled = false; input?.focus(); }
};

window.afterPaymentSuccessChat = async function (items, total, method) {
  try {
    const sid = _getBuyerSession();
    const name = document.getElementById('shipName')?.value?.trim() || _getBuyerName();
    const phone = document.getElementById('shipPhone')?.value?.trim() || '';
    const addr = document.getElementById('shipAddress')?.value?.trim() || '';
    _setBuyerName(name);
    await setDoc(doc(db, 'sadewaChats', sid), { sessionId: sid, buyerName: name, buyerPhone: phone, lastMessage: '🧾 Pesanan baru dikonfirmasi', lastMessageAt: serverTimestamp(), adminUnread: increment(2), updatedAt: serverTimestamp() }, { merge: true });
    await addDoc(collection(db, 'sadewaChats', sid, 'messages'), { sender: 'buyer', senderName: name, orderCard: { items: items.map(i => ({ name: i.name, variant: i.variant || '', qty: i.quantity, price: i.price })), total, method }, text: '🧾 Pesanan baru dikonfirmasi', createdAt: serverTimestamp(), readByAdmin: false, readByBuyer: true });
    await addDoc(collection(db, 'sadewaChats', sid, 'messages'), { text: `📍 Alamat: ${name}\n📱 HP: ${phone}\n🏠 ${addr}`, sender: 'buyer', senderName: name, createdAt: serverTimestamp(), readByAdmin: false, readByBuyer: true });
    _listenBuyerMsgs(sid);
    const chatBtn = document.getElementById('chatBubbleBtn');
    if (chatBtn) chatBtn.style.display = 'flex';
    if (!_buyerChatOpen) window.toggleBuyerChat();
    setTimeout(_scrollBcw, 200);
  } catch (e) { console.error('afterPaymentSuccessChat:', e); }
};

// ── Admin Chat Panel ──
function _initAdminChat() {
  const q3 = query(collection(db, 'sadewaChats'), orderBy('updatedAt', 'desc'));
  onSnapshot(q3, snap => {
    _allConvs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderConvList(_allConvs);
    _adminChatUnread = _allConvs.reduce((s, c) => s + (c.adminUnread || 0), 0);
    _updateAdminBadge();
  });
}

function _updateAdminBadge() {
  const b = document.getElementById('adminChatTabBadge');
  if (!b) return;
  if (_adminChatUnread > 0) { b.textContent = _adminChatUnread > 99 ? '99+' : _adminChatUnread; b.classList.add('visible'); }
  else b.classList.remove('visible');
}

window.filterConversations = function () {
  const q4 = (document.getElementById('acpSearch')?.value || '').toLowerCase();
  _renderConvList(q4 ? _allConvs.filter(c => (c.buyerName || '').toLowerCase().includes(q4) || (c.lastMessage || '').toLowerCase().includes(q4)) : _allConvs);
};

function _renderConvList(convs) {
  const list = document.getElementById('acpConvList');
  if (!list) return;
  if (!convs?.length) { list.innerHTML = `<div class="acp-empty-state"><div class="acp-empty-icon">💬</div><p style="font-size:.875rem;">Belum ada percakapan</p></div>`; return; }
  list.innerHTML = convs.map(c => {
    const active = c.id === _acpActiveConvId, unread = c.adminUnread || 0;
    const init2 = (c.buyerName || 'P')[0].toUpperCase();
    return `<div class="acp-conv-item${active ? ' active' : ''}${unread > 0 && !active ? ' has-new' : ''}" onclick="openAdminConv('${c.id}')">
      <div class="acp-conv-avatar">${init2}</div>
      <div class="acp-conv-info">
        <div class="acp-conv-name">${_esc(c.buyerName || 'Pelanggan')}</div>
        <div class="acp-conv-preview">${_esc((c.lastMessage || '').substring(0, 45))}</div>
      </div>
      <div class="acp-conv-meta">
        <div class="acp-conv-time">${_fmtTime(c.lastMessageAt)}</div>
        ${unread > 0 ? `<div class="acp-conv-badge">${unread}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

window.openAdminConv = async function (cid) {
  _acpActiveConvId = cid;
  _renderConvList(_allConvs);
  const conv = _allConvs.find(c => c.id === cid) || {};
  const area = document.getElementById('acpChatArea');
  if (!area) return;
  const waLink = conv.buyerPhone ? `<a href="https://wa.me/62${(conv.buyerPhone || '').replace(/^0/, '').replace(/\D/g, '')}" target="_blank" class="acp-action-btn">💬 WA</a>` : '';
  area.innerHTML = `
    <div class="acp-chat-header">
      <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--secondary),var(--darker));border:2px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--primary);font-weight:700;flex-shrink:0;">${(conv.buyerName || 'P')[0].toUpperCase()}</div>
      <div><div class="acp-chat-customer-name">${_esc(conv.buyerName || 'Pelanggan')}</div><div class="acp-chat-customer-sub">${conv.buyerPhone ? '📱 ' + conv.buyerPhone : 'Tanpa nomor'}</div></div>
      <div class="acp-chat-actions">${waLink}</div>
    </div>
    <div class="acp-quick-replies">
      <div class="acp-qr-chip" onclick="acpQR('Halo! Pesanan Anda sudah kami terima ✅')">✅ Terima pesanan</div>
      <div class="acp-qr-chip" onclick="acpQR('Pesanan sedang kami proses 🔄')">🔄 Diproses</div>
      <div class="acp-qr-chip" onclick="acpQR('Pesanan sudah dikirim 🚚 Mohon ditunggu ya!')">🚚 Dikirim</div>
      <div class="acp-qr-chip" onclick="acpQR('Terima kasih sudah berbelanja di Sadewa Elektronik! 🙏')">🙏 Terima kasih</div>
      <div class="acp-qr-chip" onclick="acpQR('Mohon maaf, stok sedang kosong 📦')">📦 Stok habis</div>
    </div>
    <div class="acp-messages" id="acpMessages"></div>
    <div class="acp-input-area">
      <textarea class="acp-input" id="acpInput" placeholder="Balas pesan..." rows="1" onkeydown="handleAcpKey(event)" oninput="autoResizeAcp(this)"></textarea>
      <button class="acp-send" id="acpSendBtn" onclick="sendAdminMessage()">➤</button>
    </div>`;
  try { await updateDoc(doc(db, 'sadewaChats', cid), { adminUnread: 0 }); } catch (e) {}
  if (_adminMsgUnsub) _adminMsgUnsub();
  const mq = query(collection(db, 'sadewaChats', cid, 'messages'), orderBy('createdAt', 'asc'));
  _adminMsgUnsub = onSnapshot(mq, snap => {
    const container = document.getElementById('acpMessages');
    if (!container) return;
    container.innerHTML = '';
    let lastDate = '';
    snap.docs.forEach(d => {
      const msg = d.data(), sent = msg.sender === 'seller';
      const msgDate = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      if (msgDate && msgDate !== lastDate) { lastDate = msgDate; const sep = document.createElement('div'); sep.className = 'chat-date-sep'; sep.textContent = msgDate; container.appendChild(sep); }
      const div = document.createElement('div');
      div.className = 'acp-msg ' + (sent ? 'sent' : 'recv');
      div.innerHTML = (msg.orderCard ? _buildOrderCard(msg.orderCard) : `<div class="bcw-bubble">${_esc(msg.text)}</div>`) + `<div class="bcw-time">${sent ? 'Admin' : _esc(msg.senderName || 'Pelanggan')} · ${_fmtShort(msg.createdAt)}</div>`;
      container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
    snap.docs.forEach(async d => { if (d.data().sender === 'buyer' && !d.data().readByAdmin) await updateDoc(doc(db, 'sadewaChats', cid, 'messages', d.id), { readByAdmin: true }).catch(() => {}); });
  });
};

window.acpQR = function (text) { const inp = document.getElementById('acpInput'); if (inp) { inp.value = text; inp.focus(); } };
window.autoResizeAcp = function (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; };
window.handleAcpKey = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendAdminMessage(); } };

window.sendAdminMessage = async function () {
  if (!_acpActiveConvId) return;
  const inp = document.getElementById('acpInput');
  const text = (inp?.value || '').trim();
  if (!text) return;
  const btn2 = document.getElementById('acpSendBtn');
  if (btn2) btn2.disabled = true;
  inp.value = ''; inp.style.height = 'auto';
  try {
    await addDoc(collection(db, 'sadewaChats', _acpActiveConvId, 'messages'), { text, sender: 'seller', senderName: 'Sadewa Elektronik', createdAt: serverTimestamp(), readByAdmin: true, readByBuyer: false });
    await updateDoc(doc(db, 'sadewaChats', _acpActiveConvId), { lastMessage: text, lastMessageAt: serverTimestamp(), buyerUnread: increment(1) });
  } catch (e) { console.error('adminSend:', e); }
  finally { if (btn2) btn2.disabled = false; inp?.focus(); }
};

window.showAdminChatPanel = function () {
  document.querySelector('.admin-stats-row')?.style.setProperty('display', 'none', 'important');
  document.querySelector('.admin-grid')?.style.setProperty('display', 'none', 'important');
  const p = document.getElementById('adminChatPanel');
  if (p) { p.style.display = 'flex'; p.classList.add('active'); }
  if (!_allConvs.length) _initAdminChat();
};
window.showAdminProductPanel = function () {
  document.querySelector('.admin-stats-row')?.style.removeProperty('display');
  document.querySelector('.admin-grid')?.style.removeProperty('display');
  const p = document.getElementById('adminChatPanel');
  if (p) { p.style.display = 'none'; p.classList.remove('active'); }
};

// ── Init Chat ──
function initChat() {
  // Tombol chat SELALU ditampilkan lebih dulu, tidak lagi menunggu/bergantung pada
  // berhasil-tidaknya sinkronisasi riwayat chat ke Firestore — supaya fitur pesan
  // tidak pernah "macet tersembunyi" (tombol tidak muncul) akibat gangguan jaringan/izin.
  const chatBtnEl = document.getElementById('chatBubbleBtn');
  if (chatBtnEl) chatBtnEl.style.display = 'flex';
  try {
    const sid = _getBuyerSession();
    _listenBuyerMsgs(sid);
  } catch (e) { console.error('initChat: gagal memuat riwayat chat', e); }
  const adminActions = document.querySelector('.admin-topbar-actions');
  if (adminActions && !document.getElementById('adminChatTabBtn')) {
    const prodBtn = document.createElement('button');
    prodBtn.className = 'admin-tab-btn'; prodBtn.id = 'adminProdTabBtn'; prodBtn.textContent = '📦 Produk';
    prodBtn.onclick = window.showAdminProductPanel;
    const chatBtn2 = document.createElement('button');
    chatBtn2.className = 'admin-tab-btn'; chatBtn2.id = 'adminChatTabBtn';
    chatBtn2.innerHTML = '💬 Pesan <span class="admin-tab-badge" id="adminChatTabBadge">0</span>';
    chatBtn2.onclick = () => { window.showAdminChatPanel(); _initAdminChat(); };
    const logoutBtn = adminActions.querySelector('.admin-btn-logout');
    if (logoutBtn) { adminActions.insertBefore(prodBtn, logoutBtn); adminActions.insertBefore(chatBtn2, logoutBtn); }
    else { adminActions.appendChild(prodBtn); adminActions.appendChild(chatBtn2); }
  }
}

// ── Start ──
init();