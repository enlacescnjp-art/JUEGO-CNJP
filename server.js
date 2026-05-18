const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const WIDTH = 900;
const HEIGHT = 500;
const GROUND_Y = 420;
const GRAVITY = 0.6;
const PLAYER_W = 50;
const PLAYER_H = 70;

const CHARACTERS = {
  warrior: {
    name: 'Guerrero',
    health: 300, speed: 4.5, jumpVel: -12,
    color: '#e74c3c',
    attacks: {
      punch: { range: 22, dmg: 12, cd: 46, kb: 4 },
      kick:  { range: 42, dmg: 20, cd: 46, kb: 8 }
    },
    dodgeSpeed: 13, dodgeDuration: 10, dodgeCooldown: 300,
    special: { label: 'ESCUDO', duration: 90 }
  },
  ninja: {
    name: 'Ninja',
    health: 240, speed: 5.5, jumpVel: -14,
    color: '#3498db',
    attacks: {
      punch: { range: 18, dmg: 5, cd: 20, kb: 3 },
      kick:  { range: 35, dmg: 9, cd: 20, kb: 6 }
    },
    dodgeSpeed: 16, dodgeDuration: 8, dodgeCooldown: 240,
    special: { label: 'TP' }
  },
  brute: {
    name: 'Bruto',
    health: 400, speed: 3.0, jumpVel: -9,
    color: '#2ecc71',
    attacks: {
      punch: { range: 26, dmg: 23, cd: 60, kb: 6 },
      kick:  { range: 48, dmg: 34, cd: 60, kb: 10 }
    },
    dodgeSpeed: 9, dodgeDuration: 12, dodgeCooldown: 360,
    special: { label: 'GOLPE' }
  }
};

const FIREBALL_SPEED = 9;
const FIREBALL_DMG = 25;
const FIREBALL_SIZE = 18;
const FIREBALL_LIFETIME = 120;
const MAX_POWER = 100;
const POWER_ON_HIT = 15;
const POWER_ON_HIT_RECEIVED = 8;

const SPAWN = [
  { x: 200, y: GROUND_Y - PLAYER_H },
  { x: WIDTH - 250, y: GROUND_Y - PLAYER_H }
];

function createPlayer(id, charId = 'warrior') {
  const c = CHARACTERS[charId];
  const base = { left: false, right: false, jump: false, punch: false, kick: false, dodge: false, fireball: false, special: false };
  return {
    id, charId,
    x: SPAWN[id].x, y: SPAWN[id].y,
    vx: 0, vy: 0,
    health: c.health, maxHealth: c.health,
    facing: id === 0 ? 1 : -1,
    grounded: false,
    attackTimer: 0, attackType: null, hitTimer: 0,
    dodgeTimer: 0, dodgeCooldown: 0,
    specialTimer: 0, specialCooldown: 0, specialActivated: 0,
    power: 0,
    inputs: { ...base },
    prevDodge: false, prevFireball: false,
    connected: false, ready: false
  };
}

function checkHit(attacker, defender, atkCfg) {
  const atkBox = {
    x: attacker.facing === 1 ? attacker.x + PLAYER_W : attacker.x - atkCfg.range,
    y: attacker.y, w: atkCfg.range, h: PLAYER_H
  };
  const defBox = { x: defender.x, y: defender.y, w: PLAYER_W, h: PLAYER_H };
  return atkBox.x < defBox.x + defBox.w && atkBox.x + atkBox.w > defBox.x &&
         atkBox.y < defBox.y + defBox.h && atkBox.y + atkBox.h > defBox.y;
}

function boxOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const clients = [null, null];
let gameState = [createPlayer(0), createPlayer(1)];
let effects = [], fireballs = [];
let gameRunning = false, gameLoop = null;
let round = 1, scores = [0, 0];
let roundState = 'waiting', roundTimer = 0, winner = null;

