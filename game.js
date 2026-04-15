// ─── ASTEROIDS ─── Retro vector-style arcade game ───

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const levelEl = document.getElementById('level');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreEl = document.getElementById('final-score');
const highScoreEl = document.getElementById('high-score');

// ─── Constants ───
const FPS = 60;
const SHIP_SIZE = 20;
const SHIP_THRUST = 0.12;
const SHIP_FRICTION = 0.99;
const TURN_SPEED = 0.07;
const BULLET_SPEED = 8;
const BULLET_LIFE = 55;
const MAX_BULLETS = 8;
const ASTEROID_SPEED = 1.5;
const ASTEROID_VERTICES = 10;
const ASTEROID_JAG = 0.35;
const PARTICLE_COUNT = 8;
const INVINCIBLE_TIME = 180;
const RESPAWN_DELAY = 120;
const FIRE_COOLDOWN = 12;       // frames between shots (normal)
const RAPIDFIRE_COOLDOWN = 4;   // frames between shots (rapid fire)
const POWERUP_DURATION = 480;   // 8 seconds at 60fps
const POWERUP_SPAWN_CHANCE = 0.3;
const POWERUP_TYPES = ['shield', 'doubleshot', 'rapidfire'];

// ─── Mobile difficulty tuning ───
const MOBILE_SPEED_MULT   = 0.7;   // 30% slower asteroids
const MOBILE_ASTEROID_MULT = 0.65; // ~35% fewer asteroids (stacks with existing 0.8)
const MOBILE_INVINCIBLE    = 320;  // longer invincibility after respawn

// ─── Game state ───
let state = 'start';
let ship, asteroids, bullets, particles, powerups, score, lives, level;
let activePowerups = {};   // { shield: framesLeft, doubleshot: framesLeft, rapidfire: framesLeft }
let highScore = parseInt(localStorage.getItem('asteroids-highscore')) || 0;
let keys = {};
let respawnTimer = 0;
let thrustFrame = 0;
let fireCooldown = 0;

// ─── Audio ───
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// iOS requires a silent buffer played inside a direct touch handler to unlock audio
function unlockAudio() {
  const ctx = getAudioCtx();
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  document.removeEventListener('touchstart', unlockAudio);
  document.removeEventListener('keydown', unlockAudio);
}
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('keydown',    unlockAudio, { once: true });

function playShoot() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.1);
}

function playExplosion(large) {
  const ctx = getAudioCtx();
  const bufferSize = ctx.sampleRate * (large ? 0.6 : 0.3);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(large ? 400 : 800, ctx.currentTime);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(large ? 0.8 : 0.5, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (large ? 0.6 : 0.3));
  source.start(ctx.currentTime);
}

function playThrust() {
  const ctx = getAudioCtx();
  const bufferSize = ctx.sampleRate * 0.05;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 120;
  source.connect(filter);
  filter.connect(ctx.destination);
  source.start(ctx.currentTime);
}

function playPowerup() {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.1);
  osc.frequency.linearRampToValueAtTime(1320, ctx.currentTime + 0.2);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
}

// ─── Resize ───
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ─── Detect touch/mobile device ───
const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

// Set start prompt text based on device
function updatePrompts() {
  const msg = isTouchDevice() ? 'TAP TO START' : 'PRESS ENTER TO START';
  const again = isTouchDevice() ? 'TAP TO PLAY AGAIN' : 'PRESS ENTER TO PLAY AGAIN';
  document.querySelectorAll('.start-prompt').forEach((el, i) => {
    el.textContent = i === 0 ? msg : again;
  });
}
updatePrompts();
window.addEventListener('resize', updatePrompts);

// ─── Input ───
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (state === 'start') startGame();
    else if (state === 'gameover') startGame();
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// Tap on start/gameover screens
document.getElementById('start-screen').addEventListener('touchend', e => {
  e.preventDefault();
  if (state === 'start') startGame();
});
document.getElementById('game-over-screen').addEventListener('touchend', e => {
  e.preventDefault();
  if (state === 'gameover') startGame();
});

// ─── Virtual Joystick ───
const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
const JOYSTICK_MAX  = 42; // max knob travel in px
const JOYSTICK_DEAD = 12; // dead zone in px

let joystickTouchId = null;
let joystickOrigin  = { x: 0, y: 0 };
let joystickState   = { active: false, angle: 0, magnitude: 0 };

