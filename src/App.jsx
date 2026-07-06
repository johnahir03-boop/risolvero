import { useState, useEffect, useRef } from "react";

// ── NOTIFICATIONS ────────────────────────────────────────
const NOTIF_KEY = "rslv_notif_time";

async function registerSW() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch(e) {}
  }
}

async function requestNotifPermission() {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch(e) { return false; }
}

function scheduleNotifications() {
  try {
    if (!("serviceWorker" in navigator)) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    navigator.serviceWorker.ready.then(reg => {
      if (!reg.active) return;
      const notifs = load("rslv_notifs", { habits:true, streak:true, finance:true });
      const reminderTime = load(NOTIF_KEY, "09:00");
      const parts = reminderTime.split(":");
      const hours = parseInt(parts[0]) || 9;
      const minutes = parseInt(parts[1]) || 0;
      const now = new Date();

      if (notifs.habits) {
        let next = new Date();
        next.setHours(hours, minutes, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        const delay = next - now;
        const habits = load("rslv_habits", []);
        if (habits.length > 0) {
          reg.active.postMessage({ type:"SCHEDULE_NOTIFICATION", title:"Risolvero", body:`${habits.length} habit${habits.length!==1?"s":""} waiting today!`, delay, tag:"daily-habit" });
        }
      }

      if (notifs.streak) {
        const streak = load("rslv_streak", 0);
        if (streak > 0) {
          let sr = new Date();
          sr.setHours(20, 0, 0, 0);
          if (sr <= now) sr.setDate(sr.getDate() + 1);
          reg.active.postMessage({ type:"SCHEDULE_NOTIFICATION", title:`${streak} day streak at risk!`, body:"Complete your habits to keep your streak.", delay: sr - now, tag:"streak" });
        }
      }

      if (notifs.finance) {
        const subs = load("rslv_subs", []);
        subs.filter(s => s.reminder).forEach(s => {
          try {
            const renewDate = new Date(s.nextDate);
            const twoDaysBefore = new Date(renewDate);
            twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);
            twoDaysBefore.setHours(9, 0, 0, 0);
            if (twoDaysBefore > now) {
              reg.active.postMessage({ type:"SCHEDULE_NOTIFICATION", title:`${s.name} renews in 2 days`, body:`${s.name} will charge you soon.`, delay: twoDaysBefore - now, tag:`sub-${s.id}` });
            }
          } catch(e) {}
        });
      }
    }).catch(e => {});
  } catch(e) {}
}
const SUPABASE_URL = "https://cmeimhnmpnzxguwmdghs.supabase.co";
const SUPABASE_KEY = "sb_publishable_vaMo5Vew20gPsY9JhTtOCQ_UEc9QiPA";

async function sb(path, options={}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) { const e = await res.json(); throw e; }
  if (res.status === 204) return null;
  return res.json();
}

async function sbAuth(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getUser(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` },
  });
  return res.json();
}

// Authenticated DB call (uses the logged-in user's token so RLS policies pass)
async function sbAuthed(path, token, options={}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw e; }
  if (res.status === 204) return null;
  return res.json();
}

// Upload an image file to Supabase Storage 'media' bucket, return its public URL
async function uploadImage(file, token, folder="uploads") {
  const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${path}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token}`,
      "Content-Type": file.type || "image/jpeg",
    },
    body: file,
  });
  if (!res.ok) { const e = await res.text().catch(()=>"upload failed"); throw new Error(e); }
  return `${SUPABASE_URL}/storage/v1/object/public/media/${path}`;
}

// Compress an image file before upload (keeps storage small, uploads fast)
function compressImage(file, maxDim=1200, quality=0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = height * maxDim / width; width = maxDim; }
        else if (height > maxDim) { width = width * maxDim / height; height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (!blob) return reject(new Error("compress failed"));
          const out = new File([blob], file.name || "image.jpg", { type:"image/jpeg" });
          resolve(out);
        }, "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const TODAY = () => new Date().toISOString().slice(0, 10);
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── LIGHT MODE ──────────────────────────
// Handled entirely via CSS in the <style> block (see #rslv-root.light rules).

/* Light mode is handled entirely via CSS overrides in the <style> block —
   far more reliable than walking the DOM at runtime. */



const Icons = {
  Home: ({ active }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={active?"currentColor":"none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1V10.5z"/>
      <path d="M9 21V12h6v9" fill="none"/>
    </svg>
  ),
  Fitness:   () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6.5 6.5h1.5v11H6.5zM16 6.5h1.5v11H16zM2 9.5h4v5H2zM18 9.5h4v5h-4zM8 12h8"/></svg>,
  Learning:  () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3L2 8l10 5 10-5-10-5z"/><path d="M6 10.6V16c0 0 2 2.4 6 2.4s6-2.4 6-2.4v-5.4"/></svg>,
  Finance:   () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v1.5M12 15.5V17M9 9.5C9 8.4 10.3 7.5 12 7.5s3 .9 3 2-1.3 2-3 2-3 .9-3 2 1.3 2 3 2 3-.9 3-2"/></svg>,
  Community: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="8" r="2.5"/><path d="M2 19c0-3.3 3.1-6 7-6s7 2.7 7 6"/><path d="M17 13c2.2 0 4 1.6 4 3.5"/></svg>,
  Check: () => <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3.5 3.5 5.5-6" stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  Plus:  () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  Trash: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>,
  Close: () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
  // ── settings line icons (replace emoji) ──
  Target: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>,
  Wallet: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v1"/><path d="M3 7v10a2 2 0 002 2h13a1 1 0 001-1v-3"/><path d="M21 11v4h-4a2 2 0 010-4h4z"/></svg>,
  Chart: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V4M4 20h16"/><rect x="7" y="12" width="3" height="5" rx="0.5"/><rect x="12" y="8" width="3" height="9" rx="0.5"/><rect x="17" y="5" width="3" height="12" rx="0.5"/></svg>,
  Sun: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/></svg>,
  Moon: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z"/></svg>,
  Flame: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c1 3.5 4.5 5 4.5 9a4.5 4.5 0 01-9 0c0-1.5.7-2.7 1.5-3.5C9 10 9 11.5 10 12c.5-2 1-4 2-9z"/></svg>,
  Bolt: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10.5H12l1-8.5z"/></svg>,
  Bell: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 004 0"/></svg>,
  Clock: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>,
  Refresh: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11A8 8 0 105.6 6.4L4 8"/><path d="M4 4v4h4"/></svg>,
  TrashLg: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>,
  Help: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>,
  Shield: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/></svg>,
  Star: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9L6.7 19.5l1.1-6L3.4 9.3l6-.8L12 3z"/></svg>,
  Phone: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>,
  Leaf: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 014 13c0-5 5-9 16-9 0 11-4 16-9 16z"/><path d="M9 16c2-4 5-6 8-7"/></svg>,
  Logout: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4H6a2 2 0 00-2 2v12a2 2 0 002 2h3"/><path d="M16 16l4-4-4-4M20 12H9"/></svg>,
  Heart: () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20s-7-4.5-9-9c-1.5-3.5 1-6.5 4-6.5 2 0 3.5 1.5 5 3.5 1.5-2 3-3.5 5-3.5 3 0 5.5 3 4 6.5-2 4.5-9 9-9 9z"/></svg>,
};

const PALETTE = [
  { bg:"#C8E6DA", text:"#1a3028", sub:"#4a7a65", check:"#2d6b52" },
  { bg:"#D8D0F0", text:"#1e1a2e", sub:"#6a5fa0", check:"#5a4d9a" },
  { bg:"#F5DDD0", text:"#2e1a10", sub:"#a06045", check:"#9a4f30" },
  { bg:"#F0E8D0", text:"#2a2010", sub:"#9a8050", check:"#8a6a30" },
  { bg:"#C8DFF0", text:"#0e1e30", sub:"#3a6a9a", check:"#2a5a8a" },
  { bg:"#F0D0D8", text:"#2e0e18", sub:"#a04060", check:"#8a2040" },
  { bg:"#D0EDF5", text:"#0e2028", sub:"#3a7a90", check:"#2a6a80" },
  { bg:"#EDD0F0", text:"#280e2e", sub:"#8a409a", check:"#7a2a8a" },
];

/* ═════════ THEME v3 — palette, icons, primitives ═════════ */
const FONT = "'Poppins',sans-serif";
const PAL = { or:"#FF6B2C", or2:"#FF8A3D", or3:"#FF5E1F", bl:"#3D8BFF", bl2:"#5AA2FF", bl3:"#2F80ED", gr:"#7ECB4F", gr2:"#8FD95F", gr3:"#5FB332", am:"#FFB324", am2:"#FFC24D", am3:"#F5A302", vi2:"#8E7BFF", vi3:"#6C4CF0", ro2:"#FF7FA6", ro3:"#F04C7F", ink:"#17181C", red:"#E5484D" };
const GRAD = { or:"linear-gradient(140deg,"+PAL.or2+","+PAL.or3+")", bl:"linear-gradient(140deg,"+PAL.bl2+","+PAL.bl3+")", gr:"linear-gradient(140deg,"+PAL.gr2+","+PAL.gr3+")", am:"linear-gradient(140deg,"+PAL.am2+","+PAL.am3+")", vi:"linear-gradient(140deg,"+PAL.vi2+","+PAL.vi3+")", ro:"linear-gradient(140deg,"+PAL.ro2+","+PAL.ro3+")", ink:"linear-gradient(140deg,#23242B,#17181C)" };
const THEME = (dark) => dark ? {
  dark:true, canvas:"#141519", card:"#1E1F25", chip:"#262730", sheet:"#1E1F25", input:"#262730",
  ink:"#FFFFFF", ink2:"#A0A3AE", ink3:"#6E7280",
  line:"#2A2B33", line2:"#34353F", track:"#2A2B33", dashed:"#34353F",
  overlay:"rgba(0,0,0,0.6)", shadow:"none",
} : {
  dark:false, canvas:"#F4F4F6", card:"#FFFFFF", chip:"#F1F1F4", sheet:"#FFFFFF", input:"#F1F1F4",
  ink:"#17181C", ink2:"#6E7280", ink3:"#9A9DA6",
  line:"#ECECF0", line2:"#E0E0E6", track:"#ECECF0", dashed:"#E0E0E6",
  overlay:"rgba(23,24,28,0.45)", shadow:"0 1px 3px rgba(23,24,28,.04), 0 10px 26px rgba(23,24,28,.06)",
};
const ISVG = {
  home:<><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/></>,
  fit:<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>,
  book:<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
  wallet:<><path d="M19 7V5H6a2 2 0 0 0 0 4h13a1 1 0 0 1 1 1v3"/><path d="M4 7v11a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3"/><path d="M17 12.5a1.5 1.5 0 0 0 0 3H21v-3h-4z"/></>,
  user:<><circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-3.8 3.3-6.5 7.5-6.5s7.5 2.7 7.5 6.5"/></>,
  flame:<><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3 2.5.5 5 2.2 5 5a5 5 0 1 1-10 0c0-1.5.5-2.5 1-3.5.3 1 .8 1.5 1.5 2z"/><path d="M12 2c1.5 2.5 3.7 4.6 5 7 1 1.9 1.5 3.3 1.5 5"/></>,
  drop:<path d="M12 3s6 6.7 6 11a6 6 0 0 1-12 0c0-4.3 6-11 6-11z"/>,
  fork:<><path d="M7 3v6a2.5 2.5 0 0 0 5 0V3M9.5 3v18"/><path d="M17 3c1.8 1.8 1.8 6.2 0 8v10"/></>,
  cam:<><rect x="3" y="7" width="18" height="13" rx="3.5"/><circle cx="12" cy="13.2" r="3.4"/><path d="M8.5 7l1.4-2.6h4.2L15.5 7"/></>,
  gear:<><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.2-1.6l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.8-1.6L13.3 2h-2.6l-.4 2.9A7 7 0 0 0 7.5 6.5l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .5.1 1.1.2 1.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.8 1.6l.4 2.9h2.6l.4-2.9a7 7 0 0 0 2.8-1.6l2.3 1 2-3.4-2-1.5c.1-.5.2-1.1.2-1.6z"/></>,
  target:<><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></>,
  chart:<path d="M4.5 20V12M12 20V4.5M19.5 20v-6"/>,
  check:<path d="M4.5 12.5l5 5L20 6.5"/>,
  plus:<path d="M12 5v14M5 12h14"/>,
  minus:<path d="M5 12h14"/>,
  sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/></>,
  moon:<path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3.5a8.5 8.5 0 1 0 10 10z"/>,
  coins:<><circle cx="9" cy="9" r="6"/><path d="M14.2 6.2a6 6 0 1 1-8 8"/><path d="M9 6.5v5M6.8 9h4.4"/></>,
  bell:<><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></>,
  clock:<><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>,
  star:<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>,
  chat:<path d="M21 12a8 8 0 0 1-8 8H4l2-3.2A8 8 0 1 1 21 12z"/>,
  globe:<><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.2 3.8 8.5s-1.3 6.2-3.8 8.5c-2.5-2.3-3.8-5.2-3.8-8.5S9.5 5.8 12 3.5z"/></>,
  info:<><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.4"/></>,
  heart:<path d="M12 20s-7.5-4.6-9.3-9A5 5 0 0 1 12 7a5 5 0 0 1 9.3 4c-1.8 4.4-9.3 9-9.3 9z"/>,
  chev:<path d="M9.5 6l6 6-6 6"/>,
  back:<path d="M14.5 6l-6 6 6 6"/>,
  sound:<><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/></>,
  puzzle:<><rect x="3.5" y="3.5" width="7.2" height="7.2" rx="2.2"/><rect x="13.3" y="3.5" width="7.2" height="7.2" rx="2.2"/><rect x="3.5" y="13.3" width="7.2" height="7.2" rx="2.2"/><rect x="13.3" y="13.3" width="7.2" height="7.2" rx="2.2"/></>,
  trash:<><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/></>,
  close:<path d="M6 6l12 12M18 6L6 18"/>,
  pen:<><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/><path d="M14.5 6.5l3 3"/></>,
  leaf:<><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19c3-3 6-5 10-6"/></>,
  run:<><circle cx="14.5" cy="4.5" r="1.8"/><path d="M9 20.5l2.2-4.5-2.5-2 3-4.5 3 2 3.3-1"/><path d="M6 13.5l2.7-4 4-1 2.5 3"/></>,
  search:<><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></>,
  logout:<><path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9"/><path d="M15 8l4 4-4 4M19 12H9"/></>,
  refresh:<><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 3v4h-4"/></>,
};
const Ic = ({ n, s=22, sw=2, style }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>{ISVG[n]||ISVG.target}</svg>
);
const tints = (T) => ({
  or:{bg:"rgba(255,107,44,.13)",fg:PAL.or}, bl:{bg:"rgba(61,139,255,.13)",fg:T.dark?PAL.bl2:PAL.bl3},
  gr:{bg:"rgba(126,203,79,.16)",fg:T.dark?PAL.gr2:"#569B2B"}, am:{bg:"rgba(255,179,36,.18)",fg:T.dark?PAL.am2:"#C7830A"},
  vi:{bg:"rgba(124,92,255,.14)",fg:T.dark?PAL.vi2:PAL.vi3}, ro:{bg:"rgba(240,76,127,.13)",fg:T.dark?PAL.ro2:PAL.ro3},
  ink:{bg:T.chip,fg:T.ink}, red:{bg:"rgba(229,72,77,.12)",fg:PAL.red},
});
const Chip = ({ n, c="or", T, size=38, is=19, style, onClick }) => { const t=tints(T)[c]||tints(T).or; return (
  <div onClick={onClick} style={{ width:size, height:size, borderRadius:Math.round(size*0.37), background:t.bg, color:t.fg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, cursor:onClick?"pointer":undefined, ...style }}><Ic n={n} s={is}/></div>
);};
const Ring = ({ pct=0, size=126, stroke=9, T, knob=true, over=false, children }) => {
  const R=55, C=2*Math.PI*R, p=Math.max(0,Math.min(100,pct));
  return (
    <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} viewBox="0 0 126 126" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="63" cy="63" r={R} fill="none" stroke={T.track} strokeWidth="4" strokeDasharray="1.5 7" strokeLinecap="round"/>
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={PAL.or2}/><stop offset="1" stopColor={PAL.or3}/></linearGradient></defs>
        <circle cx="63" cy="63" r={R} fill="none" stroke={over?PAL.red:"url(#ringGrad)"} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={(C*p/100)+" "+C} style={{ transition:"stroke-dasharray .6s cubic-bezier(.22,1,.36,1)" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>{children}</div>
    </div>
  );
};
function useCountUp(target, dur=600) {
  const [val,setVal]=useState(target);
  const ref=useRef(target);
  useEffect(()=>{
    const from=ref.current, to=target, start=performance.now();
    if(from===to){ return; }
    let raf;
    const tick=(now)=>{
      const t=Math.min(1,(now-start)/dur);
      const eased=1-Math.pow(1-t,3);
      const cur=from+(to-from)*eased;
      setVal(cur);
      if(t<1){ raf=requestAnimationFrame(tick); } else { ref.current=to; setVal(to); }
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[target,dur]);
  return val;
}
const CountUp = ({ value, dur=600 }) => {
  const v=useCountUp(value,dur);
  return <>{Math.round(v)}</>;
};
const Sheet = ({ T, onClose, children }) => {
  useEffect(()=>{
    const y = window.scrollY;
    const b = document.body;
    const prev = { position:b.style.position, top:b.style.top, width:b.style.width, overflow:b.style.overflow };
    b.style.position="fixed"; b.style.top=`-${y}px`; b.style.width="100%"; b.style.overflow="hidden";
    return ()=>{
      b.style.position=prev.position; b.style.top=prev.top; b.style.width=prev.width; b.style.overflow=prev.overflow;
      window.scrollTo(0, y);
    };
  }, []);
  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:T.overlay, backdropFilter:"blur(3px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:T.sheet, borderRadius:"30px 30px 0 0", padding:"18px 20px calc(40px + env(safe-area-inset-bottom))", animation:"sheetUp 0.3s ease both", maxHeight:"88dvh", display:"flex", flexDirection:"column", boxShadow:T.dark?"none":"0 -8px 40px rgba(23,24,28,.12)" }}>
        <div style={{ width:38, height:4, borderRadius:3, background:T.line2, margin:"0 auto 16px", flexShrink:0 }}/>
        <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", minHeight:0, overscrollBehavior:"contain" }}>{children}</div>
      </div>
    </div>
  );
};
const SecHead = ({ T, children, right, mt=18 }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", margin:mt+"px 2px 10px" }}>
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.13em", textTransform:"uppercase", color:T.ink3, fontFamily:FONT }}>{children}</div>
    {right}
  </div>
);
const CTA = ({ children, onClick, disabled, T, style }) => (
  <button onClick={onClick} disabled={disabled} style={{ width:"100%", border:"none", background:disabled?T.chip:GRAD.or, color:disabled?T.ink3:"#fff", borderRadius:18, padding:"16px", fontSize:15, fontWeight:700, fontFamily:FONT, cursor:disabled?"not-allowed":"pointer", boxShadow:disabled?"none":"0 10px 24px rgba(255,94,31,.3)", ...style }}>{children}</button>
);
const Field = ({ T, label, children }) => (
  <div style={{ marginBottom:13 }}>
    <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.ink3, fontFamily:FONT, marginBottom:7 }}>{label}</div>
    {children}
  </div>
);
const inputStyle = (T, big) => ({ width:"100%", background:T.input, border:"none", borderRadius:16, padding: big?"13px 16px":"12px 14px", color:T.ink, fontSize: big?22:14.5, fontWeight: big?800:600, fontFamily:FONT, outline:"none" });
const ICON_OPTIONS = ["sun","run","book","drop","fit","fork","coins","target","pen","moon","heart","leaf","flame","puzzle","chart","globe"];
const EMOJI2ICON = {"🏃":"run","📖":"book","💧":"drop","💰":"coins","🧘":"heart","🥗":"fork","💪":"fit","🚴":"run","✍️":"pen","🎯":"target","🌅":"sun","🛌":"moon","🧠":"puzzle","🎨":"pen","🎸":"pen","📝":"pen","🚶":"run","🍎":"fork","☀️":"sun","🌿":"leaf"};
const habitIcon = (h) => (h && (h.icon || EMOJI2ICON[h.emoji])) || "target";
const HCOLORS = ["or","bl","gr","am","vi","ro"];
const JARMETA = { necessities:{c:"bl",icon:"home",grad:GRAD.bl}, savings:{c:"gr",icon:"coins",grad:GRAD.gr}, education:{c:"am",icon:"book",grad:GRAD.am}, play:{c:"or",icon:"star",grad:GRAD.or}, freedom:{c:"ink",icon:"chart",grad:GRAD.ink}, give:{c:"ro",icon:"heart",grad:GRAD.ro} };
const MEALMETA = { breakfast:{icon:"sun",c:"am",grad:GRAD.am}, lunch:{icon:"fork",c:"or",grad:GRAD.or}, dinner:{icon:"moon",c:"bl",grad:GRAD.bl}, snacks:{icon:"heart",c:"gr",grad:GRAD.gr} };
const speak = (text, langCode) => { try { const u=new SpeechSynthesisUtterance(text); const M={es:"es-ES",fr:"fr-FR",it:"it-IT",de:"de-DE",pt:"pt-BR",ar:"ar-SA",ja:"ja-JP",zh:"zh-CN",hi:"hi-IN",ru:"ru-RU"}; u.lang=M[langCode]||"en-US"; u.rate=0.85; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch(e){} };
/* ═════════ end theme v3 ═════════ */


function Tick({ color, size=14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5l5 5L20 6.5"/></svg>;
}

function AddHabitModal({ onAdd, onClose, T }) {
  const [name,setName]=useState("");
  const [icon,setIcon]=useState("target");
  const submit=()=>{ if(!name.trim())return; onAdd({name:name.trim(),icon}); onClose(); };
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
        <div style={{ fontSize:22, fontWeight:800, color:T.ink, fontFamily:FONT, letterSpacing:"-0.01em" }}>New habit</div>
        <Chip n="close" c="ink" T={T} size={36} is={16} onClick={onClose}/>
      </div>
      <Field T={T} label="Name">
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="e.g. Morning walk" style={inputStyle(T,true)}/>
      </Field>
      <Field T={T} label="Icon">
        <div style={{ display:"flex", flexWrap:"wrap", gap:9 }}>
          {ICON_OPTIONS.map(ic=>(
            <div key={ic} onClick={()=>setIcon(ic)} style={{ borderRadius:16, outline:icon===ic?("2px solid "+PAL.or):"none", outlineOffset:2 }}>
              <Chip n={ic} c={icon===ic?"or":"ink"} T={T} size={44} is={20}/>
            </div>
          ))}
        </div>
      </Field>
      <div style={{ height:6 }}/>
      <CTA T={T} disabled={!name.trim()} onClick={submit}>Add habit</CTA>
    </Sheet>
  );
}

function HabitCard({ habit, idx, done, pts, onToggle, onDelete, delay, T }) {
  const [holding,setHolding]=useState(false);
  const holdTimer=useRef(null);
  const startHold=()=>{ holdTimer.current=setTimeout(()=>setHolding(true),600); };
  const endHold=()=>{ clearTimeout(holdTimer.current); };
  const c=HCOLORS[idx%HCOLORS.length];
  const doneFg={or:PAL.or3,bl:PAL.bl3,gr:PAL.gr3,am:PAL.am3,vi:PAL.vi3,ro:PAL.ro3}[c];
  return (
    <div style={{ position:"relative" }}>
      <div onClick={()=>!holding&&onToggle()} onMouseDown={startHold} onMouseUp={endHold} onMouseLeave={endHold} onTouchStart={startHold} onTouchEnd={endHold}
        style={{ background:done?GRAD[c]:T.card, border:done?"none":("1px solid "+T.line), borderRadius:20, padding:"13px", minHeight:104, display:"flex", flexDirection:"column", justifyContent:"space-between", cursor:"pointer", animation:"cardIn 0.4s ease "+delay+"s both", boxShadow:done?"none":T.shadow, transition:"transform .15s" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          {done
            ? <div style={{ width:38, height:38, borderRadius:14, background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={habitIcon(habit)} s={19}/></div>
            : <Chip n={habitIcon(habit)} c={c} T={T}/>}
          <div style={{ width:24, height:24, borderRadius:"50%", background:done?"#fff":"transparent", border:done?"none":("1.6px solid "+T.line2), display:"flex", alignItems:"center", justifyContent:"center" }}>{done&&<Tick color={doneFg} size={13}/>}</div>
        </div>
        <div>
          <div style={{ fontSize:13.5, fontWeight:700, lineHeight:1.15, letterSpacing:"-0.01em", color:done?"#fff":T.ink, fontFamily:FONT, marginTop:8 }}>{habit.name}</div>
          <div style={{ fontSize:10.5, fontWeight:600, color:done?"rgba(255,255,255,.78)":T.ink3, fontFamily:FONT, marginTop:3 }}>+{pts} pts</div>
        </div>
      </div>
      {holding&&(
        <button onClick={e=>{e.stopPropagation();onDelete();setHolding(false);}} onMouseLeave={()=>setHolding(false)} style={{ position:"absolute", inset:0, borderRadius:20, background:PAL.red, border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, color:"#fff", animation:"fadeIn 0.15s ease both" }}>
          <Ic n="trash" s={20}/><span style={{ fontSize:12, fontWeight:700, fontFamily:FONT }}>Remove</span>
        </button>
      )}
    </div>
  );
}

function HomePage({ onNavigate=()=>{}, darkMode=true }) {
  const T=THEME(darkMode);
  const hr=new Date().getHours();
  const greeting=hr<5?"Good night":hr<12?"Good morning":hr<17?"Good afternoon":hr<21?"Good evening":"Good night";
  const displayName=load("rslv_display_name","");
  const [habits,setHabits]=useState(()=>load("rslv_habits",[]));
  const [done,setDone]=useState(()=>{ const s=load("rslv_done",{date:"",checked:{}}); return s.date===TODAY()?s.checked:{}; });
  const [streak,setStreak]=useState(()=>load("rslv_streak",0));
  const [showAdd,setShowAdd]=useState(false);
  const [activeActions,setActiveActions]=useState(()=>load("rslv_quick_actions",["learn","logfood","water","expense"]));
  const [editMode,setEditMode]=useState(false);
  useEffect(()=>{ save("rslv_habits",habits); },[habits]);
  useEffect(()=>{ save("rslv_done",{date:TODAY(),checked:done}); },[done]);
  const pts=habits.length>0?Math.floor(100/habits.length):0;
  const doneCount=habits.filter(h=>done[h.id]).length;
  const score=habits.length===0?0:doneCount===habits.length?100:doneCount*pts;
  const addHabit=({name,icon})=>{ setHabits(p=>[...p,{id:Date.now().toString(),name,icon}]); };
  const deleteHabit=id=>{ setHabits(p=>p.filter(h=>h.id!==id)); setDone(p=>{const n={...p};delete n[id];return n;}); };
  const toggle=id=>{ setDone(p=>{ const next={...p,[id]:!p[id]}; const allDone=habits.length>0&&habits.every(h=>next[h.id]); if(allDone && load("rslv_last_complete_date","")!==TODAY()){ save("rslv_last_complete_date",TODAY()); setStreak(s=>{const ns=s+1;save("rslv_streak",ns);return ns;}); } return next; }); };
  const leftCount=habits.length-doneCount;
  const subline=habits.length===0?"A fresh day. Add your first habit.":doneCount===0?"A fresh day. Pick your first habit.":doneCount===habits.length?"Perfect day. You showed up.":doneCount+" of "+habits.length+" habits done. Keep going.";
  const hint=habits.length===0?"Your growth starts with one habit.":doneCount===habits.length?"Every habit done. Strong work.":"Finish "+leftCount+" more habit"+(leftCount===1?"":"s")+" to reach 100.";
  const ALL_ACTIONS=[
    {id:"learn",icon:"book",c:"gr",label:"Learn words",tab:"learning"},
    {id:"logfood",icon:"fork",c:"am",label:"Log food",tab:"fitness"},
    {id:"water",icon:"drop",c:"bl",label:"Log water",tab:"fitness"},
    {id:"expense",icon:"coins",c:"am",label:"Add expense",tab:"finance"},
    {id:"habit",icon:"target",c:"or",label:"Add habit",tab:"home"},
    {id:"workout",icon:"fit",c:"gr",label:"Log workout",tab:"fitness"},
    {id:"finance",icon:"chart",c:"gr",label:"View finance",tab:"finance"},
    {id:"subscription",icon:"clock",c:"vi",label:"Subscriptions",tab:"finance"},
    {id:"profile",icon:"gear",c:"ink",label:"Settings",tab:"profile"},
    {id:"barcode",icon:"cam",c:"or",label:"Scan barcode",tab:"fitness"},
  ];
  const saveActions=ids=>{ setActiveActions(ids); save("rslv_quick_actions",ids); };
  const toggleAction=id=>{ if(activeActions.includes(id)){ if(activeActions.length>1) saveActions(activeActions.filter(x=>x!==id)); } else { if(activeActions.length<4) saveActions([...activeActions,id]); } };
  const visibleActions=ALL_ACTIONS.filter(a=>activeActions.includes(a.id));
  return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <div style={{ fontSize:25, fontWeight:800, letterSpacing:"-0.02em", lineHeight:1.15, color:T.ink }}>{greeting}, <span style={{ color:PAL.or }}>{displayName||"friend"}</span></div>
      <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, marginTop:6 }}>{subline}</div>

      <div style={{ background:T.card, borderRadius:26, padding:"18px 20px", margin:"14px 0 4px", display:"flex", alignItems:"center", gap:16, border:"1px solid "+T.line, boxShadow:T.shadow, animation:"fadeUp .4s ease both" }}>
        <Ring pct={score} size={118} T={T}>
          <div style={{ fontSize:32, fontWeight:800, letterSpacing:"-0.03em", lineHeight:1, color:T.ink, fontFamily:FONT }}><CountUp value={score}/></div>
          <div style={{ fontSize:10, fontWeight:600, color:T.ink3, marginTop:3, fontFamily:FONT }}>of 100</div>
        </Ring>
        <div>
          <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.13em", textTransform:"uppercase", color:T.ink3, marginBottom:6 }}>Growth score</div>
          <div style={{ fontSize:15, fontWeight:700, color:T.ink }}>{score===100?"Perfect day":score>=60?"Strong day so far":score>0?"Getting going":"Fresh start"}</div>
          <div style={{ fontSize:11.5, color:T.ink2, fontWeight:500, marginTop:4, lineHeight:1.5 }}>{hint}</div>
        </div>
      </div>

      <SecHead T={T} right={
        <div onClick={()=>setShowAdd(true)} style={{ width:30, height:30, borderRadius:"50%", background:darkMode?"#fff":PAL.ink, color:darkMode?PAL.ink:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="plus" s={14} sw={2.6}/></div>
      }>Today's habits</SecHead>
      {habits.length===0?(
        <div onClick={()=>setShowAdd(true)} style={{ padding:"34px 22px", textAlign:"center", background:T.card, borderRadius:24, border:"1px dashed "+T.dashed, cursor:"pointer" }}>
          <div style={{ fontSize:17, fontWeight:800, color:T.ink, marginBottom:6 }}>Add your first habit</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, lineHeight:1.6 }}>Small steps, every day. Tap to begin.</div>
        </div>
      ):(
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {habits.map((h,i)=><HabitCard key={h.id} habit={h} idx={i} done={!!done[h.id]} pts={pts} onToggle={()=>toggle(h.id)} onDelete={()=>deleteHabit(h.id)} delay={0.05+i*0.04} T={T}/>)}
        </div>
      )}

      <SecHead T={T} right={
        <div onClick={()=>setEditMode(e=>!e)} style={{ display:"flex", alignItems:"center", gap:6, background:editMode?GRAD.or:(darkMode?"#fff":PAL.ink), color:editMode?"#fff":(darkMode?PAL.ink:"#fff"), borderRadius:999, padding:"7px 13px 7px 9px", cursor:"pointer" }}>
          <Ic n={editMode?"check":"plus"} s={13} sw={2.6}/><span style={{ fontSize:11.5, fontWeight:700, fontFamily:FONT }}>{editMode?"Done":"Add"}</span>
        </div>
      }>Quick actions</SecHead>
      {editMode?(
        <div>
          <div style={{ fontSize:12, color:T.ink3, fontFamily:FONT, fontWeight:500, marginBottom:10 }}>Pick up to 4 ({activeActions.length}/4)</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {ALL_ACTIONS.map(a=>{ const sel=activeActions.includes(a.id); return (
              <div key={a.id} onClick={()=>toggleAction(a.id)} style={{ background:T.card, border:sel?("1.6px solid "+PAL.or):("1px solid "+T.line), borderRadius:16, padding:"10px 11px", display:"flex", alignItems:"center", gap:9, cursor:"pointer", boxShadow:T.shadow }}>
                <Chip n={a.icon} c={sel?"or":a.c} T={T} size={30} is={15}/>
                <span style={{ fontSize:12, fontWeight:700, color:T.ink, fontFamily:FONT, flex:1 }}>{a.label}</span>
                {sel&&<div style={{ width:16, height:16, borderRadius:"50%", background:PAL.or, display:"flex", alignItems:"center", justifyContent:"center" }}><Tick color="#fff" size={9}/></div>}
              </div>
            );})}
          </div>
        </div>
      ):(
        <div style={{ display:"flex", flexWrap:"wrap", gap:9 }}>
          {visibleActions.map(a=>(
            <div key={a.id} onClick={()=>{ if(a.id==="habit") setShowAdd(true); else onNavigate(a.tab); }} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 15px 8px 8px", borderRadius:999, background:T.card, border:"1px solid "+T.line, cursor:"pointer", boxShadow:T.shadow }}>
              <Chip n={a.icon} c={a.c} T={T} size={30} is={15} style={{ borderRadius:"50%" }}/>
              <span style={{ fontSize:12.5, fontWeight:600, color:T.ink, fontFamily:FONT, whiteSpace:"nowrap" }}>{a.label}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background:darkMode?T.card:PAL.ink, border:darkMode?("1px solid "+T.line):"none", borderRadius:26, padding:"20px", marginTop:18, display:"flex", justifyContent:"space-between", alignItems:"center", animation:"fadeUp .4s ease .1s both" }}>
        <div>
          <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,255,255,.45)", fontFamily:FONT }}>Current streak</div>
          <div style={{ display:"flex", alignItems:"baseline", gap:8, marginTop:6 }}>
            <div style={{ fontSize:52, fontWeight:800, color:"#fff", letterSpacing:"-0.03em", lineHeight:1, fontFamily:FONT }}>{streak}</div>
            <div style={{ fontSize:14, fontWeight:600, color:PAL.or2, fontFamily:FONT }}>days</div>
          </div>
          <div style={{ fontSize:11.5, color:"rgba(255,255,255,.45)", fontWeight:500, marginTop:6, fontFamily:FONT }}>{streak===0?"Finish all habits to start it.":"Don't break the chain."}</div>
        </div>
        <div style={{ width:52, height:52, borderRadius:"50%", background:GRAD.or, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0 }}><Ic n="flame" s={22}/></div>
      </div>

      {showAdd&&<AddHabitModal onAdd={addHabit} onClose={()=>setShowAdd(false)} T={T}/>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   FINANCE PAGE
───────────────────────────────────────────── */
const JARS = [
  { key:"necessities", label:"Necessities", emoji:"🏠", pct:0.55, color:"#C8E6DA", text:"#1a3028",
    desc:"Your biggest jar. Covers everything you need to live — rent, food, transport, bills, health. If this jar runs out before the month ends, your lifestyle costs are too high." ,
    examples:"Rent, groceries, electricity, water, internet, phone bill, transport, medicine." },
  { key:"savings",     label:"Savings",     emoji:"🏦", pct:0.10, color:"#C8DFF0", text:"#0e1e30",
    desc:"This money is yours forever. Never touch it unless it is a true emergency. Over time this jar becomes your security — the thing that lets you sleep at night.",
    examples:"Bank transfer, emergency fund, long-term savings account." },
  { key:"education",   label:"Education",   emoji:"📚", pct:0.10, color:"#D8D0F0", text:"#1e1a2e",
    desc:"Invest in your mind. The more you learn, the more you earn. Use this jar to grow your skills, knowledge, and value. This is how you get out of where you are.",
    examples:"Books, online courses, seminars, coaching, apps that teach you something." },
  { key:"play",        label:"Play",        emoji:"🎉", pct:0.10, color:"#F5DDD0", text:"#2e1a10",
    desc:"Spend this completely every month — guilt free. This jar is your reward for managing the others well. Enjoy it fully. The rule is: spend it all before the month ends.",
    examples:"Eating out, cinema, weekend trips, treats, hobbies, anything that makes you happy." },
  { key:"freedom",     label:"Freedom",     emoji:"📈", pct:0.10, color:"#F0E8D0", text:"#2a2010",
    desc:"This jar builds your financial freedom over time. Money here goes into assets that grow — investments, stocks, real estate. You are building a future where money works for you.",
    examples:"Stocks, ETFs, crypto, real estate, business investments." },
  { key:"give",        label:"Give",        emoji:"🎁", pct:0.05, color:"#F0D0D8", text:"#2e0e18",
    desc:"Money flows back to those who give. Use this jar to support others — family, charity, friends in need. Giving keeps you grateful and connected to something bigger than yourself.",
    examples:"Charity donations, gifts for family, helping a friend, supporting a cause." },
];

const EXPENSE_CATS = [
  // 🏠 NECESSITIES
  { label:"Rent",               jar:"necessities", emoji:"🏠", tags:["rent","affitto","house","home","appartamento"] },
  { label:"Mortgage",           jar:"necessities", emoji:"🏡", tags:["mortgage","mutuo","loan","house payment"] },
  { label:"Electricity",        jar:"necessities", emoji:"⚡", tags:["electricity","electric","luce","energia","power","utility"] },
  { label:"Gas",                jar:"necessities", emoji:"🔥", tags:["gas","heating","riscaldamento","utility"] },
  { label:"Water Bill",         jar:"necessities", emoji:"💧", tags:["water","acqua","utility","bill"] },
  { label:"Internet",           jar:"necessities", emoji:"📡", tags:["internet","wifi","broadband","fibra","connection"] },
  { label:"Phone Bill",         jar:"necessities", emoji:"📱", tags:["phone","telefono","mobile","sim","vodafone","tim","wind","iliad"] },
  { label:"Groceries",          jar:"necessities", emoji:"🛒", tags:["groceries","food","supermarket","supermercato","lidl","aldi","conad","esselunga","carrefour","coop"] },
  { label:"Fuel",               jar:"necessities", emoji:"⛽", tags:["fuel","petrol","benzina","diesel","gas station","gasolio"] },
  { label:"Car Insurance",      jar:"necessities", emoji:"🚗", tags:["car insurance","assicurazione","rc auto","insurance","kasko"] },
  { label:"Health Insurance",   jar:"necessities", emoji:"🏥", tags:["health insurance","assicurazione sanitaria","medical insurance"] },
  { label:"Doctor / Medical",   jar:"necessities", emoji:"👨‍⚕️", tags:["doctor","medical","medico","dentist","dentista","hospital","ospedale","farmacia","pharmacy","medicine","farmaco"] },
  { label:"Public Transport",   jar:"necessities", emoji:"🚌", tags:["bus","metro","train","treno","tram","transport","abbonamento","ticket","atm","trenitalia","italo"] },
  { label:"Car Maintenance",    jar:"necessities", emoji:"🔧", tags:["car repair","mechanic","meccanico","revisione","bollo","maintenance","riparazione"] },
  { label:"Clothing Basics",    jar:"necessities", emoji:"👕", tags:["clothes","clothing","abbigliamento","shoes","scarpe","basic"] },
  { label:"School / Tuition",   jar:"necessities", emoji:"🎓", tags:["school","tuition","tasse scolastiche","university","università","retta"] },
  { label:"Childcare",          jar:"necessities", emoji:"👶", tags:["childcare","asilo","babysitter","nido","kids"] },
  { label:"Loan Repayment",     jar:"necessities", emoji:"💳", tags:["loan","prestito","debt","debito","rata","installment","finanziamento"] },
  { label:"Taxes",              jar:"necessities", emoji:"🧾", tags:["tax","tasse","imu","tari","irpef","iva","f24","imposta"] },
  { label:"Home Repairs",       jar:"necessities", emoji:"🔨", tags:["repair","riparazione","home","casa","plumber","idraulico","electrician","elettricista"] },
  { label:"Cleaning Products",  jar:"necessities", emoji:"🧹", tags:["cleaning","pulizie","detergent","detersivo","household"] },
  { label:"Pet Food / Vet",     jar:"necessities", emoji:"🐾", tags:["pet","dog","cat","gatto","cane","vet","veterinario","pet food"] },

  // 🎉 PLAY
  { label:"Eating Out",         jar:"play", emoji:"🍕", tags:["restaurant","ristorante","pizza","sushi","dinner","lunch","cafe","bar","eating out","food out"] },
  { label:"Coffee & Cafe",      jar:"play", emoji:"☕", tags:["coffee","cafe","cappuccino","espresso","bar","colazione"] },
  { label:"Netflix",            jar:"play", emoji:"🎬", tags:["netflix","streaming","film","movie","serie"] },
  { label:"Spotify",            jar:"play", emoji:"🎵", tags:["spotify","music","musica","apple music","deezer","tidal"] },
  { label:"Disney+",            jar:"play", emoji:"✨", tags:["disney","disney+","streaming"] },
  { label:"Amazon Prime",       jar:"play", emoji:"📦", tags:["amazon","prime","amazon prime","streaming"] },
  { label:"YouTube Premium",    jar:"play", emoji:"▶️", tags:["youtube","youtube premium"] },
  { label:"Cinema",             jar:"play", emoji:"🍿", tags:["cinema","movie","film","tickets","biglietti"] },
  { label:"Concerts & Events",  jar:"play", emoji:"🎤", tags:["concert","evento","event","show","ticket","biglietto","teatro","theatre"] },
  { label:"Travel & Holidays",  jar:"play", emoji:"✈️", tags:["travel","holiday","vacation","vacanza","viaggio","flight","volo","hotel","airbnb","booking"] },
  { label:"Hobbies",            jar:"play", emoji:"🎨", tags:["hobby","hobbies","sport","gym","palestra","yoga","fitness"] },
  { label:"Shopping",           jar:"play", emoji:"🛍", tags:["shopping","clothes","fashion","zara","h&m","mango","shoes","scarpe","accessori"] },
  { label:"Beauty & Grooming",  jar:"play", emoji:"💅", tags:["beauty","parrucchiere","haircut","hair","makeup","nail","spa","estetista","barbiere","barber"] },
  { label:"Massage & Wellness", jar:"play", emoji:"💆", tags:["massage","massaggio","spa","wellness","relax"] },
  { label:"Games & Apps",       jar:"play", emoji:"🎮", tags:["game","gioco","playstation","xbox","steam","app","gaming","nintendo"] },
  { label:"Gifts (Friends)",    jar:"play", emoji:"🎁", tags:["gift","regalo","present","friend","amico","birthday","compleanno"] },
  { label:"Alcohol & Drinks",   jar:"play", emoji:"🍷", tags:["wine","vino","beer","birra","alcohol","drinks","aperitivo","cocktail"] },
  { label:"Takeaway",           jar:"play", emoji:"🥡", tags:["takeaway","delivery","just eat","deliveroo","uber eats","glovo","consegna"] },

  // 📚 EDUCATION
  { label:"Books",              jar:"education", emoji:"📚", tags:["book","libro","kindle","ebook","amazon books","ibs","feltrinelli"] },
  { label:"Online Courses",     jar:"education", emoji:"💻", tags:["course","corso","udemy","coursera","skillshare","masterclass","linkedin learning","online learning"] },
  { label:"Seminars & Events",  jar:"education", emoji:"🎓", tags:["seminar","workshop","evento","conference","conferenza","masterclass"] },
  { label:"Coaching",           jar:"education", emoji:"🧠", tags:["coach","coaching","mentor","mentoring","consultant","consulente"] },
  { label:"Language Learning",  jar:"education", emoji:"🌍", tags:["language","lingua","duolingo","babbel","rosetta","italian","english","french","spanish"] },
  { label:"Podcast / Audio",    jar:"education", emoji:"🎧", tags:["podcast","audiobook","audible","audio","blinkist"] },
  { label:"Business Tools",     jar:"education", emoji:"🛠", tags:["software","tool","notion","canva","figma","adobe","grammarly","business","productivity"] },

  // 🏦 SAVINGS
  { label:"Emergency Fund",     jar:"savings", emoji:"🆘", tags:["emergency","emergenza","savings","risparmio","fund","riserva"] },
  { label:"Vacation Fund",      jar:"savings", emoji:"🌴", tags:["vacation","vacanza","travel fund","holiday savings"] },
  { label:"Car Fund",           jar:"savings", emoji:"🚙", tags:["car","macchina","auto","vehicle","fund"] },
  { label:"Home Fund",          jar:"savings", emoji:"🏠", tags:["home","house","casa","deposit","caparra","fund"] },
  { label:"Big Purchase",       jar:"savings", emoji:"🛒", tags:["big purchase","acquisto","phone","computer","laptop","appliance","elettrodomestico"] },

  // 📈 FREEDOM
  { label:"Stocks & ETFs",      jar:"freedom", emoji:"📈", tags:["stocks","shares","etf","azioni","borsa","market","trade","trading","investment","degiro","fineco","banca"] },
  { label:"Crypto",             jar:"freedom", emoji:"₿",  tags:["crypto","bitcoin","ethereum","btc","eth","binance","coinbase","blockchain"] },
  { label:"Real Estate",        jar:"freedom", emoji:"🏢", tags:["real estate","property","immobile","affitto passivo","rental","investimento"] },
  { label:"Business Investment",jar:"freedom", emoji:"💼", tags:["business","startup","invest","investimento","equity","capital"] },

  // 🎁 GIVE
  { label:"Charity",            jar:"give", emoji:"❤️",  tags:["charity","donazione","donation","ngo","croce rossa","unicef","red cross","church","chiesa"] },
  { label:"Family Support",     jar:"give", emoji:"👨‍👩‍👧", tags:["family","famiglia","parents","genitori","support","aiuto"] },
  { label:"Help a Friend",      jar:"give", emoji:"🤝",  tags:["friend","amico","help","aiuto","support","prestito","lend"] },
];

function JarInfoModal({ jar, totalIn, totalSpent, balance, monthIn, monthSpent, onBorrow, onClose, T }) {
  const M=JARMETA[jar.key]||JARMETA.play;
  const depleted=balance<0;
  const drain=totalIn>0?Math.min(100,(totalSpent/totalIn)*100):0;
  const monthLeft=monthIn-monthSpent;
  const Box=({l,v,warn})=>(
    <div style={{ flex:1, background:"rgba(255,255,255,.16)", borderRadius:14, padding:"10px 12px" }}>
      <div style={{ fontSize:9.5, color:"rgba(255,255,255,.75)", fontFamily:FONT, fontWeight:600, marginBottom:2 }}>{l}</div>
      <div style={{ fontSize:16, fontWeight:800, color:warn?"#FFD3D3":"#fff", fontFamily:FONT }}>{v}</div>
    </div>);
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ background:M.grad, borderRadius:22, padding:"18px", marginBottom:14, border:T.dark&&jar.key==="freedom"?("1px solid "+T.line2):"none" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
          <div style={{ width:44, height:44, borderRadius:16, background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={M.icon} s={21}/></div>
          <div>
            <div style={{ fontSize:19, fontWeight:800, color:"#fff", fontFamily:FONT }}>{jar.label}</div>
            <div style={{ fontSize:11.5, color:"rgba(255,255,255,.8)", fontFamily:FONT, fontWeight:500 }}>Gets {Math.round(jar.pct*100)}% of every salary</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:9, marginBottom:10 }}>
          <Box l="Total in" v={"€"+totalIn.toFixed(0)}/>
          <Box l="Spent" v={"€"+totalSpent.toFixed(0)}/>
          <Box l="Balance" v={"€"+balance.toFixed(0)} warn={depleted}/>
        </div>
        <div style={{ height:6, borderRadius:6, background:"rgba(255,255,255,.25)", overflow:"hidden" }}>
          <div style={{ height:"100%", width:drain+"%", background:"#fff", borderRadius:6, transition:"width .4s" }}/>
        </div>
      </div>
      <div style={{ background:T.card, border:"1px solid "+T.line, borderRadius:18, padding:"13px 15px", marginBottom:14, boxShadow:T.shadow }}>
        <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.12em", color:T.ink3, textTransform:"uppercase", fontFamily:FONT, marginBottom:8 }}>This month</div>
        <div style={{ display:"flex" }}>
          {[["+€"+monthIn.toFixed(0),"came in",tints(T).gr.fg],["−€"+monthSpent.toFixed(0),"spent",tints(T).ro.fg],["€"+monthLeft.toFixed(0),"left",T.ink]].map((x,i)=>(
            <div key={i} style={{ flex:1, textAlign:"center" }}>
              <div style={{ fontSize:15, fontWeight:800, color:x[2], fontFamily:FONT }}>{x[0]}</div>
              <div style={{ fontSize:10, color:T.ink3, fontFamily:FONT, fontWeight:500 }}>{x[1]}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize:13.5, color:T.ink2, fontFamily:FONT, fontWeight:500, lineHeight:1.7, marginBottom:12 }}>{jar.desc}</div>
      <div style={{ background:T.chip, borderRadius:16, padding:"12px 14px", marginBottom:16 }}>
        <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.12em", color:T.ink3, textTransform:"uppercase", fontFamily:FONT, marginBottom:5 }}>Examples</div>
        <div style={{ fontSize:12.5, color:T.ink2, fontFamily:FONT, fontWeight:500, lineHeight:1.6 }}>{jar.examples}</div>
      </div>
      <div style={{ display:"flex", gap:10 }}>
        <button onClick={onBorrow} style={{ flex:1, padding:"14px", background:tints(T).ro.bg, border:"none", borderRadius:16, fontSize:13.5, fontWeight:700, fontFamily:FONT, color:tints(T).ro.fg, cursor:"pointer" }}>Borrow money</button>
        <button onClick={onClose} style={{ flex:1, padding:"14px", background:T.chip, border:"none", borderRadius:16, fontSize:13.5, fontWeight:700, fontFamily:FONT, color:T.ink2, cursor:"pointer" }}>Got it</button>
      </div>
    </Sheet>
  );
}

function SalaryModal({ editing, onSave, onDelete, onClose, T }) {
  const [val,setVal]=useState(editing?String(editing.amount):"");
  const [date,setDate]=useState(editing?editing.date:TODAY());
  const ok=val&&parseFloat(val)>0&&date;
  const submit=()=>{ if(!ok)return; onSave({ id:editing?editing.id:null, amount:parseFloat(val), date }); onClose(); };
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT }}>{editing?"Edit Salary":"Add Salary"}</div>
        <Chip n="close" c="ink" T={T} size={36} is={16} onClick={onClose}/>
      </div>
      <Field T={T} label="Amount (€)">
        <input autoFocus type="number" value={val} onChange={e=>setVal(e.target.value)} placeholder="e.g. 2000" style={inputStyle(T,true)}/>
      </Field>
      <Field T={T} label="Date received">
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ ...inputStyle(T), colorScheme:T.dark?"dark":"light" }}/>
      </Field>
      <div style={{ fontSize:11.5, color:T.ink3, fontFamily:FONT, fontWeight:500, marginBottom:14, lineHeight:1.6 }}>Added on top of your jars — each jar grows by its share. Nothing resets.</div>
      <CTA T={T} disabled={!ok} onClick={submit}>{editing?"Save Changes":"Add Salary"}</CTA>
      {editing&&(
        <button onClick={()=>{ onDelete(editing.id); onClose(); }} style={{ width:"100%", padding:"13px", marginTop:10, background:tints(T).red.bg, border:"none", borderRadius:16, fontSize:13.5, fontWeight:700, fontFamily:FONT, color:PAL.red, cursor:"pointer" }}>Delete this entry</button>
      )}
    </Sheet>
  );
}

function AddExpenseModal({ onAdd, onClose, T }) {
  const [val,setVal]=useState("");
  const [q,setQ]=useState("");
  const [sel,setSel]=useState(null);
  const [jar,setJar]=useState(null);
  const [note,setNote]=useState("");
  const ql=q.trim().toLowerCase();
  const cats = ql ? EXPENSE_CATS.filter(c=>c.label.toLowerCase().includes(ql)||c.tags.some(t=>t.includes(ql))).slice(0,10) : EXPENSE_CATS.slice(0,10);
  const pick=(c)=>{ setSel(c); setJar(c.jar); };
  const ok=val&&parseFloat(val)>0&&sel;
  const submit=()=>{ if(!ok)return; onAdd({ amount:parseFloat(val), cat:sel.label, emoji:sel.emoji, jar:jar||sel.jar, note:note.trim(), date:TODAY() }); onClose(); };
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT }}>Add Expense</div>
        <Chip n="close" c="ink" T={T} size={36} is={16} onClick={onClose}/>
      </div>
      <Field T={T} label="Amount (€)">
        <input autoFocus type="number" value={val} onChange={e=>setVal(e.target.value)} placeholder="e.g. 24.50" style={inputStyle(T,true)}/>
      </Field>
      <Field T={T} label="Category">
        <div style={{ display:"flex", alignItems:"center", gap:8, background:T.input, borderRadius:14, padding:"10px 12px", marginBottom:10 }}>
          <Ic n="search" s={16} style={{ color:T.ink3 }}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search: rent, groceries, netflix..." style={{ flex:1, background:"none", border:"none", outline:"none", color:T.ink, fontSize:13.5, fontWeight:600, fontFamily:FONT }}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {cats.map(c=>{ const M=JARMETA[c.jar]; const on=sel&&sel.label===c.label; return (
            <div key={c.label} onClick={()=>pick(c)} style={{ display:"flex", alignItems:"center", gap:8, background:T.card, border:on?("1.6px solid "+PAL.or):("1px solid "+T.line), borderRadius:14, padding:"9px 10px", cursor:"pointer", boxShadow:T.shadow }}>
              <Chip n={M.icon} c={M.c} T={T} size={28} is={14}/>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:11.5, fontWeight:700, color:T.ink, fontFamily:FONT, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.label}</div>
                <div style={{ fontSize:9, color:T.ink3, fontFamily:FONT, fontWeight:600 }}>{JARS.find(j=>j.key===c.jar).label}</div>
              </div>
            </div>
          );})}
        </div>
      </Field>
      <Field T={T} label="From jar">
        <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
          {JARS.map(j=>{ const on=(jar||(sel&&sel.jar))===j.key; const M=JARMETA[j.key]; return (
            <div key={j.key} onClick={()=>setJar(j.key)} style={{ display:"flex", alignItems:"center", gap:6, borderRadius:999, padding:"7px 12px", background:on?tints(T)[M.c==="ink"?"or":M.c].bg:T.chip, outline:on?("1.6px solid "+tints(T)[M.c==="ink"?"or":M.c].fg):"none", cursor:"pointer" }}>
              <span style={{ width:9, height:9, borderRadius:"50%", background:M.c==="ink"?T.ink:PAL[M.c] }}/>
              <span style={{ fontSize:11, fontWeight:700, color:T.ink, fontFamily:FONT }}>{j.label}</span>
            </div>
          );})}
        </div>
      </Field>
      <Field T={T} label="Note (optional)">
        <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. weekly shop" style={inputStyle(T)}/>
      </Field>
      <CTA T={T} disabled={!ok} onClick={submit}>Add Expense</CTA>
    </Sheet>
  );
}

function BorrowModal({ needyJar, allJars, onBorrow, onClose, T }) {
  const [from,setFrom]=useState(null);
  const [val,setVal]=useState("");
  const others=allJars.filter(j=>j.key!==needyJar.key);
  const ok=from&&val&&parseFloat(val)>0;
  const submit=()=>{ if(!ok)return; onBorrow({ fromJar:from, toJar:needyJar.key, amount:parseFloat(val) }); onClose(); };
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT, marginBottom:4 }}>Borrow for {needyJar.label}</div>
      <div style={{ fontSize:12, color:T.ink3, fontFamily:FONT, fontWeight:500, marginBottom:16 }}>Take money from another jar. Return it when you can.</div>
      <Field T={T} label="Take from">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {others.map(j=>{ const M=JARMETA[j.key]; const on=from===j.key; return (
            <div key={j.key} onClick={()=>setFrom(j.key)} style={{ display:"flex", alignItems:"center", gap:8, background:T.card, border:on?("1.6px solid "+PAL.or):("1px solid "+T.line), borderRadius:14, padding:"10px", cursor:"pointer", boxShadow:T.shadow }}>
              <Chip n={M.icon} c={M.c==="ink"?"or":M.c} T={T} size={28} is={14}/>
              <span style={{ fontSize:12, fontWeight:700, color:T.ink, fontFamily:FONT }}>{j.label}</span>
            </div>
          );})}
        </div>
      </Field>
      <Field T={T} label="Amount (€)">
        <input type="number" value={val} onChange={e=>setVal(e.target.value)} placeholder="e.g. 50" style={inputStyle(T,true)}/>
      </Field>
      <CTA T={T} disabled={!ok} onClick={submit}>Borrow</CTA>
    </Sheet>
  );
}

function AddSubForm({ onAdd, currency, T }) {
  const [name,setName]=useState("");
  const [val,setVal]=useState("");
  const [date,setDate]=useState("");
  const ok=name.trim()&&val&&parseFloat(val)>0&&date;
  return (
    <div>
      <Field T={T} label="Name">
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Netflix" style={inputStyle(T)}/>
      </Field>
      <Field T={T} label={"Amount ("+currency+"/month)"}>
        <input type="number" value={val} onChange={e=>setVal(e.target.value)} placeholder="e.g. 12.99" style={inputStyle(T,true)}/>
      </Field>
      <Field T={T} label="Next payment date">
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ ...inputStyle(T), colorScheme:T.dark?"dark":"light" }}/>
      </Field>
      <CTA T={T} disabled={!ok} onClick={()=>{ if(!ok)return; onAdd({ name:name.trim(), amount:parseFloat(val), nextDate:date }); }}>Add Subscription</CTA>
    </div>
  );
}

function FinancePage({ onModalChange=()=>{}, darkMode=true }) {
  const T=THEME(darkMode);
  const [deposits, setDeposits] = useState(()=>{
    let d = load("rslv_deposits", null);
    if (!d) {
      const oldSalary = load("rslv_salary", 0);
      d = oldSalary > 0 ? [{ id:"seed", amount:oldSalary, date:TODAY() }] : [];
    }
    return d;
  });
  const [expenses, setExpenses] = useState(()=>load("rslv_expenses", []));
  const [loans, setLoans] = useState(()=>load("rslv_loans", []));
  const [subs, setSubs] = useState(()=>load("rslv_subs",[]));
  const [showAddSalary, setShowAddSalary] = useState(false);
  const [editDep, setEditDep] = useState(null);
  const [showExpense, setShowExpense] = useState(false);
  const [selectedJar, setSelectedJar] = useState(null);
  const [borrowFromJar, setBorrowFromJar] = useState(null);
  const [returnBannerDismissed, setReturnBannerDismissed] = useState(false);
  const [showJarInfo, setShowJarInfo] = useState(false);
  const [showAddSub, setShowAddSub] = useState(false);
  const currency = load("rslv_currency","€");
  const openModal  = (fn) => { onModalChange(true);  fn(); };
  const closeModal = (fn) => { onModalChange(false); fn(); };
  useEffect(()=>{ save("rslv_deposits", deposits); save("rslv_salary", deposits.reduce((a,d)=>a+d.amount,0)); }, [deposits]);
  useEffect(()=>{ save("rslv_expenses", expenses); }, [expenses]);
  useEffect(()=>{ save("rslv_loans", loans); }, [loans]);
  useEffect(()=>{ save("rslv_subs",subs); },[subs]);
  const addExpense = (exp) => setExpenses(p=>[{ id:Date.now().toString(), ...exp }, ...p]);
  const deleteExpense = (id) => setExpenses(p=>p.filter(e=>e.id!==id));
  const saveDeposit = ({id, amount, date}) => {
    if (id) setDeposits(p=>p.map(d=>d.id===id ? {...d, amount, date} : d));
    else setDeposits(p=>[{ id:Date.now().toString(), amount, date }, ...p]);
    setReturnBannerDismissed(false);
  };
  const deleteDeposit = (id) => setDeposits(p=>p.filter(d=>d.id!==id));
  const monthKey = (s) => (s || "").slice(0,7);
  const NOW_MONTH = monthKey(TODAY());
  const pctOf = (k) => JARS.find(j=>j.key===k).pct;
  const totalDeposited = deposits.reduce((a,d)=>a+d.amount, 0);
  const monthDeposits  = deposits.filter(d=>monthKey(d.date)===NOW_MONTH);
  const monthIncome    = monthDeposits.reduce((a,d)=>a+d.amount, 0);
  const jarIn        = (k) => totalDeposited * pctOf(k);
  const jarSpent     = (k) => expenses.filter(e=>e.jar===k).reduce((a,e)=>a+e.amount, 0);
  const jarMonthIn   = (k) => monthIncome * pctOf(k);
  const jarMonthSpent= (k) => expenses.filter(e=>e.jar===k && monthKey(e.date)===NOW_MONTH).reduce((a,e)=>a+e.amount, 0);
  const lentFromJar  = (k) => loans.filter(l=>l.from===k && !l.returned).reduce((a,l)=>a+l.amount,0);
  const borrowedByJar= (k) => loans.filter(l=>l.to===k && !l.returned).reduce((a,l)=>a+l.amount,0);
  const jarBalance   = (k) => jarIn(k) - jarSpent(k) - lentFromJar(k) + borrowedByJar(k);
  const totalBalance = JARS.reduce((a,j)=>a+jarBalance(j.key), 0);
  const activeLoans   = loans.filter(l=>!l.returned);
  const showReturnBanner = activeLoans.length > 0 && !returnBannerDismissed;
  const borrowMoney = ({fromJar, toJar, amount}) => setLoans(p=>[...p, { id:Date.now().toString(), from:fromJar, to:toJar, amount, date:TODAY(), returned:false }]);
  const returnLoan  = (loanId) => setLoans(p=>p.map(l=>l.id===loanId ? {...l, returned:true, returnedDate:TODAY()} : l));
  const fmtDate = (s) => { try { return new Date(s).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); } catch { return s; } };
  const tt=tints(T);
  return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, animation:"fadeUp .4s ease both" }}>
        <div>
          <div style={{ fontSize:26, fontWeight:800, color:T.ink, letterSpacing:"-0.02em" }}>Finance</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, marginTop:2 }}>Your money, 6 jars</div>
        </div>
        <div onClick={()=>openModal(()=>setShowJarInfo(true))} style={{ width:44, height:44, borderRadius:"50%", background:T.card, border:"1px solid "+T.line, display:"flex", alignItems:"center", justifyContent:"center", color:T.ink2, cursor:"pointer", boxShadow:T.shadow }}><Ic n="info" s={20}/></div>
      </div>

      {showReturnBanner && (
        <div style={{ background:T.card, border:"1px solid "+T.line, borderRadius:18, padding:"13px 15px", marginBottom:12, boxShadow:T.shadow }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:700, color:tt.ro.fg }}>Return borrowed money</div>
            <div onClick={()=>setReturnBannerDismissed(true)} style={{ color:T.ink3, cursor:"pointer" }}><Ic n="close" s={16}/></div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {activeLoans.map(loan=>{
              const fromJar=JARS.find(j=>j.key===loan.from), toJar=JARS.find(j=>j.key===loan.to);
              return (
                <div key={loan.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 11px", background:T.chip, borderRadius:12 }}>
                  <Chip n={JARMETA[loan.to].icon} c={JARMETA[loan.to].c==="ink"?"or":JARMETA[loan.to].c} T={T} size={28} is={14}/>
                  <div style={{ flex:1, fontSize:11.5, color:T.ink2, fontWeight:500 }}>{toJar&&toJar.label} borrowed <b style={{ color:T.ink }}>€{loan.amount}</b> from {fromJar&&fromJar.label}</div>
                  <button onClick={()=>returnLoan(loan.id)} style={{ padding:"7px 13px", borderRadius:999, background:GRAD.gr, border:"none", fontSize:11, fontWeight:700, fontFamily:FONT, color:"#fff", cursor:"pointer" }}>Return</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ background:T.card, border:"1px solid "+T.line, borderRadius:24, padding:"16px 18px", marginBottom:10, display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:T.shadow, animation:"fadeUp .4s ease .05s both" }}>
        <div>
          <div style={{ fontSize:10.5, letterSpacing:"0.12em", color:T.ink3, textTransform:"uppercase", fontWeight:700, marginBottom:4 }}>This month's income</div>
          <div style={{ fontSize:25, fontWeight:800, color:monthIncome>0?T.ink:T.ink3, letterSpacing:"-0.02em" }}>€{monthIncome.toLocaleString()}</div>
          <div style={{ fontSize:10.5, color:T.ink3, fontWeight:500, marginTop:3 }}>{deposits.length>0 ? deposits.length+" deposit"+(deposits.length>1?"s":"")+" · €"+totalDeposited.toLocaleString()+" all time" : "No salary added yet"}</div>
        </div>
        <div onClick={()=>openModal(()=>setShowAddSalary(true))} style={{ display:"flex", alignItems:"center", gap:6, padding:"11px 16px", borderRadius:16, background:GRAD.or, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", boxShadow:"0 8px 18px rgba(255,94,31,.3)", flexShrink:0 }}>
          <Ic n="plus" s={15} sw={2.6}/> Add
        </div>
      </div>

      <div onClick={()=>openModal(()=>setShowExpense(true))} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, background:darkMode?"#fff":PAL.ink, color:darkMode?PAL.ink:"#fff", borderRadius:18, padding:"14px", fontSize:13.5, fontWeight:700, cursor:"pointer", marginBottom:16 }}>
        <Ic n="plus" s={16} sw={2.4}/> Add expense
      </div>

      {(totalDeposited > 0 || expenses.length > 0) && (
        <>
          <SecHead T={T} mt={0}>Your 6 jars</SecHead>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
            {JARS.map((jar,i)=>{
              const M=JARMETA[jar.key];
              const balance=jarBalance(jar.key), mIn=jarMonthIn(jar.key), mSpent=jarMonthSpent(jar.key);
              const depleted=balance<0;
              const mDrain=mIn>0?Math.min(100,(mSpent/mIn)*100):(mSpent>0?100:0);
              const lentLoans=loans.filter(l=>l.from===jar.key&&!l.returned);
              const borrowedLoans=loans.filter(l=>l.to===jar.key&&!l.returned);
              return (
                <div key={jar.key} onClick={()=>openModal(()=>setSelectedJar(jar))} style={{ background:M.grad, border:T.dark&&jar.key==="freedom"?("1px solid "+T.line2):"none", borderRadius:22, padding:"14px", cursor:"pointer", animation:"cardIn .4s ease "+(0.08+i*0.05)+"s both", display:"flex", flexDirection:"column", justifyContent:"space-between", minHeight:150 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={{ width:34, height:34, borderRadius:13, background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n={M.icon} s={17}/></div>
                    <div style={{ fontSize:10, fontWeight:800, color:"#fff", background:"rgba(255,255,255,.22)", borderRadius:999, padding:"4px 9px" }}>{Math.round(jar.pct*100)}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:700, color:"rgba(255,255,255,.95)", marginBottom:1 }}>{jar.label}</div>
                    <div style={{ fontSize:8.5, color:"rgba(255,255,255,.75)", textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700 }}>Total saved</div>
                    <div style={{ fontSize:20, fontWeight:800, color:depleted?"#FFD3D3":"#fff", letterSpacing:"-0.02em", marginBottom:7 }}>{depleted?"-€"+Math.abs(balance).toFixed(0):"€"+balance.toFixed(0)}</div>
                    <div style={{ background:"rgba(255,255,255,.16)", borderRadius:11, padding:"6px 9px" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:10.5, fontWeight:800, color:"#fff" }}>+€{mIn.toFixed(0)}</span>
                        <span style={{ fontSize:10.5, fontWeight:700, color:"rgba(255,255,255,.85)" }}>−€{mSpent.toFixed(0)}</span>
                      </div>
                      <div style={{ height:3, borderRadius:3, background:"rgba(255,255,255,.28)", overflow:"hidden", marginTop:4 }}>
                        <div style={{ height:"100%", width:mDrain+"%", background:"#fff", borderRadius:3, transition:"width .4s" }}/>
                      </div>
                    </div>
                    {depleted&&(
                      <div onClick={e=>{ e.stopPropagation(); onModalChange(true); setBorrowFromJar(jar); }} style={{ marginTop:7, padding:"5px 10px", borderRadius:999, background:"rgba(255,255,255,.92)", display:"inline-flex", alignItems:"center", gap:5, cursor:"pointer" }}>
                        <span style={{ fontSize:10, fontWeight:800, color:PAL.red }}>Borrow?</span>
                      </div>
                    )}
                    {lentLoans.map(loan=>{ const toJar=JARS.find(j=>j.key===loan.to); return (
                      <div key={loan.id} style={{ marginTop:6, padding:"4px 9px", borderRadius:999, background:"rgba(0,0,0,.18)", display:"inline-flex", gap:4 }}>
                        <span style={{ fontSize:9.5, fontWeight:700, color:"#fff" }}>−€{loan.amount} → {toJar&&toJar.label}</span>
                      </div>); })}
                    {borrowedLoans.map(loan=>{ const fromJar=JARS.find(j=>j.key===loan.from); return (
                      <div key={loan.id} style={{ marginTop:6, padding:"4px 9px", borderRadius:999, background:"rgba(255,255,255,.22)", display:"inline-flex", gap:4 }}>
                        <span style={{ fontSize:9.5, fontWeight:700, color:"#fff" }}>+€{loan.amount} from {fromJar&&fromJar.label}</span>
                      </div>); })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {totalDeposited > 0 && (
        <div style={{ background:GRAD.gr, borderRadius:22, padding:"15px 18px", display:"flex", alignItems:"center", gap:12, marginBottom:16, animation:"fadeUp .4s ease .2s both" }}>
          <div style={{ width:38, height:38, borderRadius:14, background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="chart" s={18}/></div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,255,255,.8)" }}>Total saved · all jars</div>
            <div style={{ fontSize:21, fontWeight:800, color:"#fff", letterSpacing:"-0.02em" }}>€{totalBalance.toFixed(2)}</div>
          </div>
        </div>
      )}

      {deposits.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <SecHead T={T} mt={0}>Salary log</SecHead>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {deposits.map(d=>(
              <div key={d.id} onClick={()=>openModal(()=>setEditDep(d))} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:T.card, border:"1px solid "+T.line, borderRadius:16, cursor:"pointer", boxShadow:T.shadow }}>
                <Chip n="coins" c="gr" T={T} size={34} is={16}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:T.ink }}>Salary</div>
                  <div style={{ fontSize:10.5, color:T.ink3, fontWeight:500 }}>{fmtDate(d.date)} · tap to edit</div>
                </div>
                <div style={{ fontSize:14.5, fontWeight:800, color:tt.gr.fg }}>+€{d.amount.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <SecHead T={T} mt={0}>Expenses</SecHead>
      {expenses.length === 0 ? (
        <div style={{ padding:"24px 20px", textAlign:"center", background:T.card, borderRadius:20, border:"1px dashed "+T.dashed }}>
          <div style={{ fontSize:12.5, fontWeight:600, color:T.ink3 }}>No expenses yet. Tap "Add expense" above.</div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {expenses.map((e,i)=>{ const M=JARMETA[e.jar]||JARMETA.play; return (
            <div key={e.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:T.card, border:"1px solid "+T.line, borderRadius:16, boxShadow:T.shadow, animation:"fadeUp .3s ease "+(i*0.03)+"s both" }}>
              <Chip n={M.icon} c={M.c==="ink"?"or":M.c} T={T} size={34} is={16}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:T.ink, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.cat}</div>
                <div style={{ fontSize:10.5, color:T.ink3, fontWeight:500 }}>{(e.note||fmtDate(e.date))+" · "+((JARS.find(j=>j.key===e.jar)||{}).label||"")}</div>
              </div>
              <div style={{ fontSize:14, fontWeight:800, color:tt.ro.fg }}>-€{e.amount.toFixed(2)}</div>
              <div onClick={()=>deleteExpense(e.id)} style={{ color:T.ink3, cursor:"pointer", padding:4 }}><Ic n="trash" s={16}/></div>
            </div>
          );})}
        </div>
      )}

      <SecHead T={T} right={
        <div onClick={()=>openModal(()=>setShowAddSub(true))} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 13px 7px 9px", borderRadius:999, background:T.card, border:"1px solid "+T.line, cursor:"pointer", boxShadow:T.shadow }}>
          <Chip n="plus" c="vi" T={T} size={22} is={12} style={{ borderRadius:"50%" }}/>
          <span style={{ fontSize:11.5, fontWeight:700, color:T.ink }}>Add</span>
        </div>
      }>Subscriptions</SecHead>
      {subs.length===0 ? (
        <div style={{ padding:"18px", textAlign:"center", background:T.card, borderRadius:18, border:"1px dashed "+T.dashed }}>
          <div style={{ fontSize:12, color:T.ink3, fontWeight:600 }}>No subscriptions yet. Add Netflix, Spotify, gym...</div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {subs.map(s=>{
            const daysUntil=Math.ceil((new Date(s.nextDate)-new Date())/(1000*60*60*24));
            const urgent=daysUntil<=2;
            return (
              <div key={s.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:T.card, border:urgent?("1.4px solid "+PAL.am):("1px solid "+T.line), borderRadius:16, boxShadow:T.shadow }}>
                <Chip n="clock" c="vi" T={T} size={34} is={16}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:T.ink }}>{s.name}</div>
                  <div style={{ fontSize:10.5, color:urgent?tt.am.fg:T.ink3, fontWeight:urgent?700:500 }}>{urgent?"Due in "+daysUntil+" day"+(daysUntil===1?"":"s"):"Next: "+new Date(s.nextDate).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</div>
                </div>
                <div style={{ fontSize:13.5, fontWeight:800, color:T.ink }}>{currency}{s.amount}</div>
                <div onClick={()=>setSubs(p=>p.filter(x=>x.id!==s.id))} style={{ color:T.ink3, cursor:"pointer", padding:4 }}><Ic n="trash" s={16}/></div>
              </div>
            );
          })}
        </div>
      )}

      {(showAddSalary || editDep) && <SalaryModal T={T} editing={editDep} onSave={saveDeposit} onDelete={deleteDeposit} onClose={()=>closeModal(()=>{ setShowAddSalary(false); setEditDep(null); })}/>}
      {showExpense && <AddExpenseModal T={T} onAdd={addExpense} onClose={()=>closeModal(()=>setShowExpense(false))}/>}
      {selectedJar && <JarInfoModal T={T} jar={selectedJar} totalIn={jarIn(selectedJar.key)} totalSpent={jarSpent(selectedJar.key)} balance={jarBalance(selectedJar.key)} monthIn={jarMonthIn(selectedJar.key)} monthSpent={jarMonthSpent(selectedJar.key)} onBorrow={()=>{ setBorrowFromJar(selectedJar); setSelectedJar(null); }} onClose={()=>closeModal(()=>setSelectedJar(null))}/>}
      {borrowFromJar && <BorrowModal T={T} needyJar={borrowFromJar} allJars={JARS} onBorrow={borrowMoney} onClose={()=>closeModal(()=>setBorrowFromJar(null))}/>}
      {showAddSub && (
        <Sheet T={T} onClose={()=>closeModal(()=>setShowAddSub(false))}>
          <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT, marginBottom:16 }}>Add Subscription</div>
          <AddSubForm T={T} currency={currency} onAdd={(sub)=>{ setSubs(p=>[...p,{id:Date.now().toString(),...sub}]); closeModal(()=>setShowAddSub(false)); }}/>
        </Sheet>
      )}
      {showJarInfo && (
        <Sheet T={T} onClose={()=>{ onModalChange(false); setShowJarInfo(false); }}>
          <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT, marginBottom:4 }}>The 6 Jar System</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, lineHeight:1.7, marginBottom:16 }}>From T. Harv Eker's "Secrets of the Millionaire Mind". Every salary is split into 6 jars, each with a purpose. Jars keep their balance and grow over time — nothing resets.</div>
          {JARS.map(jar=>{ const M=JARMETA[jar.key]; return (
            <div key={jar.key} style={{ display:"flex", gap:12, background:T.card, border:"1px solid "+T.line, borderRadius:18, padding:"13px 14px", marginBottom:9, boxShadow:T.shadow }}>
              <Chip n={M.icon} c={M.c==="ink"?"or":M.c} T={T} size={38} is={18}/>
              <div>
                <div style={{ fontSize:13.5, fontWeight:800, color:T.ink }}>{jar.label} — {Math.round(jar.pct*100)}%</div>
                <div style={{ fontSize:11.5, color:T.ink2, fontWeight:500, lineHeight:1.6, marginTop:2 }}>{jar.desc}</div>
              </div>
            </div>
          );})}
          <CTA T={T} onClick={()=>{ onModalChange(false); setShowJarInfo(false); }} style={{ marginTop:6 }}>Got it</CTA>
        </Sheet>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   WORD DATA — 10 languages × 30 words (starter set)
───────────────────────────────────────────── */
const LANGUAGES = [
  { code:"es", name:"Spanish",    flag:"🇪🇸" },
  { code:"fr", name:"French",     flag:"🇫🇷" },
  { code:"it", name:"Italian",    flag:"🇮🇹" },
  { code:"de", name:"German",     flag:"🇩🇪" },
  { code:"pt", name:"Portuguese", flag:"🇧🇷" },
  { code:"ar", name:"Arabic",     flag:"🇸🇦" },
  { code:"ja", name:"Japanese",   flag:"🇯🇵" },
  { code:"zh", name:"Chinese",    flag:"🇨🇳" },
  { code:"hi", name:"Hindi",      flag:"🇮🇳" },
  { code:"ru", name:"Russian",    flag:"🇷🇺" },
];

const WORDS = {
  es: [
    {w:"Hola",       t:"Hello",       p:"OH-lah",         e:"🙋"}, {w:"Gracias",    t:"Thank you",   p:"GRAH-syahs",     e:"🙏"},
    {w:"Por favor",  t:"Please",      p:"por fah-VOR",    e:"✋"}, {w:"Sí",         t:"Yes",         p:"see",            e:"✅"},
    {w:"No",         t:"No",          p:"noh",            e:"❌"}, {w:"Agua",       t:"Water",       p:"AH-gwah",        e:"💧"},
    {w:"Comida",     t:"Food",        p:"koh-MEE-dah",    e:"🍽"}, {w:"Casa",       t:"House",       p:"KAH-sah",        e:"🏠"},
    {w:"Amigo",      t:"Friend",      p:"ah-MEE-goh",     e:"👫"}, {w:"Amor",       t:"Love",        p:"ah-MOR",         e:"❤️"},
    {w:"Trabajo",    t:"Work",        p:"trah-BAH-hoh",   e:"💼"}, {w:"Dinero",     t:"Money",       p:"dee-NEH-roh",    e:"💰"},
    {w:"Tiempo",     t:"Time/Weather",p:"TYEM-poh",       e:"⏰"}, {w:"Bien",       t:"Good/Well",   p:"byen",           e:"👍"},
    {w:"Malo",       t:"Bad",         p:"MAH-loh",        e:"👎"}, {w:"Grande",     t:"Big",         p:"GRAHN-deh",      e:"🐘"},
    {w:"Pequeño",    t:"Small",       p:"peh-KEH-nyoh",   e:"🐭"}, {w:"Rápido",     t:"Fast",        p:"RAH-pee-doh",    e:"🏃"},
    {w:"Lento",      t:"Slow",        p:"LEN-toh",        e:"🐢"}, {w:"Feliz",      t:"Happy",       p:"feh-LEES",       e:"😊"},
    {w:"Triste",     t:"Sad",         p:"TREES-teh",      e:"😢"}, {w:"Cansado",    t:"Tired",       p:"kahn-SAH-doh",   e:"😴"},
    {w:"Hambre",     t:"Hungry",      p:"AHM-breh",       e:"🤤"}, {w:"Sed",        t:"Thirsty",     p:"sed",            e:"😮"},
    {w:"Familia",    t:"Family",      p:"fah-MEE-lyah",   e:"👨‍👩‍👧"}, {w:"Madre",      t:"Mother",      p:"MAH-dreh",       e:"👩"},
    {w:"Padre",      t:"Father",      p:"PAH-dreh",       e:"👨"}, {w:"Libro",      t:"Book",        p:"LEE-broh",       e:"📚"},
    {w:"Ciudad",     t:"City",        p:"syoo-DAHD",      e:"🏙"}, {w:"Playa",      t:"Beach",       p:"PLAH-yah",       e:"🏖"},
    {w:"Ser",t:"To be (permanent)",p:"sehr",e:"🧍"}, {w:"Estar",t:"To be (state)",p:"es-TAR",e:"📍"},
    {w:"Tener",t:"To have",p:"teh-NEHR",e:"🤲"}, {w:"Hacer",t:"To do/make",p:"ah-SEHR",e:"🔨"},
    {w:"Decir",t:"To say",p:"deh-SEER",e:"🗣"}, {w:"Poder",t:"To be able",p:"poh-DEHR",e:"💪"},
    {w:"Querer",t:"To want/love",p:"keh-REHR",e:"🙌"}, {w:"Saber",t:"To know",p:"sah-BEHR",e:"🧠"},
    {w:"Deber",t:"To have to",p:"deh-BEHR",e:"📋"}, {w:"Ver",t:"To see",p:"behr",e:"👀"},
    {w:"Ir",t:"To go",p:"eer",e:"🚶"}, {w:"Venir",t:"To come",p:"beh-NEER",e:"👋"},
    {w:"Dar",t:"To give",p:"dar",e:"🎁"}, {w:"Hablar",t:"To speak",p:"ah-BLAR",e:"💬"},
    {w:"Encontrar",t:"To find",p:"en-kon-TRAR",e:"🔍"}, {w:"Sentir",t:"To feel",p:"sen-TEER",e:"💗"},
    {w:"Tomar",t:"To take/drink",p:"toh-MAR",e:"✊"}, {w:"Mirar",t:"To look at",p:"mee-RAR",e:"👁"},
    {w:"Poner",t:"To put",p:"poh-NEHR",e:"📥"}, {w:"Pensar",t:"To think",p:"pen-SAR",e:"💭"},
    {w:"Creer",t:"To believe",p:"kreh-EHR",e:"🙏"}, {w:"Llevar",t:"To carry/wear",p:"yeh-BAR",e:"🎒"},
    {w:"Vivir",t:"To live",p:"bee-BEER",e:"🌱"}, {w:"Volver",t:"To return",p:"bol-BEHR",e:"🔙"},
    {w:"Entender",t:"To understand",p:"en-ten-DEHR",e:"💡"}, {w:"Llegar",t:"To arrive",p:"yeh-GAR",e:"🏁"},
    {w:"Conocer",t:"To know (people)",p:"koh-noh-SEHR",e:"🤝"}, {w:"Recordar",t:"To remember",p:"reh-kor-DAR",e:"🧾"},
    {w:"Llamar",t:"To call",p:"yah-MAR",e:"📞"}, {w:"Esperar",t:"To wait/hope",p:"es-peh-RAR",e:"⏳"},
    {w:"Terminar",t:"To finish",p:"ter-mee-NAR",e:"🏁"}, {w:"Comer",t:"To eat",p:"koh-MEHR",e:"🍽"},
    {w:"Beber",t:"To drink",p:"beh-BEHR",e:"🥤"}, {w:"Dormir",t:"To sleep",p:"dor-MEER",e:"😴"},
    {w:"Abrir",t:"To open",p:"ah-BREER",e:"🔓"}, {w:"Cerrar",t:"To close",p:"seh-RRAR",e:"🔒"},
    {w:"Comprar",t:"To buy",p:"kom-PRAR",e:"🛒"}, {w:"Pagar",t:"To pay",p:"pah-GAR",e:"💳"},
    {w:"Leer",t:"To read",p:"leh-EHR",e:"📖"}, {w:"Escribir",t:"To write",p:"es-kree-BEER",e:"✍️"},
    {w:"Escuchar",t:"To listen",p:"es-koo-CHAR",e:"🎧"}, {w:"Jugar",t:"To play",p:"hoo-GAR",e:"🎮"},
    {w:"Correr",t:"To run",p:"koh-RREHR",e:"🏃"}, {w:"Caminar",t:"To walk",p:"kah-mee-NAR",e:"🚶"},
    {w:"Ayudar",t:"To help",p:"ah-yoo-DAR",e:"🆘"}, {w:"Amar",t:"To love",p:"ah-MAR",e:"❤️"},
    {w:"Trabajar",t:"To work",p:"trah-bah-HAR",e:"💼"}, {w:"Estudiar",t:"To study",p:"es-too-DYAR",e:"📚"},
    {w:"Aprender",t:"To learn",p:"ah-pren-DEHR",e:"🎓"}, {w:"Enseñar",t:"To teach",p:"en-sen-YAR",e:"👩‍🏫"},
    {w:"Empezar",t:"To begin",p:"em-peh-SAR",e:"▶️"}, {w:"Buscar",t:"To search",p:"boos-KAR",e:"🔎"},
    {w:"Usar",t:"To use",p:"oo-SAR",e:"🛠"}, {w:"Preguntar",t:"To ask",p:"preh-goon-TAR",e:"❓"},
    {w:"Responder",t:"To answer",p:"res-pon-DEHR",e:"💬"}, {w:"Salir",t:"To go out",p:"sah-LEER",e:"🚪"},
    {w:"Entrar",t:"To enter",p:"en-TRAR",e:"➡️"}, {w:"Perder",t:"To lose",p:"per-DEHR",e:"🫥"},
    {w:"Ganar",t:"To win/earn",p:"gah-NAR",e:"🏆"}, {w:"Cambiar",t:"To change",p:"kam-BYAR",e:"🔄"},
    {w:"Yo",t:"I",p:"yoh",e:"🙋"}, {w:"Tú",t:"You",p:"too",e:"👉"},
    {w:"Él",t:"He",p:"el",e:"👨"}, {w:"Ella",t:"She",p:"EH-yah",e:"👩"},
    {w:"Nosotros",t:"We",p:"noh-SOH-trohs",e:"👥"}, {w:"Ellos",t:"They",p:"EH-yohs",e:"👪"},
    {w:"Esto",t:"This",p:"ES-toh",e:"👇"}, {w:"Eso",t:"That",p:"EH-soh",e:"👉"},
    {w:"Todo",t:"Everything",p:"TOH-doh",e:"🌐"}, {w:"Nada",t:"Nothing",p:"NAH-dah",e:"🚫"},
    {w:"Algo",t:"Something",p:"AHL-goh",e:"❔"}, {w:"Alguien",t:"Someone",p:"AHL-gyen",e:"👤"},
    {w:"Nadie",t:"Nobody",p:"NAH-dyeh",e:"🙅"}, {w:"Mucho",t:"A lot",p:"MOO-choh",e:"📈"},
    {w:"Poco",t:"Little/few",p:"POH-koh",e:"🤏"}, {w:"Demasiado",t:"Too much",p:"deh-mah-SYAH-doh",e:"🛑"},
    {w:"Más",t:"More",p:"mahs",e:"➕"}, {w:"Menos",t:"Less",p:"MEH-nohs",e:"➖"},
    {w:"También",t:"Also",p:"tahm-BYEN",e:"➕"}, {w:"Siempre",t:"Always",p:"SYEM-preh",e:"♾️"},
    {w:"Nunca",t:"Never",p:"NOON-kah",e:"🚫"}, {w:"Ya",t:"Already",p:"yah",e:"✔️"},
    {w:"Todavía",t:"Still/yet",p:"toh-dah-BEE-ah",e:"🔁"}, {w:"Ahora",t:"Now",p:"ah-OH-rah",e:"⏱"},
    {w:"Después",t:"After/later",p:"des-PWES",e:"⏭"}, {w:"Antes",t:"Before",p:"AHN-tes",e:"⏮"},
    {w:"Aquí",t:"Here",p:"ah-KEE",e:"📍"}, {w:"Allí",t:"There",p:"ah-YEE",e:"🗺"},
    {w:"Dónde",t:"Where",p:"DON-deh",e:"🧭"}, {w:"Cuándo",t:"When",p:"KWAN-doh",e:"📅"},
    {w:"Por qué",t:"Why",p:"por KEH",e:"❓"}, {w:"Cómo",t:"How",p:"KOH-moh",e:"🤔"},
    {w:"Quién",t:"Who",p:"kyen",e:"👤"}, {w:"Qué",t:"What",p:"keh",e:"❔"},
    {w:"Cuál",t:"Which",p:"kwahl",e:"🔀"}, {w:"Cuánto",t:"How much",p:"KWAN-toh",e:"⚖️"},
    {w:"Uno",t:"One",p:"OO-noh",e:"1️⃣"}, {w:"Dos",t:"Two",p:"dohs",e:"2️⃣"},
    {w:"Tres",t:"Three",p:"trehs",e:"3️⃣"}, {w:"Cuatro",t:"Four",p:"KWAH-troh",e:"4️⃣"},
    {w:"Cinco",t:"Five",p:"SEEN-koh",e:"5️⃣"}, {w:"Seis",t:"Six",p:"says",e:"6️⃣"},
    {w:"Siete",t:"Seven",p:"SYEH-teh",e:"7️⃣"}, {w:"Ocho",t:"Eight",p:"OH-choh",e:"8️⃣"},
    {w:"Nueve",t:"Nine",p:"NWEH-beh",e:"9️⃣"}, {w:"Diez",t:"Ten",p:"dyes",e:"🔟"},
    {w:"Once",t:"Eleven",p:"ON-seh",e:"🔢"}, {w:"Doce",t:"Twelve",p:"DOH-seh",e:"🔢"},
    {w:"Veinte",t:"Twenty",p:"BAYN-teh",e:"🔢"}, {w:"Treinta",t:"Thirty",p:"TRAYN-tah",e:"🔢"},
    {w:"Cuarenta",t:"Forty",p:"kwah-REN-tah",e:"🔢"}, {w:"Cincuenta",t:"Fifty",p:"seen-KWEN-tah",e:"🔢"},
    {w:"Cien",t:"Hundred",p:"syen",e:"💯"}, {w:"Mil",t:"Thousand",p:"meel",e:"🔢"},
    {w:"Primero",t:"First",p:"pree-MEH-roh",e:"🥇"}, {w:"Segundo",t:"Second",p:"seh-GOON-doh",e:"🥈"},
    {w:"Último",t:"Last",p:"OOL-tee-moh",e:"🔚"}, {w:"Lunes",t:"Monday",p:"LOO-nes",e:"📅"},
    {w:"Martes",t:"Tuesday",p:"MAR-tes",e:"📅"}, {w:"Miércoles",t:"Wednesday",p:"MYER-koh-les",e:"📅"},
    {w:"Jueves",t:"Thursday",p:"HWEH-bes",e:"📅"}, {w:"Viernes",t:"Friday",p:"BYER-nes",e:"📅"},
    {w:"Sábado",t:"Saturday",p:"SAH-bah-doh",e:"📅"}, {w:"Domingo",t:"Sunday",p:"doh-MEEN-goh",e:"📅"},
    {w:"Hoy",t:"Today",p:"oy",e:"📆"}, {w:"Mañana",t:"Tomorrow/morning",p:"mahn-YAH-nah",e:"🌅"},
    {w:"Ayer",t:"Yesterday",p:"ah-YEHR",e:"🌇"}, {w:"Semana",t:"Week",p:"seh-MAH-nah",e:"🗓"},
    {w:"Mes",t:"Month",p:"mes",e:"🗓"}, {w:"Año",t:"Year",p:"AHN-yoh",e:"🎆"},
    {w:"Día",t:"Day",p:"DEE-ah",e:"☀️"}, {w:"Noche",t:"Night",p:"NOH-cheh",e:"🌙"},
    {w:"Tarde",t:"Afternoon/late",p:"TAR-deh",e:"🌆"}, {w:"Hora",t:"Hour",p:"OH-rah",e:"🕐"},
    {w:"Minuto",t:"Minute",p:"mee-NOO-toh",e:"⏱"}, {w:"Enero",t:"January",p:"eh-NEH-roh",e:"❄️"},
    {w:"Febrero",t:"February",p:"feh-BREH-roh",e:"💘"}, {w:"Marzo",t:"March",p:"MAR-soh",e:"🌸"},
    {w:"Abril",t:"April",p:"ah-BREEL",e:"🌷"}, {w:"Mayo",t:"May",p:"MAH-yoh",e:"🌼"},
    {w:"Junio",t:"June",p:"HOO-nyoh",e:"☀️"}, {w:"Julio",t:"July",p:"HOO-lyoh",e:"🏖"},
    {w:"Agosto",t:"August",p:"ah-GOS-toh",e:"🌞"}, {w:"Septiembre",t:"September",p:"sep-TYEM-breh",e:"🍂"},
    {w:"Octubre",t:"October",p:"ok-TOO-breh",e:"🎃"}, {w:"Noviembre",t:"November",p:"noh-BYEM-breh",e:"🌧"},
    {w:"Diciembre",t:"December",p:"dee-SYEM-breh",e:"🎄"}, {w:"Rojo",t:"Red",p:"ROH-hoh",e:"🔴"},
    {w:"Azul",t:"Blue",p:"ah-SOOL",e:"🔵"}, {w:"Verde",t:"Green",p:"BEHR-deh",e:"🟢"},
    {w:"Amarillo",t:"Yellow",p:"ah-mah-REE-yoh",e:"🟡"}, {w:"Negro",t:"Black",p:"NEH-groh",e:"⚫"},
    {w:"Blanco",t:"White",p:"BLAHN-koh",e:"⚪"}, {w:"Gris",t:"Grey",p:"grees",e:"🩶"},
    {w:"Marrón",t:"Brown",p:"mah-RRON",e:"🟤"}, {w:"Rosa",t:"Pink",p:"ROH-sah",e:"🌸"},
    {w:"Naranja",t:"Orange",p:"nah-RAHN-hah",e:"🟠"}, {w:"Morado",t:"Purple",p:"moh-RAH-doh",e:"🟣"},
    {w:"Hijo",t:"Son",p:"EE-hoh",e:"👦"}, {w:"Hija",t:"Daughter",p:"EE-hah",e:"👧"},
    {w:"Hermano",t:"Brother",p:"er-MAH-noh",e:"👬"}, {w:"Hermana",t:"Sister",p:"er-MAH-nah",e:"👭"},
    {w:"Abuelo",t:"Grandfather",p:"ah-BWEH-loh",e:"👴"}, {w:"Abuela",t:"Grandmother",p:"ah-BWEH-lah",e:"👵"},
    {w:"Tío",t:"Uncle",p:"TEE-oh",e:"👨"}, {w:"Tía",t:"Aunt",p:"TEE-ah",e:"👩"},
    {w:"Marido",t:"Husband",p:"mah-REE-doh",e:"🤵"}, {w:"Mujer",t:"Woman/wife",p:"moo-HEHR",e:"👩"},
    {w:"Niño",t:"Child",p:"NEEN-yoh",e:"👶"}, {w:"Chico",t:"Boy",p:"CHEE-koh",e:"🧑"},
    {w:"Chica",t:"Girl",p:"CHEE-kah",e:"👧"}, {w:"Hombre",t:"Man",p:"OM-breh",e:"👨"},
    {w:"Gente",t:"People",p:"HEN-teh",e:"👥"}, {w:"Persona",t:"Person",p:"per-SOH-nah",e:"👤"},
    {w:"Cabeza",t:"Head",p:"kah-BEH-sah",e:"🗣"}, {w:"Ojo",t:"Eye",p:"OH-hoh",e:"👁"},
    {w:"Mano",t:"Hand",p:"MAH-noh",e:"✋"}, {w:"Pie",t:"Foot",p:"pyeh",e:"🦶"},
    {w:"Corazón",t:"Heart",p:"koh-rah-SON",e:"❤️"}, {w:"Boca",t:"Mouth",p:"BOH-kah",e:"👄"},
    {w:"Nariz",t:"Nose",p:"nah-REES",e:"👃"}, {w:"Oreja",t:"Ear",p:"oh-REH-hah",e:"👂"},
    {w:"Brazo",t:"Arm",p:"BRAH-soh",e:"💪"}, {w:"Pierna",t:"Leg",p:"PYER-nah",e:"🦵"},
    {w:"Pelo",t:"Hair",p:"PEH-loh",e:"💇"}, {w:"Cara",t:"Face",p:"KAH-rah",e:"🙂"},
    {w:"Pan",t:"Bread",p:"pahn",e:"🍞"}, {w:"Leche",t:"Milk",p:"LEH-cheh",e:"🥛"},
    {w:"Vino",t:"Wine",p:"BEE-noh",e:"🍷"}, {w:"Cerveza",t:"Beer",p:"ser-BEH-sah",e:"🍺"},
    {w:"Café",t:"Coffee",p:"kah-FEH",e:"☕"}, {w:"Té",t:"Tea",p:"teh",e:"🍵"},
    {w:"Carne",t:"Meat",p:"KAR-neh",e:"🥩"}, {w:"Pescado",t:"Fish (food)",p:"pes-KAH-doh",e:"🐟"},
    {w:"Pollo",t:"Chicken",p:"POH-yoh",e:"🍗"}, {w:"Arroz",t:"Rice",p:"ah-RROS",e:"🍚"},
    {w:"Queso",t:"Cheese",p:"KEH-soh",e:"🧀"}, {w:"Huevo",t:"Egg",p:"WEH-boh",e:"🥚"},
    {w:"Fruta",t:"Fruit",p:"FROO-tah",e:"🍎"}, {w:"Manzana",t:"Apple",p:"man-SAH-nah",e:"🍏"},
    {w:"Plátano",t:"Banana",p:"PLAH-tah-noh",e:"🍌"}, {w:"Verdura",t:"Vegetables",p:"ber-DOO-rah",e:"🥦"},
    {w:"Tomate",t:"Tomato",p:"toh-MAH-teh",e:"🍅"}, {w:"Patata",t:"Potato",p:"pah-TAH-tah",e:"🥔"},
    {w:"Ensalada",t:"Salad",p:"en-sah-LAH-dah",e:"🥗"}, {w:"Azúcar",t:"Sugar",p:"ah-SOO-kar",e:"🍬"},
    {w:"Sal",t:"Salt",p:"sahl",e:"🧂"}, {w:"Aceite",t:"Oil",p:"ah-SAY-teh",e:"🫒"},
    {w:"Dulce",t:"Sweet",p:"DOOL-seh",e:"🍰"}, {w:"Helado",t:"Ice cream",p:"eh-LAH-doh",e:"🍨"},
    {w:"Desayuno",t:"Breakfast",p:"deh-sah-YOO-noh",e:"🥐"}, {w:"Almuerzo",t:"Lunch",p:"al-MWER-soh",e:"🍽"},
    {w:"Cena",t:"Dinner",p:"SEH-nah",e:"🌙"}, {w:"Restaurante",t:"Restaurant",p:"res-tow-RAHN-teh",e:"🍴"},
    {w:"Mesa",t:"Table",p:"MEH-sah",e:"🪑"}, {w:"Puerta",t:"Door",p:"PWER-tah",e:"🚪"},
    {w:"Ventana",t:"Window",p:"ben-TAH-nah",e:"🪟"}, {w:"Habitación",t:"Room",p:"ah-bee-tah-SYON",e:"🛏"},
    {w:"Cocina",t:"Kitchen",p:"koh-SEE-nah",e:"🍳"}, {w:"Baño",t:"Bathroom",p:"BAHN-yoh",e:"🛁"},
    {w:"Cama",t:"Bed",p:"KAH-mah",e:"🛌"}, {w:"Silla",t:"Chair",p:"SEE-yah",e:"🪑"},
    {w:"Llave",t:"Key",p:"YAH-beh",e:"🔑"}, {w:"Luz",t:"Light",p:"loos",e:"💡"},
    {w:"Calle",t:"Street",p:"KAH-yeh",e:"🛣"}, {w:"Tienda",t:"Shop",p:"TYEN-dah",e:"🏪"},
    {w:"Mercado",t:"Market",p:"mer-KAH-doh",e:"🛍"}, {w:"Escuela",t:"School",p:"es-KWEH-lah",e:"🏫"},
    {w:"Hospital",t:"Hospital",p:"os-pee-TAHL",e:"🏥"}, {w:"Iglesia",t:"Church",p:"ee-GLEH-syah",e:"⛪"},
    {w:"Banco",t:"Bank",p:"BAHN-koh",e:"🏦"}, {w:"Oficina",t:"Office",p:"oh-fee-SEE-nah",e:"🏢"},
    {w:"Estación",t:"Station",p:"es-tah-SYON",e:"🚉"}, {w:"Aeropuerto",t:"Airport",p:"ah-eh-roh-PWER-toh",e:"✈️"},
    {w:"Hotel",t:"Hotel",p:"oh-TEL",e:"🏨"}, {w:"Coche",t:"Car",p:"KOH-cheh",e:"🚗"},
    {w:"Tren",t:"Train",p:"tren",e:"🚆"}, {w:"Autobús",t:"Bus",p:"ow-toh-BOOS",e:"🚌"},
    {w:"Avión",t:"Airplane",p:"ah-BYON",e:"🛩"}, {w:"Bicicleta",t:"Bicycle",p:"bee-see-KLEH-tah",e:"🚲"},
    {w:"Billete",t:"Ticket",p:"bee-YEH-teh",e:"🎫"}, {w:"Nuevo",t:"New",p:"NWEH-boh",e:"✨"},
    {w:"Viejo",t:"Old",p:"BYEH-hoh",e:"🏚"}, {w:"Joven",t:"Young",p:"HOH-ben",e:"🧒"},
    {w:"Bonito",t:"Pretty",p:"boh-NEE-toh",e:"😍"}, {w:"Feo",t:"Ugly",p:"FEH-oh",e:"🫣"},
    {w:"Bueno",t:"Good",p:"BWEH-noh",e:"👌"}, {w:"Caliente",t:"Hot",p:"kah-LYEN-teh",e:"🔥"},
    {w:"Frío",t:"Cold",p:"FREE-oh",e:"🧊"}, {w:"Alto",t:"Tall/high",p:"AHL-toh",e:"📏"},
    {w:"Bajo",t:"Short/low",p:"BAH-hoh",e:"📉"}, {w:"Largo",t:"Long",p:"LAR-goh",e:"📏"},
    {w:"Corto",t:"Short (length)",p:"KOR-toh",e:"✂️"}, {w:"Fuerte",t:"Strong",p:"FWER-teh",e:"💪"},
    {w:"Débil",t:"Weak",p:"DEH-beel",e:"🪶"}, {w:"Fácil",t:"Easy",p:"FAH-seel",e:"🟢"},
    {w:"Difícil",t:"Difficult",p:"dee-FEE-seel",e:"🔴"}, {w:"Importante",t:"Important",p:"eem-por-TAHN-teh",e:"⭐"},
    {w:"Correcto",t:"Correct",p:"koh-RREK-toh",e:"✅"}, {w:"Equivocado",t:"Wrong",p:"eh-kee-boh-KAH-doh",e:"❌"},
    {w:"Verdadero",t:"True",p:"ber-dah-DEH-roh",e:"✔️"}, {w:"Falso",t:"False",p:"FAHL-soh",e:"✖️"},
    {w:"Lleno",t:"Full",p:"YEH-noh",e:"🈵"}, {w:"Vacío",t:"Empty",p:"bah-SEE-oh",e:"🈳"},
    {w:"Abierto",t:"Open",p:"ah-BYER-toh",e:"🔓"}, {w:"Cerrado",t:"Closed",p:"seh-RRAH-doh",e:"🔒"},
    {w:"Limpio",t:"Clean",p:"LEEM-pyoh",e:"🧼"}, {w:"Sucio",t:"Dirty",p:"SOO-syoh",e:"🧹"},
    {w:"Rico",t:"Rich/tasty",p:"REE-koh",e:"💎"}, {w:"Pobre",t:"Poor",p:"POH-breh",e:"🪙"},
    {w:"Libre",t:"Free",p:"LEE-breh",e:"🕊"}, {w:"Ocupado",t:"Busy",p:"oh-koo-PAH-doh",e:"📵"},
    {w:"Listo",t:"Ready/clever",p:"LEES-toh",e:"🚦"}, {w:"Seguro",t:"Safe/sure",p:"seh-GOO-roh",e:"🛡"},
    {w:"Mismo",t:"Same",p:"MEES-moh",e:"🟰"}, {w:"Diferente",t:"Different",p:"dee-feh-REN-teh",e:"🔀"},
    {w:"Caro",t:"Expensive",p:"KAH-roh",e:"💸"}, {w:"Barato",t:"Cheap",p:"bah-RAH-toh",e:"🏷"},
    {w:"Sol",t:"Sun",p:"sohl",e:"☀️"}, {w:"Luna",t:"Moon",p:"LOO-nah",e:"🌙"},
    {w:"Estrella",t:"Star",p:"es-TREH-yah",e:"⭐"}, {w:"Cielo",t:"Sky",p:"SYEH-loh",e:"🌤"},
    {w:"Mar",t:"Sea",p:"mar",e:"🌊"}, {w:"Montaña",t:"Mountain",p:"mon-TAHN-yah",e:"⛰"},
    {w:"Río",t:"River",p:"REE-oh",e:"🏞"}, {w:"Árbol",t:"Tree",p:"AR-bol",e:"🌳"},
    {w:"Flor",t:"Flower",p:"flor",e:"🌸"}, {w:"Lluvia",t:"Rain",p:"YOO-byah",e:"🌧"},
    {w:"Nieve",t:"Snow",p:"NYEH-beh",e:"❄️"}, {w:"Viento",t:"Wind",p:"BYEN-toh",e:"💨"},
    {w:"Fuego",t:"Fire",p:"FWEH-goh",e:"🔥"}, {w:"Tierra",t:"Earth",p:"TYEH-rrah",e:"🌍"},
    {w:"Aire",t:"Air",p:"AY-reh",e:"🌬"}, {w:"Cosa",t:"Thing",p:"KOH-sah",e:"📦"},
    {w:"Vida",t:"Life",p:"BEE-dah",e:"🌱"}, {w:"Mundo",t:"World",p:"MOON-doh",e:"🌎"},
    {w:"País",t:"Country",p:"pah-EES",e:"🗺"}, {w:"Lugar",t:"Place",p:"loo-GAR",e:"📍"},
    {w:"Parte",t:"Part",p:"PAR-teh",e:"🧩"}, {w:"Vez",t:"Time (occasion)",p:"bes",e:"🔁"},
    {w:"Nombre",t:"Name",p:"NOM-breh",e:"🏷"}, {w:"Palabra",t:"Word",p:"pah-LAH-brah",e:"🔤"},
    {w:"Pregunta",t:"Question",p:"preh-GOON-tah",e:"❓"}, {w:"Respuesta",t:"Answer",p:"res-PWES-tah",e:"💬"},
    {w:"Problema",t:"Problem",p:"proh-BLEH-mah",e:"⚠️"}, {w:"Idea",t:"Idea",p:"ee-DEH-ah",e:"💡"},
    {w:"Historia",t:"Story/history",p:"ees-TOH-ryah",e:"📜"}, {w:"Música",t:"Music",p:"MOO-see-kah",e:"🎵"},
    {w:"Película",t:"Movie",p:"peh-LEE-koo-lah",e:"🎬"}, {w:"Foto",t:"Photo",p:"FOH-toh",e:"📷"},
    {w:"Teléfono",t:"Telephone",p:"teh-LEH-foh-noh",e:"📱"}, {w:"Juego",t:"Game",p:"HWEH-goh",e:"🎲"},
    {w:"Deporte",t:"Sport",p:"deh-POR-teh",e:"⚽"}, {w:"Fútbol",t:"Football",p:"FOOT-bol",e:"⚽"},
    {w:"Buenos días",t:"Good morning",p:"BWEH-nohs DEE-ahs",e:"🌅"}, {w:"Buenas tardes",t:"Good afternoon",p:"BWEH-nahs TAR-des",e:"🌆"},
    {w:"Buenas noches",t:"Good night",p:"BWEH-nahs NOH-ches",e:"🌙"}, {w:"Adiós",t:"Goodbye",p:"ah-DYOS",e:"👋"},
    {w:"Hasta luego",t:"See you later",p:"AHS-tah LWEH-goh",e:"👋"}, {w:"Perdón",t:"Sorry/excuse me",p:"per-DON",e:"🙇"},
    {w:"De nada",t:"You're welcome",p:"deh NAH-dah",e:"🤲"}, {w:"Está bien",t:"It's okay",p:"es-TAH byen",e:"👌"},
    {w:"No lo sé",t:"I don't know",p:"noh loh seh",e:"🤷"}, {w:"No entiendo",t:"I don't understand",p:"noh en-TYEN-doh",e:"😕"},
    {w:"¿Cuánto cuesta?",t:"How much is it?",p:"KWAN-toh KWES-tah",e:"💶"}, {w:"¿Dónde está?",t:"Where is it?",p:"DON-deh es-TAH",e:"🧭"},
    {w:"¿Qué hora es?",t:"What time is it?",p:"keh OH-rah es",e:"🕐"}, {w:"Me llamo",t:"My name is",p:"meh YAH-moh",e:"🪪"},
    {w:"Mucho gusto",t:"Nice to meet you",p:"MOO-choh GOOS-toh",e:"🤝"}, {w:"¡Ayuda!",t:"Help!",p:"ah-YOO-dah",e:"🆘"},
    {w:"¡Salud!",t:"Cheers/bless you",p:"sah-LOOD",e:"🥂"}, {w:"Felicidades",t:"Congratulations",p:"feh-lee-see-DAH-des",e:"🎉"},
    {w:"Bienvenido",t:"Welcome",p:"byen-beh-NEE-doh",e:"🎊"}, {w:"¡Vamos!",t:"Let's go!",p:"BAH-mohs",e:"🚀"}
  ],
  fr: [
    {w:"Bonjour",    t:"Hello",       p:"bon-ZHOOR",      e:"🙋"}, {w:"Merci",      t:"Thank you",   p:"mair-SEE",       e:"🙏"},
    {w:"S'il vous plaît",t:"Please",  p:"seel voo PLAY",  e:"✋"}, {w:"Oui",        t:"Yes",         p:"wee",            e:"✅"},
    {w:"Non",        t:"No",          p:"noh",            e:"❌"}, {w:"Eau",        t:"Water",       p:"oh",             e:"💧"},
    {w:"Nourriture", t:"Food",        p:"noo-ree-TOOR",   e:"🍽"}, {w:"Maison",     t:"House",       p:"meh-ZON",        e:"🏠"},
    {w:"Ami",        t:"Friend",      p:"ah-MEE",         e:"👫"}, {w:"Amour",      t:"Love",        p:"ah-MOOR",        e:"❤️"},
    {w:"Travail",    t:"Work",        p:"trah-VYE",       e:"💼"}, {w:"Argent",     t:"Money",       p:"ar-ZHON",        e:"💰"},
    {w:"Temps",      t:"Time",        p:"ton",            e:"⏰"}, {w:"Bien",       t:"Good",        p:"byan",           e:"👍"},
    {w:"Mal",        t:"Bad",         p:"mal",            e:"👎"}, {w:"Grand",      t:"Big",         p:"gron",           e:"🐘"},
    {w:"Petit",      t:"Small",       p:"puh-TEE",        e:"🐭"}, {w:"Vite",       t:"Fast",        p:"veet",           e:"🏃"},
    {w:"Lent",       t:"Slow",        p:"lon",            e:"🐢"}, {w:"Heureux",    t:"Happy",       p:"uh-RUH",         e:"😊"},
    {w:"Triste",     t:"Sad",         p:"treest",         e:"😢"}, {w:"Fatigué",    t:"Tired",       p:"fah-tee-GAY",    e:"😴"},
    {w:"Faim",       t:"Hungry",      p:"fan",            e:"🤤"}, {w:"Soif",       t:"Thirsty",     p:"swaf",           e:"😮"},
    {w:"Famille",    t:"Family",      p:"fah-MEEY",       e:"👨‍👩‍👧"}, {w:"Mère",       t:"Mother",      p:"mair",           e:"👩"},
    {w:"Père",       t:"Father",      p:"pair",           e:"👨"}, {w:"Livre",      t:"Book",        p:"leevr",          e:"📚"},
    {w:"Ville",      t:"City",        p:"veel",           e:"🏙"}, {w:"Plage",      t:"Beach",       p:"plazh",          e:"🏖"},
    {w:"Être",t:"To be",p:"EH-truh",e:"🧍"}, {w:"Avoir",t:"To have",p:"ah-VWAR",e:"🤲"},
    {w:"Faire",t:"To do/make",p:"fehr",e:"🔨"}, {w:"Dire",t:"To say",p:"deer",e:"🗣"},
    {w:"Pouvoir",t:"To be able",p:"poo-VWAR",e:"💪"}, {w:"Vouloir",t:"To want",p:"voo-LWAR",e:"🙌"},
    {w:"Savoir",t:"To know",p:"sah-VWAR",e:"🧠"}, {w:"Devoir",t:"To have to",p:"duh-VWAR",e:"📋"},
    {w:"Voir",t:"To see",p:"vwar",e:"👀"}, {w:"Aller",t:"To go",p:"ah-LEH",e:"🚶"},
    {w:"Venir",t:"To come",p:"vuh-NEER",e:"👋"}, {w:"Donner",t:"To give",p:"doh-NEH",e:"🎁"},
    {w:"Parler",t:"To speak",p:"par-LEH",e:"💬"}, {w:"Trouver",t:"To find",p:"troo-VEH",e:"🔍"},
    {w:"Sentir",t:"To feel/smell",p:"sahn-TEER",e:"💗"}, {w:"Prendre",t:"To take",p:"PRAHN-druh",e:"✊"},
    {w:"Regarder",t:"To look at",p:"ruh-gar-DEH",e:"👁"}, {w:"Mettre",t:"To put",p:"MEH-truh",e:"📥"},
    {w:"Penser",t:"To think",p:"pahn-SEH",e:"💭"}, {w:"Croire",t:"To believe",p:"krwar",e:"🙏"},
    {w:"Porter",t:"To carry/wear",p:"por-TEH",e:"🎒"}, {w:"Vivre",t:"To live",p:"VEE-vruh",e:"🌱"},
    {w:"Revenir",t:"To come back",p:"ruh-vuh-NEER",e:"🔙"}, {w:"Comprendre",t:"To understand",p:"kom-PRAHN-druh",e:"💡"},
    {w:"Arriver",t:"To arrive",p:"ah-ree-VEH",e:"🏁"}, {w:"Connaître",t:"To know (people)",p:"koh-NEH-truh",e:"🤝"},
    {w:"Appeler",t:"To call",p:"ah-PLEH",e:"📞"}, {w:"Attendre",t:"To wait",p:"ah-TAHN-druh",e:"⏳"},
    {w:"Finir",t:"To finish",p:"fee-NEER",e:"🏁"}, {w:"Manger",t:"To eat",p:"mahn-JEH",e:"🍽"},
    {w:"Boire",t:"To drink",p:"bwar",e:"🥤"}, {w:"Dormir",t:"To sleep",p:"dor-MEER",e:"😴"},
    {w:"Ouvrir",t:"To open",p:"oo-VREER",e:"🔓"}, {w:"Fermer",t:"To close",p:"fer-MEH",e:"🔒"},
    {w:"Acheter",t:"To buy",p:"ash-TEH",e:"🛒"}, {w:"Payer",t:"To pay",p:"peh-YEH",e:"💳"},
    {w:"Lire",t:"To read",p:"leer",e:"📖"}, {w:"Écrire",t:"To write",p:"eh-KREER",e:"✍️"},
    {w:"Écouter",t:"To listen",p:"eh-koo-TEH",e:"🎧"}, {w:"Jouer",t:"To play",p:"zhoo-EH",e:"🎮"},
    {w:"Courir",t:"To run",p:"koo-REER",e:"🏃"}, {w:"Marcher",t:"To walk",p:"mar-SHEH",e:"🚶"},
    {w:"Aider",t:"To help",p:"eh-DEH",e:"🆘"}, {w:"Aimer",t:"To love/like",p:"eh-MEH",e:"❤️"},
    {w:"Travailler",t:"To work",p:"trah-vah-YEH",e:"💼"}, {w:"Étudier",t:"To study",p:"eh-tü-DYEH",e:"📚"},
    {w:"Apprendre",t:"To learn",p:"ah-PRAHN-druh",e:"🎓"}, {w:"Enseigner",t:"To teach",p:"ahn-seh-NYEH",e:"👩‍🏫"},
    {w:"Commencer",t:"To begin",p:"koh-mahn-SEH",e:"▶️"}, {w:"Chercher",t:"To search",p:"sher-SHEH",e:"🔎"},
    {w:"Utiliser",t:"To use",p:"ü-tee-lee-ZEH",e:"🛠"}, {w:"Demander",t:"To ask",p:"duh-mahn-DEH",e:"❓"},
    {w:"Répondre",t:"To answer",p:"reh-PON-druh",e:"💬"}, {w:"Sortir",t:"To go out",p:"sor-TEER",e:"🚪"},
    {w:"Entrer",t:"To enter",p:"ahn-TREH",e:"➡️"}, {w:"Perdre",t:"To lose",p:"PEHR-druh",e:"🫥"},
    {w:"Gagner",t:"To win/earn",p:"gah-NYEH",e:"🏆"}, {w:"Essayer",t:"To try",p:"eh-seh-YEH",e:"🎯"},
    {w:"Changer",t:"To change",p:"shahn-JEH",e:"🔄"}, {w:"Je",t:"I",p:"zhuh",e:"🙋"},
    {w:"Tu",t:"You",p:"tü",e:"👉"}, {w:"Il",t:"He",p:"eel",e:"👨"},
    {w:"Elle",t:"She",p:"el",e:"👩"}, {w:"Nous",t:"We",p:"noo",e:"👥"},
    {w:"Vous",t:"You (formal/plural)",p:"voo",e:"👫"}, {w:"Ils",t:"They",p:"eel",e:"👪"},
    {w:"Ceci",t:"This",p:"suh-SEE",e:"👇"}, {w:"Cela",t:"That",p:"suh-LAH",e:"👉"},
    {w:"Tout",t:"Everything/all",p:"too",e:"🌐"}, {w:"Rien",t:"Nothing",p:"ryan",e:"🚫"},
    {w:"Quelque chose",t:"Something",p:"kel-kuh SHOZ",e:"❔"}, {w:"Quelqu'un",t:"Someone",p:"kel-KUHN",e:"👤"},
    {w:"Personne",t:"Nobody/person",p:"pehr-SON",e:"🙅"}, {w:"Beaucoup",t:"A lot",p:"boh-KOO",e:"📈"},
    {w:"Peu",t:"Little/few",p:"puh",e:"🤏"}, {w:"Trop",t:"Too much",p:"troh",e:"🛑"},
    {w:"Plus",t:"More",p:"plü",e:"➕"}, {w:"Moins",t:"Less",p:"mwan",e:"➖"},
    {w:"Aussi",t:"Also",p:"oh-SEE",e:"➕"}, {w:"Toujours",t:"Always",p:"too-ZHOOR",e:"♾️"},
    {w:"Jamais",t:"Never",p:"zhah-MEH",e:"🚫"}, {w:"Déjà",t:"Already",p:"deh-ZHAH",e:"✔️"},
    {w:"Encore",t:"Still/again",p:"ahn-KOR",e:"🔁"}, {w:"Maintenant",t:"Now",p:"mant-NAHN",e:"⏱"},
    {w:"Après",t:"After",p:"ah-PREH",e:"⏭"}, {w:"Avant",t:"Before",p:"ah-VAHN",e:"⏮"},
    {w:"Ici",t:"Here",p:"ee-SEE",e:"📍"}, {w:"Là",t:"There",p:"lah",e:"🗺"},
    {w:"Où",t:"Where",p:"oo",e:"🧭"}, {w:"Quand",t:"When",p:"kahn",e:"📅"},
    {w:"Pourquoi",t:"Why",p:"poor-KWAH",e:"❓"}, {w:"Comment",t:"How",p:"koh-MAHN",e:"🤔"},
    {w:"Qui",t:"Who",p:"kee",e:"👤"}, {w:"Quoi",t:"What",p:"kwah",e:"❔"},
    {w:"Quel",t:"Which",p:"kel",e:"🔀"}, {w:"Combien",t:"How much",p:"kom-BYAN",e:"⚖️"},
    {w:"Un",t:"One",p:"uhn",e:"1️⃣"}, {w:"Deux",t:"Two",p:"duh",e:"2️⃣"},
    {w:"Trois",t:"Three",p:"trwah",e:"3️⃣"}, {w:"Quatre",t:"Four",p:"KAH-truh",e:"4️⃣"},
    {w:"Cinq",t:"Five",p:"sank",e:"5️⃣"}, {w:"Six",t:"Six",p:"sees",e:"6️⃣"},
    {w:"Sept",t:"Seven",p:"set",e:"7️⃣"}, {w:"Huit",t:"Eight",p:"weet",e:"8️⃣"},
    {w:"Neuf",t:"Nine",p:"nuhf",e:"9️⃣"}, {w:"Dix",t:"Ten",p:"dees",e:"🔟"},
    {w:"Onze",t:"Eleven",p:"onz",e:"🔢"}, {w:"Douze",t:"Twelve",p:"dooz",e:"🔢"},
    {w:"Vingt",t:"Twenty",p:"van",e:"🔢"}, {w:"Trente",t:"Thirty",p:"trahnt",e:"🔢"},
    {w:"Quarante",t:"Forty",p:"kah-RAHNT",e:"🔢"}, {w:"Cinquante",t:"Fifty",p:"san-KAHNT",e:"🔢"},
    {w:"Cent",t:"Hundred",p:"sahn",e:"💯"}, {w:"Mille",t:"Thousand",p:"meel",e:"🔢"},
    {w:"Premier",t:"First",p:"pruh-MYEH",e:"🥇"}, {w:"Deuxième",t:"Second",p:"duh-ZYEM",e:"🥈"},
    {w:"Dernier",t:"Last",p:"dehr-NYEH",e:"🔚"}, {w:"Lundi",t:"Monday",p:"luhn-DEE",e:"📅"},
    {w:"Mardi",t:"Tuesday",p:"mar-DEE",e:"📅"}, {w:"Mercredi",t:"Wednesday",p:"mehr-kruh-DEE",e:"📅"},
    {w:"Jeudi",t:"Thursday",p:"zhuh-DEE",e:"📅"}, {w:"Vendredi",t:"Friday",p:"vahn-druh-DEE",e:"📅"},
    {w:"Samedi",t:"Saturday",p:"sam-DEE",e:"📅"}, {w:"Dimanche",t:"Sunday",p:"dee-MAHNSH",e:"📅"},
    {w:"Aujourd'hui",t:"Today",p:"oh-zhoor-DWEE",e:"📆"}, {w:"Demain",t:"Tomorrow",p:"duh-MAN",e:"🌅"},
    {w:"Hier",t:"Yesterday",p:"yehr",e:"🌇"}, {w:"Semaine",t:"Week",p:"suh-MEN",e:"🗓"},
    {w:"Mois",t:"Month",p:"mwah",e:"🗓"}, {w:"Année",t:"Year",p:"ah-NEH",e:"🎆"},
    {w:"Jour",t:"Day",p:"zhoor",e:"☀️"}, {w:"Nuit",t:"Night",p:"nwee",e:"🌙"},
    {w:"Matin",t:"Morning",p:"mah-TAN",e:"🌄"}, {w:"Soir",t:"Evening",p:"swar",e:"🌆"},
    {w:"Heure",t:"Hour",p:"uhr",e:"🕐"}, {w:"Minute",t:"Minute",p:"mee-NÜT",e:"⏱"},
    {w:"Janvier",t:"January",p:"zhahn-VYEH",e:"❄️"}, {w:"Février",t:"February",p:"feh-VRYEH",e:"💘"},
    {w:"Mars",t:"March",p:"mars",e:"🌸"}, {w:"Avril",t:"April",p:"ah-VREEL",e:"🌷"},
    {w:"Mai",t:"May",p:"meh",e:"🌼"}, {w:"Juin",t:"June",p:"zhwan",e:"☀️"},
    {w:"Juillet",t:"July",p:"zhwee-YEH",e:"🏖"}, {w:"Août",t:"August",p:"oot",e:"🌞"},
    {w:"Septembre",t:"September",p:"sep-TAHM-bruh",e:"🍂"}, {w:"Octobre",t:"October",p:"ok-TOH-bruh",e:"🎃"},
    {w:"Novembre",t:"November",p:"noh-VAHM-bruh",e:"🌧"}, {w:"Décembre",t:"December",p:"deh-SAHM-bruh",e:"🎄"},
    {w:"Rouge",t:"Red",p:"roozh",e:"🔴"}, {w:"Bleu",t:"Blue",p:"bluh",e:"🔵"},
    {w:"Vert",t:"Green",p:"vehr",e:"🟢"}, {w:"Jaune",t:"Yellow",p:"zhohn",e:"🟡"},
    {w:"Noir",t:"Black",p:"nwar",e:"⚫"}, {w:"Blanc",t:"White",p:"blahn",e:"⚪"},
    {w:"Gris",t:"Grey",p:"gree",e:"🩶"}, {w:"Marron",t:"Brown",p:"mah-RON",e:"🟤"},
    {w:"Rose",t:"Pink",p:"rohz",e:"🌸"}, {w:"Orange",t:"Orange",p:"oh-RAHNZH",e:"🟠"},
    {w:"Violet",t:"Purple",p:"vyoh-LEH",e:"🟣"}, {w:"Fils",t:"Son",p:"fees",e:"👦"},
    {w:"Fille",t:"Daughter/girl",p:"fee",e:"👧"}, {w:"Frère",t:"Brother",p:"frehr",e:"👬"},
    {w:"Sœur",t:"Sister",p:"suhr",e:"👭"}, {w:"Grand-père",t:"Grandfather",p:"grahn-PEHR",e:"👴"},
    {w:"Grand-mère",t:"Grandmother",p:"grahn-MEHR",e:"👵"}, {w:"Oncle",t:"Uncle",p:"ON-kluh",e:"👨"},
    {w:"Tante",t:"Aunt",p:"tahnt",e:"👩"}, {w:"Mari",t:"Husband",p:"mah-REE",e:"🤵"},
    {w:"Femme",t:"Woman/wife",p:"fam",e:"👩"}, {w:"Enfant",t:"Child",p:"ahn-FAHN",e:"👶"},
    {w:"Garçon",t:"Boy",p:"gar-SON",e:"🧑"}, {w:"Homme",t:"Man",p:"om",e:"👨"},
    {w:"Gens",t:"People",p:"zhahn",e:"👥"}, {w:"Tête",t:"Head",p:"tet",e:"🗣"},
    {w:"Œil",t:"Eye",p:"uhy",e:"👁"}, {w:"Main",t:"Hand",p:"man",e:"✋"},
    {w:"Pied",t:"Foot",p:"pyeh",e:"🦶"}, {w:"Cœur",t:"Heart",p:"kuhr",e:"❤️"},
    {w:"Bouche",t:"Mouth",p:"boosh",e:"👄"}, {w:"Nez",t:"Nose",p:"neh",e:"👃"},
    {w:"Oreille",t:"Ear",p:"oh-RAY",e:"👂"}, {w:"Bras",t:"Arm",p:"brah",e:"💪"},
    {w:"Jambe",t:"Leg",p:"zhahmb",e:"🦵"}, {w:"Cheveux",t:"Hair",p:"shuh-VUH",e:"💇"},
    {w:"Visage",t:"Face",p:"vee-ZAHZH",e:"🙂"}, {w:"Pain",t:"Bread",p:"pan",e:"🍞"},
    {w:"Lait",t:"Milk",p:"leh",e:"🥛"}, {w:"Vin",t:"Wine",p:"van",e:"🍷"},
    {w:"Bière",t:"Beer",p:"byehr",e:"🍺"}, {w:"Café",t:"Coffee",p:"kah-FEH",e:"☕"},
    {w:"Thé",t:"Tea",p:"teh",e:"🍵"}, {w:"Viande",t:"Meat",p:"vyahnd",e:"🥩"},
    {w:"Poisson",t:"Fish",p:"pwah-SON",e:"🐟"}, {w:"Poulet",t:"Chicken",p:"poo-LEH",e:"🍗"},
    {w:"Riz",t:"Rice",p:"ree",e:"🍚"}, {w:"Pâtes",t:"Pasta",p:"paht",e:"🍝"},
    {w:"Fromage",t:"Cheese",p:"froh-MAHZH",e:"🧀"}, {w:"Œuf",t:"Egg",p:"uhf",e:"🥚"},
    {w:"Fruit",t:"Fruit",p:"frwee",e:"🍎"}, {w:"Pomme",t:"Apple",p:"pom",e:"🍏"},
    {w:"Banane",t:"Banana",p:"bah-NAHN",e:"🍌"}, {w:"Légumes",t:"Vegetables",p:"leh-GÜM",e:"🥦"},
    {w:"Tomate",t:"Tomato",p:"toh-MAHT",e:"🍅"}, {w:"Pomme de terre",t:"Potato",p:"pom duh TEHR",e:"🥔"},
    {w:"Salade",t:"Salad",p:"sah-LAHD",e:"🥗"}, {w:"Sucre",t:"Sugar",p:"SÜ-kruh",e:"🍬"},
    {w:"Sel",t:"Salt",p:"sel",e:"🧂"}, {w:"Huile",t:"Oil",p:"weel",e:"🫒"},
    {w:"Beurre",t:"Butter",p:"buhr",e:"🧈"}, {w:"Gâteau",t:"Cake",p:"gah-TOH",e:"🍰"},
    {w:"Glace",t:"Ice cream",p:"glahs",e:"🍨"}, {w:"Petit-déjeuner",t:"Breakfast",p:"puh-tee deh-zhuh-NEH",e:"🥐"},
    {w:"Déjeuner",t:"Lunch",p:"deh-zhuh-NEH",e:"🍽"}, {w:"Dîner",t:"Dinner",p:"dee-NEH",e:"🌙"},
    {w:"Restaurant",t:"Restaurant",p:"res-toh-RAHN",e:"🍴"}, {w:"Table",t:"Table",p:"TAH-bluh",e:"🪑"},
    {w:"Porte",t:"Door",p:"port",e:"🚪"}, {w:"Fenêtre",t:"Window",p:"fuh-NEH-truh",e:"🪟"},
    {w:"Chambre",t:"Bedroom",p:"SHAHM-bruh",e:"🛏"}, {w:"Cuisine",t:"Kitchen",p:"kwee-ZEEN",e:"🍳"},
    {w:"Salle de bain",t:"Bathroom",p:"sal duh BAN",e:"🛁"}, {w:"Lit",t:"Bed",p:"lee",e:"🛌"},
    {w:"Chaise",t:"Chair",p:"shez",e:"🪑"}, {w:"Clé",t:"Key",p:"kleh",e:"🔑"},
    {w:"Lumière",t:"Light",p:"lü-MYEHR",e:"💡"}, {w:"Rue",t:"Street",p:"rü",e:"🛣"},
    {w:"Magasin",t:"Shop",p:"mah-gah-ZAN",e:"🏪"}, {w:"Marché",t:"Market",p:"mar-SHEH",e:"🛍"},
    {w:"École",t:"School",p:"eh-KOL",e:"🏫"}, {w:"Hôpital",t:"Hospital",p:"oh-pee-TAHL",e:"🏥"},
    {w:"Église",t:"Church",p:"eh-GLEEZ",e:"⛪"}, {w:"Banque",t:"Bank",p:"bahnk",e:"🏦"},
    {w:"Bureau",t:"Office/desk",p:"bü-ROH",e:"🏢"}, {w:"Gare",t:"Station",p:"gar",e:"🚉"},
    {w:"Aéroport",t:"Airport",p:"ah-eh-roh-POR",e:"✈️"}, {w:"Hôtel",t:"Hotel",p:"oh-TEL",e:"🏨"},
    {w:"Voiture",t:"Car",p:"vwah-TÜR",e:"🚗"}, {w:"Train",t:"Train",p:"tran",e:"🚆"},
    {w:"Bus",t:"Bus",p:"büs",e:"🚌"}, {w:"Avion",t:"Airplane",p:"ah-VYON",e:"🛩"},
    {w:"Vélo",t:"Bicycle",p:"veh-LOH",e:"🚲"}, {w:"Billet",t:"Ticket",p:"bee-YEH",e:"🎫"},
    {w:"Nouveau",t:"New",p:"noo-VOH",e:"✨"}, {w:"Vieux",t:"Old",p:"vyuh",e:"🏚"},
    {w:"Jeune",t:"Young",p:"zhuhn",e:"🧒"}, {w:"Beau",t:"Beautiful",p:"boh",e:"😍"},
    {w:"Laid",t:"Ugly",p:"leh",e:"🫣"}, {w:"Bon",t:"Good",p:"bon",e:"👌"},
    {w:"Chaud",t:"Hot",p:"shoh",e:"🔥"}, {w:"Froid",t:"Cold",p:"frwah",e:"🧊"},
    {w:"Haut",t:"High/tall",p:"oh",e:"📏"}, {w:"Bas",t:"Low",p:"bah",e:"📉"},
    {w:"Long",t:"Long",p:"lon",e:"📏"}, {w:"Court",t:"Short",p:"koor",e:"✂️"},
    {w:"Fort",t:"Strong",p:"for",e:"💪"}, {w:"Faible",t:"Weak",p:"FEH-bluh",e:"🪶"},
    {w:"Facile",t:"Easy",p:"fah-SEEL",e:"🟢"}, {w:"Difficile",t:"Difficult",p:"dee-fee-SEEL",e:"🔴"},
    {w:"Important",t:"Important",p:"am-por-TAHN",e:"⭐"}, {w:"Juste",t:"Right/fair",p:"zhüst",e:"✅"},
    {w:"Faux",t:"False/wrong",p:"foh",e:"❌"}, {w:"Vrai",t:"True",p:"vreh",e:"✔️"},
    {w:"Plein",t:"Full",p:"plan",e:"🈵"}, {w:"Vide",t:"Empty",p:"veed",e:"🈳"},
    {w:"Ouvert",t:"Open",p:"oo-VEHR",e:"🔓"}, {w:"Fermé",t:"Closed",p:"fer-MEH",e:"🔒"},
    {w:"Propre",t:"Clean",p:"PROH-pruh",e:"🧼"}, {w:"Sale",t:"Dirty",p:"sahl",e:"🧹"},
    {w:"Riche",t:"Rich",p:"reesh",e:"💎"}, {w:"Pauvre",t:"Poor",p:"POH-vruh",e:"🪙"},
    {w:"Libre",t:"Free",p:"LEE-bruh",e:"🕊"}, {w:"Occupé",t:"Busy",p:"oh-kü-PEH",e:"📵"},
    {w:"Prêt",t:"Ready",p:"preh",e:"🚦"}, {w:"Sûr",t:"Sure/safe",p:"sür",e:"🛡"},
    {w:"Même",t:"Same",p:"mem",e:"🟰"}, {w:"Différent",t:"Different",p:"dee-feh-RAHN",e:"🔀"},
    {w:"Cher",t:"Expensive/dear",p:"shehr",e:"💸"}, {w:"Pas cher",t:"Cheap",p:"pah SHEHR",e:"🏷"},
    {w:"Soleil",t:"Sun",p:"soh-LAY",e:"☀️"}, {w:"Lune",t:"Moon",p:"lün",e:"🌙"},
    {w:"Étoile",t:"Star",p:"eh-TWAHL",e:"⭐"}, {w:"Ciel",t:"Sky",p:"syel",e:"🌤"},
    {w:"Mer",t:"Sea",p:"mehr",e:"🌊"}, {w:"Montagne",t:"Mountain",p:"mon-TAHN-yuh",e:"⛰"},
    {w:"Rivière",t:"River",p:"ree-VYEHR",e:"🏞"}, {w:"Arbre",t:"Tree",p:"AR-bruh",e:"🌳"},
    {w:"Fleur",t:"Flower",p:"fluhr",e:"🌸"}, {w:"Pluie",t:"Rain",p:"plwee",e:"🌧"},
    {w:"Neige",t:"Snow",p:"nezh",e:"❄️"}, {w:"Vent",t:"Wind",p:"vahn",e:"💨"},
    {w:"Feu",t:"Fire",p:"fuh",e:"🔥"}, {w:"Terre",t:"Earth",p:"tehr",e:"🌍"},
    {w:"Air",t:"Air",p:"ehr",e:"🌬"}, {w:"Chose",t:"Thing",p:"shohz",e:"📦"},
    {w:"Vie",t:"Life",p:"vee",e:"🌱"}, {w:"Monde",t:"World",p:"mond",e:"🌎"},
    {w:"Pays",t:"Country",p:"peh-EE",e:"🗺"}, {w:"Endroit",t:"Place",p:"ahn-DRWAH",e:"📍"},
    {w:"Partie",t:"Part",p:"par-TEE",e:"🧩"}, {w:"Fois",t:"Time (occasion)",p:"fwah",e:"🔁"},
    {w:"Nom",t:"Name",p:"non",e:"🏷"}, {w:"Mot",t:"Word",p:"moh",e:"🔤"},
    {w:"Question",t:"Question",p:"kes-TYON",e:"❓"}, {w:"Réponse",t:"Answer",p:"reh-PONS",e:"💬"},
    {w:"Problème",t:"Problem",p:"proh-BLEM",e:"⚠️"}, {w:"Idée",t:"Idea",p:"ee-DEH",e:"💡"},
    {w:"Histoire",t:"Story/history",p:"ees-TWAHR",e:"📜"}, {w:"Musique",t:"Music",p:"mü-ZEEK",e:"🎵"},
    {w:"Film",t:"Movie",p:"feelm",e:"🎬"}, {w:"Photo",t:"Photo",p:"foh-TOH",e:"📷"},
    {w:"Téléphone",t:"Telephone",p:"teh-leh-FON",e:"📱"}, {w:"Jeu",t:"Game",p:"zhuh",e:"🎲"},
    {w:"Sport",t:"Sport",p:"spor",e:"⚽"}, {w:"Football",t:"Football",p:"foot-BAHL",e:"⚽"},
    {w:"Salut",t:"Hi/bye",p:"sah-LÜ",e:"🙋"}, {w:"Bonsoir",t:"Good evening",p:"bon-SWAR",e:"🌆"},
    {w:"Bonne nuit",t:"Good night",p:"bon NWEE",e:"🌙"}, {w:"Au revoir",t:"Goodbye",p:"oh ruh-VWAR",e:"👋"},
    {w:"À bientôt",t:"See you soon",p:"ah byan-TOH",e:"👋"}, {w:"Pardon",t:"Sorry/excuse me",p:"par-DON",e:"🙇"},
    {w:"De rien",t:"You're welcome",p:"duh RYAN",e:"🤲"}, {w:"D'accord",t:"Okay/agreed",p:"dah-KOR",e:"👌"},
    {w:"Je ne sais pas",t:"I don't know",p:"zhuh nuh seh PAH",e:"🤷"}, {w:"Je ne comprends pas",t:"I don't understand",p:"zhuh nuh kom-prahn PAH",e:"😕"},
    {w:"Combien ça coûte?",t:"How much is it?",p:"kom-byan sah KOOT",e:"💶"}, {w:"Où est...?",t:"Where is...?",p:"oo EH",e:"🧭"},
    {w:"Quelle heure est-il?",t:"What time is it?",p:"kel UHR eh-TEEL",e:"🕐"}, {w:"Je m'appelle",t:"My name is",p:"zhuh mah-PEL",e:"🪪"},
    {w:"Enchanté",t:"Nice to meet you",p:"ahn-shahn-TEH",e:"🤝"}, {w:"Au secours!",t:"Help!",p:"oh suh-KOOR",e:"🆘"},
    {w:"Santé!",t:"Cheers!",p:"sahn-TEH",e:"🥂"}, {w:"Félicitations",t:"Congratulations",p:"feh-lee-see-tah-SYON",e:"🎉"},
    {w:"Bienvenue",t:"Welcome",p:"byan-vuh-NÜ",e:"🎊"}, {w:"Allons-y!",t:"Let's go!",p:"ah-lon-ZEE",e:"🚀"}
  ],
  it: [
    {w:"Ciao",       t:"Hello/Bye",   p:"CHOW",           e:"🙋"}, {w:"Grazie",     t:"Thank you",   p:"GRAT-syeh",      e:"🙏"},
    {w:"Per favore", t:"Please",      p:"per fah-VOH-reh",e:"✋"}, {w:"Sì",         t:"Yes",         p:"see",            e:"✅"},
    {w:"No",         t:"No",          p:"noh",            e:"❌"}, {w:"Acqua",      t:"Water",       p:"AH-kwah",        e:"💧"},
    {w:"Cibo",       t:"Food",        p:"CHEE-boh",       e:"🍽"}, {w:"Casa",       t:"House",       p:"KAH-zah",        e:"🏠"},
    {w:"Amico",      t:"Friend",      p:"ah-MEE-koh",     e:"👫"}, {w:"Amore",      t:"Love",        p:"ah-MOH-reh",     e:"❤️"},
    {w:"Lavoro",     t:"Work",        p:"lah-VOH-roh",    e:"💼"}, {w:"Soldi",      t:"Money",       p:"SOL-dee",        e:"💰"},
    {w:"Tempo",      t:"Time",        p:"TEM-poh",        e:"⏰"}, {w:"Bene",       t:"Good/Well",   p:"BEH-neh",        e:"👍"},
    {w:"Male",       t:"Bad",         p:"MAH-leh",        e:"👎"}, {w:"Grande",     t:"Big",         p:"GRAHN-deh",      e:"🐘"},
    {w:"Piccolo",    t:"Small",       p:"PEE-koh-loh",    e:"🐭"}, {w:"Veloce",     t:"Fast",        p:"veh-LOH-cheh",   e:"🏃"},
    {w:"Lento",      t:"Slow",        p:"LEN-toh",        e:"🐢"}, {w:"Felice",     t:"Happy",       p:"feh-LEE-cheh",   e:"😊"},
    {w:"Triste",     t:"Sad",         p:"TREE-steh",      e:"😢"}, {w:"Stanco",     t:"Tired",       p:"STAHN-koh",      e:"😴"},
    {w:"Fame",       t:"Hungry",      p:"FAH-meh",        e:"🤤"}, {w:"Sete",       t:"Thirsty",     p:"SEH-teh",        e:"😮"},
    {w:"Famiglia",   t:"Family",      p:"fah-MEE-lyah",   e:"👨‍👩‍👧"},{w:"Madre",      t:"Mother",      p:"MAH-dreh",       e:"👩"},
    {w:"Padre",      t:"Father",      p:"PAH-dreh",       e:"👨"}, {w:"Libro",      t:"Book",        p:"LEE-broh",       e:"📚"},
    {w:"Città",      t:"City",        p:"cheet-TAH",      e:"🏙"}, {w:"Spiaggia",   t:"Beach",       p:"SPYAH-jah",      e:"🏖"},,
    {w:"Essere",t:"To be",p:"ES-seh-reh",e:"🧍"}, {w:"Avere",t:"To have",p:"ah-VEH-reh",e:"🤲"},
    {w:"Fare",t:"To do/make",p:"FAH-reh",e:"🔨"}, {w:"Dire",t:"To say",p:"DEE-reh",e:"🗣"},
    {w:"Potere",t:"To be able",p:"poh-TEH-reh",e:"💪"}, {w:"Volere",t:"To want",p:"voh-LEH-reh",e:"🙌"},
    {w:"Sapere",t:"To know",p:"sah-PEH-reh",e:"🧠"}, {w:"Dovere",t:"To have to",p:"doh-VEH-reh",e:"📋"},
    {w:"Vedere",t:"To see",p:"veh-DEH-reh",e:"👀"}, {w:"Andare",t:"To go",p:"ahn-DAH-reh",e:"🚶"},
    {w:"Venire",t:"To come",p:"veh-NEE-reh",e:"👋"}, {w:"Dare",t:"To give",p:"DAH-reh",e:"🎁"},
    {w:"Parlare",t:"To speak",p:"par-LAH-reh",e:"💬"}, {w:"Trovare",t:"To find",p:"troh-VAH-reh",e:"🔍"},
    {w:"Sentire",t:"To hear/feel",p:"sen-TEE-reh",e:"👂"}, {w:"Prendere",t:"To take",p:"PREN-deh-reh",e:"✊"},
    {w:"Guardare",t:"To look at",p:"gwar-DAH-reh",e:"👁"}, {w:"Mettere",t:"To put",p:"MET-teh-reh",e:"📥"},
    {w:"Pensare",t:"To think",p:"pen-SAH-reh",e:"💭"}, {w:"Credere",t:"To believe",p:"KREH-deh-reh",e:"🙏"},
    {w:"Portare",t:"To bring",p:"por-TAH-reh",e:"🎒"}, {w:"Vivere",t:"To live",p:"VEE-veh-reh",e:"🌱"},
    {w:"Tornare",t:"To return",p:"tor-NAH-reh",e:"🔙"}, {w:"Capire",t:"To understand",p:"kah-PEE-reh",e:"💡"},
    {w:"Arrivare",t:"To arrive",p:"ar-ree-VAH-reh",e:"🏁"}, {w:"Conoscere",t:"To know (people)",p:"koh-NOH-sheh-reh",e:"🤝"},
    {w:"Ricordare",t:"To remember",p:"ree-kor-DAH-reh",e:"🧾"}, {w:"Chiamare",t:"To call",p:"kyah-MAH-reh",e:"📞"},
    {w:"Aspettare",t:"To wait",p:"ah-spet-TAH-reh",e:"⏳"}, {w:"Finire",t:"To finish",p:"fee-NEE-reh",e:"🏁"},
    {w:"Mangiare",t:"To eat",p:"man-JAH-reh",e:"🍽"}, {w:"Bere",t:"To drink",p:"BEH-reh",e:"🥤"},
    {w:"Dormire",t:"To sleep",p:"dor-MEE-reh",e:"😴"}, {w:"Aprire",t:"To open",p:"ah-PREE-reh",e:"🔓"},
    {w:"Chiudere",t:"To close",p:"KYOO-deh-reh",e:"🔒"}, {w:"Comprare",t:"To buy",p:"kom-PRAH-reh",e:"🛒"},
    {w:"Pagare",t:"To pay",p:"pah-GAH-reh",e:"💳"}, {w:"Leggere",t:"To read",p:"LED-jeh-reh",e:"📖"},
    {w:"Scrivere",t:"To write",p:"SKREE-veh-reh",e:"✍️"}, {w:"Ascoltare",t:"To listen",p:"ah-skol-TAH-reh",e:"🎧"},
    {w:"Giocare",t:"To play",p:"joh-KAH-reh",e:"🎮"}, {w:"Correre",t:"To run",p:"KOR-reh-reh",e:"🏃"},
    {w:"Camminare",t:"To walk",p:"kam-mee-NAH-reh",e:"🚶"}, {w:"Aiutare",t:"To help",p:"ah-yoo-TAH-reh",e:"🆘"},
    {w:"Amare",t:"To love",p:"ah-MAH-reh",e:"❤️"}, {w:"Lavorare",t:"To work",p:"lah-voh-RAH-reh",e:"💼"},
    {w:"Studiare",t:"To study",p:"stoo-DYAH-reh",e:"📚"}, {w:"Imparare",t:"To learn",p:"eem-pah-RAH-reh",e:"🎓"},
    {w:"Insegnare",t:"To teach",p:"een-sen-YAH-reh",e:"👩‍🏫"}, {w:"Cominciare",t:"To begin",p:"koh-meen-CHAH-reh",e:"▶️"},
    {w:"Cercare",t:"To search",p:"cher-KAH-reh",e:"🔎"}, {w:"Usare",t:"To use",p:"oo-ZAH-reh",e:"🛠"},
    {w:"Chiedere",t:"To ask",p:"KYEH-deh-reh",e:"❓"}, {w:"Rispondere",t:"To answer",p:"ree-SPON-deh-reh",e:"💬"},
    {w:"Uscire",t:"To go out",p:"oo-SHEE-reh",e:"🚪"}, {w:"Entrare",t:"To enter",p:"en-TRAH-reh",e:"➡️"},
    {w:"Perdere",t:"To lose",p:"PEHR-deh-reh",e:"🫥"}, {w:"Vincere",t:"To win",p:"VEEN-cheh-reh",e:"🏆"},
    {w:"Provare",t:"To try",p:"proh-VAH-reh",e:"🎯"}, {w:"Cambiare",t:"To change",p:"kam-BYAH-reh",e:"🔄"},
    {w:"Io",t:"I",p:"EE-oh",e:"🙋"}, {w:"Tu",t:"You",p:"too",e:"👉"},
    {w:"Lui",t:"He",p:"LOO-ee",e:"👨"}, {w:"Lei",t:"She",p:"lay",e:"👩"},
    {w:"Noi",t:"We",p:"noy",e:"👥"}, {w:"Voi",t:"You (plural)",p:"voy",e:"👫"},
    {w:"Loro",t:"They",p:"LOH-roh",e:"👪"}, {w:"Questo",t:"This",p:"KWES-toh",e:"👇"},
    {w:"Quello",t:"That",p:"KWEL-loh",e:"👉"}, {w:"Tutto",t:"Everything",p:"TOOT-toh",e:"🌐"},
    {w:"Niente",t:"Nothing",p:"NYEN-teh",e:"🚫"}, {w:"Qualcosa",t:"Something",p:"kwal-KOH-zah",e:"❔"},
    {w:"Qualcuno",t:"Someone",p:"kwal-KOO-noh",e:"👤"}, {w:"Nessuno",t:"Nobody",p:"nes-SOO-noh",e:"🙅"},
    {w:"Molto",t:"A lot/very",p:"MOL-toh",e:"📈"}, {w:"Poco",t:"Little/few",p:"POH-koh",e:"🤏"},
    {w:"Troppo",t:"Too much",p:"TROP-poh",e:"🛑"}, {w:"Più",t:"More",p:"pyoo",e:"➕"},
    {w:"Meno",t:"Less",p:"MEH-noh",e:"➖"}, {w:"Anche",t:"Also",p:"AHN-keh",e:"➕"},
    {w:"Sempre",t:"Always",p:"SEM-preh",e:"♾️"}, {w:"Mai",t:"Never",p:"my",e:"🚫"},
    {w:"Già",t:"Already",p:"jah",e:"✔️"}, {w:"Ancora",t:"Still/again",p:"ahn-KOH-rah",e:"🔁"},
    {w:"Adesso",t:"Now",p:"ah-DES-soh",e:"⏱"}, {w:"Dopo",t:"After/later",p:"DOH-poh",e:"⏭"},
    {w:"Prima",t:"Before/first",p:"PREE-mah",e:"⏮"}, {w:"Qui",t:"Here",p:"kwee",e:"📍"},
    {w:"Lì",t:"There",p:"lee",e:"🗺"}, {w:"Dove",t:"Where",p:"DOH-veh",e:"🧭"},
    {w:"Quando",t:"When",p:"KWAN-doh",e:"📅"}, {w:"Perché",t:"Why/because",p:"per-KEH",e:"❓"},
    {w:"Come",t:"How",p:"KOH-meh",e:"🤔"}, {w:"Chi",t:"Who",p:"kee",e:"👤"},
    {w:"Cosa",t:"What/thing",p:"KOH-zah",e:"❔"}, {w:"Quale",t:"Which",p:"KWAH-leh",e:"🔀"},
    {w:"Quanto",t:"How much",p:"KWAN-toh",e:"⚖️"}, {w:"Uno",t:"One",p:"OO-noh",e:"1️⃣"},
    {w:"Due",t:"Two",p:"DOO-eh",e:"2️⃣"}, {w:"Tre",t:"Three",p:"treh",e:"3️⃣"},
    {w:"Quattro",t:"Four",p:"KWAT-troh",e:"4️⃣"}, {w:"Cinque",t:"Five",p:"CHEEN-kweh",e:"5️⃣"},
    {w:"Sei",t:"Six",p:"say",e:"6️⃣"}, {w:"Sette",t:"Seven",p:"SET-teh",e:"7️⃣"},
    {w:"Otto",t:"Eight",p:"OT-toh",e:"8️⃣"}, {w:"Nove",t:"Nine",p:"NOH-veh",e:"9️⃣"},
    {w:"Dieci",t:"Ten",p:"DYEH-chee",e:"🔟"}, {w:"Undici",t:"Eleven",p:"OON-dee-chee",e:"🔢"},
    {w:"Dodici",t:"Twelve",p:"DOH-dee-chee",e:"🔢"}, {w:"Venti",t:"Twenty",p:"VEN-tee",e:"🔢"},
    {w:"Trenta",t:"Thirty",p:"TREN-tah",e:"🔢"}, {w:"Quaranta",t:"Forty",p:"kwah-RAHN-tah",e:"🔢"},
    {w:"Cinquanta",t:"Fifty",p:"cheen-KWAN-tah",e:"🔢"}, {w:"Cento",t:"Hundred",p:"CHEN-toh",e:"💯"},
    {w:"Mille",t:"Thousand",p:"MEEL-leh",e:"🔢"}, {w:"Primo",t:"First",p:"PREE-moh",e:"🥇"},
    {w:"Secondo",t:"Second",p:"seh-KON-doh",e:"🥈"}, {w:"Ultimo",t:"Last",p:"OOL-tee-moh",e:"🔚"},
    {w:"Lunedì",t:"Monday",p:"loo-neh-DEE",e:"📅"}, {w:"Martedì",t:"Tuesday",p:"mar-teh-DEE",e:"📅"},
    {w:"Mercoledì",t:"Wednesday",p:"mer-koh-leh-DEE",e:"📅"}, {w:"Giovedì",t:"Thursday",p:"joh-veh-DEE",e:"📅"},
    {w:"Venerdì",t:"Friday",p:"veh-ner-DEE",e:"📅"}, {w:"Sabato",t:"Saturday",p:"SAH-bah-toh",e:"📅"},
    {w:"Domenica",t:"Sunday",p:"doh-MEH-nee-kah",e:"📅"}, {w:"Oggi",t:"Today",p:"OD-jee",e:"📆"},
    {w:"Domani",t:"Tomorrow",p:"doh-MAH-nee",e:"🌅"}, {w:"Ieri",t:"Yesterday",p:"YEH-ree",e:"🌇"},
    {w:"Settimana",t:"Week",p:"set-tee-MAH-nah",e:"🗓"}, {w:"Mese",t:"Month",p:"MEH-zeh",e:"🗓"},
    {w:"Anno",t:"Year",p:"AHN-noh",e:"🎆"}, {w:"Giorno",t:"Day",p:"JOR-noh",e:"☀️"},
    {w:"Notte",t:"Night",p:"NOT-teh",e:"🌙"}, {w:"Mattina",t:"Morning",p:"mat-TEE-nah",e:"🌄"},
    {w:"Sera",t:"Evening",p:"SEH-rah",e:"🌆"}, {w:"Ora",t:"Hour/now",p:"OH-rah",e:"🕐"},
    {w:"Minuto",t:"Minute",p:"mee-NOO-toh",e:"⏱"}, {w:"Gennaio",t:"January",p:"jen-NAH-yoh",e:"❄️"},
    {w:"Febbraio",t:"February",p:"feb-BRAH-yoh",e:"💘"}, {w:"Marzo",t:"March",p:"MAR-tsoh",e:"🌸"},
    {w:"Aprile",t:"April",p:"ah-PREE-leh",e:"🌷"}, {w:"Maggio",t:"May",p:"MAD-joh",e:"🌼"},
    {w:"Giugno",t:"June",p:"JOON-yoh",e:"☀️"}, {w:"Luglio",t:"July",p:"LOOL-yoh",e:"🏖"},
    {w:"Agosto",t:"August",p:"ah-GOS-toh",e:"🌞"}, {w:"Settembre",t:"September",p:"set-TEM-breh",e:"🍂"},
    {w:"Ottobre",t:"October",p:"ot-TOH-breh",e:"🎃"}, {w:"Novembre",t:"November",p:"noh-VEM-breh",e:"🌧"},
    {w:"Dicembre",t:"December",p:"dee-CHEM-breh",e:"🎄"}, {w:"Rosso",t:"Red",p:"ROS-soh",e:"🔴"},
    {w:"Blu",t:"Blue",p:"bloo",e:"🔵"}, {w:"Verde",t:"Green",p:"VEHR-deh",e:"🟢"},
    {w:"Giallo",t:"Yellow",p:"JAHL-loh",e:"🟡"}, {w:"Nero",t:"Black",p:"NEH-roh",e:"⚫"},
    {w:"Bianco",t:"White",p:"BYAHN-koh",e:"⚪"}, {w:"Grigio",t:"Grey",p:"GREE-joh",e:"🩶"},
    {w:"Marrone",t:"Brown",p:"mar-ROH-neh",e:"🟤"}, {w:"Rosa",t:"Pink",p:"ROH-zah",e:"🌸"},
    {w:"Arancione",t:"Orange (color)",p:"ah-ran-CHOH-neh",e:"🟠"}, {w:"Viola",t:"Purple",p:"VYOH-lah",e:"🟣"},
    {w:"Figlio",t:"Son",p:"FEEL-yoh",e:"👦"}, {w:"Figlia",t:"Daughter",p:"FEEL-yah",e:"👧"},
    {w:"Fratello",t:"Brother",p:"frah-TEL-loh",e:"👬"}, {w:"Sorella",t:"Sister",p:"soh-REL-lah",e:"👭"},
    {w:"Nonno",t:"Grandfather",p:"NON-noh",e:"👴"}, {w:"Nonna",t:"Grandmother",p:"NON-nah",e:"👵"},
    {w:"Zio",t:"Uncle",p:"TSEE-oh",e:"👨"}, {w:"Zia",t:"Aunt",p:"TSEE-ah",e:"👩"},
    {w:"Marito",t:"Husband",p:"mah-REE-toh",e:"🤵"}, {w:"Moglie",t:"Wife",p:"MOHL-yeh",e:"👰"},
    {w:"Bambino",t:"Child",p:"bam-BEE-noh",e:"👶"}, {w:"Ragazzo",t:"Boy",p:"rah-GAT-tsoh",e:"🧑"},
    {w:"Ragazza",t:"Girl",p:"rah-GAT-tsah",e:"👧"}, {w:"Uomo",t:"Man",p:"WOH-moh",e:"👨"},
    {w:"Donna",t:"Woman",p:"DON-nah",e:"👩"}, {w:"Gente",t:"People",p:"JEN-teh",e:"👥"},
    {w:"Persona",t:"Person",p:"per-SOH-nah",e:"👤"}, {w:"Testa",t:"Head",p:"TES-tah",e:"🗣"},
    {w:"Occhio",t:"Eye",p:"OK-kyoh",e:"👁"}, {w:"Mano",t:"Hand",p:"MAH-noh",e:"✋"},
    {w:"Piede",t:"Foot",p:"PYEH-deh",e:"🦶"}, {w:"Cuore",t:"Heart",p:"KWOH-reh",e:"❤️"},
    {w:"Bocca",t:"Mouth",p:"BOK-kah",e:"👄"}, {w:"Naso",t:"Nose",p:"NAH-zoh",e:"👃"},
    {w:"Orecchio",t:"Ear",p:"oh-REK-kyoh",e:"👂"}, {w:"Braccio",t:"Arm",p:"BRAT-choh",e:"💪"},
    {w:"Gamba",t:"Leg",p:"GAM-bah",e:"🦵"}, {w:"Capelli",t:"Hair",p:"kah-PEL-lee",e:"💇"},
    {w:"Pane",t:"Bread",p:"PAH-neh",e:"🍞"}, {w:"Latte",t:"Milk",p:"LAHT-teh",e:"🥛"},
    {w:"Vino",t:"Wine",p:"VEE-noh",e:"🍷"}, {w:"Birra",t:"Beer",p:"BEER-rah",e:"🍺"},
    {w:"Caffè",t:"Coffee",p:"kahf-FEH",e:"☕"}, {w:"Tè",t:"Tea",p:"teh",e:"🍵"},
    {w:"Carne",t:"Meat",p:"KAR-neh",e:"🥩"}, {w:"Pesce",t:"Fish",p:"PEH-sheh",e:"🐟"},
    {w:"Pollo",t:"Chicken",p:"POL-loh",e:"🍗"}, {w:"Riso",t:"Rice",p:"REE-zoh",e:"🍚"},
    {w:"Pasta",t:"Pasta",p:"PAHS-tah",e:"🍝"}, {w:"Formaggio",t:"Cheese",p:"for-MAD-joh",e:"🧀"},
    {w:"Uovo",t:"Egg",p:"WOH-voh",e:"🥚"}, {w:"Frutta",t:"Fruit",p:"FROOT-tah",e:"🍎"},
    {w:"Mela",t:"Apple",p:"MEH-lah",e:"🍏"}, {w:"Arancia",t:"Orange (fruit)",p:"ah-RAHN-chah",e:"🍊"},
    {w:"Banana",t:"Banana",p:"bah-NAH-nah",e:"🍌"}, {w:"Verdura",t:"Vegetables",p:"ver-DOO-rah",e:"🥦"},
    {w:"Pomodoro",t:"Tomato",p:"poh-moh-DOH-roh",e:"🍅"}, {w:"Patata",t:"Potato",p:"pah-TAH-tah",e:"🥔"},
    {w:"Insalata",t:"Salad",p:"een-sah-LAH-tah",e:"🥗"}, {w:"Zucchero",t:"Sugar",p:"TSOOK-keh-roh",e:"🍬"},
    {w:"Sale",t:"Salt",p:"SAH-leh",e:"🧂"}, {w:"Olio",t:"Oil",p:"OH-lyoh",e:"🫒"},
    {w:"Dolce",t:"Sweet/dessert",p:"DOL-cheh",e:"🍰"}, {w:"Gelato",t:"Ice cream",p:"jeh-LAH-toh",e:"🍨"},
    {w:"Colazione",t:"Breakfast",p:"koh-lah-TSYOH-neh",e:"🥐"}, {w:"Pranzo",t:"Lunch",p:"PRAHN-tsoh",e:"🍽"},
    {w:"Cena",t:"Dinner",p:"CHEH-nah",e:"🌙"}, {w:"Ristorante",t:"Restaurant",p:"rees-toh-RAHN-teh",e:"🍴"},
    {w:"Tavolo",t:"Table",p:"TAH-voh-loh",e:"🪑"}, {w:"Porta",t:"Door",p:"POR-tah",e:"🚪"},
    {w:"Finestra",t:"Window",p:"fee-NES-trah",e:"🪟"}, {w:"Camera",t:"Room/bedroom",p:"KAH-meh-rah",e:"🛏"},
    {w:"Cucina",t:"Kitchen",p:"koo-CHEE-nah",e:"🍳"}, {w:"Bagno",t:"Bathroom",p:"BAHN-yoh",e:"🛁"},
    {w:"Letto",t:"Bed",p:"LET-toh",e:"🛌"}, {w:"Sedia",t:"Chair",p:"SEH-dyah",e:"🪑"},
    {w:"Chiave",t:"Key",p:"KYAH-veh",e:"🔑"}, {w:"Luce",t:"Light",p:"LOO-cheh",e:"💡"},
    {w:"Strada",t:"Street/road",p:"STRAH-dah",e:"🛣"}, {w:"Negozio",t:"Shop",p:"neh-GOH-tsyoh",e:"🏪"},
    {w:"Mercato",t:"Market",p:"mer-KAH-toh",e:"🛍"}, {w:"Scuola",t:"School",p:"SKWOH-lah",e:"🏫"},
    {w:"Ospedale",t:"Hospital",p:"os-peh-DAH-leh",e:"🏥"}, {w:"Chiesa",t:"Church",p:"KYEH-zah",e:"⛪"},
    {w:"Banca",t:"Bank",p:"BAHN-kah",e:"🏦"}, {w:"Ufficio",t:"Office",p:"oof-FEE-choh",e:"🏢"},
    {w:"Stazione",t:"Station",p:"stah-TSYOH-neh",e:"🚉"}, {w:"Aeroporto",t:"Airport",p:"ah-eh-roh-POR-toh",e:"✈️"},
    {w:"Albergo",t:"Hotel",p:"al-BEHR-goh",e:"🏨"}, {w:"Macchina",t:"Car",p:"MAHK-kee-nah",e:"🚗"},
    {w:"Treno",t:"Train",p:"TREH-noh",e:"🚆"}, {w:"Autobus",t:"Bus",p:"OW-toh-boos",e:"🚌"},
    {w:"Aereo",t:"Airplane",p:"ah-EH-reh-oh",e:"🛩"}, {w:"Bicicletta",t:"Bicycle",p:"bee-chee-KLET-tah",e:"🚲"},
    {w:"Biglietto",t:"Ticket",p:"beel-YET-toh",e:"🎫"}, {w:"Nuovo",t:"New",p:"NWOH-voh",e:"✨"},
    {w:"Vecchio",t:"Old",p:"VEK-kyoh",e:"🏚"}, {w:"Giovane",t:"Young",p:"JOH-vah-neh",e:"🧒"},
    {w:"Bello",t:"Beautiful",p:"BEL-loh",e:"😍"}, {w:"Brutto",t:"Ugly",p:"BROOT-toh",e:"🫣"},
    {w:"Buono",t:"Good (things)",p:"BWOH-noh",e:"👌"}, {w:"Caldo",t:"Hot",p:"KAHL-doh",e:"🔥"},
    {w:"Freddo",t:"Cold",p:"FRED-doh",e:"🧊"}, {w:"Alto",t:"Tall/high",p:"AHL-toh",e:"📏"},
    {w:"Basso",t:"Short/low",p:"BAHS-soh",e:"📉"}, {w:"Lungo",t:"Long",p:"LOON-goh",e:"📏"},
    {w:"Corto",t:"Short (length)",p:"KOR-toh",e:"✂️"}, {w:"Forte",t:"Strong",p:"FOR-teh",e:"💪"},
    {w:"Debole",t:"Weak",p:"DEH-boh-leh",e:"🪶"}, {w:"Facile",t:"Easy",p:"FAH-chee-leh",e:"🟢"},
    {w:"Difficile",t:"Difficult",p:"deef-FEE-chee-leh",e:"🔴"}, {w:"Importante",t:"Important",p:"eem-por-TAHN-teh",e:"⭐"},
    {w:"Giusto",t:"Right/correct",p:"JOOS-toh",e:"✅"}, {w:"Sbagliato",t:"Wrong",p:"zbal-YAH-toh",e:"❌"},
    {w:"Vero",t:"True",p:"VEH-roh",e:"✔️"}, {w:"Falso",t:"False",p:"FAHL-soh",e:"✖️"},
    {w:"Pieno",t:"Full",p:"PYEH-noh",e:"🈵"}, {w:"Vuoto",t:"Empty",p:"VWOH-toh",e:"🈳"},
    {w:"Aperto",t:"Open",p:"ah-PEHR-toh",e:"🔓"}, {w:"Chiuso",t:"Closed",p:"KYOO-zoh",e:"🔒"},
    {w:"Pulito",t:"Clean",p:"poo-LEE-toh",e:"🧼"}, {w:"Sporco",t:"Dirty",p:"SPOR-koh",e:"🧹"},
    {w:"Ricco",t:"Rich",p:"REEK-koh",e:"💎"}, {w:"Povero",t:"Poor",p:"POH-veh-roh",e:"🪙"},
    {w:"Libero",t:"Free",p:"LEE-beh-roh",e:"🕊"}, {w:"Occupato",t:"Busy/occupied",p:"ok-koo-PAH-toh",e:"📵"},
    {w:"Pronto",t:"Ready",p:"PRON-toh",e:"🚦"}, {w:"Sicuro",t:"Safe/sure",p:"see-KOO-roh",e:"🛡"},
    {w:"Stesso",t:"Same",p:"STES-soh",e:"🟰"}, {w:"Diverso",t:"Different",p:"dee-VEHR-soh",e:"🔀"},
    {w:"Caro",t:"Expensive/dear",p:"KAH-roh",e:"💸"}, {w:"Economico",t:"Cheap",p:"eh-koh-NOH-mee-koh",e:"🏷"},
    {w:"Sole",t:"Sun",p:"SOH-leh",e:"☀️"}, {w:"Luna",t:"Moon",p:"LOO-nah",e:"🌙"},
    {w:"Stella",t:"Star",p:"STEL-lah",e:"⭐"}, {w:"Cielo",t:"Sky",p:"CHEH-loh",e:"🌤"},
    {w:"Mare",t:"Sea",p:"MAH-reh",e:"🌊"}, {w:"Montagna",t:"Mountain",p:"mon-TAHN-yah",e:"⛰"},
    {w:"Fiume",t:"River",p:"FYOO-meh",e:"🏞"}, {w:"Albero",t:"Tree",p:"AHL-beh-roh",e:"🌳"},
    {w:"Fiore",t:"Flower",p:"FYOH-reh",e:"🌸"}, {w:"Pioggia",t:"Rain",p:"PYOD-jah",e:"🌧"},
    {w:"Neve",t:"Snow",p:"NEH-veh",e:"❄️"}, {w:"Vento",t:"Wind",p:"VEN-toh",e:"💨"},
    {w:"Fuoco",t:"Fire",p:"FWOH-koh",e:"🔥"}, {w:"Terra",t:"Earth/ground",p:"TEHR-rah",e:"🌍"},
    {w:"Aria",t:"Air",p:"AH-ryah",e:"🌬"}, {w:"Vita",t:"Life",p:"VEE-tah",e:"🌱"},
    {w:"Mondo",t:"World",p:"MON-doh",e:"🌎"}, {w:"Paese",t:"Country/town",p:"pah-EH-zeh",e:"🗺"},
    {w:"Posto",t:"Place",p:"POS-toh",e:"📍"}, {w:"Parte",t:"Part",p:"PAR-teh",e:"🧩"},
    {w:"Volta",t:"Time (occasion)",p:"VOL-tah",e:"🔁"}, {w:"Modo",t:"Way/manner",p:"MOH-doh",e:"🛤"},
    {w:"Nome",t:"Name",p:"NOH-meh",e:"🏷"}, {w:"Parola",t:"Word",p:"pah-ROH-lah",e:"🔤"},
    {w:"Domanda",t:"Question",p:"doh-MAHN-dah",e:"❓"}, {w:"Risposta",t:"Answer",p:"rees-POS-tah",e:"💬"},
    {w:"Problema",t:"Problem",p:"proh-BLEH-mah",e:"⚠️"}, {w:"Idea",t:"Idea",p:"ee-DEH-ah",e:"💡"},
    {w:"Storia",t:"Story/history",p:"STOH-ryah",e:"📜"}, {w:"Musica",t:"Music",p:"MOO-zee-kah",e:"🎵"},
    {w:"Film",t:"Movie",p:"feelm",e:"🎬"}, {w:"Foto",t:"Photo",p:"FOH-toh",e:"📷"},
    {w:"Telefono",t:"Telephone",p:"teh-LEH-foh-noh",e:"📱"}, {w:"Gioco",t:"Game",p:"JOH-koh",e:"🎲"},
    {w:"Sport",t:"Sport",p:"sport",e:"⚽"}, {w:"Calcio",t:"Football/soccer",p:"KAHL-choh",e:"⚽"},
    {w:"Buongiorno",t:"Good morning",p:"bwon-JOR-noh",e:"🌅"}, {w:"Buonasera",t:"Good evening",p:"bwoh-nah-SEH-rah",e:"🌆"},
    {w:"Buonanotte",t:"Good night",p:"bwoh-nah-NOT-teh",e:"🌙"}, {w:"Arrivederci",t:"Goodbye",p:"ar-ree-veh-DEHR-chee",e:"👋"},
    {w:"Scusa",t:"Sorry/excuse me",p:"SKOO-zah",e:"🙇"}, {w:"Prego",t:"You're welcome",p:"PREH-goh",e:"🤲"},
    {w:"Va bene",t:"Okay/alright",p:"vah BEH-neh",e:"👌"}, {w:"Non lo so",t:"I don't know",p:"non loh soh",e:"🤷"},
    {w:"Non capisco",t:"I don't understand",p:"non kah-PEES-koh",e:"😕"}, {w:"Quanto costa?",t:"How much is it?",p:"KWAN-toh KOS-tah",e:"💶"},
    {w:"Dov'è?",t:"Where is it?",p:"doh-VEH",e:"🧭"}, {w:"Che ore sono?",t:"What time is it?",p:"keh OH-reh SOH-noh",e:"🕐"},
    {w:"Mi chiamo",t:"My name is",p:"mee KYAH-moh",e:"🪪"}, {w:"Piacere",t:"Nice to meet you",p:"pyah-CHEH-reh",e:"🤝"},
    {w:"Aiuto!",t:"Help!",p:"ah-YOO-toh",e:"🆘"}, {w:"Salute!",t:"Cheers/bless you",p:"sah-LOO-teh",e:"🥂"},
    {w:"Auguri",t:"Best wishes",p:"ow-GOO-ree",e:"🎉"}, {w:"Benvenuto",t:"Welcome",p:"ben-veh-NOO-toh",e:"🎊"},
    {w:"A presto",t:"See you soon",p:"ah PRES-toh",e:"👋"}, {w:"Andiamo!",t:"Let's go!",p:"ahn-DYAH-moh",e:"🚀"}
  ],
  de: [
    {w:"Hallo",      t:"Hello",       p:"HAH-loh",        e:"🙋"}, {w:"Danke",      t:"Thank you",   p:"DAHN-keh",       e:"🙏"},
    {w:"Bitte",      t:"Please",      p:"BIT-teh",        e:"✋"}, {w:"Ja",         t:"Yes",         p:"yah",            e:"✅"},
    {w:"Nein",       t:"No",          p:"nine",           e:"❌"}, {w:"Wasser",     t:"Water",       p:"VAH-ser",        e:"💧"},
    {w:"Essen",      t:"Food",        p:"ES-sen",         e:"🍽"}, {w:"Haus",       t:"House",       p:"hows",           e:"🏠"},
    {w:"Freund",     t:"Friend",      p:"froynd",         e:"👫"}, {w:"Liebe",      t:"Love",        p:"LEE-beh",        e:"❤️"},
    {w:"Arbeit",     t:"Work",        p:"AR-bite",        e:"💼"}, {w:"Geld",       t:"Money",       p:"gelt",           e:"💰"},
    {w:"Zeit",       t:"Time",        p:"tsyte",          e:"⏰"}, {w:"Gut",        t:"Good",        p:"goot",           e:"👍"},
    {w:"Schlecht",   t:"Bad",         p:"shlekht",        e:"👎"}, {w:"Groß",       t:"Big",         p:"grohs",          e:"🐘"},
    {w:"Klein",      t:"Small",       p:"kline",          e:"🐭"}, {w:"Schnell",    t:"Fast",        p:"shnel",          e:"🏃"},
    {w:"Langsam",    t:"Slow",        p:"LAHNG-zahm",     e:"🐢"}, {w:"Glücklich",  t:"Happy",       p:"GLOOK-likh",     e:"😊"},
    {w:"Traurig",    t:"Sad",         p:"TROW-rikh",      e:"😢"}, {w:"Müde",       t:"Tired",       p:"MOO-deh",        e:"😴"},
    {w:"Hunger",     t:"Hungry",      p:"HOONG-er",       e:"🤤"}, {w:"Durst",      t:"Thirsty",     p:"doorst",         e:"😮"},
    {w:"Familie",    t:"Family",      p:"fah-MEE-lyeh",   e:"👨‍👩‍👧"}, {w:"Mutter",     t:"Mother",      p:"MOO-ter",        e:"👩"},
    {w:"Vater",      t:"Father",      p:"FAH-ter",        e:"👨"}, {w:"Buch",       t:"Book",        p:"bookh",          e:"📚"},
    {w:"Stadt",      t:"City",        p:"shtaht",         e:"🏙"}, {w:"Strand",     t:"Beach",       p:"shtrahnd",       e:"🏖"},
    {w:"Sein",t:"To be",p:"zine",e:"🧍"}, {w:"Haben",t:"To have",p:"HAH-ben",e:"🤲"},
    {w:"Machen",t:"To do/make",p:"MAH-khen",e:"🔨"}, {w:"Sagen",t:"To say",p:"ZAH-gen",e:"🗣"},
    {w:"Können",t:"To be able",p:"KUR-nen",e:"💪"}, {w:"Wollen",t:"To want",p:"VOL-len",e:"🙌"},
    {w:"Wissen",t:"To know",p:"VIS-sen",e:"🧠"}, {w:"Müssen",t:"To have to",p:"MUES-sen",e:"📋"},
    {w:"Sehen",t:"To see",p:"ZEH-en",e:"👀"}, {w:"Gehen",t:"To go/walk",p:"GEH-en",e:"🚶"},
    {w:"Kommen",t:"To come",p:"KOM-men",e:"👋"}, {w:"Geben",t:"To give",p:"GEH-ben",e:"🎁"},
    {w:"Sprechen",t:"To speak",p:"SHPREH-khen",e:"💬"}, {w:"Finden",t:"To find",p:"FIN-den",e:"🔍"},
    {w:"Fühlen",t:"To feel",p:"FUE-len",e:"💗"}, {w:"Nehmen",t:"To take",p:"NEH-men",e:"✊"},
    {w:"Schauen",t:"To look",p:"SHOW-en",e:"👁"}, {w:"Stellen",t:"To put",p:"SHTEL-len",e:"📥"},
    {w:"Denken",t:"To think",p:"DEN-ken",e:"💭"}, {w:"Glauben",t:"To believe",p:"GLOW-ben",e:"🙏"},
    {w:"Tragen",t:"To carry/wear",p:"TRAH-gen",e:"🎒"}, {w:"Leben",t:"To live",p:"LEH-ben",e:"🌱"},
    {w:"Verstehen",t:"To understand",p:"fer-SHTEH-en",e:"💡"}, {w:"Ankommen",t:"To arrive",p:"AN-kom-men",e:"🏁"},
    {w:"Kennen",t:"To know (people)",p:"KEN-nen",e:"🤝"}, {w:"Erinnern",t:"To remember",p:"er-IN-nern",e:"🧾"},
    {w:"Anrufen",t:"To call",p:"AN-roo-fen",e:"📞"}, {w:"Warten",t:"To wait",p:"VAR-ten",e:"⏳"},
    {w:"Beenden",t:"To finish",p:"beh-EN-den",e:"🏁"}, {w:"Trinken",t:"To drink",p:"TRIN-ken",e:"🥤"},
    {w:"Schlafen",t:"To sleep",p:"SHLAH-fen",e:"😴"}, {w:"Öffnen",t:"To open",p:"URF-nen",e:"🔓"},
    {w:"Schließen",t:"To close",p:"SHLEE-sen",e:"🔒"}, {w:"Kaufen",t:"To buy",p:"KOW-fen",e:"🛒"},
    {w:"Bezahlen",t:"To pay",p:"beh-TSAH-len",e:"💳"}, {w:"Lesen",t:"To read",p:"LEH-zen",e:"📖"},
    {w:"Schreiben",t:"To write",p:"SHRY-ben",e:"✍️"}, {w:"Hören",t:"To hear/listen",p:"HUR-ren",e:"🎧"},
    {w:"Spielen",t:"To play",p:"SHPEE-len",e:"🎮"}, {w:"Rennen",t:"To run",p:"REN-nen",e:"🏃"},
    {w:"Helfen",t:"To help",p:"HEL-fen",e:"🆘"}, {w:"Lieben",t:"To love",p:"LEE-ben",e:"❤️"},
    {w:"Arbeiten",t:"To work",p:"AR-by-ten",e:"💼"}, {w:"Lernen",t:"To learn",p:"LER-nen",e:"🎓"},
    {w:"Lehren",t:"To teach",p:"LEH-ren",e:"👩‍🏫"}, {w:"Anfangen",t:"To begin",p:"AN-fang-en",e:"▶️"},
    {w:"Suchen",t:"To search",p:"ZOO-khen",e:"🔎"}, {w:"Benutzen",t:"To use",p:"beh-NOOT-sen",e:"🛠"},
    {w:"Fragen",t:"To ask",p:"FRAH-gen",e:"❓"}, {w:"Antworten",t:"To answer",p:"ANT-vor-ten",e:"💬"},
    {w:"Ausgehen",t:"To go out",p:"OWS-geh-en",e:"🚪"}, {w:"Eintreten",t:"To enter",p:"INE-treh-ten",e:"➡️"},
    {w:"Verlieren",t:"To lose",p:"fer-LEE-ren",e:"🫥"}, {w:"Gewinnen",t:"To win",p:"geh-VIN-nen",e:"🏆"},
    {w:"Versuchen",t:"To try",p:"fer-ZOO-khen",e:"🎯"}, {w:"Ändern",t:"To change",p:"EN-dern",e:"🔄"},
    {w:"Brauchen",t:"To need",p:"BROW-khen",e:"🙏"}, {w:"Bleiben",t:"To stay",p:"BLY-ben",e:"🏠"},
    {w:"Fahren",t:"To drive/ride",p:"FAH-ren",e:"🚗"}, {w:"Treffen",t:"To meet",p:"TREF-fen",e:"🤝"},
    {w:"Ich",t:"I",p:"ikh",e:"🙋"}, {w:"Du",t:"You",p:"doo",e:"👉"},
    {w:"Er",t:"He",p:"air",e:"👨"}, {w:"Sie",t:"She/they",p:"zee",e:"👩"},
    {w:"Wir",t:"We",p:"veer",e:"👥"}, {w:"Ihr",t:"You (plural)",p:"eer",e:"👫"},
    {w:"Dies",t:"This",p:"dees",e:"👇"}, {w:"Das",t:"That/the",p:"dahs",e:"👉"},
    {w:"Alles",t:"Everything",p:"AH-les",e:"🌐"}, {w:"Nichts",t:"Nothing",p:"nikhts",e:"🚫"},
    {w:"Etwas",t:"Something",p:"ET-vas",e:"❔"}, {w:"Jemand",t:"Someone",p:"YEH-mant",e:"👤"},
    {w:"Niemand",t:"Nobody",p:"NEE-mant",e:"🙅"}, {w:"Viel",t:"A lot",p:"feel",e:"📈"},
    {w:"Wenig",t:"Little/few",p:"VEH-nikh",e:"🤏"}, {w:"Zu viel",t:"Too much",p:"tsoo FEEL",e:"🛑"},
    {w:"Mehr",t:"More",p:"mair",e:"➕"}, {w:"Weniger",t:"Less",p:"VEH-nee-ger",e:"➖"},
    {w:"Auch",t:"Also",p:"owkh",e:"➕"}, {w:"Immer",t:"Always",p:"IM-mer",e:"♾️"},
    {w:"Nie",t:"Never",p:"nee",e:"🚫"}, {w:"Schon",t:"Already",p:"shohn",e:"✔️"},
    {w:"Noch",t:"Still/yet",p:"nokh",e:"🔁"}, {w:"Jetzt",t:"Now",p:"yetst",e:"⏱"},
    {w:"Später",t:"Later",p:"SHPEH-ter",e:"⏭"}, {w:"Vorher",t:"Before",p:"FOR-hair",e:"⏮"},
    {w:"Hier",t:"Here",p:"heer",e:"📍"}, {w:"Dort",t:"There",p:"dort",e:"🗺"},
    {w:"Wo",t:"Where",p:"voh",e:"🧭"}, {w:"Wann",t:"When",p:"vahn",e:"📅"},
    {w:"Warum",t:"Why",p:"vah-ROOM",e:"❓"}, {w:"Wie",t:"How",p:"vee",e:"🤔"},
    {w:"Wer",t:"Who",p:"vair",e:"👤"}, {w:"Was",t:"What",p:"vahs",e:"❔"},
    {w:"Welche",t:"Which",p:"VEL-khe",e:"🔀"}, {w:"Wie viel",t:"How much",p:"vee FEEL",e:"⚖️"},
    {w:"Eins",t:"One",p:"ines",e:"1️⃣"}, {w:"Zwei",t:"Two",p:"tsvy",e:"2️⃣"},
    {w:"Drei",t:"Three",p:"dry",e:"3️⃣"}, {w:"Vier",t:"Four",p:"feer",e:"4️⃣"},
    {w:"Fünf",t:"Five",p:"fuenf",e:"5️⃣"}, {w:"Sechs",t:"Six",p:"zeks",e:"6️⃣"},
    {w:"Sieben",t:"Seven",p:"ZEE-ben",e:"7️⃣"}, {w:"Acht",t:"Eight",p:"ahkht",e:"8️⃣"},
    {w:"Neun",t:"Nine",p:"noyn",e:"9️⃣"}, {w:"Zehn",t:"Ten",p:"tsehn",e:"🔟"},
    {w:"Elf",t:"Eleven",p:"elf",e:"🔢"}, {w:"Zwölf",t:"Twelve",p:"tsvurlf",e:"🔢"},
    {w:"Zwanzig",t:"Twenty",p:"TSVAN-tsikh",e:"🔢"}, {w:"Dreißig",t:"Thirty",p:"DRY-sikh",e:"🔢"},
    {w:"Vierzig",t:"Forty",p:"FEER-tsikh",e:"🔢"}, {w:"Fünfzig",t:"Fifty",p:"FUENF-tsikh",e:"🔢"},
    {w:"Hundert",t:"Hundred",p:"HOON-dert",e:"💯"}, {w:"Tausend",t:"Thousand",p:"TOW-zent",e:"🔢"},
    {w:"Erste",t:"First",p:"ER-steh",e:"🥇"}, {w:"Zweite",t:"Second",p:"TSVY-teh",e:"🥈"},
    {w:"Letzte",t:"Last",p:"LETS-teh",e:"🔚"}, {w:"Montag",t:"Monday",p:"MOHN-tahk",e:"📅"},
    {w:"Dienstag",t:"Tuesday",p:"DEENS-tahk",e:"📅"}, {w:"Mittwoch",t:"Wednesday",p:"MIT-vokh",e:"📅"},
    {w:"Donnerstag",t:"Thursday",p:"DON-ners-tahk",e:"📅"}, {w:"Freitag",t:"Friday",p:"FRY-tahk",e:"📅"},
    {w:"Samstag",t:"Saturday",p:"ZAMS-tahk",e:"📅"}, {w:"Sonntag",t:"Sunday",p:"ZON-tahk",e:"📅"},
    {w:"Heute",t:"Today",p:"HOY-teh",e:"📆"}, {w:"Morgen",t:"Tomorrow/morning",p:"MOR-gen",e:"🌅"},
    {w:"Gestern",t:"Yesterday",p:"GES-tern",e:"🌇"}, {w:"Woche",t:"Week",p:"VO-kheh",e:"🗓"},
    {w:"Monat",t:"Month",p:"MOH-naht",e:"🗓"}, {w:"Jahr",t:"Year",p:"yahr",e:"🎆"},
    {w:"Tag",t:"Day",p:"tahk",e:"☀️"}, {w:"Nacht",t:"Night",p:"nahkht",e:"🌙"},
    {w:"Abend",t:"Evening",p:"AH-bent",e:"🌆"}, {w:"Stunde",t:"Hour",p:"SHTOON-deh",e:"🕐"},
    {w:"Minute",t:"Minute",p:"mee-NOO-teh",e:"⏱"}, {w:"Januar",t:"January",p:"YAH-noo-ar",e:"❄️"},
    {w:"Februar",t:"February",p:"FEH-broo-ar",e:"💘"}, {w:"März",t:"March",p:"mairts",e:"🌸"},
    {w:"April",t:"April",p:"ah-PRIL",e:"🌷"}, {w:"Mai",t:"May",p:"my",e:"🌼"},
    {w:"Juni",t:"June",p:"YOO-nee",e:"☀️"}, {w:"Juli",t:"July",p:"YOO-lee",e:"🏖"},
    {w:"August",t:"August",p:"ow-GOOST",e:"🌞"}, {w:"September",t:"September",p:"zep-TEM-ber",e:"🍂"},
    {w:"Oktober",t:"October",p:"ok-TOH-ber",e:"🎃"}, {w:"November",t:"November",p:"noh-VEM-ber",e:"🌧"},
    {w:"Dezember",t:"December",p:"deh-TSEM-ber",e:"🎄"}, {w:"Rot",t:"Red",p:"roht",e:"🔴"},
    {w:"Blau",t:"Blue",p:"blow",e:"🔵"}, {w:"Grün",t:"Green",p:"gruen",e:"🟢"},
    {w:"Gelb",t:"Yellow",p:"gelp",e:"🟡"}, {w:"Schwarz",t:"Black",p:"shvarts",e:"⚫"},
    {w:"Weiß",t:"White",p:"vice",e:"⚪"}, {w:"Grau",t:"Grey",p:"grow",e:"🩶"},
    {w:"Braun",t:"Brown",p:"brown",e:"🟤"}, {w:"Rosa",t:"Pink",p:"ROH-zah",e:"🌸"},
    {w:"Orange",t:"Orange",p:"oh-RAHN-zheh",e:"🟠"}, {w:"Lila",t:"Purple",p:"LEE-lah",e:"🟣"},
    {w:"Sohn",t:"Son",p:"zohn",e:"👦"}, {w:"Tochter",t:"Daughter",p:"TOKH-ter",e:"👧"},
    {w:"Bruder",t:"Brother",p:"BROO-der",e:"👬"}, {w:"Schwester",t:"Sister",p:"SHVES-ter",e:"👭"},
    {w:"Großvater",t:"Grandfather",p:"GROHS-fah-ter",e:"👴"}, {w:"Großmutter",t:"Grandmother",p:"GROHS-moo-ter",e:"👵"},
    {w:"Onkel",t:"Uncle",p:"ON-kel",e:"👨"}, {w:"Tante",t:"Aunt",p:"TAHN-teh",e:"👩"},
    {w:"Mann",t:"Man/husband",p:"mahn",e:"👨"}, {w:"Frau",t:"Woman/wife",p:"frow",e:"👩"},
    {w:"Kind",t:"Child",p:"kint",e:"👶"}, {w:"Junge",t:"Boy",p:"YOONG-eh",e:"🧑"},
    {w:"Mädchen",t:"Girl",p:"MED-khen",e:"👧"}, {w:"Leute",t:"People",p:"LOY-teh",e:"👥"},
    {w:"Person",t:"Person",p:"per-ZOHN",e:"👤"}, {w:"Baby",t:"Baby",p:"BEH-bee",e:"👶"},
    {w:"Kopf",t:"Head",p:"kopf",e:"🗣"}, {w:"Auge",t:"Eye",p:"OW-geh",e:"👁"},
    {w:"Hand",t:"Hand",p:"hahnt",e:"✋"}, {w:"Fuß",t:"Foot",p:"foos",e:"🦶"},
    {w:"Herz",t:"Heart",p:"herts",e:"❤️"}, {w:"Mund",t:"Mouth",p:"moont",e:"👄"},
    {w:"Nase",t:"Nose",p:"NAH-zeh",e:"👃"}, {w:"Ohr",t:"Ear",p:"or",e:"👂"},
    {w:"Arm",t:"Arm",p:"arm",e:"💪"}, {w:"Bein",t:"Leg",p:"bine",e:"🦵"},
    {w:"Haare",t:"Hair",p:"HAH-reh",e:"💇"}, {w:"Gesicht",t:"Face",p:"geh-ZIKHT",e:"🙂"},
    {w:"Brot",t:"Bread",p:"broht",e:"🍞"}, {w:"Milch",t:"Milk",p:"milkh",e:"🥛"},
    {w:"Wein",t:"Wine",p:"vine",e:"🍷"}, {w:"Bier",t:"Beer",p:"beer",e:"🍺"},
    {w:"Kaffee",t:"Coffee",p:"kah-FEH",e:"☕"}, {w:"Tee",t:"Tea",p:"teh",e:"🍵"},
    {w:"Fleisch",t:"Meat",p:"flysh",e:"🥩"}, {w:"Fisch",t:"Fish",p:"fish",e:"🐟"},
    {w:"Hähnchen",t:"Chicken",p:"HEN-khen",e:"🍗"}, {w:"Reis",t:"Rice",p:"rice",e:"🍚"},
    {w:"Nudeln",t:"Pasta/noodles",p:"NOO-deln",e:"🍝"}, {w:"Käse",t:"Cheese",p:"KEH-zeh",e:"🧀"},
    {w:"Ei",t:"Egg",p:"eye",e:"🥚"}, {w:"Obst",t:"Fruit",p:"ohpst",e:"🍎"},
    {w:"Apfel",t:"Apple",p:"AHP-fel",e:"🍏"}, {w:"Banane",t:"Banana",p:"bah-NAH-neh",e:"🍌"},
    {w:"Gemüse",t:"Vegetables",p:"geh-MUE-zeh",e:"🥦"}, {w:"Tomate",t:"Tomato",p:"toh-MAH-teh",e:"🍅"},
    {w:"Kartoffel",t:"Potato",p:"kar-TOF-fel",e:"🥔"}, {w:"Salat",t:"Salad",p:"zah-LAHT",e:"🥗"},
    {w:"Zucker",t:"Sugar",p:"TSOO-ker",e:"🍬"}, {w:"Salz",t:"Salt",p:"zalts",e:"🧂"},
    {w:"Öl",t:"Oil",p:"url",e:"🫒"}, {w:"Butter",t:"Butter",p:"BOO-ter",e:"🧈"},
    {w:"Kuchen",t:"Cake",p:"KOO-khen",e:"🍰"}, {w:"Eis",t:"Ice cream",p:"ice",e:"🍨"},
    {w:"Frühstück",t:"Breakfast",p:"FRUE-shtuek",e:"🥐"}, {w:"Mittagessen",t:"Lunch",p:"MIT-tahk-es-sen",e:"🍽"},
    {w:"Abendessen",t:"Dinner",p:"AH-bent-es-sen",e:"🌙"}, {w:"Restaurant",t:"Restaurant",p:"res-toh-RAHN",e:"🍴"},
    {w:"Tisch",t:"Table",p:"tish",e:"🪑"}, {w:"Tür",t:"Door",p:"tuer",e:"🚪"},
    {w:"Fenster",t:"Window",p:"FEN-ster",e:"🪟"}, {w:"Zimmer",t:"Room",p:"TSIM-mer",e:"🛏"},
    {w:"Küche",t:"Kitchen",p:"KUE-kheh",e:"🍳"}, {w:"Bad",t:"Bathroom",p:"baht",e:"🛁"},
    {w:"Bett",t:"Bed",p:"bet",e:"🛌"}, {w:"Stuhl",t:"Chair",p:"shtool",e:"🪑"},
    {w:"Schlüssel",t:"Key",p:"SHLUES-sel",e:"🔑"}, {w:"Licht",t:"Light",p:"likht",e:"💡"},
    {w:"Straße",t:"Street",p:"SHTRAH-seh",e:"🛣"}, {w:"Geschäft",t:"Shop",p:"geh-SHEFT",e:"🏪"},
    {w:"Markt",t:"Market",p:"markt",e:"🛍"}, {w:"Schule",t:"School",p:"SHOO-leh",e:"🏫"},
    {w:"Krankenhaus",t:"Hospital",p:"KRAHN-ken-hows",e:"🏥"}, {w:"Kirche",t:"Church",p:"KEER-kheh",e:"⛪"},
    {w:"Bank",t:"Bank/bench",p:"bahnk",e:"🏦"}, {w:"Büro",t:"Office",p:"bue-ROH",e:"🏢"},
    {w:"Bahnhof",t:"Train station",p:"BAHN-hohf",e:"🚉"}, {w:"Flughafen",t:"Airport",p:"FLOOK-hah-fen",e:"✈️"},
    {w:"Hotel",t:"Hotel",p:"hoh-TEL",e:"🏨"}, {w:"Auto",t:"Car",p:"OW-toh",e:"🚗"},
    {w:"Zug",t:"Train",p:"tsook",e:"🚆"}, {w:"Bus",t:"Bus",p:"boos",e:"🚌"},
    {w:"Flugzeug",t:"Airplane",p:"FLOOK-tsoyk",e:"🛩"}, {w:"Fahrrad",t:"Bicycle",p:"FAHR-raht",e:"🚲"},
    {w:"Fahrkarte",t:"Ticket",p:"FAHR-kar-teh",e:"🎫"}, {w:"Neu",t:"New",p:"noy",e:"✨"},
    {w:"Alt",t:"Old",p:"ahlt",e:"🏚"}, {w:"Jung",t:"Young",p:"yoong",e:"🧒"},
    {w:"Schön",t:"Beautiful",p:"shurn",e:"😍"}, {w:"Hässlich",t:"Ugly",p:"HES-likh",e:"🫣"},
    {w:"Heiß",t:"Hot",p:"hice",e:"🔥"}, {w:"Kalt",t:"Cold",p:"kahlt",e:"🧊"},
    {w:"Hoch",t:"High/tall",p:"hohkh",e:"📏"}, {w:"Niedrig",t:"Low",p:"NEE-drikh",e:"📉"},
    {w:"Lang",t:"Long",p:"lahng",e:"📏"}, {w:"Kurz",t:"Short",p:"koorts",e:"✂️"},
    {w:"Stark",t:"Strong",p:"shtark",e:"💪"}, {w:"Schwach",t:"Weak",p:"shvahkh",e:"🪶"},
    {w:"Einfach",t:"Easy/simple",p:"INE-fahkh",e:"🟢"}, {w:"Schwierig",t:"Difficult",p:"SHVEE-rikh",e:"🔴"},
    {w:"Wichtig",t:"Important",p:"VIKH-tikh",e:"⭐"}, {w:"Richtig",t:"Right/correct",p:"RIKH-tikh",e:"✅"},
    {w:"Falsch",t:"Wrong/false",p:"fahlsh",e:"❌"}, {w:"Wahr",t:"True",p:"vahr",e:"✔️"},
    {w:"Voll",t:"Full",p:"fol",e:"🈵"}, {w:"Leer",t:"Empty",p:"lair",e:"🈳"},
    {w:"Offen",t:"Open",p:"OF-fen",e:"🔓"}, {w:"Geschlossen",t:"Closed",p:"geh-SHLOS-sen",e:"🔒"},
    {w:"Sauber",t:"Clean",p:"ZOW-ber",e:"🧼"}, {w:"Schmutzig",t:"Dirty",p:"SHMOOT-sikh",e:"🧹"},
    {w:"Reich",t:"Rich",p:"rykh",e:"💎"}, {w:"Arm (adj.)",t:"Poor",p:"arm",e:"🪙"},
    {w:"Frei",t:"Free",p:"fry",e:"🕊"}, {w:"Beschäftigt",t:"Busy",p:"beh-SHEF-tikht",e:"📵"},
    {w:"Fertig",t:"Ready/done",p:"FER-tikh",e:"🚦"}, {w:"Sicher",t:"Safe/sure",p:"ZIKH-er",e:"🛡"},
    {w:"Gleich",t:"Same/soon",p:"glykh",e:"🟰"}, {w:"Anders",t:"Different",p:"AHN-ders",e:"🔀"},
    {w:"Teuer",t:"Expensive",p:"TOY-er",e:"💸"}, {w:"Billig",t:"Cheap",p:"BIL-likh",e:"🏷"},
    {w:"Gesund",t:"Healthy",p:"geh-ZOONT",e:"💚"}, {w:"Krank",t:"Sick",p:"krahnk",e:"🤒"},
    {w:"Sonne",t:"Sun",p:"ZON-neh",e:"☀️"}, {w:"Mond",t:"Moon",p:"mohnt",e:"🌙"},
    {w:"Stern",t:"Star",p:"shtern",e:"⭐"}, {w:"Himmel",t:"Sky",p:"HIM-mel",e:"🌤"},
    {w:"Meer",t:"Sea",p:"mair",e:"🌊"}, {w:"Berg",t:"Mountain",p:"bairk",e:"⛰"},
    {w:"Fluss",t:"River",p:"floos",e:"🏞"}, {w:"Baum",t:"Tree",p:"bowm",e:"🌳"},
    {w:"Blume",t:"Flower",p:"BLOO-meh",e:"🌸"}, {w:"Regen",t:"Rain",p:"REH-gen",e:"🌧"},
    {w:"Schnee",t:"Snow",p:"shneh",e:"❄️"}, {w:"Wind",t:"Wind",p:"vint",e:"💨"},
    {w:"Feuer",t:"Fire",p:"FOY-er",e:"🔥"}, {w:"Erde",t:"Earth",p:"ER-deh",e:"🌍"},
    {w:"Luft",t:"Air",p:"looft",e:"🌬"}, {w:"Ding",t:"Thing",p:"ding",e:"📦"},
    {w:"Welt",t:"World",p:"velt",e:"🌎"}, {w:"Land",t:"Country",p:"lahnt",e:"🗺"},
    {w:"Ort",t:"Place",p:"ort",e:"📍"}, {w:"Teil",t:"Part",p:"tile",e:"🧩"},
    {w:"Mal",t:"Time (occasion)",p:"mahl",e:"🔁"}, {w:"Name",t:"Name",p:"NAH-meh",e:"🏷"},
    {w:"Wort",t:"Word",p:"vort",e:"🔤"}, {w:"Frage",t:"Question",p:"FRAH-geh",e:"❓"},
    {w:"Antwort",t:"Answer",p:"ANT-vort",e:"💬"}, {w:"Problem",t:"Problem",p:"proh-BLEHM",e:"⚠️"},
    {w:"Idee",t:"Idea",p:"ee-DEH",e:"💡"}, {w:"Geschichte",t:"Story/history",p:"geh-SHIKH-teh",e:"📜"},
    {w:"Musik",t:"Music",p:"moo-ZEEK",e:"🎵"}, {w:"Film",t:"Movie",p:"film",e:"🎬"},
    {w:"Foto",t:"Photo",p:"FOH-toh",e:"📷"}, {w:"Telefon",t:"Telephone",p:"TEH-leh-fohn",e:"📱"},
    {w:"Spiel",t:"Game",p:"shpeel",e:"🎲"}, {w:"Sport",t:"Sport",p:"shport",e:"⚽"},
    {w:"Fußball",t:"Football",p:"FOOS-bahl",e:"⚽"}, {w:"Guten Morgen",t:"Good morning",p:"GOO-ten MOR-gen",e:"🌅"},
    {w:"Guten Abend",t:"Good evening",p:"GOO-ten AH-bent",e:"🌆"}, {w:"Gute Nacht",t:"Good night",p:"GOO-teh NAHKHT",e:"🌙"},
    {w:"Auf Wiedersehen",t:"Goodbye",p:"owf VEE-der-zeh-en",e:"👋"}, {w:"Tschüss",t:"Bye",p:"chues",e:"👋"},
    {w:"Entschuldigung",t:"Sorry/excuse me",p:"ent-SHOOL-dee-goong",e:"🙇"}, {w:"Bitte schön",t:"You're welcome",p:"BIT-teh shurn",e:"🤲"},
    {w:"In Ordnung",t:"Okay/alright",p:"in ORT-noong",e:"👌"}, {w:"Ich weiß nicht",t:"I don't know",p:"ikh vice NIKHT",e:"🤷"},
    {w:"Ich verstehe nicht",t:"I don't understand",p:"ikh fer-SHTEH-eh nikht",e:"😕"}, {w:"Wie viel kostet das?",t:"How much is it?",p:"vee feel KOS-tet dahs",e:"💶"},
    {w:"Wo ist...?",t:"Where is...?",p:"voh IST",e:"🧭"}, {w:"Wie spät ist es?",t:"What time is it?",p:"vee SHPEHT ist es",e:"🕐"},
    {w:"Ich heiße",t:"My name is",p:"ikh HY-seh",e:"🪪"}, {w:"Freut mich",t:"Nice to meet you",p:"froyt MIKH",e:"🤝"},
    {w:"Hilfe!",t:"Help!",p:"HIL-feh",e:"🆘"}, {w:"Prost!",t:"Cheers!",p:"prohst",e:"🥂"},
    {w:"Herzlichen Glückwunsch",t:"Congratulations",p:"HERTS-likh-en GLUEK-voonsh",e:"🎉"}, {w:"Willkommen",t:"Welcome",p:"vil-KOM-men",e:"🎊"},
    {w:"Los geht's!",t:"Let's go!",p:"lohs GEHTS",e:"🚀"}
  ],
  pt: [
    {w:"Olá",        t:"Hello",       p:"oh-LAH",         e:"🙋"}, {w:"Obrigado",   t:"Thank you",   p:"oh-bree-GAH-doh",e:"🙏"},
    {w:"Por favor",  t:"Please",      p:"por fah-VOR",    e:"✋"}, {w:"Sim",        t:"Yes",         p:"seem",           e:"✅"},
    {w:"Não",        t:"No",          p:"nowng",          e:"❌"}, {w:"Água",       t:"Water",       p:"AH-gwah",        e:"💧"},
    {w:"Comida",     t:"Food",        p:"koh-MEE-dah",    e:"🍽"}, {w:"Casa",       t:"House",       p:"KAH-zah",        e:"🏠"},
    {w:"Amigo",      t:"Friend",      p:"ah-MEE-goh",     e:"👫"}, {w:"Amor",       t:"Love",        p:"ah-MOR",         e:"❤️"},
    {w:"Trabalho",   t:"Work",        p:"trah-BAH-lyoh",  e:"💼"}, {w:"Dinheiro",   t:"Money",       p:"deen-YEH-roh",   e:"💰"},
    {w:"Tempo",      t:"Time",        p:"TEM-poh",        e:"⏰"}, {w:"Bom",        t:"Good",        p:"bom",            e:"👍"},
    {w:"Mau",        t:"Bad",         p:"mow",            e:"👎"}, {w:"Grande",     t:"Big",         p:"GRAHN-deh",      e:"🐘"},
    {w:"Pequeno",    t:"Small",       p:"peh-KEH-noh",    e:"🐭"}, {w:"Rápido",     t:"Fast",        p:"HAH-pee-doh",    e:"🏃"},
    {w:"Lento",      t:"Slow",        p:"LEN-toh",        e:"🐢"}, {w:"Feliz",      t:"Happy",       p:"feh-LEES",       e:"😊"},
    {w:"Triste",     t:"Sad",         p:"TREES-teh",      e:"😢"}, {w:"Cansado",    t:"Tired",       p:"kahn-SAH-doh",   e:"😴"},
    {w:"Fome",       t:"Hungry",      p:"FOH-meh",        e:"🤤"}, {w:"Sede",       t:"Thirsty",     p:"SEH-deh",        e:"😮"},
    {w:"Família",    t:"Family",      p:"fah-MEE-lyah",   e:"👨‍👩‍👧"}, {w:"Mãe",        t:"Mother",      p:"mah-EE",         e:"👩"},
    {w:"Pai",        t:"Father",      p:"pie",            e:"👨"}, {w:"Livro",      t:"Book",        p:"LEE-vroh",       e:"📚"},
    {w:"Cidade",     t:"City",        p:"see-DAH-deh",    e:"🏙"}, {w:"Praia",      t:"Beach",       p:"PRY-ah",         e:"🏖"},
    {w:"Ser",t:"To be (permanent)",p:"sehr",e:"🧍"}, {w:"Estar",t:"To be (state)",p:"es-TAR",e:"📍"},
    {w:"Ter",t:"To have",p:"tehr",e:"🤲"}, {w:"Fazer",t:"To do/make",p:"fah-ZEHR",e:"🔨"},
    {w:"Dizer",t:"To say",p:"jee-ZEHR",e:"🗣"}, {w:"Poder",t:"To be able",p:"poh-DEHR",e:"💪"},
    {w:"Querer",t:"To want",p:"keh-REHR",e:"🙌"}, {w:"Saber",t:"To know",p:"sah-BEHR",e:"🧠"},
    {w:"Dever",t:"To have to",p:"deh-VEHR",e:"📋"}, {w:"Ver",t:"To see",p:"vehr",e:"👀"},
    {w:"Ir",t:"To go",p:"eer",e:"🚶"}, {w:"Vir",t:"To come",p:"veer",e:"👋"},
    {w:"Dar",t:"To give",p:"dar",e:"🎁"}, {w:"Falar",t:"To speak",p:"fah-LAR",e:"💬"},
    {w:"Encontrar",t:"To find/meet",p:"en-kon-TRAR",e:"🔍"}, {w:"Sentir",t:"To feel",p:"sen-CHEER",e:"💗"},
    {w:"Tomar",t:"To take/drink",p:"toh-MAR",e:"✊"}, {w:"Olhar",t:"To look at",p:"oh-LYAR",e:"👁"},
    {w:"Colocar",t:"To put",p:"koh-loh-KAR",e:"📥"}, {w:"Pensar",t:"To think",p:"pen-SAR",e:"💭"},
    {w:"Achar",t:"To think/find",p:"ah-SHAR",e:"💡"}, {w:"Levar",t:"To carry/take",p:"leh-VAR",e:"🎒"},
    {w:"Viver",t:"To live",p:"vee-VEHR",e:"🌱"}, {w:"Voltar",t:"To return",p:"vol-TAR",e:"🔙"},
    {w:"Entender",t:"To understand",p:"en-ten-DEHR",e:"💡"}, {w:"Chegar",t:"To arrive",p:"sheh-GAR",e:"🏁"},
    {w:"Conhecer",t:"To know (people)",p:"koh-nyeh-SEHR",e:"🤝"}, {w:"Lembrar",t:"To remember",p:"lem-BRAR",e:"🧾"},
    {w:"Chamar",t:"To call",p:"shah-MAR",e:"📞"}, {w:"Esperar",t:"To wait/hope",p:"es-peh-RAR",e:"⏳"},
    {w:"Terminar",t:"To finish",p:"ter-mee-NAR",e:"🏁"}, {w:"Comer",t:"To eat",p:"koh-MEHR",e:"🍽"},
    {w:"Beber",t:"To drink",p:"beh-BEHR",e:"🥤"}, {w:"Dormir",t:"To sleep",p:"dor-MEER",e:"😴"},
    {w:"Abrir",t:"To open",p:"ah-BREER",e:"🔓"}, {w:"Fechar",t:"To close",p:"feh-SHAR",e:"🔒"},
    {w:"Comprar",t:"To buy",p:"kom-PRAR",e:"🛒"}, {w:"Pagar",t:"To pay",p:"pah-GAR",e:"💳"},
    {w:"Ler",t:"To read",p:"lehr",e:"📖"}, {w:"Escrever",t:"To write",p:"es-kreh-VEHR",e:"✍️"},
    {w:"Ouvir",t:"To listen/hear",p:"oh-VEER",e:"🎧"}, {w:"Jogar",t:"To play",p:"zhoh-GAR",e:"🎮"},
    {w:"Correr",t:"To run",p:"koh-HEHR",e:"🏃"}, {w:"Andar",t:"To walk",p:"an-DAR",e:"🚶"},
    {w:"Ajudar",t:"To help",p:"ah-zhoo-DAR",e:"🆘"}, {w:"Amar",t:"To love",p:"ah-MAR",e:"❤️"},
    {w:"Trabalhar",t:"To work",p:"trah-bah-LYAR",e:"💼"}, {w:"Estudar",t:"To study",p:"es-too-DAR",e:"📚"},
    {w:"Aprender",t:"To learn",p:"ah-pren-DEHR",e:"🎓"}, {w:"Ensinar",t:"To teach",p:"en-see-NAR",e:"👩‍🏫"},
    {w:"Começar",t:"To begin",p:"koh-meh-SAR",e:"▶️"}, {w:"Procurar",t:"To search",p:"proh-koo-RAR",e:"🔎"},
    {w:"Usar",t:"To use",p:"oo-ZAR",e:"🛠"}, {w:"Perguntar",t:"To ask",p:"per-goon-TAR",e:"❓"},
    {w:"Responder",t:"To answer",p:"hes-pon-DEHR",e:"💬"}, {w:"Sair",t:"To go out",p:"sah-EER",e:"🚪"},
    {w:"Entrar",t:"To enter",p:"en-TRAR",e:"➡️"}, {w:"Perder",t:"To lose",p:"per-DEHR",e:"🫥"},
    {w:"Ganhar",t:"To win/earn",p:"gah-NYAR",e:"🏆"}, {w:"Tentar",t:"To try",p:"ten-TAR",e:"🎯"},
    {w:"Mudar",t:"To change",p:"moo-DAR",e:"🔄"}, {w:"Eu",t:"I",p:"eh-oo",e:"🙋"},
    {w:"Você",t:"You",p:"voh-SEH",e:"👉"}, {w:"Ele",t:"He",p:"EH-lee",e:"👨"},
    {w:"Ela",t:"She",p:"EH-lah",e:"👩"}, {w:"Nós",t:"We",p:"nohs",e:"👥"},
    {w:"Eles",t:"They",p:"EH-lees",e:"👪"}, {w:"Isto",t:"This",p:"EES-too",e:"👇"},
    {w:"Isso",t:"That",p:"EE-soo",e:"👉"}, {w:"Tudo",t:"Everything",p:"TOO-doo",e:"🌐"},
    {w:"Nada",t:"Nothing",p:"NAH-dah",e:"🚫"}, {w:"Algo",t:"Something",p:"AHL-goo",e:"❔"},
    {w:"Alguém",t:"Someone",p:"ahl-GEM",e:"👤"}, {w:"Ninguém",t:"Nobody",p:"neen-GEM",e:"🙅"},
    {w:"Muito",t:"A lot/very",p:"MOO-ee-too",e:"📈"}, {w:"Pouco",t:"Little/few",p:"POH-koo",e:"🤏"},
    {w:"Demais",t:"Too much",p:"jee-MICE",e:"🛑"}, {w:"Mais",t:"More",p:"mice",e:"➕"},
    {w:"Menos",t:"Less",p:"MEH-noos",e:"➖"}, {w:"Também",t:"Also",p:"tam-BEM",e:"➕"},
    {w:"Sempre",t:"Always",p:"SEM-pree",e:"♾️"}, {w:"Nunca",t:"Never",p:"NOON-kah",e:"🚫"},
    {w:"Já",t:"Already",p:"zhah",e:"✔️"}, {w:"Ainda",t:"Still/yet",p:"ah-EEN-dah",e:"🔁"},
    {w:"Agora",t:"Now",p:"ah-GOH-rah",e:"⏱"}, {w:"Depois",t:"After/later",p:"deh-POYS",e:"⏭"},
    {w:"Antes",t:"Before",p:"AHN-chees",e:"⏮"}, {w:"Aqui",t:"Here",p:"ah-KEE",e:"📍"},
    {w:"Ali",t:"There",p:"ah-LEE",e:"🗺"}, {w:"Onde",t:"Where",p:"ON-jee",e:"🧭"},
    {w:"Quando",t:"When",p:"KWAN-doo",e:"📅"}, {w:"Por quê",t:"Why",p:"poor KEH",e:"❓"},
    {w:"Como",t:"How",p:"KOH-moo",e:"🤔"}, {w:"Quem",t:"Who",p:"kem",e:"👤"},
    {w:"O que",t:"What",p:"oo KEH",e:"❔"}, {w:"Qual",t:"Which",p:"kwahl",e:"🔀"},
    {w:"Quanto",t:"How much",p:"KWAN-too",e:"⚖️"}, {w:"Um",t:"One",p:"oom",e:"1️⃣"},
    {w:"Dois",t:"Two",p:"doys",e:"2️⃣"}, {w:"Três",t:"Three",p:"trehs",e:"3️⃣"},
    {w:"Quatro",t:"Four",p:"KWAH-troo",e:"4️⃣"}, {w:"Cinco",t:"Five",p:"SEEN-koo",e:"5️⃣"},
    {w:"Seis",t:"Six",p:"says",e:"6️⃣"}, {w:"Sete",t:"Seven",p:"SEH-chee",e:"7️⃣"},
    {w:"Oito",t:"Eight",p:"OY-too",e:"8️⃣"}, {w:"Nove",t:"Nine",p:"NOH-vee",e:"9️⃣"},
    {w:"Dez",t:"Ten",p:"dehz",e:"🔟"}, {w:"Onze",t:"Eleven",p:"ON-zee",e:"🔢"},
    {w:"Doze",t:"Twelve",p:"DOH-zee",e:"🔢"}, {w:"Vinte",t:"Twenty",p:"VEEN-chee",e:"🔢"},
    {w:"Trinta",t:"Thirty",p:"TREEN-tah",e:"🔢"}, {w:"Quarenta",t:"Forty",p:"kwah-REN-tah",e:"🔢"},
    {w:"Cinquenta",t:"Fifty",p:"seen-KWEN-tah",e:"🔢"}, {w:"Cem",t:"Hundred",p:"sem",e:"💯"},
    {w:"Mil",t:"Thousand",p:"meel",e:"🔢"}, {w:"Primeiro",t:"First",p:"pree-MAY-roo",e:"🥇"},
    {w:"Segundo",t:"Second",p:"seh-GOON-doo",e:"🥈"}, {w:"Último",t:"Last",p:"OOL-chee-moo",e:"🔚"},
    {w:"Segunda-feira",t:"Monday",p:"seh-GOON-dah FAY-rah",e:"📅"}, {w:"Terça-feira",t:"Tuesday",p:"TEHR-sah FAY-rah",e:"📅"},
    {w:"Quarta-feira",t:"Wednesday",p:"KWAR-tah FAY-rah",e:"📅"}, {w:"Quinta-feira",t:"Thursday",p:"KEEN-tah FAY-rah",e:"📅"},
    {w:"Sexta-feira",t:"Friday",p:"SES-tah FAY-rah",e:"📅"}, {w:"Sábado",t:"Saturday",p:"SAH-bah-doo",e:"📅"},
    {w:"Domingo",t:"Sunday",p:"doh-MEEN-goo",e:"📅"}, {w:"Hoje",t:"Today",p:"OH-zhee",e:"📆"},
    {w:"Amanhã",t:"Tomorrow",p:"ah-mah-NYAH",e:"🌅"}, {w:"Ontem",t:"Yesterday",p:"ON-tem",e:"🌇"},
    {w:"Semana",t:"Week",p:"seh-MAH-nah",e:"🗓"}, {w:"Mês",t:"Month",p:"mehs",e:"🗓"},
    {w:"Ano",t:"Year",p:"AH-noo",e:"🎆"}, {w:"Dia",t:"Day",p:"JEE-ah",e:"☀️"},
    {w:"Noite",t:"Night",p:"NOY-chee",e:"🌙"}, {w:"Manhã",t:"Morning",p:"mah-NYAH",e:"🌄"},
    {w:"Tarde",t:"Afternoon",p:"TAR-jee",e:"🌆"}, {w:"Hora",t:"Hour",p:"OH-rah",e:"🕐"},
    {w:"Minuto",t:"Minute",p:"mee-NOO-too",e:"⏱"}, {w:"Janeiro",t:"January",p:"zhah-NAY-roo",e:"❄️"},
    {w:"Fevereiro",t:"February",p:"feh-veh-RAY-roo",e:"💘"}, {w:"Março",t:"March",p:"MAR-soo",e:"🌸"},
    {w:"Abril",t:"April",p:"ah-BREEL",e:"🌷"}, {w:"Maio",t:"May",p:"MY-oo",e:"🌼"},
    {w:"Junho",t:"June",p:"ZHOO-nyoo",e:"☀️"}, {w:"Julho",t:"July",p:"ZHOO-lyoo",e:"🏖"},
    {w:"Agosto",t:"August",p:"ah-GOS-too",e:"🌞"}, {w:"Setembro",t:"September",p:"seh-TEM-broo",e:"🍂"},
    {w:"Outubro",t:"October",p:"oh-TOO-broo",e:"🎃"}, {w:"Novembro",t:"November",p:"noh-VEM-broo",e:"🌧"},
    {w:"Dezembro",t:"December",p:"deh-ZEM-broo",e:"🎄"}, {w:"Vermelho",t:"Red",p:"ver-MEH-lyoo",e:"🔴"},
    {w:"Azul",t:"Blue",p:"ah-ZOOL",e:"🔵"}, {w:"Verde",t:"Green",p:"VEHR-jee",e:"🟢"},
    {w:"Amarelo",t:"Yellow",p:"ah-mah-REH-loo",e:"🟡"}, {w:"Preto",t:"Black",p:"PREH-too",e:"⚫"},
    {w:"Branco",t:"White",p:"BRAHN-koo",e:"⚪"}, {w:"Cinza",t:"Grey",p:"SEEN-zah",e:"🩶"},
    {w:"Marrom",t:"Brown",p:"mah-HOHM",e:"🟤"}, {w:"Rosa",t:"Pink",p:"HOH-zah",e:"🌸"},
    {w:"Laranja",t:"Orange",p:"lah-RAHN-zhah",e:"🟠"}, {w:"Roxo",t:"Purple",p:"HOH-shoo",e:"🟣"},
    {w:"Filho",t:"Son",p:"FEE-lyoo",e:"👦"}, {w:"Filha",t:"Daughter",p:"FEE-lyah",e:"👧"},
    {w:"Irmão",t:"Brother",p:"eer-MOWN",e:"👬"}, {w:"Irmã",t:"Sister",p:"eer-MAH",e:"👭"},
    {w:"Avô",t:"Grandfather",p:"ah-VOH",e:"👴"}, {w:"Avó",t:"Grandmother",p:"ah-VAW",e:"👵"},
    {w:"Tio",t:"Uncle",p:"CHEE-oo",e:"👨"}, {w:"Tia",t:"Aunt",p:"CHEE-ah",e:"👩"},
    {w:"Marido",t:"Husband",p:"mah-REE-doo",e:"🤵"}, {w:"Mulher",t:"Woman/wife",p:"moo-LYEHR",e:"👩"},
    {w:"Criança",t:"Child",p:"kree-AHN-sah",e:"👶"}, {w:"Menino",t:"Boy",p:"meh-NEE-noo",e:"🧑"},
    {w:"Menina",t:"Girl",p:"meh-NEE-nah",e:"👧"}, {w:"Homem",t:"Man",p:"OH-mem",e:"👨"},
    {w:"Gente",t:"People",p:"ZHEN-chee",e:"👥"}, {w:"Pessoa",t:"Person",p:"peh-SOH-ah",e:"👤"},
    {w:"Cabeça",t:"Head",p:"kah-BEH-sah",e:"🗣"}, {w:"Olho",t:"Eye",p:"OH-lyoo",e:"👁"},
    {w:"Mão",t:"Hand",p:"mown",e:"✋"}, {w:"Pé",t:"Foot",p:"peh",e:"🦶"},
    {w:"Coração",t:"Heart",p:"koh-rah-SOWN",e:"❤️"}, {w:"Boca",t:"Mouth",p:"BOH-kah",e:"👄"},
    {w:"Nariz",t:"Nose",p:"nah-REES",e:"👃"}, {w:"Orelha",t:"Ear",p:"oh-REH-lyah",e:"👂"},
    {w:"Braço",t:"Arm",p:"BRAH-soo",e:"💪"}, {w:"Perna",t:"Leg",p:"PEHR-nah",e:"🦵"},
    {w:"Cabelo",t:"Hair",p:"kah-BEH-loo",e:"💇"}, {w:"Rosto",t:"Face",p:"HOS-too",e:"🙂"},
    {w:"Pão",t:"Bread",p:"pown",e:"🍞"}, {w:"Leite",t:"Milk",p:"LAY-chee",e:"🥛"},
    {w:"Vinho",t:"Wine",p:"VEE-nyoo",e:"🍷"}, {w:"Cerveja",t:"Beer",p:"ser-VEH-zhah",e:"🍺"},
    {w:"Café",t:"Coffee",p:"kah-FEH",e:"☕"}, {w:"Chá",t:"Tea",p:"shah",e:"🍵"},
    {w:"Carne",t:"Meat",p:"KAR-nee",e:"🥩"}, {w:"Peixe",t:"Fish",p:"PAY-shee",e:"🐟"},
    {w:"Frango",t:"Chicken",p:"FRAHN-goo",e:"🍗"}, {w:"Arroz",t:"Rice",p:"ah-HOHS",e:"🍚"},
    {w:"Macarrão",t:"Pasta",p:"mah-kah-HOWN",e:"🍝"}, {w:"Queijo",t:"Cheese",p:"KAY-zhoo",e:"🧀"},
    {w:"Ovo",t:"Egg",p:"OH-voo",e:"🥚"}, {w:"Fruta",t:"Fruit",p:"FROO-tah",e:"🍎"},
    {w:"Maçã",t:"Apple",p:"mah-SAH",e:"🍏"}, {w:"Banana",t:"Banana",p:"bah-NAH-nah",e:"🍌"},
    {w:"Legumes",t:"Vegetables",p:"leh-GOO-mees",e:"🥦"}, {w:"Tomate",t:"Tomato",p:"toh-MAH-chee",e:"🍅"},
    {w:"Batata",t:"Potato",p:"bah-TAH-tah",e:"🥔"}, {w:"Salada",t:"Salad",p:"sah-LAH-dah",e:"🥗"},
    {w:"Açúcar",t:"Sugar",p:"ah-SOO-kar",e:"🍬"}, {w:"Sal",t:"Salt",p:"sahl",e:"🧂"},
    {w:"Óleo",t:"Oil",p:"AW-leh-oo",e:"🫒"}, {w:"Manteiga",t:"Butter",p:"man-TAY-gah",e:"🧈"},
    {w:"Bolo",t:"Cake",p:"BOH-loo",e:"🍰"}, {w:"Sorvete",t:"Ice cream",p:"sor-VEH-chee",e:"🍨"},
    {w:"Café da manhã",t:"Breakfast",p:"kah-FEH dah mah-NYAH",e:"🥐"}, {w:"Almoço",t:"Lunch",p:"ahl-MOH-soo",e:"🍽"},
    {w:"Jantar",t:"Dinner",p:"zhan-TAR",e:"🌙"}, {w:"Restaurante",t:"Restaurant",p:"hes-tow-RAHN-chee",e:"🍴"},
    {w:"Mesa",t:"Table",p:"MEH-zah",e:"🪑"}, {w:"Porta",t:"Door",p:"POR-tah",e:"🚪"},
    {w:"Janela",t:"Window",p:"zhah-NEH-lah",e:"🪟"}, {w:"Quarto",t:"Bedroom",p:"KWAR-too",e:"🛏"},
    {w:"Cozinha",t:"Kitchen",p:"koh-ZEE-nyah",e:"🍳"}, {w:"Banheiro",t:"Bathroom",p:"bah-NYAY-roo",e:"🛁"},
    {w:"Cama",t:"Bed",p:"KAH-mah",e:"🛌"}, {w:"Cadeira",t:"Chair",p:"kah-DAY-rah",e:"🪑"},
    {w:"Chave",t:"Key",p:"SHAH-vee",e:"🔑"}, {w:"Luz",t:"Light",p:"loos",e:"💡"},
    {w:"Rua",t:"Street",p:"HOO-ah",e:"🛣"}, {w:"Loja",t:"Shop",p:"LOH-zhah",e:"🏪"},
    {w:"Mercado",t:"Market",p:"mer-KAH-doo",e:"🛍"}, {w:"Escola",t:"School",p:"es-KOH-lah",e:"🏫"},
    {w:"Hospital",t:"Hospital",p:"os-pee-TAHL",e:"🏥"}, {w:"Igreja",t:"Church",p:"ee-GREH-zhah",e:"⛪"},
    {w:"Banco",t:"Bank",p:"BAHN-koo",e:"🏦"}, {w:"Escritório",t:"Office",p:"es-kree-TAW-ree-oo",e:"🏢"},
    {w:"Estação",t:"Station",p:"es-tah-SOWN",e:"🚉"}, {w:"Aeroporto",t:"Airport",p:"ah-eh-roh-POR-too",e:"✈️"},
    {w:"Hotel",t:"Hotel",p:"oh-TEL",e:"🏨"}, {w:"Carro",t:"Car",p:"KAH-hoo",e:"🚗"},
    {w:"Trem",t:"Train",p:"trem",e:"🚆"}, {w:"Ônibus",t:"Bus",p:"OH-nee-boos",e:"🚌"},
    {w:"Avião",t:"Airplane",p:"ah-vee-OWN",e:"🛩"}, {w:"Bicicleta",t:"Bicycle",p:"bee-see-KLEH-tah",e:"🚲"},
    {w:"Passagem",t:"Ticket",p:"pah-SAH-zhem",e:"🎫"}, {w:"Novo",t:"New",p:"NOH-voo",e:"✨"},
    {w:"Velho",t:"Old",p:"VEH-lyoo",e:"🏚"}, {w:"Jovem",t:"Young",p:"ZHOH-vem",e:"🧒"},
    {w:"Bonito",t:"Pretty",p:"boh-NEE-too",e:"😍"}, {w:"Feio",t:"Ugly",p:"FAY-oo",e:"🫣"},
    {w:"Quente",t:"Hot",p:"KEN-chee",e:"🔥"}, {w:"Frio",t:"Cold",p:"FREE-oo",e:"🧊"},
    {w:"Alto",t:"Tall/high",p:"AHL-too",e:"📏"}, {w:"Baixo",t:"Short/low",p:"BY-shoo",e:"📉"},
    {w:"Longo",t:"Long",p:"LON-goo",e:"📏"}, {w:"Curto",t:"Short (length)",p:"KOOR-too",e:"✂️"},
    {w:"Forte",t:"Strong",p:"FOR-chee",e:"💪"}, {w:"Fraco",t:"Weak",p:"FRAH-koo",e:"🪶"},
    {w:"Fácil",t:"Easy",p:"FAH-seel",e:"🟢"}, {w:"Difícil",t:"Difficult",p:"jee-FEE-seel",e:"🔴"},
    {w:"Importante",t:"Important",p:"eem-por-TAHN-chee",e:"⭐"}, {w:"Certo",t:"Right/correct",p:"SEHR-too",e:"✅"},
    {w:"Errado",t:"Wrong",p:"eh-HAH-doo",e:"❌"}, {w:"Verdadeiro",t:"True",p:"ver-dah-DAY-roo",e:"✔️"},
    {w:"Falso",t:"False",p:"FAHL-soo",e:"✖️"}, {w:"Cheio",t:"Full",p:"SHAY-oo",e:"🈵"},
    {w:"Vazio",t:"Empty",p:"vah-ZEE-oo",e:"🈳"}, {w:"Aberto",t:"Open",p:"ah-BEHR-too",e:"🔓"},
    {w:"Fechado",t:"Closed",p:"feh-SHAH-doo",e:"🔒"}, {w:"Limpo",t:"Clean",p:"LEEM-poo",e:"🧼"},
    {w:"Sujo",t:"Dirty",p:"SOO-zhoo",e:"🧹"}, {w:"Rico",t:"Rich",p:"HEE-koo",e:"💎"},
    {w:"Pobre",t:"Poor",p:"POH-bree",e:"🪙"}, {w:"Livre",t:"Free",p:"LEE-vree",e:"🕊"},
    {w:"Ocupado",t:"Busy",p:"oh-koo-PAH-doo",e:"📵"}, {w:"Pronto",t:"Ready",p:"PRON-too",e:"🚦"},
    {w:"Seguro",t:"Safe/sure",p:"seh-GOO-roo",e:"🛡"}, {w:"Mesmo",t:"Same",p:"MEHS-moo",e:"🟰"},
    {w:"Diferente",t:"Different",p:"jee-feh-REN-chee",e:"🔀"}, {w:"Caro",t:"Expensive",p:"KAH-roo",e:"💸"},
    {w:"Barato",t:"Cheap",p:"bah-RAH-too",e:"🏷"}, {w:"Saudável",t:"Healthy",p:"sow-DAH-vel",e:"🥦"},
    {w:"Doente",t:"Sick",p:"doh-EN-chee",e:"🤒"}, {w:"Sol",t:"Sun",p:"sohl",e:"☀️"},
    {w:"Lua",t:"Moon",p:"LOO-ah",e:"🌙"}, {w:"Estrela",t:"Star",p:"es-TREH-lah",e:"⭐"},
    {w:"Céu",t:"Sky",p:"seh-oo",e:"🌤"}, {w:"Mar",t:"Sea",p:"mar",e:"🌊"},
    {w:"Montanha",t:"Mountain",p:"mon-TAH-nyah",e:"⛰"}, {w:"Rio",t:"River",p:"HEE-oo",e:"🏞"},
    {w:"Árvore",t:"Tree",p:"AR-voh-ree",e:"🌳"}, {w:"Flor",t:"Flower",p:"flor",e:"🌸"},
    {w:"Chuva",t:"Rain",p:"SHOO-vah",e:"🌧"}, {w:"Neve",t:"Snow",p:"NEH-vee",e:"❄️"},
    {w:"Vento",t:"Wind",p:"VEN-too",e:"💨"}, {w:"Fogo",t:"Fire",p:"FOH-goo",e:"🔥"},
    {w:"Terra",t:"Earth",p:"TEH-hah",e:"🌍"}, {w:"Ar",t:"Air",p:"ar",e:"🌬"},
    {w:"Coisa",t:"Thing",p:"KOY-zah",e:"📦"}, {w:"Vida",t:"Life",p:"VEE-dah",e:"🌱"},
    {w:"Mundo",t:"World",p:"MOON-doo",e:"🌎"}, {w:"País",t:"Country",p:"pah-EES",e:"🗺"},
    {w:"Lugar",t:"Place",p:"loo-GAR",e:"📍"}, {w:"Parte",t:"Part",p:"PAR-chee",e:"🧩"},
    {w:"Vez",t:"Time (occasion)",p:"vehs",e:"🔁"}, {w:"Nome",t:"Name",p:"NOH-mee",e:"🏷"},
    {w:"Palavra",t:"Word",p:"pah-LAH-vrah",e:"🔤"}, {w:"Pergunta",t:"Question",p:"per-GOON-tah",e:"❓"},
    {w:"Resposta",t:"Answer",p:"hes-POS-tah",e:"💬"}, {w:"Problema",t:"Problem",p:"proh-BLEH-mah",e:"⚠️"},
    {w:"Ideia",t:"Idea",p:"ee-DEH-yah",e:"💡"}, {w:"História",t:"Story/history",p:"ees-TAW-ree-ah",e:"📜"},
    {w:"Música",t:"Music",p:"MOO-zee-kah",e:"🎵"}, {w:"Filme",t:"Movie",p:"FEEL-mee",e:"🎬"},
    {w:"Foto",t:"Photo",p:"FOH-too",e:"📷"}, {w:"Telefone",t:"Telephone",p:"teh-leh-FOH-nee",e:"📱"},
    {w:"Jogo",t:"Game",p:"ZHOH-goo",e:"🎲"}, {w:"Esporte",t:"Sport",p:"es-POR-chee",e:"⚽"},
    {w:"Futebol",t:"Football",p:"foo-chee-BOHL",e:"⚽"}, {w:"Bom dia",t:"Good morning",p:"bom JEE-ah",e:"🌅"},
    {w:"Boa tarde",t:"Good afternoon",p:"BOH-ah TAR-jee",e:"🌆"}, {w:"Boa noite",t:"Good night",p:"BOH-ah NOY-chee",e:"🌙"},
    {w:"Tchau",t:"Bye",p:"chow",e:"👋"}, {w:"Até logo",t:"See you later",p:"ah-TEH LOH-goo",e:"👋"},
    {w:"Desculpa",t:"Sorry",p:"des-KOOL-pah",e:"🙇"}, {w:"De nada",t:"You're welcome",p:"jee NAH-dah",e:"🤲"},
    {w:"Tudo bem",t:"All good/okay",p:"TOO-doo bem",e:"👌"}, {w:"Não sei",t:"I don't know",p:"nown say",e:"🤷"},
    {w:"Não entendo",t:"I don't understand",p:"nown en-TEN-doo",e:"😕"}, {w:"Quanto custa?",t:"How much is it?",p:"KWAN-too KOOS-tah",e:"💶"},
    {w:"Onde fica?",t:"Where is it?",p:"ON-jee FEE-kah",e:"🧭"}, {w:"Que horas são?",t:"What time is it?",p:"keh OH-rahs sown",e:"🕐"},
    {w:"Meu nome é",t:"My name is",p:"meh-oo NOH-mee eh",e:"🪪"}, {w:"Prazer",t:"Nice to meet you",p:"prah-ZEHR",e:"🤝"},
    {w:"Socorro!",t:"Help!",p:"soh-KOH-hoo",e:"🆘"}, {w:"Saúde!",t:"Cheers/bless you",p:"sah-OO-jee",e:"🥂"},
    {w:"Parabéns",t:"Congratulations",p:"pah-rah-BENS",e:"🎉"}, {w:"Bem-vindo",t:"Welcome",p:"bem VEEN-doo",e:"🎊"},
    {w:"Vamos!",t:"Let's go!",p:"VAH-moos",e:"🚀"}
  ],
  ar: [
    {w:"مرحبا",      t:"Hello",       p:"mar-HA-ban",     e:"🙋"}, {w:"شكراً",      t:"Thank you",   p:"SHUK-ran",       e:"🙏"},
    {w:"من فضلك",    t:"Please",      p:"min FAD-lak",    e:"✋"}, {w:"نعم",        t:"Yes",         p:"na-AM",          e:"✅"},
    {w:"لا",         t:"No",          p:"lah",            e:"❌"}, {w:"ماء",        t:"Water",       p:"mah",            e:"💧"},
    {w:"طعام",       t:"Food",        p:"ta-AM",          e:"🍽"}, {w:"بيت",        t:"House",       p:"bayt",           e:"🏠"},
    {w:"صديق",       t:"Friend",      p:"sa-DEEK",        e:"👫"}, {w:"حب",         t:"Love",        p:"hub",            e:"❤️"},
    {w:"عمل",        t:"Work",        p:"AH-mal",         e:"💼"}, {w:"مال",        t:"Money",       p:"maal",           e:"💰"},
    {w:"وقت",        t:"Time",        p:"waqt",           e:"⏰"}, {w:"جيد",        t:"Good",        p:"jay-YED",        e:"👍"},
    {w:"سيء",        t:"Bad",         p:"say-YE",         e:"👎"}, {w:"كبير",       t:"Big",         p:"ka-BEER",        e:"🐘"},
    {w:"صغير",       t:"Small",       p:"sa-GHEER",       e:"🐭"}, {w:"سريع",       t:"Fast",        p:"sa-REE",         e:"🏃"},
    {w:"بطيء",       t:"Slow",        p:"ba-TEE",         e:"🐢"}, {w:"سعيد",       t:"Happy",       p:"sa-EED",         e:"😊"},
    {w:"حزين",       t:"Sad",         p:"ha-ZEEN",        e:"😢"}, {w:"متعب",       t:"Tired",       p:"mut-AB",         e:"😴"},
    {w:"جائع",       t:"Hungry",      p:"JAH-e",          e:"🤤"}, {w:"عطشان",      t:"Thirsty",     p:"at-SHAN",        e:"😮"},
    {w:"عائلة",      t:"Family",      p:"AH-ee-lah",      e:"👨‍👩‍👧"}, {w:"أم",         t:"Mother",      p:"um",             e:"👩"},
    {w:"أب",         t:"Father",      p:"ab",             e:"👨"}, {w:"كتاب",       t:"Book",        p:"ki-TAB",         e:"📚"},
    {w:"مدينة",      t:"City",        p:"ma-DEE-nah",     e:"🏙"}, {w:"شاطئ",       t:"Beach",       p:"SHA-ti",         e:"🏖"},
    {w:"كان",t:"To be",p:"kaana",e:"🧍"}, {w:"أراد",t:"To want",p:"araada",e:"🙌"},
    {w:"استطاع",t:"To be able",p:"istataa'a",e:"💪"}, {w:"قال",t:"To say",p:"qaala",e:"🗣"},
    {w:"تكلم",t:"To speak",p:"takallama",e:"💬"}, {w:"عرف",t:"To know",p:"'arafa",e:"🧠"},
    {w:"فعل",t:"To do",p:"fa'ala",e:"🔨"}, {w:"رأى",t:"To see",p:"ra'aa",e:"👀"},
    {w:"ذهب",t:"To go",p:"dhahaba",e:"🚶"}, {w:"جاء",t:"To come",p:"jaa'a",e:"👋"},
    {w:"أعطى",t:"To give",p:"a'taa",e:"🎁"}, {w:"فكر",t:"To think",p:"fakkara",e:"💭"},
    {w:"اشتغل",t:"To work",p:"ishtaghala",e:"💼"}, {w:"عاش",t:"To live",p:"'aasha",e:"🌱"},
    {w:"أحب",t:"To love",p:"ahabba",e:"❤️"}, {w:"فهم",t:"To understand",p:"fahima",e:"💡"},
    {w:"وجد",t:"To find",p:"wajada",e:"🔍"}, {w:"أخذ",t:"To take",p:"akhadha",e:"✊"},
    {w:"نظر",t:"To look",p:"nazhara",e:"👁"}, {w:"وضع",t:"To put",p:"wada'a",e:"📥"},
    {w:"صدق",t:"To believe",p:"saddaqa",e:"🙏"}, {w:"أحضر",t:"To bring",p:"ahdara",e:"🎒"},
    {w:"رجع",t:"To return",p:"raja'a",e:"🔙"}, {w:"تذكر",t:"To remember",p:"tadhakkara",e:"🧾"},
    {w:"اتصل",t:"To call",p:"ittasala",e:"📞"}, {w:"انتظر",t:"To wait",p:"intazhara",e:"⏳"},
    {w:"أنهى",t:"To finish",p:"anhaa",e:"🏁"}, {w:"أكل",t:"To eat",p:"akala",e:"🍽"},
    {w:"شرب",t:"To drink",p:"shariba",e:"🥤"}, {w:"نام",t:"To sleep",p:"naama",e:"😴"},
    {w:"فتح",t:"To open",p:"fataha",e:"🔓"}, {w:"أغلق",t:"To close",p:"aghlaqa",e:"🔒"},
    {w:"اشترى",t:"To buy",p:"ishtaraa",e:"🛒"}, {w:"دفع",t:"To pay",p:"dafa'a",e:"💳"},
    {w:"قرأ",t:"To read",p:"qara'a",e:"📖"}, {w:"كتب",t:"To write",p:"kataba",e:"✍️"},
    {w:"سمع",t:"To hear/listen",p:"sami'a",e:"🎧"}, {w:"لعب",t:"To play",p:"la'iba",e:"🎮"},
    {w:"ركض",t:"To run",p:"rakada",e:"🏃"}, {w:"مشى",t:"To walk",p:"mashaa",e:"🚶"},
    {w:"ساعد",t:"To help",p:"saa'ada",e:"🆘"}, {w:"درس",t:"To study",p:"darasa",e:"📚"},
    {w:"تعلم",t:"To learn",p:"ta'allama",e:"🎓"}, {w:"علّم",t:"To teach",p:"'allama",e:"👩‍🏫"},
    {w:"بدأ",t:"To begin",p:"bada'a",e:"▶️"}, {w:"بحث",t:"To search",p:"bahatha",e:"🔎"},
    {w:"استخدم",t:"To use",p:"istakhdama",e:"🛠"}, {w:"سأل",t:"To ask",p:"sa'ala",e:"❓"},
    {w:"أجاب",t:"To answer",p:"ajaaba",e:"💬"}, {w:"خرج",t:"To go out",p:"kharaja",e:"🚪"},
    {w:"دخل",t:"To enter",p:"dakhala",e:"➡️"}, {w:"خسر",t:"To lose",p:"khasira",e:"🫥"},
    {w:"ربح",t:"To win",p:"rabiha",e:"🏆"}, {w:"حاول",t:"To try",p:"haawala",e:"🎯"},
    {w:"غيّر",t:"To change",p:"ghayyara",e:"🔄"}, {w:"أحس",t:"To feel",p:"ahassa",e:"💗"},
    {w:"جلس",t:"To sit",p:"jalasa",e:"🪑"}, {w:"وقف",t:"To stand",p:"waqafa",e:"🧍"},
    {w:"أنا",t:"I",p:"ana",e:"🙋"}, {w:"أنتَ",t:"You",p:"anta",e:"👉"},
    {w:"هو",t:"He",p:"huwa",e:"👨"}, {w:"هي",t:"She",p:"hiya",e:"👩"},
    {w:"نحن",t:"We",p:"nahnu",e:"👥"}, {w:"أنتم",t:"You (plural)",p:"antum",e:"👫"},
    {w:"هم",t:"They",p:"hum",e:"👪"}, {w:"هذا",t:"This",p:"haadhaa",e:"👇"},
    {w:"ذلك",t:"That",p:"dhaalika",e:"👉"}, {w:"كل",t:"All/every",p:"kull",e:"🌐"},
    {w:"لا شيء",t:"Nothing",p:"laa shay'",e:"🚫"}, {w:"شيء",t:"Thing/something",p:"shay'",e:"📦"},
    {w:"أحد",t:"Someone",p:"ahad",e:"👤"}, {w:"لا أحد",t:"Nobody",p:"laa ahad",e:"🙅"},
    {w:"كثير",t:"A lot",p:"kathiir",e:"📈"}, {w:"قليل",t:"Little/few",p:"qaliil",e:"🤏"},
    {w:"جداً",t:"Very",p:"jiddan",e:"📈"}, {w:"أكثر",t:"More",p:"akthar",e:"➕"},
    {w:"أقل",t:"Less",p:"aqall",e:"➖"}, {w:"أيضاً",t:"Also",p:"aydan",e:"➕"},
    {w:"دائماً",t:"Always",p:"daa'iman",e:"♾️"}, {w:"أبداً",t:"Never",p:"abadan",e:"🚫"},
    {w:"الآن",t:"Now",p:"al-aan",e:"⏱"}, {w:"بعد",t:"After",p:"ba'd",e:"⏭"},
    {w:"قبل",t:"Before",p:"qabl",e:"⏮"}, {w:"هنا",t:"Here",p:"hunaa",e:"📍"},
    {w:"هناك",t:"There",p:"hunaak",e:"🗺"}, {w:"أين",t:"Where",p:"ayna",e:"🧭"},
    {w:"متى",t:"When",p:"mataa",e:"📅"}, {w:"لماذا",t:"Why",p:"limaadhaa",e:"❓"},
    {w:"كيف",t:"How",p:"kayfa",e:"🤔"}, {w:"من",t:"Who",p:"man",e:"👤"},
    {w:"ماذا",t:"What",p:"maadhaa",e:"❔"}, {w:"أي",t:"Which",p:"ayy",e:"🔀"},
    {w:"كم",t:"How much",p:"kam",e:"⚖️"}, {w:"واحد",t:"One",p:"waahid",e:"1️⃣"},
    {w:"اثنان",t:"Two",p:"ithnaan",e:"2️⃣"}, {w:"ثلاثة",t:"Three",p:"thalaatha",e:"3️⃣"},
    {w:"أربعة",t:"Four",p:"arba'a",e:"4️⃣"}, {w:"خمسة",t:"Five",p:"khamsa",e:"5️⃣"},
    {w:"ستة",t:"Six",p:"sitta",e:"6️⃣"}, {w:"سبعة",t:"Seven",p:"sab'a",e:"7️⃣"},
    {w:"ثمانية",t:"Eight",p:"thamaaniya",e:"8️⃣"}, {w:"تسعة",t:"Nine",p:"tis'a",e:"9️⃣"},
    {w:"عشرة",t:"Ten",p:"'ashara",e:"🔟"}, {w:"أحد عشر",t:"Eleven",p:"ahada 'ashar",e:"🔢"},
    {w:"اثنا عشر",t:"Twelve",p:"ithnaa 'ashar",e:"🔢"}, {w:"عشرون",t:"Twenty",p:"'ishruun",e:"🔢"},
    {w:"ثلاثون",t:"Thirty",p:"thalaathuun",e:"🔢"}, {w:"أربعون",t:"Forty",p:"arba'uun",e:"🔢"},
    {w:"خمسون",t:"Fifty",p:"khamsuun",e:"🔢"}, {w:"مئة",t:"Hundred",p:"mi'a",e:"💯"},
    {w:"ألف",t:"Thousand",p:"alf",e:"🔢"}, {w:"أول",t:"First",p:"awwal",e:"🥇"},
    {w:"ثاني",t:"Second",p:"thaani",e:"🥈"}, {w:"أخير",t:"Last",p:"akhiir",e:"🔚"},
    {w:"الاثنين",t:"Monday",p:"al-ithnayn",e:"📅"}, {w:"الثلاثاء",t:"Tuesday",p:"ath-thulaathaa'",e:"📅"},
    {w:"الأربعاء",t:"Wednesday",p:"al-arbi'aa'",e:"📅"}, {w:"الخميس",t:"Thursday",p:"al-khamiis",e:"📅"},
    {w:"الجمعة",t:"Friday",p:"al-jum'a",e:"📅"}, {w:"السبت",t:"Saturday",p:"as-sabt",e:"📅"},
    {w:"الأحد",t:"Sunday",p:"al-ahad",e:"📅"}, {w:"اليوم",t:"Today",p:"al-yawm",e:"📆"},
    {w:"غداً",t:"Tomorrow",p:"ghadan",e:"🌅"}, {w:"أمس",t:"Yesterday",p:"ams",e:"🌇"},
    {w:"أسبوع",t:"Week",p:"usbuu'",e:"🗓"}, {w:"شهر",t:"Month",p:"shahr",e:"🗓"},
    {w:"سنة",t:"Year",p:"sana",e:"🎆"}, {w:"يوم",t:"Day",p:"yawm",e:"☀️"},
    {w:"ليلة",t:"Night",p:"layla",e:"🌙"}, {w:"صباح",t:"Morning",p:"sabaah",e:"🌄"},
    {w:"مساء",t:"Evening",p:"masaa'",e:"🌆"}, {w:"ساعة",t:"Hour/watch",p:"saa'a",e:"🕐"},
    {w:"دقيقة",t:"Minute",p:"daqiiqa",e:"⏱"}, {w:"يناير",t:"January",p:"yanaayir",e:"❄️"},
    {w:"فبراير",t:"February",p:"fibraayir",e:"💘"}, {w:"مارس",t:"March",p:"maaris",e:"🌸"},
    {w:"أبريل",t:"April",p:"abriil",e:"🌷"}, {w:"مايو",t:"May",p:"maayuu",e:"🌼"},
    {w:"يونيو",t:"June",p:"yuunyuu",e:"☀️"}, {w:"يوليو",t:"July",p:"yuulyuu",e:"🏖"},
    {w:"أغسطس",t:"August",p:"aghustus",e:"🌞"}, {w:"سبتمبر",t:"September",p:"sibtambir",e:"🍂"},
    {w:"أكتوبر",t:"October",p:"uktuubir",e:"🎃"}, {w:"نوفمبر",t:"November",p:"nuufambir",e:"🌧"},
    {w:"ديسمبر",t:"December",p:"diisambir",e:"🎄"}, {w:"أحمر",t:"Red",p:"ahmar",e:"🔴"},
    {w:"أزرق",t:"Blue",p:"azraq",e:"🔵"}, {w:"أخضر",t:"Green",p:"akhdar",e:"🟢"},
    {w:"أصفر",t:"Yellow",p:"asfar",e:"🟡"}, {w:"أسود",t:"Black",p:"aswad",e:"⚫"},
    {w:"أبيض",t:"White",p:"abyad",e:"⚪"}, {w:"رمادي",t:"Grey",p:"ramaadii",e:"🩶"},
    {w:"بني",t:"Brown",p:"bunnii",e:"🟤"}, {w:"وردي",t:"Pink",p:"wardii",e:"🌸"},
    {w:"برتقالي",t:"Orange",p:"burtuqaalii",e:"🟠"}, {w:"بنفسجي",t:"Purple",p:"banafsajii",e:"🟣"},
    {w:"ابن",t:"Son",p:"ibn",e:"👦"}, {w:"ابنة",t:"Daughter",p:"ibna",e:"👧"},
    {w:"أخ",t:"Brother",p:"akh",e:"👬"}, {w:"أخت",t:"Sister",p:"ukht",e:"👭"},
    {w:"جد",t:"Grandfather",p:"jadd",e:"👴"}, {w:"جدة",t:"Grandmother",p:"jadda",e:"👵"},
    {w:"عم",t:"Uncle",p:"'amm",e:"👨"}, {w:"عمة",t:"Aunt",p:"'amma",e:"👩"},
    {w:"زوج",t:"Husband",p:"zawj",e:"🤵"}, {w:"زوجة",t:"Wife",p:"zawja",e:"👰"},
    {w:"طفل",t:"Child",p:"tifl",e:"👶"}, {w:"ولد",t:"Boy",p:"walad",e:"🧑"},
    {w:"بنت",t:"Girl",p:"bint",e:"👧"}, {w:"رجل",t:"Man",p:"rajul",e:"👨"},
    {w:"امرأة",t:"Woman",p:"imra'a",e:"👩"}, {w:"ناس",t:"People",p:"naas",e:"👥"},
    {w:"شخص",t:"Person",p:"shakhs",e:"👤"}, {w:"رأس",t:"Head",p:"ra's",e:"🗣"},
    {w:"عين",t:"Eye",p:"'ayn",e:"👁"}, {w:"يد",t:"Hand",p:"yad",e:"✋"},
    {w:"قدم",t:"Foot",p:"qadam",e:"🦶"}, {w:"قلب",t:"Heart",p:"qalb",e:"❤️"},
    {w:"فم",t:"Mouth",p:"fam",e:"👄"}, {w:"أنف",t:"Nose",p:"anf",e:"👃"},
    {w:"أذن",t:"Ear",p:"udhun",e:"👂"}, {w:"ذراع",t:"Arm",p:"dhiraa'",e:"💪"},
    {w:"ساق",t:"Leg",p:"saaq",e:"🦵"}, {w:"شعر",t:"Hair",p:"sha'r",e:"💇"},
    {w:"وجه",t:"Face",p:"wajh",e:"🙂"}, {w:"خبز",t:"Bread",p:"khubz",e:"🍞"},
    {w:"حليب",t:"Milk",p:"haliib",e:"🥛"}, {w:"قهوة",t:"Coffee",p:"qahwa",e:"☕"},
    {w:"شاي",t:"Tea",p:"shaay",e:"🍵"}, {w:"عصير",t:"Juice",p:"'asiir",e:"🧃"},
    {w:"لحم",t:"Meat",p:"lahm",e:"🥩"}, {w:"سمك",t:"Fish",p:"samak",e:"🐟"},
    {w:"دجاج",t:"Chicken",p:"dajaaj",e:"🍗"}, {w:"أرز",t:"Rice",p:"aruzz",e:"🍚"},
    {w:"معكرونة",t:"Pasta",p:"ma'karuuna",e:"🍝"}, {w:"جبن",t:"Cheese",p:"jubn",e:"🧀"},
    {w:"بيضة",t:"Egg",p:"bayda",e:"🥚"}, {w:"فاكهة",t:"Fruit",p:"faakiha",e:"🍎"},
    {w:"تفاحة",t:"Apple",p:"tuffaaha",e:"🍏"}, {w:"موز",t:"Banana",p:"mawz",e:"🍌"},
    {w:"خضار",t:"Vegetables",p:"khudaar",e:"🥦"}, {w:"طماطم",t:"Tomato",p:"tamaatim",e:"🍅"},
    {w:"بطاطس",t:"Potato",p:"bataatis",e:"🥔"}, {w:"سلطة",t:"Salad",p:"salata",e:"🥗"},
    {w:"سكر",t:"Sugar",p:"sukkar",e:"🍬"}, {w:"ملح",t:"Salt",p:"milh",e:"🧂"},
    {w:"زيت",t:"Oil",p:"zayt",e:"🫒"}, {w:"زبدة",t:"Butter",p:"zubda",e:"🧈"},
    {w:"كعكة",t:"Cake",p:"ka'ka",e:"🍰"}, {w:"مثلجات",t:"Ice cream",p:"muthallajaat",e:"🍨"},
    {w:"شوربة",t:"Soup",p:"shorba",e:"🍲"}, {w:"فطور",t:"Breakfast",p:"futuur",e:"🥐"},
    {w:"غداء",t:"Lunch",p:"ghadaa'",e:"🍽"}, {w:"عشاء",t:"Dinner",p:"'ashaa'",e:"🌙"},
    {w:"مطعم",t:"Restaurant",p:"mat'am",e:"🍴"}, {w:"طاولة",t:"Table",p:"taawila",e:"🪑"},
    {w:"باب",t:"Door",p:"baab",e:"🚪"}, {w:"نافذة",t:"Window",p:"naafidha",e:"🪟"},
    {w:"غرفة",t:"Room",p:"ghurfa",e:"🛏"}, {w:"مطبخ",t:"Kitchen",p:"matbakh",e:"🍳"},
    {w:"حمام",t:"Bathroom",p:"hammaam",e:"🛁"}, {w:"سرير",t:"Bed",p:"sariir",e:"🛌"},
    {w:"كرسي",t:"Chair",p:"kursii",e:"🪑"}, {w:"مفتاح",t:"Key",p:"miftaah",e:"🔑"},
    {w:"ضوء",t:"Light",p:"daw'",e:"💡"}, {w:"شارع",t:"Street",p:"shaari'",e:"🛣"},
    {w:"متجر",t:"Shop",p:"matjar",e:"🏪"}, {w:"سوق",t:"Market",p:"suuq",e:"🛍"},
    {w:"مدرسة",t:"School",p:"madrasa",e:"🏫"}, {w:"مستشفى",t:"Hospital",p:"mustashfaa",e:"🏥"},
    {w:"مسجد",t:"Mosque",p:"masjid",e:"🕌"}, {w:"بنك",t:"Bank",p:"bank",e:"🏦"},
    {w:"مكتب",t:"Office/desk",p:"maktab",e:"🏢"}, {w:"محطة",t:"Station",p:"mahatta",e:"🚉"},
    {w:"مطار",t:"Airport",p:"mataar",e:"✈️"}, {w:"فندق",t:"Hotel",p:"funduq",e:"🏨"},
    {w:"سيارة",t:"Car",p:"sayyaara",e:"🚗"}, {w:"قطار",t:"Train",p:"qitaar",e:"🚆"},
    {w:"حافلة",t:"Bus",p:"haafila",e:"🚌"}, {w:"طائرة",t:"Airplane",p:"taa'ira",e:"🛩"},
    {w:"دراجة",t:"Bicycle",p:"darraaja",e:"🚲"}, {w:"تذكرة",t:"Ticket",p:"tadhkara",e:"🎫"},
    {w:"جديد",t:"New",p:"jadiid",e:"✨"}, {w:"قديم",t:"Old",p:"qadiim",e:"🏚"},
    {w:"شاب",t:"Young",p:"shaabb",e:"🧒"}, {w:"جميل",t:"Beautiful",p:"jamiil",e:"😍"},
    {w:"قبيح",t:"Ugly",p:"qabiih",e:"🫣"}, {w:"حار",t:"Hot",p:"haarr",e:"🔥"},
    {w:"بارد",t:"Cold",p:"baarid",e:"🧊"}, {w:"طويل",t:"Tall/long",p:"tawiil",e:"📏"},
    {w:"قصير",t:"Short",p:"qasiir",e:"✂️"}, {w:"قوي",t:"Strong",p:"qawiyy",e:"💪"},
    {w:"ضعيف",t:"Weak",p:"da'iif",e:"🪶"}, {w:"سهل",t:"Easy",p:"sahl",e:"🟢"},
    {w:"صعب",t:"Difficult",p:"sa'b",e:"🔴"}, {w:"مهم",t:"Important",p:"muhimm",e:"⭐"},
    {w:"صحيح",t:"Correct",p:"sahiih",e:"✅"}, {w:"خاطئ",t:"Wrong",p:"khaati'",e:"❌"},
    {w:"حقيقي",t:"True/real",p:"haqiiqii",e:"✔️"}, {w:"ممتلئ",t:"Full",p:"mumtali'",e:"🈵"},
    {w:"فارغ",t:"Empty",p:"faarigh",e:"🈳"}, {w:"مفتوح",t:"Open",p:"maftuuh",e:"🔓"},
    {w:"مغلق",t:"Closed",p:"mughlaq",e:"🔒"}, {w:"نظيف",t:"Clean",p:"nazhiif",e:"🧼"},
    {w:"وسخ",t:"Dirty",p:"wasikh",e:"🧹"}, {w:"غني",t:"Rich",p:"ghanii",e:"💎"},
    {w:"فقير",t:"Poor",p:"faqiir",e:"🪙"}, {w:"حر",t:"Free",p:"hurr",e:"🕊"},
    {w:"مشغول",t:"Busy",p:"mashghuul",e:"📵"}, {w:"جاهز",t:"Ready",p:"jaahiz",e:"🚦"},
    {w:"آمن",t:"Safe",p:"aamin",e:"🛡"}, {w:"متشابه",t:"Similar/same",p:"mutashaabih",e:"🟰"},
    {w:"مختلف",t:"Different",p:"mukhtalif",e:"🔀"}, {w:"غالي",t:"Expensive",p:"ghaalii",e:"💸"},
    {w:"رخيص",t:"Cheap",p:"rakhiis",e:"🏷"}, {w:"صحي",t:"Healthy",p:"sihhii",e:"🥦"},
    {w:"مريض",t:"Sick",p:"mariid",e:"🤒"}, {w:"شمس",t:"Sun",p:"shams",e:"☀️"},
    {w:"قمر",t:"Moon",p:"qamar",e:"🌙"}, {w:"نجمة",t:"Star",p:"najma",e:"⭐"},
    {w:"سماء",t:"Sky",p:"samaa'",e:"🌤"}, {w:"بحر",t:"Sea",p:"bahr",e:"🌊"},
    {w:"جبل",t:"Mountain",p:"jabal",e:"⛰"}, {w:"نهر",t:"River",p:"nahr",e:"🏞"},
    {w:"شجرة",t:"Tree",p:"shajara",e:"🌳"}, {w:"زهرة",t:"Flower",p:"zahra",e:"🌸"},
    {w:"مطر",t:"Rain",p:"matar",e:"🌧"}, {w:"ثلج",t:"Snow",p:"thalj",e:"❄️"},
    {w:"ريح",t:"Wind",p:"riih",e:"💨"}, {w:"نار",t:"Fire",p:"naar",e:"🔥"},
    {w:"أرض",t:"Earth/land",p:"ard",e:"🌍"}, {w:"هواء",t:"Air",p:"hawaa'",e:"🌬"},
    {w:"حياة",t:"Life",p:"hayaa",e:"🌱"}, {w:"عالم",t:"World",p:"'aalam",e:"🌎"},
    {w:"بلد",t:"Country",p:"balad",e:"🗺"}, {w:"مكان",t:"Place",p:"makaan",e:"📍"},
    {w:"جزء",t:"Part",p:"juz'",e:"🧩"}, {w:"مرة",t:"Time (occasion)",p:"marra",e:"🔁"},
    {w:"اسم",t:"Name",p:"ism",e:"🏷"}, {w:"كلمة",t:"Word",p:"kalima",e:"🔤"},
    {w:"سؤال",t:"Question",p:"su'aal",e:"❓"}, {w:"جواب",t:"Answer",p:"jawaab",e:"💬"},
    {w:"مشكلة",t:"Problem",p:"mushkila",e:"⚠️"}, {w:"فكرة",t:"Idea",p:"fikra",e:"💡"},
    {w:"قصة",t:"Story",p:"qissa",e:"📜"}, {w:"موسيقى",t:"Music",p:"muusiiqaa",e:"🎵"},
    {w:"فيلم",t:"Movie",p:"film",e:"🎬"}, {w:"صورة",t:"Photo/picture",p:"suura",e:"📷"},
    {w:"هاتف",t:"Telephone",p:"haatif",e:"📱"}, {w:"لعبة",t:"Game",p:"lu'ba",e:"🎲"},
    {w:"رياضة",t:"Sport",p:"riyaada",e:"⚽"}, {w:"كرة القدم",t:"Football",p:"kurat al-qadam",e:"⚽"},
    {w:"صباح الخير",t:"Good morning",p:"sabaah al-khayr",e:"🌅"}, {w:"مساء الخير",t:"Good evening",p:"masaa' al-khayr",e:"🌆"},
    {w:"تصبح على خير",t:"Good night",p:"tusbih 'alaa khayr",e:"🌙"}, {w:"مع السلامة",t:"Goodbye",p:"ma'a as-salaama",e:"👋"},
    {w:"إلى اللقاء",t:"See you later",p:"ilaa al-liqaa'",e:"👋"}, {w:"آسف",t:"Sorry",p:"aasif",e:"🙇"},
    {w:"عفواً",t:"You're welcome",p:"'afwan",e:"🤲"}, {w:"حسناً",t:"Okay",p:"hasanan",e:"👌"},
    {w:"لا أعرف",t:"I don't know",p:"laa a'rif",e:"🤷"}, {w:"لا أفهم",t:"I don't understand",p:"laa afham",e:"😕"},
    {w:"بكم هذا؟",t:"How much is this?",p:"bikam haadhaa",e:"💶"}, {w:"كم الساعة؟",t:"What time is it?",p:"kam as-saa'a",e:"🕐"},
    {w:"اسمي",t:"My name is",p:"ismii",e:"🪪"}, {w:"تشرفنا",t:"Nice to meet you",p:"tasharrafnaa",e:"🤝"},
    {w:"النجدة!",t:"Help!",p:"an-najda",e:"🆘"}, {w:"في صحتك",t:"Cheers",p:"fii sihhatik",e:"🥂"},
    {w:"مبروك",t:"Congratulations",p:"mabruuk",e:"🎉"}, {w:"أهلاً وسهلاً",t:"Welcome",p:"ahlan wa sahlan",e:"🎊"},
    {w:"هيا بنا",t:"Let's go",p:"hayyaa binaa",e:"🚀"}, {w:"إن شاء الله",t:"God willing",p:"in shaa' allah",e:"🤲"}
  ],
  ja: [
    {w:"こんにちは",  t:"Hello",       p:"kon-ni-CHI-wa",  e:"🙋"}, {w:"ありがとう",  t:"Thank you",   p:"a-ri-GA-to",     e:"🙏"},
    {w:"おねがい",   t:"Please",      p:"o-ne-GAI",       e:"✋"}, {w:"はい",       t:"Yes",         p:"hai",            e:"✅"},
    {w:"いいえ",     t:"No",          p:"i-i-e",          e:"❌"}, {w:"みず",       t:"Water",       p:"mi-zu",          e:"💧"},
    {w:"たべもの",   t:"Food",        p:"ta-be-MO-no",    e:"🍽"}, {w:"いえ",       t:"House",       p:"i-e",            e:"🏠"},
    {w:"ともだち",   t:"Friend",      p:"to-mo-DA-chi",   e:"👫"}, {w:"あい",       t:"Love",        p:"ai",             e:"❤️"},
    {w:"しごと",     t:"Work",        p:"shi-GO-to",      e:"💼"}, {w:"おかね",     t:"Money",       p:"o-KA-ne",        e:"💰"},
    {w:"じかん",     t:"Time",        p:"ji-KAN",         e:"⏰"}, {w:"いい",       t:"Good",        p:"i-i",            e:"👍"},
    {w:"わるい",     t:"Bad",         p:"wa-RU-i",        e:"👎"}, {w:"おおきい",   t:"Big",         p:"o-o-KI-i",       e:"🐘"},
    {w:"ちいさい",   t:"Small",       p:"chi-i-SA-i",     e:"🐭"}, {w:"はやい",     t:"Fast",        p:"ha-YA-i",        e:"🏃"},
    {w:"おそい",     t:"Slow",        p:"o-SO-i",         e:"🐢"}, {w:"うれしい",   t:"Happy",       p:"u-re-SHI-i",     e:"😊"},
    {w:"かなしい",   t:"Sad",         p:"ka-na-SHI-i",    e:"😢"}, {w:"つかれた",   t:"Tired",       p:"tsu-ka-RE-ta",   e:"😴"},
    {w:"おなかがすいた",t:"Hungry",   p:"o-na-ka-su-I-ta",e:"🤤"}, {w:"のどがかわいた",t:"Thirsty",  p:"no-do-ka-wa-I-ta",e:"😮"},
    {w:"かぞく",     t:"Family",      p:"ka-ZO-ku",       e:"👨‍👩‍👧"}, {w:"おかあさん", t:"Mother",      p:"o-KA-san",       e:"👩"},
    {w:"おとうさん", t:"Father",      p:"o-TO-san",       e:"👨"}, {w:"ほん",       t:"Book",        p:"hon",            e:"📚"},
    {w:"まち",       t:"City",        p:"ma-chi",         e:"🏙"}, {w:"うみ",       t:"Beach",       p:"u-mi",           e:"🏖"},
    {w:"する",t:"To do",p:"suru",e:"🔨"}, {w:"いる",t:"To be (living)",p:"iru",e:"🧍"},
    {w:"ある",t:"To be (things)",p:"aru",e:"📦"}, {w:"なる",t:"To become",p:"naru",e:"🔄"},
    {w:"言う",t:"To say",p:"iu",e:"🗣"}, {w:"話す",t:"To speak",p:"hanasu",e:"💬"},
    {w:"知る",t:"To know",p:"shiru",e:"🧠"}, {w:"分かる",t:"To understand",p:"wakaru",e:"💡"},
    {w:"見る",t:"To see",p:"miru",e:"👀"}, {w:"聞く",t:"To listen/ask",p:"kiku",e:"🎧"},
    {w:"行く",t:"To go",p:"iku",e:"🚶"}, {w:"来る",t:"To come",p:"kuru",e:"👋"},
    {w:"帰る",t:"To return",p:"kaeru",e:"🔙"}, {w:"食べる",t:"To eat",p:"taberu",e:"🍽"},
    {w:"飲む",t:"To drink",p:"nomu",e:"🥤"}, {w:"寝る",t:"To sleep",p:"neru",e:"😴"},
    {w:"起きる",t:"To wake up",p:"okiru",e:"⏰"}, {w:"買う",t:"To buy",p:"kau",e:"🛒"},
    {w:"払う",t:"To pay",p:"harau",e:"💳"}, {w:"読む",t:"To read",p:"yomu",e:"📖"},
    {w:"書く",t:"To write",p:"kaku",e:"✍️"}, {w:"遊ぶ",t:"To play",p:"asobu",e:"🎮"},
    {w:"走る",t:"To run",p:"hashiru",e:"🏃"}, {w:"歩く",t:"To walk",p:"aruku",e:"🚶"},
    {w:"待つ",t:"To wait",p:"matsu",e:"⏳"}, {w:"思う",t:"To think",p:"omou",e:"💭"},
    {w:"考える",t:"To consider",p:"kangaeru",e:"🧠"}, {w:"作る",t:"To make",p:"tsukuru",e:"🔨"},
    {w:"使う",t:"To use",p:"tsukau",e:"🛠"}, {w:"取る",t:"To take",p:"toru",e:"✊"},
    {w:"持つ",t:"To hold/have",p:"motsu",e:"🤲"}, {w:"あげる",t:"To give",p:"ageru",e:"🎁"},
    {w:"もらう",t:"To receive",p:"morau",e:"📥"}, {w:"会う",t:"To meet",p:"au",e:"🤝"},
    {w:"働く",t:"To work",p:"hataraku",e:"💼"}, {w:"住む",t:"To live/reside",p:"sumu",e:"🏠"},
    {w:"助ける",t:"To help",p:"tasukeru",e:"🆘"}, {w:"手伝う",t:"To assist",p:"tetsudau",e:"🤝"},
    {w:"習う",t:"To learn",p:"narau",e:"🎓"}, {w:"教える",t:"To teach",p:"oshieru",e:"👩‍🏫"},
    {w:"始める",t:"To begin",p:"hajimeru",e:"▶️"}, {w:"終わる",t:"To end",p:"owaru",e:"🏁"},
    {w:"探す",t:"To search",p:"sagasu",e:"🔎"}, {w:"見つける",t:"To find",p:"mitsukeru",e:"🔍"},
    {w:"開ける",t:"To open",p:"akeru",e:"🔓"}, {w:"閉める",t:"To close",p:"shimeru",e:"🔒"},
    {w:"入る",t:"To enter",p:"hairu",e:"➡️"}, {w:"出る",t:"To exit",p:"deru",e:"🚪"},
    {w:"座る",t:"To sit",p:"suwaru",e:"🪑"}, {w:"立つ",t:"To stand",p:"tatsu",e:"🧍"},
    {w:"感じる",t:"To feel",p:"kanjiru",e:"💗"}, {w:"愛する",t:"To love",p:"aisuru",e:"❤️"},
    {w:"私",t:"I",p:"watashi",e:"🙋"}, {w:"あなた",t:"You",p:"anata",e:"👉"},
    {w:"彼",t:"He",p:"kare",e:"👨"}, {w:"彼女",t:"She",p:"kanojo",e:"👩"},
    {w:"私たち",t:"We",p:"watashitachi",e:"👥"}, {w:"これ",t:"This",p:"kore",e:"👇"},
    {w:"それ",t:"That",p:"sore",e:"👉"}, {w:"ここ",t:"Here",p:"koko",e:"📍"},
    {w:"そこ",t:"There",p:"soko",e:"🗺"}, {w:"全部",t:"Everything",p:"zenbu",e:"🌐"},
    {w:"何も",t:"Nothing",p:"nanimo",e:"🚫"}, {w:"誰か",t:"Someone",p:"dareka",e:"👤"},
    {w:"たくさん",t:"A lot",p:"takusan",e:"📈"}, {w:"少し",t:"A little",p:"sukoshi",e:"🤏"},
    {w:"とても",t:"Very",p:"totemo",e:"📈"}, {w:"もっと",t:"More",p:"motto",e:"➕"},
    {w:"も",t:"Also",p:"mo",e:"➕"}, {w:"いつも",t:"Always",p:"itsumo",e:"♾️"},
    {w:"今",t:"Now",p:"ima",e:"⏱"}, {w:"後で",t:"Later",p:"atode",e:"⏭"},
    {w:"前に",t:"Before",p:"maeni",e:"⏮"}, {w:"どこ",t:"Where",p:"doko",e:"🧭"},
    {w:"いつ",t:"When",p:"itsu",e:"📅"}, {w:"どうして",t:"Why",p:"doushite",e:"❓"},
    {w:"どう",t:"How",p:"dou",e:"🤔"}, {w:"誰",t:"Who",p:"dare",e:"👤"},
    {w:"何",t:"What",p:"nani",e:"❔"}, {w:"どれ",t:"Which",p:"dore",e:"🔀"},
    {w:"いくら",t:"How much",p:"ikura",e:"⚖️"}, {w:"一",t:"One",p:"ichi",e:"1️⃣"},
    {w:"二",t:"Two",p:"ni",e:"2️⃣"}, {w:"三",t:"Three",p:"san",e:"3️⃣"},
    {w:"四",t:"Four",p:"yon",e:"4️⃣"}, {w:"五",t:"Five",p:"go",e:"5️⃣"},
    {w:"六",t:"Six",p:"roku",e:"6️⃣"}, {w:"七",t:"Seven",p:"nana",e:"7️⃣"},
    {w:"八",t:"Eight",p:"hachi",e:"8️⃣"}, {w:"九",t:"Nine",p:"kyuu",e:"9️⃣"},
    {w:"十",t:"Ten",p:"juu",e:"🔟"}, {w:"百",t:"Hundred",p:"hyaku",e:"💯"},
    {w:"千",t:"Thousand",p:"sen",e:"🔢"}, {w:"最初",t:"First",p:"saisho",e:"🥇"},
    {w:"最後",t:"Last",p:"saigo",e:"🔚"}, {w:"月曜日",t:"Monday",p:"getsuyoubi",e:"📅"},
    {w:"火曜日",t:"Tuesday",p:"kayoubi",e:"📅"}, {w:"水曜日",t:"Wednesday",p:"suiyoubi",e:"📅"},
    {w:"木曜日",t:"Thursday",p:"mokuyoubi",e:"📅"}, {w:"金曜日",t:"Friday",p:"kinyoubi",e:"📅"},
    {w:"土曜日",t:"Saturday",p:"doyoubi",e:"📅"}, {w:"日曜日",t:"Sunday",p:"nichiyoubi",e:"📅"},
    {w:"今日",t:"Today",p:"kyou",e:"📆"}, {w:"明日",t:"Tomorrow",p:"ashita",e:"🌅"},
    {w:"昨日",t:"Yesterday",p:"kinou",e:"🌇"}, {w:"週",t:"Week",p:"shuu",e:"🗓"},
    {w:"月",t:"Month/moon",p:"tsuki",e:"🌙"}, {w:"年",t:"Year",p:"toshi",e:"🎆"},
    {w:"日",t:"Day/sun",p:"hi",e:"☀️"}, {w:"夜",t:"Night",p:"yoru",e:"🌙"},
    {w:"朝",t:"Morning",p:"asa",e:"🌄"}, {w:"夕方",t:"Evening",p:"yuugata",e:"🌆"},
    {w:"時間",t:"Time/hour",p:"jikan",e:"🕐"}, {w:"分",t:"Minute",p:"fun",e:"⏱"},
    {w:"赤",t:"Red",p:"aka",e:"🔴"}, {w:"青",t:"Blue",p:"ao",e:"🔵"},
    {w:"緑",t:"Green",p:"midori",e:"🟢"}, {w:"黄色",t:"Yellow",p:"kiiro",e:"🟡"},
    {w:"黒",t:"Black",p:"kuro",e:"⚫"}, {w:"白",t:"White",p:"shiro",e:"⚪"},
    {w:"茶色",t:"Brown",p:"chairo",e:"🟤"}, {w:"ピンク",t:"Pink",p:"pinku",e:"🌸"},
    {w:"紫",t:"Purple",p:"murasaki",e:"🟣"}, {w:"息子",t:"Son",p:"musuko",e:"👦"},
    {w:"娘",t:"Daughter",p:"musume",e:"👧"}, {w:"兄",t:"Older brother",p:"ani",e:"👬"},
    {w:"姉",t:"Older sister",p:"ane",e:"👭"}, {w:"弟",t:"Younger brother",p:"otouto",e:"👦"},
    {w:"妹",t:"Younger sister",p:"imouto",e:"👧"}, {w:"祖父",t:"Grandfather",p:"sofu",e:"👴"},
    {w:"祖母",t:"Grandmother",p:"sobo",e:"👵"}, {w:"夫",t:"Husband",p:"otto",e:"🤵"},
    {w:"妻",t:"Wife",p:"tsuma",e:"👰"}, {w:"子供",t:"Child",p:"kodomo",e:"👶"},
    {w:"男",t:"Man",p:"otoko",e:"👨"}, {w:"女",t:"Woman",p:"onna",e:"👩"},
    {w:"人",t:"Person",p:"hito",e:"👤"}, {w:"頭",t:"Head",p:"atama",e:"🗣"},
    {w:"目",t:"Eye",p:"me",e:"👁"}, {w:"手",t:"Hand",p:"te",e:"✋"},
    {w:"足",t:"Foot/leg",p:"ashi",e:"🦶"}, {w:"心",t:"Heart/mind",p:"kokoro",e:"❤️"},
    {w:"口",t:"Mouth",p:"kuchi",e:"👄"}, {w:"鼻",t:"Nose",p:"hana",e:"👃"},
    {w:"耳",t:"Ear",p:"mimi",e:"👂"}, {w:"髪",t:"Hair",p:"kami",e:"💇"},
    {w:"顔",t:"Face",p:"kao",e:"🙂"}, {w:"パン",t:"Bread",p:"pan",e:"🍞"},
    {w:"牛乳",t:"Milk",p:"gyuunyuu",e:"🥛"}, {w:"お茶",t:"Tea",p:"ocha",e:"🍵"},
    {w:"コーヒー",t:"Coffee",p:"koohii",e:"☕"}, {w:"肉",t:"Meat",p:"niku",e:"🥩"},
    {w:"魚",t:"Fish",p:"sakana",e:"🐟"}, {w:"鶏肉",t:"Chicken",p:"toriniku",e:"🍗"},
    {w:"ご飯",t:"Rice/meal",p:"gohan",e:"🍚"}, {w:"麺",t:"Noodles",p:"men",e:"🍜"},
    {w:"チーズ",t:"Cheese",p:"chiizu",e:"🧀"}, {w:"卵",t:"Egg",p:"tamago",e:"🥚"},
    {w:"果物",t:"Fruit",p:"kudamono",e:"🍎"}, {w:"りんご",t:"Apple",p:"ringo",e:"🍏"},
    {w:"バナナ",t:"Banana",p:"banana",e:"🍌"}, {w:"野菜",t:"Vegetables",p:"yasai",e:"🥦"},
    {w:"トマト",t:"Tomato",p:"tomato",e:"🍅"}, {w:"サラダ",t:"Salad",p:"sarada",e:"🥗"},
    {w:"砂糖",t:"Sugar",p:"satou",e:"🍬"}, {w:"塩",t:"Salt",p:"shio",e:"🧂"},
    {w:"卵焼き",t:"Omelette",p:"tamagoyaki",e:"🍳"}, {w:"ケーキ",t:"Cake",p:"keeki",e:"🍰"},
    {w:"アイス",t:"Ice cream",p:"aisu",e:"🍨"}, {w:"スープ",t:"Soup",p:"suupu",e:"🍲"},
    {w:"朝ごはん",t:"Breakfast",p:"asagohan",e:"🥐"}, {w:"昼ごはん",t:"Lunch",p:"hirugohan",e:"🍽"},
    {w:"晩ごはん",t:"Dinner",p:"bangohan",e:"🌙"}, {w:"レストラン",t:"Restaurant",p:"resutoran",e:"🍴"},
    {w:"テーブル",t:"Table",p:"teeburu",e:"🪑"}, {w:"ドア",t:"Door",p:"doa",e:"🚪"},
    {w:"窓",t:"Window",p:"mado",e:"🪟"}, {w:"部屋",t:"Room",p:"heya",e:"🛏"},
    {w:"台所",t:"Kitchen",p:"daidokoro",e:"🍳"}, {w:"風呂",t:"Bath",p:"furo",e:"🛁"},
    {w:"ベッド",t:"Bed",p:"beddo",e:"🛌"}, {w:"椅子",t:"Chair",p:"isu",e:"🪑"},
    {w:"鍵",t:"Key",p:"kagi",e:"🔑"}, {w:"電気",t:"Light/electricity",p:"denki",e:"💡"},
    {w:"道",t:"Road/way",p:"michi",e:"🛣"}, {w:"店",t:"Shop",p:"mise",e:"🏪"},
    {w:"市場",t:"Market",p:"ichiba",e:"🛍"}, {w:"学校",t:"School",p:"gakkou",e:"🏫"},
    {w:"病院",t:"Hospital",p:"byouin",e:"🏥"}, {w:"銀行",t:"Bank",p:"ginkou",e:"🏦"},
    {w:"会社",t:"Company",p:"kaisha",e:"🏢"}, {w:"駅",t:"Station",p:"eki",e:"🚉"},
    {w:"空港",t:"Airport",p:"kuukou",e:"✈️"}, {w:"ホテル",t:"Hotel",p:"hoteru",e:"🏨"},
    {w:"車",t:"Car",p:"kuruma",e:"🚗"}, {w:"電車",t:"Train",p:"densha",e:"🚆"},
    {w:"バス",t:"Bus",p:"basu",e:"🚌"}, {w:"飛行機",t:"Airplane",p:"hikouki",e:"🛩"},
    {w:"自転車",t:"Bicycle",p:"jitensha",e:"🚲"}, {w:"切符",t:"Ticket",p:"kippu",e:"🎫"},
    {w:"新しい",t:"New",p:"atarashii",e:"✨"}, {w:"古い",t:"Old",p:"furui",e:"🏚"},
    {w:"若い",t:"Young",p:"wakai",e:"🧒"}, {w:"きれい",t:"Beautiful/clean",p:"kirei",e:"😍"},
    {w:"暑い",t:"Hot (weather)",p:"atsui",e:"🔥"}, {w:"寒い",t:"Cold (weather)",p:"samui",e:"🧊"},
    {w:"高い",t:"Tall/expensive",p:"takai",e:"📏"}, {w:"低い",t:"Low",p:"hikui",e:"📉"},
    {w:"長い",t:"Long",p:"nagai",e:"📏"}, {w:"短い",t:"Short",p:"mijikai",e:"✂️"},
    {w:"強い",t:"Strong",p:"tsuyoi",e:"💪"}, {w:"弱い",t:"Weak",p:"yowai",e:"🪶"},
    {w:"難しい",t:"Difficult",p:"muzukashii",e:"🔴"}, {w:"易しい",t:"Easy",p:"yasashii",e:"🟢"},
    {w:"大切",t:"Important",p:"taisetsu",e:"⭐"}, {w:"正しい",t:"Correct",p:"tadashii",e:"✅"},
    {w:"本当",t:"True/real",p:"hontou",e:"✔️"}, {w:"同じ",t:"Same",p:"onaji",e:"🟰"},
    {w:"違う",t:"Different",p:"chigau",e:"🔀"}, {w:"安い",t:"Cheap",p:"yasui",e:"🏷"},
    {w:"元気",t:"Healthy/energetic",p:"genki",e:"🥦"}, {w:"病気",t:"Sick/illness",p:"byouki",e:"🤒"},
    {w:"きたない",t:"Dirty",p:"kitanai",e:"🧹"}, {w:"忙しい",t:"Busy",p:"isogashii",e:"📵"},
    {w:"面白い",t:"Interesting/funny",p:"omoshiroi",e:"😄"}, {w:"楽しい",t:"Fun",p:"tanoshii",e:"🎉"},
    {w:"太陽",t:"Sun",p:"taiyou",e:"☀️"}, {w:"星",t:"Star",p:"hoshi",e:"⭐"},
    {w:"空",t:"Sky",p:"sora",e:"🌤"}, {w:"海",t:"Sea/ocean",p:"kaiyou",e:"🌊"},
    {w:"山",t:"Mountain",p:"yama",e:"⛰"}, {w:"川",t:"River",p:"kawa",e:"🏞"},
    {w:"木",t:"Tree",p:"ki",e:"🌳"}, {w:"花",t:"Flower",p:"hana",e:"🌸"},
    {w:"雨",t:"Rain",p:"ame",e:"🌧"}, {w:"雪",t:"Snow",p:"yuki",e:"❄️"},
    {w:"風",t:"Wind",p:"kaze",e:"💨"}, {w:"火",t:"Fire",p:"kaji",e:"🔥"},
    {w:"天気",t:"Weather",p:"tenki",e:"🌦"}, {w:"物",t:"Thing",p:"mono",e:"📦"},
    {w:"生活",t:"Life/living",p:"seikatsu",e:"🌱"}, {w:"世界",t:"World",p:"sekai",e:"🌎"},
    {w:"国",t:"Country",p:"kuni",e:"🗺"}, {w:"所",t:"Place",p:"tokoro",e:"📍"},
    {w:"名前",t:"Name",p:"namae",e:"🏷"}, {w:"言葉",t:"Word/language",p:"kotoba",e:"🔤"},
    {w:"質問",t:"Question",p:"shitsumon",e:"❓"}, {w:"答え",t:"Answer",p:"kotae",e:"💬"},
    {w:"問題",t:"Problem",p:"mondai",e:"⚠️"}, {w:"考え",t:"Idea",p:"kangae",e:"💡"},
    {w:"話",t:"Story/talk",p:"hanashi",e:"📜"}, {w:"音楽",t:"Music",p:"ongaku",e:"🎵"},
    {w:"映画",t:"Movie",p:"eiga",e:"🎬"}, {w:"写真",t:"Photo",p:"shashin",e:"📷"},
    {w:"電話",t:"Telephone",p:"denwa",e:"📱"}, {w:"ゲーム",t:"Game",p:"geemu",e:"🎲"},
    {w:"スポーツ",t:"Sport",p:"supootsu",e:"⚽"}, {w:"サッカー",t:"Soccer",p:"sakkaa",e:"⚽"},
    {w:"おはよう",t:"Good morning",p:"ohayou",e:"🌅"}, {w:"こんばんは",t:"Good evening",p:"konbanwa",e:"🌆"},
    {w:"おやすみ",t:"Good night",p:"oyasumi",e:"🌙"}, {w:"さようなら",t:"Goodbye",p:"sayounara",e:"👋"},
    {w:"またね",t:"See you",p:"matane",e:"👋"}, {w:"ごめんなさい",t:"Sorry",p:"gomennasai",e:"🙇"},
    {w:"どういたしまして",t:"You're welcome",p:"douitashimashite",e:"🤲"}, {w:"大丈夫",t:"It's okay",p:"daijoubu",e:"👌"},
    {w:"分かりません",t:"I don't understand",p:"wakarimasen",e:"😕"}, {w:"いくらですか",t:"How much is it?",p:"ikura desu ka",e:"💶"},
    {w:"すみません",t:"Excuse me",p:"sumimasen",e:"🙇"}, {w:"はじめまして",t:"Nice to meet you",p:"hajimemashite",e:"🤝"},
    {w:"助けて",t:"Help!",p:"tasukete",e:"🆘"}, {w:"乾杯",t:"Cheers",p:"kanpai",e:"🥂"},
    {w:"おめでとう",t:"Congratulations",p:"omedetou",e:"🎉"}, {w:"ようこそ",t:"Welcome",p:"youkoso",e:"🎊"},
    {w:"行きましょう",t:"Let's go",p:"ikimashou",e:"🚀"}, {w:"いただきます",t:"Thanks for the meal",p:"itadakimasu",e:"🍽"}
  ],
  zh: [
    {w:"你好",       t:"Hello",       p:"nǐ hǎo",         e:"🙋"}, {w:"谢谢",       t:"Thank you",   p:"xiè xiè",        e:"🙏"},
    {w:"请",         t:"Please",      p:"qǐng",           e:"✋"}, {w:"是",         t:"Yes",         p:"shì",            e:"✅"},
    {w:"不",         t:"No",          p:"bù",             e:"❌"}, {w:"水",         t:"Water",       p:"shuǐ",           e:"💧"},
    {w:"食物",       t:"Food",        p:"shí wù",         e:"🍽"}, {w:"家",         t:"House",       p:"jiā",            e:"🏠"},
    {w:"朋友",       t:"Friend",      p:"péng yǒu",       e:"👫"}, {w:"爱",         t:"Love",        p:"ài",             e:"❤️"},
    {w:"工作",       t:"Work",        p:"gōng zuò",       e:"💼"}, {w:"钱",         t:"Money",       p:"qián",           e:"💰"},
    {w:"时间",       t:"Time",        p:"shí jiān",       e:"⏰"}, {w:"好",         t:"Good",        p:"hǎo",            e:"👍"},
    {w:"坏",         t:"Bad",         p:"huài",           e:"👎"}, {w:"大",         t:"Big",         p:"dà",             e:"🐘"},
    {w:"小",         t:"Small",       p:"xiǎo",           e:"🐭"}, {w:"快",         t:"Fast",        p:"kuài",           e:"🏃"},
    {w:"慢",         t:"Slow",        p:"màn",            e:"🐢"}, {w:"快乐",       t:"Happy",       p:"kuài lè",        e:"😊"},
    {w:"悲伤",       t:"Sad",         p:"bēi shāng",      e:"😢"}, {w:"累",         t:"Tired",       p:"lèi",            e:"😴"},
    {w:"饿",         t:"Hungry",      p:"è",              e:"🤤"}, {w:"渴",         t:"Thirsty",     p:"kě",             e:"😮"},
    {w:"家人",       t:"Family",      p:"jiā rén",        e:"👨‍👩‍👧"}, {w:"妈妈",       t:"Mother",      p:"māmā",           e:"👩"},
    {w:"爸爸",       t:"Father",      p:"bàba",           e:"👨"}, {w:"书",         t:"Book",        p:"shū",            e:"📚"},
    {w:"城市",       t:"City",        p:"chéng shì",      e:"🏙"}, {w:"海滩",       t:"Beach",       p:"hǎi tān",        e:"🏖"},
    {w:"我",t:"I/me",p:"wǒ",e:"🙋"}, {w:"你",t:"You",p:"nǐ",e:"👉"},
    {w:"他",t:"He",p:"tā",e:"👨"}, {w:"她",t:"She",p:"tā",e:"👩"},
    {w:"我们",t:"We",p:"wǒmen",e:"👥"}, {w:"他们",t:"They",p:"tāmen",e:"👪"},
    {w:"这",t:"This",p:"zhè",e:"👇"}, {w:"那",t:"That",p:"nà",e:"👉"},
    {w:"这里",t:"Here",p:"zhèlǐ",e:"📍"}, {w:"那里",t:"There",p:"nàlǐ",e:"🗺"},
    {w:"什么",t:"What",p:"shénme",e:"❔"}, {w:"谁",t:"Who",p:"shéi",e:"👤"},
    {w:"哪里",t:"Where",p:"nǎlǐ",e:"🧭"}, {w:"什么时候",t:"When",p:"shénme shíhou",e:"📅"},
    {w:"为什么",t:"Why",p:"wèishénme",e:"❓"}, {w:"怎么",t:"How",p:"zěnme",e:"🤔"},
    {w:"哪个",t:"Which",p:"nǎge",e:"🔀"}, {w:"多少",t:"How much/many",p:"duōshǎo",e:"⚖️"},
    {w:"有",t:"To have",p:"yǒu",e:"🤲"}, {w:"做",t:"To do/make",p:"zuò",e:"🔨"},
    {w:"说",t:"To say/speak",p:"shuō",e:"🗣"}, {w:"知道",t:"To know",p:"zhīdào",e:"🧠"},
    {w:"想",t:"To want/think",p:"xiǎng",e:"💭"}, {w:"要",t:"To want/need",p:"yào",e:"🙌"},
    {w:"能",t:"Can/able",p:"néng",e:"💪"}, {w:"会",t:"Can/will",p:"huì",e:"✅"},
    {w:"看",t:"To look/watch",p:"kàn",e:"👀"}, {w:"听",t:"To listen",p:"tīng",e:"🎧"},
    {w:"去",t:"To go",p:"qù",e:"🚶"}, {w:"来",t:"To come",p:"lái",e:"👋"},
    {w:"回",t:"To return",p:"huí",e:"🔙"}, {w:"吃",t:"To eat",p:"chī",e:"🍽"},
    {w:"喝",t:"To drink",p:"hē",e:"🥤"}, {w:"睡觉",t:"To sleep",p:"shuìjiào",e:"😴"},
    {w:"买",t:"To buy",p:"mǎi",e:"🛒"}, {w:"卖",t:"To sell",p:"mài",e:"🏷"},
    {w:"付钱",t:"To pay",p:"fùqián",e:"💳"}, {w:"读",t:"To read",p:"dú",e:"📖"},
    {w:"写",t:"To write",p:"xiě",e:"✍️"}, {w:"玩",t:"To play",p:"wán",e:"🎮"},
    {w:"跑",t:"To run",p:"pǎo",e:"🏃"}, {w:"走",t:"To walk",p:"zǒu",e:"🚶"},
    {w:"等",t:"To wait",p:"děng",e:"⏳"}, {w:"想要",t:"To desire",p:"xiǎngyào",e:"🙌"},
    {w:"觉得",t:"To feel/think",p:"juéde",e:"💗"}, {w:"给",t:"To give",p:"gěi",e:"🎁"},
    {w:"拿",t:"To take/hold",p:"ná",e:"✊"}, {w:"见",t:"To meet/see",p:"jiàn",e:"🤝"},
    {w:"住",t:"To live/reside",p:"zhù",e:"🏠"}, {w:"帮助",t:"To help",p:"bāngzhù",e:"🆘"},
    {w:"学习",t:"To study",p:"xuéxí",e:"📚"}, {w:"教",t:"To teach",p:"jiāo",e:"👩‍🏫"},
    {w:"开始",t:"To begin",p:"kāishǐ",e:"▶️"}, {w:"结束",t:"To end",p:"jiéshù",e:"🏁"},
    {w:"找",t:"To search/find",p:"zhǎo",e:"🔎"}, {w:"用",t:"To use",p:"yòng",e:"🛠"},
    {w:"问",t:"To ask",p:"wèn",e:"❓"}, {w:"回答",t:"To answer",p:"huídá",e:"💬"},
    {w:"进",t:"To enter",p:"jìn",e:"➡️"}, {w:"出",t:"To exit",p:"chū",e:"🚪"},
    {w:"开",t:"To open",p:"kāi",e:"🔓"}, {w:"关",t:"To close",p:"guān",e:"🔒"},
    {w:"坐",t:"To sit",p:"zuò",e:"🪑"}, {w:"站",t:"To stand",p:"zhàn",e:"🧍"},
    {w:"喜欢",t:"To like",p:"xǐhuān",e:"😊"}, {w:"全部",t:"Everything",p:"quánbù",e:"🌐"},
    {w:"没有",t:"Nothing/none",p:"méiyǒu",e:"🚫"}, {w:"东西",t:"Thing",p:"dōngxi",e:"📦"},
    {w:"很多",t:"A lot",p:"hěnduō",e:"📈"}, {w:"一点",t:"A little",p:"yìdiǎn",e:"🤏"},
    {w:"很",t:"Very",p:"hěn",e:"📈"}, {w:"更",t:"More",p:"gèng",e:"➕"},
    {w:"也",t:"Also",p:"yě",e:"➕"}, {w:"总是",t:"Always",p:"zǒngshì",e:"♾️"},
    {w:"从不",t:"Never",p:"cóngbù",e:"🚫"}, {w:"现在",t:"Now",p:"xiànzài",e:"⏱"},
    {w:"以后",t:"Later",p:"yǐhòu",e:"⏭"}, {w:"以前",t:"Before",p:"yǐqián",e:"⏮"},
    {w:"一",t:"One",p:"yī",e:"1️⃣"}, {w:"二",t:"Two",p:"èr",e:"2️⃣"},
    {w:"三",t:"Three",p:"sān",e:"3️⃣"}, {w:"四",t:"Four",p:"sì",e:"4️⃣"},
    {w:"五",t:"Five",p:"wǔ",e:"5️⃣"}, {w:"六",t:"Six",p:"liù",e:"6️⃣"},
    {w:"七",t:"Seven",p:"qī",e:"7️⃣"}, {w:"八",t:"Eight",p:"bā",e:"8️⃣"},
    {w:"九",t:"Nine",p:"jiǔ",e:"9️⃣"}, {w:"十",t:"Ten",p:"shí",e:"🔟"},
    {w:"百",t:"Hundred",p:"bǎi",e:"💯"}, {w:"千",t:"Thousand",p:"qiān",e:"🔢"},
    {w:"第一",t:"First",p:"dìyī",e:"🥇"}, {w:"最后",t:"Last",p:"zuìhòu",e:"🔚"},
    {w:"星期一",t:"Monday",p:"xīngqīyī",e:"📅"}, {w:"星期二",t:"Tuesday",p:"xīngqī'èr",e:"📅"},
    {w:"星期三",t:"Wednesday",p:"xīngqīsān",e:"📅"}, {w:"星期四",t:"Thursday",p:"xīngqīsì",e:"📅"},
    {w:"星期五",t:"Friday",p:"xīngqīwǔ",e:"📅"}, {w:"星期六",t:"Saturday",p:"xīngqīliù",e:"📅"},
    {w:"星期天",t:"Sunday",p:"xīngqītiān",e:"📅"}, {w:"今天",t:"Today",p:"jīntiān",e:"📆"},
    {w:"明天",t:"Tomorrow",p:"míngtiān",e:"🌅"}, {w:"昨天",t:"Yesterday",p:"zuótiān",e:"🌇"},
    {w:"星期",t:"Week",p:"xīngqī",e:"🗓"}, {w:"月",t:"Month",p:"yuè",e:"🗓"},
    {w:"年",t:"Year",p:"nián",e:"🎆"}, {w:"天",t:"Day",p:"tiān",e:"☀️"},
    {w:"晚上",t:"Night/evening",p:"wǎnshàng",e:"🌙"}, {w:"早上",t:"Morning",p:"zǎoshàng",e:"🌄"},
    {w:"下午",t:"Afternoon",p:"xiàwǔ",e:"🌆"}, {w:"小时",t:"Hour",p:"xiǎoshí",e:"🕐"},
    {w:"分钟",t:"Minute",p:"fēnzhōng",e:"⏱"}, {w:"红色",t:"Red",p:"hóngsè",e:"🔴"},
    {w:"蓝色",t:"Blue",p:"lánsè",e:"🔵"}, {w:"绿色",t:"Green",p:"lǜsè",e:"🟢"},
    {w:"黄色",t:"Yellow",p:"huángsè",e:"🟡"}, {w:"黑色",t:"Black",p:"hēisè",e:"⚫"},
    {w:"白色",t:"White",p:"báisè",e:"⚪"}, {w:"灰色",t:"Grey",p:"huīsè",e:"🩶"},
    {w:"棕色",t:"Brown",p:"zōngsè",e:"🟤"}, {w:"粉色",t:"Pink",p:"fěnsè",e:"🌸"},
    {w:"橙色",t:"Orange",p:"chéngsè",e:"🟠"}, {w:"紫色",t:"Purple",p:"zǐsè",e:"🟣"},
    {w:"儿子",t:"Son",p:"érzi",e:"👦"}, {w:"女儿",t:"Daughter",p:"nǚ'ér",e:"👧"},
    {w:"哥哥",t:"Older brother",p:"gēge",e:"👬"}, {w:"姐姐",t:"Older sister",p:"jiějie",e:"👭"},
    {w:"弟弟",t:"Younger brother",p:"dìdi",e:"👦"}, {w:"妹妹",t:"Younger sister",p:"mèimei",e:"👧"},
    {w:"爷爷",t:"Grandfather",p:"yéye",e:"👴"}, {w:"奶奶",t:"Grandmother",p:"nǎinai",e:"👵"},
    {w:"丈夫",t:"Husband",p:"zhàngfu",e:"🤵"}, {w:"妻子",t:"Wife",p:"qīzi",e:"👰"},
    {w:"孩子",t:"Child",p:"háizi",e:"👶"}, {w:"男人",t:"Man",p:"nánrén",e:"👨"},
    {w:"女人",t:"Woman",p:"nǚrén",e:"👩"}, {w:"人",t:"Person",p:"rén",e:"👤"},
    {w:"头",t:"Head",p:"tóu",e:"🗣"}, {w:"眼睛",t:"Eye",p:"yǎnjīng",e:"👁"},
    {w:"手",t:"Hand",p:"shǒu",e:"✋"}, {w:"脚",t:"Foot",p:"jiǎo",e:"🦶"},
    {w:"心",t:"Heart",p:"xīn",e:"❤️"}, {w:"嘴",t:"Mouth",p:"zuǐ",e:"👄"},
    {w:"鼻子",t:"Nose",p:"bízi",e:"👃"}, {w:"耳朵",t:"Ear",p:"ěrduo",e:"👂"},
    {w:"头发",t:"Hair",p:"tóufà",e:"💇"}, {w:"脸",t:"Face",p:"liǎn",e:"🙂"},
    {w:"面包",t:"Bread",p:"miànbāo",e:"🍞"}, {w:"牛奶",t:"Milk",p:"niúnǎi",e:"🥛"},
    {w:"茶",t:"Tea",p:"chá",e:"🍵"}, {w:"咖啡",t:"Coffee",p:"kāfēi",e:"☕"},
    {w:"肉",t:"Meat",p:"ròu",e:"🥩"}, {w:"鱼",t:"Fish",p:"yú",e:"🐟"},
    {w:"鸡肉",t:"Chicken",p:"jīròu",e:"🍗"}, {w:"米饭",t:"Rice",p:"mǐfàn",e:"🍚"},
    {w:"面条",t:"Noodles",p:"miàntiáo",e:"🍜"}, {w:"奶酪",t:"Cheese",p:"nǎilào",e:"🧀"},
    {w:"鸡蛋",t:"Egg",p:"jīdàn",e:"🥚"}, {w:"水果",t:"Fruit",p:"shuǐguǒ",e:"🍎"},
    {w:"苹果",t:"Apple",p:"píngguǒ",e:"🍏"}, {w:"香蕉",t:"Banana",p:"xiāngjiāo",e:"🍌"},
    {w:"蔬菜",t:"Vegetables",p:"shūcài",e:"🥦"}, {w:"西红柿",t:"Tomato",p:"xīhóngshì",e:"🍅"},
    {w:"土豆",t:"Potato",p:"tǔdòu",e:"🥔"}, {w:"沙拉",t:"Salad",p:"shālā",e:"🥗"},
    {w:"糖",t:"Sugar",p:"táng",e:"🍬"}, {w:"盐",t:"Salt",p:"yán",e:"🧂"},
    {w:"油",t:"Oil",p:"yóu",e:"🫒"}, {w:"蛋糕",t:"Cake",p:"dàngāo",e:"🍰"},
    {w:"冰淇淋",t:"Ice cream",p:"bīngqílín",e:"🍨"}, {w:"汤",t:"Soup",p:"tāng",e:"🍲"},
    {w:"早饭",t:"Breakfast",p:"zǎofàn",e:"🥐"}, {w:"午饭",t:"Lunch",p:"wǔfàn",e:"🍽"},
    {w:"晚饭",t:"Dinner",p:"wǎnfàn",e:"🌙"}, {w:"饭店",t:"Restaurant",p:"fàndiàn",e:"🍴"},
    {w:"桌子",t:"Table",p:"zhuōzi",e:"🪑"}, {w:"门",t:"Door",p:"mén",e:"🚪"},
    {w:"窗户",t:"Window",p:"chuānghu",e:"🪟"}, {w:"房间",t:"Room",p:"fángjiān",e:"🛏"},
    {w:"厨房",t:"Kitchen",p:"chúfáng",e:"🍳"}, {w:"浴室",t:"Bathroom",p:"yùshì",e:"🛁"},
    {w:"床",t:"Bed",p:"chuáng",e:"🛌"}, {w:"椅子",t:"Chair",p:"yǐzi",e:"🪑"},
    {w:"钥匙",t:"Key",p:"yàoshi",e:"🔑"}, {w:"灯",t:"Light/lamp",p:"dēng",e:"💡"},
    {w:"路",t:"Road",p:"lù",e:"🛣"}, {w:"商店",t:"Shop",p:"shāngdiàn",e:"🏪"},
    {w:"市场",t:"Market",p:"shìchǎng",e:"🛍"}, {w:"学校",t:"School",p:"xuéxiào",e:"🏫"},
    {w:"医院",t:"Hospital",p:"yīyuàn",e:"🏥"}, {w:"银行",t:"Bank",p:"yínháng",e:"🏦"},
    {w:"公司",t:"Company",p:"gōngsī",e:"🏢"}, {w:"车站",t:"Station",p:"chēzhàn",e:"🚉"},
    {w:"机场",t:"Airport",p:"jīchǎng",e:"✈️"}, {w:"酒店",t:"Hotel",p:"jiǔdiàn",e:"🏨"},
    {w:"汽车",t:"Car",p:"qìchē",e:"🚗"}, {w:"火车",t:"Train",p:"huǒchē",e:"🚆"},
    {w:"公交车",t:"Bus",p:"gōngjiāochē",e:"🚌"}, {w:"飞机",t:"Airplane",p:"fēijī",e:"🛩"},
    {w:"自行车",t:"Bicycle",p:"zìxíngchē",e:"🚲"}, {w:"票",t:"Ticket",p:"piào",e:"🎫"},
    {w:"新",t:"New",p:"xīn",e:"✨"}, {w:"旧",t:"Old (things)",p:"jiù",e:"🏚"},
    {w:"年轻",t:"Young",p:"niánqīng",e:"🧒"}, {w:"漂亮",t:"Beautiful",p:"piàoliang",e:"😍"},
    {w:"热",t:"Hot",p:"rè",e:"🔥"}, {w:"冷",t:"Cold",p:"lěng",e:"🧊"},
    {w:"高",t:"Tall/high",p:"gāo",e:"📏"}, {w:"矮",t:"Short (height)",p:"ǎi",e:"📉"},
    {w:"长",t:"Long",p:"cháng",e:"📏"}, {w:"短",t:"Short (length)",p:"duǎn",e:"✂️"},
    {w:"强",t:"Strong",p:"qiáng",e:"💪"}, {w:"弱",t:"Weak",p:"ruò",e:"🪶"},
    {w:"容易",t:"Easy",p:"róngyì",e:"🟢"}, {w:"难",t:"Difficult",p:"nán",e:"🔴"},
    {w:"重要",t:"Important",p:"zhòngyào",e:"⭐"}, {w:"对",t:"Correct",p:"duì",e:"✅"},
    {w:"错",t:"Wrong",p:"cuò",e:"❌"}, {w:"真",t:"True/real",p:"zhēn",e:"✔️"},
    {w:"满",t:"Full",p:"mǎn",e:"🈵"}, {w:"空",t:"Empty",p:"kōng",e:"🈳"},
    {w:"干净",t:"Clean",p:"gānjìng",e:"🧼"}, {w:"脏",t:"Dirty",p:"zāng",e:"🧹"},
    {w:"贵",t:"Expensive",p:"guì",e:"💸"}, {w:"便宜",t:"Cheap",p:"piányi",e:"🏷"},
    {w:"健康",t:"Healthy",p:"jiànkāng",e:"🥦"}, {w:"忙",t:"Busy",p:"máng",e:"📵"},
    {w:"一样",t:"Same",p:"yíyàng",e:"🟰"}, {w:"不同",t:"Different",p:"bùtóng",e:"🔀"},
    {w:"有趣",t:"Interesting",p:"yǒuqù",e:"😄"}, {w:"太阳",t:"Sun",p:"tàiyáng",e:"☀️"},
    {w:"月亮",t:"Moon",p:"yuèliàng",e:"🌙"}, {w:"星星",t:"Star",p:"xīngxing",e:"⭐"},
    {w:"天空",t:"Sky",p:"tiānkōng",e:"🌤"}, {w:"大海",t:"Sea",p:"dàhǎi",e:"🌊"},
    {w:"山",t:"Mountain",p:"shān",e:"⛰"}, {w:"河",t:"River",p:"hé",e:"🏞"},
    {w:"树",t:"Tree",p:"shù",e:"🌳"}, {w:"花",t:"Flower",p:"huā",e:"🌸"},
    {w:"雨",t:"Rain",p:"yǔ",e:"🌧"}, {w:"雪",t:"Snow",p:"xuě",e:"❄️"},
    {w:"风",t:"Wind",p:"fēng",e:"💨"}, {w:"火",t:"Fire",p:"huǒ",e:"🔥"},
    {w:"天气",t:"Weather",p:"tiānqì",e:"🌦"}, {w:"生活",t:"Life",p:"shēnghuó",e:"🌱"},
    {w:"世界",t:"World",p:"shìjiè",e:"🌎"}, {w:"国家",t:"Country",p:"guójiā",e:"🗺"},
    {w:"地方",t:"Place",p:"dìfāng",e:"📍"}, {w:"名字",t:"Name",p:"míngzi",e:"🏷"},
    {w:"词",t:"Word",p:"cí",e:"🔤"}, {w:"问题",t:"Question/problem",p:"wèntí",e:"❓"},
    {w:"答案",t:"Answer",p:"dá'àn",e:"💬"}, {w:"主意",t:"Idea",p:"zhǔyi",e:"💡"},
    {w:"故事",t:"Story",p:"gùshi",e:"📜"}, {w:"音乐",t:"Music",p:"yīnyuè",e:"🎵"},
    {w:"电影",t:"Movie",p:"diànyǐng",e:"🎬"}, {w:"照片",t:"Photo",p:"zhàopiàn",e:"📷"},
    {w:"电话",t:"Telephone",p:"diànhuà",e:"📱"}, {w:"游戏",t:"Game",p:"yóuxì",e:"🎲"},
    {w:"运动",t:"Sport",p:"yùndòng",e:"⚽"}, {w:"足球",t:"Football",p:"zúqiú",e:"⚽"},
    {w:"早上好",t:"Good morning",p:"zǎoshàng hǎo",e:"🌅"}, {w:"晚上好",t:"Good evening",p:"wǎnshàng hǎo",e:"🌆"},
    {w:"晚安",t:"Good night",p:"wǎn'ān",e:"🌙"}, {w:"再见",t:"Goodbye",p:"zàijiàn",e:"👋"},
    {w:"对不起",t:"Sorry",p:"duìbuqǐ",e:"🙇"}, {w:"没关系",t:"It's okay",p:"méiguānxi",e:"🤲"},
    {w:"不客气",t:"You're welcome",p:"búkèqi",e:"🤲"}, {w:"我不知道",t:"I don't know",p:"wǒ bù zhīdào",e:"🤷"},
    {w:"我不懂",t:"I don't understand",p:"wǒ bù dǒng",e:"😕"}, {w:"多少钱",t:"How much money?",p:"duōshǎo qián",e:"💶"},
    {w:"几点了",t:"What time is it?",p:"jǐ diǎn le",e:"🕐"}, {w:"我叫",t:"My name is",p:"wǒ jiào",e:"🪪"},
    {w:"很高兴认识你",t:"Nice to meet you",p:"hěn gāoxìng rènshi nǐ",e:"🤝"}, {w:"救命",t:"Help!",p:"jiùmìng",e:"🆘"},
    {w:"干杯",t:"Cheers",p:"gānbēi",e:"🥂"}, {w:"恭喜",t:"Congratulations",p:"gōngxǐ",e:"🎉"},
    {w:"欢迎",t:"Welcome",p:"huānyíng",e:"🎊"}, {w:"走吧",t:"Let's go",p:"zǒu ba",e:"🚀"},
    {w:"请问",t:"Excuse me (asking)",p:"qǐngwèn",e:"🙋"}
  ],
  hi: [
    {w:"नमस्ते",     t:"Hello",       p:"na-MAS-teh",     e:"🙋"}, {w:"धन्यवाद",    t:"Thank you",   p:"dhan-ya-VAAD",   e:"🙏"},
    {w:"कृपया",      t:"Please",      p:"krip-YA",        e:"✋"}, {w:"हाँ",        t:"Yes",         p:"haan",           e:"✅"},
    {w:"नहीं",       t:"No",          p:"na-HEEN",        e:"❌"}, {w:"पानी",       t:"Water",       p:"PAA-nee",        e:"💧"},
    {w:"खाना",       t:"Food",        p:"KHAA-na",        e:"🍽"}, {w:"घर",         t:"House",       p:"ghar",           e:"🏠"},
    {w:"दोस्त",      t:"Friend",      p:"DOST",           e:"👫"}, {w:"प्यार",      t:"Love",        p:"PYAAR",          e:"❤️"},
    {w:"काम",        t:"Work",        p:"kaam",           e:"💼"}, {w:"पैसा",       t:"Money",       p:"PAI-sa",         e:"💰"},
    {w:"समय",        t:"Time",        p:"SA-may",         e:"⏰"}, {w:"अच्छा",      t:"Good",        p:"ACH-cha",        e:"👍"},
    {w:"बुरा",       t:"Bad",         p:"bu-RAA",         e:"👎"}, {w:"बड़ा",        t:"Big",         p:"ba-DAA",         e:"🐘"},
    {w:"छोटा",       t:"Small",       p:"CHHO-ta",        e:"🐭"}, {w:"तेज़",        t:"Fast",        p:"tez",            e:"🏃"},
    {w:"धीमा",       t:"Slow",        p:"DHEE-ma",        e:"🐢"}, {w:"खुश",        t:"Happy",       p:"khush",          e:"😊"},
    {w:"उदास",       t:"Sad",         p:"u-DAAS",         e:"😢"}, {w:"थका",        t:"Tired",       p:"tha-KAA",        e:"😴"},
    {w:"भूखा",       t:"Hungry",      p:"BHOO-kha",       e:"🤤"}, {w:"प्यासा",     t:"Thirsty",     p:"PYAA-sa",        e:"😮"},
    {w:"परिवार",     t:"Family",      p:"pa-ri-VAAR",     e:"👨‍👩‍👧"}, {w:"माँ",        t:"Mother",      p:"maa",            e:"👩"},
    {w:"पिता",       t:"Father",      p:"pi-TAA",         e:"👨"}, {w:"किताब",      t:"Book",        p:"ki-TAAB",        e:"📚"},
    {w:"शहर",        t:"City",        p:"sha-HAR",        e:"🏙"}, {w:"समुद्र तट",  t:"Beach",       p:"sa-MUD-ra tat",  e:"🏖"},
    {w:"होना",t:"To be",p:"ho-naa",e:"🧍"}, {w:"करना",t:"To do",p:"kar-naa",e:"🔨"},
    {w:"कहना",t:"To say",p:"keh-naa",e:"🗣"}, {w:"बोलना",t:"To speak",p:"bol-naa",e:"💬"},
    {w:"जानना",t:"To know",p:"jaan-naa",e:"🧠"}, {w:"चाहना",t:"To want",p:"chaah-naa",e:"🙌"},
    {w:"सकना",t:"To be able",p:"sak-naa",e:"💪"}, {w:"देखना",t:"To see",p:"dekh-naa",e:"👀"},
    {w:"जाना",t:"To go",p:"jaa-naa",e:"🚶"}, {w:"आना",t:"To come",p:"aa-naa",e:"👋"},
    {w:"देना",t:"To give",p:"de-naa",e:"🎁"}, {w:"सोचना",t:"To think",p:"soch-naa",e:"💭"},
    {w:"रहना",t:"To live/stay",p:"reh-naa",e:"🌱"}, {w:"समझना",t:"To understand",p:"samajh-naa",e:"💡"},
    {w:"पाना",t:"To find/get",p:"paa-naa",e:"🔍"}, {w:"लेना",t:"To take",p:"le-naa",e:"✊"},
    {w:"रखना",t:"To put/keep",p:"rakh-naa",e:"📥"}, {w:"मानना",t:"To believe",p:"maan-naa",e:"🙏"},
    {w:"लाना",t:"To bring",p:"laa-naa",e:"🎒"}, {w:"लौटना",t:"To return",p:"laut-naa",e:"🔙"},
    {w:"याद करना",t:"To remember",p:"yaad kar-naa",e:"🧾"}, {w:"बुलाना",t:"To call",p:"bu-laa-naa",e:"📞"},
    {w:"इंतज़ार करना",t:"To wait",p:"in-te-zaar kar-naa",e:"⏳"}, {w:"ख़त्म करना",t:"To finish",p:"khatm kar-naa",e:"🏁"},
    {w:"पीना",t:"To drink",p:"pee-naa",e:"🥤"}, {w:"सोना",t:"To sleep",p:"so-naa",e:"😴"},
    {w:"खोलना",t:"To open",p:"khol-naa",e:"🔓"}, {w:"बंद करना",t:"To close",p:"band kar-naa",e:"🔒"},
    {w:"ख़रीदना",t:"To buy",p:"kha-reed-naa",e:"🛒"}, {w:"भुगतान करना",t:"To pay",p:"bhug-taan kar-naa",e:"💳"},
    {w:"पढ़ना",t:"To read/study",p:"parh-naa",e:"📖"}, {w:"लिखना",t:"To write",p:"likh-naa",e:"✍️"},
    {w:"सुनना",t:"To listen",p:"sun-naa",e:"🎧"}, {w:"खेलना",t:"To play",p:"khel-naa",e:"🎮"},
    {w:"दौड़ना",t:"To run",p:"daur-naa",e:"🏃"}, {w:"चलना",t:"To walk",p:"chal-naa",e:"🚶"},
    {w:"मदद करना",t:"To help",p:"ma-dad kar-naa",e:"🆘"}, {w:"सीखना",t:"To learn",p:"seekh-naa",e:"🎓"},
    {w:"सिखाना",t:"To teach",p:"si-khaa-naa",e:"👩‍🏫"}, {w:"शुरू करना",t:"To begin",p:"shu-ruu kar-naa",e:"▶️"},
    {w:"ढूंढना",t:"To search",p:"dhuundh-naa",e:"🔎"}, {w:"इस्तेमाल करना",t:"To use",p:"is-te-maal kar-naa",e:"🛠"},
    {w:"पूछना",t:"To ask",p:"puuchh-naa",e:"❓"}, {w:"जवाब देना",t:"To answer",p:"ja-vaab de-naa",e:"💬"},
    {w:"निकलना",t:"To go out",p:"ni-kal-naa",e:"🚪"}, {w:"अंदर आना",t:"To enter",p:"an-dar aa-naa",e:"➡️"},
    {w:"खोना",t:"To lose",p:"kho-naa",e:"🫥"}, {w:"जीतना",t:"To win",p:"jeet-naa",e:"🏆"},
    {w:"कोशिश करना",t:"To try",p:"ko-shish kar-naa",e:"🎯"}, {w:"बदलना",t:"To change",p:"ba-dal-naa",e:"🔄"},
    {w:"महसूस करना",t:"To feel",p:"meh-suus kar-naa",e:"💗"}, {w:"बैठना",t:"To sit",p:"baith-naa",e:"🪑"},
    {w:"खड़ा होना",t:"To stand",p:"kha-raa ho-naa",e:"🧍"}, {w:"मिलना",t:"To meet",p:"mil-naa",e:"🤝"},
    {w:"मैं",t:"I",p:"main",e:"🙋"}, {w:"तुम",t:"You (informal)",p:"tum",e:"👉"},
    {w:"आप",t:"You (formal)",p:"aap",e:"🙏"}, {w:"वह",t:"He/she/that",p:"vah",e:"👤"},
    {w:"हम",t:"We",p:"ham",e:"👥"}, {w:"वे",t:"They",p:"ve",e:"👪"},
    {w:"यह",t:"This",p:"yah",e:"👇"}, {w:"सब",t:"All/everything",p:"sab",e:"🌐"},
    {w:"कुछ नहीं",t:"Nothing",p:"kuchh na-heen",e:"🚫"}, {w:"कुछ",t:"Something",p:"kuchh",e:"❔"},
    {w:"कोई",t:"Someone",p:"ko-ii",e:"👤"}, {w:"कोई नहीं",t:"Nobody",p:"ko-ii na-heen",e:"🙅"},
    {w:"बहुत",t:"A lot/very",p:"ba-hut",e:"📈"}, {w:"थोड़ा",t:"Little/few",p:"tho-raa",e:"🤏"},
    {w:"ज़्यादा",t:"More/too much",p:"zyaa-daa",e:"➕"}, {w:"कम",t:"Less",p:"kam",e:"➖"},
    {w:"भी",t:"Also",p:"bhee",e:"➕"}, {w:"हमेशा",t:"Always",p:"ha-me-shaa",e:"♾️"},
    {w:"कभी नहीं",t:"Never",p:"ka-bhee na-heen",e:"🚫"}, {w:"अभी",t:"Now",p:"a-bhee",e:"⏱"},
    {w:"बाद में",t:"Later",p:"baad mein",e:"⏭"}, {w:"पहले",t:"Before/first",p:"peh-le",e:"⏮"},
    {w:"फिर",t:"Again/then",p:"phir",e:"🔁"}, {w:"यहाँ",t:"Here",p:"ya-haan",e:"📍"},
    {w:"वहाँ",t:"There",p:"va-haan",e:"🗺"}, {w:"अंदर",t:"Inside",p:"an-dar",e:"📦"},
    {w:"बाहर",t:"Outside",p:"baa-har",e:"🌤"}, {w:"कहाँ",t:"Where",p:"ka-haan",e:"🧭"},
    {w:"कब",t:"When",p:"kab",e:"📅"}, {w:"क्यों",t:"Why",p:"kyon",e:"❓"},
    {w:"कैसे",t:"How",p:"kai-se",e:"🤔"}, {w:"कौन",t:"Who",p:"kaun",e:"👤"},
    {w:"क्या",t:"What",p:"kyaa",e:"❔"}, {w:"कौन सा",t:"Which",p:"kaun saa",e:"🔀"},
    {w:"कितना",t:"How much",p:"kit-naa",e:"⚖️"}, {w:"एक",t:"One",p:"ek",e:"1️⃣"},
    {w:"दो",t:"Two",p:"do",e:"2️⃣"}, {w:"तीन",t:"Three",p:"teen",e:"3️⃣"},
    {w:"चार",t:"Four",p:"chaar",e:"4️⃣"}, {w:"पाँच",t:"Five",p:"paanch",e:"5️⃣"},
    {w:"छह",t:"Six",p:"chhah",e:"6️⃣"}, {w:"सात",t:"Seven",p:"saat",e:"7️⃣"},
    {w:"आठ",t:"Eight",p:"aath",e:"8️⃣"}, {w:"नौ",t:"Nine",p:"nau",e:"9️⃣"},
    {w:"दस",t:"Ten",p:"das",e:"🔟"}, {w:"ग्यारह",t:"Eleven",p:"gyaa-rah",e:"🔢"},
    {w:"बारह",t:"Twelve",p:"baa-rah",e:"🔢"}, {w:"बीस",t:"Twenty",p:"bees",e:"🔢"},
    {w:"तीस",t:"Thirty",p:"tees",e:"🔢"}, {w:"चालीस",t:"Forty",p:"chaa-lees",e:"🔢"},
    {w:"पचास",t:"Fifty",p:"pa-chaas",e:"🔢"}, {w:"सौ",t:"Hundred",p:"sau",e:"💯"},
    {w:"हज़ार",t:"Thousand",p:"ha-zaar",e:"🔢"}, {w:"पहला",t:"First",p:"peh-laa",e:"🥇"},
    {w:"दूसरा",t:"Second",p:"duus-raa",e:"🥈"}, {w:"आख़िरी",t:"Last",p:"aa-khi-ree",e:"🔚"},
    {w:"सोमवार",t:"Monday",p:"som-vaar",e:"📅"}, {w:"मंगलवार",t:"Tuesday",p:"man-gal-vaar",e:"📅"},
    {w:"बुधवार",t:"Wednesday",p:"budh-vaar",e:"📅"}, {w:"गुरुवार",t:"Thursday",p:"gu-ru-vaar",e:"📅"},
    {w:"शुक्रवार",t:"Friday",p:"shuk-ra-vaar",e:"📅"}, {w:"शनिवार",t:"Saturday",p:"sha-ni-vaar",e:"📅"},
    {w:"रविवार",t:"Sunday",p:"ra-vi-vaar",e:"📅"}, {w:"आज",t:"Today",p:"aaj",e:"📆"},
    {w:"कल",t:"Tomorrow/yesterday",p:"kal",e:"🌅"}, {w:"सप्ताह",t:"Week",p:"sap-taah",e:"🗓"},
    {w:"महीना",t:"Month",p:"ma-hee-naa",e:"🗓"}, {w:"साल",t:"Year",p:"saal",e:"🎆"},
    {w:"दिन",t:"Day",p:"din",e:"☀️"}, {w:"रात",t:"Night",p:"raat",e:"🌙"},
    {w:"सुबह",t:"Morning",p:"su-bah",e:"🌄"}, {w:"शाम",t:"Evening",p:"shaam",e:"🌆"},
    {w:"घंटा",t:"Hour",p:"ghan-taa",e:"🕐"}, {w:"मिनट",t:"Minute",p:"mi-nat",e:"⏱"},
    {w:"जनवरी",t:"January",p:"jan-va-ree",e:"❄️"}, {w:"फ़रवरी",t:"February",p:"far-va-ree",e:"💘"},
    {w:"मार्च",t:"March",p:"maarch",e:"🌸"}, {w:"अप्रैल",t:"April",p:"a-prail",e:"🌷"},
    {w:"मई",t:"May",p:"ma-ee",e:"🌼"}, {w:"जून",t:"June",p:"juun",e:"☀️"},
    {w:"जुलाई",t:"July",p:"ju-laa-ee",e:"🏖"}, {w:"अगस्त",t:"August",p:"a-gast",e:"🌞"},
    {w:"सितंबर",t:"September",p:"si-tam-bar",e:"🍂"}, {w:"अक्टूबर",t:"October",p:"ak-tuu-bar",e:"🎃"},
    {w:"नवंबर",t:"November",p:"na-vam-bar",e:"🌧"}, {w:"दिसंबर",t:"December",p:"di-sam-bar",e:"🎄"},
    {w:"लाल",t:"Red",p:"laal",e:"🔴"}, {w:"नीला",t:"Blue",p:"nee-laa",e:"🔵"},
    {w:"हरा",t:"Green",p:"ha-raa",e:"🟢"}, {w:"पीला",t:"Yellow",p:"pee-laa",e:"🟡"},
    {w:"काला",t:"Black",p:"kaa-laa",e:"⚫"}, {w:"सफ़ेद",t:"White",p:"sa-fed",e:"⚪"},
    {w:"स्लेटी",t:"Grey",p:"sle-tee",e:"🩶"}, {w:"भूरा",t:"Brown",p:"bhuu-raa",e:"🟤"},
    {w:"गुलाबी",t:"Pink",p:"gu-laa-bee",e:"🌸"}, {w:"नारंगी",t:"Orange",p:"naa-ran-gee",e:"🟠"},
    {w:"बैंगनी",t:"Purple",p:"bain-ga-nee",e:"🟣"}, {w:"बेटा",t:"Son",p:"be-taa",e:"👦"},
    {w:"बेटी",t:"Daughter",p:"be-tee",e:"👧"}, {w:"भाई",t:"Brother",p:"bhaa-ee",e:"👬"},
    {w:"बहन",t:"Sister",p:"ba-han",e:"👭"}, {w:"दादा",t:"Grandfather",p:"daa-daa",e:"👴"},
    {w:"दादी",t:"Grandmother",p:"daa-dee",e:"👵"}, {w:"चाचा",t:"Uncle",p:"chaa-chaa",e:"👨"},
    {w:"चाची",t:"Aunt",p:"chaa-chee",e:"👩"}, {w:"पति",t:"Husband",p:"pa-ti",e:"🤵"},
    {w:"पत्नी",t:"Wife",p:"pat-nee",e:"👰"}, {w:"बच्चा",t:"Child",p:"bach-chaa",e:"👶"},
    {w:"लड़का",t:"Boy",p:"lar-kaa",e:"🧑"}, {w:"लड़की",t:"Girl",p:"lar-kee",e:"👧"},
    {w:"आदमी",t:"Man",p:"aad-mee",e:"👨"}, {w:"औरत",t:"Woman",p:"au-rat",e:"👩"},
    {w:"लोग",t:"People",p:"log",e:"👥"}, {w:"इंसान",t:"Person/human",p:"in-saan",e:"👤"},
    {w:"सिर",t:"Head",p:"sir",e:"🗣"}, {w:"आँख",t:"Eye",p:"aankh",e:"👁"},
    {w:"हाथ",t:"Hand",p:"haath",e:"✋"}, {w:"पैर",t:"Foot/leg",p:"pair",e:"🦶"},
    {w:"दिल",t:"Heart",p:"dil",e:"❤️"}, {w:"मुँह",t:"Mouth",p:"munh",e:"👄"},
    {w:"नाक",t:"Nose",p:"naak",e:"👃"}, {w:"कान",t:"Ear",p:"kaan",e:"👂"},
    {w:"बाल",t:"Hair",p:"baal",e:"💇"}, {w:"चेहरा",t:"Face",p:"cheh-raa",e:"🙂"},
    {w:"उंगली",t:"Finger",p:"ung-lee",e:"👆"}, {w:"पीठ",t:"Back",p:"peeth",e:"🧍"},
    {w:"रोटी",t:"Bread/roti",p:"ro-tee",e:"🍞"}, {w:"दूध",t:"Milk",p:"duudh",e:"🥛"},
    {w:"चाय",t:"Tea",p:"chaay",e:"🍵"}, {w:"कॉफ़ी",t:"Coffee",p:"ko-fee",e:"☕"},
    {w:"जूस",t:"Juice",p:"juus",e:"🧃"}, {w:"मांस",t:"Meat",p:"maans",e:"🥩"},
    {w:"मछली",t:"Fish",p:"machh-lee",e:"🐟"}, {w:"मुर्गी",t:"Chicken",p:"mur-gee",e:"🍗"},
    {w:"चावल",t:"Rice",p:"chaa-val",e:"🍚"}, {w:"दाल",t:"Lentils (dal)",p:"daal",e:"🍲"},
    {w:"पनीर",t:"Paneer/cheese",p:"pa-neer",e:"🧀"}, {w:"अंडा",t:"Egg",p:"an-daa",e:"🥚"},
    {w:"फल",t:"Fruit",p:"phal",e:"🍎"}, {w:"सेब",t:"Apple",p:"seb",e:"🍏"},
    {w:"केला",t:"Banana",p:"ke-laa",e:"🍌"}, {w:"सब्ज़ी",t:"Vegetable",p:"sab-zee",e:"🥦"},
    {w:"टमाटर",t:"Tomato",p:"ta-maa-tar",e:"🍅"}, {w:"आलू",t:"Potato",p:"aa-luu",e:"🥔"},
    {w:"सलाद",t:"Salad",p:"sa-laad",e:"🥗"}, {w:"चीनी",t:"Sugar",p:"chee-nee",e:"🍬"},
    {w:"नमक",t:"Salt",p:"na-mak",e:"🧂"}, {w:"तेल",t:"Oil",p:"tel",e:"🫒"},
    {w:"मक्खन",t:"Butter",p:"mak-khan",e:"🧈"}, {w:"मिठाई",t:"Sweets",p:"mi-thaa-ee",e:"🍰"},
    {w:"आइसक्रीम",t:"Ice cream",p:"aais-kreem",e:"🍨"}, {w:"नाश्ता",t:"Breakfast",p:"naash-taa",e:"🥐"},
    {w:"दोपहर का खाना",t:"Lunch",p:"do-pa-har kaa khaa-naa",e:"🍽"}, {w:"रात का खाना",t:"Dinner",p:"raat kaa khaa-naa",e:"🌙"},
    {w:"रेस्टोरेंट",t:"Restaurant",p:"res-to-rent",e:"🍴"}, {w:"मेज़",t:"Table",p:"mez",e:"🪑"},
    {w:"दरवाज़ा",t:"Door",p:"dar-vaa-zaa",e:"🚪"}, {w:"खिड़की",t:"Window",p:"khir-kee",e:"🪟"},
    {w:"कमरा",t:"Room",p:"kam-raa",e:"🛏"}, {w:"रसोई",t:"Kitchen",p:"ra-so-ee",e:"🍳"},
    {w:"बाथरूम",t:"Bathroom",p:"baath-room",e:"🛁"}, {w:"बिस्तर",t:"Bed",p:"bis-tar",e:"🛌"},
    {w:"कुर्सी",t:"Chair",p:"kur-see",e:"🪑"}, {w:"चाबी",t:"Key",p:"chaa-bee",e:"🔑"},
    {w:"रोशनी",t:"Light",p:"rosh-nee",e:"💡"}, {w:"सड़क",t:"Street/road",p:"sa-rak",e:"🛣"},
    {w:"दुकान",t:"Shop",p:"du-kaan",e:"🏪"}, {w:"बाज़ार",t:"Market",p:"baa-zaar",e:"🛍"},
    {w:"स्कूल",t:"School",p:"skuul",e:"🏫"}, {w:"अस्पताल",t:"Hospital",p:"as-pa-taal",e:"🏥"},
    {w:"मंदिर",t:"Temple",p:"man-dir",e:"🛕"}, {w:"बैंक",t:"Bank",p:"baink",e:"🏦"},
    {w:"दफ़्तर",t:"Office",p:"daf-tar",e:"🏢"}, {w:"स्टेशन",t:"Station",p:"ste-shan",e:"🚉"},
    {w:"हवाई अड्डा",t:"Airport",p:"ha-vaa-ee ad-daa",e:"✈️"}, {w:"होटल",t:"Hotel",p:"ho-tal",e:"🏨"},
    {w:"गाड़ी",t:"Car/vehicle",p:"gaa-ree",e:"🚗"}, {w:"ट्रेन",t:"Train",p:"tren",e:"🚆"},
    {w:"बस",t:"Bus",p:"bas",e:"🚌"}, {w:"हवाई जहाज़",t:"Airplane",p:"ha-vaa-ee ja-haaz",e:"🛩"},
    {w:"साइकिल",t:"Bicycle",p:"saai-kil",e:"🚲"}, {w:"टिकट",t:"Ticket",p:"ti-kat",e:"🎫"},
    {w:"नया",t:"New",p:"na-yaa",e:"✨"}, {w:"पुराना",t:"Old",p:"pu-raa-naa",e:"🏚"},
    {w:"जवान",t:"Young",p:"ja-vaan",e:"🧒"}, {w:"सुंदर",t:"Beautiful",p:"sun-dar",e:"😍"},
    {w:"बदसूरत",t:"Ugly",p:"bad-suu-rat",e:"🫣"}, {w:"गरम",t:"Hot",p:"ga-ram",e:"🔥"},
    {w:"ठंडा",t:"Cold",p:"than-daa",e:"🧊"}, {w:"लंबा",t:"Tall/long",p:"lam-baa",e:"📏"},
    {w:"ऊँचा",t:"High",p:"uun-chaa",e:"📏"}, {w:"नीचा",t:"Low",p:"nee-chaa",e:"📉"},
    {w:"मज़बूत",t:"Strong",p:"maz-buut",e:"💪"}, {w:"कमज़ोर",t:"Weak",p:"kam-zor",e:"🪶"},
    {w:"आसान",t:"Easy",p:"aa-saan",e:"🟢"}, {w:"मुश्किल",t:"Difficult",p:"mush-kil",e:"🔴"},
    {w:"ज़रूरी",t:"Important/necessary",p:"za-ruu-ree",e:"⭐"}, {w:"सही",t:"Correct",p:"sa-hee",e:"✅"},
    {w:"ग़लत",t:"Wrong",p:"ga-lat",e:"❌"}, {w:"सच",t:"True",p:"sach",e:"✔️"},
    {w:"भरा",t:"Full",p:"bha-raa",e:"🈵"}, {w:"ख़ाली",t:"Empty",p:"khaa-lee",e:"🈳"},
    {w:"खुला",t:"Open",p:"khu-laa",e:"🔓"}, {w:"बंद",t:"Closed",p:"band",e:"🔒"},
    {w:"साफ़",t:"Clean",p:"saaf",e:"🧼"}, {w:"गंदा",t:"Dirty",p:"gan-daa",e:"🧹"},
    {w:"अमीर",t:"Rich",p:"a-meer",e:"💎"}, {w:"ग़रीब",t:"Poor",p:"ga-reeb",e:"🪙"},
    {w:"आज़ाद",t:"Free",p:"aa-zaad",e:"🕊"}, {w:"व्यस्त",t:"Busy",p:"vyast",e:"📵"},
    {w:"तैयार",t:"Ready",p:"tai-yaar",e:"🚦"}, {w:"सुरक्षित",t:"Safe",p:"su-rak-shit",e:"🛡"},
    {w:"एक जैसा",t:"Same",p:"ek jai-saa",e:"🟰"}, {w:"अलग",t:"Different",p:"a-lag",e:"🔀"},
    {w:"महंगा",t:"Expensive",p:"ma-han-gaa",e:"💸"}, {w:"सस्ता",t:"Cheap",p:"sas-taa",e:"🏷"},
    {w:"स्वस्थ",t:"Healthy",p:"svasth",e:"🥦"}, {w:"बीमार",t:"Sick",p:"bee-maar",e:"🤒"},
    {w:"सूरज",t:"Sun",p:"suu-raj",e:"☀️"}, {w:"चाँद",t:"Moon",p:"chaand",e:"🌙"},
    {w:"तारा",t:"Star",p:"taa-raa",e:"⭐"}, {w:"आसमान",t:"Sky",p:"aas-maan",e:"🌤"},
    {w:"समुद्र",t:"Sea",p:"sa-mu-dra",e:"🌊"}, {w:"पहाड़",t:"Mountain",p:"pa-haar",e:"⛰"},
    {w:"नदी",t:"River",p:"na-dee",e:"🏞"}, {w:"पेड़",t:"Tree",p:"per",e:"🌳"},
    {w:"फूल",t:"Flower",p:"phuul",e:"🌸"}, {w:"बारिश",t:"Rain",p:"baa-rish",e:"🌧"},
    {w:"बर्फ़",t:"Snow/ice",p:"barf",e:"❄️"}, {w:"हवा",t:"Wind/air",p:"ha-vaa",e:"💨"},
    {w:"आग",t:"Fire",p:"aag",e:"🔥"}, {w:"धरती",t:"Earth",p:"dhar-tee",e:"🌍"},
    {w:"मौसम",t:"Weather",p:"mau-sam",e:"🌦"}, {w:"चीज़",t:"Thing",p:"cheez",e:"📦"},
    {w:"ज़िंदगी",t:"Life",p:"zin-da-gee",e:"🌱"}, {w:"दुनिया",t:"World",p:"du-ni-yaa",e:"🌎"},
    {w:"देश",t:"Country",p:"desh",e:"🗺"}, {w:"जगह",t:"Place",p:"ja-gah",e:"📍"},
    {w:"हिस्सा",t:"Part",p:"his-saa",e:"🧩"}, {w:"बार",t:"Time (occasion)",p:"baar",e:"🔁"},
    {w:"नाम",t:"Name",p:"naam",e:"🏷"}, {w:"शब्द",t:"Word",p:"shabd",e:"🔤"},
    {w:"सवाल",t:"Question",p:"sa-vaal",e:"❓"}, {w:"जवाब",t:"Answer",p:"ja-vaab",e:"💬"},
    {w:"समस्या",t:"Problem",p:"sa-mas-yaa",e:"⚠️"}, {w:"विचार",t:"Idea/thought",p:"vi-chaar",e:"💡"},
    {w:"कहानी",t:"Story",p:"ka-haa-nee",e:"📜"}, {w:"संगीत",t:"Music",p:"san-geet",e:"🎵"},
    {w:"फ़िल्म",t:"Movie",p:"film",e:"🎬"}, {w:"फ़ोटो",t:"Photo",p:"fo-to",e:"📷"},
    {w:"फ़ोन",t:"Phone",p:"fon",e:"📱"}, {w:"खेल",t:"Game/sport",p:"khel",e:"🎲"},
    {w:"क्रिकेट",t:"Cricket",p:"kri-ket",e:"🏏"}, {w:"फुटबॉल",t:"Football",p:"fut-bol",e:"⚽"},
    {w:"सुप्रभात",t:"Good morning",p:"su-pra-bhaat",e:"🌅"}, {w:"शुभ रात्रि",t:"Good night",p:"shubh raa-tri",e:"🌙"},
    {w:"अलविदा",t:"Goodbye",p:"al-vi-daa",e:"👋"}, {w:"फिर मिलेंगे",t:"See you again",p:"phir mi-len-ge",e:"👋"},
    {w:"माफ़ कीजिए",t:"Sorry/excuse me",p:"maaf kee-ji-e",e:"🙇"}, {w:"कोई बात नहीं",t:"No problem",p:"ko-ii baat na-heen",e:"🤲"},
    {w:"ठीक है",t:"Okay",p:"theek hai",e:"👌"}, {w:"मुझे नहीं पता",t:"I don't know",p:"mu-jhe na-heen pa-taa",e:"🤷"},
    {w:"मैं नहीं समझा",t:"I don't understand",p:"main na-heen sam-jhaa",e:"😕"}, {w:"यह कितने का है?",t:"How much is this?",p:"yah kit-ne kaa hai",e:"💶"},
    {w:"कहाँ है?",t:"Where is it?",p:"ka-haan hai",e:"🧭"}, {w:"कितने बजे हैं?",t:"What time is it?",p:"kit-ne ba-je hain",e:"🕐"},
    {w:"मेरा नाम",t:"My name is",p:"me-raa naam",e:"🪪"}, {w:"आपसे मिलकर ख़ुशी हुई",t:"Nice to meet you",p:"aap-se mil-kar khu-shee hu-ee",e:"🤝"},
    {w:"बचाओ!",t:"Help!",p:"ba-chaa-o",e:"🆘"}, {w:"बधाई हो",t:"Congratulations",p:"ba-dhaa-ee ho",e:"🎉"},
    {w:"स्वागत है",t:"Welcome",p:"svaa-gat hai",e:"🎊"}, {w:"चलो",t:"Let's go",p:"cha-lo",e:"🚀"}
  ],
  ru: [
    {w:"Привет",     t:"Hello",       p:"pree-VYET",      e:"🙋"}, {w:"Спасибо",    t:"Thank you",   p:"spa-SEE-ba",     e:"🙏"},
    {w:"Пожалуйста", t:"Please",      p:"pa-ZHAL-sta",    e:"✋"}, {w:"Да",         t:"Yes",         p:"da",             e:"✅"},
    {w:"Нет",        t:"No",          p:"nyet",           e:"❌"}, {w:"Вода",       t:"Water",       p:"va-DA",          e:"💧"},
    {w:"Еда",        t:"Food",        p:"ye-DA",          e:"🍽"}, {w:"Дом",        t:"House",       p:"dom",            e:"🏠"},
    {w:"Друг",       t:"Friend",      p:"droog",          e:"👫"}, {w:"Любовь",     t:"Love",        p:"lyu-BOV",        e:"❤️"},
    {w:"Работа",     t:"Work",        p:"ra-BO-ta",       e:"💼"}, {w:"Деньги",     t:"Money",       p:"DEN-gi",         e:"💰"},
    {w:"Время",      t:"Time",        p:"VRYE-mya",       e:"⏰"}, {w:"Хорошо",     t:"Good",        p:"kha-ra-SHO",     e:"👍"},
    {w:"Плохо",      t:"Bad",         p:"PLO-kha",        e:"👎"}, {w:"Большой",    t:"Big",         p:"bal-SHOY",       e:"🐘"},
    {w:"Маленький",  t:"Small",       p:"MA-len-kiy",     e:"🐭"}, {w:"Быстро",     t:"Fast",        p:"BIS-tra",        e:"🏃"},
    {w:"Медленно",   t:"Slow",        p:"MED-len-na",     e:"🐢"}, {w:"Счастливый", t:"Happy",       p:"shast-LEE-viy",  e:"😊"},
    {w:"Грустный",   t:"Sad",         p:"GRUS-tniy",      e:"😢"}, {w:"Устал",      t:"Tired",       p:"us-TAL",         e:"😴"},
    {w:"Голодный",   t:"Hungry",      p:"ga-LOD-niy",     e:"🤤"}, {w:"Жаждущий",   t:"Thirsty",     p:"ZHAZH-du-shiy",  e:"😮"},
    {w:"Семья",      t:"Family",      p:"sem-YA",         e:"👨‍👩‍👧"}, {w:"Мама",       t:"Mother",      p:"MA-ma",          e:"👩"},
    {w:"Папа",       t:"Father",      p:"PA-pa",          e:"👨"}, {w:"Книга",      t:"Book",        p:"KNEE-ga",        e:"📚"},
    {w:"Город",      t:"City",        p:"GO-rod",         e:"🏙"}, {w:"Пляж",       t:"Beach",       p:"plyazh",         e:"🏖"},
    {w:"Быть",t:"To be",p:"byt",e:"🧍"}, {w:"Мочь",t:"To be able",p:"moch",e:"💪"},
    {w:"Сказать",t:"To say",p:"skah-ZAT",e:"🗣"}, {w:"Говорить",t:"To speak",p:"gah-vah-REET",e:"💬"},
    {w:"Знать",t:"To know",p:"znat",e:"🧠"}, {w:"Хотеть",t:"To want",p:"khah-TYET",e:"🙌"},
    {w:"Делать",t:"To do/make",p:"DYEH-lat",e:"🔨"}, {w:"Видеть",t:"To see",p:"VEE-dyet",e:"👀"},
    {w:"Идти",t:"To go (on foot)",p:"eet-TEE",e:"🚶"}, {w:"Ехать",t:"To go (by transport)",p:"YEH-khat",e:"🚗"},
    {w:"Прийти",t:"To come",p:"preey-TEE",e:"👋"}, {w:"Дать",t:"To give",p:"dat",e:"🎁"},
    {w:"Думать",t:"To think",p:"DOO-mat",e:"💭"}, {w:"Работать",t:"To work",p:"rah-BOH-tat",e:"💼"},
    {w:"Жить",t:"To live",p:"zhyt",e:"🌱"}, {w:"Любить",t:"To love",p:"lyoo-BEET",e:"❤️"},
    {w:"Понимать",t:"To understand",p:"pah-nee-MAT",e:"💡"}, {w:"Найти",t:"To find",p:"nigh-TEE",e:"🔍"},
    {w:"Взять",t:"To take",p:"vzyat",e:"✊"}, {w:"Смотреть",t:"To look/watch",p:"smah-TRYET",e:"👁"},
    {w:"Положить",t:"To put",p:"pah-lah-ZHYT",e:"📥"}, {w:"Верить",t:"To believe",p:"VYEH-reet",e:"🙏"},
    {w:"Принести",t:"To bring",p:"pree-nyes-TEE",e:"🎒"}, {w:"Вернуться",t:"To return",p:"vyer-NOO-tsa",e:"🔙"},
    {w:"Помнить",t:"To remember",p:"POM-neet",e:"🧾"}, {w:"Звонить",t:"To call (phone)",p:"zvah-NEET",e:"📞"},
    {w:"Ждать",t:"To wait",p:"zhdat",e:"⏳"}, {w:"Закончить",t:"To finish",p:"zah-KON-cheet",e:"🏁"},
    {w:"Есть",t:"To eat",p:"yest",e:"🍽"}, {w:"Пить",t:"To drink",p:"peet",e:"🥤"},
    {w:"Спать",t:"To sleep",p:"spat",e:"😴"}, {w:"Открыть",t:"To open",p:"aht-KRYT",e:"🔓"},
    {w:"Закрыть",t:"To close",p:"zah-KRYT",e:"🔒"}, {w:"Купить",t:"To buy",p:"koo-PEET",e:"🛒"},
    {w:"Платить",t:"To pay",p:"plah-TEET",e:"💳"}, {w:"Читать",t:"To read",p:"chee-TAT",e:"📖"},
    {w:"Писать",t:"To write",p:"pee-SAT",e:"✍️"}, {w:"Слушать",t:"To listen",p:"SLOO-shat",e:"🎧"},
    {w:"Играть",t:"To play",p:"ee-GRAT",e:"🎮"}, {w:"Бежать",t:"To run",p:"bye-ZHAT",e:"🏃"},
    {w:"Ходить",t:"To walk",p:"khah-DEET",e:"🚶"}, {w:"Помогать",t:"To help",p:"pah-mah-GAT",e:"🆘"},
    {w:"Учиться",t:"To study/learn",p:"oo-CHEE-tsa",e:"📚"}, {w:"Учить",t:"To teach/learn",p:"oo-CHEET",e:"🎓"},
    {w:"Начать",t:"To begin",p:"nah-CHAT",e:"▶️"}, {w:"Искать",t:"To search",p:"ees-KAT",e:"🔎"},
    {w:"Использовать",t:"To use",p:"ees-POL-zah-vat",e:"🛠"}, {w:"Спросить",t:"To ask",p:"sprah-SEET",e:"❓"},
    {w:"Ответить",t:"To answer",p:"aht-VYEH-teet",e:"💬"}, {w:"Выйти",t:"To go out",p:"VY-tee",e:"🚪"},
    {w:"Войти",t:"To enter",p:"vigh-TEE",e:"➡️"}, {w:"Потерять",t:"To lose",p:"pah-tye-RYAT",e:"🫥"},
    {w:"Выиграть",t:"To win",p:"VY-ee-grat",e:"🏆"}, {w:"Попробовать",t:"To try",p:"pah-PROH-bah-vat",e:"🎯"},
    {w:"Изменить",t:"To change",p:"eez-mye-NEET",e:"🔄"}, {w:"Стоять",t:"To stand",p:"stah-YAT",e:"🧍"},
    {w:"Сидеть",t:"To sit",p:"see-DYET",e:"🪑"}, {w:"Чувствовать",t:"To feel",p:"CHOOST-vah-vat",e:"💗"},
    {w:"Я",t:"I",p:"ya",e:"🙋"}, {w:"Ты",t:"You",p:"ty",e:"👉"},
    {w:"Он",t:"He",p:"on",e:"👨"}, {w:"Она",t:"She",p:"ah-NAH",e:"👩"},
    {w:"Мы",t:"We",p:"my",e:"👥"}, {w:"Вы",t:"You (formal/plural)",p:"vy",e:"👫"},
    {w:"Они",t:"They",p:"ah-NEE",e:"👪"}, {w:"Это",t:"This/it",p:"EH-tah",e:"👇"},
    {w:"Всё",t:"Everything",p:"vsyo",e:"🌐"}, {w:"Ничего",t:"Nothing",p:"nee-chee-VOH",e:"🚫"},
    {w:"Что-то",t:"Something",p:"SHTOH-tah",e:"❔"}, {w:"Кто-то",t:"Someone",p:"KTOH-tah",e:"👤"},
    {w:"Никто",t:"Nobody",p:"neek-TOH",e:"🙅"}, {w:"Много",t:"A lot",p:"MNOH-gah",e:"📈"},
    {w:"Мало",t:"Little/few",p:"MAH-lah",e:"🤏"}, {w:"Слишком",t:"Too much",p:"SLEESH-kahm",e:"🛑"},
    {w:"Больше",t:"More",p:"BOL-sheh",e:"➕"}, {w:"Меньше",t:"Less",p:"MYEN-sheh",e:"➖"},
    {w:"Тоже",t:"Also",p:"TOH-zheh",e:"➕"}, {w:"Всегда",t:"Always",p:"vseeg-DAH",e:"♾️"},
    {w:"Никогда",t:"Never",p:"nee-kahg-DAH",e:"🚫"}, {w:"Уже",t:"Already",p:"oo-ZHEH",e:"✔️"},
    {w:"Ещё",t:"Still/more",p:"ye-SHYO",e:"🔁"}, {w:"Сейчас",t:"Now",p:"see-CHAS",e:"⏱"},
    {w:"Потом",t:"Later",p:"pah-TOM",e:"⏭"}, {w:"Раньше",t:"Before/earlier",p:"RAN-sheh",e:"⏮"},
    {w:"Здесь",t:"Here",p:"zdyes",e:"📍"}, {w:"Там",t:"There",p:"tam",e:"🗺"},
    {w:"Где",t:"Where",p:"gdyeh",e:"🧭"}, {w:"Когда",t:"When",p:"kahg-DAH",e:"📅"},
    {w:"Почему",t:"Why",p:"pah-chee-MOO",e:"❓"}, {w:"Как",t:"How",p:"kak",e:"🤔"},
    {w:"Кто",t:"Who",p:"ktoh",e:"👤"}, {w:"Что",t:"What",p:"shtoh",e:"❔"},
    {w:"Какой",t:"Which/what kind",p:"kah-KOY",e:"🔀"}, {w:"Сколько",t:"How much",p:"SKOL-kah",e:"⚖️"},
    {w:"Один",t:"One",p:"ah-DEEN",e:"1️⃣"}, {w:"Два",t:"Two",p:"dvah",e:"2️⃣"},
    {w:"Три",t:"Three",p:"tree",e:"3️⃣"}, {w:"Четыре",t:"Four",p:"chee-TY-ree",e:"4️⃣"},
    {w:"Пять",t:"Five",p:"pyat",e:"5️⃣"}, {w:"Шесть",t:"Six",p:"shest",e:"6️⃣"},
    {w:"Семь",t:"Seven",p:"syem",e:"7️⃣"}, {w:"Восемь",t:"Eight",p:"VOH-syem",e:"8️⃣"},
    {w:"Девять",t:"Nine",p:"DYEH-vyat",e:"9️⃣"}, {w:"Десять",t:"Ten",p:"DYEH-syat",e:"🔟"},
    {w:"Одиннадцать",t:"Eleven",p:"ah-DEEN-nah-tsat",e:"🔢"}, {w:"Двенадцать",t:"Twelve",p:"dvee-NAH-tsat",e:"🔢"},
    {w:"Двадцать",t:"Twenty",p:"DVAH-tsat",e:"🔢"}, {w:"Тридцать",t:"Thirty",p:"TREE-tsat",e:"🔢"},
    {w:"Сорок",t:"Forty",p:"SOH-rahk",e:"🔢"}, {w:"Пятьдесят",t:"Fifty",p:"pee-dee-SYAT",e:"🔢"},
    {w:"Сто",t:"Hundred",p:"stoh",e:"💯"}, {w:"Тысяча",t:"Thousand",p:"TY-see-chah",e:"🔢"},
    {w:"Первый",t:"First",p:"PYER-vy",e:"🥇"}, {w:"Второй",t:"Second",p:"ftah-ROY",e:"🥈"},
    {w:"Последний",t:"Last",p:"pahs-LYED-nee",e:"🔚"}, {w:"Понедельник",t:"Monday",p:"pah-nee-DYEL-neek",e:"📅"},
    {w:"Вторник",t:"Tuesday",p:"FTOR-neek",e:"📅"}, {w:"Среда",t:"Wednesday",p:"sree-DAH",e:"📅"},
    {w:"Четверг",t:"Thursday",p:"cheet-VYERK",e:"📅"}, {w:"Пятница",t:"Friday",p:"PYAT-nee-tsah",e:"📅"},
    {w:"Суббота",t:"Saturday",p:"soo-BOH-tah",e:"📅"}, {w:"Воскресенье",t:"Sunday",p:"vahs-kree-SYEN-yeh",e:"📅"},
    {w:"Сегодня",t:"Today",p:"see-VOD-nya",e:"📆"}, {w:"Завтра",t:"Tomorrow",p:"ZAF-trah",e:"🌅"},
    {w:"Вчера",t:"Yesterday",p:"fchee-RAH",e:"🌇"}, {w:"Неделя",t:"Week",p:"nee-DYEH-lya",e:"🗓"},
    {w:"Месяц",t:"Month",p:"MYEH-syats",e:"🗓"}, {w:"Год",t:"Year",p:"got",e:"🎆"},
    {w:"День",t:"Day",p:"dyen",e:"☀️"}, {w:"Ночь",t:"Night",p:"noch",e:"🌙"},
    {w:"Утро",t:"Morning",p:"OO-trah",e:"🌄"}, {w:"Вечер",t:"Evening",p:"VYEH-cher",e:"🌆"},
    {w:"Час",t:"Hour",p:"chas",e:"🕐"}, {w:"Минута",t:"Minute",p:"mee-NOO-tah",e:"⏱"},
    {w:"Январь",t:"January",p:"yan-VAR",e:"❄️"}, {w:"Февраль",t:"February",p:"feev-RAL",e:"💘"},
    {w:"Март",t:"March",p:"mart",e:"🌸"}, {w:"Апрель",t:"April",p:"ah-PRYEL",e:"🌷"},
    {w:"Май",t:"May",p:"my",e:"🌼"}, {w:"Июнь",t:"June",p:"ee-YOON",e:"☀️"},
    {w:"Июль",t:"July",p:"ee-YOOL",e:"🏖"}, {w:"Август",t:"August",p:"AV-goost",e:"🌞"},
    {w:"Сентябрь",t:"September",p:"seen-TYABR",e:"🍂"}, {w:"Октябрь",t:"October",p:"ahk-TYABR",e:"🎃"},
    {w:"Ноябрь",t:"November",p:"nah-YABR",e:"🌧"}, {w:"Декабрь",t:"December",p:"dee-KABR",e:"🎄"},
    {w:"Красный",t:"Red",p:"KRAS-ny",e:"🔴"}, {w:"Синий",t:"Blue",p:"SEE-nee",e:"🔵"},
    {w:"Зелёный",t:"Green",p:"zee-LYO-ny",e:"🟢"}, {w:"Жёлтый",t:"Yellow",p:"ZHOL-ty",e:"🟡"},
    {w:"Чёрный",t:"Black",p:"CHOR-ny",e:"⚫"}, {w:"Белый",t:"White",p:"BYEH-ly",e:"⚪"},
    {w:"Серый",t:"Grey",p:"SYEH-ry",e:"🩶"}, {w:"Коричневый",t:"Brown",p:"kah-REECH-nee-vy",e:"🟤"},
    {w:"Розовый",t:"Pink",p:"ROH-zah-vy",e:"🌸"}, {w:"Оранжевый",t:"Orange",p:"ah-RAN-zheh-vy",e:"🟠"},
    {w:"Фиолетовый",t:"Purple",p:"fee-ah-LYEH-tah-vy",e:"🟣"}, {w:"Сын",t:"Son",p:"syn",e:"👦"},
    {w:"Дочь",t:"Daughter",p:"doch",e:"👧"}, {w:"Брат",t:"Brother",p:"brat",e:"👬"},
    {w:"Сестра",t:"Sister",p:"sees-TRAH",e:"👭"}, {w:"Дедушка",t:"Grandfather",p:"DYEH-doosh-kah",e:"👴"},
    {w:"Бабушка",t:"Grandmother",p:"BAH-boosh-kah",e:"👵"}, {w:"Дядя",t:"Uncle",p:"DYA-dya",e:"👨"},
    {w:"Тётя",t:"Aunt",p:"TYO-tya",e:"👩"}, {w:"Муж",t:"Husband",p:"moosh",e:"🤵"},
    {w:"Жена",t:"Wife",p:"zheh-NAH",e:"👰"}, {w:"Ребёнок",t:"Child",p:"ree-BYO-nahk",e:"👶"},
    {w:"Мальчик",t:"Boy",p:"MAL-cheek",e:"🧑"}, {w:"Девочка",t:"Girl",p:"DYEH-vahch-kah",e:"👧"},
    {w:"Мужчина",t:"Man",p:"moo-SHCHEE-nah",e:"👨"}, {w:"Женщина",t:"Woman",p:"ZHEN-shchee-nah",e:"👩"},
    {w:"Люди",t:"People",p:"LYOO-dee",e:"👥"}, {w:"Человек",t:"Person",p:"chee-lah-VYEK",e:"👤"},
    {w:"Голова",t:"Head",p:"gah-lah-VAH",e:"🗣"}, {w:"Глаз",t:"Eye",p:"glas",e:"👁"},
    {w:"Рука",t:"Hand/arm",p:"roo-KAH",e:"✋"}, {w:"Нога",t:"Leg/foot",p:"nah-GAH",e:"🦵"},
    {w:"Сердце",t:"Heart",p:"SYER-tseh",e:"❤️"}, {w:"Рот",t:"Mouth",p:"rot",e:"👄"},
    {w:"Нос",t:"Nose",p:"nos",e:"👃"}, {w:"Ухо",t:"Ear",p:"OO-khah",e:"👂"},
    {w:"Волосы",t:"Hair",p:"VOH-lah-sy",e:"💇"}, {w:"Лицо",t:"Face",p:"lee-TSOH",e:"🙂"},
    {w:"Палец",t:"Finger",p:"PAH-lyets",e:"👆"}, {w:"Спина",t:"Back",p:"spee-NAH",e:"🧍"},
    {w:"Хлеб",t:"Bread",p:"khlyep",e:"🍞"}, {w:"Молоко",t:"Milk",p:"mah-lah-KOH",e:"🥛"},
    {w:"Вино",t:"Wine",p:"vee-NOH",e:"🍷"}, {w:"Пиво",t:"Beer",p:"PEE-vah",e:"🍺"},
    {w:"Кофе",t:"Coffee",p:"KOH-fye",e:"☕"}, {w:"Чай",t:"Tea",p:"chigh",e:"🍵"},
    {w:"Мясо",t:"Meat",p:"MYA-sah",e:"🥩"}, {w:"Рыба",t:"Fish",p:"RY-bah",e:"🐟"},
    {w:"Курица",t:"Chicken",p:"KOO-ree-tsah",e:"🍗"}, {w:"Рис",t:"Rice",p:"rees",e:"🍚"},
    {w:"Макароны",t:"Pasta",p:"mah-kah-ROH-ny",e:"🍝"}, {w:"Сыр",t:"Cheese",p:"syr",e:"🧀"},
    {w:"Яйцо",t:"Egg",p:"yigh-TSOH",e:"🥚"}, {w:"Фрукты",t:"Fruit",p:"FROOK-ty",e:"🍎"},
    {w:"Яблоко",t:"Apple",p:"YAB-lah-kah",e:"🍏"}, {w:"Банан",t:"Banana",p:"bah-NAN",e:"🍌"},
    {w:"Овощи",t:"Vegetables",p:"OH-vah-shchee",e:"🥦"}, {w:"Помидор",t:"Tomato",p:"pah-mee-DOR",e:"🍅"},
    {w:"Картошка",t:"Potato",p:"kar-TOSH-kah",e:"🥔"}, {w:"Салат",t:"Salad",p:"sah-LAT",e:"🥗"},
    {w:"Сахар",t:"Sugar",p:"SAH-khar",e:"🍬"}, {w:"Соль",t:"Salt",p:"sol",e:"🧂"},
    {w:"Масло",t:"Butter/oil",p:"MAS-lah",e:"🧈"}, {w:"Торт",t:"Cake",p:"tort",e:"🍰"},
    {w:"Мороженое",t:"Ice cream",p:"mah-ROH-zheh-nah-yeh",e:"🍨"}, {w:"Суп",t:"Soup",p:"soop",e:"🍲"},
    {w:"Завтрак",t:"Breakfast",p:"ZAF-trahk",e:"🥐"}, {w:"Обед",t:"Lunch",p:"ah-BYET",e:"🍽"},
    {w:"Ужин",t:"Dinner",p:"OO-zhyn",e:"🌙"}, {w:"Ресторан",t:"Restaurant",p:"rees-tah-RAN",e:"🍴"},
    {w:"Стол",t:"Table",p:"stol",e:"🪑"}, {w:"Дверь",t:"Door",p:"dvyer",e:"🚪"},
    {w:"Окно",t:"Window",p:"ahk-NOH",e:"🪟"}, {w:"Комната",t:"Room",p:"KOM-nah-tah",e:"🛏"},
    {w:"Кухня",t:"Kitchen",p:"KOOKH-nya",e:"🍳"}, {w:"Ванная",t:"Bathroom",p:"VAN-nah-yah",e:"🛁"},
    {w:"Кровать",t:"Bed",p:"krah-VAT",e:"🛌"}, {w:"Стул",t:"Chair",p:"stool",e:"🪑"},
    {w:"Ключ",t:"Key",p:"klyooch",e:"🔑"}, {w:"Свет",t:"Light",p:"svyet",e:"💡"},
    {w:"Улица",t:"Street",p:"OO-lee-tsah",e:"🛣"}, {w:"Магазин",t:"Shop",p:"mah-gah-ZEEN",e:"🏪"},
    {w:"Рынок",t:"Market",p:"RY-nahk",e:"🛍"}, {w:"Школа",t:"School",p:"SHKOH-lah",e:"🏫"},
    {w:"Больница",t:"Hospital",p:"bahl-NEE-tsah",e:"🏥"}, {w:"Церковь",t:"Church",p:"TSER-kahf",e:"⛪"},
    {w:"Банк",t:"Bank",p:"bank",e:"🏦"}, {w:"Офис",t:"Office",p:"OH-fees",e:"🏢"},
    {w:"Вокзал",t:"Station",p:"vahk-ZAL",e:"🚉"}, {w:"Аэропорт",t:"Airport",p:"ah-eh-rah-PORT",e:"✈️"},
    {w:"Гостиница",t:"Hotel",p:"gahs-TEE-nee-tsah",e:"🏨"}, {w:"Машина",t:"Car",p:"mah-SHY-nah",e:"🚗"},
    {w:"Поезд",t:"Train",p:"POH-yest",e:"🚆"}, {w:"Автобус",t:"Bus",p:"af-TOH-boos",e:"🚌"},
    {w:"Самолёт",t:"Airplane",p:"sah-mah-LYOT",e:"🛩"}, {w:"Велосипед",t:"Bicycle",p:"vee-lah-see-PYET",e:"🚲"},
    {w:"Билет",t:"Ticket",p:"bee-LYET",e:"🎫"}, {w:"Новый",t:"New",p:"NOH-vy",e:"✨"},
    {w:"Старый",t:"Old",p:"STAH-ry",e:"🏚"}, {w:"Молодой",t:"Young",p:"mah-lah-DOY",e:"🧒"},
    {w:"Красивый",t:"Beautiful",p:"krah-SEE-vy",e:"😍"}, {w:"Горячий",t:"Hot",p:"gah-RYA-chee",e:"🔥"},
    {w:"Холодный",t:"Cold",p:"khah-LOD-ny",e:"🧊"}, {w:"Высокий",t:"Tall/high",p:"vy-SOH-kee",e:"📏"},
    {w:"Низкий",t:"Short/low",p:"NEES-kee",e:"📉"}, {w:"Длинный",t:"Long",p:"DLEEN-ny",e:"📏"},
    {w:"Короткий",t:"Short (length)",p:"kah-ROT-kee",e:"✂️"}, {w:"Сильный",t:"Strong",p:"SEEL-ny",e:"💪"},
    {w:"Слабый",t:"Weak",p:"SLAH-by",e:"🪶"}, {w:"Лёгкий",t:"Easy/light",p:"LYOKH-kee",e:"🟢"},
    {w:"Трудный",t:"Difficult",p:"TROOD-ny",e:"🔴"}, {w:"Важный",t:"Important",p:"VAZH-ny",e:"⭐"},
    {w:"Правильный",t:"Correct",p:"PRAH-veel-ny",e:"✅"}, {w:"Неправильный",t:"Wrong",p:"nee-PRAH-veel-ny",e:"❌"},
    {w:"Настоящий",t:"Real/true",p:"nahs-tah-YA-shchee",e:"✔️"}, {w:"Полный",t:"Full",p:"POL-ny",e:"🈵"},
    {w:"Пустой",t:"Empty",p:"poos-TOY",e:"🈳"}, {w:"Открытый",t:"Open",p:"aht-KRY-ty",e:"🔓"},
    {w:"Закрытый",t:"Closed",p:"zah-KRY-ty",e:"🔒"}, {w:"Чистый",t:"Clean",p:"CHEES-ty",e:"🧼"},
    {w:"Грязный",t:"Dirty",p:"GRYAZ-ny",e:"🧹"}, {w:"Богатый",t:"Rich",p:"bah-GAH-ty",e:"💎"},
    {w:"Бедный",t:"Poor",p:"BYED-ny",e:"🪙"}, {w:"Свободный",t:"Free",p:"svah-BOD-ny",e:"🕊"},
    {w:"Занятый",t:"Busy",p:"ZAH-nya-ty",e:"📵"}, {w:"Готовый",t:"Ready",p:"gah-TOH-vy",e:"🚦"},
    {w:"Безопасный",t:"Safe",p:"bee-zah-PAS-ny",e:"🛡"}, {w:"Одинаковый",t:"Same",p:"ah-dee-NAH-kah-vy",e:"🟰"},
    {w:"Разный",t:"Different",p:"RAZ-ny",e:"🔀"}, {w:"Дорогой",t:"Expensive/dear",p:"dah-rah-GOY",e:"💸"},
    {w:"Дешёвый",t:"Cheap",p:"dee-SHO-vy",e:"🏷"}, {w:"Здоровый",t:"Healthy",p:"zdah-ROH-vy",e:"🥦"},
    {w:"Больной",t:"Sick",p:"bahl-NOY",e:"🤒"}, {w:"Солнце",t:"Sun",p:"SON-tseh",e:"☀️"},
    {w:"Луна",t:"Moon",p:"loo-NAH",e:"🌙"}, {w:"Звезда",t:"Star",p:"zvyez-DAH",e:"⭐"},
    {w:"Небо",t:"Sky",p:"NYEH-bah",e:"🌤"}, {w:"Море",t:"Sea",p:"MOH-ryeh",e:"🌊"},
    {w:"Гора",t:"Mountain",p:"gah-RAH",e:"⛰"}, {w:"Река",t:"River",p:"ree-KAH",e:"🏞"},
    {w:"Дерево",t:"Tree",p:"DYEH-ree-vah",e:"🌳"}, {w:"Цветок",t:"Flower",p:"tsvee-TOK",e:"🌸"},
    {w:"Дождь",t:"Rain",p:"dozhd",e:"🌧"}, {w:"Снег",t:"Snow",p:"snyek",e:"❄️"},
    {w:"Ветер",t:"Wind",p:"VYEH-tyer",e:"💨"}, {w:"Огонь",t:"Fire",p:"ah-GON",e:"🔥"},
    {w:"Земля",t:"Earth",p:"zeem-LYA",e:"🌍"}, {w:"Воздух",t:"Air",p:"VOZ-dookh",e:"🌬"},
    {w:"Вещь",t:"Thing",p:"vyeshch",e:"📦"}, {w:"Жизнь",t:"Life",p:"zhyzn",e:"🌱"},
    {w:"Мир",t:"World/peace",p:"meer",e:"🌎"}, {w:"Страна",t:"Country",p:"strah-NAH",e:"🗺"},
    {w:"Место",t:"Place",p:"MYES-tah",e:"📍"}, {w:"Часть",t:"Part",p:"chast",e:"🧩"},
    {w:"Раз",t:"Time (occasion)",p:"ras",e:"🔁"}, {w:"Имя",t:"Name",p:"EE-mya",e:"🏷"},
    {w:"Слово",t:"Word",p:"SLOH-vah",e:"🔤"}, {w:"Вопрос",t:"Question",p:"vah-PROS",e:"❓"},
    {w:"Ответ",t:"Answer",p:"aht-VYET",e:"💬"}, {w:"Проблема",t:"Problem",p:"prah-BLYEH-mah",e:"⚠️"},
    {w:"Идея",t:"Idea",p:"ee-DYEH-yah",e:"💡"}, {w:"История",t:"Story/history",p:"ees-TOH-ree-yah",e:"📜"},
    {w:"Музыка",t:"Music",p:"MOO-zy-kah",e:"🎵"}, {w:"Фильм",t:"Movie",p:"feelm",e:"🎬"},
    {w:"Фото",t:"Photo",p:"FOH-tah",e:"📷"}, {w:"Телефон",t:"Telephone",p:"tee-lee-FON",e:"📱"},
    {w:"Игра",t:"Game",p:"ee-GRAH",e:"🎲"}, {w:"Спорт",t:"Sport",p:"sport",e:"⚽"},
    {w:"Футбол",t:"Football",p:"foot-BOL",e:"⚽"}, {w:"Доброе утро",t:"Good morning",p:"DOB-rah-yeh OO-trah",e:"🌅"},
    {w:"Добрый день",t:"Good afternoon",p:"DOB-ry dyen",e:"🌤"}, {w:"Добрый вечер",t:"Good evening",p:"DOB-ry VYEH-cher",e:"🌆"},
    {w:"Спокойной ночи",t:"Good night",p:"spah-KOY-nigh NOH-chee",e:"🌙"}, {w:"До свидания",t:"Goodbye",p:"dah svee-DAH-nee-yah",e:"👋"},
    {w:"Пока",t:"Bye (informal)",p:"pah-KAH",e:"👋"}, {w:"Извините",t:"Sorry/excuse me",p:"eez-vee-NEE-tyeh",e:"🙇"},
    {w:"Не за что",t:"You're welcome",p:"NYEH-zah-shtah",e:"🤲"}, {w:"Ладно",t:"Okay/alright",p:"LAD-nah",e:"👌"},
    {w:"Я не знаю",t:"I don't know",p:"ya nyeh ZNAH-yoo",e:"🤷"}, {w:"Я не понимаю",t:"I don't understand",p:"ya nyeh pah-nee-MAH-yoo",e:"😕"},
    {w:"Сколько стоит?",t:"How much is it?",p:"SKOL-kah STOH-eet",e:"💶"}, {w:"Где находится?",t:"Where is it?",p:"gdyeh nah-KHOH-dee-tsa",e:"🧭"},
    {w:"Который час?",t:"What time is it?",p:"kah-TOH-ry chas",e:"🕐"}, {w:"Меня зовут",t:"My name is",p:"mee-NYA zah-VOOT",e:"🪪"},
    {w:"Очень приятно",t:"Nice to meet you",p:"OH-cheen pree-YAT-nah",e:"🤝"}, {w:"Помогите!",t:"Help!",p:"pah-mah-GHEE-tyeh",e:"🆘"},
    {w:"За здоровье!",t:"Cheers!",p:"zah zdah-ROH-vyeh",e:"🥂"}, {w:"Поздравляю",t:"Congratulations",p:"pahz-drahv-LYA-yoo",e:"🎉"},
    {w:"Добро пожаловать",t:"Welcome",p:"dah-BROH pah-ZHAH-lah-vat",e:"🎊"}, {w:"Поехали!",t:"Let's go!",p:"pah-YEH-khah-lee",e:"🚀"}
  ],
};

function shuffle(arr) { return [...arr].sort(()=>Math.random()-0.5); }

function LearningPage({ darkMode=true }) {
  const T=THEME(darkMode);
  const tt=tints(T);
  const [lang, setLang] = useState(()=>load("rslv_lang",""));
  const [history, setHistory] = useState(()=>load("rslv_learn_history",[]));
  const [streak, setStreak] = useState(()=>load("rslv_learn_streak",0));
  const [goal, setGoal] = useState(()=>load("rslv_learn_goal",5));
  const [screen, setScreen] = useState("home");
  const [sessionWords, setSessionWords] = useState([]);
  const [wordIdx, setWordIdx] = useState(0);
  const [puzzleIdx, setPuzzleIdx] = useState(0);
  const [puzzleChoices, setPuzzleChoices] = useState([]);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizChoices, setQuizChoices] = useState([]);
  const [quizScore, setQuizScore] = useState(0);
  const [answer, setAnswer] = useState(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(()=>{ save("rslv_lang",lang); },[lang]);
  useEffect(()=>{ save("rslv_learn_history",history); },[history]);
  useEffect(()=>{ save("rslv_learn_goal",goal); },[goal]);

  const learnedWords = history.map(h=>h.word);
  const allWords = lang ? WORDS[lang] || [] : [];
  const unlearnedWords = allWords.filter(w=>!learnedWords.includes(w.w));
  const selectedLang = LANGUAGES.find(l=>l.code===lang);
  const totalLearned = history.filter(h=>h.lang===lang).length;
  const learnedToday = history.filter(h=>h.lang===lang&&h.date===TODAY()).length;

  const startSession = (size, jumpTo) => {
    const pool = unlearnedWords.length >= size ? unlearnedWords : allWords;
    const words = shuffle(pool).slice(0, size);
    setSessionWords(words);
    setWordIdx(0);
    setFlipped(false);
    if (jumpTo === "puzzle") {
      setPuzzleIdx(0); setAnswer(null);
      const correct = words[0];
      const others = shuffle(allWords.filter(w=>w.w!==correct.w)).slice(0,3);
      setPuzzleChoices(shuffle([correct,...others]));
      setScreen("puzzle");
    } else if (jumpTo === "quiz") {
      setQuizIdx(0); setQuizScore(0); setAnswer(null);
      const correct = words[0];
      const others = shuffle(allWords.filter(w=>w.w!==correct.w)).slice(0,3);
      setQuizChoices(shuffle([correct,...others]));
      setScreen("quiz");
    } else {
      setScreen("session");
    }
  };

  const nextWord = () => {
    if (wordIdx < sessionWords.length - 1) { setWordIdx(i=>i+1); setFlipped(false); }
    else startPuzzle();
  };
  const startPuzzle = () => { setPuzzleIdx(0); setAnswer(null); makePuzzleChoices(0); setScreen("puzzle"); };
  const makePuzzleChoices = (idx) => {
    const correct = sessionWords[idx];
    const others = shuffle(allWords.filter(w=>w.w!==correct.w)).slice(0,3);
    setPuzzleChoices(shuffle([correct,...others]));
  };
  const answerPuzzle = (choice) => {
    if (answer) return;
    const correct = sessionWords[puzzleIdx];
    const isCorrect = choice.w === correct.w;
    setAnswer(isCorrect ? "correct" : "wrong");
    setTimeout(()=>{
      setAnswer(null);
      if (puzzleIdx < sessionWords.length-1) { setPuzzleIdx(i=>{ makePuzzleChoices(i+1); return i+1; }); }
      else startQuiz();
    }, isCorrect ? 600 : 1200);
  };
  const startQuiz = () => { setQuizIdx(0); setQuizScore(0); setAnswer(null); makeQuizChoices(0); setScreen("quiz"); };
  const makeQuizChoices = (idx) => {
    const correct = sessionWords[idx];
    const others = shuffle(allWords.filter(w=>w.w!==correct.w)).slice(0,3);
    setQuizChoices(shuffle([correct,...others]));
  };
  const answerQuiz = (choice) => {
    if (answer) return;
    const correct = sessionWords[quizIdx];
    const isCorrect = choice.w === correct.w;
    setAnswer(isCorrect ? "correct" : "wrong");
    if (isCorrect) setQuizScore(s=>s+1);
    setTimeout(()=>{
      setAnswer(null);
      if (quizIdx < sessionWords.length-1) { setQuizIdx(i=>{ makeQuizChoices(i+1); return i+1; }); }
      else setScreen("review");
    }, isCorrect ? 600 : 1200);
  };
  const finishSession = () => {
    const today = TODAY();
    const newEntries = sessionWords.map(w=>({word:w.w, lang, date:today}));
    setHistory(p=>[...newEntries,...p]);
    const last = load("rslv_learn_last_date","");
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    const yStr = yesterday.toISOString().slice(0,10);
    const newStreak = last===today ? streak : (last===yStr ? streak+1 : 1);
    setStreak(newStreak);
    save("rslv_learn_streak", newStreak);
    save("rslv_learn_last_date", today);
    setScreen("done");
  };

  const Mascot = ({ mood="happy", size=80 }) => {
    const faces = {
      happy:   <><circle cx="35" cy="38" r="6" fill="#7A2E0E"/><circle cx="65" cy="38" r="6" fill="#7A2E0E"/><path d="M30 52 Q50 64 70 52" stroke="#7A2E0E" strokeWidth="3" strokeLinecap="round" fill="none"/></>,
      excited: <><circle cx="35" cy="36" r="7" fill="#7A2E0E"/><circle cx="65" cy="36" r="7" fill="#7A2E0E"/><circle cx="37" cy="34" r="2" fill="white"/><circle cx="67" cy="34" r="2" fill="white"/><path d="M28 52 Q50 68 72 52" stroke="#7A2E0E" strokeWidth="3.5" strokeLinecap="round" fill="none"/></>,
      wrong:   <><circle cx="35" cy="40" r="6" fill="#7A2E0E"/><circle cx="65" cy="40" r="6" fill="#7A2E0E"/><path d="M30 60 Q50 50 70 60" stroke="#7A2E0E" strokeWidth="3" strokeLinecap="round" fill="none"/></>,
      cool:    <><rect x="25" y="34" width="20" height="10" rx="5" fill="#7A2E0E"/><rect x="55" y="34" width="20" height="10" rx="5" fill="#7A2E0E"/><path d="M30 54 Q50 66 70 54" stroke="#7A2E0E" strokeWidth="3" strokeLinecap="round" fill="none"/></>,
    };
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="#FFB374"/>
        <circle cx="50" cy="50" r="46" fill="url(#mg)" opacity="0.35"/>
        <defs><radialGradient id="mg" cx="40%" cy="35%"><stop offset="0%" stopColor="white" stopOpacity="0.65"/><stop offset="100%" stopColor="transparent"/></radialGradient></defs>
        <ellipse cx="12" cy="42" rx="10" ry="14" fill="#FFB374"/>
        <ellipse cx="88" cy="42" rx="10" ry="14" fill="#FFB374"/>
        <ellipse cx="12" cy="42" rx="6" ry="9" fill="#FFD3AB"/>
        <ellipse cx="88" cy="42" rx="6" ry="9" fill="#FFD3AB"/>
        {faces[mood]}
        <circle cx="22" cy="55" r="8" fill="#FF6B6B" opacity="0.28"/>
        <circle cx="78" cy="55" r="8" fill="#FF6B6B" opacity="0.28"/>
      </svg>
    );
  };

  const TopBar = ({ pct, right, grad }) => (
    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
      <Chip n="close" c="ink" T={T} size={34} is={15} onClick={()=>setScreen("home")}/>
      <div style={{ flex:1, height:9, borderRadius:9, background:T.track, overflow:"hidden" }}>
        <div style={{ height:"100%", borderRadius:9, width:pct+"%", background:grad||GRAD.gr, transition:"width 0.4s ease" }}/>
      </div>
      <div style={{ fontSize:12, fontWeight:700, color:T.ink3, fontFamily:FONT, flexShrink:0 }}>{right}</div>
    </div>
  );

  if (screen==="pick") return (
    <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both", fontFamily:FONT }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:22 }}>
        <Chip n="back" c="ink" T={T} size={36} is={17} onClick={()=>setScreen("home")}/>
        <div style={{ fontSize:21, fontWeight:800, color:T.ink }}>Pick a language</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {LANGUAGES.map(l=>(
          <div key={l.code} onClick={()=>{ setLang(l.code); setScreen("home"); }}
            style={{ background:T.card, border: lang===l.code?("1.6px solid "+PAL.or):("1px solid "+T.line), borderRadius:18, padding:"16px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:11, boxShadow:T.shadow }}>
            <div style={{ fontSize:28, lineHeight:1 }}>{l.flag}</div>
            <div style={{ fontSize:13.5, fontWeight:700, color:T.ink }}>{l.name}</div>
          </div>
        ))}
      </div>
    </div>
  );

  if (screen==="session") {
    const word = sessionWords[wordIdx];
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both", fontFamily:FONT }}>
        <TopBar pct={(wordIdx/sessionWords.length)*100} right={(wordIdx+1)+"/"+sessionWords.length} grad={GRAD.gr}/>
        <div style={{ textAlign:"center", marginBottom:14 }}>
          <div style={{ fontSize:11, letterSpacing:"0.14em", color:T.ink3, textTransform:"uppercase", fontWeight:700 }}>Learn this word</div>
        </div>
        <div onClick={()=>setFlipped(f=>!f)}
          style={{ background:flipped?GRAD.gr:T.card, border:flipped?"none":("1px solid "+T.line), borderRadius:28, padding:"34px 22px 30px", textAlign:"center", cursor:"pointer", marginBottom:14, minHeight:270, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, transition:"all 0.3s ease", animation:"cardIn 0.35s ease both", boxShadow:T.shadow }}>
          <div style={{ fontSize:72, lineHeight:1 }}>{word.e}</div>
          <div style={{ fontSize:36, fontWeight:800, color:flipped?"#fff":T.ink, letterSpacing:"-0.02em" }}>{word.w}</div>
          {flipped ? (
            <div style={{ animation:"fadeUp 0.25s ease both" }}>
              <div style={{ fontSize:21, color:"#fff", fontWeight:700, marginBottom:5 }}>{word.t}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,.8)", fontWeight:500, letterSpacing:"0.04em" }}>/{word.p}/</div>
            </div>
          ) : (
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:999, background:T.chip }}>
              <span style={{ fontSize:12, color:T.ink2, fontWeight:600 }}>Tap to reveal</span>
            </div>
          )}
          <div onClick={e=>{ e.stopPropagation(); speak(word.w, lang); }} style={{ marginTop:4, width:42, height:42, borderRadius:"50%", background:flipped?"rgba(255,255,255,.25)":tt.bl.bg, color:flipped?"#fff":tt.bl.fg, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="sound" s={18}/></div>
        </div>
        <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}>
          <Mascot mood={flipped?"excited":"happy"} size={58}/>
        </div>
        <CTA T={T} onClick={nextWord}>{wordIdx < sessionWords.length-1 ? "Got it" : "Start puzzle"}</CTA>
      </div>
    );
  }

  if (screen==="puzzle") {
    const word = sessionWords[puzzleIdx];
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both", fontFamily:FONT }}>
        <TopBar pct={((puzzleIdx+1)/sessionWords.length)*100} right={(puzzleIdx+1)+"/"+sessionWords.length} grad={GRAD.vi}/>
        <div style={{ textAlign:"center", marginBottom:6 }}>
          <div style={{ fontSize:12, fontWeight:700, color:tt.vi.fg, letterSpacing:"0.1em", textTransform:"uppercase" }}>Picture puzzle</div>
          <div style={{ fontSize:13, color:T.ink2, fontWeight:500, marginTop:3 }}>Which word matches this?</div>
        </div>
        <div style={{ textAlign:"center", margin:"18px 0 24px", animation:"cardIn 0.3s ease both" }}>
          <div style={{ fontSize:104, lineHeight:1 }}>{word.e}</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:14 }}>
          {puzzleChoices.map(c=>{
            const isCorrect = c.w===word.w;
            const selected = answer !== null;
            let bg=T.card, border="1px solid "+T.line, color=T.ink, sub=T.ink3;
            if (selected && isCorrect) { bg=tints(T).gr.bg; border="2px solid "+PAL.gr; color=tt.gr.fg; sub=tt.gr.fg; }
            else if (selected) { bg=tints(T).red.bg; border="1px solid transparent"; color=T.ink3; sub=T.ink3; }
            return (
              <div key={c.w} onClick={()=>answerPuzzle(c)}
                style={{ background:bg, border, borderRadius:20, padding:"17px 12px", textAlign:"center", cursor:selected?"default":"pointer", transition:"all 0.2s", boxShadow:selected?"none":T.shadow }}>
                <div style={{ fontSize:15.5, fontWeight:800, color }}>{c.w}</div>
                <div style={{ fontSize:10.5, color:sub, fontWeight:500, marginTop:3 }}>{c.t}</div>
              </div>
            );
          })}
        </div>
        {answer && (
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 15px", borderRadius:18, background: answer==="correct"?tints(T).gr.bg:tints(T).red.bg, animation:"fadeUp 0.2s ease both" }}>
            <Mascot mood={answer==="correct"?"excited":"wrong"} size={42}/>
            <div style={{ fontSize:13.5, fontWeight:700, color: answer==="correct"?tt.gr.fg:PAL.red }}>
              {answer==="correct" ? "Correct! Well done." : "It was: "+word.w+" ("+word.t+")"}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen==="quiz") {
    const word = sessionWords[quizIdx];
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both", fontFamily:FONT }}>
        <TopBar pct={((quizIdx+1)/sessionWords.length)*100} right={quizScore+" right"} grad={GRAD.bl}/>
        <div style={{ textAlign:"center", marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:tt.bl.fg, letterSpacing:"0.1em", textTransform:"uppercase" }}>Quick quiz</div>
          <div style={{ fontSize:13, color:T.ink2, fontWeight:500, marginTop:3 }}>What does this mean?</div>
        </div>
        <div style={{ background:GRAD.bl, borderRadius:26, padding:"34px 22px", textAlign:"center", marginBottom:20, animation:"cardIn 0.3s ease both" }}>
          <div style={{ fontSize:13, color:"rgba(255,255,255,.85)", fontWeight:600, marginBottom:8 }}>{selectedLang && (selectedLang.flag+" "+selectedLang.name)}</div>
          <div style={{ fontSize:42, fontWeight:800, color:"#fff", letterSpacing:"-0.02em" }}>{word.w}</div>
          <div onClick={()=>speak(word.w, lang)} style={{ margin:"14px auto 0", width:42, height:42, borderRadius:"50%", background:"rgba(255,255,255,.25)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="sound" s={18}/></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:11, marginBottom:14 }}>
          {quizChoices.map(c=>{
            const isCorrect = c.w===word.w;
            const selected = answer !== null;
            let bg=T.card, border="1px solid "+T.line, color=T.ink;
            if (selected && isCorrect) { bg=tints(T).gr.bg; border="2px solid "+PAL.gr; color=tt.gr.fg; }
            else if (selected) { bg=tints(T).red.bg; border="1px solid transparent"; color=T.ink3; }
            return (
              <div key={c.w} onClick={()=>answerQuiz(c)}
                style={{ background:bg, border, borderRadius:20, padding:"17px 12px", textAlign:"center", cursor:selected?"default":"pointer", transition:"all 0.2s", boxShadow:selected?"none":T.shadow }}>
                <div style={{ fontSize:14.5, fontWeight:700, color }}>{c.t}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display:"flex", justifyContent:"center", gap:6 }}>
          {sessionWords.map((_,i)=>(
            <div key={i} style={{ width:i===quizIdx?20:8, height:8, borderRadius:8, background: i<quizIdx?PAL.gr:i===quizIdx?PAL.bl:T.track, transition:"all 0.3s" }}/>
          ))}
        </div>
      </div>
    );
  }

  if (screen==="review") {
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both", fontFamily:FONT }}>
        <div style={{ textAlign:"center", marginBottom:18 }}>
          <div style={{ fontSize:12, fontWeight:700, color:tt.gr.fg, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:3 }}>Session review</div>
          <div style={{ fontSize:13, color:T.ink2, fontWeight:500 }}>Tap each word — hear it, then say it out loud</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:9, marginBottom:22 }}>
          {sessionWords.map((w,i)=>(
            <div key={w.w} onClick={()=>speak(w.w,lang)} style={{ display:"flex", alignItems:"center", gap:12, background:T.card, border:"1px solid "+T.line, borderRadius:18, padding:"13px 15px", cursor:"pointer", boxShadow:T.shadow, animation:"fadeUp .35s ease "+(i*0.06)+"s both" }}>
              <div style={{ fontSize:26, lineHeight:1, flexShrink:0 }}>{w.e}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:16, fontWeight:800, color:T.ink }}>{w.w}</div>
                <div style={{ fontSize:11.5, color:T.ink2, fontWeight:500, marginTop:1 }}>{w.t} · /{w.p}/</div>
              </div>
              <div style={{ width:36, height:36, borderRadius:"50%", background:tints(T).bl.bg, color:tt.bl.fg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="sound" s={15}/></div>
            </div>
          ))}
        </div>
        <CTA T={T} onClick={finishSession}>Complete Session</CTA>
      </div>
    );
  }

  if (screen==="done") return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"calc(100vh - 220px)", padding:"0 22px", textAlign:"center", animation:"tabIn 0.3s ease both", fontFamily:FONT }}>
      <div style={{ marginBottom:10, animation:"cardIn 0.5s ease both" }}><Mascot mood="excited" size={96}/></div>
      <div style={{ fontSize:26, fontWeight:800, color:T.ink, marginBottom:6, letterSpacing:"-0.01em" }}>Session complete!</div>
      <div style={{ fontSize:13.5, color:T.ink2, fontWeight:500, marginBottom:24, lineHeight:1.6 }}>
        You learned <strong style={{color:tt.gr.fg}}>{sessionWords.length} {selectedLang && selectedLang.name} words</strong>.<br/>Every word is a step forward.
      </div>
      <div style={{ display:"flex", gap:10, marginBottom:24, width:"100%" }}>
        {[[sessionWords.length,"today","gr"],[totalLearned,"total","bl"],[streak,"day streak","am"]].map(([v,l,c],i)=>(
          <div key={i} style={{ flex:1, background:tints(T)[c].bg, borderRadius:20, padding:"15px 8px" }}>
            <div style={{ fontSize:26, fontWeight:800, color:tints(T)[c].fg, lineHeight:1 }}>{v}</div>
            <div style={{ fontSize:9.5, color:T.ink3, fontWeight:600, marginTop:4 }}>{l}</div>
          </div>
        ))}
      </div>
      <CTA T={T} onClick={()=>setScreen("home")}>Back to Learning</CTA>
    </div>
  );

  const todayList = history.filter(h=>h.lang===lang&&h.date===TODAY());
  return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, animation:"fadeUp 0.4s ease both" }}>
        <div>
          <div style={{ fontSize:26, fontWeight:800, color:T.ink, letterSpacing:"-0.02em" }}>Learning</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, marginTop:2 }}>{allWords.length>0 ? allWords.length+" words in "+(selectedLang?selectedLang.name:"") : "350+ words per language"}</div>
        </div>
        <div onClick={()=>setScreen("pick")} style={{ display:"flex", alignItems:"center", gap:7, background:T.card, border:"1px solid "+T.line, borderRadius:999, padding:"8px 12px 8px 10px", cursor:"pointer", boxShadow:T.shadow }}>
          <span style={{ fontSize:17, lineHeight:1 }}>{selectedLang?selectedLang.flag:""}</span>
          {!selectedLang && <Ic n="globe" s={16} style={{ color:tt.bl.fg }}/>}
          <span style={{ fontSize:12.5, fontWeight:700, color:T.ink }}>{selectedLang?selectedLang.name:"Pick"}</span>
          <Ic n="chev" s={13} style={{ color:T.ink3 }}/>
        </div>
      </div>

      {!lang ? (
        <div onClick={()=>setScreen("pick")} style={{ padding:"46px 22px", textAlign:"center", background:T.card, borderRadius:26, border:"1.5px dashed "+T.dashed, cursor:"pointer", animation:"fadeUp 0.4s ease 0.1s both" }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}><Chip n="globe" c="bl" T={T} size={62} is={30}/></div>
          <div style={{ fontSize:19, fontWeight:800, color:T.ink, marginBottom:6 }}>Choose your language</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, lineHeight:1.6 }}>10 languages available.<br/>{goal} words a day is all you need.</div>
        </div>
      ) : (
        <>
          <div style={{ background:GRAD.gr, borderRadius:26, padding:"18px", marginBottom:12, animation:"fadeUp 0.4s ease 0.04s both" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <Mascot mood={streak>0?"cool":"happy"} size={62}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,.85)" }}>Daily goal</div>
                <div style={{ fontSize:21, fontWeight:800, color:"#fff", marginTop:2 }}>{Math.min(learnedToday,goal)} of {goal} words</div>
              </div>
              <div style={{ textAlign:"center", background:"rgba(255,255,255,.2)", borderRadius:16, padding:"8px 13px" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#fff", lineHeight:1 }}>{streak}</div>
                <div style={{ fontSize:8.5, fontWeight:700, color:"rgba(255,255,255,.85)", marginTop:2 }}>DAY STREAK</div>
              </div>
            </div>
            <div style={{ height:7, borderRadius:6, background:"rgba(255,255,255,.28)", overflow:"hidden", marginTop:12 }}>
              <div style={{ height:"100%", width:Math.min(100,(learnedToday/goal)*100)+"%", background:"#fff", borderRadius:6, transition:"width .4s" }}/>
            </div>
          </div>

          <div style={{ display:"flex", gap:8, marginBottom:14, animation:"fadeUp 0.4s ease 0.08s both" }}>
            {[5,10,15].map(n=>(
              <div key={n} onClick={()=>setGoal(n)} style={{ flex:1, textAlign:"center", background:goal===n?(darkMode?"#fff":PAL.ink):T.card, color:goal===n?(darkMode?PAL.ink:"#fff"):T.ink2, border:"1px solid "+(goal===n?"transparent":T.line), borderRadius:14, padding:"9px 0", fontSize:11.5, fontWeight:700, cursor:"pointer", boxShadow:T.shadow }}>{n} / day</div>
            ))}
          </div>

          <div style={{ background:T.card, border:"1px solid "+T.line, borderRadius:24, padding:"16px", marginBottom:11, display:"flex", alignItems:"center", gap:13, boxShadow:T.shadow, animation:"fadeUp 0.4s ease 0.12s both" }}>
            <Chip n="book" c="gr" T={T} size={46} is={22}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15.5, fontWeight:800, color:T.ink }}>Learn new words</div>
              <div style={{ fontSize:11.5, color:T.ink2, fontWeight:500, marginTop:2 }}>Flip cards · hear it · remember</div>
            </div>
            <div onClick={()=>startSession(goal)} style={{ background:GRAD.gr, color:"#fff", borderRadius:999, padding:"10px 17px", fontSize:12.5, fontWeight:800, cursor:"pointer" }}>Start</div>
          </div>

          <div style={{ background:T.card, border:"1px solid "+T.line, borderRadius:24, padding:"16px", marginBottom:11, display:"flex", alignItems:"center", gap:13, boxShadow:T.shadow, animation:"fadeUp 0.4s ease 0.16s both" }}>
            <Chip n="puzzle" c="vi" T={T} size={46} is={22}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15.5, fontWeight:800, color:T.ink }}>Picture puzzle</div>
              <div style={{ fontSize:11.5, color:T.ink2, fontWeight:500, marginTop:2 }}>See the picture · pick the word</div>
            </div>
            <div onClick={()=>startSession(goal,"puzzle")} style={{ background:GRAD.vi, color:"#fff", borderRadius:999, padding:"10px 17px", fontSize:12.5, fontWeight:800, cursor:"pointer" }}>Play</div>
          </div>

          <div style={{ background:T.card, border:"1px solid "+T.line, borderRadius:24, padding:"16px", marginBottom:16, display:"flex", alignItems:"center", gap:13, boxShadow:T.shadow, animation:"fadeUp 0.4s ease 0.2s both" }}>
            <Chip n="target" c="bl" T={T} size={46} is={22}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15.5, fontWeight:800, color:T.ink }}>Test yourself</div>
              <div style={{ fontSize:11.5, color:T.ink2, fontWeight:500, marginTop:2 }}>Word shown · pick the meaning</div>
            </div>
            <div onClick={()=>startSession(goal,"quiz")} style={{ background:GRAD.bl, color:"#fff", borderRadius:999, padding:"10px 17px", fontSize:12.5, fontWeight:800, cursor:"pointer" }}>Quiz</div>
          </div>

          <div style={{ display:"flex", gap:10, marginBottom:16, animation:"fadeUp 0.4s ease 0.22s both" }}>
            <div style={{ flex:1, background:tints(T).am.bg, borderRadius:18, padding:"13px 10px", display:"flex", alignItems:"center", gap:9 }}>
              <Ic n="flame" s={18} style={{ color:tt.am.fg }}/>
              <div><div style={{ fontSize:16, fontWeight:800, color:tt.am.fg, lineHeight:1 }}>{streak}</div><div style={{ fontSize:9, color:T.ink3, fontWeight:600, marginTop:2 }}>day streak</div></div>
            </div>
            <div style={{ flex:1, background:tints(T).gr.bg, borderRadius:18, padding:"13px 10px", display:"flex", alignItems:"center", gap:9 }}>
              <Ic n="book" s={18} style={{ color:tt.gr.fg }}/>
              <div><div style={{ fontSize:16, fontWeight:800, color:tt.gr.fg, lineHeight:1 }}>{totalLearned}</div><div style={{ fontSize:9, color:T.ink3, fontWeight:600, marginTop:2 }}>words learned</div></div>
            </div>
          </div>

          {todayList.length > 0 && (
            <>
              <SecHead T={T} mt={0}>Learned today · {todayList.length}</SecHead>
              <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:14 }}>
                {todayList.slice(0,10).map((h,i)=>{
                  const wd = allWords.find(w=>w.w===h.word);
                  return (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:11, padding:"10px 13px", background:T.card, border:"1px solid "+T.line, borderRadius:15, boxShadow:T.shadow }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <span style={{ fontSize:13, fontWeight:700, color:T.ink }}>{h.word}</span>
                        {wd && <span style={{ fontSize:11.5, color:T.ink3, fontWeight:500 }}> · {wd.t}</span>}
                      </div>
                      <div onClick={()=>speak(h.word, lang)} style={{ width:30, height:30, borderRadius:"50%", background:tints(T).bl.bg, color:tt.bl.fg, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="sound" s={13}/></div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {history.filter(h=>h.lang===lang).length > 0 && (
            <>
              <SecHead T={T} mt={0}>Recently learned</SecHead>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {history.filter(h=>h.lang===lang).slice(0,14).map((h,i)=>(
                  <div key={i} onClick={()=>speak(h.word, lang)} style={{ padding:"6px 13px", borderRadius:999, background:T.card, border:"1px solid "+T.line, cursor:"pointer", boxShadow:T.shadow }}>
                    <span style={{ fontSize:12, fontWeight:600, color:T.ink2 }}>{h.word}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   COMMUNITY PAGE
───────────────────────────────────────────── */
function CommunityPage({ onModalChange=()=>{} }) {
  const [token, setToken] = useState(()=>localStorage.getItem("rslv_token")||null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("feed"); // feed | challenges | myprofile
  const [posts, setPosts] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [joined, setJoined] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showPost, setShowPost] = useState(false);
  const [showCreateChallenge, setShowCreateChallenge] = useState(false);
  const [commentPost, setCommentPost] = useState(null);

  const authHeaders = { "Authorization": `Bearer ${token}`, "Prefer":"return=representation" };

  useEffect(()=>{
    loadFeed();
    loadChallenges();
    if(token) { loadUser(); }
  },[token]);

  const loadUser = async () => {
    try {
      const u = await getUser(token);
      setUser(u);
      const profiles = await sb(`profiles?id=eq.${u.id}&select=*`, { headers:authHeaders });
      if(profiles&&profiles.length>0) setProfile(profiles[0]);
    } catch {}
  };

  const loadFeed = async () => {
    setLoading(true);
    try {
      const headers = { "apikey":SUPABASE_KEY, ...(token?{ "Authorization":`Bearer ${token}` }:{}) };
      const data = await sb(`posts?select=*,profiles(username,avatar_url,full_name)&order=created_at.desc&limit=30`, { headers });
      let list = data||[];
      // hide posts from users I've blocked
      if(token && user?.id){
        try {
          const blocked = await sb(`blocks?blocker_id=eq.${user.id}&select=blocked_id`, { headers });
          const blockedIds = (blocked||[]).map(b=>b.blocked_id);
          if(blockedIds.length) list = list.filter(p=>!blockedIds.includes(p.user_id));
        } catch {}
      }
      setPosts(list);
    } catch {}
    setLoading(false);
  };

  const loadChallenges = async () => {
    try {
      const headers = { "apikey":SUPABASE_KEY, ...(token?{ "Authorization":`Bearer ${token}` }:{}) };
      const data = await sb(`challenges?select=*,profiles(username)&order=created_at.desc`, { headers });
      setChallenges(data||[]);
      if(user) {
        const j = await sb(`challenge_participants?user_id=eq.${user?.id}&select=challenge_id`, { headers:authHeaders });
        setJoined((j||[]).map(x=>x.challenge_id));
      }
    } catch {}
  };

  const login = async (email, password) => {
    try {
      const data = await sbAuth("token?grant_type=password", { email, password });
      if(data.access_token) {
        localStorage.setItem("rslv_token", data.access_token);
        setToken(data.access_token);
        return true;
      }
      if(data.error_description?.toLowerCase().includes("not confirmed") || data.msg?.toLowerCase().includes("not confirmed"))
        return "Please confirm your email first, or ask the app owner to turn off email confirmation.";
      return data.error_description || data.msg || data.error || "Wrong email or password.";
    } catch(e) {
      return "Connection problem. Check your internet and try again.";
    }
  };

  const signup = async (email, password, username, fullName) => {
    try {
      const data = await sbAuth("signup", { email, password });
      const uid = data.id || data.user?.id;
      const tok = data.access_token || data.session?.access_token;
      // success WITH token = email confirmation is off, user is logged in
      if(uid && tok) {
        localStorage.setItem("rslv_token", tok);
        try {
          await sb(`profiles`, { method:"POST", body:JSON.stringify({ id:uid, username, full_name:fullName }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${tok}`, "Content-Type":"application/json", "Prefer":"return=representation" } });
        } catch {}
        setToken(tok);
        return true;
      }
      // success but NO token = email confirmation is ON
      if(uid && !tok)
        return "Account created! Check your email to confirm, then sign in. (Or ask the app owner to disable email confirmation for instant login.)";
      if(data.msg?.toLowerCase().includes("already") || data.error_description?.toLowerCase().includes("already"))
        return "That email is already registered. Try signing in instead.";
      return data.error_description || data.msg || data.error || "Could not create account.";
    } catch(e) {
      return "Connection problem. Check your internet and try again.";
    }
  };

  const logout = () => {
    localStorage.removeItem("rslv_token");
    setToken(null); setUser(null); setProfile(null);
  };

  const likePost = async (postId, liked) => {
    if(!user) { requireAuth(()=>{}); return; }
    if(liked) {
      await sb(`likes?post_id=eq.${postId}&user_id=eq.${user.id}`, { method:"DELETE", headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}` } });
    } else {
      await sb(`likes`, { method:"POST", body:JSON.stringify({ user_id:user.id, post_id:postId }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}`, "Content-Type":"application/json", "Prefer":"return=representation" } });
    }
    loadFeed();
  };

  const joinLeaveChallenge = async (challengeId, isJoined) => {
    if(!user) { setShowAuth(true); return; }
    if(isJoined) {
      await sb(`challenge_participants?user_id=eq.${user.id}&challenge_id=eq.${challengeId}`, { method:"DELETE", headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}` } });
      setJoined(p=>p.filter(id=>id!==challengeId));
    } else {
      await sb(`challenge_participants`, { method:"POST", body:JSON.stringify({ user_id:user.id, challenge_id:challengeId }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}`, "Content-Type":"application/json", "Prefer":"return=representation" } });
      setJoined(p=>[...p,challengeId]);
    }
    loadChallenges();
  };

  const [showMenu, setShowMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState("foryou");

  const requireAuth = (fn) => {
    if(!token) { onModalChange(true); setShowAuth(true); return; }
    fn();
  };

  if (!token && showAuth) return <AuthScreen onLogin={login} onSignup={signup} onClose={()=>{ onModalChange(false); setShowAuth(false); }} onModalChange={onModalChange}/>;

  return (
    <div style={{ padding:"0 18px 32px" }}>

      {/* header — search + 3 dots */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18, animation:"fadeUp 0.4s ease both" }}>
        <div className="rslv-search-bar" style={{ flex:1, display:"flex", alignItems:"center", gap:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:11, padding:"8px 12px" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search..."
            style={{ flex:1, background:"none", border:"none", outline:"none", color:"rgba(255,255,255,0.7)", fontSize:13, fontFamily:"'Sora',sans-serif" }}/>
        </div>
        <div style={{ position:"relative" }}>
          <button onClick={()=>setShowMenu(m=>!m)} className="rslv-menu-btn" style={{ width:36, height:36, borderRadius:11, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexDirection:"column", gap:3 }}>
            {[0,1,2].map(i=><div key={i} className="rslv-menu-dot" style={{ width:3.5, height:3.5, borderRadius:"50%", background:"rgba(255,255,255,0.5)" }}/>)}
          </button>
          {showMenu && (
            <div onClick={()=>setShowMenu(false)} style={{ position:"fixed", inset:0, zIndex:49 }}/>
          )}
          {showMenu && (
            <div style={{ position:"absolute", top:48, right:0, background:"#1e2235", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"8px", minWidth:170, zIndex:50, boxShadow:"0 8px 32px rgba(0,0,0,0.5)", animation:"fadeIn 0.15s ease both" }}>
              {token ? <>
                <div onClick={()=>{ setTab("myprofile"); setShowMenu(false); }} style={{ padding:"11px 14px", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:600, color:"rgba(255,255,255,0.7)", fontFamily:"'Sora',sans-serif" }}>My Profile</div>
                <div style={{ height:1, background:"rgba(255,255,255,0.06)", margin:"4px 0" }}/>
                <div onClick={()=>{ logout(); setShowMenu(false); }} style={{ padding:"11px 14px", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:600, color:"#ff6b6b", fontFamily:"'Sora',sans-serif" }}>Sign Out</div>
              </> : <>
                <div onClick={()=>{ onModalChange(true); setShowAuth(true); setShowMenu(false); }} style={{ padding:"11px 14px", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:600, color:"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>Sign In / Sign Up</div>
              </>}
            </div>
          )}
        </div>
      </div>

      {/* tabs — clean, no emojis */}
      <div style={{ display:"flex", gap:6, marginBottom:20, background:"rgba(255,255,255,0.04)", borderRadius:16, padding:4 }}>
        {[["feed","Feed"],["challenges","Challenges"],token&&["myprofile","Me"]].filter(Boolean).map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{ flex:1, padding:"9px 4px", borderRadius:12, background:tab===t?"rgba(168,213,194,0.15)":"transparent", border:tab===t?"1px solid rgba(168,213,194,0.25)":"1px solid transparent", color:tab===t?"#A8D5C2":"rgba(255,255,255,0.3)", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer", transition:"all 0.2s" }}>{l}</button>
        ))}
      </div>

      {/* FEED */}
      {tab==="feed" && (
        <div>
          {token && profile && (
            <div onClick={()=>setTab("myprofile")} style={{ display:"flex", alignItems:"center", gap:13, padding:"4px 2px 16px", cursor:"pointer", animation:"fadeUp 0.4s ease both" }}>
              <div style={{ width:52, height:52, borderRadius:16, background: profile?.avatar_url?"transparent":"linear-gradient(135deg,#A8D5C2,#C5B8E8)", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif", flexShrink:0, border:"2px solid rgba(168,213,194,0.3)" }}>
                {profile?.avatar_url ? <img src={profile.avatar_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : (profile?.full_name?.[0]?.toUpperCase()||profile?.username?.[0]?.toUpperCase()||"?")}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:15.5, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:2 }}>{profile?.full_name||profile?.username||"You"}</div>
                <div style={{ fontSize:12.5, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", lineHeight:1.4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{profile?.bio||"Tap to set up your profile"}</div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          )}
          {!token && (
            <div onClick={()=>{ onModalChange(true); setShowAuth(true); }} style={{ background:"linear-gradient(135deg,rgba(168,213,194,0.08),rgba(197,184,232,0.08))", border:"1px solid rgba(168,213,194,0.15)", borderRadius:18, padding:"14px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>Join the community</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>Sign in to post, like and join challenges</div>
              </div>
              <div style={{ fontSize:16, color:"rgba(255,255,255,0.2)" }}>›</div>
            </div>
          )}
          {token && (
            <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:20, padding:"14px 16px", marginBottom:14 }}>
              <div onClick={()=>{ onModalChange(true); setShowPost(true); }} style={{ display:"flex", alignItems:"center", gap:12, cursor:"pointer", marginBottom:12 }}>
                <div style={{ width:38, height:38, borderRadius:12, background: profile?.avatar_url?"transparent":"linear-gradient(135deg,#A8D5C2,#C5B8E8)", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>
                  {profile?.avatar_url ? <img src={profile.avatar_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : (profile?.username?.[0]?.toUpperCase()||"?")}
                </div>
                <div style={{ flex:1, fontSize:13.5, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif", lineHeight:1.4 }}>Share your win, ask for help, or start a challenge...</div>
              </div>
              <div style={{ display:"flex", gap:8, borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:12 }}>
                <button onClick={()=>{ onModalChange(true); setShowPost(true); }} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"9px 0", borderRadius:12, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", color:"rgba(255,255,255,0.55)", fontSize:12.5, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  Photo
                </button>
                <button onClick={()=>requireAuth(()=>{ onModalChange(true); setShowCreateChallenge(true); })} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"9px 0", borderRadius:12, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", color:"rgba(255,255,255,0.55)", fontSize:12.5, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17a2 2 0 01-2 2"/><path d="M14 14.7V17a2 2 0 002 2"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>
                  Challenge
                </button>
              </div>
            </div>
          )}

          {/* Community at a glance */}
          <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:20, padding:"16px", marginBottom:14, animation:"fadeUp 0.4s ease 0.05s both" }}>
            <div style={{ fontSize:13, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:12 }}>Community at a glance</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8 }}>
              {[
                { icon:<Icons.Community/>, val:posts.length>0?`${posts.length}`:"—", label:"Posts", color:"#A8D5C2" },
                { icon:<Icons.Bolt/>, val:challenges.length>0?`${challenges.length}`:"—", label:"Challenges", color:"#C5B8E8" },
                { icon:<Icons.Flame/>, val:posts.reduce((a,p)=>a+(p.likes_count||0),0)||"—", label:"Likes", color:"#F5A623" },
                { icon:<Icons.Star/>, val:joined.length||"—", label:"Joined", color:"#C8E6DA" },
              ].map(({icon,val,label,color})=>(
                <div key={label} style={{ background:"rgba(255,255,255,0.03)", borderRadius:14, padding:"12px 8px", textAlign:"center" }}>
                  <div style={{ color, display:"flex", justifyContent:"center", marginBottom:6, opacity:0.9 }}>{icon}</div>
                  <div style={{ fontSize:17, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{val}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif", marginTop:3 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Feed filter chips */}
          <div style={{ display:"flex", gap:8, marginBottom:16, overflowX:"auto", paddingBottom:2, WebkitOverflowScrolling:"touch" }}>
            {[
              { id:"foryou", label:"For you", icon:"✦" },
              { id:"following", label:"Following", icon:null },
              { id:"trending", label:"Trending", icon:null },
              { id:"new", label:"New", icon:null },
            ].map(({id,label,icon})=>{
              const active = feedFilter===id;
              return (
                <button key={id} onClick={()=>setFeedFilter(id)} style={{ flexShrink:0, display:"flex", alignItems:"center", gap:5, padding:"8px 16px", borderRadius:14, background:active?"rgba(168,213,194,0.12)":"rgba(255,255,255,0.04)", border:active?"1.5px solid rgba(168,213,194,0.4)":"1px solid rgba(255,255,255,0.07)", color:active?"#A8D5C2":"rgba(255,255,255,0.4)", fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer", transition:"all 0.2s" }}>
                  {icon && <span style={{ fontSize:12 }}>{icon}</span>}{label}
                </button>
              );
            })}
          </div>
          {loading && <div style={{ textAlign:"center", padding:32, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", fontSize:13 }}>Loading...</div>}
          {!loading && posts.length===0 && (
            <div style={{ textAlign:"center", padding:"48px 24px" }}>
              <div style={{ fontSize:16, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>No posts yet</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.15)", fontFamily:"'Sora',sans-serif" }}>Be the first to share your win</div>
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {(()=>{
              let list = posts.filter(p=>!searchQuery||p.content.toLowerCase().includes(searchQuery.toLowerCase()));
              if(feedFilter==="trending") list = [...list].sort((a,b)=>(b.likes_count||0)-(a.likes_count||0));
              else if(feedFilter==="new") list = [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
              else if(feedFilter==="following") list = list.filter(p=>followingIds.includes(p.user_id));
              return list;
            })().map((post,i)=>(
              <PostCard key={post.id} post={post} user={user} token={token} onLike={likePost} onComment={()=>requireAuth(()=>{ onModalChange(true); setCommentPost(post); })} onHide={(postId, blockedUserId)=>{ setPosts(prev=>prev.filter(p=> p.id!==postId && (!blockedUserId || p.user_id!==blockedUserId) )); }} delay={i*0.05}/>
            ))}
            {!loading && feedFilter==="following" && followingIds.length===0 && posts.length>0 && (
              <div style={{ textAlign:"center", padding:"32px 24px" }}>
                <div style={{ fontSize:14, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:4 }}>You're not following anyone yet</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.15)", fontFamily:"'Sora',sans-serif" }}>Follow people to see their posts here</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CHALLENGES */}
      {tab==="challenges" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            <div onClick={()=>requireAuth(()=>{ onModalChange(true); setShowCreateChallenge(true); })} style={{ background:"linear-gradient(135deg,#1B4332,#2D6A4F)", borderRadius:20, padding:"18px 14px", cursor:"pointer" }}>
              <div style={{ fontSize:22, marginBottom:8 }}>⚡</div>
              <div style={{ fontSize:14, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:3 }}>Create</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif" }}>Start a challenge</div>
            </div>
            <div onClick={()=>document.getElementById("clist")?.scrollIntoView({behavior:"smooth"})} style={{ background:"linear-gradient(135deg,#1B2A4A,#2D4A8A)", borderRadius:20, padding:"18px 14px", cursor:"pointer" }}>
              <div style={{ fontSize:22, marginBottom:8 }}>🏆</div>
              <div style={{ fontSize:14, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:3 }}>Join</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif" }}>Browse active ones</div>
            </div>
          </div>
          <div id="clist" style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:12 }}>Active Challenges</div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {challenges.filter(c=>!searchQuery||c.title.toLowerCase().includes(searchQuery.toLowerCase())).map((c,i)=>(
              <ChallengeCard key={c.id} challenge={c} isJoined={joined.includes(c.id)} onJoinLeave={()=>requireAuth(()=>joinLeaveChallenge(c.id, joined.includes(c.id)))} delay={i*0.05}/>
            ))}
          </div>
        </div>
      )}

      {/* MY PROFILE */}
      {tab==="myprofile" && token && (
        <ProfileTab profile={profile} user={user} posts={posts.filter(p=>p.user_id===user?.id)} joined={joined} challenges={challenges} onLogout={logout}/>
      )}

      {showAuth && <AuthScreen onLogin={login} onSignup={signup} onClose={()=>{ onModalChange(false); setShowAuth(false); }} onModalChange={onModalChange}/>}
      {showPost && <CreatePostModal user={user} token={token} onPost={()=>{ loadFeed(); onModalChange(false); setShowPost(false); }} onClose={()=>{ onModalChange(false); setShowPost(false); }}/>}
      {showCreateChallenge && <CreateChallengeModal user={user} token={token} onCreated={()=>{ loadChallenges(); onModalChange(false); setShowCreateChallenge(false); }} onClose={()=>{ onModalChange(false); setShowCreateChallenge(false); }}/>}
      {commentPost && <CommentsModal post={commentPost} user={user} token={token} onClose={()=>{ onModalChange(false); setCommentPost(null); }}/>}
    </div>
  );
}

/* ── AUTH SCREEN ── */
function AuthScreen({ onLogin, onSignup, onClose, onModalChange=()=>{} }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if(!email.trim() || !password.trim()) { setError("Please enter email and password."); return; }
    if(mode==="signup" && (!username.trim() || !fullName.trim())) { setError("Please fill in all fields."); return; }
    setError(""); setLoading(true);
    try {
      const result = mode==="login"
        ? await onLogin(email, password)
        : await onSignup(email, password, username, fullName);
      if(result !== true) setError(result);
    } catch(e) {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"calc(100vh - 80px)", display:"flex", flexDirection:"column", padding:"0 24px", paddingTop:60 }}>
      {/* back button */}
      {onClose && (
        <button onClick={onClose} style={{ position:"absolute", top:60, left:18, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18 }}>‹</button>
      )}
      <div style={{ width:"100%", maxWidth:380, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>🌱</div>
          <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>Join the Community</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>Real people. Real progress. No noise.</div>
        </div>

        <div style={{ display:"flex", gap:6, marginBottom:24, background:"rgba(255,255,255,0.04)", borderRadius:16, padding:4 }}>
          {["login","signup"].map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{ flex:1, padding:"10px", borderRadius:12, background:mode===m?"rgba(168,213,194,0.15)":"transparent", border:mode===m?"1px solid rgba(168,213,194,0.25)":"1px solid transparent", color:mode===m?"#A8D5C2":"rgba(255,255,255,0.3)", fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>
              {m==="login"?"Sign In":"Sign Up"}
            </button>
          ))}
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:16 }}>
          {mode==="signup" && <>
            <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" style={{ padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username (e.g. marco_rises)" style={{ padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
          </>}
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={{ padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Password" style={{ padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
        </div>

        {error && <div style={{ fontSize:12, color:"#ff6b6b", fontFamily:"'Sora',sans-serif", marginBottom:12, textAlign:"center" }}>{error}</div>}

        <button onClick={submit} disabled={loading} style={{ width:"100%", padding:"16px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", marginBottom:12 }}>
          {loading?"Loading...":(mode==="login"?"Sign In":"Create Account")}
        </button>
      </div>
    </div>
  );
}

/* ── POST CARD ── */
function PostCard({ post, user, token, onLike, onComment, onHide, delay }) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(post.likes_count||0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = post.profiles;
  const timeAgo = (ts) => {
    const diff = (Date.now() - new Date(ts)) / 1000;
    if(diff < 60) return "just now";
    if(diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if(diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  };
  const catColors = { fitness:"#F5DDD0", finance:"#C8E6DA", learning:"#D8D0F0", lifestyle:"#C8DFF0", default:"rgba(255,255,255,0.06)" };
  const bgColor = catColors[post.category]||catColors.default;
  const isOwn = user && post.user_id === user.id;

  const report = async () => {
    if(!token){ alert("Sign in to report posts."); return; }
    setBusy(true);
    try {
      await sbAuthed("reports", token, { method:"POST", body:JSON.stringify({ reporter_id:user.id, reported_post_id:post.id, reported_user_id:post.user_id, reason:"inappropriate" }) });
      alert("Thanks. This post has been reported and will be reviewed.");
      onHide?.(post.id);
    } catch { alert("Could not report. Try again."); }
    setBusy(false); setMenuOpen(false);
  };

  const block = async () => {
    if(!token){ alert("Sign in to block users."); return; }
    if(!confirm(`Block @${n?.username||"this user"}? You won't see their posts anymore.`)) return;
    setBusy(true);
    try {
      await sbAuthed("blocks", token, { method:"POST", body:JSON.stringify({ blocker_id:user.id, blocked_id:post.user_id }) });
      onHide?.(post.id, post.user_id);
    } catch { alert("Could not block. Try again."); }
    setBusy(false); setMenuOpen(false);
  };

  const deleteOwn = async () => {
    if(!confirm("Delete this post?")) return;
    setBusy(true);
    try {
      await sbAuthed(`posts?id=eq.${post.id}`, token, { method:"DELETE" });
      onHide?.(post.id);
    } catch { alert("Could not delete. Try again."); }
    setBusy(false); setMenuOpen(false);
  };

  return (
    <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:22, overflow:"hidden", animation:`fadeUp 0.4s ease ${delay}s both` }}>
      {post.image_url && <img src={post.image_url} alt="" style={{ width:"100%", maxHeight:300, objectFit:"cover", display:"block" }}/>}
      <div style={{ padding:"14px 16px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ width:38, height:38, borderRadius:12, background: n?.avatar_url?"transparent":"linear-gradient(135deg,#A8D5C2,#C5B8E8)", overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>
            {n?.avatar_url ? <img src={n.avatar_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : (n?.username?.[0]?.toUpperCase()||"?")}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13.5, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:1 }}>{n?.full_name||n?.username||"User"}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>Posted a win · {timeAgo(post.created_at)}</div>
          </div>
          {post.category && (
            <div style={{ padding:"4px 10px", borderRadius:10, background:`${bgColor}30`, border:`1px solid ${bgColor}50`, fontSize:10, fontWeight:700, color:bgColor==="rgba(255,255,255,0.06)"?"rgba(255,255,255,0.4)":bgColor, fontFamily:"'Sora',sans-serif" }}>
              {post.category}
            </div>
          )}
          {/* 3-dot menu */}
          <div style={{ position:"relative" }}>
            <button onClick={()=>setMenuOpen(m=>!m)} style={{ background:"none", border:"none", cursor:"pointer", padding:6, display:"flex", flexDirection:"column", gap:3, alignItems:"center" }}>
              {[0,1,2].map(i=><div key={i} className="rslv-menu-dot" style={{ width:3.5, height:3.5, borderRadius:"50%", background:"rgba(255,255,255,0.4)" }}/>)}
            </button>
            {menuOpen && (
              <>
                <div onClick={()=>setMenuOpen(false)} style={{ position:"fixed", inset:0, zIndex:50 }}/>
                <div style={{ position:"absolute", top:30, right:0, zIndex:51, background:"#1e2235", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:6, minWidth:150, boxShadow:"0 8px 30px rgba(0,0,0,0.4)" }}>
                  {isOwn ? (
                    <button onClick={deleteOwn} disabled={busy} style={{ width:"100%", textAlign:"left", padding:"10px 12px", background:"none", border:"none", cursor:"pointer", color:"#ff6b6b", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:600, borderRadius:8 }}>Delete post</button>
                  ) : (
                    <>
                      <button onClick={report} disabled={busy} style={{ width:"100%", textAlign:"left", padding:"10px 12px", background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.8)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:600, borderRadius:8 }}>🚩 Report post</button>
                      <button onClick={block} disabled={busy} style={{ width:"100%", textAlign:"left", padding:"10px 12px", background:"none", border:"none", cursor:"pointer", color:"#ff6b6b", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:600, borderRadius:8 }}>🚫 Block user</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.85)", fontFamily:"'Sora',sans-serif", lineHeight:1.6, marginBottom:12 }}>
          {post.content.split(/(\s+)/).map((word,wi)=>(
            word.startsWith("#") && word.length>1
              ? <span key={wi} style={{ color:"#7Fd1a8", fontWeight:600 }}>{word}</span>
              : word
          ))}
        </div>
        {/* engagement summary bar */}
        <div style={{ display:"flex", alignItems:"center", gap:14, padding:"10px 0", marginBottom:4, borderTop:"1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:13, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", fontWeight:600 }}>🔥 {likes}</div>
          <div style={{ display:"flex", alignItems:"center", gap:5, fontSize:13, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", fontWeight:600 }}>💬 {post.comments_count||0}</div>
        </div>
        {/* Like / Comment / Share row */}
        <div style={{ display:"flex", alignItems:"center", borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:8 }}>
          <button onClick={()=>{ setLiked(l=>!l); setLikes(x=>liked?x-1:x+1); onLike(post.id, liked); }} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:7, background:"none", border:"none", cursor:"pointer", color:liked?"#ff6b6b":"rgba(255,255,255,0.45)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:700, padding:"8px 0" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill={liked?"#ff6b6b":"none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>
            Like
          </button>
          <div style={{ width:1, height:20, background:"rgba(255,255,255,0.08)" }}/>
          <button onClick={onComment} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:7, background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.45)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:700, padding:"8px 0" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z"/></svg>
            Comment
          </button>
          <div style={{ width:1, height:20, background:"rgba(255,255,255,0.08)" }}/>
          <button onClick={()=>{ if(navigator.share){ navigator.share({ title:"Risolvero", text:post.content }).catch(()=>{}); } else { alert("Sharing not supported on this device."); } }} style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:7, background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.45)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:700, padding:"8px 0" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── CHALLENGE CARD ── */
function ChallengeCard({ challenge, isJoined, onJoinLeave, delay }) {
  const catEmoji = { fitness:"💪", finance:"💰", learning:"📚", lifestyle:"🌿" };
  return (
    <div style={{ borderRadius:22, overflow:"hidden", animation:`fadeUp 0.4s ease ${delay}s both`, position:"relative" }}>
      {challenge.image_url && (
        <div style={{ position:"relative", height:160 }}>
          <img src={challenge.image_url} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom, transparent 30%, rgba(18,20,30,0.95) 100%)" }}/>
          <div style={{ position:"absolute", bottom:12, left:16, right:16 }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", lineHeight:1.2, marginBottom:4 }}>{challenge.title}</div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif" }}>{catEmoji[challenge.category]||"🎯"} {challenge.category}</span>
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif" }}>· {challenge.duration_days} days</span>
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif" }}>· {challenge.participants_count||0} joined</span>
            </div>
          </div>
        </div>
      )}
      {!challenge.image_url && (
        <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:22, padding:"16px" }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:4 }}>{challenge.title}</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>{challenge.duration_days} days · {challenge.participants_count||0} joined</div>
        </div>
      )}
      <div style={{ background:"rgba(18,20,30,0.98)", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", flex:1, paddingRight:12 }}>{challenge.description}</div>
        <button onClick={onJoinLeave} style={{ padding:"9px 18px", borderRadius:14, background:isJoined?"rgba(255,107,107,0.15)":"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:isJoined?"1px solid rgba(255,107,107,0.3)":"none", color:isJoined?"#ff6b6b":"#1a1d2e", fontSize:12, fontWeight:800, fontFamily:"'Sora',sans-serif", cursor:"pointer", flexShrink:0, transition:"all 0.2s" }}>
          {isJoined?"Leave":"Join"}
        </button>
      </div>
    </div>
  );
}

/* ── CREATE POST MODAL ── */
function CreatePostModal({ user, token, onPost, onClose }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("fitness");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const cats = ["fitness","finance","learning","lifestyle"];

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    setUploading(true);
    try {
      const small = await compressImage(file, 1200, 0.82);
      const url = await uploadImage(small, token, "posts");
      setImageUrl(url);
    } catch(err) { alert("Image upload failed. Try again."); }
    setUploading(false);
  };

  const submit = async () => {
    if(!content.trim()) return;
    setLoading(true);
    try {
      await sb(`posts`, { method:"POST", body:JSON.stringify({ user_id:user.id, content:content.trim(), category, image_url:imageUrl||null }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}`, "Content-Type":"application/json", "Prefer":"return=representation" } });
      onPost();
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85dvh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 20px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Share Your Win 🏆</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>
        <textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="What did you achieve today? Share it with the community..." rows={4}
          style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none", resize:"none", marginBottom:14, boxSizing:"border-box" }}/>

        {/* photo upload */}
        {imageUrl ? (
          <div style={{ position:"relative", marginBottom:14, borderRadius:16, overflow:"hidden" }}>
            <img src={imageUrl} alt="" style={{ width:"100%", maxHeight:240, objectFit:"cover", display:"block" }}/>
            <button onClick={()=>setImageUrl("")} style={{ position:"absolute", top:8, right:8, width:30, height:30, borderRadius:"50%", background:"rgba(0,0,0,0.6)", border:"none", color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}><Icons.Close/></button>
          </div>
        ) : (
          <label style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, width:"100%", padding:"14px", background:"rgba(255,255,255,0.04)", border:"1px dashed rgba(255,255,255,0.15)", borderRadius:14, cursor:"pointer", marginBottom:14, color:"rgba(255,255,255,0.5)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:600 }}>
            <input type="file" accept="image/*" onChange={pickImage} style={{ display:"none" }}/>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            {uploading ? "Uploading photo..." : "Add a photo"}
          </label>
        )}

        <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>Category</div>
        <div style={{ display:"flex", gap:8, marginBottom:18, flexWrap:"wrap" }}>
          {cats.map(c=>(
            <button key={c} onClick={()=>setCategory(c)} style={{ padding:"7px 14px", borderRadius:12, background:category===c?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border:category===c?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.08)", color:category===c?"#A8D5C2":"rgba(255,255,255,0.4)", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>{c}</button>
          ))}
        </div>
        <button onClick={submit} disabled={!content.trim()||loading||uploading} style={{ width:"100%", padding:"15px", background:content.trim()&&!uploading?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:content.trim()&&!uploading?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:content.trim()&&!uploading?"pointer":"not-allowed" }}>
          {loading?"Posting...":"Post to Community"}
        </button>
      </div>
    </div>
  );
}

/* ── CREATE CHALLENGE MODAL ── */
function CreateChallengeModal({ user, token, onCreated, onClose }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [days, setDays] = useState("7");
  const [category, setCategory] = useState("fitness");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if(!title.trim()) return;
    setLoading(true);
    try {
      await sb(`challenges`, { method:"POST", body:JSON.stringify({ creator_id:user.id, title:title.trim(), description:desc.trim(), duration_days:parseInt(days)||7, category, image_url:imageUrl||null }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}`, "Content-Type":"application/json", "Prefer":"return=representation" } });
      onCreated();
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85dvh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 20px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Create Challenge ⚡</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>
        {[
          { label:"Challenge Title", val:title, set:setTitle, placeholder:"e.g. 30 Days No Junk Food" },
          { label:"Description", val:desc, set:setDesc, placeholder:"What's the challenge about?" },
          { label:"Photo URL", val:imageUrl, set:setImageUrl, placeholder:"https://... paste an image link" },
        ].map(({label,val,set,placeholder})=>(
          <div key={label} style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>{label}</div>
            <input value={val} onChange={e=>set(e.target.value)} placeholder={placeholder} style={{ width:"100%", padding:"13px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
          </div>
        ))}
        <div style={{ display:"flex", gap:12, marginBottom:14 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>Duration (days)</div>
            <div style={{ display:"flex", gap:6 }}>
              {["3","7","14","30"].map(d=>(
                <button key={d} onClick={()=>setDays(d)} style={{ flex:1, padding:"10px 4px", borderRadius:12, background:days===d?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border:days===d?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.08)", color:days===d?"#A8D5C2":"rgba(255,255,255,0.4)", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>{d}d</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>Category</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {["fitness","finance","learning","lifestyle"].map(c=>(
              <button key={c} onClick={()=>setCategory(c)} style={{ padding:"7px 14px", borderRadius:12, background:category===c?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border:category===c?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.08)", color:category===c?"#A8D5C2":"rgba(255,255,255,0.4)", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>{c}</button>
            ))}
          </div>
        </div>
        <button onClick={submit} disabled={!title.trim()||loading} style={{ width:"100%", padding:"15px", background:title.trim()?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:title.trim()?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:title.trim()?"pointer":"not-allowed" }}>
          {loading?"Creating...":"Create Challenge"}
        </button>
      </div>
    </div>
  );
}

/* ── COMMENTS MODAL ── */
function CommentsModal({ post, user, token, onClose }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(()=>{ loadComments(); },[]);

  const loadComments = async () => {
    try {
      const data = await sb(`comments?post_id=eq.${post.id}&select=*,profiles(username,full_name)&order=created_at.asc`, { headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}` } });
      setComments(data||[]);
    } catch {}
  };

  const addComment = async () => {
    if(!text.trim()||!user) return;
    setLoading(true);
    try {
      await sb(`comments`, { method:"POST", body:JSON.stringify({ user_id:user.id, post_id:post.id, content:text.trim() }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${token}`, "Content-Type":"application/json", "Prefer":"return=representation" } });
      setText(""); loadComments();
    } catch {}
    setLoading(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 32px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"80dvh", display:"flex", flexDirection:"column" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 20px" }}/>
        <div style={{ fontSize:16, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:16 }}>Comments 💬</div>
        <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
          {comments.length===0 && <div style={{ textAlign:"center", padding:24, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", fontSize:13 }}>No comments yet. Be first!</div>}
          {comments.map(c=>(
            <div key={c.id} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
              <div style={{ width:30, height:30, borderRadius:8, background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:"#1a1d2e", flexShrink:0 }}>
                {c.profiles?.username?.[0]?.toUpperCase()||"?"}
              </div>
              <div style={{ background:"rgba(255,255,255,0.05)", borderRadius:"4px 14px 14px 14px", padding:"10px 14px", flex:1 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#A8D5C2", fontFamily:"'Sora',sans-serif", marginBottom:3 }}>{c.profiles?.username}</div>
                <div style={{ fontSize:13, color:"rgba(255,255,255,0.8)", fontFamily:"'Sora',sans-serif" }}>{c.content}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addComment()} placeholder="Write a comment..."
            style={{ flex:1, padding:"12px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:13, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
          <button onClick={addComment} disabled={!text.trim()||loading} style={{ padding:"0 18px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:14, fontSize:13, fontWeight:800, color:"#1a1d2e", cursor:"pointer", fontFamily:"'Sora',sans-serif" }}>
            {loading?"...":"Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── PROFILE TAB ── */
function ProfileTab({ profile, user, posts, joined, challenges, onLogout }) {
  return (
    <div>
      <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:22, padding:"20px", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
          <div style={{ width:56, height:56, borderRadius:16, background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif" }}>
            {profile?.username?.[0]?.toUpperCase()||"?"}
          </div>
          <div>
            <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{profile?.full_name||"Your Name"}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>@{profile?.username||user?.email}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:16 }}>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{posts.length}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>Posts</div>
          </div>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{joined.length}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>Challenges</div>
          </div>
        </div>
      </div>
      <button onClick={onLogout} style={{ width:"100%", padding:"14px", background:"rgba(255,107,107,0.1)", border:"1px solid rgba(255,107,107,0.2)", borderRadius:16, fontSize:14, fontWeight:700, fontFamily:"'Sora',sans-serif", color:"#ff6b6b", cursor:"pointer" }}>
        Sign Out
      </button>
    </div>
  );
}

function Placeholder({ title, sub, emoji, accent }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"calc(100vh - 180px)", gap:14, padding:"0 36px", textAlign:"center" }}>
      <div style={{ fontSize:52 }}>{emoji}</div>
      <div style={{ fontSize:22, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{title}</div>
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", lineHeight:1.7, maxWidth:260 }}>{sub}</div>
      <div style={{ marginTop:6, padding:"9px 22px", borderRadius:30, background:`${accent}15`, border:`1px solid ${accent}30`, fontSize:12, color:accent, fontFamily:"'Sora',sans-serif", letterSpacing:"0.08em", fontWeight:700 }}>Building next →</div>
    </div>
  );
}

const TABS = [
  { id:"home",      label:"Home",      Icon: Icons.Home      },
  { id:"fitness",   label:"Fitness",   Icon: Icons.Fitness   },
  { id:"learning",  label:"Learning",  Icon: Icons.Learning  },
  { id:"finance",   label:"Finance",   Icon: Icons.Finance   },
  // { id:"community", label:"Community", Icon: Icons.Community, upcoming:true },  // removed from bottom nav — restore this line to bring it back
  { id:"profile",   label:"Profile",   Icon: ()=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> },
];

/* ─────────────────────────────────────────────
   FITNESS PAGE
───────────────────────────────────────────── */
const MEALS = [
  { key:"breakfast", label:"Breakfast", emoji:"🌅", hint:"400-600 kcal" },
  { key:"lunch",     label:"Lunch",     emoji:"☀️", hint:"500-700 kcal" },
  { key:"dinner",    label:"Dinner",    emoji:"🌙", hint:"500-700 kcal" },
  { key:"snacks",    label:"Snacks",    emoji:"🍎", hint:"100-200 kcal" },
];

function GoalsModal({ goals, onSave, onClose, T }) {
  const [vals, setVals] = useState({...goals});
  const set = (k,v) => setVals(p=>({...p,[k]:parseInt(v)||0}));
  const rows=[
    {k:"calories", label:"Calories (kcal)", ph:"e.g. 2000"},
    {k:"protein",  label:"Protein (g)",     ph:"e.g. 150"},
    {k:"carbs",    label:"Carbs (g)",       ph:"e.g. 250"},
    {k:"fat",      label:"Fat (g)",         ph:"e.g. 65"},
    {k:"water",    label:"Water (ml)",      ph:"e.g. 2500"},
  ];
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT }}>Daily Goals</div>
        <Chip n="close" c="ink" T={T} size={36} is={16} onClick={onClose}/>
      </div>
      {rows.map(({k,label,ph})=>(
        <Field key={k} T={T} label={label}>
          <input type="number" value={vals[k]||""} onChange={e=>set(k,e.target.value)} placeholder={ph} style={inputStyle(T)}/>
        </Field>
      ))}
      <CTA T={T} onClick={()=>{onSave(vals);onClose();}} style={{ marginTop:4 }}>Save Goals</CTA>
    </Sheet>
  );
}

function ServingModal({ food, meal, onAdd, onClose, T }) {
  const [grams, setGrams] = useState("100");
  const [servings, setServings] = useState("1");
  const [mode, setMode] = useState("grams");
  const per100 = food.nutriments || {};
  const factor = mode==="grams" ? (parseFloat(grams)||0)/100 : (parseFloat(servings)||0);
  const cal  = Math.round((per100["energy-kcal_100g"]||per100["energy-kcal"]||0) * factor);
  const prot = Math.round((per100["proteins_100g"]||per100.proteins||0) * factor * 10)/10;
  const carb = Math.round((per100["carbohydrates_100g"]||per100.carbohydrates||0) * factor * 10)/10;
  const fat  = Math.round((per100["fat_100g"]||per100.fat||0) * factor * 10)/10;
  const submit = () => {
    onAdd({ id:Date.now().toString(), name:food.product_name||food.name, meal, grams: mode==="grams"?parseFloat(grams):parseFloat(servings)*100, cal, prot, carb, fat, date:TODAY() });
    onClose();
  };
  const tt=tints(T);
  const MM=MEALMETA[meal]||MEALMETA.lunch;
  const box=(l,v,fg)=>(
    <div style={{ background:T.chip, borderRadius:14, padding:"11px 6px", textAlign:"center" }}>
      <div style={{ fontSize:15, fontWeight:800, color:fg, fontFamily:FONT, lineHeight:1 }}>{v}</div>
      <div style={{ fontSize:9, color:T.ink3, fontFamily:FONT, fontWeight:600, marginTop:3 }}>{l}</div>
    </div>);
  const qc=(list,val,setter)=>(
    <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
      {list.map(g=>(
        <div key={g} onClick={()=>setter(String(g))} style={{ padding:"6px 13px", borderRadius:999, background: val===String(g)?tints(T).or.bg:T.chip, outline: val===String(g)?("1.5px solid "+PAL.or):"none", cursor:"pointer", fontSize:12, fontWeight:700, color: val===String(g)?PAL.or:T.ink2, fontFamily:FONT }}>{typeof g==="number"&&list[0]===25?g+"g":g+"x"}</div>
      ))}
    </div>);
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:17, fontWeight:800, color:T.ink, fontFamily:FONT, flex:1, paddingRight:12, lineHeight:1.25 }}>{food.product_name||food.name}</div>
        <Chip n="close" c="ink" T={T} size={36} is={16} onClick={onClose}/>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:18 }}>
        {box("Cal",cal,tt.or.fg)}{box("Prot",prot+"g",tt.ro.fg)}{box("Carb",carb+"g",tt.am.fg)}{box("Fat",fat+"g",tt.vi.fg)}
      </div>
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        {["grams","servings"].map(m=>(
          <button key={m} onClick={()=>setMode(m)} style={{ flex:1, padding:"10px", borderRadius:14, background:mode===m?tints(T).or.bg:T.chip, border:mode===m?("1.5px solid "+PAL.or):"1px solid transparent", color:mode===m?PAL.or:T.ink2, fontSize:12.5, fontWeight:700, fontFamily:FONT, cursor:"pointer" }}>
            {m==="grams"?"By Grams":"By Servings"}
          </button>
        ))}
      </div>
      {mode==="grams" ? (
        <Field T={T} label="Grams">
          <input autoFocus type="number" value={grams} onChange={e=>setGrams(e.target.value)} placeholder="100" style={inputStyle(T,true)}/>
          {qc([25,50,75,100,150,200],grams,setGrams)}
        </Field>
      ) : (
        <Field T={T} label="Servings">
          <input autoFocus type="number" value={servings} onChange={e=>setServings(e.target.value)} placeholder="1" style={inputStyle(T,true)}/>
          {qc([0.5,1,1.5,2,3],servings,setServings)}
        </Field>
      )}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7, marginBottom:14 }}>
        <Chip n={MM.icon} c={MM.c} T={T} size={24} is={12} style={{ borderRadius:"50%" }}/>
        <span style={{ fontSize:11.5, color:T.ink3, fontFamily:FONT, fontWeight:600 }}>Adding to {(MEALS.find(m=>m.key===meal)||{}).label}</span>
      </div>
      <CTA T={T} onClick={submit}>Add to Log</CTA>
    </Sheet>
  );
}

function FoodSearchModal({ meal, onSelect, onClose, startWithScan=false, T }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  useEffect(()=>{
    const y = window.scrollY;
    const b = document.body;
    const prev = { position:b.style.position, top:b.style.top, width:b.style.width, overflow:b.style.overflow };
    b.style.position="fixed"; b.style.top=`-${y}px`; b.style.width="100%"; b.style.overflow="hidden";
    return ()=>{
      b.style.position=prev.position; b.style.top=prev.top; b.style.width=prev.width; b.style.overflow=prev.overflow;
      window.scrollTo(0, y);
    };
  }, []);

  const search = async (q) => {
    if (!q.trim()) return;
    setLoading(true);
    setResults([]);
    try {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=10&fields=product_name,nutriments,image_small_url,brands&lc=en`;
      const res = await fetch(url);
      const data = await res.json();
      const filtered = (data.products||[]).filter(p=>p.product_name&&p.nutriments&&(p.nutriments["energy-kcal_100g"]||p.nutriments["energy-kcal"]));
      setResults(filtered);
    } catch(e) {
      setResults([]);
    }
    setLoading(false);
  };

  const lookupBarcode = async (code) => {
    if (!code.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code.trim()}.json`);
      const data = await res.json();
      if (data.status === 1 && data.product) {
        setResults([data.product]);
        setScanning(false);
      } else {
        setResults([]);
      }
    } catch { setResults([]); }
    setLoading(false);
  };

  const startScanner = async () => {
    setScanning(true);
    setResults([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment", width:{ ideal:1280 }, height:{ ideal:720 } } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      if ("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats:["ean_13","ean_8","upc_a","upc_e","code_128","code_39"] });
        const scan = async () => {
          if (!streamRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              stopScanner();
              await lookupBarcode(barcodes[0].rawValue);
              return;
            }
          } catch {}
          rafRef.current = requestAnimationFrame(scan);
        };
        rafRef.current = requestAnimationFrame(scan);
      } else {
        setScanning(false);
        alert("Camera scanning not supported on this browser. Please type the barcode number manually below.");
      }
    } catch(e) {
      setScanning(false);
      alert("Camera permission denied. Please allow camera access.");
    }
  };

  const stopScanner = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current = null; }
    setScanning(false);
  };

  useEffect(()=>{ if(startWithScan) startScanner(); return ()=>stopScanner(); }, []);

  const tt=tints(T);
  return (
    <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:T.overlay, backdropFilter:"blur(3px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:T.sheet, borderRadius:"30px 30px 0 0", padding:"18px 20px calc(40px + env(safe-area-inset-bottom))", animation:"sheetUp 0.3s ease both", maxHeight:"88dvh", display:"flex", flexDirection:"column", boxShadow:T.dark?"none":"0 -8px 40px rgba(23,24,28,.12)" }}>
        <div style={{ width:38, height:4, borderRadius:3, background:T.line2, margin:"0 auto 16px", flexShrink:0 }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT }}>Add Food</div>
          <Chip n="close" c="ink" T={T} size={36} is={16} onClick={onClose}/>
        </div>

        {scanning && (
          <div style={{ marginBottom:14, borderRadius:20, overflow:"hidden", position:"relative", background:"#000", flexShrink:0 }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width:"100%", borderRadius:20, display:"block", maxHeight:200, objectFit:"cover" }}/>
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
              <div style={{ width:200, height:80, border:"2px solid "+PAL.or2, borderRadius:10, boxShadow:"0 0 0 1000px rgba(0,0,0,0.4)" }}/>
            </div>
            <button onClick={stopScanner} style={{ position:"absolute", top:10, right:10, background:"rgba(0,0,0,0.7)", border:"none", borderRadius:999, padding:"7px 14px", color:"#fff", fontSize:12, fontFamily:FONT, fontWeight:700, cursor:"pointer" }}>Stop</button>
            <div style={{ position:"absolute", bottom:10, left:0, right:0, textAlign:"center", fontSize:11, color:"rgba(255,255,255,0.75)", fontFamily:FONT, fontWeight:600 }}>Point camera at barcode</div>
          </div>
        )}

        <div style={{ display:"flex", gap:8, marginBottom:9, flexShrink:0 }}>
          <div style={{ flex:1, display:"flex", alignItems:"center", gap:8, background:T.input, borderRadius:14, padding:"0 12px" }}>
            <Ic n="search" s={16} style={{ color:T.ink3 }}/>
            <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search(query)} placeholder="Search food e.g. chicken, pasta..."
              style={{ flex:1, padding:"13px 0", background:"none", border:"none", color:T.ink, fontSize:13.5, fontWeight:600, fontFamily:FONT, outline:"none" }}/>
          </div>
          <button onClick={()=>search(query)} style={{ padding:"0 16px", background:GRAD.or, border:"none", borderRadius:14, color:"#fff", fontSize:13, fontWeight:700, fontFamily:FONT, cursor:"pointer" }}>Go</button>
          <button onClick={()=>scanning?stopScanner():startScanner()} style={{ width:46, background:scanning?tt.red.bg:T.chip, border:"none", borderRadius:14, color:scanning?PAL.red:T.ink, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="cam" s={19}/></button>
        </div>

        <div style={{ display:"flex", gap:8, marginBottom:12, flexShrink:0 }}>
          <input value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&lookupBarcode(barcodeInput)} placeholder="Or type barcode number..."
            style={{ flex:1, padding:"11px 14px", background:T.input, border:"none", borderRadius:14, color:T.ink, fontSize:12.5, fontWeight:600, fontFamily:FONT, outline:"none" }}/>
          <button onClick={()=>lookupBarcode(barcodeInput)} style={{ padding:"0 14px", background:tt.am.bg, border:"none", borderRadius:14, color:tt.am.fg, fontSize:12, fontWeight:700, fontFamily:FONT, cursor:"pointer" }}>Lookup</button>
        </div>

        <div style={{ overflowY:"auto", flex:1, minHeight:0 }}>
          {loading && (
            <div style={{ textAlign:"center", padding:"28px", color:T.ink3, fontFamily:FONT, fontSize:13, fontWeight:600 }}>
              <div style={{ display:"flex", justifyContent:"center", marginBottom:8 }}><Ic n="search" s={26}/></div>
              Searching...
            </div>
          )}
          {!loading && results.length===0 && query && (
            <div style={{ textAlign:"center", padding:"28px", color:T.ink3, fontFamily:FONT, fontSize:13, fontWeight:500, lineHeight:1.6 }}>
              No results for "{query}"<br/>
              <span style={{fontSize:11}}>Try a different name or use the barcode</span>
            </div>
          )}
          {!loading && results.length===0 && !query && (
            <div style={{ textAlign:"center", padding:"28px", color:T.ink3, fontFamily:FONT, fontSize:13, fontWeight:500, lineHeight:1.7 }}>
              <div style={{ display:"flex", justifyContent:"center", marginBottom:8 }}><Ic n="fork" s={28}/></div>
              Search any food above<br/>
              <span style={{fontSize:11}}>or scan / type a barcode</span>
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {results.map((p,i)=>{
              const n = p.nutriments||{};
              const cal = Math.round(n["energy-kcal_100g"]||n["energy-kcal"]||0);
              return (
                <div key={i} onClick={()=>onSelect(p)} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 13px", background:T.card, border:"1px solid "+T.line, borderRadius:16, cursor:"pointer", boxShadow:T.shadow }}>
                  {p.image_small_url
                    ? <img src={p.image_small_url} alt="" style={{ width:42, height:42, borderRadius:12, objectFit:"cover", flexShrink:0 }}/>
                    : <Chip n="fork" c="am" T={T} size={42} is={19}/>
                  }
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:T.ink, fontFamily:FONT, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.product_name}</div>
                    <div style={{ fontSize:10.5, color:T.ink3, fontFamily:FONT, fontWeight:500, marginTop:2 }}>
                      {cal} kcal · P:{Math.round(n["proteins_100g"]||0)}g · C:{Math.round(n["carbohydrates_100g"]||0)}g · F:{Math.round(n["fat_100g"]||0)}g
                    </div>
                  </div>
                  <Ic n="chev" s={16} style={{ color:T.ink3 }}/>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function FitnessPage({ onModalChange=()=>{}, darkMode=true }) {
  const T=THEME(darkMode);
  const defaultGoals = { calories:2000, protein:150, carbs:250, fat:65, water:2000 };
  const [goals, setGoals]   = useState(()=>load("rslv_fit_goals", defaultGoals));
  const [log, setLog]       = useState(()=>{ const s=load("rslv_fit_log",{date:"",entries:[]}); return s.date===TODAY()?s.entries:[]; });
  const [water, setWater]   = useState(()=>{ const s=load("rslv_fit_water",{date:"",ml:0}); return s.date===TODAY()?s.ml:0; });
  const [showGoals, setShowGoals]   = useState(false);
  const [addingMeal, setAddingMeal] = useState(null);
  const [selectedFood, setSelectedFood] = useState(null);
  const [quickScan, setQuickScan] = useState(false);
  const openModal  = (fn) => { onModalChange(true);  fn(); };
  const closeModal = (fn) => { onModalChange(false); fn(); };
  useEffect(()=>{ save("rslv_fit_goals",goals); },[goals]);
  useEffect(()=>{ save("rslv_fit_log",{date:TODAY(),entries:log}); },[log]);
  useEffect(()=>{ save("rslv_fit_water",{date:TODAY(),ml:water}); },[water]);
  const addFood  = (entry) => setLog(p=>[...p, entry]);
  const delFood  = (id)    => setLog(p=>p.filter(e=>e.id!==id));
  const addWater = (ml)    => setWater(p=>Math.max(0,p+ml));
  const totals = log.reduce((a,e)=>({ cal:a.cal+e.cal, prot:a.prot+e.prot, carb:a.carb+e.carb, fat:a.fat+e.fat }),{cal:0,prot:0,carb:0,fat:0});
  const calPct = goals.calories > 0 ? Math.min(100,(totals.cal/goals.calories)*100) : 0;
  const calOver = totals.cal > goals.calories && goals.calories > 0;
  const waterPct = goals.water > 0 ? Math.min(100,(water/goals.water)*100) : 0;
  const tt=tints(T);
  const mac=(label,c,lim)=>{ const left=Math.round((lim-c)*10)/10; return (
    <div style={{ textAlign:"center", flex:1 }}>
      <div style={{ fontSize:10.5, fontWeight:600, color:"rgba(255,255,255,.85)" }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:800, color:"#fff", marginTop:1 }}>{Math.round(c*10)/10}g</div>
      <div style={{ fontSize:8.5, fontWeight:600, color:"rgba(255,255,255,.8)", marginTop:1 }}>{left>=0?("of "+lim+"g · "+left+" left"):("of "+lim+"g · "+Math.abs(left)+" over")}</div>
    </div>);};
  return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, animation:"fadeUp .4s ease both" }}>
        <div>
          <div style={{ fontSize:26, fontWeight:800, color:T.ink, letterSpacing:"-0.02em" }}>Fitness</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, marginTop:2 }}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <div onClick={()=>openModal(()=>{ setQuickScan(true); setAddingMeal("breakfast"); })} style={{ width:46, height:46, borderRadius:"50%", background:darkMode?"#fff":PAL.ink, color:darkMode?PAL.ink:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="cam" s={20}/></div>
          <div onClick={()=>openModal(()=>setShowGoals(true))} style={{ width:46, height:46, borderRadius:"50%", background:T.card, border:"1px solid "+T.line, color:T.ink, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", boxShadow:T.shadow }}><Ic n="gear" s={20}/></div>
        </div>
      </div>

      <div style={{ background:T.card, border:"1px solid "+T.line, borderRadius:26, padding:"16px 18px", marginBottom:12, display:"flex", alignItems:"center", gap:16, boxShadow:T.shadow, animation:"fadeUp .4s ease .05s both" }}>
        <Ring pct={calPct} size={106} T={T} over={calOver}>
          <div style={{ fontSize:21, fontWeight:800, letterSpacing:"-0.02em", lineHeight:1, color:calOver?PAL.red:T.ink, fontFamily:FONT }}><CountUp value={Math.round(totals.cal)}/></div>
          <div style={{ fontSize:9.5, fontWeight:600, color:T.ink3, marginTop:2, fontFamily:FONT }}>kcal</div>
        </Ring>
        <div>
          <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:T.ink3, marginBottom:5 }}>Calories today</div>
          <div style={{ fontSize:15.5, fontWeight:700, color:T.ink }}>of {goals.calories.toLocaleString()} kcal</div>
          <div style={{ display:"inline-block", marginTop:8, fontSize:11, fontWeight:700, color:calOver?PAL.red:PAL.or, background:calOver?tt.red.bg:tt.or.bg, borderRadius:999, padding:"5px 11px" }}>
            {calOver? Math.round(totals.cal-goals.calories)+" over" : Math.round(goals.calories-totals.cal)+" left"}
          </div>
        </div>
      </div>

      <div style={{ background:GRAD.bl, borderRadius:24, padding:"15px 16px", marginBottom:12, animation:"fadeUp .4s ease .1s both" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:9 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:13, background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="drop" s={17}/></div>
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,.9)" }}>Water</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#fff", lineHeight:1.1 }}>{water} <span style={{ fontSize:11, fontWeight:600, opacity:.85 }}>/ {goals.water} ml</span></div>
            </div>
          </div>
          <div onClick={()=>addWater(-250)} style={{ width:34, height:34, borderRadius:"50%", background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="minus" s={15}/></div>
        </div>
        <div style={{ height:6, borderRadius:6, background:"rgba(255,255,255,.28)", overflow:"hidden", marginBottom:10 }}>
          <div style={{ height:"100%", width:waterPct+"%", background:"#fff", borderRadius:6, transition:"width .4s" }}/>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[250,500,1000].map(ml=>(
            <button key={ml} onClick={()=>addWater(ml)} style={{ flex:1, padding:"9px 4px", background:"#fff", border:"none", borderRadius:999, color:PAL.bl3, fontSize:12.5, fontWeight:700, fontFamily:FONT, cursor:"pointer" }}>+{ml<1000?ml+" ml":"1 L"}</button>
          ))}
        </div>
      </div>

      <div style={{ background:GRAD.or, borderRadius:22, padding:"13px 14px", marginBottom:16, display:"flex", alignItems:"center", gap:6, animation:"fadeUp .4s ease .14s both" }}>
        {mac("Protein",totals.prot,goals.protein)}
        {mac("Carbs",totals.carb,goals.carbs)}
        {mac("Fat",totals.fat,goals.fat)}
        <div onClick={()=>openModal(()=>setShowGoals(true))} style={{ width:34, height:34, borderRadius:"50%", background:"#fff", color:PAL.or3, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0 }}><Ic n="gear" s={16}/></div>
      </div>

      <SecHead T={T} mt={0}>Today's meals</SecHead>
      {MEALS.map((meal,mi)=>{
        const MM=MEALMETA[meal.key]||MEALMETA.lunch;
        const mealEntries = log.filter(e=>e.meal===meal.key);
        const mealCal = mealEntries.reduce((a,e)=>a+e.cal,0);
        return (
          <div key={meal.key} style={{ marginBottom:13, animation:"fadeUp .4s ease "+(0.16+mi*0.04)+"s both" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <Chip n={MM.icon} c={MM.c} T={T} size={34} is={16}/>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:T.ink }}>{meal.label}</div>
                  <div style={{ fontSize:9.5, color:T.ink3, fontWeight:600 }}>{meal.hint}</div>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                {mealCal > 0 && <div style={{ fontSize:12, fontWeight:700, color:T.ink2 }}>{Math.round(mealCal)} kcal</div>}
                <div onClick={()=>openModal(()=>setAddingMeal(meal.key))} style={{ width:32, height:32, borderRadius:"50%", background:MM.grad, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}><Ic n="plus" s={15} sw={2.6}/></div>
              </div>
            </div>
            {mealEntries.length === 0 ? (
              <div style={{ padding:"12px 14px", borderRadius:16, border:"1px dashed "+T.dashed, textAlign:"center" }}>
                <div style={{ fontSize:11.5, color:T.ink3, fontWeight:500 }}>Tap + to log {meal.label.toLowerCase()}</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {mealEntries.map(e=>(
                  <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 13px", background:T.card, border:"1px solid "+T.line, borderRadius:16, boxShadow:T.shadow }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:T.ink, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.name}</div>
                      <div style={{ fontSize:10.5, color:T.ink3, fontWeight:500, marginTop:2 }}>{Math.round(e.cal)} kcal · P:{e.prot}g · C:{e.carb}g · F:{e.fat}g</div>
                    </div>
                    <div style={{ fontSize:11.5, fontWeight:700, color:tt.am.fg, flexShrink:0 }}>{e.grams}g</div>
                    <div onClick={()=>delFood(e.id)} style={{ color:T.ink3, cursor:"pointer", padding:4, flexShrink:0 }}><Ic n="trash" s={16}/></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {showGoals && <GoalsModal T={T} goals={goals} onSave={setGoals} onClose={()=>closeModal(()=>setShowGoals(false))}/>}
      {addingMeal && !selectedFood && <FoodSearchModal T={T} meal={addingMeal} startWithScan={quickScan} onSelect={f=>{ setSelectedFood(f); setQuickScan(false); }} onClose={()=>closeModal(()=>{ setAddingMeal(null); setQuickScan(false); })}/>}
      {selectedFood && <ServingModal T={T} food={selectedFood} meal={addingMeal} onAdd={entry=>{ addFood(entry); setSelectedFood(null); closeModal(()=>setAddingMeal(null)); }} onClose={()=>{ setSelectedFood(null); if(!addingMeal) onModalChange(false); }}/>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   PROFILE / APP SETTINGS PAGE
───────────────────────────────────────────── */
const PLANS=[
  {id:"monthly",label:"Monthly",price:"€6.99",per:"per month",note:"Cancel anytime"},
  {id:"yearly",label:"Yearly",price:"€34.99",per:"per year",note:"Save 58%",best:true},
];
function PremiumSheet({ T, current, onChoose, onClose }) {
  const [sel,setSel]=useState(current&&current!=="free"?current:"yearly");
  const tt=tints(T);
  const feats=[["book","gr","All 10 languages · 3,500+ words"],["chart","bl","Full growth history & stats"],["flame","or","Streak protection"],["bell","am","Smart daily reminders"],["heart","ro","Support an independent app"]];
  const p=PLANS.find(x=>x.id===sel);
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ background:GRAD.or, borderRadius:24, padding:"20px 18px", textAlign:"center", marginBottom:16 }}>
        <div style={{ width:54, height:54, borderRadius:"50%", background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 10px" }}><Ic n="star" s={26}/></div>
        <div style={{ fontSize:21, fontWeight:800, color:"#fff", fontFamily:FONT }}>Risolvero Premium</div>
        <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,.85)", fontFamily:FONT, marginTop:3 }}>Everything, unlocked.</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:9, marginBottom:16 }}>
        {feats.map(f=>(
          <div key={f[2]} style={{ display:"flex", alignItems:"center", gap:11 }}>
            <Chip n={f[0]} c={f[1]} T={T} size={32} is={15}/>
            <span style={{ fontSize:13, fontWeight:600, color:T.ink, fontFamily:FONT }}>{f[2]}</span>
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
        {PLANS.map(pl=>{ const on=sel===pl.id; return (
          <div key={pl.id} onClick={()=>setSel(pl.id)} style={{ position:"relative", background:T.card, border:on?("2px solid "+PAL.or):("1px solid "+T.line), borderRadius:20, padding:"15px 13px", cursor:"pointer", boxShadow:T.shadow }}>
            {pl.best&&<div style={{ position:"absolute", top:-9, left:"50%", transform:"translateX(-50%)", background:GRAD.or, color:"#fff", fontSize:8.5, fontWeight:800, fontFamily:FONT, padding:"3px 9px", borderRadius:999, letterSpacing:"0.06em", whiteSpace:"nowrap" }}>BEST VALUE</div>}
            <div style={{ fontSize:12.5, fontWeight:700, color:T.ink2, fontFamily:FONT }}>{pl.label}</div>
            <div style={{ fontSize:20, fontWeight:800, color:T.ink, fontFamily:FONT, margin:"3px 0 1px" }}>{pl.price}</div>
            <div style={{ fontSize:10, fontWeight:600, color:T.ink3, fontFamily:FONT }}>{pl.per}</div>
            <div style={{ fontSize:10, fontWeight:700, color:on?PAL.or:tt.gr.fg, fontFamily:FONT, marginTop:6 }}>{pl.note}</div>
          </div>
        );})}
      </div>
      <div style={{ fontSize:10.5, color:T.ink3, fontFamily:FONT, fontWeight:500, textAlign:"center", lineHeight:1.6, marginBottom:12 }}>Test mode — real billing arrives with the Play Store release. Nothing is charged today.</div>
      <CTA T={T} onClick={()=>{ onChoose(sel); onClose(); }}>Start Premium · {p.price} {p.id==="monthly"?"/ month":"/ year"}</CTA>
    </Sheet>
  );
}
function ManageSheet({ T, plan, onSwitch, onCancel, onClose }) {
  const [confirm,setConfirm]=useState(false);
  const cur=PLANS.find(p=>p.id===plan)||PLANS[0];
  const other=PLANS.find(p=>p.id!==plan);
  return (
    <Sheet T={T} onClose={onClose}>
      <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT, marginBottom:14 }}>Manage subscription</div>
      <div style={{ background:GRAD.or, borderRadius:22, padding:"16px 18px", display:"flex", alignItems:"center", gap:13, marginBottom:14 }}>
        <div style={{ width:42, height:42, borderRadius:15, background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="star" s={20}/></div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", fontFamily:FONT }}>Premium · {cur.label}</div>
          <div style={{ fontSize:11.5, fontWeight:600, color:"rgba(255,255,255,.85)", fontFamily:FONT }}>{cur.price} {cur.per} · active</div>
        </div>
      </div>
      {other&&(
        <button onClick={()=>{ onSwitch(other.id); onClose(); }} style={{ width:"100%", padding:"14px", background:T.chip, border:"none", borderRadius:16, fontSize:13.5, fontWeight:700, fontFamily:FONT, color:T.ink, cursor:"pointer", marginBottom:10 }}>Switch to {other.label} · {other.price} {other.per}</button>
      )}
      {!confirm ? (
        <button onClick={()=>setConfirm(true)} style={{ width:"100%", padding:"14px", background:tints(T).red.bg, border:"none", borderRadius:16, fontSize:13.5, fontWeight:700, fontFamily:FONT, color:PAL.red, cursor:"pointer" }}>Cancel subscription</button>
      ):(
        <div style={{ background:tints(T).red.bg, borderRadius:18, padding:"15px" }}>
          <div style={{ fontSize:13, fontWeight:700, color:PAL.red, fontFamily:FONT, marginBottom:4 }}>Cancel Premium?</div>
          <div style={{ fontSize:11.5, color:T.ink2, fontFamily:FONT, fontWeight:500, lineHeight:1.55, marginBottom:12 }}>You keep Premium until the end of the period, then return to the free plan.</div>
          <div style={{ display:"flex", gap:9 }}>
            <button onClick={()=>setConfirm(false)} style={{ flex:1, padding:"12px", background:T.card, border:"1px solid "+T.line, borderRadius:13, fontSize:12.5, fontWeight:700, fontFamily:FONT, color:T.ink, cursor:"pointer" }}>Keep it</button>
            <button onClick={()=>{ onCancel(); onClose(); }} style={{ flex:1, padding:"12px", background:PAL.red, border:"none", borderRadius:13, fontSize:12.5, fontWeight:700, fontFamily:FONT, color:"#fff", cursor:"pointer" }}>Cancel plan</button>
          </div>
        </div>
      )}
      <div style={{ fontSize:10.5, color:T.ink3, fontFamily:FONT, fontWeight:500, textAlign:"center", lineHeight:1.6, marginTop:12 }}>Test mode — billing activates with the Play Store release.</div>
    </Sheet>
  );
}

function ProfilePage({ onModalChange=()=>{}, darkMode=true, setDarkMode=()=>{} }) {
  const T=THEME(darkMode);
  const tt=tints(T);
  const [currency, setCurrency]   = useState(()=>load("rslv_currency","€"));
  const [name, setName]           = useState(()=>load("rslv_display_name",""));
  const [avatar, setAvatar]       = useState(()=>load("rslv_avatar",""));
  const [goals, setGoals]         = useState(()=>load("rslv_fit_goals",{ calories:2000, protein:150, carbs:250, fat:65, water:2000 }));
  const [notifs, setNotifs]       = useState(()=>load("rslv_notifs",{ habits:true, streak:true, finance:true }));
  const [showReset, setShowReset] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [editName, setEditName]   = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftAvatar, setDraftAvatar] = useState("");
  const [bio, setBio]             = useState(()=>load("rslv_bio",""));
  const [draftBio, setDraftBio]   = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [section, setSection]     = useState(null);
  const [token, setToken]         = useState(()=>localStorage.getItem("rslv_token")||null);
  const [showAuth, setShowAuth]   = useState(false);
  const [showRate, setShowRate]   = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [fbText, setFbText]       = useState("");
  const [notifTick, setNotifTick] = useState(0);
  const [premium, setPremium]     = useState(()=>load("rslv_premium",{plan:"free"}));
  const [showPremium, setShowPremium] = useState(false);
  const [showManage, setShowManage]   = useState(false);
  const setPlan   = (p)=>{ const v={plan:p, since:TODAY()}; setPremium(v); save("rslv_premium",v); };
  const cancelPlan= ()=>{ const v={plan:"free"}; setPremium(v); save("rslv_premium",v); };

  const streak   = load("rslv_streak",0);
  const habits   = load("rslv_habits",[]);
  const history  = load("rslv_learn_history",[]);
  const salary   = load("rslv_salary",0);
  const expenses = load("rslv_expenses",[]);
  const totalSaved = salary>0 ? Math.max(0,salary-expenses.reduce((a,e)=>a+e.amount,0)) : 0;
  const CURRENCIES = ["€","$","£","CHF","kr","zł","Kč","Ft","lei","лв","₺","₹","¥","₩","R$"];

  const saveGoal = (k,v) => { const updated = {...goals,[k]:parseInt(v)||0}; setGoals(updated); save("rslv_fit_goals",updated); };
  const toggleNotif = (k) => { const updated = {...notifs,[k]:!notifs[k]}; setNotifs(updated); save("rslv_notifs",updated); };

  const saveName = async () => {
    setName(draftName); setAvatar(draftAvatar); setBio(draftBio);
    save("rslv_display_name",draftName); save("rslv_avatar",draftAvatar); save("rslv_bio",draftBio);
    if(token){
      try {
        const u = await getUser(token);
        if(u?.id){
          await sbAuthed(`profiles?id=eq.${u.id}`, token, { method:"PATCH", body: JSON.stringify({ full_name:draftName, avatar_url:draftAvatar, bio:draftBio }) });
        }
      } catch {}
    }
    setEditName(false); onModalChange(false);
  };

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    if(!token){ alert("Sign in first to upload a photo. (Community sign-in returns in a future update — for now the letter avatar is used.)"); return; }
    setUploadingAvatar(true);
    try {
      const small = await compressImage(file, 600, 0.85);
      const url = await uploadImage(small, token, "avatars");
      setDraftAvatar(url);
    } catch(err) { alert("Upload failed. Please try again."); }
    setUploadingAvatar(false);
  };

  const resetToday = () => {
    save("rslv_done",{date:"",checked:{}});
    save("rslv_fit_log",{date:"",entries:[]});
    save("rslv_fit_water",{date:"",ml:0});
    setShowReset(false);
    alert("Today's data cleared.");
  };
  const clearAll = () => {
    const keys = ["rslv_habits","rslv_done","rslv_streak","rslv_salary","rslv_deposits","rslv_expenses","rslv_loans","rslv_subs","rslv_fit_goals","rslv_fit_log","rslv_fit_water","rslv_learn_history","rslv_lang","rslv_learn_streak","rslv_learn_goal","rslv_profile","rslv_display_name","rslv_avatar","rslv_bio","rslv_currency","rslv_quick_actions","rslv_premium","rslv_learn_last_date"];
    keys.forEach(k=>localStorage.removeItem(k));
    setShowClear(false);
    window.location.reload();
  };

  const sendFeedback = () => {
    const body = encodeURIComponent(fbText+"\n\n— sent from Risolvero");
    window.location.href = "mailto:feedback@risolvero.app?subject="+encodeURIComponent("Risolvero feedback")+"&body="+body;
  };

  const Row = ({icon, c="gr", label, value, onPress, danger}) => (
    <div onClick={onPress} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", cursor:onPress?"pointer":"default", background:T.card, border:"1px solid "+T.line, borderRadius:18, marginBottom:9, boxShadow:T.shadow }}>
      <Chip n={icon} c={danger?"red":c} T={T} size={36} is={17}/>
      <div style={{ flex:1, fontSize:13.5, fontWeight:700, color:danger?PAL.red:T.ink, fontFamily:FONT }}>{label}</div>
      {value && <div style={{ fontSize:12.5, fontWeight:600, color:T.ink3, fontFamily:FONT }}>{value}</div>}
      {onPress && <Ic n="chev" s={15} style={{ color:T.ink3 }}/>}
    </div>
  );

  const Toggle = ({icon, c="gr", label, value, onToggle, sub}) => (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:T.card, border:"1px solid "+T.line, borderRadius:18, marginBottom:9, boxShadow:T.shadow }}>
      <Chip n={icon} c={c} T={T} size={36} is={17}/>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:13.5, fontWeight:700, color:T.ink, fontFamily:FONT }}>{label}</div>
        {sub && <div style={{ fontSize:10.5, fontWeight:500, color:T.ink3, fontFamily:FONT, marginTop:1 }}>{sub}</div>}
      </div>
      <div onClick={onToggle} style={{ width:47, height:28, borderRadius:999, background:value?PAL.gr:(T.dark?"#34353F":"#E0E0E6"), position:"relative", cursor:"pointer", transition:"all 0.25s", flexShrink:0 }}>
        <div style={{ position:"absolute", top:3, left:value?22:3, width:22, height:22, borderRadius:"50%", background:"#fff", transition:"all 0.25s", boxShadow:"0 1px 4px rgba(0,0,0,0.2)" }}/>
      </div>
    </div>
  );

  const Back = ({title}) => (
    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
      <Chip n="back" c="ink" T={T} size={36} is={17} onClick={()=>setSection(null)}/>
      <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT }}>{title}</div>
    </div>
  );

  if(section==="goals") return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <Back title="Daily Goals"/>
      {[
        {k:"calories",label:"Calories",unit:"kcal",c:"or",icon:"flame"},
        {k:"protein", label:"Protein", unit:"g",   c:"ro",icon:"fit"},
        {k:"carbs",   label:"Carbs",   unit:"g",   c:"am",icon:"fork"},
        {k:"fat",     label:"Fat",     unit:"g",   c:"vi",icon:"drop"},
        {k:"water",   label:"Water",   unit:"ml",  c:"bl",icon:"drop"},
      ].map(({k,label,unit,c,icon})=>(
        <div key={k} style={{ display:"flex", alignItems:"center", gap:12, background:T.card, border:"1px solid "+T.line, borderRadius:18, padding:"11px 13px", marginBottom:10, boxShadow:T.shadow }}>
          <Chip n={icon} c={c} T={T} size={36} is={17}/>
          <div style={{ flex:1, fontSize:13.5, fontWeight:700, color:T.ink }}>{label}</div>
          <input type="number" defaultValue={goals[k]} onBlur={e=>saveGoal(k,e.target.value)}
            style={{ width:92, padding:"9px 11px", background:T.input, border:"none", borderRadius:12, color:T.ink, fontSize:15, fontFamily:FONT, fontWeight:800, outline:"none", textAlign:"right" }}/>
          <div style={{ fontSize:12, color:T.ink3, fontWeight:600, width:30 }}>{unit}</div>
        </div>
      ))}
      <div style={{ fontSize:11.5, color:T.ink3, fontWeight:500, lineHeight:1.6, marginTop:4 }}>These goals power the Fitness rings and macro bar. Tap a number, change it, tap away to save.</div>
    </div>
  );

  if(section==="currency") return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <Back title="Currency"/>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
        {CURRENCIES.map(c=>(
          <div key={c} onClick={()=>{ setCurrency(c); save("rslv_currency",c); setSection(null); }}
            style={{ padding:"16px 8px", borderRadius:16, background:T.card, border:currency===c?("1.6px solid "+PAL.or):("1px solid "+T.line), textAlign:"center", cursor:"pointer", boxShadow:T.shadow }}>
            <div style={{ fontSize:20, fontWeight:800, color:currency===c?PAL.or:T.ink2 }}>{c}</div>
          </div>
        ))}
      </div>
    </div>
  );

  if(section==="history") return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <Back title="Growth History"/>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
        {[
          {label:"Day streak",    value:streak,             c:"am", icon:"flame"},
          {label:"Words learned", value:history.length,     c:"gr", icon:"book"},
          {label:"Active habits", value:habits.length,      c:"vi", icon:"target"},
          {label:"Saved",         value:currency+totalSaved.toFixed(0), c:"bl", icon:"coins"},
        ].map(({label,value,c,icon})=>(
          <div key={label} style={{ background:T.card, border:"1px solid "+T.line, borderRadius:18, padding:"14px", boxShadow:T.shadow }}>
            <Chip n={icon} c={c} T={T} size={32} is={15} style={{ marginBottom:9 }}/>
            <div style={{ fontSize:22, fontWeight:800, color:T.ink, lineHeight:1 }}>{value}</div>
            <div style={{ fontSize:10.5, color:T.ink3, fontWeight:600, marginTop:4 }}>{label}</div>
          </div>
        ))}
      </div>
      {history.length>0 && (
        <>
          <SecHead T={T} mt={0}>Words learned</SecHead>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
            {history.slice(0,30).map((h,i)=>(
              <div key={i} style={{ padding:"5px 12px", borderRadius:999, background:T.card, border:"1px solid "+T.line }}>
                <span style={{ fontSize:12, color:T.ink2, fontWeight:600 }}>{h.word}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  if(section==="help") return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <Back title="Help Center"/>
      {[
        { q:"How does the Growth score work?", a:"The ring fills as you complete habits. Each habit is worth an equal share of 100 points. Complete everything = 100. It resets every day — fresh start, no guilt." },
        { q:"How does the Jar System work?", a:"When you add a salary, it splits into 6 jars (T. Harv Eker's system): 55% Necessities, 10% Savings, 10% Education, 10% Play, 10% Freedom, 5% Give. Each expense deducts from its jar. Jars carry over — nothing resets." },
        { q:"Salary changed this month?", a:"Just tap Add on the income card and log the new amount with its date. Every deposit is added on top — you never overwrite old salaries. Tap any entry in the Salary Log to fix it." },
        { q:"Why is my streak broken?", a:"Your streak only continues if you complete ALL your habits every day. Miss one day and it resets to 0. Tip: keep your habit list small and realistic." },
        { q:"How do subscriptions work?", a:"Finance → Subscriptions → Add. Set the name, amount and renewal date. Anything due within 2 days gets highlighted." },
        { q:"Where is Community?", a:"Community is coming in a future update. We're launching with Habits, Fitness, Learning and Finance first." },
      ].map(({q,a},i)=>(
        <div key={i} style={{ background:T.card, border:"1px solid "+T.line, borderRadius:18, padding:"15px", marginBottom:10, boxShadow:T.shadow }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:T.ink, marginBottom:7 }}>{q}</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, lineHeight:1.65 }}>{a}</div>
        </div>
      ))}
    </div>
  );

  if(section==="privacy") return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <Back title="Privacy Policy"/>
      {[
        { title:"Data we collect", body:"Risolvero stores your habits, finance data, fitness logs and learning history locally on your device. Nothing leaves your phone unless you sign in to community features." },
        { title:"How we use your data", body:"Your data powers the app features you use. We never sell your data. We never share your personal information with advertisers." },
        { title:"Local storage", body:"All personal data lives in your device's local storage. Clearing app data in Settings removes everything permanently." },
        { title:"Third party services", body:"We use Open Food Facts for the food database and Supabase for optional account features. Both are privacy-respecting services." },
        { title:"Contact", body:"For any privacy concern you can clear all your data at any time: Settings → Data → Clear All App Data." },
      ].map(({title,body},i)=>(
        <div key={i} style={{ marginBottom:15 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:T.ink, marginBottom:5 }}>{title}</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, lineHeight:1.7 }}>{body}</div>
        </div>
      ))}
    </div>
  );

  const notifStatus = typeof Notification !== "undefined" ? (Notification.permission === "granted" ? "Enabled" : "Tap to allow") : "Not supported here";

  return (
    <div style={{ padding:"0 18px 32px", fontFamily:FONT }}>
      <div style={{ marginBottom:16, animation:"fadeUp 0.4s ease both" }}>
        <div style={{ fontSize:26, fontWeight:800, color:T.ink, letterSpacing:"-0.02em" }}>Profile</div>
        <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, marginTop:2 }}>Make it yours</div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:13, padding:"16px", background:T.card, border:"1px solid "+T.line, borderRadius:24, marginBottom:18, boxShadow:T.shadow, animation:"fadeUp 0.4s ease 0.05s both" }}>
        <div onClick={()=>{ setDraftName(name); setDraftAvatar(avatar); setDraftBio(bio); onModalChange(true); setEditName(true); }}
          style={{ width:56, height:56, borderRadius:"50%", background: avatar?"transparent":GRAD.or, overflow:"hidden", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:800, color:"#fff", fontFamily:FONT, cursor:"pointer" }}>
          {avatar ? <img src={avatar} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : ((name&&name[0])||"R")}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:16.5, fontWeight:800, color:T.ink }}>{name||"Your name"}</div>
          <div style={{ fontSize:11.5, color:T.ink3, fontWeight:500, lineHeight:1.4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{bio||"Tap edit to add a short bio"}</div>
        </div>
        <div onClick={()=>{ setDraftName(name); setDraftAvatar(avatar); setDraftBio(bio); onModalChange(true); setEditName(true); }} style={{ background:darkMode?"#fff":PAL.ink, color:darkMode?PAL.ink:"#fff", borderRadius:999, padding:"8px 15px", cursor:"pointer", fontSize:12, fontWeight:700 }}>Edit</div>
      </div>

      {premium.plan==="free" ? (
        <div onClick={()=>{ onModalChange(true); setShowPremium(true); }} style={{ background:GRAD.or, borderRadius:24, padding:"16px 18px", display:"flex", alignItems:"center", gap:13, marginBottom:18, cursor:"pointer", boxShadow:"0 12px 26px rgba(255,94,31,.28)", animation:"fadeUp 0.4s ease 0.08s both" }}>
          <div style={{ width:44, height:44, borderRadius:16, background:"rgba(255,255,255,.22)", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="star" s={21}/></div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Risolvero Premium</div>
            <div style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,.85)", marginTop:1 }}>All languages, stats & more</div>
          </div>
          <div style={{ background:"#fff", color:PAL.or3, borderRadius:999, padding:"9px 15px", fontSize:12, fontWeight:800 }}>Upgrade</div>
        </div>
      ):(
        <Row icon="star" c="am" label="Subscription" value={"Premium · "+(premium.plan==="yearly"?"Yearly":"Monthly")} onPress={()=>{ onModalChange(true); setShowManage(true); }}/>
      )}

      <SecHead T={T} mt={0}>Preferences</SecHead>
      <Toggle icon="moon" c="ink" label={darkMode?"Dark mode":"Light mode"} value={darkMode} onToggle={()=>setDarkMode(d=>!d)}/>
      <Row icon="coins" c="gr" label="Currency" value={currency} onPress={()=>setSection("currency")}/>
      <Row icon="target" c="bl" label="Daily goals" value={goals.calories+" kcal"} onPress={()=>setSection("goals")}/>
      <Row icon="chart" c="vi" label="Growth history" onPress={()=>setSection("history")}/>

      <SecHead T={T}>Notifications</SecHead>
      <Toggle icon="bell" c="am" label="Daily habit reminder" value={notifs.habits} onToggle={()=>toggleNotif("habits")}/>
      <Toggle icon="flame" c="or" label="Streak alert" value={notifs.streak} onToggle={()=>toggleNotif("streak")}/>
      <Toggle icon="wallet" c="gr" label="Finance reminders" value={notifs.finance} onToggle={()=>toggleNotif("finance")}/>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:T.card, border:"1px solid "+T.line, borderRadius:18, marginBottom:9, boxShadow:T.shadow }}>
        <Chip n="clock" c="bl" T={T} size={36} is={17}/>
        <div style={{ flex:1, fontSize:13.5, fontWeight:700, color:T.ink }}>Reminder time</div>
        <input type="time" defaultValue={load(NOTIF_KEY,"09:00")} onChange={e=>{ save(NOTIF_KEY,e.target.value); scheduleNotifications(); }}
          style={{ background:T.input, border:"none", borderRadius:12, padding:"7px 11px", color:T.ink, fontSize:13.5, fontFamily:FONT, fontWeight:700, outline:"none", colorScheme:T.dark?"dark":"light" }}/>
      </div>
      <div onClick={async()=>{ const granted = await requestNotifPermission(); if(granted) scheduleNotifications(); setNotifTick(t=>t+1); }} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:T.card, border:"1px solid "+T.line, borderRadius:18, marginBottom:9, cursor:"pointer", boxShadow:T.shadow }}>
        <Chip n="bell" c="gr" T={T} size={36} is={17}/>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:tt.gr.fg }}>Enable notifications</div>
          <div style={{ fontSize:10.5, fontWeight:500, color:T.ink3, marginTop:1 }}>{notifStatus}</div>
        </div>
        {typeof Notification!=="undefined" && Notification.permission==="granted" && <Ic n="check" s={17} style={{ color:tt.gr.fg }}/>}
      </div>

      {/* COMMUNITY ACCOUNT — hidden while Community is "Soon". Remove the (false &&) wrapper to restore. */}
      {false && (<>
        {token ? (
          <Row icon="logout" c="red" danger label="Sign out of Community" onPress={()=>{ localStorage.removeItem("rslv_token"); setToken(null); }}/>
        ) : (
          <Row icon="user" c="gr" label="Sign in to Community" onPress={()=>{ onModalChange(true); setShowAuth(true); }}/>
        )}
      </>)}

      <SecHead T={T}>Support</SecHead>
      <Row icon="chat" c="bl" label="Send feedback" onPress={()=>{ onModalChange(true); setShowFeedback(true); }}/>
      <Row icon="star" c="am" label="Rate Risolvero" onPress={()=>{ onModalChange(true); setShowRate(true); }}/>
      <Row icon="info" c="gr" label="Help Center" onPress={()=>setSection("help")}/>
      <Row icon="book" c="ro" label="Privacy Policy" onPress={()=>setSection("privacy")}/>

      <SecHead T={T}>Data</SecHead>
      <Row icon="refresh" c="am" label="Reset today" onPress={()=>setShowReset(true)}/>
      <Row icon="trash" danger label="Clear all app data" onPress={()=>setShowClear(true)}/>

      <div style={{ textAlign:"center", fontSize:11, color:T.ink3, fontWeight:600, marginTop:18 }}>Risolvero · v1.0</div>

      {showPremium && <PremiumSheet T={T} current={premium.plan} onChoose={setPlan} onClose={()=>{ setShowPremium(false); onModalChange(false); }}/>}
      {showManage && <ManageSheet T={T} plan={premium.plan} onSwitch={setPlan} onCancel={cancelPlan} onClose={()=>{ setShowManage(false); onModalChange(false); }}/>}

      {editName && (
        <Sheet T={T} onClose={()=>{ setEditName(false); onModalChange(false); }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
            <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT }}>Edit Profile</div>
            <Chip n="close" c="ink" T={T} size={36} is={16} onClick={()=>{ setEditName(false); onModalChange(false); }}/>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:20 }}>
            <label style={{ cursor:"pointer", position:"relative" }}>
              <input type="file" accept="image/*" onChange={pickAvatar} style={{ display:"none" }}/>
              <div style={{ width:90, height:90, borderRadius:"50%", background: draftAvatar?"transparent":GRAD.or, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, fontWeight:800, color:"#fff", fontFamily:FONT }}>
                {uploadingAvatar ? <div style={{ fontSize:12, color:"#fff", fontWeight:700 }}>...</div> : (draftAvatar ? <img src={draftAvatar} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : ((draftName&&draftName[0])||"R"))}
              </div>
              <div style={{ position:"absolute", bottom:-2, right:-2, width:30, height:30, borderRadius:"50%", background:darkMode?"#fff":PAL.ink, color:darkMode?PAL.ink:"#fff", display:"flex", alignItems:"center", justifyContent:"center", border:"3px solid "+T.sheet }}>
                <Ic n="cam" s={14}/>
              </div>
            </label>
            <div style={{ fontSize:11.5, color:T.ink3, fontWeight:500, marginTop:9 }}>{uploadingAvatar?"Uploading...":"Tap photo to change"}</div>
          </div>
          <Field T={T} label="Display name">
            <input value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder="Your name" style={inputStyle(T)}/>
          </Field>
          <Field T={T} label="Bio">
            <textarea value={draftBio} onChange={e=>setDraftBio(e.target.value.slice(0,150))} placeholder="A short line about you..." rows={3}
              style={{ ...inputStyle(T), resize:"none", lineHeight:1.5 }}/>
            <div style={{ fontSize:10.5, color:T.ink3, fontWeight:500, marginTop:5, textAlign:"right" }}>{draftBio.length}/150</div>
          </Field>
          <CTA T={T} disabled={uploadingAvatar} onClick={saveName}>Save Profile</CTA>
        </Sheet>
      )}

      {showFeedback && (
        <Sheet T={T} onClose={()=>{ setShowFeedback(false); onModalChange(false); }}>
          <div style={{ fontSize:21, fontWeight:800, color:T.ink, fontFamily:FONT, marginBottom:4 }}>Send feedback</div>
          <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, marginBottom:14, lineHeight:1.6 }}>Found a bug? Want a feature? Tell us — it opens in your email app.</div>
          <Field T={T} label="Your message">
            <textarea autoFocus value={fbText} onChange={e=>setFbText(e.target.value)} placeholder="Write anything..." rows={5}
              style={{ ...inputStyle(T), resize:"none", lineHeight:1.55 }}/>
          </Field>
          <CTA T={T} disabled={!fbText.trim()} onClick={sendFeedback}>Send via Email</CTA>
        </Sheet>
      )}

      {showRate && (
        <Sheet T={T} onClose={()=>{ setShowRate(false); onModalChange(false); }}>
          <div style={{ display:"flex", justifyContent:"center", marginBottom:14 }}><Chip n="star" c="am" T={T} size={62} is={30}/></div>
          <div style={{ fontSize:20, fontWeight:800, color:T.ink, fontFamily:FONT, textAlign:"center", marginBottom:6 }}>Enjoying Risolvero?</div>
          <div style={{ fontSize:13, color:T.ink2, fontWeight:500, textAlign:"center", lineHeight:1.65, marginBottom:18 }}>Star ratings open when we launch on the Play Store. For now, the best rating you can give is telling a friend.</div>
          <CTA T={T} onClick={()=>{ setShowRate(false); onModalChange(false); }}>Got it</CTA>
        </Sheet>
      )}

      {showReset && (
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}>
          <div onClick={()=>setShowReset(false)} style={{ position:"absolute", inset:0, background:T.overlay }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:340, background:T.sheet, borderRadius:26, padding:"26px 22px", boxShadow:"0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}><Chip n="refresh" c="am" T={T} size={52} is={24}/></div>
            <div style={{ fontSize:17, fontWeight:800, color:T.ink, fontFamily:FONT, textAlign:"center", marginBottom:7 }}>Reset today?</div>
            <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, fontFamily:FONT, textAlign:"center", lineHeight:1.6, marginBottom:20 }}>This clears today's habits, food log and water. Your history stays safe.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowReset(false)} style={{ flex:1, padding:"13px", background:T.chip, border:"none", borderRadius:14, fontSize:13.5, fontWeight:700, color:T.ink2, fontFamily:FONT, cursor:"pointer" }}>Cancel</button>
              <button onClick={resetToday} style={{ flex:1, padding:"13px", background:tints(T).am.bg, border:"none", borderRadius:14, fontSize:13.5, fontWeight:700, color:tt.am.fg, fontFamily:FONT, cursor:"pointer" }}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {showAuth && <div className="legacy"><AuthScreen onLogin={async(e,p)=>{ const d=await sbAuth("token?grant_type=password",{email:e,password:p}); if(d.access_token){localStorage.setItem("rslv_token",d.access_token);setToken(d.access_token);onModalChange(false);setShowAuth(false);return true;} return d.error_description||"Failed"; }} onSignup={async(e,p,u,n)=>{ const d=await sbAuth("signup",{email:e,password:p}); if(d.id||d.user?.id){const tok=d.access_token||d.session?.access_token;if(tok){localStorage.setItem("rslv_token",tok);try{await sb("profiles",{method:"POST",body:JSON.stringify({id:d.id||d.user.id,username:u,full_name:n}),headers:{"apikey":SUPABASE_KEY,"Authorization":`Bearer ${tok}`,"Content-Type":"application/json","Prefer":"return=representation"}});}catch{}setToken(tok);onModalChange(false);setShowAuth(false);return true;}} return d.error_description||"Failed"; }} onClose={()=>{ onModalChange(false); setShowAuth(false); }} onModalChange={onModalChange}/></div> }

      {showClear && (
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}>
          <div onClick={()=>setShowClear(false)} style={{ position:"absolute", inset:0, background:T.overlay }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:340, background:T.sheet, borderRadius:26, padding:"26px 22px", boxShadow:"0 20px 60px rgba(0,0,0,.3)" }}>
            <div style={{ display:"flex", justifyContent:"center", marginBottom:12 }}><Chip n="trash" c="red" T={T} size={52} is={24}/></div>
            <div style={{ fontSize:17, fontWeight:800, color:PAL.red, fontFamily:FONT, textAlign:"center", marginBottom:7 }}>Clear everything?</div>
            <div style={{ fontSize:12.5, color:T.ink2, fontWeight:500, fontFamily:FONT, textAlign:"center", lineHeight:1.6, marginBottom:20 }}>This permanently deletes all your habits, history, finance data and settings. Cannot be undone.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={e=>{ e.stopPropagation(); setShowClear(false); }} style={{ flex:1, padding:"13px", background:T.chip, border:"none", borderRadius:14, fontSize:13.5, fontWeight:700, color:T.ink, fontFamily:FONT, cursor:"pointer" }}>Cancel</button>
              <button onClick={e=>{ e.stopPropagation(); clearAll(); }} style={{ flex:1, padding:"13px", background:tints(T).red.bg, border:"none", borderRadius:14, fontSize:13.5, fontWeight:700, color:PAL.red, fontFamily:FONT, cursor:"pointer" }}>Clear All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ONBOARDING
───────────────────────────────────────────── */
function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [goals, setGoals] = useState([]);
  const T = THEME(false);
  const tt = tints(T);

  const GOAL_OPTIONS = [
    { id:"habits",   icon:"target", c:"or", label:"Build habits",   desc:"Daily routines that stick" },
    { id:"fitness",  icon:"fit",    c:"gr", label:"Get fit",         desc:"Track food, water & workouts" },
    { id:"finance",  icon:"coins",  c:"am", label:"Save money",      desc:"The jar system that works" },
    { id:"learning", icon:"book",   c:"bl", label:"Learn something", desc:"A few words a day, every day" },
  ];
  const toggleGoal = (id) => setGoals(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  const Primary = ({children,onClick,disabled}) => (
    <button onClick={onClick} disabled={disabled} style={{ width:"100%", padding:"17px", background:disabled?T.chip:GRAD.or, border:"none", borderRadius:20, fontSize:15.5, fontWeight:800, fontFamily:FONT, color:disabled?T.ink3:"#fff", cursor:disabled?"not-allowed":"pointer", boxShadow:disabled?"none":"0 10px 28px rgba(255,94,31,.3)", transition:"all 0.2s" }}>{children}</button>
  );

  const SCREENS = [
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"0 26px", textAlign:"center" }}>
      <div style={{ marginBottom:22, animation:"cardIn 0.6s ease both" }}><Chip n="leaf" c="or" T={T} size={84} is={40}/></div>
      <div style={{ fontSize:30, fontWeight:800, color:T.ink, fontFamily:FONT, letterSpacing:"-0.02em", marginBottom:10, lineHeight:1.15, animation:"fadeUp 0.5s ease 0.1s both" }}>Welcome to<br/><span style={{ color:PAL.or }}>Risolvero</span></div>
      <div style={{ fontSize:14.5, color:T.ink2, fontFamily:FONT, fontWeight:500, lineHeight:1.7, marginBottom:44, animation:"fadeUp 0.5s ease 0.2s both" }}>The app for people who want to be better — and actually become it.</div>
      <div style={{ width:"100%", animation:"fadeUp 0.5s ease 0.3s both" }}>
        <Primary onClick={()=>setStep(1)}>Let's go</Primary>
        <button onClick={()=>onComplete("")} style={{ width:"100%", padding:"14px", background:"none", border:"none", fontSize:12.5, fontFamily:FONT, fontWeight:600, color:T.ink3, cursor:"pointer" }}>Skip intro</button>
      </div>
    </div>,

    <div style={{ padding:"64px 22px 32px", minHeight:"100vh" }}>
      <div style={{ fontSize:10.5, color:T.ink3, letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:FONT, fontWeight:700, marginBottom:10 }}>Step 1 of 3</div>
      <div style={{ fontSize:24, fontWeight:800, color:T.ink, fontFamily:FONT, letterSpacing:"-0.02em", marginBottom:5, lineHeight:1.2 }}>What do you want to improve?</div>
      <div style={{ fontSize:13, color:T.ink2, fontFamily:FONT, fontWeight:500, marginBottom:26 }}>Pick everything that matters to you</div>
      <div style={{ display:"flex", flexDirection:"column", gap:11, marginBottom:34 }}>
        {GOAL_OPTIONS.map(g=>{
          const sel = goals.includes(g.id);
          return (
            <div key={g.id} onClick={()=>toggleGoal(g.id)} style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 16px", borderRadius:20, background:T.card, border:sel?("1.6px solid "+PAL.or):("1px solid "+T.line), cursor:"pointer", transition:"all 0.2s", boxShadow:T.shadow }}>
              <Chip n={g.icon} c={g.c} T={T} size={44} is={21}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:700, color:T.ink, fontFamily:FONT }}>{g.label}</div>
                <div style={{ fontSize:11.5, color:T.ink3, fontFamily:FONT, fontWeight:500, marginTop:2 }}>{g.desc}</div>
              </div>
              <div style={{ width:24, height:24, borderRadius:"50%", background:sel?GRAD.or:T.chip, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s", flexShrink:0 }}>
                {sel && <Tick color="#fff" size={12}/>}
              </div>
            </div>
          );
        })}
      </div>
      <Primary onClick={()=>setStep(2)} disabled={goals.length===0}>Continue</Primary>
    </div>,

    <div style={{ padding:"64px 22px 32px", minHeight:"100vh" }}>
      <div style={{ fontSize:10.5, color:T.ink3, letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:FONT, fontWeight:700, marginBottom:10 }}>Step 2 of 3</div>
      <div style={{ fontSize:24, fontWeight:800, color:T.ink, fontFamily:FONT, letterSpacing:"-0.02em", marginBottom:5 }}>What's your name?</div>
      <div style={{ fontSize:13, color:T.ink2, fontFamily:FONT, fontWeight:500, marginBottom:32 }}>So the app feels personal</div>
      <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&name.trim()&&setStep(3)} placeholder="Your first name"
        style={{ width:"100%", padding:"17px 18px", background:T.card, border:"1px solid "+T.line2, borderRadius:18, color:T.ink, fontSize:21, fontFamily:FONT, fontWeight:800, outline:"none", marginBottom:32, display:"block", boxShadow:T.shadow }}/>
      <div style={{ fontSize:12.5, color:T.ink2, fontFamily:FONT, fontWeight:500, textAlign:"center", marginBottom:18, minHeight:18 }}>{name ? "Nice to meet you, "+name : ""}</div>
      <Primary onClick={()=>setStep(3)} disabled={!name.trim()}>Continue</Primary>
    </div>,

    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"0 26px", textAlign:"center" }}>
      <div style={{ marginBottom:18, animation:"cardIn 0.5s ease both" }}><Chip n="flame" c="or" T={T} size={84} is={40}/></div>
      <div style={{ fontSize:27, fontWeight:800, color:T.ink, fontFamily:FONT, letterSpacing:"-0.02em", marginBottom:8, animation:"fadeUp 0.5s ease 0.05s both" }}>{name ? "You're ready, "+name+"!" : "You're ready!"}</div>
      <div style={{ fontSize:14, color:T.ink2, fontFamily:FONT, fontWeight:500, lineHeight:1.7, marginBottom:14, animation:"fadeUp 0.5s ease 0.1s both" }}>Your journey starts today.</div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:36, animation:"fadeUp 0.5s ease 0.15s both" }}>
        {goals.map(g=>{ const opt = GOAL_OPTIONS.find(o=>o.id===g); return opt ? (
          <div key={g} style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 14px 7px 8px", borderRadius:999, background:T.card, border:"1px solid "+T.line, boxShadow:T.shadow }}>
            <Chip n={opt.icon} c={opt.c} T={T} size={24} is={12} style={{ borderRadius:"50%" }}/>
            <span style={{ fontSize:12.5, fontWeight:700, color:T.ink, fontFamily:FONT }}>{opt.label}</span>
          </div>
        ) : null; })}
      </div>
      <div style={{ width:"100%", animation:"fadeUp 0.5s ease 0.2s both" }}>
        <Primary onClick={()=>onComplete(name)}>Start growing</Primary>
      </div>
    </div>
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#F4F4F6;height:100%;}
        ::-webkit-scrollbar{display:none;}
        @keyframes cardIn{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes tabIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      <div style={{ maxWidth:430, margin:"0 auto", background:"#F4F4F6", minHeight:"100vh", position:"relative", overflow:"hidden" }}>
        {step > 0 && (
          <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", display:"flex", gap:6, zIndex:10 }}>
            {[1,2,3].map(i=>(
              <div key={i} style={{ width: step>=i?24:8, height:8, borderRadius:8, background: step>=i?PAL.or:"#E0E0E6", transition:"all 0.3s" }}/>
            ))}
          </div>
        )}
        {step > 0 && (
          <div onClick={()=>setStep(s=>s-1)} style={{ position:"fixed", top:14, left:18, zIndex:10 }}><Chip n="back" c="ink" T={T} size={38} is={17} onClick={()=>{}}/></div>
        )}
        <div key={step} style={{ animation:"tabIn 0.3s ease both" }}>
          {SCREENS[step]}
        </div>
      </div>
    </>
  );
}

export default function Risolvero() {
  const [tab, setTab] = useState("home");
  const [navHidden, setNavHidden] = useState(false);
  const [onboarded, setOnboarded] = useState(()=>!!localStorage.getItem("rslv_onboarded"));
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  const [darkMode, setDarkMode] = useState(()=>load("rslv_dark_mode",true));

  // calm-editorial accent (terracotta) for the shared frame
  const navAccent = PAL.or2;

  useEffect(()=>{
    registerSW();
    if(onboarded) scheduleNotifications();
  },[onboarded]);

  useEffect(()=>{
    save("rslv_dark_mode", darkMode);
    document.body.style.background = darkMode ? "#141519" : "#F4F4F6";
    const rootEl = document.getElementById("rslv-root");
    if(rootEl){
      if(darkMode) rootEl.classList.remove("light");
      else rootEl.classList.add("light");
    }
  },[darkMode, tab, onboarded, navHidden, showNotifPrompt]);

  const completeOnboarding = (name) => {
    if(name) save("rslv_display_name", name);
    localStorage.setItem("rslv_onboarded","1");
    setOnboarded(true);
    setTimeout(()=>setShowNotifPrompt(true), 800);
  };

  if(!onboarded) return <OnboardingScreen onComplete={completeOnboarding}/>;

  const pages = {
    home:      <HomePage onNavigate={setTab} darkMode={darkMode}/>,
    fitness:   <FitnessPage onModalChange={setNavHidden} darkMode={darkMode}/>,
    learning:  <LearningPage darkMode={darkMode}/>,
    finance:   <FinancePage onModalChange={setNavHidden} darkMode={darkMode}/>,
    community: <div className="legacy"><CommunityPage onModalChange={setNavHidden}/></div>,
    profile:   <ProfilePage onModalChange={setNavHidden} darkMode={darkMode} setDarkMode={setDarkMode}/>,
  };
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Inter+Tight:wght@400;500;600;700&family=Poppins:wght@400;500;600;700;800&family=Sora:wght@400;500;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
        html{background:${darkMode?"#141519":"#F4F4F6"};-webkit-text-size-adjust:100%;}
        body{background:${darkMode?"#141519":"#F4F4F6"};min-height:100vh;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-y:none;}
        .modal-open-nav{display:none !important;}
        @media (max-height: 500px){ .bottom-nav{ display:none !important; } }
        ::-webkit-scrollbar{display:none;}
        input::placeholder{color:${darkMode?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.25)"};}
        input{color-scheme:${darkMode?"dark":"light"};}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes cardIn{from{opacity:0;transform:translateY(10px) scale(0.97)}to{opacity:1;transform:scale(1)}}
        @keyframes tabIn{from{opacity:0}to{opacity:1}}
        @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}

        /* ============================================
           PREMIUM LIGHT MODE
           Pure white page · cards separated by soft
           shadow + padding · charcoal ink · vibrant accents
           ============================================ */
        #rslv-root.light { background:#F4F4F6 !important; }

        /* page-level dark backgrounds -> white */
        #rslv-root.light .legacy [style*="background: rgb(18, 20, 30)"],
        #rslv-root.light .legacy [style*="background:#12141E"],
        #rslv-root.light .legacy [style*="background: #12141E"] { background:#FFFFFF !important; }

        /* solid dark sheets/modals -> white */
        #rslv-root.light .legacy [style*="background: rgb(26, 29, 46)"],
        #rslv-root.light .legacy [style*="background:#1a1d2e"],
        #rslv-root.light .legacy [style*="background: #1a1d2e"] { background:#FFFFFF !important; }

        /* card fills -> white with soft shadow (separation via depth, not color) */
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.03)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.03)"],
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.04)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.04)"],
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.05)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.05)"],
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.06)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.06)"] {
          background:#FFFFFF !important;
          box-shadow:0 1px 3px rgba(27,27,31,0.05), 0 8px 24px rgba(27,27,31,0.06) !important;
        }
        /* stronger fills (buttons, chips) -> light warm grey */
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.08)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.08)"] { background:rgba(27,27,31,0.05) !important; }

        /* borders -> soft warm hairline */
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.07)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.07)"],
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.1)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.1)"] { border-color:rgba(27,27,31,0.07) !important; }

        /* white text -> charcoal, scaled by importance */
        #rslv-root.light .legacy [style*="color: rgb(255, 255, 255)"],
        #rslv-root.light .legacy [style*="color:#fff"],
        #rslv-root.light .legacy [style*="color: #fff"],
        #rslv-root.light .legacy [style*="color:#ffffff"] { color:#1B1B1F !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.85)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.85)"] { color:rgba(27,27,31,0.9) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.8)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.8)"] { color:rgba(27,27,31,0.85) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.7)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.7)"] { color:rgba(27,27,31,0.75) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.6)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.6)"] { color:rgba(27,27,31,0.68) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.5)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.5)"] { color:rgba(27,27,31,0.75) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.4)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.4)"] { color:rgba(27,27,31,0.72) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.35)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.35)"] { color:rgba(27,27,31,0.7) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.3)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.3)"] { color:rgba(27,27,31,0.7) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.25)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.25)"] { color:rgba(27,27,31,0.68) !important; }
        #rslv-root.light .legacy [style*="rgba(255, 255, 255, 0.2)"],
        #rslv-root.light .legacy [style*="rgba(255,255,255,0.2)"] { color:rgba(27,27,31,0.65) !important; }

        /* progress-bar / circle tracks: white-on-dark -> visible warm grey */
        #rslv-root.light .legacy circle[stroke="rgba(255,255,255,0.12)"] { stroke:rgba(27,27,31,0.1) !important; }
        #rslv-root.light .legacy circle[stroke="rgba(255, 255, 255, 0.12)"] { stroke:rgba(27,27,31,0.1) !important; }

        /* sticky header fade */
        #rslv-root.light .legacy [style*="linear-gradient(180deg,#12141E"],
        #rslv-root.light .legacy [style*="linear-gradient(180deg, #12141E"] { background:linear-gradient(180deg,#F4F4F6 70%,transparent 100%) !important; }

        /* inputs */
        #rslv-root.light .legacy input, #rslv-root.light .legacy textarea, #rslv-root.light .legacy select {
          background:#FFFFFF !important;
          border-color:rgba(27,27,31,0.12) !important;
          color:#1B1B1F !important;
        }
        #rslv-root.light .legacy input::placeholder, #rslv-root.light .legacy textarea::placeholder { color:rgba(27,27,31,0.35) !important; }

        /* bottom nav */
        /* inactive nav buttons -> readable dark grey (active stays terracotta via inline) */

        /* toggles keep their own styling in light mode (don't convert to white card) */
        #rslv-root.light .legacy .rslv-toggle.off { background:rgba(120,120,130,0.22) !important; border-color:rgba(120,120,130,0.5) !important; box-shadow:none !important; }
        #rslv-root.light .legacy .rslv-toggle.on { box-shadow:none !important; }

        /* ── readable accent TEXT in light mode ──
           Pale pastel accents are built for dark bg; on white they wash out.
           Deepen them to a saturated, comfortable-to-read version.
           (Only affects text color, not backgrounds/borders/gradients.) */
        #rslv-root.light .legacy [style*="color: rgb(168, 213, 194)"],
        #rslv-root.light .legacy [style*="color:#A8D5C2"],
        #rslv-root.light .legacy [style*="color: #A8D5C2"] { color:#3F8F6E !important; }   /* mint green */
        #rslv-root.light .legacy [style*="color: rgb(200, 223, 240)"],
        #rslv-root.light .legacy [style*="color:#C8DFF0"],
        #rslv-root.light .legacy [style*="color: #C8DFF0"] { color:#3D7BB0 !important; }   /* sky blue */
        #rslv-root.light .legacy [style*="color: rgb(216, 208, 240)"],
        #rslv-root.light .legacy [style*="color:#D8D0F0"],
        #rslv-root.light .legacy [style*="color: #D8D0F0"] { color:#7A6CB8 !important; }   /* lavender */
        #rslv-root.light .legacy [style*="color: rgb(245, 221, 208)"],
        #rslv-root.light .legacy [style*="color:#F5DDD0"],
        #rslv-root.light .legacy [style*="color: #F5DDD0"] { color:#C06B45 !important; }   /* peach */
        #rslv-root.light .legacy [style*="color: rgb(200, 230, 218)"],
        #rslv-root.light .legacy [style*="color:#C8E6DA"],
        #rslv-root.light .legacy [style*="color: #C8E6DA"] { color:#3F8F6E !important; }   /* soft green */
        #rslv-root.light .legacy [style*="color: rgb(240, 232, 208)"],
        #rslv-root.light .legacy [style*="color:#F0E8D0"],
        #rslv-root.light .legacy [style*="color: #F0E8D0"] { color:#A8862F !important; }   /* gold */
        #rslv-root.light .legacy [style*="color: rgb(237, 208, 240)"],
        #rslv-root.light .legacy [style*="color:#EDD0F0"],
        #rslv-root.light .legacy [style*="color: #EDD0F0"] { color:#A053B0 !important; }   /* pink-purple */
        #rslv-root.light .legacy [style*="color: rgb(255, 179, 71)"],
        #rslv-root.light .legacy [style*="color:#FFB347"],
        #rslv-root.light .legacy [style*="color: #FFB347"] { color:#D88A1E !important; }   /* amber */

        /* community search bar -> clean inset, not floating white card */
        #rslv-root.light .legacy .rslv-search-bar { background:rgba(27,27,31,0.04) !important; border-color:rgba(27,27,31,0.08) !important; box-shadow:none !important; }
        #rslv-root.light .legacy .rslv-search-bar svg { stroke:rgba(27,27,31,0.35) !important; }
        /* community 3-dot button -> clean inset, not floating white card */
        #rslv-root.light .legacy .rslv-menu-btn { background:rgba(27,27,31,0.04) !important; border-color:rgba(27,27,31,0.08) !important; box-shadow:none !important; }

        /* community 3-dot menu dots -> visible dark in light mode */
        #rslv-root.light .legacy .rslv-menu-dot { background:rgba(27,27,31,0.45) !important; }
        /* dark dropdown menus -> white card in light mode */
        #rslv-root.light .legacy [style*="background: rgb(30, 34, 53)"],
        #rslv-root.light .legacy [style*="background:#1e2235"] { background:#FFFFFF !important; box-shadow:0 8px 32px rgba(27,27,31,0.15) !important; }
      `}</style>
      <div id="rslv-root" className={darkMode?"":"light"} style={{ maxWidth:430, margin:"0 auto", minHeight:"100vh", background:darkMode?"#141519":"#F4F4F6", position:"relative", overflowX:"hidden", fontFamily:FONT }}>
        <div style={{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", width:430, height:"100vh", pointerEvents:"none", zIndex:0 }}>
          <div style={{ position:"absolute", top:-60, left:"20%", width:280, height:280, background:darkMode?"radial-gradient(circle,rgba(255,107,44,0.06) 0%,transparent 65%)":"radial-gradient(circle,rgba(255,107,44,0.08) 0%,transparent 65%)", filter:"blur(50px)" }}/>
          <div style={{ position:"absolute", top:100, right:"5%", width:200, height:200, background:darkMode?"radial-gradient(circle,rgba(255,107,44,0.04) 0%,transparent 65%)":"radial-gradient(circle,rgba(255,107,44,0.05) 0%,transparent 65%)", filter:"blur(40px)" }}/>
        </div>
        <div style={{ position:"sticky", top:0, zIndex:10, padding:"52px 18px 12px", background:darkMode?"linear-gradient(180deg,#141519 60%,transparent 100%)":"linear-gradient(180deg,#F4F4F6 70%,transparent 100%)" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:13, fontWeight:800, letterSpacing:"0.22em", color:darkMode?"rgba(245,243,239,0.85)":"rgba(17,17,16,0.7)", fontFamily:FONT }}>RISOLVERO</div>
            <div style={{ fontSize:11, color:darkMode?"rgba(245,243,239,0.3)":"rgba(17,17,16,0.35)", fontFamily:FONT }}>{new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
          </div>
        </div>
        <div key={tab} style={{ position:"relative", zIndex:1, paddingBottom:110, animation:"tabIn 0.25s ease both" }}>
          {pages[tab]}
        </div>
        {/* Notification permission prompt */}
        {showNotifPrompt && typeof Notification !== "undefined" && Notification.permission === "default" && (
          <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center", padding:"0 0 40px" }}>
            <div onClick={()=>setShowNotifPrompt(false)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.5)" }}/>
            <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:darkMode?"#1A1A17":"#FFFFFF", borderRadius:28, padding:"28px 24px", margin:"0 16px", border:`1px solid ${darkMode?"rgba(245,243,239,0.1)":"rgba(17,17,16,0.1)"}`, animation:"sheetUp 0.3s ease both" }}>
              <div style={{ color:navAccent, display:"flex", justifyContent:"center", marginBottom:14 }}><Icons.Bell/></div>
              <div style={{ fontSize:20, fontWeight:700, color:darkMode?"#F5F3EF":"#111110", fontFamily:FONT, textAlign:"center", marginBottom:8, letterSpacing:"-0.02em" }}>Stay on track</div>
              <div style={{ fontSize:14, color:darkMode?"#A8A49B":"#6E6B63", fontFamily:FONT, textAlign:"center", lineHeight:1.6, marginBottom:24 }}>
                Get reminders for your habits, streak alerts and subscription renewals.
              </div>
              <button onClick={async()=>{ await requestNotifPermission(); scheduleNotifications(); setShowNotifPrompt(false); }} style={{ width:"100%", padding:"16px", background:darkMode?"#F5F3EF":"#111110", border:"none", borderRadius:16, fontSize:15, fontWeight:600, fontFamily:FONT, color:darkMode?"#121110":"#F2F1ED", cursor:"pointer", marginBottom:10, letterSpacing:"-0.01em" }}>
                Enable Notifications
              </button>
              <button onClick={()=>setShowNotifPrompt(false)} style={{ width:"100%", padding:"12px", background:"none", border:"none", fontSize:13, fontFamily:FONT, color:darkMode?"#6E6A62":"#9A988F", cursor:"pointer" }}>
                Not now
              </button>
            </div>
          </div>
        )}

        {!navHidden && (
        <div className="bottom-nav" style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, padding:"0 16px", zIndex:20, paddingBottom:"max(14px, env(safe-area-inset-bottom))" }}>
          <div style={{ background:"linear-gradient(180deg,#2C2D33 0%,#141519 60%,#0D0E11 100%)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:24, height:64, display:"flex", justifyContent:"space-around", alignItems:"center", boxShadow:"0 16px 34px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.10)" }}>
            {TABS.map(({id,label})=>{
              const active=tab===id;
              const NI={home:"home",fitness:"fit",learning:"book",finance:"wallet",profile:"user"};
              return (
                <button key={id} onClick={()=>setTab(id)} style={{ flex:1, height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, background:"none", border:"none", cursor:"pointer", color:active?PAL.or2:"#FFFFFF", opacity:active?1:0.55, transition:"color .2s, opacity .2s" }}>
                  <Ic n={NI[id]||"target"} s={23}/>
                  <span style={{ fontSize:9.5, fontWeight:active?700:500, fontFamily:FONT }}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
        )}
      </div>
    </>
  );
}
