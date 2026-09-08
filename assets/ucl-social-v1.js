/* Profile photos only. Spotlight rendering moved out of this layer. */
(() => {
  "use strict";
  let cameraStream = null;

  const currentPlayerId = () => (typeof me !== "undefined" ? me : null);

  function playerByName(name){
    return Object.entries(typeof players!=="undefined"?players:{}).find(([,p]) => p && p.name === name);
  }

  function putPhoto(el,p){
    if(!el||!p) return;
    if(p.photo){
      el.classList.add("has-photo");
      el.style.backgroundImage=`url("${String(p.photo).replace(/"/g,"%22")}")`;
      el.textContent="";
    }else{
      el.classList.remove("has-photo");
      el.style.backgroundImage="";
    }
  }

  function decorateAvatars(){
    const pid=currentPlayerId();
    if(pid && players[pid]) putPhoto(document.getElementById("uAv"),players[pid]);
    document.querySelectorAll('.lb-row').forEach(r=>{
      const n=r.querySelector('.who2 b')?.childNodes?.[0]?.textContent?.trim();
      const hit=playerByName(n); if(hit) putPhoto(r.querySelector('.av'),hit[1]);
    });
    document.querySelectorAll('.pa-row').forEach(r=>{
      const n=r.querySelector('.pa-nm')?.childNodes?.[0]?.textContent?.trim();
      const hit=playerByName(n); if(hit) putPhoto(r.querySelector('.av'),hit[1]);
    });
    document.querySelectorAll('.who-b').forEach(r=>{
      const txt=[...r.querySelectorAll('*')].map(x=>x.textContent.trim()).find(t=>playerByName(t));
      const hit=playerByName(txt); if(hit) putPhoto(r.querySelector('.av'),hit[1]);
    });
  }

  function ensurePhotoControl(){
    const bar=document.querySelector('.ubar');
    if(!bar) return;
    if(!bar.querySelector('.profile-photo-btn')){
      const b=document.createElement('button');
      b.className='ico profile-photo-btn';
      b.type='button';
      b.title='Profile photo';
      b.setAttribute('aria-label','Change profile photo');
      b.textContent='📷';
      b.addEventListener('click',openPhotoChooser);
      const color=bar.querySelector('button[title*="player color"]:not(#uAv)');
      bar.insertBefore(b,color||bar.lastElementChild);
    }
    const av=document.getElementById('uAv');
    if(av && !av.dataset.photoBound){
      av.dataset.photoBound='1';
      av.title='Profile photo';
      av.onclick=openPhotoChooser;
    }
  }

  function ensurePhotoDialog(){
    if(document.getElementById('uclPhotoOverlay')) return;
    const wrap=document.createElement('div');
    wrap.id='uclPhotoOverlay';
    wrap.className='ucl-photo-overlay';
    wrap.hidden=true;
    wrap.innerHTML=`
      <div class="ucl-photo-sheet" role="dialog" aria-modal="true" aria-labelledby="uclPhotoTitle">
        <div class="ucl-photo-options" id="uclPhotoOptions">
          <div class="ucl-photo-mark">Player profile</div>
          <h2 id="uclPhotoTitle">Choose a profile photo</h2>
          <p>Your chosen player color remains the fallback whenever no photo is set.</p>
          <button type="button" class="ucl-photo-choice primary" data-photo-action="camera">
            <span class="ucl-photo-choice-icon">📷</span>
            <span><b>Take a photo</b><small>Open your camera and take a new profile picture.</small></span>
          </button>
          <button type="button" class="ucl-photo-choice" data-photo-action="gallery">
            <span class="ucl-photo-choice-icon">▧</span>
            <span><b>Choose from photos</b><small>Select an existing photo from your gallery or files.</small></span>
          </button>
          <button type="button" class="ucl-photo-later" data-photo-action="close">Not now</button>
        </div>
        <div class="ucl-camera-stage" id="uclCameraStage" hidden>
          <div class="ucl-photo-mark">Camera</div>
          <h2>Take your profile photo</h2>
          <div class="ucl-camera-frame"><video id="uclCameraVideo" autoplay playsinline muted></video></div>
          <p id="uclCameraHint">Center your face in the frame, then take the photo.</p>
          <div class="ucl-camera-actions">
            <button type="button" class="ucl-camera-back" data-photo-action="back">Back</button>
            <button type="button" class="ucl-camera-shoot" data-photo-action="shoot">Take photo</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click',e=>{
      if(e.target===wrap){ closePhotoChooser(); return; }
      const b=e.target.closest('[data-photo-action]');
      if(!b) return;
      const a=b.dataset.photoAction;
      if(a==='camera') startCamera();
      else if(a==='gallery') chooseFromGallery();
      else if(a==='close') closePhotoChooser();
      else if(a==='back') showPhotoOptions();
      else if(a==='shoot') captureCameraPhoto();
    });
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape' && !wrap.hidden) closePhotoChooser();
    });
  }

  function openPhotoChooser(){
    const pid=currentPlayerId();
    if(!pid || typeof players==='undefined' || !players[pid]) return;
    ensurePhotoDialog();
    showPhotoOptions();
    const ov=document.getElementById('uclPhotoOverlay');
    ov.hidden=false;
    document.body.classList.add('ucl-photo-open');
    requestAnimationFrame(()=>ov.querySelector('[data-photo-action="camera"]')?.focus());
  }

  function showPhotoOptions(){
    stopCamera();
    const opts=document.getElementById('uclPhotoOptions');
    const stage=document.getElementById('uclCameraStage');
    if(opts) opts.hidden=false;
    if(stage) stage.hidden=true;
  }

  function closePhotoChooser(){
    stopCamera();
    const ov=document.getElementById('uclPhotoOverlay');
    if(ov) ov.hidden=true;
    document.body.classList.remove('ucl-photo-open');
  }

  async function startCamera(){
    ensurePhotoDialog();
    const opts=document.getElementById('uclPhotoOptions');
    const stage=document.getElementById('uclCameraStage');
    const video=document.getElementById('uclCameraVideo');
    const hint=document.getElementById('uclCameraHint');
    if(!navigator.mediaDevices?.getUserMedia){ chooseCameraFile(); return; }
    try{
      stopCamera();
      cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
      video.srcObject=cameraStream;
      opts.hidden=true;
      stage.hidden=false;
      hint.textContent='Center your face in the frame, then take the photo.';
      await video.play().catch(()=>{});
    }catch(e){
      if(hint) hint.textContent='Camera access was not available. Opening your device camera instead.';
      chooseCameraFile();
    }
  }

  function stopCamera(){
    if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
    const video=document.getElementById('uclCameraVideo');
    if(video) video.srcObject=null;
  }

  async function captureCameraPhoto(){
    const video=document.getElementById('uclCameraVideo');
    if(!video || !video.videoWidth || !video.videoHeight){
      if(typeof toast==='function') toast('Camera is still starting','bad');
      return;
    }
    try{
      const data=cropVideoToDataUrl(video,192,.78);
      await saveProfilePhoto(data);
      closePhotoChooser();
    }catch(e){
      if(typeof toast==='function') toast('Could not save profile photo','bad');
    }
  }

  function chooseCameraFile(){ chooseFile(true); }
  function chooseFromGallery(){ chooseFile(false); }

  function chooseFile(useCamera){
    const input=document.createElement('input');
    input.type='file'; input.accept='image/*';
    if(useCamera) input.setAttribute('capture','user');
    input.style.position='fixed'; input.style.left='-10000px';
    document.body.appendChild(input);
    input.addEventListener('change',async()=>{
      const f=input.files&&input.files[0]; input.remove();
      if(!f) return;
      try{
        const data=await compressSquare(f,192,.78);
        await saveProfilePhoto(data);
        closePhotoChooser();
      }catch(e){ if(typeof toast==='function') toast('Could not save profile photo','bad'); }
    },{once:true});
    input.click();
  }

  async function saveProfilePhoto(data){
    const pid=currentPlayerId();
    if(!pid) throw new Error('No signed-in player');
    await ref(`players/${pid}/photo`).set(data);
    if(typeof toast==='function') toast('Profile photo updated','good');
  }

  function cropVideoToDataUrl(video,size,q){
    const sw=video.videoWidth, sh=video.videoHeight;
    const side=Math.min(sw,sh), sx=(sw-side)/2, sy=(sh-side)/2;
    const c=document.createElement('canvas'); c.width=size; c.height=size;
    const x=c.getContext('2d'); x.translate(size,0); x.scale(-1,1);
    x.drawImage(video,sx,sy,side,side,0,0,size,size);
    return c.toDataURL('image/jpeg',q);
  }

  function compressSquare(file,size,q){
    return new Promise((resolve,reject)=>{
      const fr=new FileReader(); fr.onerror=reject;
      fr.onload=()=>{
        const im=new Image(); im.onerror=reject;
        im.onload=()=>{
          const side=Math.min(im.width,im.height), sx=(im.width-side)/2, sy=(im.height-side)/2;
          const c=document.createElement('canvas'); c.width=size; c.height=size;
          c.getContext('2d').drawImage(im,sx,sy,side,side,0,0,size,size);
          resolve(c.toDataURL('image/jpeg',q));
        };
        im.src=fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* Run only after a real application paint. No whole-document observer. */
  const BASE=typeof paint==='function'?paint:null;
  if(typeof BASE==='function') paint=function(){
    const out=BASE.apply(this,arguments);
    requestAnimationFrame(()=>{ensurePhotoControl();decorateAvatars();});
    return out;
  };

  requestAnimationFrame(()=>{ensurePhotoControl();ensurePhotoDialog();decorateAvatars();});
})();