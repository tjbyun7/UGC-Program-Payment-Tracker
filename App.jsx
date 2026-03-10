import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";

// ─── Constants ────────────────────────────────────────────────────────────────
const TODAY = new Date();
const LOCK_OPTIONS = [7, 14, 30, 90];

const PLATFORMS = {
  tiktok:   { label: "TikTok",           color: "#69C9D0", icon: "♪", urlPlaceholder: "https://tiktok.com/@user/video/..." },
  ig:       { label: "Instagram Reels",  color: "#E1306C", icon: "◈", urlPlaceholder: "https://instagram.com/reel/..." },
  youtube:  { label: "YouTube Shorts",   color: "#FF0000", icon: "▶", urlPlaceholder: "https://youtube.com/shorts/..." },
};

const DEFAULT_TIERS = [
  { label: "Under 10K",  minViews: 1000,     payout: 35 },
  { label: "10K+",       minViews: 10000,    payout: 50 },
  { label: "50K+",       minViews: 50000,    payout: 100 },
  { label: "100K+",      minViews: 100000,   payout: 150 },
  { label: "250K+",      minViews: 250000,   payout: 300 },
  { label: "500K+",      minViews: 500000,   payout: 500 },
  { label: "1M+",        minViews: 1000000,  payout: 700 },
  { label: "2M+",        minViews: 2000000,  payout: 900 },
  { label: "3M+",        minViews: 3000000,  payout: 1100 },
  { label: "4M+",        minViews: 4000000,  payout: 1300 },
  { label: "5M+",        minViews: 5000000,  payout: 1500 },
  { label: "10M+",       minViews: 10000000, payout: 2250 },
];

const AVC = ["#FF6B6B","#4ECDC4","#FFD93D","#A78BFA","#6BCB77","#F7931E","#00B4D8","#E63946"];
const LS_SETTINGS = "ugc_settings";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  return Math.floor((TODAY - new Date(dateStr)) / 86400000);
}
function getLockStatus(dateStr, lockDays) {
  const days = daysSince(dateStr);
  const remaining = Math.max(lockDays - days, 0);
  return { locked: days >= lockDays, daysIn: days, remaining, pct: Math.min((days / lockDays) * 100, 100) };
}
function calcPayout(views, tiers, cap = Infinity) {
  if (!views || views < 1000) return { payout: 0, qualified: false, capped: false };
  const effective = cap > 0 ? Math.min(views, cap) : views;
  const capped = cap > 0 && views > cap;
  const tier = [...tiers].reverse().find(t => effective >= t.minViews);
  return { payout: tier ? tier.payout : 0, qualified: true, capped };
}
function fmtV(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}
function fmtM(n) { return "$" + (n || 0).toLocaleString(); }
function calcCpm(views, spend) {
  if (!views || views < 1000) return null;
  return (spend / views) * 1000;
}
function fmtCpm(cpm) {
  if (cpm === null || cpm === undefined) return "—";
  return "$" + cpm.toFixed(2);
}
function ini(name) { return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2); }

function getTopPlatform(video) {
  let top = { platform: null, live: 0, locked: 0 };
  for (const key of Object.keys(PLATFORMS)) {
    const live = video.platforms?.[key]?.live || 0;
    if (live > top.live) top = { platform: key, live, locked: video.platforms?.[key]?.locked ?? null };
  }
  return top;
}

function totalLiveViews(video) {
  return Math.max(...Object.keys(PLATFORMS).map(k => video.platforms?.[k]?.live || 0));
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function fetchCreatorsFromSupabase() {
  try {
    const { data, error } = await supabase.from("ugc_creators").select("*");
    if (error) { console.error("Supabase fetch error", error); return null; }
    if (!data || data.length === 0) return null;
    return data.map(row => ({
      id: row.id,
      name: row.name,
      handle: row.handle,
      email: row.email,
      avatarColor: row.avatar_color,
      joinedDate: row.joined_date,
      videos: row.videos_json || [],
    }));
  } catch (e) { console.error("Supabase fetch threw", e); return null; }
}

async function syncCreatorsToSupabase(creators) {
  try {
    const payload = creators.map(c => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      email: c.email,
      avatar_color: c.avatarColor,
      joined_date: c.joinedDate,
      videos_json: c.videos,
    }));
    const { error } = await supabase.from("ugc_creators").upsert(payload, { onConflict: "id" });
    if (error) console.error("Supabase upsert error", error);
  } catch (e) { console.error("Supabase upsert threw", e); }
}

async function removeCreatorFromSupabase(id) {
  try {
    const { error } = await supabase.from("ugc_creators").delete().eq("id", id);
    if (error) console.error("Supabase delete error", error);
  } catch (e) { console.error("Supabase delete threw", e); }
}

// ─── Small UI components ──────────────────────────────────────────────────────
function Badge({ children, color }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap", background: color + "1A", color, border: `1px solid ${color}38` }}>
      {children}
    </span>
  );
}

