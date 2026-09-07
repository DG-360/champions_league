/* UEFA Champions League fixture + result synchronizer for GitHub Actions.
   football-data.org supplies live match metadata/results, but the complete
   2026/27 league-phase fixture matrix is validated against UEFA.com's official
   fixture list (last checked 2026-09-07) before anything is published. */

import { createHash } from "node:crypto";

const ROOT = "cl2627";
const COMPETITION = "CL";
const UEFA_LEAGUE_PHASE_SIGNATURE = "ba290018a5974093247eda0c1c6e345bd13e6fac943c5db77c0a346c57188fc3";

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

/* UEFA-confirmed Barcelona slots. These are only used to repair a genuinely
   incomplete provider feed; if the provider already has Barcelona's eight
   league-phase matches, no repair is attempted. */
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

const UEFA_TEAM_ALIASES = {
  "AEK Athens":["aek athens","pae aek","aek"],
  "LASK":["lask","lask linz"],
  "Club Brugge":["club brugge","club brugge kv"],
  "Aston Villa":["aston villa","aston villa fc"],
  "Borussia Dortmund":["borussia dortmund","b dortmund","bvb"],
  "Villarreal":["villarreal","villarreal cf"],
  "Porto":["porto","fc porto"],
  "Manchester City":["manchester city","manchester city fc","man city","mci"],
  "Lille":["lille","lille osc"],
  "Real Betis":["real betis","real betis seville"],
  "Real Madrid":["real madrid","real madrid cf"],
  "Inter":["inter","inter milano","fc internazionale milano","internazionale","int"],
  "Barcelona":["barcelona","fc barcelona","bar"],
  "Feyenoord":["feyenoord","feyenoord rotterdam"],
  "Stuttgart":["stuttgart","vfb stuttgart"],
  "Viking":["viking","viking fk"],
  "Liverpool":["liverpool","liverpool fc"],
  "Atlético de Madrid":["atletico de madrid","atletico madrid","club atletico de madrid","atm"],
  "Paris Saint-Germain":["paris saint germain","paris sg","paris","psg"],
  "Slovan Bratislava":["slovan bratislava","sk slovan bratislava","slo"],
  "Sporting CP":["sporting cp","sporting lisbon","sporting clube de portugal","spo"],
  "Galatasaray":["galatasaray","galatasaray istanbul","gal"],
  "Napoli":["napoli","ssc napoli","nap"],
  "Arsenal":["arsenal","arsenal fc","ars"],
  "Fenerbahçe":["fenerbahce","fenerbahce istanbul","fen"],
  "Roma":["roma","as roma","rom"],
  "PSV Eindhoven":["psv eindhoven","psv"],
  "Shakhtar Donetsk":["shakhtar donetsk","fc shakhtar donetsk","shakhtar","sha"],
  "Como":["como","como 1907","com"],
  "Leipzig":["leipzig","rb leipzig","rbl"],
  "Bayern München":["bayern munchen","bayern munich","fc bayern munchen","bmu"],
  "Bodø/Glimt":["bodo glimt","bodoe glimt","fk bodo glimt","bog"],
  "Manchester United":["manchester united","manchester united fc","man utd","mun"],
  "Sabah":["sabah","sabah masazir","sabah fk","sbh"],
  "Slavia Praha":["slavia praha","slavia prague","sk slavia praha","sla"],
  "Lens":["lens","rc lens","racing club de lens","rcl"]
};