function joystickApply(dx, dy) {
  const magnitude = Math.sqrt(dx * dx + dy * dy);
  const clampedX = magnitude > JOYSTICK_MAX ? dx / magnitude * JOYSTICK_MAX : dx;
  const clampedY = magnitude > JOYSTICK_MAX ? dy / magnitude * JOYSTICK_MAX : dy;
  joystickKnob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
  joystickState.active    = magnitude > JOYSTICK_DEAD;
  joystickState.magnitude = magnitude;
  joystickState.angle     = Math.atan2(dy, dx);
}

function joystickReset() {
  joystickState.active = false;
  joystickKnob.style.transform = 'translate(0,0)';
  joystickTouchId = null;
}

joystickZone.addEventListener('touchstart', e => {
  e.preventDefault();
  if (joystickTouchId !== null) return;
  const t = e.changedTouches[0];
  joystickTouchId = t.identifier;
  joystickOrigin  = { x: t.clientX, y: t.clientY };
}, { passive: false });

joystickZone.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== joystickTouchId) continue;
    const dx = t.clientX - joystickOrigin.x;
    const dy = t.clientY - joystickOrigin.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > JOYSTICK_MAX) {
      joystickApply(dx / len * JOYSTICK_MAX, dy / len * JOYSTICK_MAX);
    } else {
      joystickApply(dx, dy);
    }
  }
}, { passive: false });

joystickZone.addEventListener('touchend',    e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === joystickTouchId) joystickReset(); }, { passive: false });
joystickZone.addEventListener('touchcancel', e => { joystickReset(); });

// Fire button
const btnFire = document.getElementById('btn-fire');
btnFire.addEventListener('touchstart', e => { e.preventDefault(); keys['Space'] = true;  btnFire.classList.add('pressed'); }, { passive: false });
btnFire.addEventListener('touchend',   e => { e.preventDefault(); keys['Space'] = false; btnFire.classList.remove('pressed'); }, { passive: false });
btnFire.addEventListener('touchcancel',e => { keys['Space'] = false; btnFire.classList.remove('pressed'); });

// ─── Ship factory ───
function createShip() {
  return {
    x: canvas.width / 2,
    y: canvas.height / 2,
    angle: -Math.PI / 2,
    dx: 0,
    dy: 0,
    thrusting: false,
    invincible: isTouchDevice() ? MOBILE_INVINCIBLE : INVINCIBLE_TIME,
    visible: true,
    alive: true,
  };
}

// ─── Asteroid factory ───
function createAsteroid(x, y, size) {
  const angle = Math.random() * Math.PI * 2;
  const mobileMult = isTouchDevice() ? MOBILE_SPEED_MULT : 1;
  const speed = ASTEROID_SPEED * mobileMult * (1 + Math.random()) * (3 / size);
  const offsets = [];
  for (let i = 0; i < ASTEROID_VERTICES; i++) {
    offsets.push(1 + Math.random() * ASTEROID_JAG * 2 - ASTEROID_JAG);
  }
  return { x, y, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, size, radius: size * 15, offsets };
}

function spawnAsteroids(count) {
  for (let i = 0; i < count; i++) {
    let x, y;
    do {
      x = Math.random() * canvas.width;
      y = Math.random() * canvas.height;
    } while (dist(x, y, ship.x, ship.y) < 200);
    asteroids.push(createAsteroid(x, y, 3));
  }
}

// ─── Power-ups ───
function createPowerup(x, y) {
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  return {
    x, y,
    type,
    angle: 0,
    dx: (Math.random() - 0.5) * 0.8,
    dy: (Math.random() - 0.5) * 0.8,
    pulse: 0,
  };
}

const POWERUP_COLORS = { shield: '#00ffaa', doubleshot: '#ffcc00', rapidfire: '#ff4466' };
const POWERUP_LABELS = { shield: 'S', doubleshot: '»', rapidfire: '⚡' };

// ─── Particles ───
function spawnParticles(x, y, color) {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    particles.push({
      x, y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      life: 30 + Math.random() * 20,
      maxLife: 50,
      color: color || '#fff',
    });
  }
}

// ─── Utility ───
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function wrap(obj) {
  if (obj.x < -20) obj.x = canvas.width + 20;
  if (obj.x > canvas.width + 20) obj.x = -20;
  if (obj.y < -20) obj.y = canvas.height + 20;
  if (obj.y > canvas.height + 20) obj.y = -20;
}

