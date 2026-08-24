// ============================================================
// Script.js — Sadewa Elektronik
// UI helpers: Welcome Modal, Chatbot AI, Auto-save Alamat,
// Chat Page System (buyer fullscreen chat)
// ============================================================

// ============================================================
// WELCOME MODAL
// ============================================================
var _wcTab = 0, _wcTotal = 4;

(function () {
  if (localStorage.getItem('sadewaSkipWelcome') === 'true') {
    var ov = document.getElementById('welcomeOverlay');
    if (ov) ov.style.display = 'none';
  }
})();

function switchWelcomeTab(index) {
  _wcTab = index;
  document.querySelectorAll('.welcome-panel').forEach(function (p, i) { p.classList.toggle('active', i === index); });
  document.querySelectorAll('.welcome-tab').forEach(function (t, i) { t.classList.toggle('active', i === index); });
  document.querySelectorAll('.welcome-dot').forEach(function (d, i) { d.classList.toggle('active', i === index); });
  var prev = document.getElementById('welcomePrevBtn');
  var next = document.getElementById('welcomeNextBtn');
  var start = document.getElementById('welcomeStartBtn');
  if (!prev || !next || !start) return;
  prev.style.display = index > 0 ? 'inline-flex' : 'none';
  if (index === _wcTotal - 1) { next.style.display = 'none'; start.style.display = 'inline-flex'; }
  else { next.style.display = 'inline-flex'; start.style.display = 'none'; }
}
function nextWelcomeTab() { if (_wcTab < _wcTotal - 1) switchWelcomeTab(_wcTab + 1); }
function prevWelcomeTab() { if (_wcTab > 0) switchWelcomeTab(_wcTab - 1); }
function closeWelcome() {
  var ov = document.getElementById('welcomeOverlay');
  var cb = document.getElementById('skipNextTime');
  if (cb && cb.checked) localStorage.setItem('sadewaSkipWelcome', 'true');
  if (!ov) return;
  ov.classList.add('hiding');
  setTimeout(function () { ov.style.display = 'none'; }, 500);
}

document.addEventListener('DOMContentLoaded', function () {
  var ov = document.getElementById('welcomeOverlay');
  if (ov) ov.addEventListener('click', function (e) { if (e.target === this) closeWelcome(); });
});