const DISPLAY_NAME = {
  "AEK Athens":"AEK Athens",
  "LASK":"LASK",
  "Club Brugge":"Club Brugge",
  "Aston Villa":"Aston Villa",
  "Borussia Dortmund":"Dortmund",
  "Villarreal":"Villarreal",
  "Porto":"Porto",
  "Manchester City":"Man City",
  "Lille":"Lille",
  "Real Betis":"Real Betis",
  "Real Madrid":"Real Madrid",
  "Inter":"Inter",
  "Barcelona":"Barcelona",
  "Feyenoord":"Feyenoord",
  "Stuttgart":"Stuttgart",
  "Viking":"Viking",
  "Liverpool":"Liverpool",
  "Atlético de Madrid":"Atleti",
  "Paris Saint-Germain":"Paris",
  "Slovan Bratislava":"Slovan",
  "Sporting CP":"Sporting CP",
  "Galatasaray":"Galatasaray",
  "Napoli":"Napoli",
  "Arsenal":"Arsenal",
  "Fenerbahçe":"Fenerbahçe",
  "Roma":"Roma",
  "PSV Eindhoven":"PSV",
  "Shakhtar Donetsk":"Shakhtar",
  "Como":"Como",
  "Leipzig":"Leipzig",
  "Bayern München":"Bayern München",
  "Bodø/Glimt":"Bodø/Glimt",
  "Manchester United":"Man Utd",
  "Sabah":"Sabah",
  "Slavia Praha":"Slavia Praha",
  "Lens":"Lens"
};

function say(...args){ console.log("[ucl-sync]", ...args); }

function norm(s){
  return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
}
const ALIAS_LOOKUP = (() => {
  const m = new Map();
  for (const [canonical, aliases] of Object.entries(UEFA_TEAM_ALIASES))
    for (const a of [canonical,...aliases]) m.set(norm(a),canonical);
  return m;
})();

function canonicalName(team){
  if (!team) return "";
  if (Number(team.id) === 81) return "Barcelona";
  const values = [team.name,team.shortName,team.tla].map(norm).filter(Boolean);
  for (const v of values){
    if (ALIAS_LOOKUP.has(v)) return ALIAS_LOOKUP.get(v);
  }
  for (const [alias,canonical] of ALIAS_LOOKUP){
    if (alias.length >= 5 && values.some(v => v.includes(alias) || alias.includes(v))) return canonical;
  }
  return team.name || team.shortName || team.tla || "";
}

function isBarcelonaIdentity(team){ return canonicalName(team) === "Barcelona"; }

