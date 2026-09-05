#!/usr/bin/env python3
"""Champions League Betable model.

Builds a simple leakage-safe historical UCL model from recent completed
Champions League seasons, advances team state with current-season results, and
publishes Home/Draw/Away probabilities for the current open predictor round.
"""
from __future__ import annotations
import argparse, csv, io, json, math, os, re, urllib.request
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = "cl2627"
HIST_YEARS = list(range(2018, 2026))  # 2018/19 through 2025/26
SOURCE = "https://fixturedownload.com/download/champions-league-{year}-UTC.csv"
FEATURES = 4

LIVE_CONTEXT_DEFAULTS = {
    "injury_logit_per_level": 0.075,
    "tactical_logit_per_level": 0.055,
    "uncertainty_temperature": 0.10,
    "max_abs_logit_shift": 0.22,
}

ALIASES = {
    "manchester city":"man city", "manchester united":"man united",
    "paris saint germain":"paris", "paris saint-germain":"paris",
    "psg":"paris", "internazionale":"inter", "inter milan":"inter",
    "bayern munich":"bayern munchen", "bayern münchen":"bayern munchen",
    "borussia dortmund":"b dortmund", "dortmund":"b dortmund",
    "atletico madrid":"atleti", "atlético madrid":"atleti",
    "red bull leipzig":"leipzig", "rb leipzig":"leipzig",
    "bayer leverkusen":"leverkusen", "sporting lisbon":"sporting cp",
    "shakhtar donetsk":"shakhtar", "club brugge kv":"club brugge",
    "fc barcelona":"barcelona", "real madrid cf":"real madrid",
}

