const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const WIDTH = 900;
const HEIGHT = 500;
const GROUND_Y = 420;
const GRAVITY = 0.6;
const MOVE_SPEED = 4.5;
const JUMP_VEL = -12;
const MAX_HEALTH = 100;
const PLAYER_W = 50;
const PLAYER_H = 70;

const ATTACKS = {
  punch: { range: 10, dmg: 5, cd: 10, kb: 4 },
  kick:  { range: 28, dmg: 9, cd: 18, kb: 8 }
};

const SPAWN = [
  { x: 200, y: GROUND_Y - PLAYER_H },
  { x: WIDTH - 250, y: GROUND_Y - PLAYER_H }
];

function createPlayer(id) {
  return {
    id,
    x: SPAWN[id].x,
    y: SPAWN[id].y,
    vx: 0,
    vy: 0,
    health: MAX_HEALTH,
    facing: id === 0 ? 1 : -1,
    grounded: false,
    attackTimer: 0,
    attackType: null,
    hitTimer: 0,
    inputs: { left: false, right: false, jump: false, punch: false, kick: false },
    connected: false
  };
}

function checkHit(attacker, defender, atkName) {
  const atk = ATTACKS[atkName];
  // Attack hitbox extends from attacker's front edge
  const atkBox = {
    x: attacker.facing === 1 ? attacker.x + PLAYER_W : attacker.x - atk.range,
    y: attacker.y,
    w: atk.range,
    h: PLAYER_H
  };
  // Defender's body
  const defBox = { x: defender.x, y: defender.y, w: PLAYER_W, h: PLAYER_H };
  return (
    atkBox.x < defBox.x + defBox.w &&
    atkBox.x + atkBox.w > defBox.x &&
    atkBox.y < defBox.y + defBox.h &&
    atkBox.y + atkBox.h > defBox.y
  );
}

const clients = [null, null];
let gameState = [createPlayer(0), createPlayer(1)];
let effects = [];
let gameRunning = false;
let gameLoop = null;
let round = 1;
let scores = [0, 0];
let roundState = 'waiting'; // waiting, countdown, fighting, ko
let roundTimer = 0;
let winner = null;

const server = http.createServer((req, res) => {
  if (req.url === '/' || !req.url.startsWith('/')) {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading game');
        return;
      }
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

  if (clients[0] === null) {
    playerId = 0;
    clients[0] = ws;
    gameState[0] = createPlayer(0);
    gameState[0].connected = true;
    console.log('Player 1 connected');
    ws.send(JSON.stringify({ type: 'init', playerId: 0 }));
  } else if (clients[1] === null) {
    playerId = 1;
    clients[1] = ws;
    gameState[1] = createPlayer(1);
    gameState[1].connected = true;
    console.log('Player 2 connected');
    ws.send(JSON.stringify({ type: 'init', playerId: 1 }));
    startGame();
  } else {
    ws.send(JSON.stringify({ type: 'error', message: 'Game is full' }));
    ws.close();
    return;
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'input' && playerId !== null) {
        gameState[playerId].inputs = msg.keys;
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    console.log(`Player ${playerId} disconnected`);
    if (playerId !== null) {
      clients[playerId] = null;
      gameState[playerId].connected = false;
      stopGame();
    }
  });
});

function startGame() {
  resetPlayers();
  roundState = 'countdown';
  roundTimer = 120;
  gameRunning = true;
  if (gameLoop) clearInterval(gameLoop);
  gameLoop = setInterval(gameTick, 1000 / 60);
}

function stopGame() {
  gameRunning = false;
  if (gameLoop) {
    clearInterval(gameLoop);
    gameLoop = null;
  }
  broadcast({ type: 'waiting', message: 'Esperando oponente...' });
}

function resetPlayers() {
  for (let i = 0; i < 2; i++) {
    const p = gameState[i];
    p.x = SPAWN[i].x;
    p.y = SPAWN[i].y;
    p.vx = 0;
    p.vy = 0;
    p.health = MAX_HEALTH;
    p.facing = i === 0 ? 1 : -1;
    p.grounded = false;
    p.attackTimer = 0;
    p.attackType = null;
    p.hitTimer = 0;
  }
  effects = [];
  winner = null;
}