function cleanCode(team){
  if (isBarcelonaIdentity(team)) return "BAR";
  const tla = String(team?.tla || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (tla.length >= 2 && tla.length <= 5) return tla;
  if (team?.id != null) return "T" + String(team.id).replace(/[^0-9A-Za-z]/g, "");
  const seed = String(team?.name || team?.shortName || "TEAM").toUpperCase();
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return "T" + h.toString(36).toUpperCase();
}

function assignedTeam(team){ return !!(team && team.id != null && (team.name || team.shortName)); }

function hashColor(seed, shift=0){
  let h = 0;
  for (const ch of String(seed || "team")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (h + shift) % 360, s = 58, l = shift ? 72 : 46;
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
  const canonical = canonicalName(team);
  const label = DISPLAY_NAME[canonical] || team?.shortName || team?.name || code;
  const base = hashColor(team?.id || canonical || label, 0);
  const accent = hashColor(team?.id || canonical || label, 67);
  return [label,label,base,base,accent,"solid",0,team?.crest || null];
}

function normalizedStage(match){ return String(match?.stage || "").toUpperCase(); }
function included(match){
  const st = normalizedStage(match);
  return INCLUDE_STAGES.has(st) && assignedTeam(match?.homeTeam) && assignedTeam(match?.awayTeam);
}
function isLeagueStage(match){
  const st = normalizedStage(match), md = Number(match?.matchday);
  return md >= 1 && md <= 8 && ["LEAGUE_STAGE","LEAGUE_PHASE","REGULAR_SEASON","GROUP_STAGE"].includes(st);
}

function roundInfo(match){
  const st = normalizedStage(match), md = Number(match?.matchday);
  if (isLeagueStage(match)) return {mw:md,round:`League phase · Matchday ${md}`};
  if (md >= 1 && md <= 8 && !STAGE_ORDER[st]) return {mw:md,round:`League phase · Matchday ${md}`};
  const mw = STAGE_ORDER[st] || (8 + Math.max(1, md || 1));
  const label = ({PLAYOFFS:"Knockout phase play-offs",LAST_16:"Round of 16",ROUND_OF_16:"Round of 16",QUARTER_FINALS:"Quarter-finals",SEMI_FINALS:"Semi-finals",FINAL:"Final"})[st]
    || st.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
  return {mw,round:label||`Round ${mw}`};
}

function isBarcelonaTeam(team){ return canonicalName(team) === "Barcelona"; }
function sameTeam(a,b){
  if (!a || !b) return false;
  const ca = canonicalName(a), cb = canonicalName(b);
  if (ca && cb && ca === cb) return true;
  if (a.id != null && b.id != null) return String(a.id) === String(b.id);
  return false;
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
  for (const m of matches) for (const t of [m.homeTeam,m.awayTeam]) if (assignedTeam(t)) seen.set(String(t.id),t);
  return [...seen.values()];
}
function findProviderTeam(pool,aliases){
  const keys = aliases.map(norm);
  return pool.find(t => {
    const names = [norm(t?.name),norm(t?.shortName),norm(t?.tla)];
    return keys.some(k => names.some(n => n === k || (n&&k&&n.includes(k)) || (n&&k&&k.includes(n))));
  }) || null;
}

function repairBarcelona(matches){
  const sourceBarca = matches.filter(m => isLeagueStage(m) && (isBarcelonaTeam(m.homeTeam) || isBarcelonaTeam(m.awayTeam)));
  if (sourceBarca.length >= 8){
    say(`Barcelona provider feed already complete: ${sourceBarca.length} league-phase fixtures; fallback skipped`);
    return matches;
  }

  const pool = providerTeams(matches);
  let repaired = 0, added = 0;
  for (const spec of BARCA_FALLBACK){
    const opp = findProviderTeam(pool,spec.opponent);
    if (!opp) throw new Error(`Barcelona repair could not resolve opponent for MD${spec.md}: ${spec.opponent.join("/")}`);
    const already = matches.find(m => Number(m.matchday)===spec.md && isLeagueStage(m) && (isBarcelonaTeam(m.homeTeam)||isBarcelonaTeam(m.awayTeam)) && (sameTeam(m.homeTeam,opp)||sameTeam(m.awayTeam,opp)));
    if (already){ already.utcDate = spec.utc; continue; }
    const slot = matches.find(m => Number(m.matchday)===spec.md && isLeagueStage(m) && (spec.home ? sameTeam(m.awayTeam,opp) : sameTeam(m.homeTeam,opp)));
    if (slot){
      if (spec.home) slot.homeTeam = BARCELONA; else slot.awayTeam = BARCELONA;
      slot.utcDate = spec.utc;
      slot.stage = "LEAGUE_STAGE";
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

function parisStamp(utcDate){
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(utcDate));
  const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}|${p.hour}:${p.minute}`;
}

function validateAgainstUefa(matches){
  const league = matches.filter(isLeagueStage);
  if (league.length !== 144) throw new Error(`UEFA validation failed: expected 144 league-phase fixtures, got ${league.length}`);
  const byMd = new Map(), counts = new Map();
  const lines = league.map(m => {
    const md = Number(m.matchday), home = canonicalName(m.homeTeam), away = canonicalName(m.awayTeam);
    if (!DISPLAY_NAME[home] || !DISPLAY_NAME[away]) throw new Error(`UEFA validation failed: unrecognized club in MD${md}: ${home} v ${away}`);
    byMd.set(md,(byMd.get(md)||0)+1);
    counts.set(home,(counts.get(home)||0)+1); counts.set(away,(counts.get(away)||0)+1);
    const [date,time] = parisStamp(m.utcDate).split("|");
    return `${md}|${date}|${time}|${home}|${away}`;
  }).sort();
  for (let md=1;md<=8;md++) if (byMd.get(md)!==18) throw new Error(`UEFA validation failed: MD${md} has ${byMd.get(md)||0} fixtures, expected 18`);
  if (counts.size !== 36) throw new Error(`UEFA validation failed: expected 36 clubs, got ${counts.size}`);
  for (const [club,n] of counts) if (n!==8) throw new Error(`UEFA validation failed: ${club} has ${n} league-phase fixtures, expected 8`);
  const sig = createHash("sha256").update(lines.join("\n")).digest("hex");
  if (sig !== UEFA_LEAGUE_PHASE_SIGNATURE) throw new Error(`UEFA validation failed: fixture/date/time matrix differs from the official UEFA list (${sig})`);
  say("UEFA validation passed: 144 fixtures · 36 clubs · 8 games each · dates/times/pairings match official list");
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
  validateAgainstUefa(matches);

  const [existingResults,existingFixtures,existingTeams,existingPreds,existingKickoffs] = await Promise.all([
    getJson(`${dbUrl}/${ROOT}/results.json`).catch(()=>({})),
    getJson(`${dbUrl}/${ROOT}/fixtures.json`).catch(()=>({})),
    getJson(`${dbUrl}/${ROOT}/teams.json`).catch(()=>({})),
    getJson(`${dbUrl}/${ROOT}/preds.json`).catch(()=>({})),
    getJson(`${dbUrl}/${ROOT}/kickoffs.json`).catch(()=>({}))
  ]);
  const results0=existingResults||{}, fixtures0=existingFixtures||{}, teams0=existingTeams||{}, preds0=existingPreds||{}, kick0=existingKickoffs||{};
  const updates={}, teamCodes=new Set(), currentFixtureIds=new Set(), byApiId=new Map();
  let resultWrites=0;

  for(const m of matches){
    const h=cleanCode(m.homeTeam),a=cleanCode(m.awayTeam);
    teamCodes.add(h);teamCodes.add(a);
    updates[`teams/${h}`]=teamPayload(m.homeTeam);
    updates[`teams/${a}`]=teamPayload(m.awayTeam);
    const fx=fixturePayload(m);
    currentFixtureIds.add(fx.id);
    if (fx.apiId != null) byApiId.set(String(fx.apiId),fx);
    updates[`fixtures/${fx.id}`]=fx;
    const rr=resultPayload(m),old=results0[fx.id];
    if(rr&&(!old||old.src==="auto")){updates[`results/${fx.id}`]=rr;resultWrites++;}
  }

  for (const [oldId,oldFx] of Object.entries(fixtures0)){
    if (!oldFx || Number(oldFx.mw)>8 || currentFixtureIds.has(oldId)) continue;
    const replacement = oldFx.apiId != null ? byApiId.get(String(oldFx.apiId)) : null;
    if (replacement && replacement.id !== oldId){
      if (preds0[oldId]) updates[`preds/${replacement.id}`] = Object.assign({},preds0[replacement.id]||{},preds0[oldId]);
      if (results0[oldId] && !results0[replacement.id]) updates[`results/${replacement.id}`] = results0[oldId];
      if (kick0[oldId] && !kick0[replacement.id]) updates[`kickoffs/${replacement.id}`] = kick0[oldId];
    }
    updates[`fixtures/${oldId}`]=null;
    updates[`preds/${oldId}`]=null;
    updates[`results/${oldId}`]=null;
    updates[`kickoffs/${oldId}`]=null;
  }
  for (const code of Object.keys(teams0)) if (!teamCodes.has(code)) updates[`teams/${code}`]=null;

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
  updates["meta/fixtureValidation"]="UEFA.com official 2026/27 league-phase list · verified 2026-09-07";

  say(`${matches.length} fixtures · ${teamCodes.size} teams · ${resultWrites} finished result writes`);
  if(dry){say("DRY RUN — nothing written");return;}

  const r=await fetch(`${dbUrl}/${ROOT}.json`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(updates)});
  if(!r.ok) throw new Error(`Firebase write failed ${r.status}: ${(await r.text()).slice(0,500)}`);
  say("Firebase sync complete");
}

main().catch(err=>{say("ERROR",err?.message||String(err));process.exit(1);});