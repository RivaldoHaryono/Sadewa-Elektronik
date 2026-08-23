// ============================================================
// ongkir-integration.js — Sadewa Elektronik
// Fitur Cek Ongkir via Cloud Function proxy (RajaOngkir/Komerce)
// ============================================================

(function () {
  'use strict';

  // ---- KONFIGURASI (WAJIB DIISI) ----
  const CARI_KOTA_URL = "https://asia-southeast2-NAMA-PROJECT.cloudfunctions.net/cariKota";
  const CEK_ONGKIR_URL = "https://asia-southeast2-NAMA-PROJECT.cloudfunctions.net/cekOngkir";
  const ORIGIN_ID = "ID_KOTA_TOKO_CIDAHU"; // <-- ganti dengan ID hasil cariKota untuk Cidahu
  const DEFAULT_WEIGHT_GRAM = 1000;

  let destDebounce = null;

  function injectOngkirBox() {
    const wrap = document.getElementById('ongkirBoxWrap');
    if (!wrap || wrap.dataset.wired === 'true') return;
    wrap.dataset.wired = 'true';

    document.getElementById('shipDestSearch').addEventListener('input', onDestInput);
    document.getElementById('shipDestList').addEventListener('click', onDestPick);
    document.getElementById('cekOngkirBtn').addEventListener('click', cekOngkirSekarang);
  }

  async function onDestInput() {
    clearTimeout(destDebounce);
    const keyword = this.value.trim();
    const list = document.getElementById('shipDestList');
    if (keyword.length < 3) { list.style.display = 'none'; return; }

    destDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`${CARI_KOTA_URL}?keyword=${encodeURIComponent(keyword)}`);
        const data = await res.json();
        const items = data?.data || [];
        if (!items.length) { list.style.display = 'none'; return; }
        list.innerHTML = items
          .map((i) => `<div data-id="${i.id}" data-label="${i.label}">${i.label}</div>`)
          .join('');
        list.style.display = 'block';
      } catch (e) {
        console.error('Gagal cari lokasi:', e);
      }
    }, 400);
  }

  function onDestPick(e) {
    if (e.target.dataset.id) {
      document.getElementById('shipDestSearch').value = e.target.dataset.label;
      document.getElementById('shipDestId').value = e.target.dataset.id;
      this.style.display = 'none';
    }
  }

  function getCartWeightGram() {
    if (window._sadewaCart && Array.isArray(window._sadewaCart)) {
      const total = window._sadewaCart.reduce(
        (sum, item) => sum + (item.weight || DEFAULT_WEIGHT_GRAM) * (item.qty || 1),
        0
      );
      return total || DEFAULT_WEIGHT_GRAM;
    }
    return DEFAULT_WEIGHT_GRAM;
  }

  async function cekOngkirSekarang() {
    const destination = document.getElementById('shipDestId').value;
    const courier = document.getElementById('shipCourier').value;
    const resultBox = document.getElementById('ongkirResult');
    const btn = document.getElementById('cekOngkirBtn');

    if (!destination || !courier) {
      resultBox.innerHTML = `<div class="ongkir-error">Pilih kota tujuan (dari daftar saran) dan kurir dulu ya.</div>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Menghitung...';
    resultBox.innerHTML = `<div class="ongkir-loading">Menghitung ongkir...</div>`;

    try {
      const res = await fetch(CEK_ONGKIR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: ORIGIN_ID,
          destination,
          weight: getCartWeightGram(),
          courier,
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Gagal mengambil data ongkir');

      const options = data?.data?.[0]?.costs || data?.data || [];
      if (!options.length) {
        resultBox.innerHTML = `<div class="ongkir-error">Layanan tidak tersedia untuk rute ini. Coba kurir lain.</div>`;
        return;
      }

      resultBox.innerHTML = options
        .map(
          (opt, idx) => `
          <div class="ongkir-option" data-idx="${idx}">
            <span>${opt.service || courier.toUpperCase()} · Estimasi ${opt.etd || '-'} hari</span>
            <span class="ongkir-price">Rp${Number(opt.cost || 0).toLocaleString('id-ID')}</span>
          </div>`
        )
        .join('');

      resultBox.querySelectorAll('.ongkir-option').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = Number(el.dataset.idx);
          const opt = options[idx];
          selectShipping(opt, el);
        });
      });
    } catch (err) {
      resultBox.innerHTML = `<div class="ongkir-error">${err.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Hitung Ongkir';
    }
  }

  function selectShipping(opt, el) {
    document.querySelectorAll('.ongkir-option').forEach((o) => o.classList.remove('selected'));
    el.classList.add('selected');

    window.sadewaShipping = {
      cost: Number(opt.cost || 0),
      service: opt.service || '-',
      etd: opt.etd || '-',
    };

    document.dispatchEvent(
      new CustomEvent('sadewa:shippingSelected', { detail: window.sadewaShipping })
    );
  }

  // Pasang listener setiap kali modal checkout dibuka
  const origOpenPaymentModal = window.openPaymentModal;
  window.openPaymentModal = function () {
    if (origOpenPaymentModal) origOpenPaymentModal.apply(this, arguments);
    setTimeout(injectOngkirBox, 100);
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ongkirBoxWrap')) injectOngkirBox();
  });
})();