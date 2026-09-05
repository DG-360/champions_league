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
  return [full, short, base, base, accent, "solid", 0];
}

function normalizedStage(match){
  return String(match?.stage || "").toUpperCase();
}

function included(match){
  const st = normalizedStage(match);
  if (!INCLUDE_STAGES.has(st)) return false;
  return assignedTeam(match?.homeTeam) && assignedTeam(match?.awayTeam);
}

function roundInfo(match){
  const st = normalizedStage(match);
  const md = Number(match?.matchday);
  if ((st === "LEAGUE_STAGE" || st === "LEAGUE_PHASE" || st === "REGULAR_SEASON" || st === "GROUP_STAGE" || !st) && md >= 1 && md <= 8){
    return { mw: md, round: `League phase · Matchday ${md}` };
  }
  if (md >= 1 && md <= 8 && !STAGE_ORDER[st]) return { mw: md, round: `League phase · Matchday ${md}` };
  const mw = STAGE_ORDER[st] || (8 + Math.max(1, md || 1));
  const label = ({
    PLAYOFFS:"Knockout phase play-offs",
    LAST_16:"Round of 16",
    ROUND_OF_16:"Round of 16",
    QUARTER_FINALS:"Quarter-finals",
    SEMI_FINALS:"Semi-finals",
    FINAL:"Final"
  })[st] || st.replaceAll("_"," ").replace(/\b\w/g, c => c.toUpperCase());
  return { mw, round: label || `Round ${mw}` };
}

function fixtureId(match){ return `fd_${match.id}`; }

function fixturePayload(match){
  const {mw, round} = roundInfo(match);
  return {
    id: fixtureId(match), apiId: match.id,
    h: cleanCode(match.homeTeam), a: cleanCode(match.awayTeam),
    k: Math.floor(new Date(match.utcDate).getTime()/1000),
    mw, round, stage: normalizedStage(match),
    status: match.status || "SCHEDULED", updated: Date.now()
  };
}

function resultPayload(match){
  const ft = match?.score?.fullTime;
  if (match.status !== "FINISHED" || !ft || ft.home == null || ft.away == null) return null;
  const out = { h:Number(ft.home), a:Number(ft.away), at:Date.now(), src:"auto", apiId:match.id };
  const winner = match?.score?.winner;
  if (winner === "HOME_TEAM") out.winnerCode = cleanCode(match.homeTeam);
  if (winner === "AWAY_TEAM") out.winnerCode = cleanCode(match.awayTeam);
  if (match?.score?.penalties?.home != null) out.ph = Number(match.score.penalties.home);
  if (match?.score?.penalties?.away != null) out.pa = Number(match.score.penalties.away);
  return out;
}

async function getJson(url, opts={}){
  const r = await fetch(url, opts);
  const txt = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${txt.slice(0,500)}`);
  return txt ? JSON.parse(txt) : null;
}

async function main(){
  const token = (process.env.FOOTBALL_DATA_TOKEN || "").trim();
  const dbUrl = (process.env.FIREBASE_DB_URL || "").trim().replace(/\/$/,"");
  const dry = ["1","true"].includes(String(process.env.DRY_RUN || "").toLowerCase());
  if (!token) throw new Error("FOOTBALL_DATA_TOKEN is empty");
  if (!dbUrl.startsWith("https://")) throw new Error("FIREBASE_DB_URL must be https://...");

  const url = `https://api.football-data.org/v4/competitions/${COMPETITION}/matches`;
  say("requesting active Champions League season");
  const data = await getJson(url, {headers:{"X-Auth-Token":token,"Accept":"application/json"}});
  const matches = (Array.isArray(data?.matches) ? data.matches : []).filter(included);
  if (!matches.length) throw new Error("football-data returned no main-tournament Champions League matches");

  const existing = await getJson(`${dbUrl}/${ROOT}/results.json`).catch(()=>({})) || {};
  const updates = {};
  const teamCodes = new Set();
  let resultWrites = 0;

  for (const m of matches){
    const h = cleanCode(m.homeTeam), a = cleanCode(m.awayTeam);
    teamCodes.add(h); teamCodes.add(a);
    updates[`teams/${h}`] = teamPayload(m.homeTeam);
    updates[`teams/${a}`] = teamPayload(m.awayTeam);
    const fx = fixturePayload(m);
    updates[`fixtures/${fx.id}`] = fx;
    const rr = resultPayload(m);
    const old = existing[fx.id];
    if (rr && (!old || old.src === "auto")){
      updates[`results/${fx.id}`] = rr;
      resultWrites++;
    }
  }

  try {
    const stData = await getJson(`https://api.football-data.org/v4/competitions/${COMPETITION}/standings`, {
      headers:{"X-Auth-Token":token,"Accept":"application/json"}
    });
    const groups = Array.isArray(stData?.standings) ? stData.standings : [];
    const total = groups.find(x => x?.type === "TOTAL") || groups.find(x => Array.isArray(x?.table));
    if (total?.table?.length){
      for (const row of total.table){
        const code = cleanCode(row.team);
        updates[`officialStandings/${code}`] = {
          position:Number(row.position)||0, played:Number(row.playedGames)||0,
          won:Number(row.won)||0, draw:Number(row.draw)||0, lost:Number(row.lost)||0,
          points:Number(row.points)||0, gf:Number(row.goalsFor)||0,
          ga:Number(row.goalsAgainst)||0, gd:Number(row.goalDifference)||0,
          form:row.form || "", updated:Date.now()
        };
      }
      say(`official standings: ${total.table.length} rows`);
    }
  } catch (e) {
    say("standings endpoint unavailable — local table fallback will be used:", e?.message || String(e));
  }

  updates["meta/competition"] = "UEFA Champions League";
  updates["meta/season"] = "2026/27";
  updates["meta/apiSeasonStart"] = data?.filters?.season || data?.season?.startDate || null;
  updates["meta/lastFixtureSync"] = Date.now();
  updates["meta/fixtureCount"] = matches.length;
  updates["meta/teamCount"] = teamCodes.size;

  say(`${matches.length} fixtures · ${teamCodes.size} teams · ${resultWrites} finished result writes`);
  if (dry){ say("DRY RUN — nothing written"); return; }

  const r = await fetch(`${dbUrl}/${ROOT}.json`, {
    method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(updates)
  });
  if (!r.ok) throw new Error(`Firebase write failed ${r.status}: ${(await r.text()).slice(0,500)}`);
  say("Firebase sync complete");
}

main().catch(err => { say("ERROR", err?.message || String(err)); process.exit(1); });
