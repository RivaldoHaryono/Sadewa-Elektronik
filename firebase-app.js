// ============================================================
// firebase-app.js — Sadewa Elektronik
// Firebase + semua logic utama (cart, payment, produk, admin)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, onSnapshot, query, orderBy,
  enableIndexedDbPersistence, doc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, setDoc, increment, getDocs, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInAnonymously
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

// Admin credentials (fallback local auth)
const ADMIN_USER = 'sadewa';
const ADMIN_PASS = 'sadewa990';

onAuthStateChanged(auth, (user) => {
  currentUser = user;
});

// Buatkan "kartu tamu" otomatis (anonymous) untuk pengunjung yang belum login.
// Aman untuk admin juga — saat admin login manual (email/password), currentUser
// akan ditimpa oleh proses login admin, jadi tidak saling ganggu.
signInAnonymously(auth).catch((err) => {
  console.error('Gagal membuat sesi anonymous:', err);
});

// ============================================================
// CART
// ============================================================
function loadCartFromStorage() {
  const saved = localStorage.getItem('sadewaCart');
  if (saved) { try { cartItems = JSON.parse(saved); updateCartBadge(); } catch (e) { cartItems = []; } }
}
function saveCartToStorage() { localStorage.setItem('sadewaCart', JSON.stringify(cartItems)); }

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
let selectedPaymentMethod = 'card', selectedPaymentProvider = 'visa';
const bankAccounts = { bri: { number: '3456-01-001829-50-2', name: 'AI JULAEHA' } };

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
  if (typeof window.resetOngkirSelection === 'function') window.resetOngkirSelection();
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

window.closePaymentModal = function () {
  document.getElementById('paymentModal').classList.remove('active');
  window.isBuyNowMode = false;
  window.tempBuyNowCart = [];
};

window.switchPaymentTab = function (tab, clickedEl) {
  document.querySelectorAll('.payment-tab').forEach(t => t.classList.remove('active'));
  if (clickedEl) clickedEl.classList.add('active');
  document.querySelectorAll('.payment-content').forEach(c => c.classList.remove('active'));
  selectedPaymentMethod = tab;
  if (tab === 'card') { document.getElementById('cardPayment').classList.add('active'); selectedPaymentProvider = 'visa'; }
  else if (tab === 'bank') { document.getElementById('bankPayment').classList.add('active'); selectedPaymentProvider = 'bri'; updateBankInfo('bri'); }
  else if (tab === 'ewallet') { document.getElementById('ewalletPayment').classList.add('active'); selectedPaymentProvider = 'gopay'; }
  else if (tab === 'qris') { document.getElementById('qrisPayment').classList.add('active'); selectedPaymentProvider = 'qris'; }
};

window.selectPaymentOption = function (element, provider) {
  element.parentElement.querySelectorAll('.payment-option').forEach(opt => opt.classList.remove('selected'));
  element.classList.add('selected'); selectedPaymentProvider = provider;
  if (selectedPaymentMethod === 'bank') updateBankInfo(provider);
};

function updateBankInfo(bank) {
  const b = bankAccounts[bank];
  if (b) {
    document.getElementById('selectedBankName').textContent = b.name;
    document.getElementById('bankAccountNumber').textContent = b.number;
  }
}

window.formatCardNumber = function (input) {
  let v = input.value.replace(/\s/g, '');
  input.value = v.match(/.{1,4}/g)?.join(' ') || v;
};
window.formatExpiry = function (input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2, 4);
  input.value = v;
};
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

