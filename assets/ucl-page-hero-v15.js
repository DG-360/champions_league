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

  function ensureCss(){
    if(document.querySelector('link[data-ucl-page-hero-v15]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/ucl-page-hero-v15.css?v=1';
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

  function heroHtml(page){
    const title = PAGE_TITLES[page] || 'Prediction League';
    return '<section class="ucl-page-hero ucl-page-hero--' + page + '" aria-label="UEFA Champions League ' + title + '">'
      + '<div class="ucl-page-hero__copy">'
      + '<div class="ucl-page-hero__kicker">UEFA Champions League</div>'
      + '<h1><span>UEFA Champions League</span><strong>' + title + '</strong></h1>'
      + '<div class="ucl-page-hero__meta"><span class="ucl-page-hero__dot"></span><span>' + phaseName() + '</span><em class="ucl-page-hero__season">2026/27</em></div>'
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

    /* Remove any previous shared/legacy page hero, wherever an earlier layer put it. */
    app.querySelectorAll('.ucl-page-hero').forEach(el => el.remove());
    host.querySelectorAll(':scope > .ucl-hero').forEach(el => el.remove());

    /* Required product order on every screen:
       1. UEFA Champions League hero / starball
       2. signed-in profile bar
       3. next deadline
       4. navigation
       5. tab content */
    app.insertAdjacentHTML('afterbegin', heroHtml(page));
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