function gameTick() {
  if (!gameRunning) return;

  if (roundState === 'countdown') {
    roundTimer--;
    if (roundTimer <= 0) {
      roundState = 'fighting';
    }
    broadcastState();
    return;
  }

  if (roundState === 'ko') {
    roundTimer--;
    if (roundTimer <= 0) {
      if (winner !== null) scores[winner]++;
      if (scores[0] >= 2 || scores[1] >= 2) {
        broadcast({ type: 'gameover', winner, scores });
        gameRunning = false;
        clearInterval(gameLoop);
        gameLoop = null;
        return;
      }
      round++;
      resetPlayers();
      roundState = 'countdown';
      roundTimer = 120;
    }
    broadcastState();
    return;
  }

  for (let i = 0; i < 2; i++) {
    const p = gameState[i];
    const inp = p.inputs;

    if (p.hitTimer > 0) {
      p.hitTimer--;
    } else {
      p.vx = 0;
      if (inp.left) p.vx = -MOVE_SPEED;
      if (inp.right) p.vx = MOVE_SPEED;
      if (inp.jump && p.grounded) {
        p.vy = JUMP_VEL;
        p.grounded = false;
      }
      let triggered = null;
      if (inp.kick  && p.attackTimer === 0) triggered = 'kick';
      if (inp.punch && p.attackTimer === 0) triggered = 'punch';

      if (triggered) {
        const atk = ATTACKS[triggered];
        p.attackTimer = atk.cd;
        p.attackType = triggered;
        const other = gameState[1 - i];
        if (checkHit(p, other, triggered)) {
          other.health -= atk.dmg;
          other.vx = p.facing * atk.kb;
          other.vy = -3;
          other.hitTimer = 8;
          other.grounded = false;
          effects.push({ x: other.x, y: other.y - 20, timer: 10, type: triggered });
          if (other.health <= 0) {
            other.health = 0;
            roundState = 'ko';
            roundTimer = 90;
            winner = i;
            broadcast({ type: 'ko', winner: i });
          }
        }
      }
    }

    if (p.attackTimer > 0) p.attackTimer--;

    p.vy += GRAVITY;
    p.x += p.vx;
    p.y += p.vy;

    if (p.x < 0) p.x = 0;
    if (p.x > WIDTH - PLAYER_W) p.x = WIDTH - PLAYER_W;
    if (p.y + PLAYER_H > GROUND_Y) {
      p.y = GROUND_Y - PLAYER_H;
      p.vy = 0;
      p.grounded = true;
    }

    if (p.vx !== 0) p.facing = p.vx > 0 ? 1 : -1;
  }

  // Prevent players from overlapping
  if (gameState[0].x < gameState[1].x + PLAYER_W &&
      gameState[0].x + PLAYER_W > gameState[1].x &&
      gameState[0].y < gameState[1].y + PLAYER_H &&
      gameState[0].y + PLAYER_H > gameState[1].y) {
    const overlap = (gameState[0].x + PLAYER_W / 2 + gameState[1].x + PLAYER_W / 2) / 2;
    if (gameState[0].x < gameState[1].x) {
      gameState[0].x = overlap - PLAYER_W;
      gameState[1].x = overlap;
    } else {
      gameState[0].x = overlap;
      gameState[1].x = overlap - PLAYER_W;
    }
  }

  effects = effects.filter(e => { e.timer--; return e.timer > 0; });

  broadcastState();
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (let i = 0; i < 2; i++) {
    if (clients[i] && clients[i].readyState === 1) {
      clients[i].send(msg);
    }
  }
}

function broadcastState() {
  const countdown = roundState === 'countdown' ? Math.ceil(roundTimer / 60) : 0;
  broadcast({
    type: 'state',
    players: gameState.map(p => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
      health: p.health,
      facing: p.facing,
      attackTimer: p.attackTimer,
      attackType: p.attackType,
      hitTimer: p.hitTimer,
      grounded: p.grounded
    })),
    effects: effects.map(e => ({ ...e })),
    roundState,
    countdown,
    round,
    scores,
    winner
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LAN Fighter server running on port ${PORT}`);
  console.log(`Connect at ws://<YOUR_IP>:${PORT}`);
  console.log(`Open http://<YOUR_IP>:${PORT} in browser`);
});