// ─── Start game ───
function startGame() {
  state = 'playing';
  score = 0;
  lives = 3;
  level = 1;
  bullets = [];
  asteroids = [];
  particles = [];
  powerups = [];
  activePowerups = {};
  fireCooldown = 0;
  respawnTimer = 0;
  ship = createShip();
  const mult = isTouchDevice() ? MOBILE_ASTEROID_MULT : 0.8;
  spawnAsteroids(Math.round((4 + level) * mult));
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
}

// ─── Update ───
function update() {
  if (state !== 'playing') return;

  // Tick active power-up timers
  for (const type in activePowerups) {
    activePowerups[type]--;
    if (activePowerups[type] <= 0) delete activePowerups[type];
  }

  // Ship controls
  if (ship.alive) {
    if (joystickState.active) {
      // Joystick: direct angle + auto-thrust
      ship.angle     = joystickState.angle;
      ship.thrusting = true;
    } else {
      if (keys['ArrowLeft'] || keys['KeyA']) ship.angle -= TURN_SPEED;
      if (keys['ArrowRight'] || keys['KeyD']) ship.angle += TURN_SPEED;
      ship.thrusting = keys['ArrowUp'] || keys['KeyW'];
    }

    if (ship.thrusting) {
      ship.dx += Math.cos(ship.angle) * SHIP_THRUST;
      ship.dy += Math.sin(ship.angle) * SHIP_THRUST;
      if (thrustFrame % 3 === 0) playThrust();
    }
    thrustFrame++;

    // Fire (cooldown-based, supports rapid fire)
    if (fireCooldown > 0) fireCooldown--;
    const cooldown = activePowerups.rapidfire ? RAPIDFIRE_COOLDOWN : FIRE_COOLDOWN;
    if (keys['Space'] && fireCooldown <= 0 && bullets.length < MAX_BULLETS) {
      fireCooldown = cooldown;
      const nose = getShipNose();
      if (activePowerups.doubleshot) {
        // Two bullets spread slightly apart
        [-0.08, 0.08].forEach(spread => {
          bullets.push({
            x: nose.x, y: nose.y,
            dx: Math.cos(ship.angle + spread) * BULLET_SPEED + ship.dx,
            dy: Math.sin(ship.angle + spread) * BULLET_SPEED + ship.dy,
            life: BULLET_LIFE,
          });
        });
      } else {
        bullets.push({
          x: nose.x, y: nose.y,
          dx: Math.cos(ship.angle) * BULLET_SPEED + ship.dx,
          dy: Math.sin(ship.angle) * BULLET_SPEED + ship.dy,
          life: BULLET_LIFE,
        });
      }
      playShoot();
    }
  }

  // Ship physics
  if (ship.alive) {
    ship.dx *= SHIP_FRICTION;
    ship.dy *= SHIP_FRICTION;
    ship.x += ship.dx;
    ship.y += ship.dy;
    wrap(ship);

    if (ship.invincible > 0) {
      ship.invincible--;
      ship.visible = Math.floor(ship.invincible / 6) % 2 === 0;
    } else {
      ship.visible = true;
    }
  }

  // Respawn
  if (!ship.alive) {
    respawnTimer--;
    if (respawnTimer <= 0) {
      if (lives > 0) {
        ship = createShip();
      } else {
        endGame();
      }
    }
  }

  // Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.dx;
    b.y += b.dy;
    b.life--;
    wrap(b);
    if (b.life <= 0) bullets.splice(i, 1);
  }

  // Asteroids
  for (const a of asteroids) {
    a.x += a.dx;
    a.y += a.dy;
    wrap(a);
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.dx;
    p.y += p.dy;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // Power-ups: move + pulse + pickup
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    pu.x += pu.dx;
    pu.y += pu.dy;
    pu.angle += 0.03;
    pu.pulse = (pu.pulse + 0.08) % (Math.PI * 2);
    wrap(pu);
    if (ship.alive && dist(ship.x, ship.y, pu.x, pu.y) < 22) {
      activePowerups[pu.type] = POWERUP_DURATION;
      powerups.splice(i, 1);
      playPowerup();
      spawnParticles(pu.x, pu.y, POWERUP_COLORS[pu.type]);
    }
  }

  // Collision: bullet → asteroid
  for (let i = bullets.length - 1; i >= 0; i--) {
    for (let j = asteroids.length - 1; j >= 0; j--) {
      if (dist(bullets[i].x, bullets[i].y, asteroids[j].x, asteroids[j].y) < asteroids[j].radius) {
        const a = asteroids[j];
        spawnParticles(a.x, a.y, '#fff');
        playExplosion(a.size === 3);

        const points = a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
        score += points;

        if (a.size > 1) {
          asteroids.push(createAsteroid(a.x, a.y, a.size - 1));
          asteroids.push(createAsteroid(a.x, a.y, a.size - 1));
        }

        // Chance to drop a power-up
        if (Math.random() < POWERUP_SPAWN_CHANCE) {
          powerups.push(createPowerup(a.x, a.y));
        }

        asteroids.splice(j, 1);
        bullets.splice(i, 1);
        break;
      }
    }
  }

  // Collision: ship → asteroid
  if (ship.alive && ship.invincible <= 0) {
    for (let i = asteroids.length - 1; i >= 0; i--) {
      if (dist(ship.x, ship.y, asteroids[i].x, asteroids[i].y) < asteroids[i].radius + SHIP_SIZE * 0.35) {
        if (activePowerups.shield) {
          // Shield absorbs the hit
          delete activePowerups.shield;
          spawnParticles(ship.x, ship.y, '#00ffaa');
          ship.invincible = 60;
        } else {
          destroyShip();
        }
        break;
      }
    }
  }

  // Next level
  if (asteroids.length === 0) {
    level++;
    const mult = isTouchDevice() ? MOBILE_ASTEROID_MULT : 0.8;
    spawnAsteroids(Math.round((4 + level) * mult));
  }

  // UI
  scoreEl.textContent = score;
  livesEl.textContent = '▲'.repeat(lives);
  levelEl.textContent = 'LEVEL ' + level;
}