def canon(s: str) -> str:
    s = str(s or "").lower().strip().replace("&", " and ")
    s = s.replace("ü","u").replace("é","e").replace("á","a").replace("í","i").replace("ó","o").replace("ç","c")
    s = re.sub(r"\b(fc|cf|afc|calcio|football club)\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return ALIASES.get(s, s)

def fetch_text(url: str, timeout=30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent":"ucl-betable-model/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig", errors="replace")

def http_json(url: str, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None

def parse_score(raw: str):
    nums = re.findall(r"\d+", str(raw or ""))
    return (int(nums[0]), int(nums[1])) if len(nums) >= 2 else None

def parse_date(raw: str):
    s = str(raw or "").strip()
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try: return datetime.strptime(s, fmt)
        except ValueError: pass
    return None

def load_history(cache: Path):
    cache.mkdir(parents=True, exist_ok=True)
    rows = []
    for year in HIST_YEARS:
        fp = cache / f"ucl-{year}.csv"
        try:
            if not fp.exists() or fp.stat().st_size < 200:
                fp.write_text(fetch_text(SOURCE.format(year=year)), encoding="utf-8")
            text = fp.read_text(encoding="utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            for r in reader:
                home = r.get("Home Team") or r.get("HomeTeam") or r.get("Home")
                away = r.get("Away Team") or r.get("AwayTeam") or r.get("Away")
                score = parse_score(r.get("Result") or r.get("Score"))
                dt = parse_date(r.get("Date") or r.get("Date/Time"))
                if home and away and score and dt:
                    rows.append((dt, canon(home), canon(away), score[0], score[1], year))
        except Exception as e:
            print(f"[ucl-model] history {year} skipped: {e}")
    rows.sort(key=lambda x: x[0])
    if len(rows) < 300:
        raise RuntimeError(f"Only {len(rows)} usable historical UCL matches were loaded")
    return rows

class State:
    def __init__(self):
        self.elo = defaultdict(lambda: 1500.0)
        self.form = defaultdict(lambda: deque(maxlen=5))
        self.gd = defaultdict(lambda: deque(maxlen=5))
    def feat(self,h,a):
        fh = np.mean(self.form[h]) if self.form[h] else .5
        fa = np.mean(self.form[a]) if self.form[a] else .5
        gh = np.mean(self.gd[h]) if self.gd[h] else 0.0
        ga = np.mean(self.gd[a]) if self.gd[a] else 0.0
        return [self.elo[h]-self.elo[a], fh-fa, gh-ga, 1.0]
    def update(self,h,a,hg,ag):
        exp = 1/(1+10**(-((self.elo[h]+55)-self.elo[a])/400))
        act = 1.0 if hg>ag else 0.0 if hg<ag else .5
        delta = 24*(act-exp)
        self.elo[h] += delta; self.elo[a] -= delta
        rh = 1 if hg>ag else .5 if hg==ag else 0
        ra = 1-rh if hg!=ag else .5
        self.form[h].append(rh); self.form[a].append(ra)
        self.gd[h].append(hg-ag); self.gd[a].append(ag-hg)

def build_dataset(rows):
    st=State(); X=[]; y=[]
    for _,h,a,hg,ag,_ in rows:
        X.append(st.feat(h,a)); y.append("H" if hg>ag else "A" if hg<ag else "D")
        st.update(h,a,hg,ag)
    return np.asarray(X,float), np.asarray(y), st

def current_round(fixtures, results):
    rounds=sorted({int(f.get("mw",1)) for f in fixtures})
    for mw in rounds:
        week=[f for f in fixtures if int(f.get("mw",1))==mw]
        if week and any(f["id"] not in results for f in week): return mw
    return rounds[-1] if rounds else 1

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--repo-root", default="."); ap.add_argument("--publish", action="store_true")
    args=ap.parse_args()
    db=os.environ.get("FIREBASE_DB_URL","").rstrip("/")
    if not db: raise SystemExit("FIREBASE_DB_URL required")

    root=Path(args.repo_root)
    rows=load_history(root/"model_cache")
    X,y,state=build_dataset(rows)
    model=Pipeline([("scale",StandardScaler()),("lr",LogisticRegression(max_iter=1500,C=.7,multi_class="auto"))])
    model.fit(X,y)

    feed=http_json(f"{db}/{ROOT}.json") or {}
    fixtures=list((feed.get("fixtures") or {}).values())
    teams=feed.get("teams") or {}; results=feed.get("results") or {}
    if not fixtures:
        print("No synced UCL fixtures in Firebase yet; skipping model publish until the fixture sync has run.")
        return
    fixtures.sort(key=lambda f: (int(f.get("k",0)), int(f.get("mw",1))))

    def name(code):
        t=teams.get(code) or []
        return canon(t[0] if isinstance(t,list) and t else code)

    # Advance historical team state with current-season completed matches.
    for f in fixtures:
        r=results.get(f["id"])
        if not r: continue
        state.update(name(f["h"]), name(f["a"]), int(r.get("h",0)), int(r.get("a",0)))

    mw=current_round(fixtures,results)
    upcoming=[f for f in fixtures if int(f.get("mw",1))==mw and f["id"] not in results]
    out={}
    classes=list(model.named_steps["lr"].classes_)
    for f in upcoming:
        h,a=name(f["h"]),name(f["a"])
        probs=model.predict_proba([state.feat(h,a)])[0]
        d={classes[i]:float(probs[i]) for i in range(len(classes))}
        out[f["id"]]={"pH":d.get("H",0),"pD":d.get("D",0),"pA":d.get("A",0),"model":"UCL-EloForm","at":int(datetime.utcnow().timestamp()*1000)}

    meta={
      "selectedModel":"UCL-EloForm",
      "historyMatches":len(rows),
      "historySeasons":f"{HIST_YEARS[0]}/{str(HIST_YEARS[0]+1)[-2:]}–{HIST_YEARS[-1]}/{str(HIST_YEARS[-1]+1)[-2:]}",
      "currentRound":mw,
      "bettable":{"min_prob":.58,"min_margin":.08},
      "m3":{"liveAdjustment":LIVE_CONTEXT_DEFAULTS},
      "updated":int(datetime.utcnow().timestamp()*1000)
    }
    if args.publish:
        http_json(f"{db}/{ROOT}.json", method="PATCH", payload={"modelPredictions":out,"modelMeta":meta})
        print(f"[ucl-model] published {len(out)} predictions for round {mw}")
    else:
        print(json.dumps({"meta":meta,"predictions":out},indent=2))

if __name__=="__main__": main()