// ============================================================
// CHATBOT AI
// ============================================================
(function () {
  'use strict';

  function getProducts() { return window._sadewaProducts || []; }
  function escHtml(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function appendMsg(cls, html) {
    var log = document.getElementById('chatlog'); if (!log) return;
    var d = document.createElement('div'); d.className = 'message ' + cls; d.innerHTML = html;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }

  function appendChips(chips) {
    var log = document.getElementById('chatlog'); if (!log || !chips || !chips.length) return;
    var wrap = document.createElement('div'); wrap.className = 'chat-chips';
    chips.forEach(function (chip) {
      var btn = document.createElement('button'); btn.className = 'chat-chip'; btn.textContent = chip;
      btn.addEventListener('click', function () {
        document.querySelectorAll('.chat-chips').forEach(function (el) { el.remove(); });
        triggerSend(chip);
      });
      wrap.appendChild(btn);
    });
    log.appendChild(wrap); log.scrollTop = log.scrollHeight;
  }

  function showTyping() {
    var log = document.getElementById('chatlog'); if (!log) return;
    var d = document.createElement('div'); d.id = 'typingIndicator'; d.className = 'typing-indicator';
    d.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function hideTyping() { var el = document.getElementById('typingIndicator'); if (el) el.remove(); }

  function genReply(raw) {
    var products = getProducts(), q = raw.toLowerCase().trim();
    if (/^(halo|hai|hi|hello|hei|assalam|selamat|permisi|mau tanya|tes|test)/.test(q)) return { html: 'Halo! Selamat datang di <b>Sadewa Elektronik</b> ⚡<br>Ada yang bisa saya bantu?', chips: ['💡 Lampu', '💨 Kipas Angin', '🔌 Kabel', '🎛️ Saklar', '📡 Antena', '🔋 Stopkontak', '💰 Daftar Harga', '📍 Lokasi', '⏰ Jam Buka', '💳 Cara Bayar'] };
    if (/terima kasih|makasih|thanks/.test(q)) return { html: 'Sama-sama! 😊 Ada yang lain?', chips: ['💡 Lampu', '💨 Kipas Angin', '🔌 Kabel', '📍 Lokasi'] };
    if (/jam|buka|tutup|operasional/.test(q)) return { html: '⏰ <b>Jam Operasional:</b><br>Senin–Minggu: 08:00–20:00 WIB<br><br>Buka setiap hari!', chips: ['📍 Lokasi', '💬 WhatsApp', '💡 Lihat Produk'] };
    if (/lokasi|alamat|dimana|cidahu|maps/.test(q)) return { html: '📍 <b>Sadewa Elektronik:</b><br>Bojong-pari, Cidahu, West Java<br><a href="https://maps.app.goo.gl/GF1r9Dp8J8ZhPWfj7" target="_blank" style="color:var(--primary);">🗺️ Buka Google Maps</a>', chips: ['⏰ Jam Buka', '💬 WhatsApp', '💡 Lihat Produk'] };
    if (/whatsapp|wa |kontak|telepon|hubungi/.test(q)) return { html: '📱 <b>Kontak:</b><br>WhatsApp: <b>+62 858-7218-9172</b><br><a href="https://wa.me/+6285872189172" target="_blank" style="color:var(--primary);">💬 Chat Sekarang</a>', chips: ['📍 Lokasi', '⏰ Jam Buka'] };
    if (/bayar|pembayaran|transfer|gopay|ovo|dana|qris|bca|mandiri/.test(q)) return { html: '💳 <b>Metode Bayar:</b><br>💳 Kartu: Visa, Mastercard, Debit<br>🏦 Bank: BCA, Mandiri, BNI, BRI<br>📱 E-Wallet: GoPay, OVO, DANA, ShopeePay<br>📲 QRIS', chips: ['🛒 Cara Beli', '💡 Lihat Produk'] };
    if (/cara beli|cara pesan|gimana/.test(q)) return { html: '🛒 <b>Cara Beli:</b><br>1. Pilih produk<br>2. Pilih varian<br>3. Klik <b>Beli Sekarang</b><br>4. Pilih metode bayar<br>5. Detail terkirim ke WhatsApp!', chips: ['💳 Cara Bayar', '💡 Lampu', '💨 Kipas Angin'] };
    if (/^(daftar|semua|produk apa|ada apa|daftar harga)|^produk$|^semua produk$|^💰/.test(q)) {
      if (!products.length) return { html: 'Produk sedang dimuat...', chips: [] };
      var r = '📋 <b>Produk kami (' + products.length + ' item):</b><br><br>';
      products.slice(0, 10).forEach(function (p, i) { r += (i + 1) + '. ' + p.name + ' — <span style="color:var(--primary);font-weight:700;">Rp ' + p.price.toLocaleString('id-ID') + '</span><br>'; });
      if (products.length > 10) r += '<br>...dan ' + (products.length - 10) + ' lainnya.';
      return { html: r, chips: ['💡 Lampu', '💨 Kipas Angin', '🔌 Kabel', '🎛️ Saklar'] };
    }
    if (/rekomen|rekomendasi|saran|terbaik/.test(q)) {
      var catKw = { 'Lampu': ['lampu', 'led', 'bohlam', 'watt'], 'Kipas Angin': ['kipas', 'fan'], 'Kabel': ['kabel'], 'Saklar': ['saklar'], 'Stopkontak': ['stopkontak', 'colokan'] };
      var matched = null;
      for (var cat in catKw) { if (catKw[cat].some(function (k) { return q.indexOf(k) !== -1; })) { matched = cat; break; } }
      var pool = matched ? products.filter(function (p) { return p.category === matched; }) : products;
      if (!pool.length) return { html: 'Hubungi kami via <a href="https://wa.me/+6285872189172" target="_blank" style="color:var(--primary);">WhatsApp</a>.', chips: ['💬 WhatsApp'] };
      var r = '⭐ <b>Rekomendasi' + (matched ? ' ' + matched : '') + ':</b><br><br>';
      pool.slice(0, 3).forEach(function (p, i) { r += (i + 1) + '. <b>' + p.name + '</b><br>  💰 Rp ' + p.price.toLocaleString('id-ID') + '<br><br>'; });
      return { html: r, chips: ['🛒 Cara Beli', '💳 Cara Bayar'] };
    }
    var catMap = [
      { kw: '💡 lampu', cat: 'Lampu' }, { kw: 'lampu', cat: 'Lampu' },
      { kw: '💨 kipas angin', cat: 'Kipas Angin' }, { kw: 'kipas angin', cat: 'Kipas Angin' }, { kw: 'kipas', cat: 'Kipas Angin' },
      { kw: '🔌 kabel', cat: 'Kabel' }, { kw: 'kabel', cat: 'Kabel' },
      { kw: '🎛️ saklar', cat: 'Saklar' }, { kw: 'saklar', cat: 'Saklar' },
      { kw: '📡 antena', cat: 'Antena' }, { kw: 'antena', cat: 'Antena' },
      { kw: '🔋 stopkontak', cat: 'Stopkontak' }, { kw: 'stopkontak', cat: 'Stopkontak' },
      { kw: 'lainnya', cat: 'Lainnya' }
    ];
    for (var ci = 0; ci < catMap.length; ci++) {
      if (q.indexOf(catMap[ci].kw) !== -1) {
        var catName = catMap[ci].cat;
        var catProds = products.filter(function (p) { return p.category === catName; });
        if (!catProds.length) return { html: 'Belum ada produk <b>' + catName + '</b>. Hubungi <a href="https://wa.me/+6285872189172" target="_blank" style="color:var(--primary);">WhatsApp</a>.', chips: ['💬 WhatsApp'] };
        var r = '📦 <b>' + catName + ' (' + catProds.length + ' produk):</b><br><br>';
        catProds.forEach(function (p) {
          var icon = (p.media && p.media.startsWith('data:image')) ? '<img src="' + p.media + '" style="width:48px;height:36px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px;">' : '<span style="font-size:1.1rem;margin-right:6px;">' + (p.media || '⚡') + '</span>';
          r += '<div style="display:flex;align-items:center;padding:4px 0;border-bottom:1px dashed rgba(255,255,255,0.08);">' + icon + '<span><b>' + p.name + '</b> — <span style="color:var(--primary);">Rp ' + p.price.toLocaleString('id-ID') + '</span></span></div>';
        });
        return { html: r, chips: ['🛒 Cara Beli', '💳 Cara Bayar', '💬 WhatsApp'] };
      }
    }
    if (/harga/.test(q)) {
      var nm = products.find(function (p) { return q.indexOf(p.name.toLowerCase()) !== -1; });
      if (nm) return { html: '💰 <b>' + nm.name + '</b>: <span style="color:var(--primary);font-weight:800;">Rp ' + nm.price.toLocaleString('id-ID') + '</span>', chips: ['🛒 Cara Beli', '💳 Cara Bayar'] };
      return { html: 'Sebutkan nama produk. Contoh: <em>"harga lampu LED"</em>', chips: ['💡 Lampu', '💨 Kipas Angin'] };
    }
    var exact = products.find(function (p) { return q.indexOf(p.name.toLowerCase()) !== -1 || p.name.toLowerCase().indexOf(q) !== -1; });
    if (exact) {
      var icon2 = (exact.media && exact.media.startsWith('data:image')) ? '<img src="' + exact.media + '" style="width:110px;height:80px;object-fit:cover;border-radius:10px;display:block;margin:8px 0;">' : '<div style="font-size:2.5rem;margin:8px 0;">' + (exact.media || '⚡') + '</div>';
      return { html: '✅ <b>' + exact.name + '</b><br>' + icon2 + '💰 <span style="color:var(--primary);font-weight:800;">Rp ' + exact.price.toLocaleString('id-ID') + '</span><br>📦 Stok: ' + (exact.stock || 'Tersedia'), chips: ['🛒 Cara Beli', '💳 Cara Bayar', '💬 WhatsApp'] };
    }
    var partials = products.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1 || (p.description && p.description.toLowerCase().indexOf(q) !== -1); });
    if (partials.length) {
      var r = '🔍 <b>' + partials.length + ' produk</b>:<br><br>';
      partials.slice(0, 5).forEach(function (p) { r += '• <b>' + p.name + '</b> — Rp ' + p.price.toLocaleString('id-ID') + '<br>'; });
      return { html: r, chips: ['🛒 Cara Beli', '💬 WhatsApp'] };
    }
    return { html: 'Maaf, tidak ada info tentang "<b>' + escHtml(raw) + '</b>".', chips: ['💡 Lampu', '💨 Kipas Angin', '🔌 Kabel', '📍 Lokasi', '⏰ Jam Buka', '💳 Cara Bayar'] };
  }

  function triggerSend(text) {
    var inp = document.getElementById('userInput'), btn = document.getElementById('sendBtn');
    if (!text && inp) text = inp.value.trim(); if (!text) return;
    if (inp) inp.value = ''; if (btn) btn.disabled = true;
    appendMsg('user-message', '<b>Anda:</b><br>' + escHtml(text));
    showTyping();
    setTimeout(function () {
      hideTyping();
      var result = genReply(text);
      appendMsg('bot-message', '<b>Sadewa AI:</b><br>' + result.html);
      if (result.chips && result.chips.length) appendChips(result.chips);
      if (btn) btn.disabled = false;
      if (inp) inp.focus();
    }, 450 + Math.floor(Math.random() * 350));
  }

  window.handleSend = function () { triggerSend(null); };

  function initChatbot() {
    appendMsg('bot-message', '<b>Sadewa AI:</b><br>Halo! Selamat datang di <b>Sadewa Elektronik</b> ⚡<br>Pilih topik atau ketik pertanyaan:');
    appendChips(['💡 Lampu', '💨 Kipas Angin', '🔌 Kabel', '🎛️ Saklar', '📡 Antena', '🔋 Stopkontak', '💰 Daftar Harga', '📍 Lokasi', '⏰ Jam Buka', '💳 Cara Bayar']);
    var inp = document.getElementById('userInput');
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.handleSend(); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChatbot);
  else initChatbot();
})();