function PillToggle({ value, onChange, options, small }) {
  return (
    <div style={{ display: "inline-flex", background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: small ? "4px 10px" : "5px 13px", borderRadius: 6, border: "none", cursor: "pointer",
          fontSize: small ? 11 : 12, fontWeight: 700, transition: "all 0.15s", fontFamily: "inherit",
          background: value === o.value ? "rgba(124,111,255,0.9)" : "transparent",
          color: value === o.value ? "#fff" : "rgba(255,255,255,0.38)",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "20px 22px" }}>
      <div style={{ fontSize: 9.5, letterSpacing: 2.5, color: "rgba(255,255,255,0.28)", fontWeight: 700, marginBottom: 9, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 900, color: accent, letterSpacing: -0.8, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.27)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function LockBar({ dateStr, lockDays }) {
  const ls = getLockStatus(dateStr, lockDays);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.28)" }}>{ls.locked ? `LOCKED · DAY ${lockDays}` : `LOCKS IN ${ls.remaining}d`}</span>
        <span style={{ fontSize: 9.5, color: ls.locked ? "#6BCB77" : "#FF9A3C", fontWeight: 700 }}>{Math.round(ls.pct)}%</span>
      </div>
      <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${ls.pct}%`, height: "100%", background: ls.locked ? "#6BCB77" : "#FF9A3C", borderRadius: 99 }} />
      </div>
    </div>
  );
}

function PlatformPills({ platforms }) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
      {Object.entries(PLATFORMS).map(([key, meta]) => {
        const p = platforms?.[key];
        if (!p?.url) return null;
        return (
          <a key={key} href={p.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 99, background: meta.color + "18", border: `1px solid ${meta.color}40`, color: meta.color, fontSize: 10, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
            <span>{meta.icon}</span>{meta.label.split(" ")[0]} · {fmtV(p.live)}
          </a>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// CREATOR PORTAL
// ════════════════════════════════════════════════════════════
function CreatorPortal({ onExitPortal }) {
  const [screen, setScreen] = useState("landing"); // landing | dashboard
  const [creatorData, setCreatorData] = useState(null);
  const [settings, setSettings] = useState({ tiers: DEFAULT_TIERS, lockDays: 14, programName: "UGC Program", logoUrl: null });

  useEffect(() => {
    // Load settings from localStorage
    try {
      const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}");
      if (s.tiers?.length) setSettings(prev => ({ ...prev, ...s }));
    } catch {}
  }, []);

  async function handleLogin(email) {
    const { data, error } = await supabase.from("ugc_creators").select("*").ilike("email", email.trim()).limit(1);
    if (error || !data || data.length === 0) return false;
    const row = data[0];
    const creator = {
      id: row.id, name: row.name, handle: row.handle, email: row.email,
      avatarColor: row.avatar_color, joinedDate: row.joined_date, videos: row.videos_json || [],
    };
    setCreatorData(creator);
    setScreen("dashboard");
    return true;
  }

  async function handleSubmitVideo(newVid) {
    const updatedVideos = [...creatorData.videos, newVid];
    const { error } = await supabase.from("ugc_creators").update({ videos_json: updatedVideos }).eq("id", creatorData.id);
    if (!error) setCreatorData(prev => ({ ...prev, videos: updatedVideos }));
    return !error;
  }

  if (screen === "dashboard" && creatorData) {
    return <PortalDashboard creator={creatorData} settings={settings} onLogout={() => { setScreen("landing"); setCreatorData(null); }} />;
  }
  return <PortalLanding onLogin={handleLogin} onExitPortal={onExitPortal} />;
}

function PortalLanding({ onLogin, onExitPortal }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSend() {
    setLoading(true); setErr("");
    const ok = await onLogin(email);
    if (!ok) { setErr("No creator found with that email. Check with your program manager."); setLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#05070F", fontFamily: "'Sora', sans-serif", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ marginBottom: 36, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg, #7C6FFF, #4ECDC4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>◈</div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: -0.3 }}>UGC Creator Portal</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>Enter your email to access your creator dashboard.</p>
        </div>
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 18, padding: "30px 28px" }}>
          <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "rgba(255,255,255,0.3)", marginBottom: 8, textTransform: "uppercase" }}>Your Email Address</label>
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder="you@example.com"
            style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "13px 16px", color: "#fff", fontSize: 15, fontFamily: "inherit", outline: "none", marginBottom: err ? 8 : 18 }} />
          {err && <div style={{ fontSize: 12, color: "#FF7070", marginBottom: 14, lineHeight: 1.5 }}>{err}</div>}
          <button onClick={handleSend} disabled={loading}
            style={{ width: "100%", padding: "14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #7C6FFF, #4ECDC4)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Looking you up..." : "Access My Dashboard →"}
          </button>
        </div>
        {onExitPortal && (
          <div style={{ textAlign: "center", marginTop: 20 }}>
            <button onClick={onExitPortal} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.2)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>← Back to Admin Dashboard</button>
          </div>
        )}
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800;900&display=swap'); input::placeholder { color: rgba(255,255,255,0.2); }`}</style>
    </div>
  );
}

