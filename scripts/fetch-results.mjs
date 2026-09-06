/* UEFA Champions League fixture + result synchronizer for GitHub Actions.
   Reads the active season from football-data.org (competition code CL),
   publishes main-tournament fixtures/teams into Firebase, and fills finished
   scores without overwriting an admin-entered result. */

const ROOT = "cl2627";
const COMPETITION = "CL";

const INCLUDE_STAGES = new Set([
  "LEAGUE_STAGE", "LEAGUE_PHASE", "REGULAR_SEASON", "GROUP_STAGE",
  "PLAYOFFS", "LAST_16", "ROUND_OF_16", "QUARTER_FINALS",
  "SEMI_FINALS", "FINAL"
]);

const STAGE_ORDER = {
  PLAYOFFS: 9,
  LAST_16: 10,
  ROUND_OF_16: 10,
  QUARTER_FINALS: 11,
  SEMI_FINALS: 12,
  FINAL: 13
};

const BARCELONA = {
  id:81,
  name:"FC Barcelona",
  shortName:"Barcelona",
  tla:"FCB",
  crest:"https://crests.football-data.org/81.svg"
};

const BARCA_FALLBACK = [
  {md:1, home:true,  opponent:["feyenoord"],                       utc:"2026-09-09T16:45:00Z"},
  {md:2, home:false, opponent:["galatasaray"],                     utc:"2026-10-13T19:00:00Z"},
  {md:3, home:false, opponent:["paris saint germain","paris"],    utc:"2026-10-20T19:00:00Z"},
  {md:4, home:true,  opponent:["aston villa"],                     utc:"2026-11-03T20:00:00Z"},
  {md:5, home:false, opponent:["sabah"],                           utc:"2026-11-25T17:45:00Z"},
  {md:6, home:true,  opponent:["manchester city","man city"],    utc:"2026-12-08T20:00:00Z"},
  {md:7, home:false, opponent:["sporting cp","sporting"],        utc:"2027-01-20T20:00:00Z"},
  {md:8, home:true,  opponent:["como"],                            utc:"2027-01-27T20:00:00Z"}
];

function say(...args){ console.log("[ucl-sync]", ...args); }