function getShipNose() {
  return {
    x: ship.x + Math.cos(ship.angle) * SHIP_SIZE,
    y: ship.y + Math.sin(ship.angle) * SHIP_SIZE,
  };
}

function destroyShip() {
  ship.alive = false;
  lives--;
  respawnTimer = RESPAWN_DELAY;
  spawnParticles(ship.x, ship.y, '#ff4444');
  spawnParticles(ship.x, ship.y, '#ffaa00');
  playExplosion(true);
}

function endGame() {
  state = 'gameover';
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('asteroids-highscore', highScore);
  }
  finalScoreEl.textContent = 'SCORE: ' + score;
  highScoreEl.textContent = 'HIGH SCORE: ' + highScore;
  gameOverScreen.classList.remove('hidden');
}

// ─── Draw ship (modern fighter) ───
function drawShip() {
  if (!ship.alive || !ship.visible) return;

  const S = SHIP_SIZE;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  // Shield bubble
  if (activePowerups.shield) {
    const pulse = Math.sin(Date.now() * 0.005) * 0.3 + 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, S * 1.8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0,255,170,${pulse})`;
    ctx.shadowColor = '#00ffaa';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Engine glow
  if (ship.thrusting) {
    const flicker = 0.8 + Math.random() * 0.7;
    const engineGrad = ctx.createRadialGradient(-S * 0.85, 0, 0, -S * 0.85, 0, S * flicker * 0.9);
    engineGrad.addColorStop(0, 'rgba(255,180,50,0.95)');
    engineGrad.addColorStop(0.4, 'rgba(255,80,0,0.7)');
    engineGrad.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.beginPath();
    ctx.ellipse(-S * 0.85 - S * flicker * 0.5, 0, S * flicker * 0.85, S * 0.18, 0, 0, Math.PI * 2);
    ctx.fillStyle = engineGrad;
    ctx.fill();
  }

  // Wing shadow/depth
  ctx.shadowColor = '#0088ff';
  ctx.shadowBlur = 18;

  // Left wing
  ctx.beginPath();
  ctx.moveTo(S * 0.05, -S * 0.18);
  ctx.lineTo(-S * 0.35, -S * 0.95);
  ctx.lineTo(-S * 0.75, -S * 0.75);
  ctx.lineTo(-S * 0.55, -S * 0.12);
  ctx.closePath();
  const wingGradL = ctx.createLinearGradient(-S * 0.35, -S * 0.95, -S * 0.55, -S * 0.12);
  wingGradL.addColorStop(0, '#003a6e');
  wingGradL.addColorStop(1, '#0055aa');
  ctx.fillStyle = wingGradL;
  ctx.fill();
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Right wing
  ctx.beginPath();
  ctx.moveTo(S * 0.05, S * 0.18);
  ctx.lineTo(-S * 0.35, S * 0.95);
  ctx.lineTo(-S * 0.75, S * 0.75);
  ctx.lineTo(-S * 0.55, S * 0.12);
  ctx.closePath();
  const wingGradR = ctx.createLinearGradient(-S * 0.35, S * 0.95, -S * 0.55, S * 0.12);
  wingGradR.addColorStop(0, '#003a6e');
  wingGradR.addColorStop(1, '#0055aa');
  ctx.fillStyle = wingGradR;
  ctx.fill();
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Main fuselage
  ctx.beginPath();
  ctx.moveTo(S * 1.2, 0);
  ctx.lineTo(S * 0.35, -S * 0.28);
  ctx.lineTo(-S * 0.2, -S * 0.22);
  ctx.lineTo(-S * 0.85, -S * 0.12);
  ctx.lineTo(-S, 0);
  ctx.lineTo(-S * 0.85, S * 0.12);
  ctx.lineTo(-S * 0.2, S * 0.22);
  ctx.lineTo(S * 0.35, S * 0.28);
  ctx.closePath();
  const hullGrad = ctx.createLinearGradient(-S, 0, S * 1.2, 0);
  hullGrad.addColorStop(0, '#002244');
  hullGrad.addColorStop(0.5, '#005599');
  hullGrad.addColorStop(1, '#0088dd');
  ctx.fillStyle = hullGrad;
  ctx.fill();
  ctx.strokeStyle = '#33ccff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cockpit
  ctx.shadowBlur = 8;
  ctx.shadowColor = '#aaeeff';
  ctx.beginPath();
  ctx.ellipse(S * 0.42, 0, S * 0.28, S * 0.14, 0, 0, Math.PI * 2);
  const cockpitGrad = ctx.createRadialGradient(S * 0.35, -S * 0.05, 0, S * 0.42, 0, S * 0.28);
  cockpitGrad.addColorStop(0, 'rgba(180,240,255,0.95)');
  cockpitGrad.addColorStop(0.5, 'rgba(80,180,255,0.7)');
  cockpitGrad.addColorStop(1, 'rgba(0,80,160,0.5)');
  ctx.fillStyle = cockpitGrad;
  ctx.fill();

  // Hull detail lines
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(100,200,255,0.4)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(S * 0.1, -S * 0.15);
  ctx.lineTo(-S * 0.6, -S * 0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(S * 0.1, S * 0.15);
  ctx.lineTo(-S * 0.6, S * 0.08);
  ctx.stroke();

  ctx.restore();
}

// ─── Draw power-up item ───
function drawPowerup(pu) {
  const color = POWERUP_COLORS[pu.type];
  const label = POWERUP_LABELS[pu.type];
  const pulse = Math.sin(pu.pulse) * 3;

  ctx.save();
  ctx.translate(pu.x, pu.y);
  ctx.rotate(pu.angle);
  ctx.shadowColor = color;
  ctx.shadowBlur = 12 + pulse;

  // Hexagon
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
    const r = 13 + pulse * 0.3;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = `rgba(0,0,0,0.5)`;
  ctx.fill();

  // Label
  ctx.rotate(-pu.angle); // keep label upright
  ctx.fillStyle = color;
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);

  ctx.restore();
}

// ─── Draw active power-up HUD ───
function drawPowerupHUD() {
  let x = 12;
  const y = canvas.height - 18;
  for (const type in activePowerups) {
    const color = POWERUP_COLORS[type];
    const remaining = activePowerups[type] / POWERUP_DURATION;
    ctx.fillStyle = color;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(POWERUP_LABELS[type], x, y - 14);
    // Bar
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x, y - 6, 50, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 6, 50 * remaining, 5);
    x += 65;
  }
}

// ─── Draw ───
function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state === 'start') return;

  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 4;

  // Draw ship
  drawShip();

  // Draw bullets
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = activePowerups.doubleshot ? '#ffcc00' : '#fff';
    ctx.shadowColor = activePowerups.doubleshot ? '#ffcc00' : '#aaeeff';
    ctx.shadowBlur = 8;
    ctx.fill();
  }

  // Draw asteroids
  ctx.shadowColor = '#aaa';
  ctx.shadowBlur = 3;
  for (const a of asteroids) {
    ctx.beginPath();
    for (let i = 0; i < ASTEROID_VERTICES; i++) {
      const angle = (i / ASTEROID_VERTICES) * Math.PI * 2;
      const r = a.radius * a.offsets[i];
      const px = a.x + Math.cos(angle) * r;
      const py = a.y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Draw power-ups
  ctx.shadowBlur = 0;
  for (const pu of powerups) drawPowerup(pu);

  // Draw particles
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.shadowBlur = 0;
  drawPowerupHUD();
}

// ─── Game loop ───
function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