function PortalDashboard({ creator, settings, onLogout }) {
  const { tiers, lockDays, programName } = settings;
  const [showSubmit, setShowSubmit] = useState(false);
  const [newVideo, setNewVideo] = useState({ title: "", postedDate: new Date().toISOString().split("T")[0], tiktok: "", ig: "", youtube: "" });
  const [submitErr, setSubmitErr] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [liveVideos, setLiveVideos] = useState(creator.videos);
  const [tab, setTab] = useState("videos");

  const enrichedVideos = useMemo(() => liveVideos.map(v => {
    const live = Math.max(...Object.keys(PLATFORMS).map(k => v.platforms?.[k]?.live || 0));
    const ls = getLockStatus(v.postedDate, lockDays);
    const { payout, qualified } = calcPayout(ls.locked ? live : live, tiers);
    return { ...v, live, ls, payout, qualified };
  }), [liveVideos, tiers, lockDays]);

  const totalLive = enrichedVideos.reduce((s, v) => s + v.live, 0);
  const totalEarned = enrichedVideos.reduce((s, v) => s + v.payout, 0);
  const totalPaid = enrichedVideos.filter(v => v.status === "paid").reduce((s, v) => s + v.payout, 0);
  const totalPending = enrichedVideos.filter(v => v.status === "pending" && v.ls.locked && v.qualified).reduce((s, v) => s + v.payout, 0);

  async function handleSubmit() {
    const urls = [newVideo.tiktok, newVideo.ig, newVideo.youtube].filter(Boolean);
    if (!newVideo.title.trim()) { setSubmitErr("Please add a video title."); return; }
    if (urls.length === 0) { setSubmitErr("Paste at least one platform URL."); return; }
    const newVid = {
      id: Date.now(), title: newVideo.title.trim(), postedDate: newVideo.postedDate, status: "pending",
      platforms: {
        tiktok:  { url: newVideo.tiktok,  live: 0, locked: null },
        ig:      { url: newVideo.ig,       live: 0, locked: null },
        youtube: { url: newVideo.youtube,  live: 0, locked: null },
      },
    };
    const updatedVideos = [...liveVideos, newVid];
    const { error } = await supabase.from("ugc_creators").update({ videos_json: updatedVideos }).eq("id", creator.id);
    if (!error) {
      setLiveVideos(updatedVideos);
      setNewVideo({ title: "", postedDate: new Date().toISOString().split("T")[0], tiktok: "", ig: "", youtube: "" });
      setSubmitErr(""); setSubmitted(true); setShowSubmit(false);
      setTimeout(() => setSubmitted(false), 4000);
    } else {
      setSubmitErr("Failed to submit. Please try again.");
    }
  }

  const statusColor = { paid: "#6BCB77", pending: "#FFD93D" };
  const labelStyle = { display: "block", fontSize: 10.5, letterSpacing: 1.8, color: "rgba(255,255,255,0.3)", marginBottom: 7, fontWeight: 700, textTransform: "uppercase" };
  const inputStyle = { display: "block", width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, padding: "11px 14px", color: "#fff", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

  return (
    <div style={{ minHeight: "100vh", background: "#05070F", fontFamily: "'Sora', sans-serif", color: "#fff" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(5,7,15,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0 24px", display: "flex", alignItems: "center", height: 58, gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#7C6FFF,#4ECDC4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>◈</div>
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{programName}</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: creator.avatarColor + "22", border: `2px solid ${creator.avatarColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: creator.avatarColor }}>{ini(creator.name)}</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{creator.name}</span>
          <button onClick={onLogout} style={{ marginLeft: 4, fontSize: 11, color: "rgba(255,255,255,0.25)", background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontFamily: "inherit" }}>Sign out</button>
        </div>
      </div>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 900, letterSpacing: -0.8 }}>Hey, {creator.name.split(" ")[0]} 👋</h1>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>{creator.handle} · {creator.email}</div>
          </div>
          <button onClick={() => setShowSubmit(true)} style={{ padding: "12px 22px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#7C6FFF,#4ECDC4)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>+ Submit Video</button>
        </div>
        {submitted && <div style={{ background: "rgba(107,203,119,0.12)", border: "1px solid rgba(107,203,119,0.3)", borderRadius: 10, padding: "12px 18px", marginBottom: 20, fontSize: 13, color: "#6BCB77", fontWeight: 600 }}>✓ Video submitted! Your program manager will add view counts shortly.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Total Live Views", value: fmtV(totalLive), color: "#A99EFF" },
            { label: "Total Earned", value: fmtM(totalEarned), color: "#4ECDC4" },
            { label: "Paid Out", value: fmtM(totalPaid), color: "#6BCB77" },
            { label: "Pending Payout", value: fmtM(totalPending), color: "#FFD93D" },
          ].map(s => (
            <div key={s.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "18px 18px" }}>
              <div style={{ fontSize: 9.5, letterSpacing: 2, color: "rgba(255,255,255,0.28)", fontWeight: 700, marginBottom: 8, textTransform: "uppercase" }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.05)", borderRadius: 9, padding: 3, width: "fit-content", marginBottom: 18 }}>
          {[{ k: "videos", l: "My Videos" }, { k: "payouts", l: "Payout Tiers" }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{ padding: "6px 16px", borderRadius: 7, border: "none", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", background: tab === t.k ? "rgba(124,111,255,0.9)" : "transparent", color: tab === t.k ? "#fff" : "rgba(255,255,255,0.38)" }}>{t.l}</button>
          ))}
        </div>
        {tab === "videos" && (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
            {enrichedVideos.length === 0 ? (
              <div style={{ padding: "50px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎬</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No videos yet</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Hit "Submit Video" to add your first post.</div>
              </div>
            ) : enrichedVideos.map((v, i) => {
              const activePlatforms = Object.keys(PLATFORMS).filter(k => v.platforms?.[k]?.url);
              return (
                <div key={v.id} style={{ padding: "20px 22px", borderBottom: i < enrichedVideos.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{v.title}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginBottom: 8 }}>Posted {v.postedDate}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {activePlatforms.map(k => (
                          <a key={k} href={v.platforms[k].url} target="_blank" rel="noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6, background: PLATFORMS[k].color + "15", border: `1px solid ${PLATFORMS[k].color}30`, color: PLATFORMS[k].color, fontSize: 11, fontWeight: 700, textDecoration: "none" }}>
                            {PLATFORMS[k].icon} {PLATFORMS[k].label.split(" ")[0]}
                          </a>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.25)", marginBottom: 3, textTransform: "uppercase" }}>Live Views</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "#A99EFF" }}>{fmtV(v.live)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.25)", marginBottom: 3, textTransform: "uppercase" }}>{v.ls.locked ? "Final Payout" : "Est. Payout"}</div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: v.qualified ? "#4ECDC4" : "rgba(255,255,255,0.3)" }}>{v.qualified ? fmtM(v.payout) : v.live > 0 ? "< 1K views" : "—"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.25)", marginBottom: 3, textTransform: "uppercase" }}>Status</div>
                        <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: statusColor[v.status] + "1A", color: statusColor[v.status], border: `1px solid ${statusColor[v.status]}38` }}>
                          {v.status === "paid" ? "✓ Paid" : "Pending"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>
                        {v.ls.locked ? `LOCKED — VIEWS SNAPSHOT AT DAY ${lockDays}` : `PAYOUT LOCKS IN ${v.ls.remaining} DAY${v.ls.remaining !== 1 ? "S" : ""}`}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: v.ls.locked ? "#6BCB77" : "#FF9A3C" }}>{Math.round(v.ls.pct)}%</span>
                    </div>
                    <div style={{ height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${v.ls.pct}%`, height: "100%", background: v.ls.locked ? "#6BCB77" : "linear-gradient(90deg, #FF9A3C, #FFD93D)", borderRadius: 99 }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {tab === "payouts" && (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "16px 22px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>
              Payout is calculated from your highest-performing platform, locked at day {lockDays} after posting.
            </div>
            {tiers.map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 22px", borderBottom: i < tiers.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{t.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#4ECDC4" }}>{fmtM(t.payout)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showSubmit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 20, backdropFilter: "blur(4px)" }}>
          <div style={{ background: "#0D1020", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "28px 28px", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Submit a Video</div>
              <button onClick={() => { setShowSubmit(false); setSubmitErr(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Video Title</label>
              <input value={newVideo.title} onChange={e => setNewVideo(p => ({ ...p, title: e.target.value }))} placeholder="e.g. My Polymarket experience" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Date Posted</label>
              <input type="date" value={newVideo.postedDate} onChange={e => setNewVideo(p => ({ ...p, postedDate: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ ...labelStyle, marginBottom: 12 }}>Platform Links <span style={{ color: "rgba(255,255,255,0.2)", fontWeight: 400 }}>(paste at least one)</span></label>
              {Object.entries(PLATFORMS).map(([k, meta]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                  <span style={{ width: 22, fontSize: 13, color: meta.color, flexShrink: 0, textAlign: "center" }}>{meta.icon}</span>
                  <input value={newVideo[k]} onChange={e => setNewVideo(p => ({ ...p, [k]: e.target.value }))} placeholder={meta.placeholder || meta.urlPlaceholder}
                    style={{ ...inputStyle, flex: 1, fontSize: 12, padding: "10px 13px" }} />
                </div>
              ))}
            </div>
            {submitErr && <div style={{ fontSize: 12, color: "#FF7070", marginBottom: 14 }}>{submitErr}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setShowSubmit(false); setSubmitErr(""); }} style={{ flex: 1, padding: "12px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button onClick={handleSubmit} style={{ flex: 2, padding: "12px", borderRadius: 9, border: "none", background: "linear-gradient(135deg,#7C6FFF,#4ECDC4)", color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Submit Video →</button>
            </div>
          </div>
        </div>
      )}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800;900&display=swap'); * { box-sizing: border-box; } input::placeholder { color: rgba(255,255,255,0.2) !important; }`}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════
function AdminDashboard({ onEnterPortal }) {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [creators, setCreators] = useState([]);
  const [tiers, setTiers] = useState(DEFAULT_TIERS);
  const [selectedId, setSelectedId] = useState(null);
  const [programName, setProgramName] = useState("UGC Program");
  const [logoUrl, setLogoUrl] = useState(null);
  const [lockDays, setLockDays] = useState(14);
  const [viewCap, setViewCap] = useState(10000000);
  const [viewCapInput, setViewCapInput] = useState("10000000");
  const [tierMode, setTierMode] = useState("manual");
  const [cpmBasePay, setCpmBasePay] = useState(35);
  const [cpmRate, setCpmRate] = useState(1.0);
  const [dashMetric, setDashMetric] = useState("live");
  const [newSubmissionToast, setNewSubmissionToast] = useState(null);
  const [showAddCreator, setShowAddCreator] = useState(false);
  const [showAddVideo, setShowAddVideo] = useState(false);
  const [showUpdate, setShowUpdate] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editCreator, setEditCreator] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [newCreator, setNewCreator] = useState({ name: "", handle: "", email: "" });
  const emptyVideo = () => ({ title: "", postedDate: TODAY.toISOString().slice(0, 10), platforms: { tiktok: { url: "", views: "" }, ig: { url: "", views: "" }, youtube: { url: "", views: "" } } });
  const [newVideo, setNewVideo] = useState(emptyVideo());
  const [updPlatforms, setUpdPlatforms] = useState({});
  const prevCreatorsRef = useRef([]);

  // Load from Supabase on mount
  useEffect(() => {
    fetchCreatorsFromSupabase().then(data => {
      if (data) { setCreators(data); prevCreatorsRef.current = data; }
      setLoading(false);
    });
    try {
      const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}");
      if (s.tiers?.length) setTiers(s.tiers);
      if (s.lockDays) setLockDays(s.lockDays);
      if (s.programName) setProgramName(s.programName);
      if (s.logoUrl) setLogoUrl(s.logoUrl);
    } catch {}
  }, []);

  // Poll Supabase every 15s for new creator submissions
  useEffect(() => {
    const interval = setInterval(async () => {
      const fresh = await fetchCreatorsFromSupabase();
      if (!fresh) return;
      setCreators(prev => {
        let hasNew = false;
        const merged = prev.map(c => {
          const fc = fresh.find(f => f.id === c.id);
          if (!fc) return c;
          const existingIds = new Set(c.videos.map(v => v.id));
          const newVids = fc.videos.filter(v => !existingIds.has(v.id));
          if (newVids.length) hasNew = true;
          return { ...c, videos: [...c.videos, ...newVids] };
        });
        if (hasNew) setNewSubmissionToast("📬 A creator just submitted a new video!");
        return hasNew ? merged : prev;
      });
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify({ tiers, lockDays, programName, logoUrl }));
  }, [tiers, lockDays, programName, logoUrl]);

  const CPM_BREAKPOINTS = [1000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2000000, 3000000, 5000000, 10000000];
  const cpmTiers = useMemo(() => {
    const pts = CPM_BREAKPOINTS.filter(v => v <= viewCap);
    if (pts[pts.length - 1] !== viewCap) pts.push(viewCap);
    return pts.map(v => ({ label: `${fmtV(v)}+`, minViews: v, payout: v < 10000 ? cpmBasePay : Math.round((v / 1000) * cpmRate) }));
  }, [cpmRate, cpmBasePay, viewCap]);

  const activeTiers = tierMode === "cpm" ? cpmTiers : tiers;

  const enriched = useMemo(() => creators.map(c => {
    const videos = c.videos.map(v => {
      const ls = getLockStatus(v.postedDate, lockDays);
      const topLive = totalLiveViews(v);
      const topPlatform = getTopPlatform(v);
      const activePlatforms = Object.keys(PLATFORMS).filter(k => v.platforms?.[k]?.url);
      let topLocked = null;
      if (activePlatforms.length > 0) {
        const lockedVals = activePlatforms.map(k => v.platforms[k]?.locked);
        if (ls.locked && lockedVals.some(lv => lv === null)) topLocked = Math.max(...activePlatforms.map(k => v.platforms[k]?.live || 0));
        else if (lockedVals.every(lv => lv !== null)) topLocked = Math.max(...lockedVals.map(lv => lv || 0));
      }
      const { payout, qualified } = calcPayout(topLocked, activeTiers, viewCap);
      return { ...v, ls, topLive, topPlatform, topLocked, payout, qualified };
    });
    const totalLive = videos.reduce((s, v) => s + v.topLive, 0);
    const totalPayable = videos.reduce((s, v) => s + v.payout, 0);
    const paidOut = videos.filter(v => v.status === "paid").reduce((s, v) => s + v.payout, 0);
    const pendingPayout = videos.filter(v => v.status === "pending" && v.ls.locked && v.qualified).reduce((s, v) => s + v.payout, 0);
    const cpm = calcCpm(totalLive, totalPayable);
    return { ...c, videos, totalLive, totalPayable, paidOut, pendingPayout, cpm };
  }), [creators, activeTiers, lockDays, viewCap]);

  const gs = useMemo(() => {
    const totalLive = enriched.reduce((s, c) => s + c.totalLive, 0);
    const totalPayable = enriched.reduce((s, c) => s + c.totalPayable, 0);
    return { creators: creators.length, videos: creators.reduce((s, c) => s + c.videos.length, 0), totalLive, totalPayable, paidOut: enriched.reduce((s, c) => s + c.paidOut, 0), pending: enriched.reduce((s, c) => s + c.pendingPayout, 0), campaignCpm: calcCpm(totalLive, totalPayable) };
  }, [enriched]);

  const sel = enriched.find(c => c.id === selectedId);

  function applyViewCap(newCap) {
    const cap = parseInt(newCap);
    if (!cap || cap <= 0) return;
    setViewCap(cap); setViewCapInput(String(cap));
  }

  function addCreator() {
    if (!newCreator.name.trim()) return;
    const nc = { id: Date.now(), ...newCreator, avatarColor: AVC[creators.length % AVC.length], joinedDate: TODAY.toISOString().slice(0, 10), videos: [] };
    const updated = [...creators, nc];
    setCreators(updated);
    syncCreatorsToSupabase(updated);
    setNewCreator({ name: "", handle: "", email: "" });
    setShowAddCreator(false);
  }

  function addVideo() {
    if (!newVideo.title.trim()) return;
    const ls = getLockStatus(newVideo.postedDate, lockDays);
    const platforms = {};
    for (const key of Object.keys(PLATFORMS)) {
      const entry = newVideo.platforms[key];
      const views = parseInt(entry.views) || 0;
      platforms[key] = { url: entry.url, live: views, locked: (ls.locked && entry.url) ? views : (entry.url ? null : 0) };
    }
    const updated = creators.map(c => c.id === selectedId ? { ...c, videos: [...c.videos, { id: Date.now(), title: newVideo.title, postedDate: newVideo.postedDate, status: "pending", platforms }] } : c);
    setCreators(updated);
    syncCreatorsToSupabase(updated);
    setNewVideo(emptyVideo()); setShowAddVideo(false);
  }

  function saveUpdate() {
    if (!showUpdate) return;
    const ls = getLockStatus(showUpdate.postedDate, lockDays);
    const updated = creators.map(c => ({
      ...c, videos: c.videos.map(v => {
        if (v.id !== showUpdate.id) return v;
        const platforms = { ...v.platforms };
        for (const key of Object.keys(PLATFORMS)) {
          if (!platforms[key]?.url) continue;
          const newLive = parseInt(updPlatforms[key]) || 0;
          platforms[key] = { ...platforms[key], live: newLive, locked: ls.locked ? platforms[key].locked ?? newLive : newLive };
        }
        return { ...v, platforms };
      }),
    }));
    setCreators(updated);
    syncCreatorsToSupabase(updated);
    setShowUpdate(null);
  }

  function markPaid(cid, vid) {
    const updated = creators.map(c => c.id === cid ? { ...c, videos: c.videos.map(v => v.id === vid ? { ...v, status: "paid" } : v) } : c);
    setCreators(updated);
    syncCreatorsToSupabase(updated);
  }

  function removeCreator(id) {
    const updated = creators.filter(c => c.id !== id);
    setCreators(updated);
    removeCreatorFromSupabase(id);
    if (selectedId === id) setSelectedId(null);
    setConfirmDelete(null);
  }

  function openEdit(creator) {
    setEditForm({ name: creator.name, handle: creator.handle, email: creator.email });
    setEditCreator(creator);
  }

  function saveEdit() {
    if (!editForm.name?.trim()) return;
    const updated = creators.map(c => c.id === editCreator.id ? { ...c, name: editForm.name.trim(), handle: editForm.handle.trim(), email: editForm.email.trim() } : c);
    setCreators(updated);
    syncCreatorsToSupabase(updated);
    setEditCreator(null);
  }

  const inp = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "9px 13px", color: "#E8EAF0", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
  const btn = (v = "primary") => ({ padding: "9px 17px", borderRadius: 8, border: v === "ghost" ? "1px solid rgba(255,255,255,0.12)" : "none", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", background: v === "primary" ? "#7C6FFF" : "rgba(255,255,255,0.06)", color: v === "primary" ? "#fff" : "#C0C0D8" });
  const card = { background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden" };
  const navBtn = (a) => ({ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: a ? "rgba(124,111,255,0.12)" : "transparent", color: a ? "#A99EFF" : "rgba(255,255,255,0.35)", marginBottom: 2, borderLeft: a ? "2px solid #7C6FFF" : "2px solid transparent", fontFamily: "inherit", textAlign: "left" });
  const th = { display: "grid", padding: "10px 20px", background: "rgba(255,255,255,0.015)", borderBottom: "1px solid rgba(255,255,255,0.055)", fontSize: 9.5, letterSpacing: 2, color: "rgba(255,255,255,0.28)", fontWeight: 700, textTransform: "uppercase" };
  const modal = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 };
  const mbox = { background: "#0E1220", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 26, width: 520, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto" };
  const isCreators = page === "creators";

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#070A11", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Sora', sans-serif", color: "#fff" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Loading your program...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#070A11", color: "#E2E4EE", fontFamily: "'Sora','Segoe UI',sans-serif", display: "flex" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {newSubmissionToast && (
        <div onClick={() => { setNewSubmissionToast(null); setPage("creators"); }}
          style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: "#0D1020", border: "1px solid rgba(107,203,119,0.4)", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", maxWidth: 340 }}>
          <span style={{ fontSize: 20 }}>📬</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6BCB77", marginBottom: 2 }}>New Video Submitted</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>A creator submitted a video. Click to review.</div>
          </div>
          <button onClick={e => { e.stopPropagation(); setNewSubmissionToast(null); }} style={{ marginLeft: 4, background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* Sidebar */}
      <div style={{ width: 220, background: "#060810", borderRight: "1px solid rgba(255,255,255,0.055)", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", flexShrink: 0 }}>
        <div style={{ padding: "18px 18px 16px", borderBottom: "1px solid rgba(255,255,255,0.055)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label title="Click to upload logo" style={{ cursor: "pointer", flexShrink: 0 }}>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                const file = e.target.files?.[0]; if (!file) return;
                const reader = new FileReader(); reader.onload = ev => setLogoUrl(ev.target.result); reader.readAsDataURL(file);
              }} />
              <div style={{ width: 36, height: 36, borderRadius: 8, background: logoUrl ? "transparent" : "rgba(124,111,255,0.1)", border: logoUrl ? "none" : "1.5px dashed rgba(124,111,255,0.4)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {logoUrl ? <img src={logoUrl} alt="logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 14, color: "rgba(124,111,255,0.7)" }}>⊕</span>}
              </div>
            </label>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 8.5, letterSpacing: 3, color: "rgba(255,255,255,0.2)", marginBottom: 2, textTransform: "uppercase" }}>UGC Manager</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{programName}</div>
            </div>
          </div>
        </div>
        <nav style={{ padding: "14px 10px", flex: 1 }}>
          {[{ key: "dashboard", icon: "⬡", label: "Dashboard" }, { key: "creators", icon: "◎", label: "Creators" }, { key: "settings", icon: "◈", label: "Program Settings" }].map(item => (
            <button key={item.key} style={navBtn(page === item.key || (item.key === "creators" && selectedId))}
              onClick={() => { setPage(item.key); if (item.key !== "creators") setSelectedId(null); }}>
              <span style={{ fontSize: 13, opacity: 0.7 }}>{item.icon}</span>{item.label}
            </button>
          ))}
          <button style={{ ...navBtn(false), marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }} onClick={onEnterPortal}>
            <span style={{ fontSize: 13, opacity: 0.7 }}>◉</span>Creator Portal
          </button>
        </nav>
        <div style={{ padding: "16px 14px", borderTop: "1px solid rgba(255,255,255,0.055)" }}>
          <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.25)", marginBottom: 8, textTransform: "uppercase" }}>Payout Lock Window</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {LOCK_OPTIONS.map(d => (
              <button key={d} onClick={() => setLockDays(d)} style={{ padding: "6px 0", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit", background: lockDays === d ? "#7C6FFF" : "rgba(255,255,255,0.05)", color: lockDays === d ? "#fff" : "rgba(255,255,255,0.35)" }}>{d} days</button>
            ))}
          </div>
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.055)", fontSize: 11 }}>
          <div style={{ color: "rgba(255,255,255,0.4)" }}>{gs.creators} creators · {gs.videos} videos</div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, overflow: "auto", padding: "34px 38px" }}>

        {/* DASHBOARD */}
        {page === "dashboard" && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 26 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: -0.8 }}>Program Overview</h1>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", marginTop: 3 }}>Payout window: <span style={{ color: "#A99EFF", fontWeight: 700 }}>{lockDays} days</span></div>
              </div>
              <PillToggle value={dashMetric} onChange={setDashMetric} options={[{ value: "live", label: "📈 All Views" }, { value: "payout", label: "💰 Payouts" }]} />
            </div>
            {dashMetric === "live" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 13, marginBottom: 26 }}>
                <Stat label="Total Live Views" value={fmtV(gs.totalLive)} sub={`${gs.videos} videos`} accent="#A99EFF" />
                <Stat label="Active Creators" value={gs.creators} sub="enrolled" accent="#4ECDC4" />
                <Stat label="Videos Posted" value={gs.videos} accent="#FFD93D" />
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 13, marginBottom: 26 }}>
                <Stat label="Total Est. Payout" value={fmtM(gs.totalPayable)} accent="#4ECDC4" />
                <Stat label="Paid Out" value={fmtM(gs.paidOut)} accent="#6BCB77" />
                <Stat label="Pending Payout" value={fmtM(gs.pending)} accent="#FFD93D" />
                <Stat label="Campaign CPM" value={fmtCpm(gs.campaignCpm)} accent="#FF9A3C" />
              </div>
            )}
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ padding: "15px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Creator Leaderboard</span>
                <button style={{ ...btn("ghost"), padding: "5px 12px", fontSize: 11 }} onClick={() => setPage("creators")}>View all →</button>
              </div>
              <div style={{ ...th, gridTemplateColumns: "26px 1fr 80px 110px 120px 110px" }}>
                <div /><div>Creator</div><div>Videos</div><div style={{ color: "#A99EFF" }}>Live Views</div><div style={{ color: "#4ECDC4" }}>Est. Payout</div><div>Outstanding</div>
              </div>
              {[...enriched].sort((a, b) => b.totalLive - a.totalLive).map((c, i) => (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "26px 1fr 80px 110px 120px 110px", padding: "13px 20px", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.035)", cursor: "pointer" }}
                  onClick={() => { setSelectedId(c.id); setPage("creators"); }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", fontWeight: 700 }}>#{i + 1}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: c.avatarColor + "28", border: `1.5px solid ${c.avatarColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: c.avatarColor }}>{ini(c.name)}</div>
                    <div><div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{c.handle}</div></div>
                  </div>
                  <div style={{ fontSize: 13 }}>{c.videos.length}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#A99EFF" }}>{fmtV(c.totalLive)}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#4ECDC4" }}>{fmtM(c.totalPayable)}</div>
                  <div>{c.pendingPayout > 0 ? <Badge color="#FFD93D">{fmtM(c.pendingPayout)} due</Badge> : <Badge color="#6BCB77">Up to date</Badge>}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CREATORS LIST */}
        {isCreators && !selectedId && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div><h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: -0.8 }}>Creators</h1><div style={{ fontSize: 13, color: "rgba(255,255,255,0.32)", marginTop: 3 }}>{creators.length} enrolled</div></div>
              <button style={btn("primary")} onClick={() => setShowAddCreator(true)}>+ Add Creator</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 13 }}>
              {enriched.map(c => (
                <div key={c.id} style={{ ...card, cursor: "pointer", padding: "18px 20px" }} onClick={() => setSelectedId(c.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: "50%", background: c.avatarColor + "22", border: `2px solid ${c.avatarColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: c.avatarColor }}>{ini(c.name)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{c.handle} · {c.email}</div>
                    </div>
                    {c.pendingPayout > 0 && <Badge color="#FFD93D">Payout due</Badge>}
                    <button onClick={e => { e.stopPropagation(); openEdit(c); }} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid rgba(169,158,255,0.3)", background: "rgba(169,158,255,0.08)", color: "#A99EFF", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✎</button>
                    <button onClick={e => { e.stopPropagation(); setConfirmDelete(c); }} style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid rgba(255,80,80,0.25)", background: "rgba(255,80,80,0.08)", color: "#FF7070", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                    {[{ l: "Live Views", v: fmtV(c.totalLive), col: "#A99EFF" }, { l: "Est. Earned", v: fmtM(c.totalPayable), col: "#4ECDC4" }, { l: "Paid", v: fmtM(c.paidOut), col: "#6BCB77" }, { l: "Pending", v: fmtM(c.pendingPayout), col: "#FFD93D" }].map(s => (
                      <div key={s.l} style={{ background: "rgba(255,255,255,0.028)", borderRadius: 8, padding: "9px 11px" }}>
                        <div style={{ fontSize: 9, letterSpacing: 1.5, color: "rgba(255,255,255,0.22)", marginBottom: 3, textTransform: "uppercase" }}>{s.l}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: s.col }}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CREATOR DETAIL */}
        {isCreators && selectedId && sel && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 24 }}>
              <button style={{ ...btn("ghost"), padding: "6px 13px", fontSize: 12 }} onClick={() => setSelectedId(null)}>← Back</button>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: sel.avatarColor + "22", border: `2px solid ${sel.avatarColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: sel.avatarColor }}>{ini(sel.name)}</div>
              <div><h1 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>{sel.name}</h1><div style={{ fontSize: 12, color: "rgba(255,255,255,0.32)" }}>{sel.handle} · Joined {sel.joinedDate}</div></div>
              <button style={{ ...btn("primary"), marginLeft: "auto" }} onClick={() => setShowAddVideo(true)}>+ Add Video</button>
              <button onClick={() => openEdit(sel)} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid rgba(169,158,255,0.3)", background: "rgba(169,158,255,0.08)", color: "#A99EFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✎ Edit</button>
              <button onClick={() => setConfirmDelete(sel)} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid rgba(255,80,80,0.3)", background: "rgba(255,80,80,0.08)", color: "#FF7070", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              <Stat label="Live Views" value={fmtV(sel.totalLive)} accent="#A99EFF" />
              <Stat label="Total Earned" value={fmtM(sel.totalPayable)} accent="#4ECDC4" />
              <Stat label="Pending Payout" value={fmtM(sel.pendingPayout)} accent="#FFD93D" />
              <Stat label="Est. CPM" value={fmtCpm(sel.cpm)} accent="#FF9A3C" />
            </div>
            <div style={card}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 14, fontWeight: 700 }}>Videos</div>
              <div style={{ ...th, gridTemplateColumns: "1fr 100px 100px 120px 80px" }}>
                <div>Title</div><div style={{ color: "#A99EFF" }}>Live Views</div><div style={{ color: "#4ECDC4" }}>Payout</div><div>Lock Status</div><div>Actions</div>
              </div>
              {sel.videos.map((v, i) => (
                <div key={v.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px 120px 80px", padding: "16px 20px", alignItems: "start", borderBottom: i < sel.videos.length - 1 ? "1px solid rgba(255,255,255,0.035)" : "none" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{v.title}</div>
                    <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.28)", marginBottom: 4 }}>Posted {v.postedDate}</div>
                    <PlatformPills platforms={v.platforms} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#A99EFF" }}>{fmtV(v.topLive)}</div>
                  <div>
                    {v.qualified ? <><div style={{ fontSize: 14, fontWeight: 900, color: "#4ECDC4" }}>{fmtM(v.payout)}</div><div style={{ fontSize: 9, color: v.ls.locked ? "#6BCB77" : "rgba(255,255,255,0.25)", marginTop: 2 }}>{v.ls.locked ? "FINAL" : "EST."}</div></> : <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>Pending</span>}
                    <div style={{ marginTop: 6 }}><Badge color={v.status === "paid" ? "#6BCB77" : "#FFD93D"}>{v.status === "paid" ? "✓ Paid" : "Pending"}</Badge></div>
                  </div>
                  <div style={{ paddingTop: 2 }}>
                    {v.ls.locked ? <Badge color="#6BCB77">🔒 Locked</Badge> : <><Badge color="#FF9A3C">{v.ls.remaining}d left</Badge><div style={{ marginTop: 6 }}><LockBar dateStr={v.postedDate} lockDays={lockDays} /></div></>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button style={{ padding: "5px 10px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit", background: "rgba(255,255,255,0.07)", color: "#C0C0D8" }}
                      onClick={() => { const init = {}; Object.keys(PLATFORMS).forEach(k => { init[k] = v.platforms?.[k]?.live || 0; }); setUpdPlatforms(init); setShowUpdate(v); }}>Update</button>
                    {v.ls.locked && v.status === "pending" && v.qualified && (
                      <button style={{ padding: "5px 10px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit", background: "rgba(107,203,119,0.15)", color: "#6BCB77" }} onClick={() => markPaid(sel.id, v.id)}>Mark Paid</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {page === "settings" && (
          <div>
            <div style={{ marginBottom: 24 }}><h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: -0.8 }}>Program Settings</h1></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 18 }}>
              <div style={card}>
                <div style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>View Tiers & Payouts</div>
                  <PillToggle value={tierMode} onChange={setTierMode} options={[{ value: "manual", label: "Manual" }, { value: "cpm", label: "CPM" }]} />
                </div>
                {tierMode === "manual" && (
                  <div style={{ padding: "10px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setTiers(p => [...p, { label: `${fmtV((p[p.length-1]?.minViews || 0) * 2)}+`, minViews: (p[p.length-1]?.minViews || 0) * 2, payout: 0 }])} style={{ padding: "5px 13px", borderRadius: 7, border: "1px solid rgba(124,111,255,0.35)", background: "rgba(124,111,255,0.1)", color: "#A99EFF", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Add Tier</button>
                  </div>
                )}
                {activeTiers.map((t, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: tierMode === "manual" ? "1fr 140px 120px 36px" : "1fr 140px 120px", padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center" }}>
                    {tierMode === "manual" ? <input value={t.label} onChange={e => setTiers(p => p.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} style={{ background: "transparent", border: "none", outline: "none", color: "#E2E4EE", fontSize: 13, fontWeight: 600, fontFamily: "inherit", borderBottom: "1px dashed rgba(255,255,255,0.12)" }} /> : <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>}
                    <div style={{ textAlign: "right" }}>
                      {tierMode === "manual" ? <input type="number" value={t.minViews} onChange={e => setTiers(p => p.map((x, j) => j === i ? { ...x, minViews: parseInt(e.target.value) || 0 } : x))} onBlur={() => setTiers(p => [...p].sort((a, b) => a.minViews - b.minViews))} style={{ background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 800, fontFamily: "inherit", width: 100, textAlign: "right", borderBottom: "1px dashed rgba(255,255,255,0.12)" }} /> : <span style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.55)" }}>{t.minViews.toLocaleString()}</span>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {tierMode === "manual" ? <input type="number" value={t.payout} onChange={e => setTiers(p => p.map((x, j) => j === i ? { ...x, payout: parseInt(e.target.value) || 0 } : x))} style={{ background: "transparent", border: "none", outline: "none", color: "#4ECDC4", fontSize: 14, fontWeight: 800, fontFamily: "inherit", width: 80, textAlign: "right", borderBottom: "1px dashed rgba(255,255,255,0.12)" }} /> : <span style={{ fontSize: 14, fontWeight: 800, color: "#4ECDC4" }}>${t.payout.toLocaleString()}</span>}
                    </div>
                    {tierMode === "manual" && <button onClick={() => setTiers(p => p.filter((_, j) => j !== i))} style={{ background: "transparent", border: "none", color: "rgba(255,80,80,0.5)", fontSize: 14, cursor: "pointer" }}>✕</button>}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                <div style={{ ...card, padding: "18px 20px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Program Name</div>
                  <input value={programName} onChange={e => setProgramName(e.target.value)} style={inp} />
                </div>
                <div style={{ ...card, padding: "18px 20px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>View Cap</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="number" value={viewCapInput} onChange={e => setViewCapInput(e.target.value)} onBlur={() => applyViewCap(viewCapInput)} style={{ ...inp, flex: 1 }} />
                    <button onClick={() => applyViewCap(viewCapInput)} style={{ ...btn("primary"), padding: "9px 14px" }}>Apply</button>
                  </div>
                </div>
                <div style={{ ...card, padding: "18px 20px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Payout Lock Window</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    {LOCK_OPTIONS.map(d => (
                      <button key={d} onClick={() => setLockDays(d)} style={{ padding: "9px", borderRadius: 8, border: `1px solid ${lockDays === d ? "#7C6FFF" : "rgba(255,255,255,0.08)"}`, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", background: lockDays === d ? "rgba(124,111,255,0.18)" : "rgba(255,255,255,0.03)", color: lockDays === d ? "#A99EFF" : "rgba(255,255,255,0.4)" }}>{d} days</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ADD CREATOR */}
      {showAddCreator && (
        <div style={modal} onClick={() => setShowAddCreator(false)}>
          <div style={mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18 }}>Add Creator</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {[["Full Name *", "name"], ["Handle (e.g. @username)", "handle"], ["Email", "email"]].map(([ph, k]) => (
                <input key={k} style={inp} placeholder={ph} value={newCreator[k]} onChange={e => setNewCreator(p => ({ ...p, [k]: e.target.value }))} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 18, justifyContent: "flex-end" }}>
              <button style={btn("ghost")} onClick={() => setShowAddCreator(false)}>Cancel</button>
              <button style={btn("primary")} onClick={addCreator}>Add Creator</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD VIDEO */}
      {showAddVideo && (
        <div style={modal} onClick={() => setShowAddVideo(false)}>
          <div style={mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18 }}>Add Video</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input style={inp} placeholder="Video title *" value={newVideo.title} onChange={e => setNewVideo(p => ({ ...p, title: e.target.value }))} />
              <input type="date" style={inp} value={newVideo.postedDate} onChange={e => setNewVideo(p => ({ ...p, postedDate: e.target.value }))} />
              {Object.entries(PLATFORMS).map(([key, meta]) => (
                <div key={key} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${meta.color}25`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: meta.color, marginBottom: 9 }}>{meta.icon} {meta.label}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                    <input style={inp} placeholder="URL" value={newVideo.platforms[key].url} onChange={e => setNewVideo(p => ({ ...p, platforms: { ...p.platforms, [key]: { ...p.platforms[key], url: e.target.value } } }))} />
                    <input type="number" style={inp} placeholder="Views" value={newVideo.platforms[key].views} onChange={e => setNewVideo(p => ({ ...p, platforms: { ...p.platforms, [key]: { ...p.platforms[key], views: e.target.value } } }))} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 18, justifyContent: "flex-end" }}>
              <button style={btn("ghost")} onClick={() => setShowAddVideo(false)}>Cancel</button>
              <button style={btn("primary")} onClick={addVideo}>Add Video</button>
            </div>
          </div>
        </div>
      )}

      {/* UPDATE VIEWS */}
      {showUpdate && (
        <div style={modal} onClick={() => setShowUpdate(null)}>
          <div style={mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18 }}>Update View Counts — {showUpdate.title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(PLATFORMS).map(([key, meta]) => {
                const p = showUpdate.platforms?.[key];
                if (!p?.url) return null;
                return (
                  <div key={key}>
                    <div style={{ fontSize: 10, color: meta.color, marginBottom: 5, letterSpacing: 1, fontWeight: 700 }}>{meta.icon} {meta.label.toUpperCase()} VIEWS</div>
                    <input type="number" style={inp} value={updPlatforms[key] ?? ""} onChange={e => setUpdPlatforms(p => ({ ...p, [key]: e.target.value }))} />
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", marginTop: 3 }}>Current: {fmtV(p.live)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 18, justifyContent: "flex-end" }}>
              <button style={btn("ghost")} onClick={() => setShowUpdate(null)}>Cancel</button>
              <button style={btn("primary")} onClick={saveUpdate}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CREATOR */}
      {editCreator && (
        <div style={modal} onClick={() => setEditCreator(null)}>
          <div style={{ ...mbox, width: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 20 }}>Edit Creator</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {[["Full Name *", "name"], ["Handle", "handle"], ["Email", "email"]].map(([ph, k]) => (
                <input key={k} style={inp} placeholder={ph} value={editForm[k] || ""} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button style={btn("ghost")} onClick={() => setEditCreator(null)}>Cancel</button>
              <button style={btn("primary")} onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE */}
      {confirmDelete && (
        <div style={modal} onClick={() => setConfirmDelete(null)}>
          <div style={{ ...mbox, width: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>Remove Creator</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 20, lineHeight: 1.6 }}>Remove <strong style={{ color: "#fff" }}>{confirmDelete.name}</strong> and all their videos?</div>
            <div style={{ background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", borderRadius: 9, padding: "10px 14px", marginBottom: 20, fontSize: 12, color: "rgba(255,130,130,0.85)" }}>⚠ This cannot be undone.</div>
            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
              <button style={btn("ghost")} onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button onClick={() => removeCreator(confirmDelete.id)} style={{ padding: "9px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit", background: "#CC3333", color: "#fff" }}>Yes, Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ROOT
// ════════════════════════════════════════════════════════════
export default function Root() {
  const [view, setView] = useState("admin"); // "admin" | "portal"
  return view === "admin"
    ? <AdminDashboard onEnterPortal={() => setView("portal")} />
    : <CreatorPortal onExitPortal={() => setView("admin")} />;
}