// ============================================================
// AUTO-SAVE ALAMAT PENGIRIMAN
// ============================================================
(function () {
  var STORAGE_KEY = 'sadewa_shipping_address_v1';
  var FIELDS = ['shipName', 'shipPhone', 'shipRegion', 'shipAddress', 'shipDetail', 'shipNote'];
  var saveTimer;

  function loadSavedAddress() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (!Object.keys(saved).length) return;
      FIELDS.forEach(function (fieldId) {
        var el = document.getElementById(fieldId);
        if (el && saved[fieldId]) el.value = saved[fieldId];
      });
      showAddressSavedBanner();
    } catch (e) {}
  }

  function saveAddress() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var data = {};
        FIELDS.forEach(function (fieldId) {
          var el = document.getElementById(fieldId);
          if (el) data[fieldId] = el.value;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {}
    }, 800);
  }

  function showAddressSavedBanner() {
    if (document.getElementById('addressAutoFillBanner')) return;
    var step1 = document.getElementById('checkoutStep1'); if (!step1) return;
    var banner = document.createElement('div');
    banner.id = 'addressAutoFillBanner';
    banner.style.cssText = 'background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);border-radius:10px;padding:0.75rem 1rem;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:0.75rem;font-size:0.88rem';
    banner.innerHTML = '<span style="color:#10b981;font-weight:700;">✅ Alamat diisi otomatis dari pembelian sebelumnya</span><button onclick="clearSavedAddress()" style="background:none;border:1px solid rgba(239,68,68,0.4);color:#ef4444;border-radius:6px;padding:3px 10px;font-size:0.78rem;font-weight:700;cursor:pointer;">✕ Hapus</button>';
    step1.insertBefore(banner, step1.firstChild);
  }

  window.clearSavedAddress = function () {
    localStorage.removeItem(STORAGE_KEY);
    FIELDS.forEach(function (fieldId) { var el = document.getElementById(fieldId); if (el) el.value = ''; });
    var banner = document.getElementById('addressAutoFillBanner'); if (banner) banner.remove();
  };

  function attachListeners() {
    FIELDS.forEach(function (fieldId) {
      var el = document.getElementById(fieldId);
      if (el) { el.addEventListener('input', saveAddress); el.addEventListener('change', saveAddress); }
    });
  }

  // Hook ke openPaymentModal
  var origOpenPaymentModal = window.openPaymentModal;
  window.openPaymentModal = function () {
    if (origOpenPaymentModal) origOpenPaymentModal.apply(this, arguments);
    setTimeout(function () { attachListeners(); loadSavedAddress(); }, 100);
  };

  document.addEventListener('DOMContentLoaded', attachListeners);
})();