function cleanCode(team){
  const tla = String(team?.tla || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (tla.length >= 2 && tla.length <= 5) return tla;
  if (team?.id != null) return "T" + String(team.id).replace(/[^0-9A-Za-z]/g, "");
  const seed = String(team?.name || team?.shortName || "TEAM").toUpperCase();
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return "T" + h.toString(36).toUpperCase();
}

function assignedTeam(team){
  return !!(team && team.id != null && (team.name || team.shortName));
}

function hashColor(seed, shift=0){
  let h = 0;
  for (const ch of String(seed || "team")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (h + shift) % 360;
  const s = 58, l = shift ? 72 : 46;
  const a = s * Math.min(l,100-l) / 100;
  const f = n => {
    const k = (n + hue/30) % 12;
    const c = l - a * Math.max(-1, Math.min(k-3, 9-k, 1));
    return Math.round(255*c/100).toString(16).padStart(2,"0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function teamPayload(team){
  const code = cleanCode(team);
  const full = team?.name || team?.shortName || code;
  const short = team?.shortName || full;
  const base = hashColor(team?.id || full, 0);
  const accent = hashColor(team?.id || full, 67);
  return [full, short, base, base, accent, "solid", 0, team?.crest || null];
}

function normalizedStage(match){ return String(match?.stage || "").toUpperCase(); }
function included(match){
  const st = normalizedStage(match);
  if (!INCLUDE_STAGES.has(st)) return false;
  return assignedTeam(match?.homeTeam) && assignedTeam(match?.awayTeam);
}

function roundInfo(match){
  const st = normalizedStage(match);
  const md = Number(match?.matchday);
  if ((st === "LEAGUE_STAGE" || st === "LEAGUE_PHASE" || st === "REGULAR_SEASON" || st === "GROUP_STAGE" || !st) && md >= 1 && md <= 8)
    return { mw:md, round:`League phase · Matchday ${md}` };
  if (md >= 1 && md <= 8 && !STAGE_ORDER[st]) return { mw:md, round:`League phase · Matchday ${md}` };
  const mw = STAGE_ORDER[st] || (8 + Math.max(1, md || 1));
  const label = ({PLAYOFFS:"Knockout phase play-offs",LAST_16:"Round of 16",ROUND_OF_16:"Round of 16",QUARTER_FINALS:"Quarter-finals",SEMI_FINALS:"Semi-finals",FINAL:"Final"})[st]
    || st.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
  return {mw,round:label||`Round ${mw}`};
}

function norm(s){
  return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
}
function isBarcelonaTeam(team){
  if (!team) return false;
  if (Number(team.id) === 81) return true;
  const n = norm(team.name || team.shortName);
  const tla = String(team.tla || "").toUpperCase();
  return n === "fc barcelona" || n === "barcelona" || tla === "FCB" || tla === "BAR";
}
function sameTeam(a,b){
  if (!a || !b) return false;
  if (a.id != null && b.id != null) return String(a.id) === String(b.id);
  return norm(a.name||a.shortName) === norm(b.name||b.shortName);
}

function fixtureId(match){
  const md = Number(match?.matchday);
  if (md >= 1 && md <= 8 && (isBarcelonaTeam(match?.homeTeam) || isBarcelonaTeam(match?.awayTeam))) return `ucl_fcb_md${md}`;
  return `fd_${match.id}`;
}
function fixturePayload(match){
  const {mw,round} = roundInfo(match);
  return {id:fixtureId(match),apiId:match.id,h:cleanCode(match.homeTeam),a:cleanCode(match.awayTeam),k:Math.floor(new Date(match.utcDate).getTime()/1000),mw,round,stage:normalizedStage(match),status:match.status||"SCHEDULED",updated:Date.now()};
}
function resultPayload(match){
  const ft = match?.score?.fullTime;
  if (match.status !== "FINISHED" || !ft || ft.home == null || ft.away == null) return null;
  const out = {h:Number(ft.home),a:Number(ft.away),at:Date.now(),src:"auto",apiId:match.id};
  const winner = match?.score?.winner;
  if (winner === "HOME_TEAM") out.winnerCode = cleanCode(match.homeTeam);
  if (winner === "AWAY_TEAM") out.winnerCode = cleanCode(match.awayTeam);
  if (match?.score?.penalties?.home != null) out.ph = Number(match.score.penalties.home);
  if (match?.score?.penalties?.away != null) out.pa = Number(match.score.penalties.away);
  return out;
}

function providerTeams(matches){
  const seen = new Map();
  for (const m of matches){
    for (const t of [m.homeTeam,m.awayTeam]) if (assignedTeam(t)) seen.set(String(t.id),t);
  }
  return [...seen.values()];
}
function findProviderTeam(pool, aliases){
  const keys = aliases.map(norm);
  return pool.find(t => {
    const names = [norm(t?.name),norm(t?.shortName),norm(t?.tla)];
    return keys.some(k => names.some(n => n === k || (n&&k&&n.includes(k)) || (n&&k&&k.includes(n))));
  }) || null;
}

/* The provider feed currently has all 144 league-phase slots but only 35
   distinct clubs: Barcelona's eight slots are occupied by a duplicate club.
   Repair the affected slot in-place by matchday + known opponent, which keeps
   the competition at 144 fixtures. If a slot is genuinely absent, add it. */
function repairBarcelona(matches){
  const pool = providerTeams(matches);
  let repaired = 0, added = 0;

  for (const spec of BARCA_FALLBACK){
    const opp = findProviderTeam(pool,spec.opponent);
    if (!opp) throw new Error(`Barcelona repair could not resolve opponent for MD${spec.md}: ${spec.opponent.join("/")}`);

    const already = matches.find(m => Number(m.matchday)===spec.md && (isBarcelonaTeam(m.homeTeam)||isBarcelonaTeam(m.awayTeam)) && (sameTeam(m.homeTeam,opp)||sameTeam(m.awayTeam,opp)));
    if (already) continue;

    /* Match the official opponent on its known home/away side. The other side
       is the malformed participant that must be Barcelona. */
    const slot = matches.find(m => Number(m.matchday)===spec.md && (spec.home ? sameTeam(m.awayTeam,opp) : sameTeam(m.homeTeam,opp)));
    if (slot){
      if (spec.home) slot.homeTeam = BARCELONA;
      else slot.awayTeam = BARCELONA;
      slot._barcaRepaired = true;
      repaired++;
      continue;
    }

    matches.push({id:`fallback_fcb_md${spec.md}`,utcDate:spec.utc,status:"SCHEDULED",matchday:spec.md,stage:"LEAGUE_STAGE",homeTeam:spec.home?BARCELONA:opp,awayTeam:spec.home?opp:BARCELONA,score:{fullTime:{home:null,away:null},winner:null},_fallback:true});
    added++;
  }

  if (repaired || added) say(`Barcelona repair: ${repaired} malformed slots replaced · ${added} missing slots added`);
  return matches;
}

async function getJson(url,opts={}){
  const r=await fetch(url,opts), txt=await r.text();
  if(!r.ok) throw new Error(`${r.status} ${txt.slice(0,500)}`);
  return txt?JSON.parse(txt):null;
}

async function main(){
  const rawToken=process.env.FOOTBALL_DATA_TOKEN||"";
  const tokenMatches=rawToken.match(/[A-Za-z0-9_-]{20,}/g)||[];
  const token=(tokenMatches[tokenMatches.length-1]||rawToken.replace(/\s+/g,"")).trim();
  const dbUrl=(process.env.FIREBASE_DB_URL||"").trim().replace(/\/$/,"");
  const dry=["1","true"].includes(String(process.env.DRY_RUN||"").toLowerCase());
  if(!token) throw new Error("FOOTBALL_DATA_TOKEN is empty");
  if(!dbUrl.startsWith("https://")) throw new Error("FIREBASE_DB_URL must be https://...");

  const url=`https://api.football-data.org/v4/competitions/${COMPETITION}/matches`;
  say("requesting active Champions League season");
  const data=await getJson(url,{headers:{"X-Auth-Token":token,"Accept":"application/json"}});
  let matches=(Array.isArray(data?.matches)?data.matches:[]).filter(included);
  if(!matches.length) throw new Error("football-data returned no main-tournament Champions League matches");
  matches=repairBarcelona(matches);

  const existing=await getJson(`${dbUrl}/${ROOT}/results.json`).catch(()=>({}))||{};
  const updates={};
  const teamCodes=new Set();
  let resultWrites=0;

  for(const m of matches){
    const h=cleanCode(m.homeTeam),a=cleanCode(m.awayTeam);
    teamCodes.add(h);teamCodes.add(a);
    updates[`teams/${h}`]=teamPayload(m.homeTeam);
    updates[`teams/${a}`]=teamPayload(m.awayTeam);
    const fx=fixturePayload(m);
    updates[`fixtures/${fx.id}`]=fx;
    const rr=resultPayload(m),old=existing[fx.id];
    if(rr&&(!old||old.src==="auto")){updates[`results/${fx.id}`]=rr;resultWrites++;}
  }

  try{
    const stData=await getJson(`https://api.football-data.org/v4/competitions/${COMPETITION}/standings`,{headers:{"X-Auth-Token":token,"Accept":"application/json"}});
    const groups=Array.isArray(stData?.standings)?stData.standings:[];
    const total=groups.find(x=>x?.type==="TOTAL")||groups.find(x=>Array.isArray(x?.table));
    if(total?.table?.length){
      for(const row of total.table){
        const code=cleanCode(row.team);
        updates[`officialStandings/${code}`]={position:Number(row.position)||0,played:Number(row.playedGames)||0,won:Number(row.won)||0,draw:Number(row.draw)||0,lost:Number(row.lost)||0,points:Number(row.points)||0,gf:Number(row.goalsFor)||0,ga:Number(row.goalsAgainst)||0,gd:Number(row.goalDifference)||0,form:row.form||"",updated:Date.now()};
      }
      say(`official standings: ${total.table.length} rows`);
    }
  }catch(e){ say("standings endpoint unavailable — local table fallback will be used:",e?.message||String(e)); }

  updates["meta/competition"]="UEFA Champions League";
  updates["meta/season"]="2026/27";
  updates["meta/apiSeasonStart"]=data?.filters?.season||data?.season?.startDate||null;
  updates["meta/lastFixtureSync"]=Date.now();
  updates["meta/fixtureCount"]=matches.length;
  updates["meta/teamCount"]=teamCodes.size;

  say(`${matches.length} fixtures · ${teamCodes.size} teams · ${resultWrites} finished result writes`);
  if(dry){say("DRY RUN — nothing written");return;}

  const r=await fetch(`${dbUrl}/${ROOT}.json`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(updates)});
  if(!r.ok) throw new Error(`Firebase write failed ${r.status}: ${(await r.text()).slice(0,500)}`);
  say("Firebase sync complete");
}

main().catch(err=>{say("ERROR",err?.message||String(err));process.exit(1);});
