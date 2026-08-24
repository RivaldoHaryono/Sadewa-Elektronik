// ============================================================
// functions/index.js — Sadewa Elektronik
// Cloud Functions proxy untuk RajaOngkir (Komerce API)
// ============================================================

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const corsLib = require("cors")({ origin: true });

const RAJAONGKIR_KEY = defineSecret("RAJAONGKIR_KEY");
const REGION = "asia-southeast2";

// ---- GET /cariKota?keyword=... ----
// Cari ID kecamatan/kota tujuan berdasarkan kata kunci
exports.cariKota = onRequest(
  { region: REGION, secrets: [RAJAONGKIR_KEY] },
  (req, res) => {
    corsLib(req, res, async () => {
      try {
        const keyword = req.query.keyword;
        if (!keyword) {
          return res.status(400).json({ error: "Parameter 'keyword' wajib diisi" });
        }

        const url =
          "https://rajaongkir.komerce.id/api/v1/destination/domestic-destination" +
          `?search=${encodeURIComponent(keyword)}&limit=10&offset=0`;

        const apiRes = await fetch(url, {
          headers: { key: RAJAONGKIR_KEY.value() },
        });
        const data = await apiRes.json();

        if (!apiRes.ok) {
          return res
            .status(apiRes.status)
            .json({ error: data?.meta?.message || "Gagal mengambil data lokasi" });
        }

        const items = (data.data || []).map((item) => ({
          id: item.id,
          label:
            item.label ||
            [item.subdistrict_name, item.district_name, item.city_name, item.province_name]
              .filter(Boolean)
              .join(", "),
        }));

        return res.status(200).json({ data: items });
      } catch (err) {
        console.error("cariKota error:", err);
        return res.status(500).json({ error: "Terjadi kesalahan server" });
      }
    });
  }
);

// ---- POST /cekOngkir ----
// Body JSON: { origin, destination, weight, courier }
exports.cekOngkir = onRequest(
  { region: REGION, secrets: [RAJAONGKIR_KEY] },
  (req, res) => {
    corsLib(req, res, async () => {
      try {
        if (req.method !== "POST") {
          return res.status(405).json({ error: "Method tidak diizinkan" });
        }

        const { origin, destination, weight, courier } = req.body || {};
        if (!origin || !destination || !weight || !courier) {
          return res
            .status(400)
            .json({ error: "origin, destination, weight, dan courier wajib diisi" });
        }

        const body = new URLSearchParams({
          origin: String(origin),
          destination: String(destination),
          weight: String(weight),
          courier: String(courier),
          price: "lowest",
        });

        const apiRes = await fetch(
          "https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost",
          {
            method: "POST",
            headers: {
              key: RAJAONGKIR_KEY.value(),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          }
        );
        const data = await apiRes.json();

        if (!apiRes.ok) {
          return res
            .status(apiRes.status)
            .json({ error: data?.meta?.message || "Gagal menghitung ongkir" });
        }

        return res.status(200).json({ data: data.data || [] });
      } catch (err) {
        console.error("cekOngkir error:", err);
        return res.status(500).json({ error: "Terjadi kesalahan server" });
      }
    });
  }
);