// ============================================================
// CHAT PAGE SYSTEM (Buyer Fullscreen Chat)
// ============================================================
(function () {
  'use strict';

  function _esc(t) { return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }
  function _fmtTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date(), diff = now - d;
    if (diff < 60000) return 'Baru saja';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' mnt lalu';
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }

  let _cpOpen = false, _cpUnread = 0, _cpMsgUnsub = null;

  window._cpShowToast = function (msg) {
    const t = document.getElementById('cpToast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  };

  function _updateCpBadges() {
    const dot = document.getElementById('navChatDot');
    const mbnBadge = document.getElementById('mbnChatBadge');
    const bubbleBadge = document.getElementById('chatBubbleUnread');
    if (dot) {
      if (_cpUnread > 0) { dot.textContent = _cpUnread > 9 ? '9+' : _cpUnread; dot.classList.add('show'); }
      else dot.classList.remove('show');
    }
    if (mbnBadge) {
      if (_cpUnread > 0) { mbnBadge.textContent = _cpUnread; mbnBadge.classList.add('visible'); }
      else mbnBadge.classList.remove('visible');
    }
    if (bubbleBadge) {
      if (_cpUnread > 0) { bubbleBadge.textContent = _cpUnread; bubbleBadge.classList.add('visible'); }
      else bubbleBadge.classList.remove('visible');
    }
  }

  window.openChatPage = function () {
    const overlay = document.getElementById('chatPageOverlay'); if (!overlay) return;
    overlay.classList.add('active');
    _cpOpen = true; _cpUnread = 0; _updateCpBadges();
    document.body.style.overflow = 'hidden';
    _cpLoadMessages();
    setTimeout(() => {
      const area = document.getElementById('cpMessagesArea');
      if (area) area.scrollTop = area.scrollHeight;
      document.getElementById('cpInput')?.focus();
    }, 150);
  };

  window.closeChatPage = function () {
    const overlay = document.getElementById('chatPageOverlay'); if (!overlay) return;
    overlay.classList.remove('active');
    _cpOpen = false; document.body.style.overflow = '';
    _cpMarkRead();
  };

  window.addEventListener('popstate', function () {
    if (_cpOpen) { window.closeChatPage(); history.pushState(null, '', location.href); }
  });

  // Cache UID sebagai promise (bukan cuma variable) — dipanggil sekali per
  // page-load, hasilnya dipakai ulang. Auth Firebase biasanya sudah siap
  // JAUH sebelum buyer sempat klik chat, jadi dalam praktiknya promise ini
  // resolve hampir instan. Nunggu di sini TIDAK memblokir UI (lihat
  // cpSendMessage: pesan tetap langsung muncul di layar).
  let _cpSidPromise = null;
  function _cpGetSid() {
    if (!_cpSidPromise) {
      _cpSidPromise = (typeof window._sadewaGetBuyerUID === 'function')
        ? window._sadewaGetBuyerUID()
        : Promise.resolve(null);
    }
    return _cpSidPromise;
  }

  async function _cpLoadMessages() {
    const area = document.getElementById('cpMessagesArea'); if (!area) return;
    area.innerHTML = '<div class="cp-typing"><div class="cp-typing-dot"></div><div class="cp-typing-dot"></div><div class="cp-typing-dot"></div></div>';
    const sid = await _cpGetSid();
    if (!sid) { _cpShowEmpty(); return; }
    if (_cpMsgUnsub) { _cpMsgUnsub(); _cpMsgUnsub = null; }
    const tryLoad = function () {
      if (!window._sadewaDb) { setTimeout(tryLoad, 500); return; }
      const { collection, query, orderBy, onSnapshot } = window._sadewaFirestore;
      const db = window._sadewaDb;
      _cpMsgUnsub = onSnapshot(
        query(collection(db, 'sadewaChats', sid, 'messages'), orderBy('createdAt', 'asc')),
        function (snap) {
          const area2 = document.getElementById('cpMessagesArea'); if (!area2) return;
          if (!snap.docs.length) { _cpShowEmpty(); return; }
          area2.innerHTML = '';
          let lastDate = '';
          snap.docs.forEach(function (d) {
            const msg = d.data();
            const msgDate = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
            if (msgDate && msgDate !== lastDate) {
              lastDate = msgDate;
              const sep = document.createElement('div'); sep.className = 'cp-date-sep'; sep.textContent = msgDate;
              area2.appendChild(sep);
            }
            _cpAppendMsg(msg, area2);
          });
          if (_cpOpen) { area2.scrollTop = area2.scrollHeight; _cpMarkRead(); }
          else {
            const newUnread = snap.docs.filter(d => d.data().sender === 'seller' && !d.data().readByBuyer).length;
            if (newUnread > _cpUnread) window._cpShowToast('💬 Pesan baru dari Sadewa Elektronik!');
            _cpUnread = newUnread; _updateCpBadges();
          }
        }
      );
    };
    tryLoad();
  }

  function _cpShowEmpty() {
    const area = document.getElementById('cpMessagesArea'); if (!area) return;
    area.innerHTML = `<div class="cp-empty">
      <div class="cp-empty-icon">💬</div>
      <div class="cp-empty-title">Belum ada percakapan</div>
      <div class="cp-empty-desc">Mulai chat dengan admin kami<br>untuk bertanya tentang produk atau pesanan</div>
      <button class="cp-empty-start-btn" onclick="cpSendChip('Halo, saya ingin bertanya tentang produk')">👋 Mulai Chat</button>
    </div>`;
  }

  function _cpAppendMsg(msg, container) {
    const sent = msg.sender === 'buyer';
    const div = document.createElement('div'); div.className = 'cp-msg ' + (sent ? 'sent' : 'recv');
    let content = '';
    if (msg.orderCard) {
      const items = (msg.orderCard.items || []).map(i => `<div class="cp-order-item">• ${_esc(i.name)}${i.variant ? ` (${_esc(i.variant)})` : ''} ×${i.qty}</div>`).join('');
      content = `<div class="cp-order-card"><div class="cp-order-card-title">📞 Detail Pesanan</div>${items}<div class="cp-order-total">Total: Rp ${Number(msg.orderCard.total || 0).toLocaleString('id-ID')}</div><div class="cp-order-status">✓ Pesanan Dikonfirmasi</div></div>`;
    } else { content = `<div class="cp-bubble">${_esc(msg.text)}</div>`; }
    const timeStr = _fmtTime(msg.createdAt);
    div.innerHTML = content + `<div class="cp-msg-time">${sent ? 'Anda' : 'Sadewa'}${timeStr ? ' · ' + timeStr : ''}</div>`;
    container.appendChild(div);
  }

  async function _cpMarkRead() {
    const sid = await _cpGetSid();
    if (!sid || !window._sadewaDb) return;
    try {
      const { collection, query, where, getDocs, updateDoc, doc } = window._sadewaFirestore;
      const db = window._sadewaDb;
      const snap = await getDocs(query(collection(db, 'sadewaChats', sid, 'messages'), where('sender', '==', 'seller'), where('readByBuyer', '==', false)));
      snap.docs.forEach(async d => updateDoc(doc(db, 'sadewaChats', sid, 'messages', d.id), { readByBuyer: true }).catch(() => {}));
      _cpUnread = 0; _updateCpBadges();
    } catch (e) {}
  }

  window.cpSendMessage = async function () {
    const input = document.getElementById('cpInput');
    const text = (input?.value || '').trim(); if (!text) return;
    input.value = ''; input.style.height = 'auto';

    // OPTIMISTIC: tampilkan pesan buyer LANGSUNG di layar, tanpa nunggu
    // UID atau Firestore. Begitu listener realtime dapat data asli dari
    // server, tampilan otomatis "ditimpa" dengan versi resmi — buyer tidak
    // pernah melihat loading atau pesan gagal.
    const area = document.getElementById('cpMessagesArea');
    if (area) {
      if (area.querySelector('.cp-empty')) area.innerHTML = '';
      _cpAppendMsg({ text, sender: 'buyer', createdAt: null }, area);
      area.scrollTop = area.scrollHeight;
    }
    if (!_cpMsgUnsub) _cpLoadMessages();

    const sid = await _cpGetSid();
    if (!sid) { console.error('cpSendMessage: UID Firebase tidak tersedia.'); return; }
    await _cpDirectSend(sid, text);
  };

  async function _cpDirectSend(sid, text) {
    if (!window._sadewaDb) return;
    try {
      const { collection, addDoc, doc, setDoc, serverTimestamp, increment } = window._sadewaFirestore;
      const db = window._sadewaDb;
      const name = localStorage.getItem('sadewaBuyerName') || 'Pelanggan';
      await setDoc(doc(db, 'sadewaChats', sid), { sessionId: sid, buyerName: name, lastMessage: text, lastMessageAt: serverTimestamp(), adminUnread: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      await addDoc(collection(db, 'sadewaChats', sid, 'messages'), { text, sender: 'buyer', senderName: name, createdAt: serverTimestamp(), readByAdmin: false, readByBuyer: true });
    } catch (e) { console.error('cpDirectSend:', e); }
  }

  window.cpSendChip = function (text) { const input = document.getElementById('cpInput'); if (input) { input.value = text; window.cpSendMessage(); } };
  window.cpHandleKey = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.cpSendMessage(); } };
  window.cpAutoResize = function (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; };

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('chatBubbleBtn');
    if (btn) btn.style.display = 'flex';
    // Override toggleBuyerChat untuk membuka chatPage fullscreen
    window.toggleBuyerChat = function () {
      if (!_cpOpen) window.openChatPage();
      else window.closeChatPage();
    };
  });

})();

