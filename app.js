// ASCII Retro Arcade — Standalone (sin DB)
// Fixes:
// - Bloqueo global de scroll (flechas/espacio) cuando hay un juego activo.
// - Botón Stop siempre detiene timers y el juego.
// - Flappy con “tap-to-start” + gravedad/tick ajustados para no caer de inmediato.
// Mejoras:
// - Modal retro para capturar nombre del récord (máx 10).
// - Leaderboards locales Top10, reset por juego, export/import global.
// - Modo Marathon (guarda récords) / Practice (no guarda).
// - Seed por partida (reproducible); mostrado en Game Over y guardado en récord.
// - Tetris: ghost piece y mini wall-kick (±1 celda) al rotar.

const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };
const esc = (s='') => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ===== Dificultades y multiplicadores (mismo sistema) =====
const DIFF = {
  easy:   { label:'easy',   mult:1.00 },
  normal: { label:'normal', mult:1.25 },
  hard:   { label:'hard',   mult:1.60 },
  insane: { label:'insane', mult:2.00 }
};

// ===== Leaderboards locales =====
const LB_PREFIX = 'asciiArcade_';
function lbKey(game){ return `${LB_PREFIX}${game}_lb_v2`; }
function loadLB(game){ try { return JSON.parse(localStorage.getItem(lbKey(game)) || '[]'); } catch { return []; } }
function saveLB(game, arr){ localStorage.setItem(lbKey(game), JSON.stringify(arr)); }
function renderLB(game, tbodyId){
  const tb = $(tbodyId);
  if (!tb) return;
  const rows = loadLB(game).slice().sort((a,b)=> b.score - a.score).slice(0,10);
  tb.innerHTML = rows.length
   ? rows.map((r,i)=> `<tr><td>${i+1}</td><td>${esc(r.name)}</td><td><strong>${r.score}</strong></td><td class="muted small">${esc(r.difficulty||'-')}</td><td class="muted small">${esc(r.seed||'-')}</td></tr>`).join('')
   : `<tr><td colspan="5">—</td></tr>`;
}
function resetLB(game, tbodyId){
  if (!confirm(`¿Resetear leaderboard de ${game.toUpperCase()}?`)) return;
  localStorage.removeItem(lbKey(game));
  renderLB(game, tbodyId);
}
function qualifies(game, score){
  const rows = loadLB(game).slice().sort((a,b)=> b.score - a.score);
  if (rows.length < 10) return score > 0;
  return score > (rows[rows.length-1]?.score ?? 0);
}

// ===== Modal para nombre =====
const modal = { node: $('name-modal'), input: $('name-input'), ok: $('name-ok'), cancel: $('name-cancel'), desc: $('modal-desc') };
let modalCb = null;
function openNameModal(placeholder, cb){
  modalCb = cb;
  modal.input.value = '';
  modal.input.placeholder = placeholder || 'ANON';
  modal.node.classList.remove('hidden');
  modal.node.setAttribute('aria-hidden', 'false');
  setTimeout(()=> modal.input.focus(), 0);
}
function closeNameModal(){
  modal.node.classList.add('hidden');
  modal.node.setAttribute('aria-hidden', 'true');
  modalCb = null;
}
modal.ok.addEventListener('click', ()=>{
  const raw = (modal.input.value || 'ANON').trim().toUpperCase().slice(0,10);
  const name = raw.length ? raw : 'ANON';
  if (modalCb) modalCb(name);
  closeNameModal();
});
modal.cancel.addEventListener('click', ()=> { if (modalCb) modalCb(null); closeNameModal(); });
modal.input.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); modal.ok.click(); } });

// ===== Export/Import =====
function exportAll(){
  const all = {};
  for (const k of Object.keys(localStorage)){
    if (k.startsWith(LB_PREFIX)) all[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'ascii-arcade-leaderboards.json'; a.click();
  URL.revokeObjectURL(url);
}
function importAll(){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='application/json';
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try{
        const obj = JSON.parse(String(r.result||'{}'));
        Object.entries(obj).forEach(([k,v]) => { if (k.startsWith(LB_PREFIX)) localStorage.setItem(k, v); });
        // refresh
        renderLB('flappy','flappy-lb'); renderLB('snake','snake-lb'); renderLB('tetris','tetris-lb'); renderLB('road','road-lb');
        alert('Leaderboards importados.');
      }catch{ alert('Archivo inválido.'); }
    };
    r.readAsText(f);
  };
  inp.click();
}
$('export-all').addEventListener('click', exportAll);
$('import-all').addEventListener('click', importAll);

