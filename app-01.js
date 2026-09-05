/* ══════════════════════════════════════════════════════════════════════════
   ⚙  SETUP — edit these two lines, nothing else
   ══════════════════════════════════════════════════════════════════════════
   DB_URL     your Firebase Realtime Database URL. The one below is the same
              database your other predictor apps use; this app keeps all of its data
              under a separate "cl2627" branch so it never collides with Premier League.
   ADMIN_HASH a fingerprint of the admin key, NOT the key itself. Reading this
              file tells you nothing about what to type. To change the key,
              don't edit this line — sign in as admin, open the Scoreboard tab
              and use "Change admin key". The new fingerprint is stored in the
              database and takes over from the one below.
   ══════════════════════════════════════════════════════════════════════════ */
const DB_URL     = "https://world-cup-2026-predictio-7c7b2-default-rtdb.firebaseio.com";
const ADMIN_HASH = "9c4761fe6c5be15fb9f573b09d6d40e96f37f727d45df832bf2213e5759606f5";
const ROOT      = "cl2627";

/* ── CLUB CRESTS ───────────────────────────────────────────────────────────
   Official crests are trademarked, so none are bundled here.  The best way
   to add them is from inside the app: sign in, switch on admin mode, open
   the League tab and use the "Club crests" panel to upload the 20 images.

   They are stored in your database, so they appear for EVERY player on
   EVERY browser and device automatically — no folders to share, nothing to
   host, works even when the file is opened straight from a hard drive.

   The two settings below are only a fallback for crest files sitting in a
   folder beside this HTML (named ARS.png, NFO.png … by three-letter code).
   Uploaded crests always win.  Any club with neither shows its kit-colour
   badge instead.                                                           */
const CREST_DIR = "crests";
const CREST_EXT = "png";

firebase.initializeApp({databaseURL:DB_URL});
const db = firebase.database();
const ref = p => db.ref(ROOT + "/" + p);

/* ── tiny SHA-256 (works over file:// where crypto.subtle is unavailable) ── */
function sha256(ascii){
  function rr(v,a){return(v>>>a)|(v<<(32-a));}
  const K=[],H=[];let p=2,i=0;
  function isPrime(n){for(let f=2;f*f<=n;f++)if(n%f===0)return false;return true;}
  for(;i<64;p++){if(!isPrime(p))continue;
    if(i<8)H[i]=(Math.pow(p,.5)%1*4294967296)|0;
    K[i]=(Math.pow(p,1/3)%1*4294967296)|0;i++;}
  const h=H.slice(0,8);
  ascii=unescape(encodeURIComponent(ascii));
  const words=[],len=ascii.length*8;
  for(let j=0;j<ascii.length;j++)words[j>>2]|=ascii.charCodeAt(j)<<((3-j%4)*8);
  words[len>>5]|=0x80<<(24-len%32);
  words[((len+64>>9)<<4)+15]=len;
  const w=[];
  for(let b=0;b<words.length;b+=16){
    let a=h[0],bb=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for(let t=0;t<64;t++){
      if(t<16)w[t]=words[b+t]|0;
      else{const s0=rr(w[t-15],7)^rr(w[t-15],18)^(w[t-15]>>>3),
                 s1=rr(w[t-2],17)^rr(w[t-2],19)^(w[t-2]>>>10);
           w[t]=(w[t-16]+s0+w[t-7]+s1)|0;}
      const S1=rr(e,6)^rr(e,11)^rr(e,25), ch=(e&f)^(~e&g),
            t1=(hh+S1+ch+K[t]+w[t])|0,
            S0=rr(a,2)^rr(a,13)^rr(a,22), mj=(a&bb)^(a&c)^(bb&c),
            t2=(S0+mj)|0;
      hh=g;g=f;f=e;e=(d+t1)|0;d=c;c=bb;bb=a;a=(t1+t2)|0;
    }
    h[0]=(h[0]+a)|0;h[1]=(h[1]+bb)|0;h[2]=(h[2]+c)|0;h[3]=(h[3]+d)|0;
    h[4]=(h[4]+e)|0;h[5]=(h[5]+f)|0;h[6]=(h[6]+g)|0;h[7]=(h[7]+hh)|0;
  }
  return h.map(x=>("00000000"+(x>>>0).toString(16)).slice(-8)).join("");
}
const hashPw    = pw => sha256("cl2627::" + pw);
const hashAdmin = k  => sha256("pl2627-admin::" + k);

/* ── player palette ───────────────────────────────────────────────────────
   Player names are the unique identity; colors are visual preferences and may
   be shared by multiple users. Existing accounts keep their saved ci. */