// ============================================================
// ANTI-COPY PROTECTION
// Mencegah user meng-copy/select teks di halaman secara kasual.
// CATATAN: ini deteren, bukan proteksi absolut — teks tetap ada
// di HTML sehingga user yang membuka "View Source"/DevTools tetap
// bisa membacanya.
//
// Elemen dengan class "selectable" DIKECUALIKAN dari proteksi ini
// (tetap bisa di-copy), contoh: <p class="selectable">0812-xxxx</p>
//
// Seluruh area Chatbot AI (widget kecil & chat page fullscreen) JUGA
// dikecualikan otomatis, supaya pengguna bebas mengetik, men-select,
// dan copy-paste di dalam chat tanpa terganggu proteksi ini.
// ============================================================
(function () {
  'use strict';

  var ALLOW_CLASS = 'selectable';

  // Selector elemen yang dikecualikan dari proteksi anti-copy.
  // Tambahkan selector baru di sini kalau ada area lain yang perlu dibebaskan.
  var ALLOW_SELECTORS = [
    '.' + ALLOW_CLASS,   // elemen manual yang ditandai class "selectable"
    '#chatlog',          // isi percakapan chatbot AI (widget kecil)
    '#userInput',        // kolom ketik chatbot AI (widget kecil)
    '#sendBtn',          // tombol kirim chatbot AI (widget kecil)
    '#chatPageOverlay',  // seluruh chat page fullscreen (buyer chat + admin)
    '#chatBubbleBtn'     // tombol bubble pembuka chat
  ];

  function isFormField(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function isAllowed(target) {
    if (!target) return false;
    // Semua form field (input/textarea/select/contenteditable) selalu
    // dikecualikan — user harus tetap bisa select/copy/cut teks yang
    // mereka ketik sendiri, di mana pun form itu berada.
    if (isFormField(target)) return true;
    if (!target.closest) return false;
    return ALLOW_SELECTORS.some(function (sel) { return target.closest(sel); });
  }

  // 1. Suntik CSS untuk menonaktifkan seleksi teks secara visual
  var allowCss = ALLOW_SELECTORS.map(function (sel) {
    return sel + ' {' +
      '  -webkit-user-select: text;' +
      '  -moz-user-select: text;' +
      '  -ms-user-select: text;' +
      '  user-select: text;' +
      '}';
  }).join('\n');

  var style = document.createElement('style');
  style.textContent =
    'body {' +
    '  -webkit-user-select: none;' +
    '  -moz-user-select: none;' +
    '  -ms-user-select: none;' +
    '  user-select: none;' +
    '}\n' + allowCss;
  document.head.appendChild(style);

  // 2. Blokir klik kanan (context menu)
  document.addEventListener('contextmenu', function (e) {
    if (!isAllowed(e.target)) e.preventDefault();
  });

  // 3. Blokir event select, copy, cut
  ['selectstart', 'copy', 'cut'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      if (!isAllowed(e.target)) e.preventDefault();
    });
  });

  // 4. Blokir shortcut keyboard: Ctrl/Cmd + C, X, A, U (view-source), S (save)
  document.addEventListener('keydown', function (e) {
    var ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (!ctrlOrCmd) return;
    var blockedKeys = ['c', 'x', 'a', 'u', 's'];
    if (blockedKeys.indexOf(e.key.toLowerCase()) !== -1 && !isAllowed(e.target)) {
      e.preventDefault();
    }
  });
})();