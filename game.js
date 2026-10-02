// ===================== Territory Idle =====================
// Inspired by State.io + FrontWars + Territorial.io

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');

// ---------- Config ----------
const COLORS = {
  player: '#3b82f6',
  neutral: '#475569',
  ai: ['#ef4444', '#a855f7', '#f59e0b', '#14b8a6']
};

const FACTION_NAMES = ['You', 'Crimson Legion', 'Void Empire', 'Solar Dynasty', 'Tide Dominion'];

// ---------- State ----------
let territories = [];
let selectedId = null;
let hoverId = null;
let gold = 0;
let prestige = 0;
let totalPrestigeEarned = 0;
let lastTick = Date.now();
let lastSave = Date.now();
let autoAttack = false;
let gameWon = false;

// Upgrades (multipliers / values)
const upgrades = {
  production: { level: 0, baseCost: 50, costMult: 1.55, effect: 0.15, name: 'Production Speed', desc: '+15% troop generation' },
  strength:   { level: 0, baseCost: 80, costMult: 1.6,  effect: 0.10, name: 'Troop Strength',   desc: '+10% combat power' },
  capacity:   { level: 0, baseCost: 100,costMult: 1.65, effect: 0.20, name: 'Max Capacity',     desc: '+20% troops per land' },
  goldGen:    { level: 0, baseCost: 60, costMult: 1.5,  effect: 0.25, name: 'Gold Economy',     desc: '+25% gold from land' },
  attackPct:  { level: 0, baseCost: 120,costMult: 1.7,  effect: 5,    name: 'Attack Efficiency',desc: '+5% max attack %' }
};

// ---------- Territory Graph (hand-crafted connected map) ----------
function createMap() {
  // Positions roughly laid out in a 5x4-ish world
  const nodes = [
    // Row 0
    { id: 0,  x: 0.15, y: 0.18, name: 'Northport' },
    { id: 1,  x: 0.35, y: 0.12, name: 'Frostpeak' },
    { id: 2,  x: 0.55, y: 0.15, name: 'Ironhold' },
    { id: 3,  x: 0.75, y: 0.20, name: 'Eastwatch' },
    // Row 1
    { id: 4,  x: 0.10, y: 0.38, name: 'Westwood' },
    { id: 5,  x: 0.30, y: 0.35, name: 'Riverdale' },
    { id: 6,  x: 0.50, y: 0.32, name: 'Centralis' },
    { id: 7,  x: 0.70, y: 0.38, name: 'Sunspire' },
    { id: 8,  x: 0.88, y: 0.35, name: 'Coral Bay' },
    // Row 2
    { id: 9,  x: 0.18, y: 0.58, name: 'Shadowfen' },
    { id: 10, x: 0.40, y: 0.55, name: 'Heartland' },
    { id: 11, x: 0.60, y: 0.52, name: 'Goldfield' },
    { id: 12, x: 0.82, y: 0.58, name: 'Stormgate' },
    // Row 3
    { id: 13, x: 0.25, y: 0.78, name: 'Southreach' },
    { id: 14, x: 0.45, y: 0.75, name: 'Ashen Vale' },
    { id: 15, x: 0.65, y: 0.80, name: 'Dragonspire' },
    { id: 16, x: 0.85, y: 0.78, name: 'Tidehaven' },
    // Extras for interest
    { id: 17, x: 0.08, y: 0.65, name: 'Mist Isles' },
    { id: 18, x: 0.92, y: 0.55, name: 'Crystal Peak' },
    { id: 19, x: 0.50, y: 0.92, name: 'Southern Tip' }
  ];

  // Adjacency list (undirected)
  const edges = [
    [0,1],[0,4],[0,5],
    [1,2],[1,5],[1,6],
    [2,3],[2,6],[2,7],
    [3,7],[3,8],
    [4,5],[4,9],[4,17],
    [5,6],[5,9],[5,10],
    [6,7],[6,10],[6,11],
    [7,8],[7,11],[7,12],
    [8,12],[8,18],
    [9,10],[9,13],[9,17],
    [10,11],[10,13],[10,14],
    [11,12],[11,14],[11,15],
    [12,15],[12,16],[12,18],
    [13,14],[13,17],[13,19],
    [14,15],[14,19],
    [15,16],[15,19],
    [16,18]
  ];

  // Build adjacency
  const adj = {};
  nodes.forEach(n => adj[n.id] = []);
  edges.forEach(([a,b]) => {
    adj[a].push(b);
    adj[b].push(a);
  });

  // Create territories
  territories = nodes.map(n => ({
    id: n.id,
    name: n.name,
    x: n.x,
    y: n.y,
    owner: -1,          // -1 = neutral, 0 = player, 1+ = AI
    troops: 8 + Math.floor(Math.random() * 12),
    neighbors: adj[n.id],
    radius: 28
  }));

  // Starting positions
  // Player starts in Centralis-ish area
  territories[6].owner = 0;
  territories[6].troops = 45;
  territories[10].owner = 0;
  territories[10].troops = 30;

  // AI starts
  territories[0].owner = 1; territories[0].troops = 35;
  territories[1].owner = 1; territories[1].troops = 25;

  territories[3].owner = 2; territories[3].troops = 35;
  territories[8].owner = 2; territories[8].troops = 28;

  territories[13].owner = 3; territories[13].troops = 40;
  territories[17].owner = 3; territories[17].troops = 22;

  territories[16].owner = 4; territories[16].troops = 38;
  territories[18].owner = 4; territories[18].troops = 20;
}

