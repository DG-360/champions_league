/* One-time migration: award Sadegh +12 fairness points.
   Safe to run more than once: it exits if that player's adjustment already exists. */
const ROOT = "cl2627";
const DB = (process.env.FIREBASE_DB_URL || "").trim().replace(/\/$/, "");
if (!DB.startsWith("https://")) throw new Error("FIREBASE_DB_URL is missing");

async function json(url, opts={}){
  const r = await fetch(url, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0,300)}`);
  return text ? JSON.parse(text) : null;
}

const players = await json(`${DB}/${ROOT}/players.json`) || {};
const hit = Object.entries(players).find(([,p]) => String(p?.name || "").trim().toLowerCase() === "sadegh");
if (!hit) throw new Error("Could not find a player named Sadegh");

const [pid, player] = hit;
const path = `${DB}/${ROOT}/pointAdjustments/${encodeURIComponent(pid)}.json`;
const existing = await json(path);
if (existing){
  console.log(`[seed] ${player.name} already has a one-time adjustment: +${existing.points || 0}`);
  process.exit(0);
}

const payload = {points:12, at:Date.now(), reason:"Joined after the first two match days"};
const r = await fetch(path, {method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
if (!r.ok) throw new Error(`Could not save Sadegh adjustment: ${r.status} ${(await r.text()).slice(0,300)}`);
console.log(`[seed] awarded ${player.name} +12 one-time fairness points (${pid})`);