const PAL=[
  "#00ff87","#04f5ff","#ff8fb8","#ffb020","#b07cff","#5ce1a0",
  "#ff7a5c","#7ab8ff","#ffe066","#ff6fd8","#66e0d0","#c4a5ff",
  "#ff9f43","#a8ff60","#55c7ff","#ff6685","#45f0c1","#ffbe8a",
  "#d7ff45","#9fa8ff","#ffd166","#3de2d0","#f783ff","#ff8f70"
];
const colr = i => PAL[((Number(i)||0) % PAL.length + PAL.length) % PAL.length];
const colorIndex = p => Number.isInteger(Number(p && p.ci)) ? Number(p.ci) : 0;
function usedColors(exceptPid){
  const out = new Set();
  Object.keys(players).forEach(pid => {
    if (pid !== exceptPid) out.add(colorIndex(players[pid]));
  });
  return out;
}
function firstFreeColor(exceptPid){
  const used = usedColors(exceptPid);
  for (let i=0;i<PAL.length;i++) if (!used.has(i)) return i;
  return 0;
}
const initials = n => (n||"?").trim().split(/\s+/).map(w=>w[0]||"").join("").toUpperCase().slice(0,2)||"?";
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ══ UEFA CHAMPIONS LEAGUE DATA ════════════════════════════════════════════
   Fixtures and participating clubs are synced from football-data.org by the
   GitHub Action in scripts/fetch-results.mjs. Nothing here needs manual fixture
   editing: later knockout rounds appear when the API publishes them.

   TEAMS keeps the same array shape used by the original Premier League UI:
   [full name, short name, display colour, badge base, badge accent, pattern, dark label]
   ════════════════════════════════════════════════════════════════════════ */
let TEAMS = {};
let MW = [];
let ALL = [];
let BY_ID = {};
let TOTAL_MW = 0;
let teamFeed = {};
let fixtureFeed = {};

const SCORING_START_MW = 1;

function rebuildCompetition(){
  TEAMS = teamFeed || {};
  const list = Object.values(fixtureFeed || {}).filter(m => m && m.id && m.h && m.a && Number(m.k));
  list.sort((a,b) => (+a.mw - +b.mw) || (+a.k - +b.k));
  TOTAL_MW = list.reduce((mx,m) => Math.max(mx, Number(m.mw)||0), 0);
  MW = Array.from({length:TOTAL_MW}, () => []);
  list.forEach(m => {
    m.mw = Number(m.mw)||1;
    m.k = Number(m.k)||0;
    if (!MW[m.mw-1]) MW[m.mw-1] = [];
    MW[m.mw-1].push(m);
  });
  ALL = list;
  BY_ID = Object.fromEntries(ALL.map(m => [m.id, m]));
  if (TOTAL_MW && curMW > TOTAL_MW) curMW = TOTAL_MW;
  if (me) paint();
}

function roundName(n){
  const week = MW[n-1] || [];
  return (week[0] && week[0].round) || (n <= 8 ? "League phase · Matchday " + n : "Round " + n);
}

function isLeaguePhase(m){
  const st = String((m && m.stage) || "").toUpperCase();
  return m && m.mw <= 8 && (st === "LEAGUE_STAGE" || st === "LEAGUE_PHASE" || st === "REGULAR_SEASON" || st === "GROUP_STAGE" || !st);
}

/* ══ live state ══════════════════════════════════════════════════════════ */
let players = {}, preds = {}, results = {}, koFix = {};
let titles = {}, finalTop = {};
let scorers = {}, crestImgs = {}, meta = {}, officialStandings = {};
let fans = {}, fanThreads = {};
let modelPredictions = {}, modelMeta = {}, modelContext = {};
let me = null, isAdmin = false, clockSkew = 0;
let view = "fx", curMW = 1, ready = false, lastWrite = 0;

const now = () => Date.now() + clockSkew;

db.ref(".info/serverTimeOffset").on("value", s => { clockSkew = s.val() || 0; });
db.ref(".info/connected").on("value", s => {
  const el = document.getElementById("hdrStatus");
  if (el) el.textContent = s.val() ? "Live · synced" : "Reconnecting…";
});

ref("players").on("value", s => {
  players = s.val() || {};
  renderWhoList();
  renderSignupColors();
  if (me) paint();
});
ref("preds").on("value",   s => { preds   = s.val() || {}; if (me) paint(); });
ref("results").on("value", s => { results = s.val() || {}; if (me) paint(); });
ref("kickoffs").on("value",s => { koFix   = s.val() || {}; if (me) paint(); });
ref("titles").on("value",  s => { titles  = s.val() || {}; if (me) paint(); });
ref("final").on("value",   s => { finalTop = s.val() || {}; if (me) paint(); });
ref("scorers").on("value", s => { scorers = s.val() || {}; if (me) paint(); });
ref("crests").on("value",  s => { crestImgs = s.val() || {}; if (me) paint(); });
ref("fans").on("value",    s => { fans      = s.val() || {}; if (me) paint(); });
ref("fanzone").on("value", s => { fanThreads = s.val() || {}; if (me) paint(); });
ref("modelPredictions").on("value", s => { modelPredictions = s.val() || {}; if (me) paint(); });
ref("modelMeta").on("value", s => { modelMeta = s.val() || {}; if (me) paint(); });
ref("modelContext").on("value", s => { modelContext = s.val() || {}; if (me) paint(); });
ref("officialStandings").on("value", s => { officialStandings = s.val() || {}; if (me) paint(); });
ref("teams").on("value", s => { teamFeed = s.val() || {}; rebuildCompetition(); });
ref("fixtures").on("value", s => { fixtureFeed = s.val() || {}; rebuildCompetition(); });

