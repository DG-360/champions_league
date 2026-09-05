/* Shared Champions League hero layer · presentation only */
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

  const mobileMq = window.matchMedia('(max-width:700px)');

  function ensureCss(){
    if(document.querySelector('link[data-ucl-page-hero]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/ucl-page-hero-v14.css?v=2';
    link.dataset.uclPageHero = '1';
    document.head.appendChild(link);
  }

  function phaseName(){
    if(typeof uclPhaseIndex === 'function' && typeof uclPhaseName === 'function'){
      try { return uclPhaseName(uclPhaseIndex()); } catch(e) {}
    }
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

  function heroHtml(page){
    const title = PAGE_TITLES[page] || 'Prediction League';
    const home = page === 'home';
    return '<section class="ucl-page-hero' + (home ? ' ucl-page-hero--home' : '') + '" aria-label="UEFA Champions League ' + title + '">'
      + '<div class="ucl-page-hero__copy">'
      + '<div class="ucl-page-hero__kicker">UEFA Champions League</div>'
      + '<h1><span>UEFA Champions League</span><strong>' + title + '</strong></h1>'
      + '<div class="ucl-page-hero__meta"><span class="ucl-page-hero__dot"></span><span>' + phaseName() + '</span><em class="ucl-page-hero__season">2026/27</em></div>'
      + '</div>'
      + '<div class="ucl-page-hero__art" aria-hidden="true"><img src="assets/ucl-starball.svg?v=1" alt=""></div>'
      + '</section>';
  }

  function currentPage(){
    if(typeof view === 'string' && PAGE_TITLES[view]) return view;
    const active = document.querySelector('.nav button.on');
    return active && PAGE_TITLES[active.dataset.v] ? active.dataset.v : 'home';
  }

  function removeSharedHeroes(app, host){
    app.querySelectorAll(':scope > .ucl-page-hero').forEach(el => el.remove());
    host.querySelectorAll(':scope > .ucl-page-hero').forEach(el => el.remove());
  }

  function applyHero(){
    ensureCss();
    const app = document.getElementById('app');
    const host = document.getElementById('view');
    if(!app || !host) return;

    const page = currentPage();
    removeSharedHeroes(app, host);

    const legacyHero = host.querySelector(':scope > .ucl-hero');
    if(legacyHero) legacyHero.remove();

    if(mobileMq.matches){
      /* Mobile product order: Champions League identity first, then only the
         signed-in player's profile. The all-player strip is hidden in CSS. */
      app.insertAdjacentHTML('afterbegin', heroHtml(page));
    } else {
      /* Desktop keeps the hero inside the active page content. */
      host.insertAdjacentHTML('afterbegin', heroHtml(page));
    }
  }

  const BASE_PAINT = window.paint;
  if(typeof BASE_PAINT === 'function'){
    window.paint = function(){
      const out = BASE_PAINT.apply(this, arguments);
      requestAnimationFrame(applyHero);
      return out;
    };
  }

  let resizeTimer = 0;
  function onViewportChange(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyHero, 80);
  }
  if(typeof mobileMq.addEventListener === 'function') mobileMq.addEventListener('change', onViewportChange);
  else if(typeof mobileMq.addListener === 'function') mobileMq.addListener(onViewportChange);

  ensureCss();
  requestAnimationFrame(applyHero);
})();