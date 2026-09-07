/* Betable recommendation layer v3.
   Recommendations use the exact H/D/A model probabilities shown in Match Scan.
   Individual: strongest HOME/AWAY team at 80% or higher.
   Combo: every HOME/AWAY team strictly above 66%, shown only when 3+ qualify. */
(() => {
  "use strict";

  const INDIVIDUAL_MIN = 0.80;
  const COMBO_MIN = 0.66;

  function teamCandidate(a){
    if(!a || !a.model || !a.model.p) return null;
    const h = Number(a.model.p.H)||0;
    const away = Number(a.model.p.A)||0;
    if(h >= away){
      return {analysis:a, side:"H", team:a.m.h, prob:h, pick:teamNm(a.m.h)+" to win"};
    }
    return {analysis:a, side:"A", team:a.m.a, prob:away, pick:teamNm(a.m.a)+" to win"};
  }

  function pct(x){ return Math.round(Math.max(0,Math.min(1,Number(x)||0))*100); }

  function teamCrest(code){
    try { return crest(code,"sm"); }
    catch(e){ return ""; }
  }

  function comboLeg(x,i){
    const a=x.analysis;
    return '<div class="bt-leg bt-leg-team"><span class="num">'+(i+1)+'</span>'
      +'<div class="bt-pick-crest">'+teamCrest(x.team)+'</div>'
      +'<div class="main">'
      +'<div class="game">'+esc(teamNm(a.m.h))+' v '+esc(teamNm(a.m.a))+'</div>'
      +'<div class="pick">'+esc(x.pick)+'</div>'
      +'</div><span class="bt-conf">'+pct(x.prob)+'%</span></div>';
  }

  function individualCard(x){
    const a=x.analysis;
    return '<div class="bt-card hot bt-individual-team">'
      +'<div class="bt-pick-crest large">'+teamCrest(x.team)+'</div>'
      +'<div class="bt-individual-copy">'
      +'<div class="game">'+esc(teamNm(a.m.h))+' v '+esc(teamNm(a.m.a))+'</div>'
      +'<div class="pick">'+esc(x.pick)+'</div>'
      +'<div class="meta"><span class="bt-pill">BEST PICK</span><span>'+pct(x.prob)+'%</span></div>'
      +'</div></div>';
  }

  function buildView(){
    const week=betableMW();
    const upcoming=(MW[week-1]||[]).filter(m=>!locked(m)&&!results[m.id]);
    const analyses=upcoming.map(betAnalysis).sort((a,b)=>(b.modelProb-a.modelProb)||(b.rating-a.rating));
    const teamPicks=analyses.map(teamCandidate).filter(Boolean).sort((a,b)=>b.prob-a.prob);

    /* Equal to 80% counts for the individual recommendation. */
    const individual = teamPicks.find(x=>x.prob>=INDIVIDUAL_MIN) || null;
    const comboCandidates = teamPicks.filter(x=>x.prob>COMBO_MIN);
    const combo = comboCandidates.length>=3 ? comboCandidates : [];

    const modelName=(modelMeta&&modelMeta.selectedModel)||null;
    const modelReady=!!modelName&&analyses.some(a=>a.model);
    const modelStatus=modelReady
      ? esc(modelName)+' · H/D/A model'
      : 'Model pending';

    const comboHtml=combo.length
      ? '<div class="bt-good bt-good-compact"><b>COMBO · '+combo.length+' TEAMS</b></div><div class="bt-combo">'+combo.map(comboLeg).join('')+'</div>'
      : '<div class="bt-risk bt-risk-compact"><b>NO COMBO</b></div>';

    const individualHtml=individual
      ? '<div class="bt-grid bt-grid-single">'+individualCard(individual)+'</div>'
      : '<div class="bt-empty bt-empty-quiet"></div>';

    const scanHtml=analyses.length
      ? '<div class="bt-list">'+analyses.map(betScanRow).join('')+'</div>'
      : '<div class="bt-empty">No open '+esc(roundName(week))+' fixtures.</div>';

    return '<div class="panel"><div class="bt-hero"><h2>BETABLE · '+esc(roundName(week))+'</h2>'
      +'<p>Model probabilities</p></div>'
      +'<div class="bt-model"><b>'+modelStatus+'</b></div>'
      +'<div class="panel-h"><h3>Combo</h3><small>3+ teams · &gt;66%</small></div>'+comboHtml
      +'<div class="panel-h"><h3>Individual pick</h3><small>best team · ≥80%</small></div>'+individualHtml
      +'<div class="panel-h"><h3>Match scan</h3><small>H · D · A</small></div>'+scanHtml
      +'</div>'+betContextPanel(week);
  }

  window.viewBetable = buildView;
})();