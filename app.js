// ASCII Retro Arcade — Standalone (sin DB)
// Fixes prioritarios:
// 1) Flappy no se desploma al iniciar: "grace time" + gravedad afinada.
// 2) Anti-scroll global de flechas/Espacio cuando cualquier juego está activo.
// 3) Stop detiene de forma inmediata (limpieza robusta de timers).

const $ = (id) => document.getElementById(id);
const text = (el, v) => { if (el) el.textContent = v ?? ''; };
const esc = (s='') => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Dificultades/multiplicadores (se conservan)
const DIFF = {
  easy:   { label:'easy',   mult:1.00 },
  normal: { label:'normal', mult:1.25 },
  hard:   { label:'hard',   mult:1.60 },
  insane: { label:'insane', mult:2.00 }
};

// ====== Leaderboards locales ======
const LB_PREFIX = 'asciiArcade_';
const ALL = []; // aquí registramos los módulos para saber si hay juegos activos

function lbKey(game){ return `${LB_PREFIX}${game}_lb_v1`; }
function loadLB(game){ try { return JSON.parse(localStorage.getItem(lbKey(game)) || '[]'); } catch { return []; } }
function saveLB(game, arr){ localStorage.setItem(lbKey(game), JSON.stringify(arr)); }
function renderLB(game, tbodyId){
  const tb = $(tbodyId);
  if (!tb) return;
  const rows = loadLB(game).slice().sort((a,b)=> b.score - a.score).slice(0,10);
  tb.innerHTML = rows.length
    ? rows.map((r,i)=> `<tr><td>${i+1}</td><td>${esc(r.name)}</td><td><strong>${r.score}</strong></td><td class="muted small">${esc(r.difficulty||'-')}</td></tr>`).join('')
    : `<tr><td colspan="4">—</td></tr>`;
}
function qualifies(game, score){
  const rows = loadLB(game).slice().sort((a,b)=> b.score - a.score);
  if (rows.length < 10) return score > 0;
  return score > (rows[rows.length-1]?.score ?? 0);
}
function maybeRecord(game, score, diffLabel, tbodyId){
  if (!qualifies(game, score)) return;
  let name = prompt(`¡Nuevo récord en ${game.toUpperCase()}!\nIngresa tu nombre (máx 10 caracteres):`, '');
  if (name === null) name = '';
  name = (name || 'ANON').trim().toUpperCase().slice(0,10);
  const rows = loadLB(game);
  rows.push({ name, score, difficulty: diffLabel, date: new Date().toISOString() });
  rows.sort((a,b)=> b.score - a.score);
  saveLB(game, rows.slice(0,10));
  renderLB(game, tbodyId);
}
function resetLB(game, tbodyId){
  if (!confirm(`¿Resetear leaderboard de ${game.toUpperCase()}?`)) return;
  localStorage.removeItem(lbKey(game));
  renderLB(game, tbodyId);
}

