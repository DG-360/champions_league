"""
Small Premier League baseline model.
Uses ONLY pre-match information:
- Elo strength difference
- last-5 points form
- last-5 goal-difference form
- home-vs-away venue form

Manager tactics and injuries are NOT silently inferred.
They should enter as explicit pre-match modifiers after the baseline probability is produced.

Usage:
  python bet_pl_model.py --data-dir ./data

Put Football-Data / datasets/football-datasets EPL season CSVs in ./data
with names like season-2021-22.csv, season-2022-23.csv, ...
Expected columns: Date, HomeTeam, AwayTeam, FTHG, FTAG, FTR.
"""
from pathlib import Path
from collections import defaultdict, deque
import argparse, json
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, log_loss, classification_report, confusion_matrix

FEATURES = ["elo_diff","form5_diff","gd5_diff","venue_form_diff"]
K = 24
HOME_ELO = 55

def avg(q):
    return float(np.mean(q)) if q else 0.0

def build_features(matches):
    matches = matches.sort_values("Date").reset_index(drop=True)
    elo = defaultdict(lambda: 1500.0)
    form = defaultdict(lambda: deque(maxlen=5))
    gd = defaultdict(lambda: deque(maxlen=5))
    hf = defaultdict(lambda: deque(maxlen=5))
    af = defaultdict(lambda: deque(maxlen=5))
    played = defaultdict(int)
    out = []

    for _, r in matches.iterrows():
        h,a = r.HomeTeam,r.AwayTeam
        out.append({
            "Date":r.Date,"HomeTeam":h,"AwayTeam":a,"Result":r.FTR,
            "elo_diff":elo[h]+HOME_ELO-elo[a],
            "form5_diff":avg(form[h])-avg(form[a]),
            "gd5_diff":avg(gd[h])-avg(gd[a]),
            "venue_form_diff":avg(hf[h])-avg(af[a]),
            "warm": played[h] >= 3 and played[a] >= 3
        })

        hg,ag=int(r.FTHG),int(r.FTAG)
        hp=3 if hg>ag else 1 if hg==ag else 0
        ap=3 if ag>hg else 1 if hg==ag else 0
        form[h].append(hp/3); form[a].append(ap/3)
        gd[h].append(hg-ag); gd[a].append(ag-hg)
        hf[h].append(hp/3); af[a].append(ap/3)

        eh=1/(1+10**((elo[a]-(elo[h]+HOME_ELO))/400))
        sh=1 if hg>ag else .5 if hg==ag else 0
        elo[h]+=K*(sh-eh)
        elo[a]+=K*((1-sh)-(1-eh))
        played[h]+=1; played[a]+=1

    return pd.DataFrame(out)

def main(data_dir):
    files = sorted(Path(data_dir).glob("*.csv"))
    if not files:
        raise SystemExit("No CSV files found.")
    parts=[]
    for f in files:
        x=pd.read_csv(f)
        needed=["Date","HomeTeam","AwayTeam","FTHG","FTAG","FTR"]
        x=x[needed].dropna()
        x["Date"]=pd.to_datetime(x["Date"], dayfirst=False, errors="coerce")
        x=x.dropna(subset=["Date"])
        parts.append(x)
    matches=pd.concat(parts,ignore_index=True).sort_values("Date")
    feat=build_features(matches)
    feat=feat[feat.warm].reset_index(drop=True)

    # Use the latest ~20% chronologically as test.
    split=int(len(feat)*0.80)
    train,test=feat.iloc[:split],feat.iloc[split:]

    model=Pipeline([
        ("scale",StandardScaler()),
        ("model",LogisticRegression(max_iter=3000,C=.7))
    ])
    model.fit(train[FEATURES],train.Result)
    pred=model.predict(test[FEATURES])
    prob=model.predict_proba(test[FEATURES])

    results={
        "n_train":len(train),"n_test":len(test),
        "test_start":str(test.Date.min().date()),
        "test_end":str(test.Date.max().date()),
        "accuracy":float(accuracy_score(test.Result,pred)),
        "log_loss":float(log_loss(test.Result,prob,labels=model.classes_)),
        "always_home_accuracy":float((test.Result=="H").mean()),
        "classification_report":classification_report(test.Result,pred,zero_division=0,output_dict=True),
        "confusion_matrix_H_D_A":confusion_matrix(test.Result,pred,labels=["H","D","A"]).tolist()
    }
    print(json.dumps(results,indent=2))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--data-dir",default="./data")
    args=p.parse_args()
    main(args.data_dir)
