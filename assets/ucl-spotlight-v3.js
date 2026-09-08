/* Matchday Spotlight v3 · single cached renderer + application paint scheduler. */
(() => {
  "use strict";
  let data = {};
  let paintQueued = false;
  let latestArgs = [];

  const esc2 = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const currentView2 = () => (typeof view !== "undefined" ? view : null);

  function spotlightItems(){
    return (Array.isArray(data.items)?data.items:Object.values(data.items||{})).slice(0,3);
  }

  function signature(items){
    return items.map(x=>[
      x.mid,x.home,x.away,
      ...(Array.isArray(x.facts)?x.facts:Object.values(x.facts||{}))
    ].join('|')).join('||');
  }

  function renderSpotlight(){
    if(currentView2()!=="home") return;
    const host=document.getElementById('view');
    if(!host) return;

    const items=spotlightItems();
    const existing=host.querySelector('.ucl-spotlight');
    if(!items.length){ if(existing) existing.remove(); return; }

    const sig=signature(items);
    if(existing && existing.dataset.spotlightSig===sig) return;

    const html='<section class="ucl-card ucl-spotlight ucl-spotlight-v3" data-spotlight-sig="'+esc2(sig)+'">'
      +'<div class="ucl-card-h"><span>Matchday Spotlight</span><b>Worth knowing</b></div>'
      +'<div class="ucl-spotlight-grid">'
      +items.map(x=>{
        const facts=(Array.isArray(x.facts)?x.facts:Object.values(x.facts||{})).filter(Boolean).slice(0,3);
        return '<article class="ucl-fact">'
          +'<div class="ucl-fact-match">'+esc2(x.home)+' <span>vs</span> '+esc2(x.away)+'</div>'
          +(facts.length?'<ul class="ucl-fact-list">'+facts.map(f=>'<li>'+esc2(f)+'</li>').join('')+'</ul>':'')
          +'</article>';
      }).join('')
      +'</div></section>';

    if(existing) existing.remove();
    const dash=host.querySelector('.ucl-dashboard-grid');
    if(dash) dash.insertAdjacentHTML('afterend',html);
  }

  /* Spotlight data is already researched/cached by GitHub Actions. Browsers
     only subscribe to this small Firebase object and render it; no web/news
     requests are made from the client. */
  if(typeof ref==='function'){
    ref('weeklySpotlight').on('value',s=>{
      data=s.val()||{};
      requestAnimationFrame(renderSpotlight);
    });
  }

  /* Firebase starts many listeners together. Previously each callback called
     paint() immediately, causing repeated full DOM rebuilds. This outermost
     wrapper coalesces all calls arriving in the same frame into one repaint. */
  const REAL_PAINT = typeof window.paint==='function' ? window.paint : null;
  if(REAL_PAINT){
    window.paint=function(){
      latestArgs=arguments;
      if(paintQueued) return;
      paintQueued=true;
      requestAnimationFrame(()=>{
        paintQueued=false;
        REAL_PAINT.apply(window,latestArgs);
        requestAnimationFrame(renderSpotlight);
      });
    };
  }

  requestAnimationFrame(renderSpotlight);
})();