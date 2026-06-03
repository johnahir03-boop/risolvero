import { useState, useEffect, useRef } from "react";

// ── NOTIFICATIONS ────────────────────────────────────────
const NOTIF_KEY = "rslv_notif_time";

async function registerSW() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("/sw.js"); } catch {}
  }
}

async function requestNotifPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function scheduleNotifications() {
  if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then(reg => {
    if (!reg.active) return;
    const notifs = load("rslv_notifs", { habits:true, streak:true, finance:true });
    const reminderTime = load(NOTIF_KEY, "09:00");
    const [hours, minutes] = reminderTime.split(":").map(Number);
    const now = new Date();

    // Daily habit reminder
    if (notifs.habits) {
      let next = new Date();
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const delay = next - now;
      const habits = load("rslv_habits", []);
      const done = load("rslv_done", { date:"", checked:{} });
      const todayDone = done.date === new Date().toISOString().slice(0,10);
      const allComplete = habits.length > 0 && habits.every(h => done.checked?.[h.id]);
      if (!todayDone || !allComplete) {
        reg.active.postMessage({ type:"SCHEDULE_NOTIFICATION", title:"🌱 Risolvero", body:`${habits.length} habit${habits.length!==1?"s":""} waiting for you today. Keep your streak going!`, delay, tag:"daily-habit" });
      }
    }

    // Streak reminder — 8pm if not opened
    if (notifs.streak) {
      const streak = load("rslv_streak", 0);
      if (streak > 0) {
        let streakReminder = new Date();
        streakReminder.setHours(20, 0, 0, 0);
        if (streakReminder <= now) streakReminder.setDate(streakReminder.getDate() + 1);
        reg.active.postMessage({ type:"SCHEDULE_NOTIFICATION", title:`🔥 ${streak} day streak at risk!`, body:"Complete your habits today to keep your streak alive.", delay: streakReminder - now, tag:"streak" });
      }
    }

    // Subscription reminders
    if (notifs.finance) {
      const subs = load("rslv_subs", []);
      subs.filter(s => s.reminder).forEach(s => {
        const renewDate = new Date(s.nextDate);
        const twoDaysBefore = new Date(renewDate);
        twoDaysBefore.setDate(twoDaysBefore.getDate() - 2);
        twoDaysBefore.setHours(9, 0, 0, 0);
        if (twoDaysBefore > now) {
          reg.active.postMessage({ type:"SCHEDULE_NOTIFICATION", title:`💳 ${s.name} renews in 2 days`, body:`${s.name} will charge you soon. Check your Finance section.`, delay: twoDaysBefore - now, tag:`sub-${s.id}` });
        }
      });
    }
  });
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

const TODAY = () => new Date().toISOString().slice(0, 10);
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

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

function GrowthCircle({ score }) {
  const [disp, setDisp] = useState(0);
  const [prog, setProg] = useState(0);
  const prevRef = useRef(0);
  const R = 72, C = 2 * Math.PI * R;

  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = score;
    let raf, t0;
    const run = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / 800, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisp(Math.round(from + e * (score - from)));
      setProg(from + e * (score - from));
      if (p < 1) raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const offset = C - (prog / 100) * C;

  return (
    <div style={{ position:"relative", width:160, height:160, flexShrink:0 }}>
      <div style={{ position:"absolute", inset:-10, borderRadius:"50%", background:"radial-gradient(circle,rgba(168,213,194,0.1) 0%,transparent 70%)", filter:"blur(12px)" }}/>
      <svg width="160" height="160" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
        <circle cx="80" cy="80" r={R} fill="none" stroke="url(#sg)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset}
          style={{ transition:"stroke-dashoffset 0.04s linear" }}/>
        <defs>
          <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#A8D5C2"/>
            <stop offset="100%" stopColor="#C5B8E8"/>
          </linearGradient>
        </defs>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1 }}>
        <div style={{ fontSize:42, fontWeight:800, lineHeight:1, fontFamily:"'Sora',sans-serif", color:"#fff", letterSpacing:"-2px" }}>{disp}</div>
        <div style={{ fontSize:9, letterSpacing:"0.2em", color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", textTransform:"uppercase", fontWeight:600 }}>/100</div>
      </div>
    </div>
  );
}

const EMOJI_OPTIONS = ["🏃","📖","💧","💰","🧘","🥗","💪","🚴","✍️","🎯","🌅","🛌","🧠","🎨","🎸","📝","🚶","🍎","☀️","🌿"];

function AddHabitModal({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🎯");
  const submit = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), emoji });
    onClose();
  };
  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
        {/* scrollable content */}
        <div style={{ overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"24px 22px 8px", flex:1 }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>New Habit</div>
            <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close /></button>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>Habit Name</div>
            <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="e.g. Morning walk"
              style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:15, fontFamily:"'Sora',sans-serif", fontWeight:500, outline:"none" }}/>
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:10 }}>Pick an Icon</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {EMOJI_OPTIONS.map(e=>(
                <button key={e} onClick={()=>setEmoji(e)} style={{ width:42, height:42, borderRadius:12, fontSize:20, background:emoji===e?"rgba(168,213,194,0.2)":"rgba(255,255,255,0.05)", border:emoji===e?"1.5px solid rgba(168,213,194,0.5)":"1px solid rgba(255,255,255,0.08)", cursor:"pointer", transition:"all 0.15s", display:"flex", alignItems:"center", justifyContent:"center" }}>{e}</button>
              ))}
            </div>
          </div>
        </div>
        {/* fixed save button */}
        <div style={{ padding:"12px 22px 44px", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={submit} disabled={!name.trim()} style={{ width:"100%", padding:"16px", background:name.trim()?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:name.trim()?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:name.trim()?"pointer":"not-allowed", transition:"all 0.2s" }}>
            Add Habit
          </button>
        </div>
      </div>
    </div>
  );
}