// Export/Import (opcional)
function exportAll(){
  const all = {};
  for (const k of Object.keys(localStorage)){
    if (k.startsWith(LB_PREFIX)) all[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(all, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'ascii-arcade-leaderboards.json';
  a.click(); URL.revokeObjectURL(url);
}
function importAll(){
  const inp = document.createElement('input'); inp.type='file'; inp.accept='application/json';
  inp.onchange = () => {
    const f = inp.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try{
        const obj = JSON.parse(String(r.result||'{}'));
        Object.entries(obj).forEach(([k,v]) => { if (k.startsWith(LB_PREFIX)) localStorage.setItem(k,v); });
        ['flappy','snake','tetris','road'].forEach(g => renderLB(g, `${g}-lb`));
        alert('Leaderboards importados.');
      }catch{ alert('Archivo inválido.'); }
    };
    r.readAsText(f);
  };
  inp.click();
}
$('export-all').addEventListener('click', exportAll);
$('import-all').addEventListener('click', importAll);

// ====== Mini framework de juego ======
function makeGameModule(cfg){
  // cfg: { key, screenId, statusId, selectId, startBtnId, stopBtnId,
  //        timeId, scoreId, totalId, diffId, lbId,
  //        init(st, diff), tick(st), keydown(e, st) }
  const st = {
    active:false, paused:false, loop:null, timer:null,
    frame:0, tickMs:70, baseScore:0, elapsed:0, _requestStop:null
  };

  function updateHud(){
    const d = DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal;
    text($(cfg.diffId), `${d.label} ×${d.mult.toFixed(2)}`);
    text($(cfg.scoreId), `${st.baseScore} → ×${d.mult.toFixed(2)}`);
    text($(cfg.totalId), String(Math.max(0, Math.round(st.baseScore * d.mult))));
  }
  function setStatus(s){ text($(cfg.statusId), s); }

  function cleanTimers(){
    if (st.loop){ clearInterval(st.loop); st.loop=null; }
    if (st.timer){ clearInterval(st.timer); st.timer=null; }
  }

  function stop(cause='finished'){
    if (!st.active) return;
    st.active=false;
    cleanTimers();
    $(cfg.startBtnId).disabled=false;
    $(cfg.stopBtnId).disabled=true;
    setStatus(cause==='crashed' ? 'crashed' : 'finished');

    const d = DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal;
    const finalScore = Math.max(0, Math.round(st.baseScore * d.mult));
    const pre = $(cfg.screenId);
    if (pre){
      pre.textContent += `\n\nGame Over — ${cause}.
Base: ${st.baseScore}
Difficulty: ${d.label} ×${d.mult.toFixed(2)}
Final: ${finalScore}`;
    }
    maybeRecord(cfg.key, finalScore, d.label, cfg.lbId);
  }

  function start(){
    if (st.active) return;
    // Reinicio total
    st.baseScore=0; st.frame=0; st.elapsed=0; st.paused=false; st._requestStop=null;
    $(cfg.startBtnId).disabled=true;
    $(cfg.stopBtnId).disabled=false;
    setStatus('get ready');
    const d = DIFF[$(cfg.selectId)?.value || 'normal'] || DIFF.normal;
    cfg.init(st, d);
    updateHud();

    // Arranque con "grace time" (no física 800ms) para evitar muertes instantáneas
    const startAfter = Date.now() + 800;
    st.active=true;
    st.loop = setInterval(()=>{
      if (!st.paused){
        if (Date.now() < startAfter) { return; } // gracia
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
        if (Date.now() >= startAfter) setStatus('playing');
      }
    }, 1000);
  }

  // Eventos
  $(cfg.startBtnId).addEventListener('click', start);
  $(cfg.stopBtnId).addEventListener('click', (e)=> { e.preventDefault(); stop('finished'); });
  $(cfg.selectId).addEventListener('change', ()=>{
    if (!st.active){
      const d=DIFF[$(cfg.selectId).value]||DIFF.normal; cfg.init(st, d);
    }
    updateHud();
  });
  document.addEventListener('keydown', (e)=>{
    if (!st.active) return;
    const handled = cfg.keydown && cfg.keydown(e, st);
    if (handled) e.preventDefault();
    if (e.key==='p' || e.key==='P'){ e.preventDefault(); st.paused=!st.paused; setStatus(st.paused?'paused':'playing'); }
  });

  const api = { start, stop, st };
  ALL.push(api);
  return api;
}

// ====== Juego 1: Flappy (con física afinada y gracia inicial) ======
function makeFlappy(){
  const W=60, H=20, GROUND=H-2;
  let grid=[], bird, cols=[], gapBase=6, spawnEvery=22, gravity=0.22, firstInput=false;

  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function render(){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    for (let x=0;x<W;x++){ grid[GROUND][x]='_'; if (grid[GROUND+1]) grid[GROUND+1][x]='_'; }
    for (const c of cols){ for (let y=0;y<H;y++){ if (y<c.gapY || y>=c.gapY+c.gapH){ if (y<GROUND) put(c.x,y,'|'); } } }
    put(bird.x, Math.round(bird.y), '>');
    $('flappy-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }
  function spawnCol(){
    const margin=3;
    const jitter = (n)=> n + (Math.random()<0.25?-1:0) + (Math.random()<0.25?+1:0);
    const gapH = Math.max(3, jitter(gapBase));
    const gapY = Math.floor(Math.random() * (GROUND - margin - gapH)) + margin;
    cols.push({ x:W-1, gapY, gapH });
  }

  return makeGameModule({
    key:'flappy',
    screenId:'flappy-screen', statusId:'flappy-status',
    selectId:'flappy-select', startBtnId:'flappy-start', stopBtnId:'flappy-stop',
    timeId:'flappy-time', scoreId:'flappy-score', totalId:'flappy-total', diffId:'flappy-diff',
    lbId:'flappy-lb',
    init:(st, d)=>{
      clear(); cols=[]; bird={x:8,y:Math.floor(H/2),vy:0}; firstInput=false;
      // Física más amable por dificultad
      const baseMs = d.label==='easy' ? 90 : d.label==='normal' ? 70 : d.label==='hard' ? 58 : 48;
      gravity = d.label==='easy' ? 0.18 : d.label==='normal' ? 0.22 : d.label==='hard' ? 0.26 : 0.30;
      st.tickMs = baseMs;
      spawnEvery = d.label==='easy' ? 28 : d.label==='normal' ? 22 : d.label==='hard' ? 18 : 14;
      gapBase = d.label==='insane' ? 5 : 6;

      $('flappy-screen').textContent =
`ASCII Flappy listo.
Dificultad: ${d.label} ×${d.mult.toFixed(2)}
Space/↑ saltar · P pausa · Stop terminar.
(Comienza con breve protección de caída.)`;
      text($('flappy-time'), '0'); st.elapsed=0; st.baseScore=0;
    },
    tick:(st)=>{
      // Gracia inicial: sin gravedad hasta que el usuario salte, o hasta ~1s (gestionado en start())
      if (st.frame > 0){
        if (!firstInput && st.elapsed < 2){
          // Caída muy lenta durante la gracia si no hay input
          bird.vy += gravity * 0.2;
        } else {
          bird.vy += gravity;
        }
        bird.y += bird.vy;
      }
      if (bird.y<1){ bird.y=1; bird.vy=0; }
      if (bird.y>=GROUND){ st._requestStop='crashed'; return; }

      // No spawnear columnas hasta que pase ~1s o haya input
      if ((st.frame % spawnEvery === 0) && (firstInput || st.elapsed >= 2)) spawnCol();

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
      render();
    },
    keydown:(e)=>{
      if (e.code==='Space' || e.key===' ' || e.key==='ArrowUp'){
        e.preventDefault();
        firstInput = true;
        bird.vy = -1.85; // impulso moderado
        return true;
      }
      return false;
    }
  });
}

// ====== Juego 2: Snake ======
function makeSnake(){
  const W=28, H=18;
  let grid=[], snake=[], dir=[1,0], food=[10,8];

  function clear(){ grid = Array.from({length:H+2}, ()=> Array.from({length:W+2}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W+2&&y>=0&&y<H+2) grid[y][x]=ch; }
  function drawBorder(){
    for (let x=0;x<W+2;x++){ put(x,0,'#'); put(x,H+1,'#'); }
    for (let y=0;y<H+2;y++){ put(0,y,'#'); put(W+1,y,'#'); }
  }
  function rndFood(){
    while(true){
      const x = 1 + Math.floor(Math.random()*W), y = 1 + Math.floor(Math.random()*H);
      if (!snake.some(([sx,sy])=> sx===x && sy===y)){ food=[x,y]; return; }
    }
  }
  function render(){
    for (let y=0;y<H+2;y++) for (let x=0;x<W+2;x++) grid[y][x]=' ';
    drawBorder();
    put(food[0], food[1], '*');
    snake.forEach(([x,y],i)=> put(x,y, i===0?'@':'o'));
    $('snake-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }

  return makeGameModule({
    key:'snake',
    screenId:'snake-screen', statusId:'snake-status',
    selectId:'snake-select', startBtnId:'snake-start', stopBtnId:'snake-stop',
    timeId:'snake-time', scoreId:'snake-score', totalId:'snake-total', diffId:'snake-diff',
    lbId:'snake-lb',
    init:(st, d)=>{
      clear(); snake=[[3,3],[2,3],[1,3]]; dir=[1,0]; rndFood();
      const base = d.label==='easy' ? 150 : d.label==='normal' ? 120 : d.label==='hard' ? 95 : 80;
      st.tickMs = base;
      $('snake-screen').textContent =
`ASCII Snake listo.
Dificultad: ${d.label} ×${d.mult.toFixed(2)}
Flechas mover · P pausa · Stop terminar.`;
      text($('snake-time'),'0'); st.elapsed=0; st.baseScore=0;
    },
    tick:(st)=>{
      const head=[snake[0][0]+dir[0], snake[0][1]+dir[1]];
      if (head[0] <= 0 || head[0] >= W+1 || head[1] <= 0 || head[1] >= H+1){ st._requestStop='crashed'; return; }
      if (snake.some(([x,y])=> x===head[0] && y===head[1])){ st._requestStop='crashed'; return; }
      snake.unshift(head);
      if (head[0]===food[0] && head[1]===food[1]){ st.baseScore += 5; rndFood(); }
      else { snake.pop(); }
      render();
    },
    keydown:(e)=>{
      let handled=false;
      if (e.key==='ArrowLeft' && dir[0]!==1){ dir=[-1,0]; handled=true; }
      else if (e.key==='ArrowRight' && dir[0]!==-1){ dir=[1,0]; handled=true; }
      else if (e.key==='ArrowUp' && dir[1]!==1){ dir=[0,-1]; handled=true; }
      else if (e.key==='ArrowDown' && dir[1]!==-1){ dir=[0,1]; handled=true; }
      if (handled) e.preventDefault();
      return handled;
    }
  });
}

// ====== Juego 3: Tetris ======
function makeTetris(){
  const W=10, H=18;
  let grid, cur, cx, cy, rot, bag;

  const SHAPES = {
    O: [[[1,1],[1,1]]],
    I: [[[1],[1],[1],[1]], [[1,1,1,1]]],
    L: [[[1,0],[1,0],[1,1]], [[1,1,1],[1,0,0]], [[1,1],[0,1],[0,1]], [[0,0,1],[1,1,1]]],
    T: [[[1,1,1],[0,1,0]], [[1,0],[1,1],[1,0]], [[0,1,0],[1,1,1]], [[0,1],[1,1],[0,1]]]
  };

  function emptyGrid(){ return Array.from({length:H}, ()=> Array.from({length:W}, ()=> 0)); }
  function draw(){
    const buf = Array.from({length:H}, (_,y)=> Array.from({length:W}, (_,x)=> grid[y][x] ? '[]' : ' .'));
    const s = SHAPES[cur][rot];
    for (let y=0;y<s.length;y++)
      for (let x=0;x<s[0].length;x++)
        if (s[y][x] && cy+y>=0 && cy+y<H && cx+x>=0 && cx+x<W) buf[cy+y][cx+x] = '[]';
    $('tetris-screen').textContent = buf.map(r=>r.join('')).join('\n');
  }
  function collide(nx=cx, ny=cy, nrot=rot){
    const s = SHAPES[cur][nrot];
    for (let y=0;y<s.length;y++)
      for (let x=0;x<s[0].length;x++){
        if (!s[y][x]) continue;
        const X = nx+x, Y = ny+y;
        if (X<0||X>=W||Y>=H) return true;
        if (Y>=0 && grid[Y][X]) return true;
      }
    return false;
  }
  function lockPiece(st){
    const s = SHAPES[cur][rot];
    for (let y=0;y<s.length;y++)
      for (let x=0;x<s[0].length;x++)
        if (s[y][x] && cy+y>=0) grid[cy+y][cx+x]=1;
    let cleared=0;
    for (let y=H-1;y>=0;y--){
      if (grid[y].every(v=>v)){ grid.splice(y,1); grid.unshift(Array.from({length:W},()=>0)); cleared++; y++; }
    }
    if (cleared>0){ st.baseScore += cleared*10; }
    if (!spawnPiece(st)){ st._requestStop='crashed'; }
  }
  function spawnPiece(st){
    if (!bag || bag.length===0) bag = ['I','O','L','T'].sort(()=>Math.random()-0.5);
    cur = bag.pop(); rot=0; cx= Math.floor(W/2)-1; cy=-2;
    return !collide(cx, cy, rot);
  }

  return makeGameModule({
    key:'tetris',
    screenId:'tetris-screen', statusId:'tetris-status',
    selectId:'tetris-select', startBtnId:'tetris-start', stopBtnId:'tetris-stop',
    timeId:'tetris-time', scoreId:'tetris-score', totalId:'tetris-total', diffId:'tetris-diff',
    lbId:'tetris-lb',
    init:(st, d)=>{
      grid = emptyGrid(); bag=null;
      const base = d.label==='easy' ? 900 : d.label==='normal' ? 750 : d.label==='hard' ? 550 : 420;
      st.tickMs = base;
      $('tetris-screen').textContent =
`ASCII Tetris listo.
Dificultad: ${d.label} ×${d.mult.toFixed(2)}
← → mover · ↑ rotar · ↓ caer · P pausa · Stop terminar.`;
      text($('tetris-time'),'0'); st.elapsed=0; st.baseScore=0;
      if (!spawnPiece(st)){ st._requestStop='crashed'; }
    },
    tick:(st)=>{
      if (!collide(cx, cy+1, rot)){ cy++; }
      else {
        if (cy<0){ st._requestStop='crashed'; return; }
        lockPiece(st);
        if (st._requestStop) return;
      }
      draw();
    },
    keydown:(e)=>{
      let handled=false;
      if (e.key==='ArrowLeft' && !collide(cx-1, cy, rot)){ cx--; handled=true; }
      else if (e.key==='ArrowRight' && !collide(cx+1, cy, rot)){ cx++; handled=true; }
      else if (e.key==='ArrowUp'){ const nr=(rot+1)%SHAPES[cur].length; if (!collide(cx, cy, nr)){ rot=nr; handled=true; } }
      else if (e.key==='ArrowDown' && !collide(cx, cy+1, rot)){ cy++; handled=true; }
      if (handled){ e.preventDefault(); draw(); }
      return handled;
    }
  });
}

// ====== Juego 4: Road ======
function makeRoad(){
  const W=27, H=22;
  let grid=[], carX, carY, obs=[], left=5, right=W-5, driftTimer=0;

  const CAR  = [ [0,0,'^'], [-1,1,'/'], [0,1,'#'], [1,1,'\\'] ];
  const ENEM = [ [0,0,'A'], [-1,1,'o'], [1,1,'o'] ];

  function clear(){ grid = Array.from({length:H}, ()=> Array.from({length:W}, ()=> ' ')); }
  function put(x,y,ch){ if (x>=0&&x<W&&y>=0&&y<H) grid[y][x]=ch; }
  function render(){
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) grid[y][x]=' ';
    for (let y=0;y<H;y++){ grid[y][left]='|'; grid[y][right]='|'; }
    const mid = Math.floor((left+right)/2);
    for (let y=0;y<H;y++) if (y%2===0) grid[y][mid]=':';
    for (const [dx,dy,ch] of CAR) put(carX+dx, carY+dy, ch);
    for (const o of obs) for (const [dx,dy,ch] of ENEM) put(o.x+dx, o.y+dy, ch);
    $('road-screen').textContent = grid.map(r=>r.join('')).join('\n');
  }
  function spawnEnemy(){
    const min = left+2, max = right-2;
    const x = Math.max(min, Math.min(max, Math.floor(Math.random()*(max-min+1))+min));
    obs.push({ x, y:0 });
  }
  function collideCar(){
    for (const [dx,dy] of CAR){
      const x=carX+dx, y=carY+dy;
      if (x<=left || x>=right) return true;
    }
    const carCells = new Set(CAR.map(([dx,dy])=>`${carX+dx},${carY+dy}`));
    for (const o of obs){
      for (const [dx,dy] of ENEM){
        if (carCells.has(`${o.x+dx},${o.y+dy}`)) return true;
      }
    }
    return false;
  }

  return makeGameModule({
    key:'road',
    screenId:'road-screen', statusId:'road-status',
    selectId:'road-select', startBtnId:'road-start', stopBtnId:'road-stop',
    timeId:'road-time', scoreId:'road-score', totalId:'road-total', diffId:'road-diff',
    lbId:'road-lb',
    init:(st, d)=>{
      clear(); obs=[]; left=5; right=W-5; carX=Math.floor(W/2); carY=H-3; driftTimer=0;
      const base = d.label==='easy' ? 120 : d.label==='normal' ? 95 : d.label==='hard' ? 80 : 65;
      st.tickMs = base;
      st._spawnEvery = d.label==='easy' ? 12 : d.label==='normal' ? 9 : d.label==='hard' ? 7 : 5;
      $('road-screen').textContent =
`ASCII Road listo.
Dificultad: ${d.label} ×${d.mult.toFixed(2)}
← → mover · P pausa · Stop terminar.`;
      text($('road-time'),'0'); st.elapsed=0; st.baseScore=0;
    },
    tick:(st)=>{
      if (st.frame % st._spawnEvery === 0) spawnEnemy();
      for (const o of obs) o.y += 1;
      obs = obs.filter(o => o.y < H-1);

      driftTimer++;
      if (driftTimer % 25 === 0){
        const minWidth = 9, maxWidth = 17;
        const width = right - left;
        const narrow = Math.random() < 0.6;
        if (narrow && width > minWidth){ left += 1; right -= 1; }
        else if (!narrow && width < maxWidth){ left -= 1; right += 1; }
        left = Math.max(2, Math.min(left, Math.floor(W/2)-4));
        right = Math.min(W-3, Math.max(right, Math.floor(W/2)+4));
      }

      st.baseScore += 1 + obs.filter(o => o.y===carY && Math.abs(o.x - carX) > 2).length;

      if (collideCar()){ st._requestStop='crashed'; return; }
      render();
    },
    keydown:(e)=>{
      if (e.key==='ArrowLeft'){ carX -= 1; e.preventDefault(); render(); return true; }
      if (e.key==='ArrowRight'){ carX += 1; e.preventDefault(); render(); return true; }
      return false;
    }
  });
}

// ====== Anti-scroll global y arranque ======
function installGlobalKeyTrap(){
  window.addEventListener('keydown', (e)=>{
    const k = e.key || e.code;
    const isMovement = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Space','PageUp','PageDown'].includes(k);
    if (!isMovement) return;
    if (ALL.some(m => m?.st?.active)){ e.preventDefault(); }
  }, { capture:true }); // capture para ganarle al scroll del navegador
}

function main(){
  const flappy = makeFlappy();
  const snake  = makeSnake();
  const tetris = makeTetris();
  const road   = makeRoad();

  // Leaderboards: render/reset
  $('flappy-reset').addEventListener('click', ()=> resetLB('flappy','flappy-lb'));
  $('snake-reset').addEventListener('click',  ()=> resetLB('snake','snake-lb'));
  $('tetris-reset').addEventListener('click', ()=> resetLB('tetris','tetris-lb'));
  $('road-reset').addEventListener('click',   ()=> resetLB('road','road-lb'));

  renderLB('flappy','flappy-lb');
  renderLB('snake','snake-lb');
  renderLB('tetris','tetris-lb');
  renderLB('road','road-lb');

  installGlobalKeyTrap();
}

document.addEventListener('DOMContentLoaded', main);