window.processPayment = function () {
  const btn = document.getElementById('paymentSubmitBtn');
  btn.disabled = true; btn.textContent = 'Memproses...';
  let isValid = true, message = '';
  if (selectedPaymentMethod === 'card') {
    const cn = document.getElementById('cardNumber').value;
    const nm = document.getElementById('cardName').value;
    const ex = document.getElementById('cardExpiry').value;
    const cv = document.getElementById('cardCVV').value;
    if (!cn || !nm || !ex || !cv) { isValid = false; message = 'Mohon lengkapi semua data kartu!'; }
    else if (cn.replace(/\s/g, '').length < 16) { isValid = false; message = 'Nomor kartu tidak valid!'; }
    else if (cv.length < 3) { isValid = false; message = 'CVV tidak valid!'; }
  } else if (selectedPaymentMethod === 'bank') {
    if (!document.getElementById('senderName').value) { isValid = false; message = 'Mohon masukkan nama pengirim!'; }
  } else if (selectedPaymentMethod === 'ewallet') {
    const ph = document.getElementById('ewalletPhone').value;
    const nm = document.getElementById('ewalletName').value;
    if (!ph || !nm) { isValid = false; message = 'Mohon lengkapi data e-wallet!'; }
    else if (ph.length < 10) { isValid = false; message = 'Nomor HP tidak valid!'; }
  }
  setTimeout(() => {
    if (!isValid) { alert(message); btn.disabled = false; btn.textContent = 'Konfirmasi Pembayaran'; return; }
    window._pendingOrder = {
      items: window.isBuyNowMode ? (window.tempBuyNowCart || []) : [...cartItems],
      method: selectedPaymentMethod,
      isBuyNow: window.isBuyNowMode
    };
    window._pendingOrder.total = window._pendingOrder.items.reduce((s, i) => s + (i.price * i.quantity), 0) + getShippingCost();
    window._pendingOrder.shipping = window._sadewaShippingCost || null;
    btn.disabled = false; btn.textContent = 'Konfirmasi Pembayaran';
    window.showChannelChoice();
  }, 500);
};

window.showChannelChoice = function () {
  document.getElementById('channelChoiceOverlay').classList.add('active');
};
window.closeChannelChoice = function () {
  document.getElementById('channelChoiceOverlay').classList.remove('active');
};

window.sendViaWhatsApp = function () {
  window.closeChannelChoice();
  sendPaymentToWhatsApp();
  if (!window._pendingOrder.isBuyNow) { cartItems = []; saveCartToStorage(); updateCartBadge(); }
  window.closePaymentModal();
  window.isBuyNowMode = false; window.tempBuyNowCart = [];
  window._pendingOrder = null;
};

window.sendViaChat = async function () {
  window.closeChannelChoice();
  const order = window._pendingOrder;
  if (!order.isBuyNow) { cartItems = []; saveCartToStorage(); updateCartBadge(); }
  window.closePaymentModal();
  const chatBtn = document.getElementById('chatBubbleBtn');
  if (chatBtn) chatBtn.style.display = 'flex';
  await window.afterPaymentSuccessChat(order.items, order.total, order.method);
  if (!_buyerChatOpen) window.toggleBuyerChat();
  window.isBuyNowMode = false; window.tempBuyNowCart = [];
  window._pendingOrder = null;
};

function sendPaymentToWhatsApp() {
  const shipName = document.getElementById('shipName').value.trim();
  const shipPhone = document.getElementById('shipPhone').value.trim();
  const shipRegion = document.getElementById('shipRegion').value.trim();
  const shipAddress = document.getElementById('shipAddress').value.trim();
  const shipDetail = document.getElementById('shipDetail').value.trim();
  const shipNote = document.getElementById('shipNote').value.trim();
  let message = '💳 *PESANAN BARU (SADEWA ELEKTRONIK)*\n━━━━━━━━━━━━━━━━━━━━\n\n*📍 Alamat Pengiriman:*\n';
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
  if (selectedPaymentMethod === 'card') message += `💳 ${selectedPaymentProvider.toUpperCase()} - **** ${document.getElementById('cardNumber').value.slice(-4)}\nNama: ${document.getElementById('cardName').value}\n`;
  else if (selectedPaymentMethod === 'bank') message += `🏦 Transfer ${bankAccounts[selectedPaymentProvider]?.name || ''}\nNama: ${document.getElementById('senderName').value}\n`;
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
    updateDoc, doc, addDoc, setDoc, serverTimestamp, increment
  };

  onSnapshot(query(prodCol, orderBy("createdAt", "desc")), (snapshot) => {
    products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    window._sadewaProducts = products;
    applyFilters();
    if (adminAuthenticated) { renderAdminProductList(); updateAdminStats(); }
  });
  initSearchBar();
  loadCartFromStorage();
  initChat();
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

