/* Shared Champions League hero v15 · hero first on every viewport */
(() => {
  "use strict";

  const PAGE_TITLES = {
    home: "Prediction League",
    fx: "Fixtures",
    competition: "Competition",
    lb: "Scoreboard",
    bt: "Betable",
    fz: "Fanzone",
    ru: "Rules"
  };

  const CORE_CREST = window.crest;
  if(typeof CORE_CREST === 'function'){
    window.crest = function(code, size){
      try{
        const T = window.TEAMS && TEAMS[code];
        if(!T) return CORE_CREST(code, size);
        const uploaded = window.crestImgs && crestImgs[code];
        const provider = T[7];
        const src = uploaded || provider;
        if(!src) return CORE_CREST(code, size);

        const cls = size === 'lg' ? ' lg' : size ? ' sm' : '';
        const dark = T[6] ? ' dk' : '';
        const base = T[3] || '#233761';
        const accent = T[4] || '#6ABDF4';
        const pattern = T[5];
        const bg = pattern === 'stripes'
          ? 'repeating-linear-gradient(90deg,' + base + ' 0 5px,' + accent + ' 5px 10px)'
          : 'linear-gradient(150deg,' + base + ',' + (typeof shade === 'function' ? shade(base,-18) : base) + ')';
        const safeSrc = String(src).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
        const title = typeof esc === 'function' ? esc(T[0]) : String(T[0] || code);
        return '<span class="crest' + cls + dark + '" title="' + title + '" aria-label="' + title + '">'
          + '<span class="bg" style="background:' + bg + '"></span>'
          + '<span class="lbl">' + code + '</span>'
          + '<img class="cimg" src="' + safeSrc + '" alt="" '
          + 'onload="this.parentNode.classList.add(\'img\')" '
          + 'onerror="this.remove()"></span>';
      }catch(e){
        return CORE_CREST(code, size);
      }
    };
  }

  function ensureCss(){
    let link = document.querySelector('link[data-ucl-page-hero-v15]');
    if(link){
      if(!/v=3(?:$|&)/.test(link.href)) link.href = 'assets/ucl-page-hero-v15.css?v=3';
      return;
    }
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/ucl-page-hero-v15.css?v=3';
    link.dataset.uclPageHeroV15 = '1';
    document.head.appendChild(link);
  }

  function phaseName(){
    if(typeof liveMW === 'function'){
      const mw = Number(liveMW() || 1);
      if(mw <= 8) return 'League Phase';
      if(mw === 9) return 'Knockout Play-offs';
      if(mw === 10) return 'Round of 16';
      if(mw === 11) return 'Quarter-finals';
      if(mw === 12) return 'Semi-finals';
      return 'Final';
    }
    return 'League Phase';
  }

  function currentPage(){
    if(typeof view === 'string' && PAGE_TITLES[view]) return view;
    const active = document.querySelector('.nav button.on');
    return active && PAGE_TITLES[active.dataset.v] ? active.dataset.v : 'home';
  }

  function heroHtml(page, phase){
    const title = PAGE_TITLES[page] || 'Prediction League';
    return '<section class="ucl-page-hero ucl-page-hero--' + page + '" data-ucl-page="'+page+'" data-ucl-phase="'+phase+'" aria-label="UEFA Champions League ' + title + '">'
      + '<div class="ucl-page-hero__copy">'
      + '<div class="ucl-page-hero__kicker">UEFA Champions League</div>'
      + '<h1><span>UEFA Champions League</span><strong>' + title + '</strong></h1>'
      + '<div class="ucl-page-hero__meta"><span class="ucl-page-hero__dot"></span><span>' + phase + '</span><em class="ucl-page-hero__season">2026/27</em></div>'
      + '</div>'
      + '<div class="ucl-page-hero__art" aria-hidden="true"><img src="assets/ucl-starball.svg?v=1" alt=""></div>'
      + '</section>';
  }

  function applyHero(){
    ensureCss();
    const app = document.getElementById('app');
    const host = document.getElementById('view');
    if(!app || !host) return;

    const page = currentPage();
    const phase = phaseName();
    const existing = app.querySelector(':scope > .ucl-page-hero');

    /* The hero sits outside #view, so most paints do not affect it. Do nothing
       unless the active tab or competition phase actually changed. */
    if(existing && existing.dataset.uclPage===page && existing.dataset.uclPhase===phase){
      host.querySelectorAll(':scope > .ucl-hero').forEach(el=>el.remove());
      return;
    }

    app.querySelectorAll(':scope > .ucl-page-hero').forEach(el=>el.remove());
    host.querySelectorAll(':scope > .ucl-hero').forEach(el=>el.remove());
    app.insertAdjacentHTML('afterbegin', heroHtml(page,phase));
  }

  const BASE_PAINT = window.paint;
  if(typeof BASE_PAINT === 'function'){
    window.paint = function(){
      const out = BASE_PAINT.apply(this, arguments);
      requestAnimationFrame(applyHero);
      return out;
    };
  }

  ensureCss();
  requestAnimationFrame(applyHero);
})();