// ---------- Helpers ----------
function getOwned(faction) {
  return territories.filter(t => t.owner === faction);
}

function totalTroops(faction) {
  return getOwned(faction).reduce((s, t) => s + t.troops, 0);
}

function productionRate(faction) {
  const land = getOwned(faction).length;
  const base = land * 1.8;
  const mult = 1 + upgrades.production.level * upgrades.production.effect;
  // AI gets a small bonus so they stay competitive
  const aiBonus = faction > 0 ? 1.15 + faction * 0.05 : 1;
  return base * mult * aiBonus;
}

function goldRate() {
  const land = getOwned(0).length;
  const mult = 1 + upgrades.goldGen.level * upgrades.goldGen.effect;
  return land * 0.6 * mult;
}

function troopCap(t) {
  const base = 80 + t.owner === 0 ? upgrades.capacity.level * 15 : 40;
  return base + (t.owner === 0 ? upgrades.capacity.level * 20 : 0);
}

function combatPower(faction) {
  if (faction === 0) return 1 + upgrades.strength.level * upgrades.strength.effect;
  return 1.05; // slight AI edge
}

function maxAttackPct() {
  return Math.min(95, 40 + upgrades.attackPct.level * upgrades.attackPct.effect);
}

function log(msg, type = 'system') {
  const el = document.getElementById('log');
  const entry = document.createElement('div');
  entry.className = `entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.prepend(entry);
  if (el.children.length > 40) el.removeChild(el.lastChild);
}

// ---------- Combat ----------
function attack(fromId, toId, percent) {
  const from = territories[fromId];
  const to = territories[toId];
  if (!from || !to) return false;
  if (from.owner === to.owner) return false;
  if (!from.neighbors.includes(toId)) {
    log('Can only attack adjacent territories!', 'system');
    return false;
  }

  const send = Math.floor(from.troops * (percent / 100));
  if (send < 1) return false;

  from.troops -= send;

  const attackerPower = send * combatPower(from.owner);
  const defenderPower = to.troops * combatPower(to.owner);

  if (attackerPower > defenderPower) {
    // Conquer
    const remaining = Math.max(1, Math.floor((attackerPower - defenderPower) / combatPower(from.owner)));
    const oldOwner = to.owner;
    to.owner = from.owner;
    to.troops = remaining;

    if (from.owner === 0) {
      log(`Conquered ${to.name}!`, 'player');
      gold += 8 + Math.floor(Math.random() * 12);
    } else if (oldOwner === 0) {
      log(`${FACTION_NAMES[from.owner]} took ${to.name} from you!`, 'ai');
    } else {
      log(`${FACTION_NAMES[from.owner]} captured ${to.name}`, 'ai');
    }
    checkWin();
    return true;
  } else {
    // Failed attack – defenders lose some troops
    const loss = Math.floor(send * 0.6);
    to.troops = Math.max(1, to.troops - loss);
    if (from.owner === 0) log(`Attack on ${to.name} failed.`, 'player');
    return false;
  }
}

// ---------- AI ----------
function aiTurn(faction) {
  const owned = getOwned(faction);
  if (owned.length === 0) return;

  // Prefer expanding into neutrals, then weak enemies
  const candidates = [];
  owned.forEach(src => {
    src.neighbors.forEach(nid => {
      const tgt = territories[nid];
      if (tgt.owner !== faction) {
        candidates.push({ from: src.id, to: nid, score: 0 });
      }
    });
  });

  if (candidates.length === 0) return;

  // Score: prefer neutral, then lower troop count, then closer to player if aggressive
  candidates.forEach(c => {
    const tgt = territories[c.to];
    c.score = (tgt.owner === -1 ? 100 : 0) - tgt.troops;
    if (tgt.owner === 0) c.score += 30; // slightly aggressive toward player
    c.score += Math.random() * 15;
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Attack with 35-55%
  const pct = 35 + Math.floor(Math.random() * 20);
  attack(best.from, best.to, pct);
}

// ---------- Game Loop ----------
function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000; // seconds
  lastTick = now;

  // Troop generation for all factions
  for (let f = 0; f <= 4; f++) {
    const rate = productionRate(f);
    const owned = getOwned(f);
    if (owned.length === 0) continue;
    const perLand = rate / owned.length;
    owned.forEach(t => {
      t.troops = Math.min(troopCap(t), t.troops + perLand * dt);
    });
  }

  // Gold for player
  gold += goldRate() * dt;

  // AI actions (throttled)
  if (Math.random() < 0.018 * dt * 60) { // roughly every few seconds
    const activeAIs = [1,2,3,4].filter(f => getOwned(f).length > 0);
    if (activeAIs.length) {
      const f = activeAIs[Math.floor(Math.random() * activeAIs.length)];
      aiTurn(f);
    }
  }

  // Auto-attack for player
  if (autoAttack && Math.random() < 0.012 * dt * 60) {
    const owned = getOwned(0);
    const options = [];
    owned.forEach(src => {
      src.neighbors.forEach(nid => {
        const tgt = territories[nid];
        if (tgt.owner !== 0) options.push({ from: src.id, to: nid });
      });
    });
    if (options.length) {
      const pick = options[Math.floor(Math.random() * options.length)];
      const pct = Math.min(50, parseInt(document.getElementById('attackPercent').value));
      attack(pick.from, pick.to, pct);
    }
  }

  // Autosave every 15s
  if (now - lastSave > 15000) {
    saveGame();
    lastSave = now;
  }

  updateUI();
  draw();
  requestAnimationFrame(tick);
}

// ---------- Offline Progress ----------
function applyOfflineProgress() {
  const saved = localStorage.getItem('territoryIdle');
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    const offlineSec = Math.min((Date.now() - data.timestamp) / 1000, 3600 * 8); // cap 8h
    if (offlineSec < 5) return;

    // Approximate offline gains
    const land = data.territories.filter(t => t.owner === 0).length || 1;
    const prodMult = 1 + (data.upgrades?.production?.level || 0) * 0.15;
    const goldMult = 1 + (data.upgrades?.goldGen?.level || 0) * 0.25;

    const troopGain = land * 1.4 * prodMult * offlineSec * 0.7; // 70% efficiency offline
    const goldGain = land * 0.5 * goldMult * offlineSec * 0.7;

    // Distribute troops roughly
    const owned = territories.filter(t => t.owner === 0);
    if (owned.length) {
      const per = troopGain / owned.length;
      owned.forEach(t => t.troops = Math.min(200, t.troops + per));
    }
    gold += goldGain;

    log(`Welcome back! Offline for ${Math.floor(offlineSec/60)}m → +${Math.floor(troopGain)} troops, +${Math.floor(goldGain)} gold`, 'system');
  } catch (e) {}
}

// ---------- Save / Load ----------
function saveGame() {
  const data = {
    territories: territories.map(t => ({
      id: t.id, owner: t.owner, troops: Math.floor(t.troops)
    })),
    gold: Math.floor(gold),
    prestige,
    totalPrestigeEarned,
    upgrades: Object.fromEntries(Object.entries(upgrades).map(([k,v]) => [k, { level: v.level }])),
    autoAttack,
    timestamp: Date.now()
  };
  localStorage.setItem('territoryIdle', JSON.stringify(data));
}

function loadGame() {
  const raw = localStorage.getItem('territoryIdle');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    data.territories.forEach(st => {
      const t = territories.find(x => x.id === st.id);
      if (t) {
        t.owner = st.owner;
        t.troops = st.troops;
      }
    });
    gold = data.gold || 0;
    prestige = data.prestige || 0;
    totalPrestigeEarned = data.totalPrestigeEarned || 0;
    if (data.upgrades) {
      Object.keys(upgrades).forEach(k => {
        if (data.upgrades[k]) upgrades[k].level = data.upgrades[k].level || 0;
      });
    }
    autoAttack = !!data.autoAttack;
    document.getElementById('btnAuto').textContent = `Auto-Attack: ${autoAttack ? 'ON' : 'OFF'}`;
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- Prestige ----------
function canPrestige() {
  return getOwned(0).length >= 12;
}

function doPrestige() {
  if (!canPrestige()) return;
  const points = Math.floor(getOwned(0).length * 1.5 + totalTroops(0) / 200);
  prestige += points;
  totalPrestigeEarned += points;

  // Reset map & upgrades but keep prestige
  createMap();
  Object.keys(upgrades).forEach(k => upgrades[k].level = 0);
  gold = 20 + prestige * 5;
  autoAttack = false;
  document.getElementById('btnAuto').textContent = 'Auto-Attack: OFF';
  selectedId = null;
  gameWon = false;

  log(`Prestiged! +${points} prestige points. New run starts stronger.`, 'player');
  saveGame();
  updateUI();
}

// ---------- Win Check ----------
function checkWin() {
  if (gameWon) return;
  const playerLand = getOwned(0).length;
  if (playerLand >= territories.length * 0.75) {
    gameWon = true;
    showModal('Empire Dominated!', `You control ${playerLand} territories. Prestige to start a stronger run or keep expanding!`);
  }
}

function showModal(title, text) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalText').textContent = text;
  document.getElementById('modal').classList.remove('hidden');
}

// ---------- UI ----------
function updateUI() {
  document.getElementById('troopCount').textContent = Math.floor(totalTroops(0)).toLocaleString();
  document.getElementById('landCount').textContent = getOwned(0).length;
  document.getElementById('goldCount').textContent = Math.floor(gold).toLocaleString();
  document.getElementById('prestigeCount').textContent = prestige;

  // Attack % max
  const slider = document.getElementById('attackPercent');
  const maxP = maxAttackPct();
  slider.max = maxP;
  if (parseInt(slider.value) > maxP) slider.value = maxP;
  document.getElementById('attackPercentValue').textContent = slider.value;

  // Prestige button
  document.getElementById('btnPrestige').disabled = !canPrestige();

  // Upgrades list
  const container = document.getElementById('upgrades');
  container.innerHTML = '';
  Object.entries(upgrades).forEach(([key, u]) => {
    const cost = Math.floor(u.baseCost * Math.pow(u.costMult, u.level));
    const div = document.createElement('div');
    div.className = 'upgrade-item';
    div.innerHTML = `
      <div class="upgrade-info">
        <div class="upgrade-name">${u.name} (Lv ${u.level})</div>
        <div class="upgrade-desc">${u.desc}</div>
      </div>
      <span class="upgrade-cost">${cost}g</span>
      <button class="upgrade-btn" data-key="${key}" ${gold < cost ? 'disabled' : ''}>Buy</button>
    `;
    container.appendChild(div);
  });

  // Bind buy buttons
  container.querySelectorAll('.upgrade-btn').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.key;
      const u = upgrades[key];
      const cost = Math.floor(u.baseCost * Math.pow(u.costMult, u.level));
      if (gold >= cost) {
        gold -= cost;
        u.level++;
        log(`Upgraded ${u.name} to level ${u.level}`, 'player');
        updateUI();
        saveGame();
      }
    };
  });
}

// ---------- Rendering ----------
function resize() {
  const container = document.getElementById('map-container');
  const w = container.clientWidth;
  const h = container.clientHeight;
  canvas.width = w;
  canvas.height = h;
}

function draw() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Soft background grid
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Draw connections first
  ctx.lineWidth = 2;
  territories.forEach(t => {
    t.neighbors.forEach(nid => {
      if (nid > t.id) { // draw once
        const n = territories[nid];
        const x1 = t.x * w, y1 = t.y * h;
        const x2 = n.x * w, y2 = n.y * h;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
        ctx.stroke();
      }
    });
  });

  // Draw territories
  territories.forEach(t => {
    const x = t.x * w;
    const y = t.y * h;
    const r = t.radius + (selectedId === t.id ? 6 : hoverId === t.id ? 4 : 0);

    // Glow for selected / player
    if (t.owner === 0 || selectedId === t.id) {
      ctx.beginPath();
      ctx.arc(x, y, r + 8, 0, Math.PI * 2);
      ctx.fillStyle = t.owner === 0 ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.08)';
      ctx.fill();
    }

    // Main circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    let color = COLORS.neutral;
    if (t.owner === 0) color = COLORS.player;
    else if (t.owner > 0) color = COLORS.ai[t.owner - 1];

    ctx.fillStyle = color;
    ctx.fill();

    // Border
    ctx.lineWidth = selectedId === t.id ? 3 : 1.5;
    ctx.strokeStyle = selectedId === t.id ? '#fff' : 'rgba(0,0,0,0.4)';
    ctx.stroke();

    // Troop count
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(11, r * 0.45)}px Orbitron, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.floor(t.troops), x, y - 2);

    // Name (small)
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(t.name, x, y + r + 12);
  });
}

// ---------- Input ----------
function getTerritoryAt(mx, my) {
  const w = canvas.width, h = canvas.height;
  for (let i = territories.length - 1; i >= 0; i--) {
    const t = territories[i];
    const dx = mx - t.x * w;
    const dy = my - t.y * h;
    if (dx * dx + dy * dy <= (t.radius + 4) ** 2) return t;
  }
  return null;
}

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const t = getTerritoryAt(mx, my);
  if (!t) {
    selectedId = null;
    return;
  }

  if (t.owner === 0) {
    selectedId = t.id;
  } else if (selectedId !== null) {
    const pct = parseInt(document.getElementById('attackPercent').value);
    attack(selectedId, t.id, pct);
    // keep selection so player can chain attacks
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const t = getTerritoryAt(mx, my);
  hoverId = t ? t.id : null;

  if (t) {
    tooltip.classList.remove('hidden');
    tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
    tooltip.style.top = (e.clientY - rect.top + 14) + 'px';
    const ownerName = t.owner === -1 ? 'Neutral' : FACTION_NAMES[t.owner];
    tooltip.innerHTML = `<strong>${t.name}</strong><br>${ownerName}<br>Troops: ${Math.floor(t.troops)}`;
  } else {
    tooltip.classList.add('hidden');
  }
});

canvas.addEventListener('mouseleave', () => {
  hoverId = null;
  tooltip.classList.add('hidden');
});

// ---------- Buttons ----------
document.getElementById('attackPercent').addEventListener('input', e => {
  document.getElementById('attackPercentValue').textContent = e.target.value;
});

document.getElementById('btnPrestige').addEventListener('click', doPrestige);

document.getElementById('btnAuto').addEventListener('click', () => {
  autoAttack = !autoAttack;
  document.getElementById('btnAuto').textContent = `Auto-Attack: ${autoAttack ? 'ON' : 'OFF'}`;
  log(`Auto-Attack ${autoAttack ? 'enabled' : 'disabled'}`, 'system');
});

document.getElementById('btnSave').addEventListener('click', () => {
  saveGame();
  log('Game saved.', 'system');
});

document.getElementById('btnReset').addEventListener('click', () => {
  if (confirm('Hard reset everything including prestige?')) {
    localStorage.removeItem('territoryIdle');
    location.reload();
  }
});

document.getElementById('modalClose').addEventListener('click', () => {
  document.getElementById('modal').classList.add('hidden');
});

// ---------- Init ----------
window.addEventListener('resize', () => {
  resize();
  draw();
});

createMap();
resize();
const loaded = loadGame();
if (loaded) {
  applyOfflineProgress();
  log('Game loaded.', 'system');
} else {
  log('New empire founded. Expand and conquer!', 'system');
  gold = 25;
}
updateUI();
requestAnimationFrame(tick);

// Save on leave
window.addEventListener('beforeunload', saveGame);