ref("meta").on("value", s => {
  meta = s.val() || {};
  if (!meta.adminPasswordReset20260904){
    const adminReset = {};
    adminReset["meta/adminHash"] = ADMIN_HASH;
    adminReset["meta/adminPasswordReset20260904"] = true;
    db.ref(ROOT).update(adminReset).catch(err => console.warn("[admin reset]", err && err.message || err));
  }
});

/* ══ helpers ═════════════════════════════════════════════════════════════ */
const koOf   = m => (koFix[m.id] || m.k) * 1000;
const isLive = m => { const t = koOf(m); return now() >= t && now() < t + 8100000 && !results[m.id]; };
/* A match is closed once it kicks off — or as soon as a result exists, which
   covers a fixture played earlier than the schedule says.                   */
const locked = m => now() >= koOf(m) || !!results[m.id];
const predOf = (mid, pid) => (preds[mid] && preds[mid][pid]) || null;
const full   = p => p && Number.isInteger(p.h) && Number.isInteger(p.a);
/* Clubs are always written out in full — "Nottingham Forest", not "Forest". */
const teamNm   = c => TEAMS[c] ? TEAMS[c][0] : c;
const teamFull = c => TEAMS[c] ? TEAMS[c][0] : c;
const teamCol  = c => TEAMS[c] ? TEAMS[c][2] : "#888";

/* ══ CLUB BADGES ══════════════════════════════════════════════════════════
   Original kit-colour badges, not official club crests — those are
   trademarked and can't be reproduced or hot-linked here.  Each badge uses
   the club's real playing colours, striped for the clubs that play in
   stripes, so they read at a glance without copying anyone's artwork.
   ════════════════════════════════════════════════════════════════════════ */
function crest(code, size){
  /* size: falsy = default 34px, true/"sm" = 24px, "lg" = 30px */
  const cls = size === "lg" ? " lg" : size ? " sm" : "";
  const T = TEAMS[code];
  if (!T) return '<span class="crest' + cls + '"><span class="lbl">?</span></span>';
  const base = T[3], accent = T[4], pattern = T[5], darkLabel = T[6];
  const bg = pattern === "stripes"
    ? "repeating-linear-gradient(90deg," + base + " 0 5px," + accent + " 5px 10px)"
    : "linear-gradient(150deg," + base + "," + shade(base, -18) + ")";
  /* Preference: a crest uploaded to the database (everyone sees it), then a
     crest file sitting beside this HTML, then the kit-colour badge.  The
     image only hides the badge once it has actually loaded, so a missing or
     broken file never leaves an empty square. */
  const stored = crestImgs[code];
  const src = stored || (CREST_DIR ? CREST_DIR + "/" + code + "." + CREST_EXT : "");
  const img = src
    ? '<img class="cimg" src="' + src + '" alt="" onload="this.parentNode.classList.add(\'img\')">'
    : "";
  return '<span class="crest' + cls + (darkLabel ? " dk" : "") + (stored ? " img" : "")
    + '" title="' + esc(T[0]) + '" aria-label="' + esc(T[0]) + '">'
    + '<span class="bg" style="background:' + bg + '"></span>'
    + '<span class="lbl">' + code + "</span>" + img + "</span>";
}
/* nudge a hex colour lighter (+) or darker (-) by a percentage */
function shade(hex, pct){
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * pct / 100)));
  return "#" + [f(n >> 16 & 255), f(n >> 8 & 255), f(n & 255)]
    .map(v => v.toString(16).padStart(2, "0")).join("");
}
const sortedPids = () => Object.keys(players).sort((a,b)=>(players[a].ci||0)-(players[b].ci||0));

function fmtTime(ms){
  return new Date(ms).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", hour12:false});
}
function fmtDay(ms){
  return new Date(ms).toLocaleDateString([], {weekday:"long", day:"numeric", month:"long"});
}
function fmtShortDay(ms){
  return new Date(ms).toLocaleDateString([], {weekday:"short", day:"numeric", month:"short"});
}
function countdown(ms){
  if (ms <= 0) return "00:00";
  const d = Math.floor(ms/86400000), h = Math.floor(ms%86400000/3600000),
        m = Math.floor(ms%3600000/60000), s = Math.floor(ms%60000/1000);
  const p = n => String(n).padStart(2,"0");
  if (d > 0) return d + "d " + p(h) + "h";
  return p(h) + ":" + p(m) + ":" + p(s);
}
function toast(msg, kind){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show " + (kind || "");
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = "toast " + (kind || ""); }, 2600);
}