const server = http.createServer((req, res) => {
  if (req.url === '/' || !req.url.startsWith('/')) {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading game'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let playerId = null;

  if (clients[0] === null) { playerId = 0; }
  else if (clients[1] === null) { playerId = 1; }
  else { ws.send(JSON.stringify({ type: 'error', message: 'Game is full' })); ws.close(); return; }

  clients[playerId] = ws;
  gameState[playerId] = createPlayer(playerId);
  gameState[playerId].connected = true;
  console.log(`Player ${playerId + 1} connected`);

  const chars = Object.keys(CHARACTERS).map(id => ({ id, name: CHARACTERS[id].name, color: CHARACTERS[id].color }));
  ws.send(JSON.stringify({ type: 'init', playerId, characters: chars }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'select' && playerId !== null && CHARACTERS[msg.character]) {
        const p = gameState[playerId];
        p.charId = msg.character;
        p.ready = true;
        const c = CHARACTERS[msg.character];
        p.health = c.health; p.maxHealth = c.health;
        console.log(`Player ${playerId + 1} selected ${c.name}`);
        if (gameState[0].ready && gameState[1].ready) {
          broadcast({ type: 'start', characters: [gameState[0].charId, gameState[1].charId] });
          setTimeout(startGame, 1500);
        }
      } else if (msg.type === 'input' && playerId !== null) {
        gameState[playerId].inputs = msg.keys;
      } else if (msg.type === 'special' && playerId !== null) {
        activateSpecial(playerId);
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${playerId + 1} disconnected`);
    if (playerId !== null) {
      clients[playerId] = null;
      gameState[playerId].connected = false;
      gameState[playerId].ready = false;
      stopGame();
    }
  });
});

function startGame() {
  resetPlayers();
  roundState = 'countdown';
  roundTimer = 180;
  gameRunning = true;
  if (gameLoop) clearInterval(gameLoop);
  gameLoop = setInterval(gameTick, 1000 / 60);
}

function stopGame() {
  gameRunning = false;
  if (gameLoop) { clearInterval(gameLoop); gameLoop = null; }
  broadcast({ type: 'waiting', message: 'Esperando oponente...' });
}

function resetPlayers() {
  const base = { left: false, right: false, jump: false, punch: false, kick: false, dodge: false, fireball: false, special: false };
  for (let i = 0; i < 2; i++) {
    const p = gameState[i];
    const c = CHARACTERS[p.charId];
    p.x = SPAWN[i].x; p.y = SPAWN[i].y;
    p.vx = 0; p.vy = 0;
    p.health = c.health; p.maxHealth = c.health;
    p.facing = i === 0 ? 1 : -1;
    p.grounded = false;
    p.attackTimer = 0; p.attackType = null; p.hitTimer = 0;
    p.dodgeTimer = 0; p.dodgeCooldown = 0;
    p.specialTimer = 0; p.specialCooldown = 0; p.specialActivated = 0;
    p.power = 0;
    p.inputs = { ...base };
    p.prevDodge = false; p.prevFireball = false;
  }
  effects = []; fireballs = []; winner = null;
}

function activateSpecial(i) {
  const p = gameState[i];
  if (!p || p.power < 50 || p.specialCooldown > 0) return false;
  p.power = 0;
  p.specialCooldown = 15;
  p.specialActivated = 30;
  if (p.charId === 'warrior') {
    p.specialTimer = 90;
    p.vx = 0;
    effects.push({ x: p.x, y: p.y + PLAYER_H / 2, timer: 15, type: 'shield' });
  } else if (p.charId === 'ninja') {
    const other = gameState[1 - i];
    const oldX = p.x;
    p.x = other.x + other.facing * PLAYER_W;
    p.x = Math.max(0, Math.min(WIDTH - PLAYER_W, p.x));
    p.facing = -other.facing;
    effects.push({ x: oldX + PLAYER_W / 2, y: p.y + PLAYER_H / 2, timer: 12, type: 'teleport' });
    effects.push({ x: p.x + PLAYER_W / 2, y: p.y + PLAYER_H / 2, timer: 12, type: 'teleport' });
  } else if (p.charId === 'brute') {
    const other = gameState[1 - i];
    const dx = (other.x + PLAYER_W / 2) - (p.x + PLAYER_W / 2);
    const dist = Math.abs(dx);
    effects.push({ x: p.x + PLAYER_W / 2, y: GROUND_Y, timer: 20, type: 'slam' });
    if (dist < 100) {
      other.health -= 18;
      other.vx = (dx > 0 ? 1 : -1) * 14;
      other.vy = -7; other.hitTimer = 14; other.grounded = false;
      other.power = Math.min(other.power + POWER_ON_HIT_RECEIVED, MAX_POWER);
      if (other.health <= 0) {
        other.health = 0; roundState = 'ko'; roundTimer = 90;
        winner = i;
        broadcast({ type: 'ko', winner: i });
      }
    }
  }
  return true;
}

function spawnFireball(owner) {
  const p = gameState[owner];
  fireballs.push({
    x: p.facing === 1 ? p.x + PLAYER_W : p.x - FIREBALL_SIZE,
    y: p.y + PLAYER_H / 2 - FIREBALL_SIZE / 2,
    vx: p.facing * FIREBALL_SPEED, vy: 0,
    owner, w: FIREBALL_SIZE, h: FIREBALL_SIZE, timer: FIREBALL_LIFETIME
  });
}

function isInvincible(p) {
  return p.dodgeTimer > 0 || p.specialTimer > 0;
}

function gameTick() {
  if (!gameRunning) return;

  if (roundState === 'countdown') {
    roundTimer--;
    if (roundTimer <= 0) roundState = 'fighting';
    broadcastState();
    return;
  }

  if (roundState === 'ko') {
    roundTimer--;
    if (roundTimer <= 0) {
      if (winner !== null) scores[winner]++;
      if (scores[0] >= 2 || scores[1] >= 2) {
        broadcast({ type: 'gameover', winner, scores });
        gameRunning = false; clearInterval(gameLoop); gameLoop = null;
        return;
      }
      round++; resetPlayers();
      roundState = 'countdown'; roundTimer = 180;
    }
    broadcastState();
    return;
  }

  for (let i = 0; i < 2; i++) {
    const p = gameState[i];
    const cfg = CHARACTERS[p.charId];
    const inp = p.inputs;

    if (p.dodgeCooldown > 0) p.dodgeCooldown--;
    if (p.specialCooldown > 0) p.specialCooldown--;
    if (p.specialActivated > 0) p.specialActivated--;

    // Attacks
    let triggered = null;
    if (inp.kick && p.attackTimer === 0) triggered = 'kick';
    if (inp.punch && p.attackTimer === 0) triggered = 'punch';

    if (triggered && p.specialTimer === 0) {
      const atk = cfg.attacks[triggered];
      p.attackTimer = atk.cd;
      p.attackType = triggered;
      const other = gameState[1 - i];
      if (checkHit(p, other, atk) && !isInvincible(other)) {
        other.health -= atk.dmg;
        other.vx = p.facing * atk.kb;
        other.vy = -3; other.hitTimer = 8; other.grounded = false;
        effects.push({ x: other.x, y: other.y - 20, timer: 10, type: triggered });
        p.power = Math.min(p.power + POWER_ON_HIT, MAX_POWER);
        other.power = Math.min(other.power + POWER_ON_HIT_RECEIVED, MAX_POWER);
        if (other.health <= 0) {
          other.health = 0; roundState = 'ko'; roundTimer = 90;
          winner = i;
          broadcast({ type: 'ko', winner: i });
        }
      }
    }

    // Hit stun blocks movement
    if (p.hitTimer > 0) {
      p.hitTimer--;
    } else if (p.dodgeTimer === 0 && p.specialTimer === 0) {
      p.vx = 0;
      if (inp.left) p.vx = -cfg.speed;
      if (inp.right) p.vx = cfg.speed;
      if (inp.jump && p.grounded) {
        p.vy = cfg.jumpVel; p.grounded = false;
      }
    }

    // Dodge
    if (inp.dodge && !p.prevDodge && p.dodgeCooldown === 0 && p.dodgeTimer === 0 && p.specialTimer === 0) {
      p.dodgeTimer = cfg.dodgeDuration;
      p.dodgeCooldown = cfg.dodgeCooldown;
      p.vx = p.facing * cfg.dodgeSpeed; p.vy = -2; p.grounded = false;
      effects.push({ x: p.x, y: p.y + PLAYER_H / 2, timer: 8, type: 'dodge' });
    }
    p.prevDodge = inp.dodge;

    // Fireball
    if (inp.fireball && !p.prevFireball && p.power >= MAX_POWER && p.attackTimer === 0 && p.dodgeTimer === 0 && p.specialTimer === 0) {
      p.power = 0; p.attackTimer = 15; p.attackType = 'fireball';
      spawnFireball(i);
    }
    p.prevFireball = inp.fireball;

    // Special handled via direct message, no input check needed here

    if (p.attackTimer > 0) p.attackTimer--;
    if (p.specialTimer > 0) p.specialTimer--;

    if (p.dodgeTimer > 0) {
      p.dodgeTimer--;
      if (p.dodgeTimer < cfg.dodgeDuration * 0.4) p.vx *= 0.85;
    }

    p.vy += GRAVITY; p.x += p.vx; p.y += p.vy;

    if (p.x < 0) p.x = 0;
    if (p.x > WIDTH - PLAYER_W) p.x = WIDTH - PLAYER_W;
    if (p.y + PLAYER_H > GROUND_Y) { p.y = GROUND_Y - PLAYER_H; p.vy = 0; p.grounded = true; }
    if (p.vx !== 0 && p.dodgeTimer === 0 && p.specialTimer === 0) p.facing = p.vx > 0 ? 1 : -1;
  }

  // Prevent overlap
  if (gameState[0].x < gameState[1].x + PLAYER_W && gameState[0].x + PLAYER_W > gameState[1].x &&
      gameState[0].y < gameState[1].y + PLAYER_H && gameState[0].y + PLAYER_H > gameState[1].y) {
    const overlap = (gameState[0].x + PLAYER_W / 2 + gameState[1].x + PLAYER_W / 2) / 2;
    if (gameState[0].x < gameState[1].x) {
      gameState[0].x = overlap - PLAYER_W; gameState[1].x = overlap;
    } else {
      gameState[0].x = overlap; gameState[1].x = overlap - PLAYER_W;
    }
  }

  // Fireballs
  for (let i = fireballs.length - 1; i >= 0; i--) {
    const fb = fireballs[i];
    fb.x += fb.vx; fb.y += fb.vy; fb.timer--;
    if (fb.timer <= 0 || fb.x < -50 || fb.x > WIDTH + 50) { fireballs.splice(i, 1); continue; }
    const target = gameState[1 - fb.owner];
    const fbBox = { x: fb.x, y: fb.y, w: fb.w, h: fb.h };
    const tBox = { x: target.x, y: target.y, w: PLAYER_W, h: PLAYER_H };
    if (boxOverlap(fbBox, tBox) && !isInvincible(target)) {
      target.health -= FIREBALL_DMG;
      target.vx = (fb.vx > 0 ? 1 : -1) * 10; target.vy = -5;
      target.hitTimer = 12; target.grounded = false;
      target.power = Math.min(target.power + POWER_ON_HIT_RECEIVED, MAX_POWER);
      effects.push({ x: fb.x, y: fb.y, timer: 18, type: 'fireball_hit' });
      if (target.health <= 0) {
        target.health = 0; roundState = 'ko'; roundTimer = 90;
        winner = fb.owner;
        broadcast({ type: 'ko', winner: fb.owner });
      }
      fireballs.splice(i, 1);
    }
  }

  effects = effects.filter(e => { e.timer--; return e.timer > 0; });
  broadcastState();
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (let i = 0; i < 2; i++) {
    if (clients[i] && clients[i].readyState === 1) clients[i].send(msg);
  }
}

function broadcastState() {
  const countdown = roundState === 'countdown' ? Math.ceil(roundTimer / 60) : 0;
  broadcast({
    type: 'state',
    players: gameState.map(p => ({
      x: Math.round(p.x), y: Math.round(p.y),
      health: p.health, maxHealth: p.maxHealth,
      facing: p.facing, attackTimer: p.attackTimer, attackType: p.attackType,
      hitTimer: p.hitTimer, grounded: p.grounded,
      dodgeTimer: p.dodgeTimer, dodgeCooldown: p.dodgeCooldown,
      specialTimer: p.specialTimer, specialActivated: p.specialActivated,
      power: p.power, charId: p.charId
    })),
    fireballs: fireballs.map(fb => ({ x: Math.round(fb.x), y: Math.round(fb.y), w: fb.w, h: fb.h })),
    effects: effects.map(e => ({ x: Math.round(e.x), y: Math.round(e.y), timer: e.timer, type: e.type })),
    roundState, countdown, round, scores, winner
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LAN Fighter server running on port ${PORT}`);
  console.log(`Connect at ws://<YOUR_IP>:${PORT}`);
});