// ===== RNG con seed =====
function randomSeed(){
  if (window.crypto?.getRandomValues){
    const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0;
  }
  return (Math.random() * 0xFFFFFFFF) >>> 0;
}
function mulberry32(a){ return function(){ a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeRNG(seed){ return mulberry32(seed >>> 0); }
function randi(rng, min, max){ return Math.floor(rng()*(max-min+1))+min; }
function choice(rng, arr){ return arr[Math.floor(rng()*arr.length)]; }

// ===== Gestión de bloqueo de scroll global =====
const ACTIVE = new Set();
function anyActive(){ return ACTIVE.size > 0; }
function onGlobalKeydown(e){
  const k = e.key || e.code;
  const block = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Space','PageUp','PageDown'].includes(k);
  if (block && anyActive()){
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}
window.addEventListener('keydown', onGlobalKeydown, { capture: true }); // captura antes del scroll
function refreshBodyPlaying(){ document.body.classList.toggle('playing', anyActive()); }

// ===== Mini framework de juego =====
function makeGameModule(cfg){
  // cfg: { key, screenId, statusId, selectId, startBtnId, stopBtnId, modeId,
  //        timeId, scoreId, totalId, diffId, lbId,
  //        init(st, diff), tick(st), keydown(e, st) }
  const st = { active:false, paused:false, loop:null, timer:null, frame:0, tickMs:70,
               baseScore:0, elapsed:0, _requestStop:null, mode:'marathon', seed:0, rng:()=>Math.random() };

  function updateHud(){
    const d = DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal;
    text($(cfg.diffId), `${d.label} ×${d.mult.toFixed(2)}`);
    text($(cfg.scoreId), `${st.baseScore} → ×${d.mult.toFixed(2)}`);
    text($(cfg.totalId), String(Math.max(0, Math.round(st.baseScore * d.mult))));
  }
  function setStatus(s){ text($(cfg.statusId), s); }

  function stop(cause='finished'){
    if (!st.active) return;
    st.active=false;
    ACTIVE.delete(cfg.key);
    refreshBodyPlaying();
    if (st.loop){ clearInterval(st.loop); st.loop=null; }
    if (st.timer){ clearInterval(st.timer); st.timer=null; }
    const btnStart = $(cfg.startBtnId), btnStop = $(cfg.stopBtnId);
    if (btnStart) btnStart.disabled=false;
    if (btnStop)  btnStop.disabled=true;
    setStatus(cause==='crashed' ? 'crashed' : 'finished');

    const d = DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal;
    const finalScore = Math.max(0, Math.round(st.baseScore * d.mult));
    const pre = $(cfg.screenId);
    if (pre){
      pre.textContent += `\n\nGame Over — ${cause}.
Base: ${st.baseScore}
Dificultad: ${d.label} ×${d.mult.toFixed(2)}
Final: ${finalScore}
Seed: ${st.seed}`;
    }

    // Guardado sólo en Marathon y si califica
    if (st.mode === 'marathon' && qualifies(cfg.key, finalScore)){
      openNameModal('ANON', (name)=>{
        if (name === null){ name = 'ANON'; }
        const rows = loadLB(cfg.key);
        rows.push({ name, score: finalScore, difficulty: d.label, date: new Date().toISOString(), seed: String(st.seed) });
        rows.sort((a,b)=> b.score - a.score);
        saveLB(cfg.key, rows.slice(0,10));
        renderLB(cfg.key, cfg.lbId);
      });
    }
  }

  function start(){
    if (st.active) return;
    st.baseScore=0; st.frame=0; st.elapsed=0; st.paused=false; st._requestStop=null;
    st.mode = ($(cfg.modeId)?.value || 'marathon');
    st.seed = randomSeed();
    st.rng = makeRNG(st.seed);

    const btnStart=$(cfg.startBtnId), btnStop=$(cfg.stopBtnId);
    if (btnStart) btnStart.disabled=true;
    if (btnStop)  btnStop.disabled=false;
    setStatus('ready'); // cada juego puede usar “tap-to-start”

    const d = DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal;
    cfg.init(st, d);
    updateHud();

    st.active=true;
    ACTIVE.add(cfg.key);
    refreshBodyPlaying();

    st.loop = setInterval(()=>{
      if (!st.paused){
        st.frame++;
        cfg.tick(st);
        updateHud();
        if (st._requestStop){ const why = st._requestStop; st._requestStop=null; stop(why); }
      }
    }, st.tickMs);

    st.timer = setInterval(()=>{
      if (!st.paused){
        st.elapsed += 1;
        text($(cfg.timeId), String(st.elapsed));
      }
    }, 1000);
  }

  // wiring
  $(cfg.startBtnId).addEventListener('click', start);
  $(cfg.stopBtnId).addEventListener('click', ()=> stop('finished'));
  $(cfg.selectId).addEventListener('change', ()=> {
    if (!st.active){ const d=DIFF[$(cfg.selectId).value]||DIFF.normal; cfg.init(st, d); }
    updateHud();
  });
  if (cfg.modeId){
    $(cfg.modeId).addEventListener('change', ()=> { st.mode = $(cfg.modeId).value; });
  }

  // “Escape” también detiene
  window.addEventListener('keydown', (e)=>{ if (st.active && e.key==='Escape'){ e.preventDefault(); stop('finished'); } }, { capture:true });

  document.addEventListener('keydown', (e)=>{
    if (!st.active) return;
    const handled = cfg.keydown && cfg.keydown(e, st);
    if (handled) { e.preventDefault(); e.stopPropagation(); }
    if (e.key==='p' || e.key==='P'){ e.preventDefault(); st.paused=!st.paused; setStatus(st.paused?'paused':'playing'); }
  });

  return { start, stop, st };
}

// ===== Juego 1: Flappy =====
function makeFlappy(){
  const W=60, H=20, GROUND=H-2;
  let grid=[], bird, cols=[], gapBase=6, spawnEvery=22, waiting=true;

  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function render(){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    for (let x=0;x<W;x++){ grid[GROUND][x]='_'; if (grid[GROUND+1]) grid[GROUND+1][x]='_'; }
    for (const c of cols){ for (let y=0;y<H;y++){ if (y<c.gapY || y>=c.gapY+c.gapH){ if (y<GROUND) put(c.x,y,'|'); } } }
    put(bird.x, Math.round(bird.y), waiting ? ')' : '>');
    $('flappy-screen').textContent = grid.map(r=>r.join('')).join('\n') + (waiting ? `\n\nPress SPACE/↑ to start` : '');
  }
  function spawnCol(rng){
    const margin=3;
    const gapH = Math.max(3, gapBase + (rng()<0.3?-1:0) + (rng()<0.3?+1:0));
    const gapY = randi(rng, margin, (GROUND - margin - gapH));
    cols.push({ x:W-1, gapY, gapH });
  }

  const mod = makeGameModule({
    key:'flappy',
    screenId:'flappy-screen', statusId:'flappy-status',
    selectId:'flappy-select', startBtnId:'flappy-start', stopBtnId:'flappy-stop',
    modeId:'flappy-mode',
    timeId:'flappy-time', scoreId:'flappy-score', totalId:'flappy-total', diffId:'flappy-diff',
    lbId:'flappy-lb',
    init:(st, d)=>{
      clear(); cols=[]; waiting=true;
      // Gravedad/tick más suaves
      bird={x:8,y:Math.floor(H/2),vy:0};
      const baseMs = d.label==='easy' ? 95 : d.label==='normal' ? 85 : d.label==='hard' ? 75 : 65;
      st.tickMs = baseMs;
      spawnEvery = d.label==='easy' ? 28 : d.label==='normal' ? 24 : d.label==='hard' ? 20 : 16;
      gapBase = d.label==='insane' ? 5 : 6;

      $('flappy-screen').textContent =
`ASCII Flappy listo.
Dificultad: ${d.label} ×${d.mult.toFixed(2)}
Tap-to-start · Space/↑ salta · P pausa · Stop termina.`;
      text($('flappy-time'), '0'); st.elapsed=0; st.baseScore=0;
    },
    tick:(st)=>{
      const g = 0.22; // gravedad suavizada
      if (!waiting){
        bird.vy += g; bird.y += bird.vy;
        if (bird.y<1){ bird.y=1; bird.vy=0; }
        if (bird.y>=GROUND){ st._requestStop='crashed'; return; }
        if (st.frame % spawnEvery === 0) spawnCol(st.rng);

        let passed=false;
        for (const c of cols){ c.x -= 1; if (c.x === bird.x-1) passed=true; }
        if (passed) st.baseScore++;

        for (const c of cols){
          if (c.x===bird.x){
            const y=Math.round(bird.y);
            if (y<c.gapY || y>=c.gapY+c.gapH){ st._requestStop='crashed'; return; }
          }
        }
        cols = cols.filter(c => c.x>=0);
      }
      render();
    },
    keydown:(e)=>{
      if (e.code==='Space' || e.key===' ' || e.key==='ArrowUp'){
        if (waiting