window.applyFilters = function () {
  const q = lastSearchQuery.trim().toLowerCase();
  filteredProducts = products.filter(p => {
    const passCat = activeCategory === 'all' ? true : p.category === activeCategory;
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
  if (si) si.oninput = (e) => { lastSearchQuery = e.target.value; window.applyFilters(); };
  if (cb) cb.onclick = () => { si.value = ''; lastSearchQuery = ''; window.applyFilters(); };
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
    return `<div class="product-card">
      <div class="product-image" id="productImg-${p.id}" style="height:200px;overflow:hidden;position:relative;">
        ${mediaContent}
        ${p.video && p.video.startsWith('data:video') ? '<div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.7);color:white;padding:4px 8px;border-radius:4px;font-size:0.8rem;z-index:5;">🎬 Video</div>' : ''}
      </div>
      <div class="product-info">
        <h3 class="product-title">${p.name}</h3>
        <p class="product-desc">${p.description ? p.description.substring(0, 60) + '...' : ''}</p>
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
    const selectEl = document.getElementById('variant-' + product.id);
    if (selectEl) {
      selectedVariant = selectEl.value;
      if (!selectedVariant) { alert('Silakan pilih varian terlebih dahulu!'); return null; }
    } else { selectedVariant = variantOptions[0]; }
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
  alert(`✅ ${product.name} ditambahkan ke keranjang`);
};

window.buyDirectly = function (productId, variantFromModal) {
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
  document.getElementById('ewalletTransferAmount').textContent = 'Rp ' + tempCartItem.price.toLocaleString('id-ID');
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
    const email = user.toLowerCase() + '@sadewa-admin.local';
    const userCredential = await signInWithEmailAndPassword(auth, email, pass).catch(err => {
      const fallbackCodes = ['auth/user-not-found', 'auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-email', 'auth/network-request-failed', 'auth/too-many-requests'];
      if (fallbackCodes.includes(err.code) || err.code?.startsWith('auth/')) {
        if (user === ADMIN_USER && pass === ADMIN_PASS) return { user: { uid: 'local-admin', email } };
      }
      throw err;
    });
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
    }
  } catch (error) {
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      currentUser = { uid: 'local-admin', email: user };
      adminAuthenticated = true;
      document.getElementById('loginUsername').value = '';
      document.getElementById('loginPassword').value = '';
      window.closeLoginModal();
      document.getElementById('mainWebsite').classList.remove('active');
      document.getElementById('adminPage').classList.add('active');
      renderAdminProductList();
      updateAdminStats();
      showAdminNotif('✅ Login berhasil');
    } else { showAdminNotif('❌ Username atau password salah!', true); }
  } finally {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Masuk'; }
  }
};

window.adminLogout = async function () {
  try {
    if (currentUser && currentUser.uid !== 'local-admin') await signOut(auth);
    currentUser = null; adminAuthenticated = false;
    document.getElementById('adminPage').classList.remove('active');
    document.getElementById('mainWebsite').classList.add('active');
    window.resetAdminForm();
    showAdminNotif('👋 Logout berhasil');
    // Pulihkan sesi tamu (anonymous) untuk buyer, karena signOut() di atas
    // ikut mencabut sesi anonymous (auth dipakai bersama admin & buyer).
    signInAnonymously(auth).catch((err) => console.error('Gagal memulihkan sesi anonymous:', err));
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
// CHAT SYSTEM
// ============================================================
let _buyerChatOpen = false;
let _acpActiveConvId = null;
let _allConvs = [];
let _adminChatUnread = 0;
let _buyerUnread = 0;
let _adminMsgUnsub = null;

// Ambil UID Firebase milik pengguna saat ini (buyer anonymous ATAU admin
// yang sedang login). Sinkron: kalau auth belum siap, akan mengembalikan null
// -- untuk kondisi ini, pakai _waitForBuyerUID() di bawah, bukan fungsi ini.
function _getBuyerSession() {
  return auth.currentUser ? auth.currentUser.uid : null;
}

// Tunggu sampai Firebase Auth benar-benar punya user (anonymous atau login),
// baru kasih UID-nya. Ini mencegah chat mencoba jalan sebelum UID siap
// (misalnya saat halaman baru saja dibuka, atau sesaat setelah admin logout
// ketika sesi anonymous baru sedang dibuatkan ulang).
function _waitForBuyerUID(timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (auth.currentUser) { resolve(auth.currentUser.uid); return; }
    let settled = false;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user && !settled) {
        settled = true;
        unsub();
        resolve(user.uid);
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        unsub();
        resolve(auth.currentUser ? auth.currentUser.uid : null);
      }
    }, timeoutMs);
  });
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
  const q2 = query(collection(db, 'sadewaChats', sid, 'messages'), orderBy('createdAt', 'asc'));
  onSnapshot(q2, snap => {
    const container = document.getElementById('bcwMessages');
    if (!container) return;
    container.innerHTML = '';
    snap.docs.forEach(d => _appendBuyerMsg(d.data(), container));
    if (_buyerChatOpen) { _scrollBcw(); _markBuyerRead(); }
    else {
      const newUnread = snap.docs.filter(d => d.data().sender === 'seller' && !d.data().readByBuyer).length;
      if (newUnread > _buyerUnread) _playNotifSound();
      _buyerUnread = newUnread; _updateBuyerBadge();
    }
  });
}

function _appendBuyerMsg(msg, container) {
  const sent = msg.sender === 'buyer';
  const div = document.createElement('div');
  div.className = 'bcw-msg ' + (sent ? 'sent' : 'recv');
  const content = msg.orderCard ? _buildOrderCard(msg.orderCard) : `<div class="bcw-bubble">${_esc(msg.text)}</div>`;
  div.innerHTML = content + `<div class="bcw-time">${sent ? 'Anda' : 'Sadewa'} · ${_fmtShort(msg.createdAt)}</div>`;
  container.appendChild(div);
}

async function _markBuyerRead() {
  const sid = await _waitForBuyerUID();
  if (!sid) return;
  try {
    const snap = await getDocs(query(collection(db, 'sadewaChats', sid, 'messages'), where('sender', '==', 'seller'), where('readByBuyer', '==', false)));
    snap.docs.forEach(async d => await updateDoc(doc(db, 'sadewaChats', sid, 'messages', d.id), { readByBuyer: true }));
  } catch (e) {}
}

window.sendBuyerMessage = async function () {
  const input = document.getElementById('bcwInput');
  const text = (input?.value || '').trim();
  if (!text) return;
  const btn = document.getElementById('bcwSendBtn');
  if (btn) btn.disabled = true;
  input.value = ''; input.style.height = 'auto';
  const sid = await _waitForBuyerUID();
  const name = _getBuyerName();
  if (!sid) {
    console.error('sendBuyerMsg: sesi buyer belum siap (Firebase Auth gagal/timeout).');
    if (input) input.value = text; // kembalikan teks yang tadi diketik, jangan sampai hilang
    if (btn) btn.disabled = false;
    return;
  }
  try {
    await setDoc(doc(db, 'sadewaChats', sid), { sessionId: sid, buyerName: name, lastMessage: text, lastMessageAt: serverTimestamp(), adminUnread: increment(1), updatedAt: serverTimestamp() }, { merge: true });
    await addDoc(collection(db, 'sadewaChats', sid, 'messages'), { text, sender: 'buyer', senderName: name, createdAt: serverTimestamp(), readByAdmin: false, readByBuyer: true });
  } catch (e) { console.error('sendBuyerMsg:', e); }
  finally { if (btn) btn.disabled = false; input?.focus(); }
};

window.afterPaymentSuccessChat = async function (items, total, method) {
  try {
    const sid = await _waitForBuyerUID();
    if (!sid) { console.error('afterPaymentSuccessChat: sesi buyer belum siap (Firebase Auth gagal/timeout).'); return; }
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
async function initChat() {
  const sid = await _waitForBuyerUID();
  if (sid) _listenBuyerMsgs(sid);
  else console.error('initChat: gagal mendapatkan UID Firebase (anonymous auth mungkin belum diaktifkan di Firebase Console, atau bermasalah).');
  const chatBtnEl = document.getElementById('chatBubbleBtn');
  if (chatBtnEl) chatBtnEl.style.display = 'flex';
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