function HabitCard({ habit, done, pts, onToggle, onDelete, colorIdx, delay }) {
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef(null);
  const c = PALETTE[colorIdx % PALETTE.length];
  const startHold = () => { holdTimer.current = setTimeout(() => setHolding(true), 600); };
  const endHold   = () => { clearTimeout(holdTimer.current); setHolding(false); };
  return (
    <div style={{ position:"relative" }}>
      <div onClick={()=>!holding&&onToggle()} onMouseDown={startHold} onMouseUp={endHold} onMouseLeave={endHold} onTouchStart={startHold} onTouchEnd={endHold}
        style={{ background:done?c.bg:"rgba(255,255,255,0.05)", border:done?"none":"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"16px 15px", cursor:"pointer", transition:"all 0.25s ease", animation:`cardIn 0.4s ease ${delay}s both`, display:"flex", flexDirection:"column", justifyContent:"space-between", minHeight:110, position:"relative", overflow:"hidden", transform:holding?"scale(0.96)":"scale(1)", boxShadow:done?`0 4px 20px ${c.bg}30`:"none" }}>
        {done&&<div style={{ position:"absolute", top:-20, right:-20, width:80, height:80, borderRadius:"50%", background:`${c.check}15` }}/>}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div style={{ fontSize:22 }}>{habit.emoji}</div>
          <div style={{ width:24, height:24, borderRadius:"50%", background:done?c.check:"rgba(255,255,255,0.1)", border:done?"none":"1.5px solid rgba(255,255,255,0.15)", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s", flexShrink:0, boxShadow:done?`0 2px 8px ${c.check}50`:"none" }}>
            {done&&<Icons.Check/>}
          </div>
        </div>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:done?c.text:"rgba(255,255,255,0.8)", fontFamily:"'Sora',sans-serif", lineHeight:1.25, marginBottom:3 }}>{habit.name}</div>
          <div style={{ fontSize:11, fontWeight:500, color:done?c.sub:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif" }}>+{pts} pts</div>
        </div>
      </div>
      {holding&&(
        <button onClick={e=>{e.stopPropagation();onDelete();setHolding(false);}} style={{ position:"absolute", inset:0, borderRadius:20, background:"rgba(220,80,80,0.9)", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, color:"#fff", animation:"fadeIn 0.15s ease both" }}>
          <Icons.Trash/><span style={{ fontSize:11, fontWeight:700, fontFamily:"'Sora',sans-serif" }}>Remove</span>
        </button>
      )}
    </div>
  );
}

function HomePage({ onNavigate=()=>{} }) {
  const hr = new Date().getHours();
  const greeting = hr<5?"Good night":hr<12?"Good morning":hr<17?"Good afternoon":hr<21?"Good evening":"Good night";
  const displayName = load("rslv_display_name","");
  const [habits, setHabits] = useState(()=>load("rslv_habits",[]));
  const [done, setDone] = useState(()=>{ const s=load("rslv_done",{date:"",checked:{}}); return s.date===TODAY()?s.checked:{}; });
  const [streak, setStreak] = useState(()=>load("rslv_streak",0));
  const [showAdd, setShowAdd] = useState(false);

  useEffect(()=>{ save("rslv_habits",habits); },[habits]);
  useEffect(()=>{ save("rslv_done",{date:TODAY(),checked:done}); },[done]);

  const pts = habits.length>0 ? Math.floor(100/habits.length) : 0;
  const doneCount = habits.filter(h=>done[h.id]).length;
  const score = habits.length===0 ? 0 : doneCount===habits.length ? 100 : doneCount*pts;

  const addHabit = ({name,emoji})=>{ setHabits(p=>[...p,{id:Date.now().toString(),name,emoji}]); };
  const deleteHabit = id=>{ setHabits(p=>p.filter(h=>h.id!==id)); setDone(p=>{const n={...p};delete n[id];return n;}); };
  const toggle = id=>{
    setDone(p=>{
      const next={...p,[id]:!p[id]};
      const allDone=habits.length>0&&habits.every(h=>next[h.id]);
      if(allDone){ save("rslv_last_complete_date",TODAY()); setStreak(s=>{const ns=s+1;save("rslv_streak",ns);return ns;}); }
      return next;
    });
  };

  const msg = score===0?"What will you achieve today?":score<40?"You've started. Keep going.":score<70?"More than halfway. Finish strong.":score<100?"Almost there. One more habit.":"Perfect day. You showed up. 🔥";

  return (
    <div style={{ padding:"0 18px 32px" }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:22, animation:"fadeUp 0.4s ease both" }}>
        <div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:5 }}>
            {new Date().toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}
          </div>
          <div style={{ fontSize:26, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px", lineHeight:1.1 }}>{greeting}{displayName ? `, ${displayName}` : ""} 👋</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", marginTop:5, fontFamily:"'Sora',sans-serif" }}>{msg}</div>
        </div>
        <div style={{ width:42, height:42, borderRadius:14, flexShrink:0, background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, fontWeight:800, color:"#1a1a2e", fontFamily:"'Sora',sans-serif", boxShadow:"0 4px 16px rgba(168,213,194,0.2)" }}>R</div>
      </div>

      <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:26, padding:"22px 20px", display:"flex", alignItems:"center", gap:18, marginBottom:18, animation:"fadeUp 0.4s ease 0.07s both" }}>
        <GrowthCircle score={score}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, letterSpacing:"0.14em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:6 }}>Growth Score</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", marginBottom:12 }}>{habits.length===0?"Add your first habit below":`${doneCount} of ${habits.length} habits done`}</div>
          {habits.length>0&&(
            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
              {habits.map(h=>(
                <div key={h.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ fontSize:11 }}>{h.emoji}</div>
                  <div style={{ flex:1, height:4, borderRadius:4, background:"rgba(255,255,255,0.07)", overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:4, width:done[h.id]?"100%":"0%", background:"linear-gradient(90deg,#A8D5C2,#C5B8E8)", transition:"width 0.4s ease" }}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, animation:"fadeUp 0.4s ease 0.12s both" }}>
        <div style={{ fontSize:11, letterSpacing:"0.14em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:700 }}>Today's Habits</div>
        {habits.length>0&&<div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif" }}>{doneCount}/{habits.length} done</div>}
      </div>

      {habits.length>0?(
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
          {habits.map((h,i)=><HabitCard key={h.id} habit={h} done={!!done[h.id]} pts={pts} onToggle={()=>toggle(h.id)} onDelete={()=>deleteHabit(h.id)} colorIdx={i} delay={0.14+i*0.05}/>)}
        </div>
      ):(
        <div style={{ padding:"32px 20px", textAlign:"center", background:"rgba(255,255,255,0.03)", borderRadius:20, marginBottom:12, border:"1px dashed rgba(255,255,255,0.08)", animation:"fadeUp 0.4s ease 0.16s both" }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🌱</div>
          <div style={{ fontSize:14, fontWeight:700, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>No habits yet</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", lineHeight:1.6 }}>Add your first habit and start growing today</div>
        </div>
      )}

      <div onClick={()=>setShowAdd(true)} style={{ padding:"15px 18px", borderRadius:20, border:"1px dashed rgba(255,255,255,0.1)", display:"flex", alignItems:"center", justifyContent:"center", gap:8, cursor:"pointer", color:"rgba(255,255,255,0.25)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:600, animation:"fadeUp 0.4s ease 0.3s both", marginBottom:14 }}>
        <Icons.Plus/> Add a habit
      </div>

      {/* Quick Actions */}
      {(() => {
        const ALL_ACTIONS = [
          { id:"learn",      emoji:"📖", label:"Learn 5 words",    tab:"learning",   color:"#D8D0F0" },
          { id:"logfood",    emoji:"🍽️", label:"Log food",         tab:"fitness",    color:"#F5DDD0" },
          { id:"water",      emoji:"💧", label:"Log water",         tab:"fitness",    color:"#C8DFF0" },
          { id:"expense",    emoji:"💰", label:"Add expense",       tab:"finance",    color:"#C8E6DA" },
          { id:"habit",      emoji:"✅", label:"Add habit",         tab:"home",       color:"#A8D5C2" },
          { id:"workout",    emoji:"🏃", label:"Log workout",       tab:"fitness",    color:"#F5DDD0" },
          { id:"walk",       emoji:"🚶", label:"Log walk",          tab:"fitness",    color:"#C8E6DA" },
          { id:"finance",    emoji:"📊", label:"View finance",      tab:"finance",    color:"#C8E6DA" },
          { id:"learning",   emoji:"🌍", label:"Learning session",  tab:"learning",   color:"#D8D0F0" },
          { id:"challenges", emoji:"⚡", label:"Challenges",        tab:"community",  color:"#F0E8D0" },
          { id:"community",  emoji:"🤝", label:"Community feed",    tab:"community",  color:"#C8DFF0" },
          { id:"subscription",emoji:"📱",label:"Add subscription",  tab:"finance",    color:"#EDD0F0" },
          { id:"profile",    emoji:"⚙️", label:"Settings",          tab:"profile",    color:"#F0D0D8" },
          { id:"barcode",    emoji:"📷", label:"Scan barcode",      tab:"fitness",    color:"#F5DDD0" },
        ];

        const [activeActions, setActiveActions] = useState(()=>load("rslv_quick_actions",["learn","logfood","water","expense"]));
        const [editMode, setEditMode] = useState(false);

        const saveActions = (ids) => { setActiveActions(ids); save("rslv_quick_actions",ids); };
        const toggle = (id) => {
          if(activeActions.includes(id)) {
            if(activeActions.length>1) saveActions(activeActions.filter(x=>x!==id));
          } else {
            if(activeActions.length<4) saveActions([...activeActions,id]);
          }
        };

        const visible = ALL_ACTIONS.filter(a=>activeActions.includes(a.id));

        return (
          <div style={{ marginBottom:14, animation:"fadeUp 0.4s ease 0.32s both" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>Quick Actions</div>
              <button onClick={()=>setEditMode(e=>!e)} style={{ background:editMode?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.06)", border:editMode?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"5px 12px", cursor:"pointer", color:editMode?"#A8D5C2":"rgba(255,255,255,0.4)", fontSize:11, fontFamily:"'Sora',sans-serif", fontWeight:700 }}>
                {editMode ? "Done" : "Edit"}
              </button>
            </div>

            {editMode ? (
              <div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginBottom:10 }}>Pick up to 4 actions ({activeActions.length}/4 selected)</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {ALL_ACTIONS.map(a=>{
                    const selected = activeActions.includes(a.id);
                    return (
                      <div key={a.id} onClick={()=>toggle(a.id)} style={{ background:selected?`${a.color}20`:"rgba(255,255,255,0.04)", border:selected?`1.5px solid ${a.color}40`:"1px solid rgba(255,255,255,0.08)", borderRadius:14, padding:"11px 12px", display:"flex", alignItems:"center", gap:8, cursor:"pointer", transition:"all 0.15s" }}>
                        <span style={{ fontSize:18 }}>{a.emoji}</span>
                        <span style={{ fontSize:11, fontWeight:600, color:selected?a.color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", flex:1 }}>{a.label}</span>
                        {selected && <div style={{ width:16, height:16, borderRadius:"50%", background:a.color, display:"flex", alignItems:"center", justifyContent:"center" }}><Icons.Check/></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {visible.map(a=>(
                  <div key={a.id} onClick={()=>{ if(a.id==="habit") setShowAdd(true); else onNavigate(a.tab); }} style={{ background:`${a.color}15`, border:`1px solid ${a.color}25`, borderRadius:16, padding:"13px 14px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", transition:"all 0.2s" }}>
                    <span style={{ fontSize:20 }}>{a.emoji}</span>
                    <span style={{ fontSize:12, fontWeight:700, color:a.color, fontFamily:"'Sora',sans-serif" }}>{a.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{ padding:"14px 18px", borderRadius:20, background:"rgba(255,179,71,0.07)", border:"1px solid rgba(255,179,71,0.13)", display:"flex", alignItems:"center", gap:12, animation:"fadeUp 0.4s ease 0.35s both" }}>
        <div style={{ fontSize:22 }}>🔥</div>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,210,140,0.8)", fontFamily:"'Sora',sans-serif" }}>{streak} day streak</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", marginTop:1 }}>{streak===0?"Complete all habits to start your streak":"Keep it going. Don't break the chain."}</div>
        </div>
      </div>

      {showAdd&&<AddHabitModal onAdd={addHabit} onClose={()=>setShowAdd(false)}/>}
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

function JarInfoModal({ jar, allocated, spent, onBorrow, onClose }) {
  const remaining = allocated - spent;
  const pct = Math.min(100, (spent/allocated)*100);
  const depleted = remaining < 0;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 48px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>
        {/* jar header */}
        <div style={{ background:jar.color, borderRadius:20, padding:"18px 18px 16px", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
            <div style={{ fontSize:32 }}>{jar.emoji}</div>
            <div>
              <div style={{ fontSize:20, fontWeight:800, color:jar.text, fontFamily:"'Sora',sans-serif" }}>{jar.label}</div>
              <div style={{ fontSize:12, color:jar.text, opacity:0.5, fontFamily:"'Sora',sans-serif" }}>{Math.round(jar.pct*100)}% of your salary</div>
            </div>
          </div>
          {/* amounts */}
          <div style={{ display:"flex", gap:10, marginBottom:10 }}>
            <div style={{ flex:1, background:`${jar.text}10`, borderRadius:12, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:jar.text, opacity:0.5, fontFamily:"'Sora',sans-serif", marginBottom:2 }}>Allocated</div>
              <div style={{ fontSize:16, fontWeight:800, color:jar.text, fontFamily:"'Sora',sans-serif" }}>€{allocated.toFixed(0)}</div>
            </div>
            <div style={{ flex:1, background:`${jar.text}10`, borderRadius:12, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:jar.text, opacity:0.5, fontFamily:"'Sora',sans-serif", marginBottom:2 }}>Spent</div>
              <div style={{ fontSize:16, fontWeight:800, color:jar.text, fontFamily:"'Sora',sans-serif" }}>€{spent.toFixed(0)}</div>
            </div>
            <div style={{ flex:1, background:`${jar.text}10`, borderRadius:12, padding:"10px 12px" }}>
              <div style={{ fontSize:10, color:jar.text, opacity:0.5, fontFamily:"'Sora',sans-serif", marginBottom:2 }}>Left</div>
              <div style={{ fontSize:16, fontWeight:800, color:depleted?"#c0392b":jar.text, fontFamily:"'Sora',sans-serif" }}>€{Math.max(0,remaining).toFixed(0)}</div>
            </div>
          </div>
          {/* drain bar */}
          <div style={{ height:6, borderRadius:6, background:`${jar.text}20`, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:6, width:`${pct}%`, background:depleted?"#c0392b":`${jar.text}60`, transition:"width 0.4s ease" }}/>
          </div>
        </div>
        {/* explanation */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.75)", fontFamily:"'Sora',sans-serif", lineHeight:1.7, marginBottom:14 }}>{jar.desc}</div>
          <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"13px 15px" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.1em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>Examples</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", lineHeight:1.6 }}>{jar.examples}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={()=>{ onBorrow(); }} style={{ flex:1, padding:"14px", background:"rgba(240,208,216,0.15)", border:"1px solid rgba(240,208,216,0.25)", borderRadius:16, fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", color:"#F0D0D8", cursor:"pointer" }}>
            💸 Borrow Money
          </button>
          <button onClick={onClose} style={{ flex:1, padding:"14px", background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", color:"rgba(255,255,255,0.5)", cursor:"pointer" }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function AddExpenseModal({ onAdd, onClose }) {
  const [amount, setAmount] = useState("");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState(null);
  const [note, setNote] = useState("");
  const [step, setStep] = useState("category"); // "category" | "amount"

  const results = search.trim().length === 0 ? [] : EXPENSE_CATS.filter(c =>
    c.label.toLowerCase().includes(search.toLowerCase()) ||
    c.tags.some(t => t.includes(search.toLowerCase()))
  ).slice(0, 6);

  const selectCat = (c) => { setCat(c); setStep("amount"); };

  const selectJarManually = (jarKey) => {
    const jar = JARS.find(j => j.key === jarKey);
    setCat({ label: search.trim() || jar.label, jar: jarKey, emoji: jar.emoji });
    setStep("amount");
  };

  const submit = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0 || !cat) return;
    onAdd({ amount: n, cat: cat.label, jar: cat.jar, emoji: cat.emoji, note: note.trim(), date: TODAY() });
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"88vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>
            {step === "category" ? "What did you spend on?" : `Add ${cat?.emoji} ${cat?.label}`}
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>

        {step === "category" && (
          <>
            {/* search input */}
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search — Netflix, rent, groceries..."
              style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:15, fontFamily:"'Sora',sans-serif", fontWeight:500, outline:"none", marginBottom:14 }}
            />

            {/* search results */}
            {results.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
                {results.map(c => (
                  <div key={c.label} onClick={() => selectCat(c)} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 15px", borderRadius:14, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", cursor:"pointer", transition:"all 0.15s" }}>
                    <span style={{ fontSize:20 }}>{c.emoji}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.9)", fontFamily:"'Sora',sans-serif" }}>{c.label}</div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif" }}>→ {JARS.find(j=>j.key===c.jar)?.emoji} {JARS.find(j=>j.key===c.jar)?.label} jar</div>
                    </div>
                    <div style={{ fontSize:18, color:"rgba(255,255,255,0.15)" }}>›</div>
                  </div>
                ))}
              </div>
            )}

            {/* no results — show manual jar picker */}
            {search.trim().length > 0 && results.length === 0 && (
              <div style={{ marginBottom:18 }}>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:12, textAlign:"center" }}>
                  Not found — pick a jar manually
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {JARS.map(jar => (
                    <div key={jar.key} onClick={() => selectJarManually(jar.key)} style={{ background:jar.color, borderRadius:16, padding:"13px 14px", cursor:"pointer", transition:"all 0.15s" }}>
                      <div style={{ fontSize:20, marginBottom:4 }}>{jar.emoji}</div>
                      <div style={{ fontSize:12, fontWeight:700, color:jar.text, fontFamily:"'Sora',sans-serif" }}>{jar.label}</div>
                      <div style={{ fontSize:10, color:jar.text, opacity:0.5, fontFamily:"'Sora',sans-serif" }}>{Math.round(jar.pct*100)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* default: show jar cards when no search */}
            {search.trim().length === 0 && (
              <div>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:10 }}>Or pick a jar directly</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {JARS.map(jar => (
                    <div key={jar.key} onClick={() => selectJarManually(jar.key)} style={{ background:jar.color, borderRadius:16, padding:"13px 14px", cursor:"pointer", transition:"all 0.15s" }}>
                      <div style={{ fontSize:20, marginBottom:4 }}>{jar.emoji}</div>
                      <div style={{ fontSize:12, fontWeight:700, color:jar.text, fontFamily:"'Sora',sans-serif" }}>{jar.label}</div>
                      <div style={{ fontSize:10, color:jar.text, opacity:0.5, fontFamily:"'Sora',sans-serif" }}>{Math.round(jar.pct*100)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {step === "amount" && (
          <>
            {/* selected category pill */}
            <div onClick={() => setStep("category")} style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"8px 14px", borderRadius:20, background:"rgba(168,213,194,0.1)", border:"1px solid rgba(168,213,194,0.2)", cursor:"pointer", marginBottom:20 }}>
              <span style={{ fontSize:16 }}>{cat?.emoji}</span>
              <span style={{ fontSize:13, fontWeight:600, color:"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>{cat?.label}</span>
              <span style={{ fontSize:11, color:"rgba(168,213,194,0.5)", fontFamily:"'Sora',sans-serif" }}>· {JARS.find(j=>j.key===cat?.jar)?.label}</span>
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif" }}>change</span>
            </div>

            {/* amount */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>Amount (€)</div>
              <input autoFocus type="number" value={amount} onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="0.00"
                style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:26, fontFamily:"'Sora',sans-serif", fontWeight:800, outline:"none" }}/>
            </div>

            {/* note */}
            <div style={{ marginBottom:22 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>Note (optional)</div>
              <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Lidl groceries"
                style={{ width:"100%", padding:"13px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
            </div>

            <button onClick={submit} disabled={!amount||parseFloat(amount)<=0} style={{ width:"100%", padding:"16px", background:amount&&parseFloat(amount)>0?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:amount&&parseFloat(amount)>0?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:amount&&parseFloat(amount)>0?"pointer":"not-allowed", transition:"all 0.2s" }}>
              Add Expense
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BorrowModal({ needyJar, allJars, onBorrow, onClose }) {
  const [fromJar, setFromJar] = useState(null);
  const [amount, setAmount] = useState("");
  const otherJars = allJars.filter(j=>j.key !== needyJar.key);
  const submit = () => {
    const n = parseFloat(amount);
    if (!n||n<=0||!fromJar) return;
    onBorrow({ fromJar: fromJar.key, toJar: needyJar.key, amount: n });
    onClose();
  };
  return (
    <div style={{ position:"fixed", inset:0, zIndex:110, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Borrow Money</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:20 }}>
          Moving money into {needyJar.emoji} {needyJar.label}. Remember to return it next salary.
        </div>
        {/* pick source jar */}
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:10 }}>Take from which jar?</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:18 }}>
          {otherJars.map(jar=>(
            <div key={jar.key} onClick={()=>setFromJar(jar)} style={{ background:jar.color, borderRadius:16, padding:"13px 14px", cursor:"pointer", border: fromJar?.key===jar.key?"3px solid rgba(0,0,0,0.3)":"3px solid transparent", transition:"all 0.15s", opacity: fromJar && fromJar.key!==jar.key ? 0.6 : 1 }}>
              <div style={{ fontSize:20, marginBottom:4 }}>{jar.emoji}</div>
              <div style={{ fontSize:12, fontWeight:700, color:jar.text, fontFamily:"'Sora',sans-serif" }}>{jar.label}</div>
            </div>
          ))}
        </div>
        {/* amount */}
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>Amount (€)</div>
          <input autoFocus type="number" value={amount} onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="0.00"
            style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:22, fontFamily:"'Sora',sans-serif", fontWeight:800, outline:"none" }}/>
        </div>
        <button onClick={submit} disabled={!fromJar||!amount||parseFloat(amount)<=0} style={{ width:"100%", padding:"16px", background:fromJar&&amount&&parseFloat(amount)>0?"linear-gradient(135deg,#F5DDD0,#F0D0D8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:fromJar&&amount&&parseFloat(amount)>0?"#2e1a10":"rgba(255,255,255,0.2)", cursor:fromJar&&amount&&parseFloat(amount)>0?"pointer":"not-allowed", transition:"all 0.2s" }}>
          Borrow Money
        </button>
      </div>
    </div>
  );
}

function SalaryModal({ current, onSave, onClose }) {
  const [val, setVal] = useState(current > 0 ? String(current) : "");
  const submit = () => { const n = parseFloat(val); if (!n||n<=0) return; onSave(n); onClose(); };
  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Monthly Salary</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>Enter your monthly salary (€)</div>
          <input autoFocus type="number" value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="e.g. 2500"
            style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:22, fontFamily:"'Sora',sans-serif", fontWeight:800, outline:"none" }}/>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", marginTop:8, lineHeight:1.6 }}>
            App will automatically split this into your 6 jars based on T. Harv Eker's system.
          </div>
        </div>
        <button onClick={submit} disabled={!val||parseFloat(val)<=0} style={{ width:"100%", padding:"16px", background:val&&parseFloat(val)>0?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:val&&parseFloat(val)>0?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:val&&parseFloat(val)>0?"pointer":"not-allowed", transition:"all 0.2s" }}>
          Save Salary
        </button>
      </div>
    </div>
  );
}

function AddSubForm({ onAdd, currency }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("1");
  const [emoji, setEmoji] = useState("📱");
  const [reminder, setReminder] = useState(true);

  const COMMON_SUBS = [
    {name:"Netflix",emoji:"🎬",amount:"15.99"},{name:"Spotify",emoji:"🎵",amount:"9.99"},
    {name:"Disney+",emoji:"✨",amount:"8.99"},{name:"Amazon Prime",emoji:"📦",amount:"4.99"},
    {name:"YouTube Premium",emoji:"▶️",amount:"13.99"},{name:"Apple TV+",emoji:"🍎",amount:"8.99"},
  ];

  const nextDate = () => {
    const today = new Date();
    const d = parseInt(day)||1;
    let next = new Date(today.getFullYear(), today.getMonth(), d);
    if(next <= today) next = new Date(today.getFullYear(), today.getMonth()+1, d);
    return next.toISOString().split("T")[0];
  };

  const submit = () => {
    if(!name.trim()||!amount) return;
    onAdd({ name:name.trim(), amount:parseFloat(amount), emoji, nextDate:nextDate(), reminder, jar:"play" });
  };

  return (
    <div>
      <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>Quick Pick</div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
        {COMMON_SUBS.map(s=>(
          <div key={s.name} onClick={()=>{ setName(s.name); setAmount(s.amount); setEmoji(s.emoji); }} style={{ padding:"7px 12px", borderRadius:12, background:name===s.name?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border:name===s.name?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.08)", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:14 }}>{s.emoji}</span>
            <span style={{ fontSize:12, fontWeight:600, color:name===s.name?"#A8D5C2":"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif" }}>{s.name}</span>
          </div>
        ))}
      </div>
      {[
        {label:"Name",val:name,set:setName,placeholder:"e.g. Netflix"},
        {label:`Amount (${currency})`,val:amount,set:setAmount,placeholder:"9.99",type:"number"},
        {label:"Renewal Day of Month",val:day,set:setDay,placeholder:"e.g. 15",type:"number"},
      ].map(({label,val,set,placeholder,type="text"})=>(
        <div key={label} style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>{label}</div>
          <input type={type} value={val} onChange={e=>set(e.target.value)} placeholder={placeholder}
            style={{ width:"100%", padding:"13px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:15, fontFamily:"'Sora',sans-serif", fontWeight:600, outline:"none" }}/>
        </div>
      ))}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:"rgba(255,255,255,0.04)", borderRadius:14, marginBottom:20 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.8)", fontFamily:"'Sora',sans-serif" }}>🔔 Remind me before renewal</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>Get notified 2 days before charge</div>
        </div>
        <div onClick={()=>setReminder(r=>!r)} style={{ width:44, height:26, borderRadius:13, background:reminder?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.1)", position:"relative", cursor:"pointer", transition:"all 0.25s", flexShrink:0 }}>
          <div style={{ position:"absolute", top:3, left:reminder?20:3, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"all 0.25s", boxShadow:"0 2px 6px rgba(0,0,0,0.3)" }}/>
        </div>
      </div>
      <button onClick={submit} disabled={!name.trim()||!amount} style={{ width:"100%", padding:"15px", background:name.trim()&&amount?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:name.trim()&&amount?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:name.trim()&&amount?"pointer":"not-allowed" }}>
        Add Subscription
      </button>
    </div>
  );
}

function FinancePage({ onModalChange=()=>{} }) {
  const [salary, setSalary] = useState(()=>load("rslv_salary", 0));
  const [expenses, setExpenses] = useState(()=>load("rslv_expenses", []));
  const [loans, setLoans] = useState(()=>load("rslv_loans", []));
  const [showSalary, setShowSalary] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [selectedJar, setSelectedJar] = useState(null);
  const [borrowFromJar, setBorrowFromJar] = useState(null);
  const [returnBannerDismissed, setReturnBannerDismissed] = useState(false);
  const [showJarInfo, setShowJarInfo] = useState(false);
  const [subs, setSubs] = useState(()=>load("rslv_subs",[]));
  const [showAddSub, setShowAddSub] = useState(false);
  const currency = load("rslv_currency","€");

  useEffect(()=>{ save("rslv_subs",subs); },[subs]);

  const openModal  = (fn) => { onModalChange(true);  fn(); };
  const closeModal = (fn) => { onModalChange(false); fn(); };

  useEffect(()=>{ save("rslv_salary", salary); }, [salary]);
  useEffect(()=>{ save("rslv_expenses", expenses); }, [expenses]);
  useEffect(()=>{ save("rslv_loans", loans); }, [loans]);

  const addExpense = (exp) => setExpenses(p=>[{ id:Date.now().toString(), ...exp }, ...p]);
  const deleteExpense = (id) => setExpenses(p=>p.filter(e=>e.id!==id));

  const spentPerJar = (jarKey) => expenses.filter(e=>e.jar===jarKey).reduce((a,e)=>a+e.amount, 0);
  const totalSpent = expenses.reduce((a,e)=>a+e.amount, 0);
  const totalSaved = salary > 0 ? Math.max(0, salary - totalSpent) : 0;

  const lentFromJar   = (jarKey) => loans.filter(l=>l.from===jarKey && !l.returned).reduce((a,l)=>a+l.amount,0);
  const borrowedByJar = (jarKey) => loans.filter(l=>l.to===jarKey && !l.returned).reduce((a,l)=>a+l.amount,0);
  const activeLoans   = loans.filter(l=>!l.returned);
  const showReturnBanner = activeLoans.length > 0 && !returnBannerDismissed;

  const borrowMoney = ({fromJar, toJar, amount}) => {
    setLoans(p=>[...p, { id:Date.now().toString(), from:fromJar, to:toJar, amount, date:TODAY(), returned:false }]);
  };

  const returnLoan = (loanId) => {
    setLoans(p=>p.map(l=>l.id===loanId ? {...l, returned:true, returnedDate:TODAY()} : l));
  };

  const handleSetSalary = (newSalary) => {
    setSalary(newSalary);
    setReturnBannerDismissed(false);
  };

  return (
    <div style={{ padding:"0 18px 32px" }}>
      {/* header */}
      <div style={{ marginBottom:22, animation:"fadeUp 0.4s ease both" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:5 }}>YOUR MONEY</div>
            <div style={{ fontSize:26, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>Finance</div>
          </div>
          <button onClick={()=>{ onModalChange(true); setShowJarInfo(true); }} style={{ background:"rgba(168,213,194,0.1)", border:"1px solid rgba(168,213,194,0.2)", borderRadius:12, padding:"8px 14px", cursor:"pointer", color:"#A8D5C2", fontSize:12, fontFamily:"'Sora',sans-serif", fontWeight:700 }}>ℹ️ How it works</button>
        </div>
      </div>

      {/* return loans banner */}
      {showReturnBanner && (
        <div style={{ background:"rgba(240,208,216,0.1)", border:"1px solid rgba(240,208,216,0.25)", borderRadius:18, padding:"14px 16px", marginBottom:14, animation:"fadeUp 0.3s ease both" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#F0D0D8", fontFamily:"'Sora',sans-serif" }}>
              💸 Return borrowed money
            </div>
            <button onClick={()=>setReturnBannerDismissed(true)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.2)", fontSize:18, lineHeight:1 }}>×</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {activeLoans.map(loan=>{
              const fromJar = JARS.find(j=>j.key===loan.from);
              const toJar   = JARS.find(j=>j.key===loan.to);
              return (
                <div key={loan.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"rgba(255,255,255,0.04)", borderRadius:12 }}>
                  <span style={{ fontSize:14 }}>{toJar?.emoji}</span>
                  <div style={{ flex:1, fontSize:12, color:"rgba(255,255,255,0.6)", fontFamily:"'Sora',sans-serif" }}>
                    {toJar?.label} borrowed <strong style={{ color:"#fff" }}>€{loan.amount}</strong> from {fromJar?.label}
                  </div>
                  <button onClick={()=>returnLoan(loan.id)} style={{ padding:"6px 12px", borderRadius:10, background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", fontSize:11, fontWeight:700, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer" }}>
                    Return
                  </button>
                </div>
              );
            })}
          </div>
          {activeLoans.length === 0 && (
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", textAlign:"center" }}>All returned ✓</div>
          )}
        </div>
      )}

      {/* salary card */}
      <div onClick={()=>openModal(()=>setShowSalary(true))} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:22, padding:"18px 20px", marginBottom:14, cursor:"pointer", animation:"fadeUp 0.4s ease 0.05s both", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:11, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:4 }}>Monthly Salary</div>
          <div style={{ fontSize:28, fontWeight:800, color: salary>0?"#fff":"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", letterSpacing:"-1px" }}>
            {salary>0 ? `€${salary.toLocaleString()}` : "Tap to set"}
          </div>
          {salary>0 && <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:3 }}>€{(salary-totalSpent).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} remaining</div>}
        </div>
        <div style={{ fontSize:28 }}>💰</div>
      </div>

      {/* jars */}
      {(salary > 0 || expenses.length > 0) && (
        <>
          <div style={{ fontSize:11, letterSpacing:"0.14em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:700, marginBottom:12, animation:"fadeUp 0.4s ease 0.1s both" }}>Your 6 Jars</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 }}>
            {JARS.map((jar,i)=>{
              const allocated = salary * jar.pct;
              const spent = spentPerJar(jar.key);
              const lent = lentFromJar(jar.key);
              const borrowed = borrowedByJar(jar.key);
              const remaining = allocated - spent - lent + borrowed;
              const pct = allocated > 0 ? Math.min(100, ((spent+lent)/allocated)*100) : spent > 0 ? 100 : 0;
              const depleted = remaining < 0;
              // loan detail labels
              const lentLoans = loans.filter(l=>l.from===jar.key&&!l.returned);
              const borrowedLoans = loans.filter(l=>l.to===jar.key&&!l.returned);
              return (
                <div key={jar.key} onClick={()=>setSelectedJar(jar)} style={{ background:jar.color, borderRadius:20, padding:"15px 14px", animation:`cardIn 0.4s ease ${0.12+i*0.05}s both`, position:"relative", overflow:"hidden", cursor:"pointer" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                    <div style={{ fontSize:20 }}>{jar.emoji}</div>
                    <div style={{ fontSize:10, fontWeight:700, color:jar.text, opacity:0.5, fontFamily:"'Sora',sans-serif" }}>{Math.round(jar.pct*100)}%</div>
                  </div>
                  <div style={{ fontSize:12, fontWeight:700, color:jar.text, fontFamily:"'Sora',sans-serif", marginBottom:2 }}>{jar.label}</div>
                  <div style={{ fontSize:16, fontWeight:800, color:depleted?"#c0392b":jar.text, fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>
                    {depleted ? `-€${Math.abs(remaining).toFixed(0)}` : `€${remaining.toFixed(0)}`}
                  </div>
                  <div style={{ fontSize:10, color:jar.text, opacity:0.4, fontFamily:"'Sora',sans-serif", marginBottom:8 }}>of €{allocated.toFixed(0)}</div>
                  <div style={{ height:4, borderRadius:4, background:`${jar.text}20`, overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:4, width:`${pct}%`, background:depleted?"#c0392b":`${jar.text}60`, transition:"width 0.4s ease" }}/>
                  </div>
                  {depleted && (
                    <div onClick={e=>{ e.stopPropagation(); setBorrowFromJar(jar); }} style={{ marginTop:8, padding:"5px 10px", borderRadius:10, background:"rgba(192,57,43,0.2)", border:"1px solid rgba(192,57,43,0.4)", display:"inline-flex", alignItems:"center", gap:4, cursor:"pointer" }}>
                      <span style={{ fontSize:10 }}>💸</span>
                      <span style={{ fontSize:10, fontWeight:700, color:"#c0392b", fontFamily:"'Sora',sans-serif" }}>Borrow?</span>
                    </div>
                  )}
                  {/* loan pills */}
                  {lentLoans.map(loan=>{
                    const toJar = JARS.find(j=>j.key===loan.to);
                    return (
                      <div key={loan.id} style={{ marginTop:6, padding:"4px 8px", borderRadius:8, background:"rgba(200,50,50,0.15)", display:"inline-flex", alignItems:"center", gap:4 }}>
                        <span style={{ fontSize:10 }}>📤</span>
                        <span style={{ fontSize:10, fontWeight:700, color:"#c0392b", fontFamily:"'Sora',sans-serif" }}>-€{loan.amount} → {toJar?.label}</span>
                      </div>
                    );
                  })}
                  {borrowedLoans.map(loan=>{
                    const fromJar = JARS.find(j=>j.key===loan.from);
                    return (
                      <div key={loan.id} style={{ marginTop:6, padding:"4px 8px", borderRadius:8, background:"rgba(50,150,50,0.15)", display:"inline-flex", alignItems:"center", gap:4 }}>
                        <span style={{ fontSize:10 }}>📥</span>
                        <span style={{ fontSize:10, fontWeight:700, color:"#27ae60", fontFamily:"'Sora',sans-serif" }}>+€{loan.amount} from {fromJar?.label}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* total saved */}
      {salary > 0 && (
        <div style={{ padding:"16px 18px", borderRadius:18, background:"rgba(168,213,194,0.08)", border:"1px solid rgba(168,213,194,0.15)", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18, animation:"fadeUp 0.4s ease 0.25s both" }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(168,213,194,0.5)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:4 }}>Total Saved This Month</div>
            <div style={{ fontSize:24, fontWeight:800, color:"#A8D5C2", fontFamily:"'Sora',sans-serif", letterSpacing:"-1px" }}>€{totalSaved.toFixed(2)}</div>
          </div>
          <div style={{ fontSize:32 }}>🌱</div>
        </div>
      )}

      {/* expenses header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, animation:"fadeUp 0.4s ease 0.2s both" }}>
        <div style={{ fontSize:11, letterSpacing:"0.14em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:700 }}>Expenses</div>
        <div onClick={()=>openModal(()=>setShowExpense(true))} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:20, background:"rgba(168,213,194,0.12)", border:"1px solid rgba(168,213,194,0.25)", cursor:"pointer", color:"#A8D5C2", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif" }}>
          <Icons.Plus/> Add
        </div>
      </div>

      {/* expense list */}
      {expenses.length === 0 ? (
        <div style={{ padding:"28px 20px", textAlign:"center", background:"rgba(255,255,255,0.03)", borderRadius:20, border:"1px dashed rgba(255,255,255,0.08)", animation:"fadeUp 0.4s ease 0.22s both" }}>
          <div style={{ fontSize:28, marginBottom:8 }}>💸</div>
          <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>No expenses yet</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.15)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>Tap Add to log your first expense</div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {expenses.map((e,i)=>(
            <div key={e.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 15px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:16, animation:`fadeUp 0.3s ease ${i*0.04}s both` }}>
              <div style={{ fontSize:20, width:32, textAlign:"center" }}>{e.emoji}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.85)", fontFamily:"'Sora',sans-serif" }}>{e.cat}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif" }}>{e.note||e.date} · {JARS.find(j=>j.key===e.jar)?.label}</div>
              </div>
              <div style={{ fontSize:15, fontWeight:800, color:"#F0D0D8", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>-€{e.amount.toFixed(2)}</div>
              <button onClick={()=>deleteExpense(e.id)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.15)", padding:4 }}><Icons.Trash/></button>
            </div>
          ))}
        </div>
      )}

      {/* SUBSCRIPTIONS */}
      <div style={{ marginTop:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>Subscriptions</div>
          <div onClick={()=>openModal(()=>setShowAddSub(true))} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", borderRadius:20, background:"rgba(168,213,194,0.12)", border:"1px solid rgba(168,213,194,0.25)", cursor:"pointer", color:"#A8D5C2", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif" }}>
            <Icons.Plus/> Add
          </div>
        </div>
        {subs.length===0 ? (
          <div style={{ padding:"20px", textAlign:"center", background:"rgba(255,255,255,0.03)", borderRadius:18, border:"1px dashed rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif" }}>No subscriptions yet. Add Netflix, Spotify, etc.</div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {subs.map((s,i)=>{
              const daysUntil = Math.ceil((new Date(s.nextDate)-new Date())/(1000*60*60*24));
              const urgent = daysUntil<=2;
              return (
                <div key={s.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 15px", background: urgent?"rgba(255,179,71,0.08)":"rgba(255,255,255,0.04)", border: urgent?"1px solid rgba(255,179,71,0.2)":"1px solid rgba(255,255,255,0.07)", borderRadius:16 }}>
                  <div style={{ fontSize:20 }}>{s.emoji||"📱"}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{s.name}</div>
                    <div style={{ fontSize:11, color: urgent?"#FFB347":"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>
                      {urgent ? `⚠️ Due in ${daysUntil} day${daysUntil===1?"":"s"}` : `Next: ${new Date(s.nextDate).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`}
                    </div>
                  </div>
                  <div style={{ fontSize:14, fontWeight:800, color:"#F0D0D8", fontFamily:"'Sora',sans-serif" }}>{currency}{s.amount}</div>
                  <button onClick={()=>setSubs(p=>p.filter(x=>x.id!==s.id))} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.15)", padding:4 }}><Icons.Trash/></button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showSalary && <SalaryModal current={salary} onSave={handleSetSalary} onClose={()=>closeModal(()=>setShowSalary(false))}/>}
      {showExpense && <AddExpenseModal onAdd={addExpense} onClose={()=>closeModal(()=>setShowExpense(false))}/>}
      {selectedJar && <JarInfoModal jar={selectedJar} allocated={salary*selectedJar.pct} spent={spentPerJar(selectedJar.key)} onBorrow={()=>{ setBorrowFromJar(selectedJar); setSelectedJar(null); }} onClose={()=>closeModal(()=>setSelectedJar(null))}/>}
      {borrowFromJar && <BorrowModal needyJar={borrowFromJar} allJars={JARS} onBorrow={borrowMoney} onClose={()=>setBorrowFromJar(null)}/>}
      {showAddSub && (
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={()=>closeModal(()=>setShowAddSub(false))} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
            <div style={{ overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"24px 22px 8px", flex:1 }}>
              <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 20px" }}/>
              <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:20 }}>Add Subscription</div>
              <AddSubForm onAdd={(sub)=>{ setSubs(p=>[...p,{id:Date.now().toString(),...sub}]); closeModal(()=>setShowAddSub(false)); }} currency={currency}/>
            </div>
          </div>
        </div>
      )}
      {showJarInfo && (
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={()=>{ onModalChange(false); setShowJarInfo(false); }} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85vh", display:"flex", flexDirection:"column" }}>
            <div style={{ overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"24px 22px 8px", flex:1 }}>
              <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>
              <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>The 6 Jar System 🪙</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", lineHeight:1.7, marginBottom:20 }}>
                From T. Harv Eker's "Secrets of the Millionaire Mind". Split every salary into 6 jars — each with a purpose. This simple system changes how you think about money.
              </div>
              {JARS.map(jar=>(
                <div key={jar.key} style={{ background:jar.color, borderRadius:18, padding:"16px", marginBottom:10 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                    <span style={{ fontSize:22 }}>{jar.emoji}</span>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800, color:jar.text, fontFamily:"'Sora',sans-serif" }}>{jar.label} — {Math.round(jar.pct*100)}%</div>
                    </div>
                  </div>
                  <div style={{ fontSize:12, color:jar.text, opacity:0.7, fontFamily:"'Sora',sans-serif", lineHeight:1.6 }}>{jar.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ padding:"12px 22px 44px", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
              <button onClick={()=>{ onModalChange(false); setShowJarInfo(false); }} style={{ width:"100%", padding:"15px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer" }}>Got it!</button>
            </div>
          </div>
        </div>
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
    {w:"Familia",    t:"Family",      p:"fah-MEE-lyah",   e:"👨‍👩‍👧"},{w:"Madre",      t:"Mother",      p:"MAH-dreh",       e:"👩"},
    {w:"Padre",      t:"Father",      p:"PAH-dreh",       e:"👨"}, {w:"Libro",      t:"Book",        p:"LEE-broh",       e:"📚"},
    {w:"Ciudad",     t:"City",        p:"syoo-DAHD",      e:"🏙"}, {w:"Playa",      t:"Beach",       p:"PLAH-yah",       e:"🏖"},
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
    {w:"Famille",    t:"Family",      p:"fah-MEEY",       e:"👨‍👩‍👧"},{w:"Mère",       t:"Mother",      p:"mair",           e:"👩"},
    {w:"Père",       t:"Father",      p:"pair",           e:"👨"}, {w:"Livre",      t:"Book",        p:"leevr",          e:"📚"},
    {w:"Ville",      t:"City",        p:"veel",           e:"🏙"}, {w:"Plage",      t:"Beach",       p:"plazh",          e:"🏖"},
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
    {w:"Città",      t:"City",        p:"cheet-TAH",      e:"🏙"}, {w:"Spiaggia",   t:"Beach",       p:"SPYAH-jah",      e:"🏖"},
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
    {w:"Familie",    t:"Family",      p:"fah-MEE-lyeh",   e:"👨‍👩‍👧"},{w:"Mutter",     t:"Mother",      p:"MOO-ter",        e:"👩"},
    {w:"Vater",      t:"Father",      p:"FAH-ter",        e:"👨"}, {w:"Buch",       t:"Book",        p:"bookh",          e:"📚"},
    {w:"Stadt",      t:"City",        p:"shtaht",         e:"🏙"}, {w:"Strand",     t:"Beach",       p:"shtrahnd",       e:"🏖"},
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
    {w:"Família",    t:"Family",      p:"fah-MEE-lyah",   e:"👨‍👩‍👧"},{w:"Mãe",        t:"Mother",      p:"mah-EE",         e:"👩"},
    {w:"Pai",        t:"Father",      p:"pie",            e:"👨"}, {w:"Livro",      t:"Book",        p:"LEE-vroh",       e:"📚"},
    {w:"Cidade",     t:"City",        p:"see-DAH-deh",    e:"🏙"}, {w:"Praia",      t:"Beach",       p:"PRY-ah",         e:"🏖"},
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
    {w:"عائلة",      t:"Family",      p:"AH-ee-lah",      e:"👨‍👩‍👧"},{w:"أم",         t:"Mother",      p:"um",             e:"👩"},
    {w:"أب",         t:"Father",      p:"ab",             e:"👨"}, {w:"كتاب",       t:"Book",        p:"ki-TAB",         e:"📚"},
    {w:"مدينة",      t:"City",        p:"ma-DEE-nah",     e:"🏙"}, {w:"شاطئ",       t:"Beach",       p:"SHA-ti",         e:"🏖"},
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
    {w:"かぞく",     t:"Family",      p:"ka-ZO-ku",       e:"👨‍👩‍👧"},{w:"おかあさん", t:"Mother",      p:"o-KA-san",       e:"👩"},
    {w:"おとうさん", t:"Father",      p:"o-TO-san",       e:"👨"}, {w:"ほん",       t:"Book",        p:"hon",            e:"📚"},
    {w:"まち",       t:"City",        p:"ma-chi",         e:"🏙"}, {w:"うみ",       t:"Beach",       p:"u-mi",           e:"🏖"},
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
    {w:"家人",       t:"Family",      p:"jiā rén",        e:"👨‍👩‍👧"},{w:"妈妈",       t:"Mother",      p:"māmā",           e:"👩"},
    {w:"爸爸",       t:"Father",      p:"bàba",           e:"👨"}, {w:"书",         t:"Book",        p:"shū",            e:"📚"},
    {w:"城市",       t:"City",        p:"chéng shì",      e:"🏙"}, {w:"海滩",       t:"Beach",       p:"hǎi tān",        e:"🏖"},
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
    {w:"परिवार",     t:"Family",      p:"pa-ri-VAAR",     e:"👨‍👩‍👧"},{w:"माँ",        t:"Mother",      p:"maa",            e:"👩"},
    {w:"पिता",       t:"Father",      p:"pi-TAA",         e:"👨"}, {w:"किताब",      t:"Book",        p:"ki-TAAB",        e:"📚"},
    {w:"शहर",        t:"City",        p:"sha-HAR",        e:"🏙"}, {w:"समुद्र तट",  t:"Beach",       p:"sa-MUD-ra tat",  e:"🏖"},
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
    {w:"Семья",      t:"Family",      p:"sem-YA",         e:"👨‍👩‍👧"},{w:"Мама",       t:"Mother",      p:"MA-ma",          e:"👩"},
    {w:"Папа",       t:"Father",      p:"PA-pa",          e:"👨"}, {w:"Книга",      t:"Book",        p:"KNEE-ga",        e:"📚"},
    {w:"Город",      t:"City",        p:"GO-rod",         e:"🏙"}, {w:"Пляж",       t:"Beach",       p:"plyazh",         e:"🏖"},
  ],
};

const CONVERSATIONS = {
  es: (words) => `— ${words[0]?.w || "Hola"}! ¿Cómo estás?\n— Muy bien, ${words[1]?.w || "gracias"}. ¿Y tú?\n— Bien también. ¿Tienes ${words[2]?.w || "agua"}?\n— Sí, aquí está. ¿Vas a ${words[3]?.w || "casa"}?\n— Sí, con mi ${words[4]?.w || "familia"}.`,
  fr: (words) => `— ${words[0]?.w || "Bonjour"}! Comment ça va?\n— Très bien, ${words[1]?.w || "merci"}. Et toi?\n— Bien aussi. Tu as de l'${words[2]?.w || "eau"}?\n— Oui, voilà. Tu rentres à la ${words[3]?.w || "maison"}?\n— Oui, avec ma ${words[4]?.w || "famille"}.`,
  it: (words) => `— ${words[0]?.w || "Ciao"}! Come stai?\n— Molto bene, ${words[1]?.w || "grazie"}. E tu?\n— Bene anche io. Hai dell'${words[2]?.w || "acqua"}?\n— Sì, eccola. Torni a ${words[3]?.w || "casa"}?\n— Sì, con la mia ${words[4]?.w || "famiglia"}.`,
  de: (words) => `— ${words[0]?.w || "Hallo"}! Wie geht es dir?\n— Sehr gut, ${words[1]?.w || "danke"}. Und dir?\n— Auch gut. Hast du ${words[2]?.w || "Wasser"}?\n— Ja, hier. Gehst du nach ${words[3]?.w || "Haus"}e?\n— Ja, mit meiner ${words[4]?.w || "Familie"}.`,
  pt: (words) => `— ${words[0]?.w || "Olá"}! Como vai você?\n— Muito bem, ${words[1]?.w || "obrigado"}. E você?\n— Bem também. Tem ${words[2]?.w || "água"}?\n— Sim, aqui está. Vai para ${words[3]?.w || "casa"}?\n— Sim, com minha ${words[4]?.w || "família"}.`,
  ar: (words) => `— ${words[0]?.w || "مرحبا"}! كيف حالك؟\n— بخير، ${words[1]?.w || "شكراً"}. وأنت؟\n— بخير أيضاً. هل معك ${words[2]?.w || "ماء"}؟\n— نعم، تفضل. هل ستذهب إلى ${words[3]?.w || "بيت"}؟\n— نعم، مع ${words[4]?.w || "عائلة"}تي.`,
  ja: (words) => `— ${words[0]?.w || "こんにちは"}！元気ですか？\n— はい、${words[1]?.w || "ありがとう"}。あなたは？\n— 私も元気です。${words[2]?.w || "みず"}がありますか？\n— はい、どうぞ。${words[3]?.w || "いえ"}に帰りますか？\n— はい、${words[4]?.w || "かぞく"}と一緒に。`,
  zh: (words) => `— ${words[0]?.w || "你好"}！你好吗？\n— 很好，${words[1]?.w || "谢谢"}。你呢？\n— 我也很好。你有${words[2]?.w || "水"}吗？\n— 有，给你。你要回${words[3]?.w || "家"}吗？\n— 是的，和我的${words[4]?.w || "家人"}一起。`,
  hi: (words) => `— ${words[0]?.w || "नमस्ते"}! आप कैसे हैं?\n— बहुत अच्छा, ${words[1]?.w || "धन्यवाद"}। आप?\n— मैं भी अच्छा हूँ। क्या आपके पास ${words[2]?.w || "पानी"} है?\n— हाँ, लीजिए। क्या आप ${words[3]?.w || "घर"} जा रहे हैं?\n— हाँ, मेरे ${words[4]?.w || "परिवार"} के साथ।`,
  ru: (words) => `— ${words[0]?.w || "Привет"}! Как дела?\n— Хорошо, ${words[1]?.w || "спасибо"}. А у тебя?\n— Тоже хорошо. У тебя есть ${words[2]?.w || "вода"}?\n— Да, вот. Идёшь домой?\n— Да, с моей ${words[4]?.w || "семьёй"}.`,
};

function shuffle(arr) { return [...arr].sort(()=>Math.random()-0.5); }

function LearningPage() {
  const [lang, setLang] = useState(()=>load("rslv_lang",""));
  const [history, setHistory] = useState(()=>load("rslv_learn_history",[]));
  const [streak, setStreak] = useState(()=>load("rslv_learn_streak",0));
  const [screen, setScreen] = useState("home"); // home|pick|session|puzzle|quiz|convo|done
  const [sessionSize, setSessionSize] = useState(5);
  const [sessionWords, setSessionWords] = useState([]);
  const [wordIdx, setWordIdx] = useState(0);
  const [puzzleIdx, setPuzzleIdx] = useState(0);
  const [puzzleChoices, setPuzzleChoices] = useState([]);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizChoices, setQuizChoices] = useState([]);
  const [quizScore, setQuizScore] = useState(0);
  const [answer, setAnswer] = useState(null); // null|"correct"|"wrong"
  const [flipped, setFlipped] = useState(false);

  useEffect(()=>{ save("rslv_lang",lang); },[lang]);
  useEffect(()=>{ save("rslv_learn_history",history); },[history]);

  const learnedWords = history.map(h=>h.word);
  const allWords = lang ? WORDS[lang] || [] : [];
  const unlearnedWords = allWords.filter(w=>!learnedWords.includes(w.w));

  const startSession = (size, jumpTo) => {
    const pool = unlearnedWords.length >= size ? unlearnedWords : allWords;
    const words = shuffle(pool).slice(0, size);
    setSessionWords(words);
    setSessionSize(size);
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

  const startPuzzle = () => {
    setPuzzleIdx(0);
    setAnswer(null);
    makePuzzleChoices(0);
    setScreen("puzzle");
  };

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

  const startQuiz = () => {
    setQuizIdx(0);
    setQuizScore(0);
    setAnswer(null);
    makeQuizChoices(0);
    setScreen("quiz");
  };

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
      else setScreen("convo");
    }, isCorrect ? 600 : 1200);
  };

  const finishSession = () => {
    const today = TODAY();
    const newEntries = sessionWords.map(w=>({word:w.w, lang, date:today}));
    setHistory(p=>[...newEntries,...p]);
    const last = load("rslv_learn_last_date","");
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    const yStr = yesterday.toISOString().slice(0,10);
    const newStreak = last===yStr||last===today ? streak+1 : 1;
    setStreak(newStreak);
    save("rslv_learn_streak", newStreak);
    save("rslv_learn_last_date", today);
    setScreen("done");
  };

  const selectedLang = LANGUAGES.find(l=>l.code===lang);
  const totalLearned = history.filter(h=>h.lang===lang).length;

  // ── MASCOT SVG ──
  const Mascot = ({ mood="happy", size=80 }) => {
    const faces = {
      happy:   <><circle cx="35" cy="38" r="6" fill="#1a3028"/><circle cx="65" cy="38" r="6" fill="#1a3028"/><path d="M30 52 Q50 64 70 52" stroke="#1a3028" strokeWidth="3" strokeLinecap="round" fill="none"/></>,
      excited: <><circle cx="35" cy="36" r="7" fill="#1a3028"/><circle cx="65" cy="36" r="7" fill="#1a3028"/><circle cx="37" cy="34" r="2" fill="white"/><circle cx="67" cy="34" r="2" fill="white"/><path d="M28 52 Q50 68 72 52" stroke="#1a3028" strokeWidth="3.5" strokeLinecap="round" fill="none"/></>,
      wrong:   <><circle cx="35" cy="40" r="6" fill="#1a3028"/><circle cx="65" cy="40" r="6" fill="#1a3028"/><path d="M30 60 Q50 50 70 60" stroke="#1a3028" strokeWidth="3" strokeLinecap="round" fill="none"/></>,
      cool:    <><rect x="25" y="34" width="20" height="10" rx="5" fill="#1a3028"/><rect x="55" y="34" width="20" height="10" rx="5" fill="#1a3028"/><path d="M30 54 Q50 66 70 54" stroke="#1a3028" strokeWidth="3" strokeLinecap="round" fill="none"/></>,
    };
    return (
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="#A8D5C2"/>
        <circle cx="50" cy="50" r="46" fill="url(#mg)" opacity="0.3"/>
        <defs><radialGradient id="mg" cx="40%" cy="35%"><stop offset="0%" stopColor="white" stopOpacity="0.6"/><stop offset="100%" stopColor="transparent"/></radialGradient></defs>
        {/* ears */}
        <ellipse cx="12" cy="42" rx="10" ry="14" fill="#A8D5C2"/>
        <ellipse cx="88" cy="42" rx="10" ry="14" fill="#A8D5C2"/>
        <ellipse cx="12" cy="42" rx="6" ry="9" fill="#C8E6DA"/>
        <ellipse cx="88" cy="42" rx="6" ry="9" fill="#C8E6DA"/>
        {/* face */}
        {faces[mood]}
        {/* cheeks */}
        <circle cx="22" cy="55" r="8" fill="#ff9999" opacity="0.3"/>
        <circle cx="78" cy="55" r="8" fill="#ff9999" opacity="0.3"/>
      </svg>
    );
  };

  // ── SCREENS ──

  if (screen==="pick") return (
    <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button onClick={()=>setScreen("home")} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18 }}>‹</button>
        <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Pick a Language</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {LANGUAGES.map(l=>(
          <div key={l.code} onClick={()=>{ setLang(l.code); setScreen("home"); }}
            style={{ background: lang===l.code?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.04)", border: lang===l.code?"1.5px solid rgba(168,213,194,0.4)":"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:"18px 16px", cursor:"pointer", transition:"all 0.2s", display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:32 }}>{l.flag}</div>
            <div style={{ fontSize:14, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{l.name}</div>
          </div>
        ))}
      </div>
    </div>
  );

  if (screen==="session") {
    const word = sessionWords[wordIdx];
    const progress = ((wordIdx)/sessionWords.length)*100;
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both" }}>
        {/* top bar */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <button onClick={()=>setScreen("home")} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:18, flexShrink:0 }}>✕</button>
          <div style={{ flex:1, height:10, borderRadius:10, background:"rgba(255,255,255,0.07)", overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:10, width:`${progress}%`, background:"linear-gradient(90deg,#A8D5C2,#C5B8E8)", transition:"width 0.4s ease" }}/>
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>{wordIdx+1}/{sessionWords.length}</div>
        </div>

        {/* label */}
        <div style={{ textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:12, letterSpacing:"0.15em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:700 }}>Learn this word</div>
        </div>

        {/* big word card */}
        <div onClick={()=>setFlipped(f=>!f)}
          style={{ background: flipped ? "linear-gradient(135deg,#1a3d2e,#0f2a1e)" : "linear-gradient(135deg,#1e1a3a,#12141E)", border: flipped?"1.5px solid rgba(168,213,194,0.3)":"1.5px solid rgba(197,184,232,0.2)", borderRadius:28, padding:"36px 24px 32px", textAlign:"center", cursor:"pointer", marginBottom:16, minHeight:280, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, transition:"all 0.3s ease", animation:"cardIn 0.35s ease both" }}>
          {/* giant emoji */}
          <div style={{ fontSize:96, lineHeight:1, animation:"cardIn 0.4s ease both", filter:"drop-shadow(0 8px 20px rgba(0,0,0,0.3))" }}>{word.e}</div>
          <div style={{ fontSize:38, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-1px" }}>{word.w}</div>
          {flipped ? (
            <div style={{ animation:"fadeUp 0.25s ease both" }}>
              <div style={{ fontSize:22, color:"#A8D5C2", fontFamily:"'Sora',sans-serif", fontWeight:700, marginBottom:6 }}>{word.t}</div>
              <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif", letterSpacing:"0.05em" }}>/{word.p}/</div>
            </div>
          ) : (
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:20, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize:14 }}>👆</span>
              <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif" }}>Tap to reveal</span>
            </div>
          )}
        </div>

        {/* mascot */}
        <div style={{ display:"flex", justifyContent:"center", marginBottom:16 }}>
          <Mascot mood={flipped?"excited":"happy"} size={60}/>
        </div>

        <button onClick={nextWord} style={{ width:"100%", padding:"17px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:18, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", boxShadow:"0 6px 20px rgba(168,213,194,0.25)" }}>
          {wordIdx < sessionWords.length-1 ? "Got it →" : "Start Puzzle 🧩"}
        </button>
      </div>
    );
  }

  if (screen==="puzzle") {
    const word = sessionWords[puzzleIdx];
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both" }}>
        {/* top bar */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <button onClick={()=>setScreen("home")} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:18, flexShrink:0 }}>✕</button>
          <div style={{ flex:1, height:10, borderRadius:10, background:"rgba(255,255,255,0.07)", overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:10, width:`${((puzzleIdx+1)/sessionWords.length)*100}%`, background:"linear-gradient(90deg,#FFB347,#FF8C42)", transition:"width 0.4s ease" }}/>
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>{puzzleIdx+1}/{sessionWords.length}</div>
        </div>

        <div style={{ textAlign:"center", marginBottom:8 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,179,71,0.7)", fontFamily:"'Sora',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase" }}>🧩 Picture Puzzle</div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>Which word matches this?</div>
        </div>

        {/* giant emoji */}
        <div style={{ textAlign:"center", margin:"20px 0 28px", animation:"cardIn 0.3s ease both" }}>
          <div style={{ fontSize:110, lineHeight:1, filter:"drop-shadow(0 12px 28px rgba(0,0,0,0.4))" }}>{word.e}</div>
        </div>

        {/* answer grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
          {puzzleChoices.map(c=>{
            const isCorrect = c.w===word.w;
            const selected = answer !== null;
            let bg, border, color;
            if (!selected) { bg="rgba(255,255,255,0.06)"; border="1.5px solid rgba(255,255,255,0.1)"; color="#fff"; }
            else if (isCorrect) { bg="rgba(168,213,194,0.2)"; border="2px solid #A8D5C2"; color="#A8D5C2"; }
            else { bg="rgba(220,80,80,0.1)"; border="1.5px solid rgba(220,80,80,0.2)"; color="rgba(255,255,255,0.3)"; }
            return (
              <div key={c.w} onClick={()=>answerPuzzle(c)}
                style={{ background:bg, border, borderRadius:20, padding:"18px 12px", textAlign:"center", cursor:selected?"default":"pointer", transition:"all 0.2s", animation:"cardIn 0.3s ease both" }}>
                <div style={{ fontSize:16, fontWeight:800, color, fontFamily:"'Sora',sans-serif" }}>{c.w}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>{c.t}</div>
              </div>
            );
          })}
        </div>

        {/* feedback mascot */}
        {answer && (
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderRadius:18, background: answer==="correct"?"rgba(168,213,194,0.1)":"rgba(220,80,80,0.1)", border: answer==="correct"?"1px solid rgba(168,213,194,0.2)":"1px solid rgba(220,80,80,0.2)", animation:"fadeUp 0.2s ease both" }}>
            <Mascot mood={answer==="correct"?"excited":"wrong"} size={44}/>
            <div style={{ fontSize:14, fontWeight:700, color: answer==="correct"?"#A8D5C2":"#ff6b6b", fontFamily:"'Sora',sans-serif" }}>
              {answer==="correct" ? "🎉 Correct! Well done!" : `❌ It was: ${word.w} (${word.t})`}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen==="quiz") {
    const word = sessionWords[quizIdx];
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both" }}>
        {/* top bar */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <button onClick={()=>setScreen("home")} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:18, flexShrink:0 }}>✕</button>
          <div style={{ flex:1, height:10, borderRadius:10, background:"rgba(255,255,255,0.07)", overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:10, width:`${((quizIdx+1)/sessionWords.length)*100}%`, background:"linear-gradient(90deg,#C5B8E8,#F5DDD0)", transition:"width 0.4s ease" }}/>
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>{quizScore}✓</div>
        </div>

        <div style={{ textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"rgba(197,184,232,0.7)", fontFamily:"'Sora',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase" }}>⚡ Quick Q&A</div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>What does this mean?</div>
        </div>

        {/* word display */}
        <div style={{ background:"linear-gradient(135deg,#1e1a3a,#12141E)", border:"1.5px solid rgba(197,184,232,0.2)", borderRadius:26, padding:"40px 24px", textAlign:"center", marginBottom:24, animation:"cardIn 0.3s ease both" }}>
          <div style={{ fontSize:18, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:10 }}>{selectedLang?.flag} {selectedLang?.name}</div>
          <div style={{ fontSize:46, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-1.5px" }}>{word.w}</div>
          <div style={{ fontSize:24, marginTop:12 }}>{word.e}</div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
          {quizChoices.map(c=>{
            const isCorrect = c.w===word.w;
            const selected = answer !== null;
            let bg, border, color;
            if (!selected) { bg="rgba(255,255,255,0.06)"; border="1.5px solid rgba(255,255,255,0.1)"; color="#fff"; }
            else if (isCorrect) { bg="rgba(168,213,194,0.2)"; border="2px solid #A8D5C2"; color="#A8D5C2"; }
            else { bg="rgba(220,80,80,0.1)"; border="1.5px solid rgba(220,80,80,0.2)"; color="rgba(255,255,255,0.3)"; }
            return (
              <div key={c.w} onClick={()=>answerQuiz(c)}
                style={{ background:bg, border, borderRadius:20, padding:"18px 12px", textAlign:"center", cursor:selected?"default":"pointer", transition:"all 0.2s" }}>
                <div style={{ fontSize:15, fontWeight:700, color, fontFamily:"'Sora',sans-serif" }}>{c.t}</div>
              </div>
            );
          })}
        </div>

        {/* dots */}
        <div style={{ display:"flex", justifyContent:"center", gap:6 }}>
          {sessionWords.map((_,i)=>(
            <div key={i} style={{ width:i===quizIdx?20:8, height:8, borderRadius:8, background: i<quizIdx?"#A8D5C2":i===quizIdx?"#C5B8E8":"rgba(255,255,255,0.1)", transition:"all 0.3s" }}/>
          ))}
        </div>
      </div>
    );
  }

  if (screen==="convo") {
    const convoFn = CONVERSATIONS[lang];
    const lines = convoFn ? convoFn(sessionWords).split("\n") : [];
    return (
      <div style={{ padding:"0 18px 32px", animation:"tabIn 0.25s ease both" }}>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"rgba(168,213,194,0.6)", fontFamily:"'Sora',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>💬 Mini Conversation</div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>Your words used in real life</div>
        </div>

        {/* highlighted words row */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:20, justifyContent:"center" }}>
          {sessionWords.map(w=>(
            <div key={w.w} style={{ padding:"5px 12px", borderRadius:20, background:"rgba(168,213,194,0.1)", border:"1px solid rgba(168,213,194,0.2)" }}>
              <span style={{ fontSize:12, fontWeight:800, color:"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>{w.e} {w.w}</span>
            </div>
          ))}
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
          {lines.filter(l=>l.trim()).map((line,i)=>{
            const isLeft = i%2===0;
            const text = line.replace("— ","");
            const highlighted = sessionWords.reduce((acc,w)=>acc.replace(new RegExp(`\\b${w.w}\\b`,"g"),`<strong style="color:#A8D5C2">${w.w}</strong>`),text);
            return (
              <div key={i} style={{ display:"flex", justifyContent:isLeft?"flex-start":"flex-end", animation:`fadeUp 0.4s ease ${i*0.08}s both` }}>
                {isLeft && <div style={{ fontSize:24, marginRight:8, alignSelf:"flex-end" }}>{selectedLang?.flag}</div>}
                <div style={{ maxWidth:"78%", background:isLeft?"rgba(168,213,194,0.08)":"rgba(197,184,232,0.08)", border:isLeft?"1px solid rgba(168,213,194,0.15)":"1px solid rgba(197,184,232,0.15)", borderRadius:isLeft?"20px 20px 20px 4px":"20px 20px 4px 20px", padding:"13px 16px" }}>
                  <div style={{ fontSize:14, color:"rgba(255,255,255,0.85)", fontFamily:"'Sora',sans-serif", lineHeight:1.55 }} dangerouslySetInnerHTML={{__html:highlighted}}/>
                </div>
                {!isLeft && <div style={{ fontSize:24, marginLeft:8, alignSelf:"flex-end" }}>🙂</div>}
              </div>
            );
          })}
        </div>

        <button onClick={finishSession} style={{ width:"100%", padding:"17px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:18, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", boxShadow:"0 6px 20px rgba(168,213,194,0.25)" }}>
          Complete Session ✓
        </button>
      </div>
    );
  }

  if (screen==="done") return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"calc(100vh - 180px)", padding:"0 24px", textAlign:"center", animation:"tabIn 0.3s ease both" }}>
      {/* celebration */}
      <div style={{ marginBottom:8, animation:"cardIn 0.5s ease both" }}>
        <Mascot mood="excited" size={100}/>
      </div>
      <div style={{ fontSize:46, marginBottom:4, animation:"cardIn 0.4s ease 0.1s both" }}>🎉</div>
      <div style={{ fontSize:28, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:6, letterSpacing:"-0.5px" }}>Session Complete!</div>
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif", marginBottom:28, lineHeight:1.6 }}>
        You learned <strong style={{color:"#A8D5C2"}}>{sessionWords.length} {selectedLang?.name} words</strong>.<br/>Every word is a step forward.
      </div>

      {/* stats */}
      <div style={{ display:"flex", gap:10, marginBottom:28, width:"100%" }}>
        <div style={{ flex:1, background:"rgba(168,213,194,0.08)", border:"1px solid rgba(168,213,194,0.15)", borderRadius:20, padding:"16px 10px" }}>
          <div style={{ fontSize:28, fontWeight:800, color:"#A8D5C2", fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{sessionWords.length}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>today</div>
        </div>
        <div style={{ flex:1, background:"rgba(197,184,232,0.08)", border:"1px solid rgba(197,184,232,0.15)", borderRadius:20, padding:"16px 10px" }}>
          <div style={{ fontSize:28, fontWeight:800, color:"#C5B8E8", fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{totalLearned+sessionWords.length}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>total</div>
        </div>
        <div style={{ flex:1, background:"rgba(255,179,71,0.08)", border:"1px solid rgba(255,179,71,0.15)", borderRadius:20, padding:"16px 10px" }}>
          <div style={{ fontSize:28, fontWeight:800, color:"#FFB347", fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{streak}🔥</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>streak</div>
        </div>
      </div>

      <button onClick={()=>setScreen("home")} style={{ width:"100%", padding:"17px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:18, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", boxShadow:"0 6px 20px rgba(168,213,194,0.25)" }}>
        Back to Learning
      </button>
    </div>
  );

  // ── HOME SCREEN ──
  return (
    <div style={{ padding:"0 18px 32px" }}>

      {/* header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, animation:"fadeUp 0.4s ease both" }}>
        <div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:5 }}>Language Learning</div>
          <div style={{ fontSize:26, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>Let's learn 🧠</div>
        </div>
        <button onClick={()=>setScreen("pick")} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, padding:"9px 14px", cursor:"pointer", color:"rgba(255,255,255,0.7)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:700, display:"flex", alignItems:"center", gap:6 }}>
          {selectedLang ? <>{selectedLang.flag} {selectedLang.name}</> : "🌍 Pick"}
        </button>
      </div>

      {!lang ? (
        <div onClick={()=>setScreen("pick")} style={{ padding:"52px 24px", textAlign:"center", background:"linear-gradient(135deg,rgba(168,213,194,0.07),rgba(197,184,232,0.07))", borderRadius:28, border:"1.5px dashed rgba(255,255,255,0.1)", cursor:"pointer", animation:"fadeUp 0.4s ease 0.1s both" }}>
          <div style={{ fontSize:72, marginBottom:14, filter:"drop-shadow(0 8px 20px rgba(0,0,0,0.3))" }}>🌍</div>
          <div style={{ fontSize:20, fontWeight:800, color:"rgba(255,255,255,0.7)", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>Choose your language</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", lineHeight:1.6 }}>10 languages available<br/>5 words a day is all you need</div>
        </div>
      ) : (
        <>
          {/* mascot + streak hero */}
          <div style={{ background:"linear-gradient(135deg,#1a2e28,#12141E)", border:"1px solid rgba(168,213,194,0.15)", borderRadius:26, padding:"20px", marginBottom:16, display:"flex", alignItems:"center", gap:16, animation:"fadeUp 0.4s ease 0.04s both" }}>
            <Mascot mood={streak>0?"cool":"happy"} size={72}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>
                {streak===0 ? "Start your streak today!" : `${streak} day streak — don't break it!`}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <div style={{ padding:"6px 12px", borderRadius:12, background:"rgba(255,179,71,0.12)", border:"1px solid rgba(255,179,71,0.2)" }}>
                  <span style={{ fontSize:14 }}>🔥</span>
                  <span style={{ fontSize:14, fontWeight:800, color:"#FFB347", fontFamily:"'Sora',sans-serif", marginLeft:4 }}>{streak}</span>
                </div>
                <div style={{ padding:"6px 12px", borderRadius:12, background:"rgba(168,213,194,0.12)", border:"1px solid rgba(168,213,194,0.2)" }}>
                  <span style={{ fontSize:14 }}>📚</span>
                  <span style={{ fontSize:14, fontWeight:800, color:"#A8D5C2", fontFamily:"'Sora',sans-serif", marginLeft:4 }}>{totalLearned}</span>
                </div>
              </div>
            </div>
          </div>

          {/* CARD 1 — Daily Words */}
          <div style={{ borderRadius:26, marginBottom:14, animation:"fadeUp 0.4s ease 0.1s both", overflow:"hidden", position:"relative" }}>
            <div style={{ background:"linear-gradient(135deg,#1B4332,#2D6A4F)", padding:"22px 20px 18px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(212,237,218,0.7)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>📖 Daily Words</div>
                  <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>Learn New Words</div>
                  <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>Flip cards · see emoji · remember</div>
                </div>
                <div style={{ fontSize:56, filter:"drop-shadow(0 6px 14px rgba(0,0,0,0.4))", lineHeight:1 }}>📗</div>
              </div>
              {/* size picker */}
              <div style={{ display:"flex", gap:8 }}>
                {[5,10,15].map(n=>(
                  <div key={n} onClick={()=>startSession(n)}
                    style={{ flex:1, background:"rgba(255,255,255,0.12)", border:"1.5px solid rgba(255,255,255,0.2)", borderRadius:18, padding:"14px 8px", textAlign:"center", cursor:"pointer", transition:"all 0.2s", backdropFilter:"blur(4px)" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{n}</div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontFamily:"'Sora',sans-serif", marginTop:3 }}>words</div>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", fontFamily:"'Sora',sans-serif" }}>~{n}min</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* CARD 2 — Picture Puzzle */}
          <div onClick={()=>startSession(5,"puzzle")} style={{ borderRadius:26, marginBottom:14, animation:"fadeUp 0.4s ease 0.16s both", overflow:"hidden", cursor:"pointer" }}>
            <div style={{ background:"linear-gradient(135deg,#4A1B6D,#7B2D8B)", padding:"22px 20px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(230,200,255,0.7)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>🧩 Picture Puzzle</div>
                  <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>Match the Emoji</div>
                  <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", marginTop:4, marginBottom:14 }}>See emoji · pick the right word</div>
                  <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"10px 18px", borderRadius:20, background:"rgba(255,255,255,0.15)", border:"1.5px solid rgba(255,255,255,0.25)" }}>
                    <span style={{ fontSize:13, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>▶ Play now</span>
                  </div>
                </div>
                <div style={{ fontSize:64, filter:"drop-shadow(0 8px 20px rgba(0,0,0,0.5))", lineHeight:1 }}>🧩</div>
              </div>
            </div>
          </div>

          {/* CARD 3 — Quick Q&A */}
          <div style={{ borderRadius:26, marginBottom:16, animation:"fadeUp 0.4s ease 0.22s both", overflow:"hidden" }}>
            <div style={{ background:"linear-gradient(135deg,#7A3B00,#B85C00)", padding:"22px 20px 18px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,220,150,0.7)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>⚡ Quick Q&A</div>
                  <div style={{ fontSize:24, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>Test Yourself</div>
                  <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", marginTop:4 }}>Word shown · pick translation</div>
                </div>
                <div style={{ fontSize:56, filter:"drop-shadow(0 6px 14px rgba(0,0,0,0.4))", lineHeight:1 }}>⚡</div>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {[5,10,15].map(n=>(
                  <div key={n} onClick={()=>startSession(n,"quiz")}
                    style={{ flex:1, background:"rgba(255,255,255,0.12)", border:"1.5px solid rgba(255,255,255,0.2)", borderRadius:18, padding:"12px 8px", textAlign:"center", cursor:"pointer", transition:"all 0.2s" }}>
                    <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{n}Q</div>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", marginTop:3 }}>~{n}min</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* history strip */}
          {history.filter(h=>h.lang===lang).length > 0 && (
            <div style={{ animation:"fadeUp 0.4s ease 0.28s both" }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:10 }}>Recently Learned</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {history.filter(h=>h.lang===lang).slice(0,12).map((h,i)=>(
                  <div key={i} style={{ padding:"5px 12px", borderRadius:20, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)" }}>
                    <span style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif" }}>{h.word}</span>
                  </div>
                ))}
              </div>
            </div>
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
      setPosts(data||[]);
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
    const data = await sbAuth("token?grant_type=password", { email, password });
    if(data.access_token) {
      localStorage.setItem("rslv_token", data.access_token);
      setToken(data.access_token);
      return true;
    }
    return data.error_description || "Login failed";
  };

  const signup = async (email, password, username, fullName) => {
    const data = await sbAuth("signup", { email, password });
    if(data.id || data.user?.id) {
      const uid = data.id||data.user.id;
      const tok = data.access_token||data.session?.access_token;
      if(tok) {
        localStorage.setItem("rslv_token", tok);
        // create profile
        await sb(`profiles`, { method:"POST", body:JSON.stringify({ id:uid, username, full_name:fullName }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${tok}`, "Content-Type":"application/json", "Prefer":"return=representation" } });
        setToken(tok);
        return true;
      }
    }
    return data.error_description || "Signup failed";
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

  const requireAuth = (fn) => {
    if(!token) { onModalChange(true); setShowAuth(true); return; }
    fn();
  };

  if (!token && showAuth) return <AuthScreen onLogin={login} onSignup={signup} onClose={()=>{ onModalChange(false); setShowAuth(false); }} onModalChange={onModalChange}/>;

  return (
    <div style={{ padding:"0 18px 32px" }}>

      {/* header — search + 3 dots */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, animation:"fadeUp 0.4s ease both" }}>
        <div style={{ flex:1, display:"flex", alignItems:"center", gap:10, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, padding:"11px 14px" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search..."
            style={{ flex:1, background:"none", border:"none", outline:"none", color:"rgba(255,255,255,0.7)", fontSize:13, fontFamily:"'Sora',sans-serif" }}/>
        </div>
        <div style={{ position:"relative" }}>
          <button onClick={()=>setShowMenu(m=>!m)} style={{ width:42, height:42, borderRadius:12, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexDirection:"column", gap:3.5 }}>
            {[0,1,2].map(i=><div key={i} style={{ width:3.5, height:3.5, borderRadius:"50%", background:"rgba(255,255,255,0.5)" }}/>)}
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
            <div onClick={()=>{ onModalChange(true); setShowPost(true); }} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:"13px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
              <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>
                {profile?.username?.[0]?.toUpperCase()||"?"}
              </div>
              <div style={{ flex:1, fontSize:13, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif" }}>Share your win today...</div>
              <div style={{ padding:"7px 14px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", borderRadius:10, fontSize:12, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif" }}>Post</div>
            </div>
          )}
          {loading && <div style={{ textAlign:"center", padding:32, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", fontSize:13 }}>Loading...</div>}
          {!loading && posts.length===0 && (
            <div style={{ textAlign:"center", padding:"40px 24px", background:"rgba(255,255,255,0.03)", borderRadius:24, border:"1px dashed rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize:16, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>No posts yet</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.15)", fontFamily:"'Sora',sans-serif" }}>Be the first to share your win</div>
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {posts.filter(p=>!searchQuery||p.content.toLowerCase().includes(searchQuery.toLowerCase())).map((post,i)=>(
              <PostCard key={post.id} post={post} user={user} token={token} onLike={likePost} onComment={()=>requireAuth(()=>{ onModalChange(true); setCommentPost(post); })} delay={i*0.05}/>
            ))}
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
    setError(""); setLoading(true);
    const result = mode==="login"
      ? await onLogin(email, password)
      : await onSignup(email, password, username, fullName);
    if(result !== true) setError(result);
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
function PostCard({ post, user, token, onLike, onComment, delay }) {
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(post.likes_count||0);
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

  return (
    <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:22, overflow:"hidden", animation:`fadeUp 0.4s ease ${delay}s both` }}>
      {post.image_url && <img src={post.image_url} alt="" style={{ width:"100%", height:180, objectFit:"cover", display:"block" }}/>}
      <div style={{ padding:"14px 16px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>
            {n?.username?.[0]?.toUpperCase()||"?"}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{n?.full_name||n?.username||"User"}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif" }}>@{n?.username} · {timeAgo(post.created_at)}</div>
          </div>
          {post.category && (
            <div style={{ padding:"4px 10px", borderRadius:10, background:`${bgColor}30`, border:`1px solid ${bgColor}50`, fontSize:10, fontWeight:700, color:bgColor==="rgba(255,255,255,0.06)"?"rgba(255,255,255,0.4)":bgColor, fontFamily:"'Sora',sans-serif" }}>
              {post.category}
            </div>
          )}
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.85)", fontFamily:"'Sora',sans-serif", lineHeight:1.6, marginBottom:12 }}>{post.content}</div>
        <div style={{ display:"flex", gap:16, alignItems:"center" }}>
          <button onClick={()=>{ setLiked(l=>!l); setLikes(n=>liked?n-1:n+1); onLike(post.id, liked); }} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:liked?"#ff6b6b":"rgba(255,255,255,0.3)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:600 }}>
            {liked?"❤️":"🤍"} {likes}
          </button>
          <button onClick={onComment} style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.3)", fontSize:13, fontFamily:"'Sora',sans-serif", fontWeight:600 }}>
            💬 {post.comments_count||0}
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
  const [loading, setLoading] = useState(false);
  const cats = ["fitness","finance","learning","lifestyle"];

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
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 20px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Share Your Win 🏆</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>
        <textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="What did you achieve today? Share it with the community..." rows={4}
          style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none", resize:"none", marginBottom:14, boxSizing:"border-box" }}/>
        <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>Category</div>
        <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
          {cats.map(c=>(
            <button key={c} onClick={()=>setCategory(c)} style={{ padding:"7px 14px", borderRadius:12, background:category===c?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border:category===c?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.08)", color:category===c?"#A8D5C2":"rgba(255,255,255,0.4)", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>{c}</button>
          ))}
        </div>
        <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>Photo URL (optional)</div>
        <input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder="https://... paste an image link"
          style={{ width:"100%", padding:"12px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:13, fontFamily:"'Sora',sans-serif", outline:"none", marginBottom:18 }}/>
        <button onClick={submit} disabled={!content.trim()||loading} style={{ width:"100%", padding:"15px", background:content.trim()?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:content.trim()?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:content.trim()?"pointer":"not-allowed" }}>
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
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"85vh", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
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
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 32px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"80vh", display:"flex", flexDirection:"column" }}>
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
  { id:"community", label:"Community", Icon: Icons.Community },
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

function MacroBar({ label, consumed, limit, color }) {
  const pct = limit > 0 ? Math.min(100, (consumed/limit)*100) : 0;
  const over = consumed > limit && limit > 0;
  return (
    <div style={{ flex:1 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif" }}>{label}</span>
        <span style={{ fontSize:10, fontWeight:700, color: over?"#ff6b6b":color, fontFamily:"'Sora',sans-serif" }}>{Math.round(consumed)}/{limit}g</span>
      </div>
      <div style={{ height:6, borderRadius:6, background:"rgba(255,255,255,0.07)", overflow:"hidden" }}>
        <div style={{ height:"100%", borderRadius:6, width:`${pct}%`, background: over?"#ff6b6b":color, transition:"width 0.4s ease" }}/>
      </div>
    </div>
  );
}

function GoalsModal({ goals, onSave, onClose }) {
  const [vals, setVals] = useState({...goals});
  const set = (k,v) => setVals(p=>({...p,[k]:parseInt(v)||0}));
  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Daily Goals</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>
        {[
          {k:"calories", label:"🔥 Calories (kcal)", placeholder:"e.g. 2000"},
          {k:"protein",  label:"🥩 Protein (g)",     placeholder:"e.g. 150"},
          {k:"carbs",    label:"🍞 Carbs (g)",        placeholder:"e.g. 250"},
          {k:"fat",      label:"🧈 Fat (g)",           placeholder:"e.g. 65"},
          {k:"water",    label:"💧 Water (ml)",        placeholder:"e.g. 2000"},
        ].map(({k,label,placeholder})=>(
          <div key={k} style={{ marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>{label}</div>
            <input type="number" value={vals[k]||""} onChange={e=>set(k,e.target.value)} placeholder={placeholder}
              style={{ width:"100%", padding:"12px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, color:"#fff", fontSize:15, fontFamily:"'Sora',sans-serif", fontWeight:700, outline:"none" }}/>
          </div>
        ))}
        <button onClick={()=>{onSave(vals);onClose();}} style={{ width:"100%", padding:"15px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", marginTop:8 }}>
          Save Goals
        </button>
      </div>
    </div>
  );
}

function ServingModal({ food, meal, onAdd, onClose }) {
  const [grams, setGrams] = useState("100");
  const [servings, setServings] = useState("1");
  const [mode, setMode] = useState("grams"); // grams | servings
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

  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 20px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <div style={{ fontSize:16, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", flex:1, paddingRight:12 }}>{food.product_name||food.name}</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", flexShrink:0 }}><Icons.Close/></button>
        </div>

        {/* macro preview */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:20 }}>
          {[{l:"🔥 Cal",v:cal,c:"#FFB347"},{l:"🥩 Prot",v:`${prot}g`,c:"#F5DDD0"},{l:"🍞 Carb",v:`${carb}g`,c:"#C8E6DA"},{l:"🧈 Fat",v:`${fat}g`,c:"#D8D0F0"}].map(({l,v,c})=>(
            <div key={l} style={{ background:"rgba(255,255,255,0.04)", borderRadius:14, padding:"12px 8px", textAlign:"center", border:`1px solid ${c}25` }}>
              <div style={{ fontSize:16, fontWeight:800, color:c, fontFamily:"'Sora',sans-serif", lineHeight:1 }}>{v}</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginTop:3 }}>{l}</div>
            </div>
          ))}
        </div>

        {/* mode toggle */}
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          {["grams","servings"].map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{ flex:1, padding:"10px", borderRadius:12, background:mode===m?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border:mode===m?"1.5px solid rgba(168,213,194,0.4)":"1px solid rgba(255,255,255,0.08)", color:mode===m?"#A8D5C2":"rgba(255,255,255,0.4)", fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>
              {m==="grams"?"By Grams":"By Servings"}
            </button>
          ))}
        </div>

        {mode==="grams" ? (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>GRAMS</div>
            <input autoFocus type="number" value={grams} onChange={e=>setGrams(e.target.value)} placeholder="100"
              style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:24, fontFamily:"'Sora',sans-serif", fontWeight:800, outline:"none" }}/>
            <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
              {[25,50,75,100,150,200].map(g=>(
                <div key={g} onClick={()=>setGrams(String(g))} style={{ padding:"5px 12px", borderRadius:10, background: grams===String(g)?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border: grams===String(g)?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.08)", cursor:"pointer", fontSize:12, fontWeight:700, color: grams===String(g)?"#A8D5C2":"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif" }}>{g}g</div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>SERVINGS</div>
            <input autoFocus type="number" value={servings} onChange={e=>setServings(e.target.value)} placeholder="1"
              style={{ width:"100%", padding:"14px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:24, fontFamily:"'Sora',sans-serif", fontWeight:800, outline:"none" }}/>
            <div style={{ display:"flex", gap:6, marginTop:8 }}>
              {[0.5,1,1.5,2,3].map(s=>(
                <div key={s} onClick={()=>setServings(String(s))} style={{ padding:"5px 12px", borderRadius:10, background: servings===String(s)?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.05)", border: servings===String(s)?"1px solid rgba(168,213,194,0.3)":"1px solid rgba(255,255,255,0.08)", cursor:"pointer", fontSize:12, fontWeight:700, color: servings===String(s)?"#A8D5C2":"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif" }}>{s}x</div>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", marginBottom:16, textAlign:"center" }}>Adding to {MEALS.find(m=>m.key===meal)?.emoji} {MEALS.find(m=>m.key===meal)?.label}</div>

        <button onClick={submit} style={{ width:"100%", padding:"15px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer" }}>
          Add to Log
        </button>
      </div>
    </div>
  );
}

function FoodSearchModal({ meal, onSelect, onClose, startWithScan=false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const canvasRef = useRef(null);

  // Food search via Open Food Facts
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

  // Barcode lookup by number
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

  // Camera scanner using native BarcodeDetector API (supported on modern Chrome/Safari)
  const startScanner = async () => {
    setScanning(true);
    setResults([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment", width:{ ideal:1280 }, height:{ ideal:720 } } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }

      // Try native BarcodeDetector first (Chrome/Safari 17+)
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
        // Fallback: show manual barcode input
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

  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)" }}/>
      <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)", maxHeight:"88vh", display:"flex", flexDirection:"column" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 20px" }}/>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Add Food</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
        </div>

        {/* camera view */}
        {scanning && (
          <div style={{ marginBottom:16, borderRadius:20, overflow:"hidden", position:"relative", background:"#000" }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width:"100%", borderRadius:20, display:"block", maxHeight:200, objectFit:"cover" }}/>
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
              <div style={{ width:200, height:80, border:"2px solid #A8D5C2", borderRadius:8, boxShadow:"0 0 0 1000px rgba(0,0,0,0.4)" }}/>
            </div>
            <button onClick={stopScanner} style={{ position:"absolute", top:10, right:10, background:"rgba(0,0,0,0.7)", border:"none", borderRadius:10, padding:"6px 14px", color:"#fff", fontSize:12, fontFamily:"'Sora',sans-serif", fontWeight:700, cursor:"pointer" }}>✕ Stop</button>
            <div style={{ position:"absolute", bottom:10, left:0, right:0, textAlign:"center", fontSize:11, color:"rgba(255,255,255,0.6)", fontFamily:"'Sora',sans-serif" }}>Point camera at barcode</div>
          </div>
        )}

        {/* search row */}
        <div style={{ display:"flex", gap:8, marginBottom:10 }}>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search(query)} placeholder="Search food e.g. chicken, pasta..."
            style={{ flex:1, padding:"13px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
          <button onClick={()=>search(query)} style={{ padding:"0 16px", background:"rgba(168,213,194,0.15)", border:"1px solid rgba(168,213,194,0.25)", borderRadius:14, color:"#A8D5C2", fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>Go</button>
          <button onClick={()=>scanning?stopScanner():startScanner()} style={{ padding:"0 14px", background: scanning?"rgba(255,107,107,0.15)":"rgba(255,179,71,0.15)", border: scanning?"1px solid rgba(255,107,107,0.3)":"1px solid rgba(255,179,71,0.25)", borderRadius:14, color: scanning?"#ff6b6b":"#FFB347", fontSize:18, cursor:"pointer" }}>📷</button>
        </div>

        {/* manual barcode input */}
        <div style={{ display:"flex", gap:8, marginBottom:14 }}>
          <input value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&lookupBarcode(barcodeInput)} placeholder="Or type barcode number..."
            style={{ flex:1, padding:"11px 16px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, color:"rgba(255,255,255,0.7)", fontSize:13, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
          <button onClick={()=>lookupBarcode(barcodeInput)} style={{ padding:"0 14px", background:"rgba(255,179,71,0.1)", border:"1px solid rgba(255,179,71,0.2)", borderRadius:14, color:"#FFB347", fontSize:12, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>Lookup</button>
        </div>

        {/* results */}
        <div style={{ overflowY:"auto", flex:1 }}>
          {loading && (
            <div style={{ textAlign:"center", padding:"28px", color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", fontSize:13 }}>
              <div style={{ fontSize:24, marginBottom:8 }}>🔍</div>
              Searching...
            </div>
          )}
          {!loading && results.length===0 && query && (
            <div style={{ textAlign:"center", padding:"28px", color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", fontSize:13, lineHeight:1.6 }}>
              <div style={{ fontSize:24, marginBottom:8 }}>😕</div>
              No results for "{query}"<br/>
              <span style={{fontSize:11}}>Try a different name or use the barcode</span>
            </div>
          )}
          {!loading && results.length===0 && !query && (
            <div style={{ textAlign:"center", padding:"28px", color:"rgba(255,255,255,0.15)", fontFamily:"'Sora',sans-serif", fontSize:13, lineHeight:1.7 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🍽️</div>
              Search any food above<br/>
              <span style={{fontSize:11}}>or scan / type a barcode</span>
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {results.map((p,i)=>{
              const n = p.nutriments||{};
              const cal = Math.round(n["energy-kcal_100g"]||n["energy-kcal"]||0);
              return (
                <div key={i} onClick={()=>onSelect(p)} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, cursor:"pointer", transition:"all 0.15s" }}>
                  {p.image_small_url
                    ? <img src={p.image_small_url} alt="" style={{ width:42, height:42, borderRadius:10, objectFit:"cover", flexShrink:0 }}/>
                    : <div style={{ width:42, height:42, borderRadius:10, background:"rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🍽️</div>
                  }
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,0.9)", fontFamily:"'Sora',sans-serif", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{p.product_name}</div>
                    <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>
                      🔥{cal} · P:{Math.round(n["proteins_100g"]||0)}g · C:{Math.round(n["carbohydrates_100g"]||0)}g · F:{Math.round(n["fat_100g"]||0)}g
                    </div>
                  </div>
                  <div style={{ fontSize:16, color:"rgba(255,255,255,0.2)" }}>›</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function FitnessPage({ onModalChange=()=>{} }) {
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

  return (
    <div style={{ padding:"0 18px 32px" }}>
      {/* header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, animation:"fadeUp 0.4s ease both" }}>
        <div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:5 }}>YOUR BODY</div>
          <div style={{ fontSize:26, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>Fitness 💪</div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>openModal(()=>{ setQuickScan(true); setAddingMeal("breakfast"); })} style={{ background:"rgba(255,179,71,0.12)", border:"1px solid rgba(255,179,71,0.25)", borderRadius:12, padding:"8px 14px", cursor:"pointer", color:"#FFB347", fontSize:18 }}>📷</button>
          <button onClick={()=>openModal(()=>setShowGoals(true))} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"8px 14px", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:12, fontFamily:"'Sora',sans-serif", fontWeight:700 }}>⚙ Goals</button>
        </div>
      </div>

      {/* calorie summary card */}
      <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:24, padding:"20px", marginBottom:14, animation:"fadeUp 0.4s ease 0.05s both" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:11, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:3 }}>Calories Today</div>
            <div style={{ fontSize:36, fontWeight:800, color: calOver?"#ff6b6b":"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-1.5px", lineHeight:1 }}>{Math.round(totals.cal)}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>of {goals.calories} kcal goal</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:22, fontWeight:800, color: calOver?"#ff6b6b":"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>{Math.round(goals.calories - totals.cal)}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif" }}>{calOver?"over":"remaining"}</div>
          </div>
        </div>
        <div style={{ height:10, borderRadius:10, background:"rgba(255,255,255,0.07)", overflow:"hidden", marginBottom:14 }}>
          <div style={{ height:"100%", borderRadius:10, width:`${calPct}%`, background: calOver?"#ff6b6b":"linear-gradient(90deg,#A8D5C2,#C5B8E8)", transition:"width 0.4s ease" }}/>
        </div>
        {/* macro bars */}
        <div style={{ display:"flex", gap:10 }}>
          <MacroBar label="Protein" consumed={totals.prot} limit={goals.protein} color="#F5DDD0"/>
          <MacroBar label="Carbs"   consumed={totals.carb} limit={goals.carbs}   color="#C8E6DA"/>
          <MacroBar label="Fat"     consumed={totals.fat}  limit={goals.fat}     color="#D8D0F0"/>
        </div>
      </div>

      {/* water */}
      <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:20, padding:"16px 18px", marginBottom:18, animation:"fadeUp 0.4s ease 0.1s both" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif" }}>💧 Water</div>
          <div style={{ fontSize:13, fontWeight:800, color:"#C8DFF0", fontFamily:"'Sora',sans-serif" }}>{water}ml <span style={{color:"rgba(255,255,255,0.25)",fontWeight:400}}>/ {goals.water}ml</span></div>
        </div>
        <div style={{ height:6, borderRadius:6, background:"rgba(255,255,255,0.07)", overflow:"hidden", marginBottom:10 }}>
          <div style={{ height:"100%", borderRadius:6, width:`${waterPct}%`, background:"linear-gradient(90deg,#C8DFF0,#A8D5C2)", transition:"width 0.4s ease" }}/>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[250,500,1000].map(ml=>(
            <button key={ml} onClick={()=>addWater(ml)} style={{ flex:1, padding:"10px 4px", background:"rgba(200,223,240,0.1)", border:"1px solid rgba(200,223,240,0.2)", borderRadius:14, color:"#C8DFF0", fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>+{ml<1000?ml+"ml":"1L"}</button>
          ))}
          <button onClick={()=>addWater(-250)} style={{ padding:"10px 14px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, color:"rgba(255,255,255,0.3)", fontSize:13, fontWeight:700, fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>−</button>
        </div>
      </div>

      {/* meal sections */}
      {MEALS.map((meal,mi)=>{
        const mealEntries = log.filter(e=>e.meal===meal.key);
        const mealCal = mealEntries.reduce((a,e)=>a+e.cal,0);
        return (
          <div key={meal.key} style={{ marginBottom:14, animation:`fadeUp 0.4s ease ${0.12+mi*0.05}s both` }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:18 }}>{meal.emoji}</span>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{meal.label}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif" }}>{meal.hint}</div>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {mealCal > 0 && <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif" }}>{Math.round(mealCal)} kcal</div>}
                <button onClick={()=>openModal(()=>setAddingMeal(meal.key))} style={{ width:32, height:32, borderRadius:10, background:"rgba(168,213,194,0.12)", border:"1px solid rgba(168,213,194,0.2)", color:"#A8D5C2", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontWeight:700 }}>+</button>
              </div>
            </div>
            {mealEntries.length === 0 ? (
              <div style={{ padding:"12px 14px", borderRadius:14, border:"1px dashed rgba(255,255,255,0.07)", textAlign:"center" }}>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.15)", fontFamily:"'Sora',sans-serif" }}>Tap + to log a meal</div>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {mealEntries.map(e=>(
                  <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:"rgba(255,255,255,0.85)", fontFamily:"'Sora',sans-serif", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.name}</div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>
                        🔥{Math.round(e.cal)} · P:{e.prot}g · C:{e.carb}g · F:{e.fat}g
                      </div>
                    </div>
                    <div style={{ fontSize:12, fontWeight:700, color:"#FFB347", fontFamily:"'Sora',sans-serif", flexShrink:0 }}>{e.grams}g</div>
                    <button onClick={()=>delFood(e.id)} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.15)", padding:4, flexShrink:0 }}><Icons.Trash/></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {showGoals && <GoalsModal goals={goals} onSave={setGoals} onClose={()=>closeModal(()=>setShowGoals(false))}/>}
      {addingMeal && !selectedFood && <FoodSearchModal meal={addingMeal} startWithScan={quickScan} onSelect={f=>{ setSelectedFood(f); setQuickScan(false); }} onClose={()=>closeModal(()=>{ setAddingMeal(null); setQuickScan(false); })}/>}
      {selectedFood && <ServingModal food={selectedFood} meal={addingMeal} onAdd={entry=>{ addFood(entry); setSelectedFood(null); closeModal(()=>setAddingMeal(null)); }} onClose={()=>{ setSelectedFood(null); if(!addingMeal) onModalChange(false); }}/>}
    </div>
  );
}

/* ─────────────────────────────────────────────
   PROFILE / APP SETTINGS PAGE
───────────────────────────────────────────── */
function ProfilePage({ onModalChange=()=>{} }) {
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
  const [section, setSection]     = useState(null);
  const [token, setToken]         = useState(()=>localStorage.getItem("rslv_token")||null);
  const [showAuth, setShowAuth]   = useState(false);

  // stats
  const streak   = load("rslv_streak",0);
  const habits   = load("rslv_habits",[]);
  const history  = load("rslv_learn_history",[]);
  const salary   = load("rslv_salary",0);
  const expenses = load("rslv_expenses",[]);
  const totalSaved = salary>0 ? Math.max(0,salary-expenses.reduce((a,e)=>a+e.amount,0)) : 0;

  const CURRENCIES = ["€","$","£","CHF","kr","zł","Kč","Ft","lei","лв","₺","₹","¥","₩","R$"];

  const saveGoal = (k,v) => {
    const updated = {...goals,[k]:parseInt(v)||0};
    setGoals(updated);
    save("rslv_fit_goals",updated);
  };

  const toggleNotif = (k) => {
    const updated = {...notifs,[k]:!notifs[k]};
    setNotifs(updated);
    save("rslv_notifs",updated);
  };

  const saveName = () => {
    setName(draftName);
    setAvatar(draftAvatar);
    save("rslv_display_name",draftName);
    save("rslv_avatar",draftAvatar);
    setEditName(false);
    onModalChange(false);
  };

  const resetToday = () => {
    save("rslv_done",{date:"",checked:{}});
    save("rslv_fit_log",{date:"",entries:[]});
    save("rslv_fit_water",{date:"",ml:0});
    setShowReset(false);
    alert("Today's data cleared.");
  };

  const clearAll = () => {
    const keys = ["rslv_habits","rslv_done","rslv_streak","rslv_salary","rslv_expenses","rslv_loans","rslv_fit_goals","rslv_fit_log","rslv_fit_water","rslv_learn_history","rslv_lang","rslv_learn_streak","rslv_profile","rslv_display_name","rslv_avatar","rslv_currency"];
    keys.forEach(k=>localStorage.removeItem(k));
    setShowClear(false);
    window.location.reload();
  };

  const Row = ({icon, label, value, onPress, danger}) => (
    <div onClick={onPress} style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 18px", cursor:onPress?"pointer":"default", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize:18, width:24, textAlign:"center" }}>{icon}</div>
      <div style={{ flex:1, fontSize:14, fontWeight:600, color:danger?"#ff6b6b":"rgba(255,255,255,0.8)", fontFamily:"'Sora',sans-serif" }}>{label}</div>
      {value && <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>{value}</div>}
      {onPress && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>}
    </div>
  );

  const Toggle = ({label, icon, value, onToggle}) => (
    <div style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 18px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize:18, width:24, textAlign:"center" }}>{icon}</div>
      <div style={{ flex:1, fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.8)", fontFamily:"'Sora',sans-serif" }}>{label}</div>
      <div onClick={onToggle} style={{ width:44, height:26, borderRadius:13, background:value?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.1)", position:"relative", cursor:"pointer", transition:"all 0.25s", flexShrink:0 }}>
        <div style={{ position:"absolute", top:3, left:value?20:3, width:20, height:20, borderRadius:"50%", background:"#fff", transition:"all 0.25s", boxShadow:"0 2px 6px rgba(0,0,0,0.3)" }}/>
      </div>
    </div>
  );

  // ── SECTION SCREENS ──
  if(section==="goals") return (
    <div style={{ padding:"0 18px 32px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button onClick={()=>setSection(null)} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18 }}>‹</button>
        <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Daily Goals</div>
      </div>
      {[
        {k:"calories",label:"🔥 Calories",unit:"kcal"},
        {k:"protein", label:"🥩 Protein", unit:"g"},
        {k:"carbs",   label:"🍞 Carbs",   unit:"g"},
        {k:"fat",     label:"🧈 Fat",      unit:"g"},
        {k:"water",   label:"💧 Water",    unit:"ml"},
      ].map(({k,label,unit})=>(
        <div key={k} style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>{label}</div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <input type="number" defaultValue={goals[k]} onBlur={e=>saveGoal(k,e.target.value)}
              style={{ flex:1, padding:"13px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:16, fontFamily:"'Sora',sans-serif", fontWeight:700, outline:"none" }}/>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", width:32 }}>{unit}</div>
          </div>
        </div>
      ))}
    </div>
  );

  if(section==="currency") return (
    <div style={{ padding:"0 18px 32px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button onClick={()=>setSection(null)} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18 }}>‹</button>
        <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Currency</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
        {CURRENCIES.map(c=>(
          <div key={c} onClick={()=>{ setCurrency(c); save("rslv_currency",c); setSection(null); }}
            style={{ padding:"18px 8px", borderRadius:16, background:currency===c?"rgba(168,213,194,0.15)":"rgba(255,255,255,0.04)", border:currency===c?"1.5px solid rgba(168,213,194,0.4)":"1px solid rgba(255,255,255,0.08)", textAlign:"center", cursor:"pointer", transition:"all 0.2s" }}>
            <div style={{ fontSize:22, fontWeight:800, color:currency===c?"#A8D5C2":"rgba(255,255,255,0.6)", fontFamily:"'Sora',sans-serif" }}>{c}</div>
          </div>
        ))}
      </div>
    </div>
  );

  if(section==="history") return (
    <div style={{ padding:"0 18px 32px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button onClick={()=>setSection(null)} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18 }}>‹</button>
        <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Growth History</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
        {[
          {label:"Day Streak",    value:`${streak}🔥`,              color:"#FFB347"},
          {label:"Words Learned", value:history.length,             color:"#A8D5C2"},
          {label:"Active Habits", value:habits.length,              color:"#C5B8E8"},
          {label:"Saved",         value:`${currency}${totalSaved.toFixed(0)}`, color:"#C8E6DA"},
        ].map(({label,value,color})=>(
          <div key={label} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:"16px 14px" }}>
            <div style={{ fontSize:24, fontWeight:800, color, fontFamily:"'Sora',sans-serif", lineHeight:1, marginBottom:4 }}>{value}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>{label}</div>
          </div>
        ))}
      </div>
      {history.length>0 && (
        <>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.12em", color:"rgba(255,255,255,0.3)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:10 }}>Words Learned</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
            {history.slice(0,30).map((h,i)=>(
              <div key={i} style={{ padding:"5px 12px", borderRadius:12, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)" }}>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif" }}>{h.word}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  if(section==="help") return (
    <div style={{ padding:"0 18px 32px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button onClick={()=>setSection(null)} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18 }}>‹</button>
        <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Help Center</div>
      </div>
      {[
        { q:"How does the Growth Circle work?", a:"Your Growth Circle fills based on the habits you complete each day. Each habit is worth an equal share of 100 points. Complete all habits = 100. It resets every day — fresh start, no guilt." },
        { q:"How does the Jar System work?", a:"When you add your salary, it automatically splits into 6 jars based on T. Harv Eker's system: 55% Necessities, 10% Savings, 10% Education, 10% Play, 10% Freedom, 5% Give. Each expense deducts from the right jar." },
        { q:"How do I join a Challenge?", a:"Go to Community → Challenges tab. Tap any challenge and hit Join. It will appear on your Home dashboard and affect your Growth Circle while active." },
        { q:"Why is my streak broken?", a:"Your streak only continues if you complete ALL your habits every day. Miss one day and it resets to 0. Tip: keep your habit list small and realistic." },
        { q:"How do I add a subscription reminder?", a:"Go to Finance → Subscriptions section → tap Add. Add the name, amount and renewal day. Toggle on the reminder and you'll be notified 2 days before it renews." },
        { q:"Can I change my currency?", a:"Yes. Go to Settings → Currency and pick from 15 currencies. The change applies everywhere in the app immediately." },
      ].map(({q,a},i)=>(
        <div key={i} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:"16px", marginBottom:10 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:8 }}>{q}</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", lineHeight:1.6 }}>{a}</div>
        </div>
      ))}
    </div>
  );

  if(section==="privacy") return (
    <div style={{ padding:"0 18px 32px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <button onClick={()=>setSection(null)} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:10, width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18 }}>‹</button>
        <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Privacy Policy</div>
      </div>
      {[
        { title:"Data We Collect", body:"Risolvero stores your habits, finance data, fitness logs and learning history locally on your device. Community posts and profile data are stored on our secure Supabase database." },
        { title:"How We Use Your Data", body:"Your data is used only to power the app features you use. We never sell your data to third parties. We never share your personal information with advertisers." },
        { title:"Community Data", body:"When you post in the community, your username and post content are visible to other users. You can delete your posts at any time." },
        { title:"Local Storage", body:"All personal data (habits, finance, fitness, learning) is stored locally on your device using browser localStorage. Clearing app data in Settings removes everything." },
        { title:"Third Party Services", body:"We use Supabase for community features and Open Food Facts for food database search. Both are privacy-respecting services." },
        { title:"Contact", body:"For any privacy concerns, you can clear all your data at any time from Settings → Data → Clear All App Data." },
      ].map(({title,body},i)=>(
        <div key={i} style={{ marginBottom:16 }}>
          <div style={{ fontSize:14, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:6 }}>{title}</div>
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", lineHeight:1.7 }}>{body}</div>
        </div>
      ))}
    </div>
  );

  // ── MAIN SETTINGS SCREEN ──
  return (
    <div style={{ padding:"0 0 120px" }}>

      {/* header */}
      <div style={{ padding:"0 18px 20px", animation:"fadeUp 0.4s ease both" }}>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:5 }}>APP</div>
        <div style={{ fontSize:26, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px" }}>Settings</div>
      </div>

      {/* profile card */}
      <div style={{ padding:"0 18px", marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, padding:"20px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:24 }}>
          <div onClick={()=>{ setDraftName(name); setDraftAvatar(avatar); onModalChange(true); setEditName(true); }}
            style={{ width:60, height:60, borderRadius:18, background: avatar?"transparent":"linear-gradient(135deg,#A8D5C2,#C5B8E8)", overflow:"hidden", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, fontWeight:800, color:"#1a1d2e", fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>
            {avatar ? <img src={avatar} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : (name?.[0]||"R")}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", marginBottom:2 }}>{name||"Your Name"}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif" }}>Tap to edit profile</div>
          </div>
          <button onClick={()=>{ setDraftName(name); setDraftAvatar(avatar); onModalChange(true); setEditName(true); }} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"7px 12px", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:12, fontFamily:"'Sora',sans-serif", fontWeight:700 }}>Edit</button>
        </div>
      </div>

      {/* PREFERENCES */}
      <div style={{ padding:"0 18px", marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>Preferences</div>
      </div>
      <div style={{ background:"rgba(255,255,255,0.04)", borderTop:"1px solid rgba(255,255,255,0.07)", borderBottom:"1px solid rgba(255,255,255,0.07)", marginBottom:20 }}>
        <Row icon="💰" label="Currency" value={currency} onPress={()=>setSection("currency")}/>
        <Row icon="🎯" label="Daily Goals" value={`${goals.calories} kcal`} onPress={()=>setSection("goals")}/>
        <Row icon="📊" label="Growth History" onPress={()=>setSection("history")}/>
      </div>

      {/* NOTIFICATIONS */}
      <div style={{ padding:"0 18px", marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>Notifications</div>
      </div>
      <div style={{ background:"rgba(255,255,255,0.04)", borderTop:"1px solid rgba(255,255,255,0.07)", borderBottom:"1px solid rgba(255,255,255,0.07)", marginBottom:20 }}>
        <Toggle icon="🔥" label="Daily Habit Reminder" value={notifs.habits} onToggle={()=>toggleNotif("habits")}/>
        <Toggle icon="⚡" label="Streak Alert" value={notifs.streak} onToggle={()=>toggleNotif("streak")}/>
        <Toggle icon="💰" label="Finance Reminders" value={notifs.finance} onToggle={()=>toggleNotif("finance")}/>
        <div style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 18px", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize:18, width:24, textAlign:"center" }}>⏰</div>
          <div style={{ flex:1, fontSize:14, fontWeight:600, color:"rgba(255,255,255,0.8)", fontFamily:"'Sora',sans-serif" }}>Reminder Time</div>
          <input type="time" defaultValue={load(NOTIF_KEY,"09:00")} onChange={e=>{ save(NOTIF_KEY,e.target.value); scheduleNotifications(); }}
            style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"6px 12px", color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none", colorScheme:"dark" }}/>
        </div>
        <div onClick={async()=>{ const granted = await requestNotifPermission(); if(granted) scheduleNotifications(); }} style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 18px", cursor:"pointer" }}>
          <div style={{ fontSize:18, width:24, textAlign:"center" }}>🔔</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:600, color:"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>Enable Notifications</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>
              {typeof Notification !== "undefined" ? Notification.permission === "granted" ? "✅ Notifications enabled" : "Tap to allow notifications" : "Not supported on this browser"}
            </div>
          </div>
        </div>
      </div>

      {/* COMMUNITY ACCOUNT */}
      <div style={{ padding:"0 18px", marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>Community Account</div>
      </div>
      <div style={{ background:"rgba(255,255,255,0.04)", borderTop:"1px solid rgba(255,255,255,0.07)", borderBottom:"1px solid rgba(255,255,255,0.07)", marginBottom:20 }}>
        {token ? (
          <div onClick={()=>{ localStorage.removeItem("rslv_token"); setToken(null); }} style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 18px", cursor:"pointer" }}>
            <div style={{ fontSize:18, width:24, textAlign:"center" }}>🚪</div>
            <div style={{ flex:1, fontSize:14, fontWeight:600, color:"#ff6b6b", fontFamily:"'Sora',sans-serif" }}>Sign Out of Community</div>
          </div>
        ) : (
          <div onClick={()=>{ onModalChange(true); setShowAuth(true); }} style={{ display:"flex", alignItems:"center", gap:14, padding:"15px 18px", cursor:"pointer" }}>
            <div style={{ fontSize:18, width:24, textAlign:"center" }}>🌱</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:14, fontWeight:600, color:"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>Sign In to Community</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>Post wins, join challenges, follow others</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        )}
      </div>

      {/* DATA */}
      <div style={{ padding:"0 18px", marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>Data</div>
      </div>
      <div style={{ background:"rgba(255,255,255,0.04)", borderTop:"1px solid rgba(255,255,255,0.07)", borderBottom:"1px solid rgba(255,255,255,0.07)", marginBottom:20 }}>
        <Row icon="🔄" label="Reset Today's Data" onPress={()=>setShowReset(true)}/>
        <Row icon="🗑" label="Clear All App Data" danger onPress={()=>setShowClear(true)}/>
      </div>

      {/* SUPPORT */}
      <div style={{ padding:"0 18px", marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>Support</div>
      </div>
      <div style={{ background:"rgba(255,255,255,0.04)", borderTop:"1px solid rgba(255,255,255,0.07)", borderBottom:"1px solid rgba(255,255,255,0.07)", marginBottom:20 }}>
        <Row icon="❓" label="Help Center" onPress={()=>setSection("help")}/>
        <Row icon="🔒" label="Privacy Policy" onPress={()=>setSection("privacy")}/>
        <Row icon="⭐" label="Rate Risolvero" onPress={()=>window.open("https://risolveroapp2.vercel.app","_blank")}/>
      </div>

      {/* ABOUT */}
      <div style={{ padding:"0 18px", marginBottom:8 }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.14em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", fontFamily:"'Sora',sans-serif" }}>About</div>
      </div>
      <div style={{ background:"rgba(255,255,255,0.04)", borderTop:"1px solid rgba(255,255,255,0.07)", borderBottom:"1px solid rgba(255,255,255,0.07)", marginBottom:20 }}>
        <Row icon="📱" label="Version" value="1.0.0"/>
        <Row icon="🌱" label="Risolvero" value="Built for growth"/>
        <Row icon="👨‍💻" label="Made with" value="❤️"/>
      </div>

      {/* auth modal */}
      {showAuth && (
        <AuthScreen
          onLogin={async (email, password) => {
            const d = await sbAuth("token?grant_type=password", { email, password });
            if (d.access_token) {
              localStorage.setItem("rslv_token", d.access_token);
              setToken(d.access_token);
              onModalChange(false);
              setShowAuth(false);
              return true;
            }
            return d.error_description || "Login failed";
          }}
          onSignup={async (email, password, username, fullName) => {
            const d = await sbAuth("signup", { email, password });
            const uid = d.id || d.user?.id;
            const tok = d.access_token || d.session?.access_token;
            if (uid && tok) {
              localStorage.setItem("rslv_token", tok);
              try { await sb("profiles", { method:"POST", body:JSON.stringify({ id:uid, username, full_name:fullName }), headers:{ "apikey":SUPABASE_KEY, "Authorization":`Bearer ${tok}`, "Content-Type":"application/json", "Prefer":"return=representation" } }); } catch {}
              setToken(tok);
              onModalChange(false);
              setShowAuth(false);
              return true;
            }
            return d.error_description || "Signup failed";
          }}
          onClose={() => { onModalChange(false); setShowAuth(false); }}
          onModalChange={onModalChange}
        />
      )}

      {/* edit name modal */}
      {editName && (
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={()=>{ setEditName(false); onModalChange(false); }} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:"28px 28px 0 0", padding:"24px 22px 44px", animation:"sheetUp 0.3s ease both", border:"1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.15)", margin:"0 auto 22px" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
              <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif" }}>Edit Profile</div>
              <button onClick={()=>{ setEditName(false); onModalChange(false); }} style={{ background:"rgba(255,255,255,0.08)", border:"none", borderRadius:10, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)" }}><Icons.Close/></button>
            </div>
            {[
              {label:"Display Name", val:draftName, set:setDraftName, placeholder:"Your name"},
              {label:"Avatar URL", val:draftAvatar, set:setDraftAvatar, placeholder:"https://... paste a photo link"},
            ].map(({label,val,set,placeholder})=>(
              <div key={label} style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:8, letterSpacing:"0.1em", textTransform:"uppercase" }}>{label}</div>
                <input value={val} onChange={e=>set(e.target.value)} placeholder={placeholder}
                  style={{ width:"100%", padding:"13px 16px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:14, color:"#fff", fontSize:14, fontFamily:"'Sora',sans-serif", outline:"none" }}/>
              </div>
            ))}
            <button onClick={saveName} style={{ width:"100%", padding:"15px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", marginTop:8 }}>Save</button>
          </div>
        </div>
      )}

      {/* reset confirm */}
      {showReset && (
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}>
          <div onClick={()=>setShowReset(false)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.7)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:340, background:"#1a1d2e", borderRadius:24, padding:"28px 24px", border:"1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize:32, textAlign:"center", marginBottom:12 }}>🔄</div>
            <div style={{ fontSize:17, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", textAlign:"center", marginBottom:8 }}>Reset Today?</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", textAlign:"center", lineHeight:1.6, marginBottom:22 }}>This clears today's habits, food log and water. Your history stays safe.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowReset(false)} style={{ flex:1, padding:"13px", background:"rgba(255,255,255,0.06)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>Cancel</button>
              <button onClick={resetToday} style={{ flex:1, padding:"13px", background:"rgba(255,179,71,0.2)", border:"1px solid rgba(255,179,71,0.3)", borderRadius:14, fontSize:14, fontWeight:700, color:"#FFB347", fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {showAuth && <AuthScreen onLogin={async(e,p)=>{ const d=await sbAuth("token?grant_type=password",{email:e,password:p}); if(d.access_token){localStorage.setItem("rslv_token",d.access_token);setToken(d.access_token);onModalChange(false);setShowAuth(false);return true;} return d.error_description||"Failed"; }} onSignup={async(e,p,u,n)=>{ const d=await sbAuth("signup",{email:e,password:p}); if(d.id||d.user?.id){const tok=d.access_token||d.session?.access_token;if(tok){localStorage.setItem("rslv_token",tok);try{await sb("profiles",{method:"POST",body:JSON.stringify({id:d.id||d.user.id,username:u,full_name:n}),headers:{"apikey":SUPABASE_KEY,"Authorization":`Bearer ${tok}`,"Content-Type":"application/json","Prefer":"return=representation"}});}catch{}setToken(tok);onModalChange(false);setShowAuth(false);return true;}} return d.error_description||"Failed"; }} onClose={()=>{ onModalChange(false); setShowAuth(false); }} onModalChange={onModalChange}/> }
        <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 24px" }}>
          <div onClick={()=>setShowClear(false)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.7)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:340, background:"#1a1d2e", borderRadius:24, padding:"28px 24px", border:"1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize:32, textAlign:"center", marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:17, fontWeight:800, color:"#ff6b6b", fontFamily:"'Sora',sans-serif", textAlign:"center", marginBottom:8 }}>Clear Everything?</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", textAlign:"center", lineHeight:1.6, marginBottom:22 }}>This permanently deletes all your habits, history, finance data and settings. Cannot be undone.</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={()=>setShowClear(false)} style={{ flex:1, padding:"13px", background:"rgba(255,255,255,0.06)", border:"none", borderRadius:14, fontSize:14, fontWeight:700, color:"rgba(255,255,255,0.5)", fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>Cancel</button>
              <button onClick={clearAll} style={{ flex:1, padding:"13px", background:"rgba(255,107,107,0.2)", border:"1px solid rgba(255,107,107,0.3)", borderRadius:14, fontSize:14, fontWeight:700, color:"#ff6b6b", fontFamily:"'Sora',sans-serif", cursor:"pointer" }}>Clear All</button>
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

  const GOAL_OPTIONS = [
    { id:"habits",   emoji:"✅", label:"Build habits",     desc:"Daily routines that stick" },
    { id:"fitness",  emoji:"💪", label:"Get fit",           desc:"Track food, water & workouts" },
    { id:"finance",  emoji:"💰", label:"Save money",        desc:"The jar system that works" },
    { id:"learning", emoji:"📚", label:"Learn something",   desc:"5 words a day, every day" },
  ];

  const toggleGoal = (id) => setGoals(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  const SCREENS = [
    // Screen 0 — Welcome
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"0 28px", textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:24, animation:"cardIn 0.6s ease both" }}>🌱</div>
      <div style={{ fontSize:32, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-1px", marginBottom:12, lineHeight:1.2, animation:"fadeUp 0.5s ease 0.1s both" }}>
        Welcome to Risolvero
      </div>
      <div style={{ fontSize:16, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", lineHeight:1.7, marginBottom:48, animation:"fadeUp 0.5s ease 0.2s both" }}>
        The app for people who want to be better — and actually become it.
      </div>
      <div style={{ width:"100%", animation:"fadeUp 0.5s ease 0.3s both" }}>
        <button onClick={()=>setStep(1)} style={{ width:"100%", padding:"18px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:20, fontSize:16, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", marginBottom:12, boxShadow:"0 8px 30px rgba(168,213,194,0.25)" }}>
          Let's go →
        </button>
        <button onClick={()=>onComplete("")} style={{ width:"100%", padding:"14px", background:"none", border:"none", fontSize:13, fontFamily:"'Sora',sans-serif", color:"rgba(255,255,255,0.2)", cursor:"pointer" }}>
          Skip intro
        </button>
      </div>
    </div>,

    // Screen 1 — What do you want to improve?
    <div style={{ padding:"60px 24px 32px", minHeight:"100vh" }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:12 }}>Step 1 of 3</div>
      <div style={{ fontSize:26, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px", marginBottom:6, lineHeight:1.2 }}>What do you want to improve?</div>
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:32 }}>Pick everything that matters to you</div>
      <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:40 }}>
        {GOAL_OPTIONS.map(g=>{
          const sel = goals.includes(g.id);
          return (
            <div key={g.id} onClick={()=>toggleGoal(g.id)} style={{ display:"flex", alignItems:"center", gap:16, padding:"18px 20px", borderRadius:20, background:sel?"rgba(168,213,194,0.1)":"rgba(255,255,255,0.04)", border:sel?"1.5px solid rgba(168,213,194,0.35)":"1px solid rgba(255,255,255,0.08)", cursor:"pointer", transition:"all 0.2s" }}>
              <div style={{ fontSize:32 }}>{g.emoji}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:16, fontWeight:700, color:"#fff", fontFamily:"'Sora',sans-serif" }}>{g.label}</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginTop:2 }}>{g.desc}</div>
              </div>
              <div style={{ width:24, height:24, borderRadius:"50%", background:sel?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.08)", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s", flexShrink:0 }}>
                {sel && <Icons.Check/>}
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={()=>setStep(2)} disabled={goals.length===0} style={{ width:"100%", padding:"18px", background:goals.length>0?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.06)", border:"none", borderRadius:20, fontSize:16, fontWeight:800, fontFamily:"'Sora',sans-serif", color:goals.length>0?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:goals.length>0?"pointer":"not-allowed", transition:"all 0.2s" }}>
        Continue →
      </button>
    </div>,

    // Screen 2 — What's your name?
    <div style={{ padding:"60px 24px 32px", minHeight:"100vh" }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.14em", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", marginBottom:12 }}>Step 2 of 3</div>
      <div style={{ fontSize:26, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.5px", marginBottom:6 }}>What's your name?</div>
      <div style={{ fontSize:14, color:"rgba(255,255,255,0.3)", fontFamily:"'Sora',sans-serif", marginBottom:40 }}>So the app feels personal</div>
      <input
        autoFocus
        value={name}
        onChange={e=>setName(e.target.value)}
        onKeyDown={e=>e.key==="Enter"&&name.trim()&&setStep(3)}
        placeholder="Your first name"
        style={{ width:"100%", padding:"18px 20px", background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:18, color:"#fff", fontSize:22, fontFamily:"'Sora',sans-serif", fontWeight:700, outline:"none", marginBottom:40, display:"block" }}
      />
      <div style={{ fontSize:13, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif", textAlign:"center", marginBottom:20 }}>
        {name ? `Nice to meet you, ${name} 👋` : ""}
      </div>
      <button onClick={()=>setStep(3)} disabled={!name.trim()} style={{ width:"100%", padding:"18px", background:name.trim()?"linear-gradient(135deg,#A8D5C2,#C5B8E8)":"rgba(255,255,255,0.06)", border:"none", borderRadius:20, fontSize:16, fontWeight:800, fontFamily:"'Sora',sans-serif", color:name.trim()?"#1a1d2e":"rgba(255,255,255,0.2)", cursor:name.trim()?"pointer":"not-allowed", transition:"all 0.2s" }}>
        Continue →
      </button>
    </div>,

    // Screen 3 — Ready!
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"0 28px", textAlign:"center" }}>
      <div style={{ fontSize:72, marginBottom:20, animation:"cardIn 0.5s ease both" }}>🚀</div>
      <div style={{ fontSize:30, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", letterSpacing:"-1px", marginBottom:10, animation:"fadeUp 0.5s ease 0.05s both" }}>
        {name ? `You're ready, ${name}!` : "You're ready!"}
      </div>
      <div style={{ fontSize:15, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", lineHeight:1.7, marginBottom:16, animation:"fadeUp 0.5s ease 0.1s both" }}>
        Your journey starts today.
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:40, animation:"fadeUp 0.5s ease 0.15s both" }}>
        {goals.map(g=>{ const opt = GOAL_OPTIONS.find(o=>o.id===g); return opt ? (
          <div key={g} style={{ padding:"8px 16px", borderRadius:20, background:"rgba(168,213,194,0.1)", border:"1px solid rgba(168,213,194,0.2)", fontSize:13, fontWeight:600, color:"#A8D5C2", fontFamily:"'Sora',sans-serif" }}>
            {opt.emoji} {opt.label}
          </div>
        ) : null; })}
      </div>
      <button onClick={()=>onComplete(name)} style={{ width:"100%", padding:"18px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:20, fontSize:16, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", boxShadow:"0 8px 30px rgba(168,213,194,0.25)", animation:"fadeUp 0.5s ease 0.2s both" }}>
        Start growing 🌱
      </button>
    </div>
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{background:#12141E;height:100%;}
        ::-webkit-scrollbar{display:none;}
        @keyframes cardIn{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      <div style={{ maxWidth:430, margin:"0 auto", background:"#12141E", minHeight:"100vh", position:"relative", overflow:"hidden" }}>
        {/* progress dots */}
        {step > 0 && (
          <div style={{ position:"fixed", top:20, left:"50%", transform:"translateX(-50%)", display:"flex", gap:6, zIndex:10 }}>
            {[1,2,3].map(i=>(
              <div key={i} style={{ width: step>=i?24:8, height:8, borderRadius:8, background: step>=i?"#A8D5C2":"rgba(255,255,255,0.15)", transition:"all 0.3s" }}/>
            ))}
          </div>
        )}
        {/* back button */}
        {step > 0 && (
          <button onClick={()=>setStep(s=>s-1)} style={{ position:"fixed", top:14, left:18, background:"rgba(255,255,255,0.06)", border:"none", borderRadius:12, width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"rgba(255,255,255,0.5)", fontSize:18, zIndex:10 }}>‹</button>
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

  useEffect(()=>{
    registerSW();
    if(onboarded) scheduleNotifications();
  },[onboarded]);

  const completeOnboarding = (name) => {
    if(name) save("rslv_display_name", name);
    localStorage.setItem("rslv_onboarded","1");
    setOnboarded(true);
    // ask for notification permission after onboarding
    setTimeout(()=>setShowNotifPrompt(true), 800);
  };

  if(!onboarded) return <OnboardingScreen onComplete={completeOnboarding}/>;

  const pages = {
    home:      <HomePage onNavigate={setTab}/>,
    fitness:   <FitnessPage onModalChange={setNavHidden}/>,
    learning:  <LearningPage/>,
    finance:   <FinancePage onModalChange={setNavHidden}/>,
    community: <CommunityPage onModalChange={setNavHidden}/>,
    profile:   <ProfilePage onModalChange={setNavHidden}/>,
  };
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
        html,body{background:#12141E;overscroll-behavior:none;height:100%;}
        html{height:-webkit-fill-available;}
        .modal-open-nav{display:none !important;}
        @media (max-height: 500px){ .bottom-nav{ display:none !important; } }
        ::-webkit-scrollbar{display:none;}
        *{-webkit-overflow-scrolling:touch;}
        input::placeholder{color:rgba(255,255,255,0.25);}
        input{color-scheme:dark;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes cardIn{from{opacity:0;transform:translateY(10px) scale(0.97)}to{opacity:1;transform:scale(1)}}
        @keyframes tabIn{from{opacity:0}to{opacity:1}}
        @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      `}</style>
      <div style={{ maxWidth:430, margin:"0 auto", minHeight:"100vh", background:"#12141E", position:"relative", overflowX:"hidden", overflowY:"auto", fontFamily:"'Sora',sans-serif" }}>
        <div style={{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", width:430, height:"100vh", pointerEvents:"none", zIndex:0 }}>
          <div style={{ position:"absolute", top:-60, left:"20%", width:280, height:280, background:"radial-gradient(circle,rgba(168,213,194,0.06) 0%,transparent 65%)", filter:"blur(50px)" }}/>
          <div style={{ position:"absolute", top:100, right:"5%", width:200, height:200, background:"radial-gradient(circle,rgba(197,184,232,0.05) 0%,transparent 65%)", filter:"blur(40px)" }}/>
        </div>
        <div style={{ position:"sticky", top:0, zIndex:10, padding:"52px 18px 12px", background:"linear-gradient(180deg,#12141E 60%,transparent 100%)" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ fontSize:13, fontWeight:800, letterSpacing:"0.26em", color:"rgba(255,255,255,0.85)", fontFamily:"'Sora',sans-serif" }}>RISOLVERO</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:"'Sora',sans-serif" }}>{new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
          </div>
        </div>
        <div key={tab} style={{ position:"relative", zIndex:1, paddingBottom:110, animation:"tabIn 0.25s ease both" }}>
          {pages[tab]}
        </div>
        {/* Notification permission prompt */}
        {showNotifPrompt && Notification.permission === "default" && (
          <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center", padding:"0 0 40px" }}>
            <div onClick={()=>setShowNotifPrompt(false)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.5)" }}/>
            <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:430, background:"#1a1d2e", borderRadius:28, padding:"28px 24px", margin:"0 16px", border:"1px solid rgba(255,255,255,0.1)", animation:"sheetUp 0.3s ease both" }}>
              <div style={{ fontSize:40, textAlign:"center", marginBottom:14 }}>🔔</div>
              <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"'Sora',sans-serif", textAlign:"center", marginBottom:8 }}>Stay on track</div>
              <div style={{ fontSize:14, color:"rgba(255,255,255,0.4)", fontFamily:"'Sora',sans-serif", textAlign:"center", lineHeight:1.6, marginBottom:24 }}>
                Get reminders for your habits, streak alerts and subscription renewals.
              </div>
              <button onClick={async()=>{ await requestNotifPermission(); scheduleNotifications(); setShowNotifPrompt(false); }} style={{ width:"100%", padding:"16px", background:"linear-gradient(135deg,#A8D5C2,#C5B8E8)", border:"none", borderRadius:16, fontSize:15, fontWeight:800, fontFamily:"'Sora',sans-serif", color:"#1a1d2e", cursor:"pointer", marginBottom:10 }}>
                Enable Notifications
              </button>
              <button onClick={()=>setShowNotifPrompt(false)} style={{ width:"100%", padding:"12px", background:"none", border:"none", fontSize:13, fontFamily:"'Sora',sans-serif", color:"rgba(255,255,255,0.25)", cursor:"pointer" }}>
                Not now
              </button>
            </div>
          </div>
        )}

        {!navHidden && (
        <div className="bottom-nav" style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:430, padding:"0 16px 26px", zIndex:20, paddingBottom:"max(26px, env(safe-area-inset-bottom))" }}>
          <div style={{ background:"rgba(18,20,30,0.96)", backdropFilter:"blur(30px)", WebkitBackdropFilter:"blur(30px)", borderRadius:28, border:"1px solid rgba(255,255,255,0.07)", padding:"10px 4px", display:"flex", justifyContent:"space-around", boxShadow:"0 8px 40px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.05)" }}>
            {TABS.map(({id,label,Icon})=>{
              const active=tab===id;
              return (
                <button key={id} onClick={()=>setTab(id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4, padding:"6px 2px", background:"none", border:"none", cursor:"pointer", color:active?"#A8D5C2":"rgba(255,255,255,0.2)", transition:"all 0.2s", position:"relative" }}>
                  {active&&<div style={{ position:"absolute", top:-10, left:"50%", transform:"translateX(-50%)", width:22, height:3, borderRadius:2, background:"linear-gradient(90deg,#A8D5C2,#C5B8E8)", boxShadow:"0 0 8px rgba(168,213,194,0.5)" }}/>}
                  <Icon active={active}/>
                  <span style={{ fontSize:10, fontWeight:active?700:500, fontFamily:"'Sora',sans-serif" }}>{label}</span>
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
