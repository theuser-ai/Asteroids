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
const INVINCIBLE_TIME = 180; // frames
const RESPAWN_DELAY = 120;

// ─── Game state ───
let state = 'start'; // start | playing | gameover
let ship, asteroids, bullets, particles, score, lives, level;
let highScore = parseInt(localStorage.getItem('asteroids-highscore')) || 0;
let keys = {};
let respawnTimer = 0;
let thrustFrame = 0;

// ─── Audio ───
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

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

// ─── Resize ───
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ─── Input ───
document.addEventListener('keydown', e => {
  keys[e.code] = true;

  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (state === 'start') startGame();
    else if (state === 'gameover') startGame();
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// ─── Ship factory ───
function createShip() {
  return {
    x: canvas.width / 2,
    y: canvas.height / 2,
    angle: -Math.PI / 2,
    dx: 0,
    dy: 0,
    thrusting: false,
    invincible: INVINCIBLE_TIME,
    visible: true,
    alive: true,
  };
}

// ─── Asteroid factory ───
function createAsteroid(x, y, size) {
  const angle = Math.random() * Math.PI * 2;
  const speed = ASTEROID_SPEED * (1 + Math.random()) * (3 / size);
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
  respawnTimer = 0;
  ship = createShip();
  spawnAsteroids(4 + level);
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
}

// ─── Update ───
function update() {
  if (state !== 'playing') return;

  // Ship controls
  if (ship.alive) {
    if (keys['ArrowLeft'] || keys['KeyA']) ship.angle -= TURN_SPEED;
    if (keys['ArrowRight'] || keys['KeyD']) ship.angle += TURN_SPEED;
    ship.thrusting = keys['ArrowUp'] || keys['KeyW'];

    if (ship.thrusting) {
      ship.dx += Math.cos(ship.angle) * SHIP_THRUST;
      ship.dy += Math.sin(ship.angle) * SHIP_THRUST;
      if (thrustFrame % 3 === 0) playThrust();
    }
    thrustFrame++;

    // Fire
    if (keys['Space'] && !keys._spaceLock && bullets.length < MAX_BULLETS) {
      keys._spaceLock = true;
      const nose = getShipNose();
      bullets.push({
        x: nose.x,
        y: nose.y,
        dx: Math.cos(ship.angle) * BULLET_SPEED + ship.dx,
        dy: Math.sin(ship.angle) * BULLET_SPEED + ship.dy,
        life: BULLET_LIFE,
      });
      playShoot();
    }
    if (!keys['Space']) keys._spaceLock = false;
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

  // Collision: bullet → asteroid
  for (let i = bullets.length - 1; i >= 0; i--) {
    for (let j = asteroids.length - 1; j >= 0; j--) {
      if (dist(bullets[i].x, bullets[i].y, asteroids[j].x, asteroids[j].y) < asteroids[j].radius) {
        const a = asteroids[j];
        spawnParticles(a.x, a.y, '#fff');
        playExplosion(a.size === 3);

        // Score: big=20, medium=50, small=100
        const points = a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
        score += points;

        // Split
        if (a.size > 1) {
          asteroids.push(createAsteroid(a.x, a.y, a.size - 1));
          asteroids.push(createAsteroid(a.x, a.y, a.size - 1));
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
      if (dist(ship.x, ship.y, asteroids[i].x, asteroids[i].y) < asteroids[i].radius + SHIP_SIZE * 0.6) {
        destroyShip();
        break;
      }
    }
  }

  // Next level
  if (asteroids.length === 0) {
    level++;
    spawnAsteroids(4 + level);
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

// ─── Draw ───
function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state === 'start') return;

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 4;

  // Draw ship
  if (ship.alive && ship.visible) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.beginPath();
    ctx.moveTo(SHIP_SIZE, 0);
    ctx.lineTo(-SHIP_SIZE * 0.7, -SHIP_SIZE * 0.6);
    ctx.lineTo(-SHIP_SIZE * 0.4, 0);
    ctx.lineTo(-SHIP_SIZE * 0.7, SHIP_SIZE * 0.6);
    ctx.closePath();
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Thrust flame
    if (ship.thrusting) {
      ctx.beginPath();
      const flicker = 0.7 + Math.random() * 0.6;
      ctx.moveTo(-SHIP_SIZE * 0.4, -SHIP_SIZE * 0.25);
      ctx.lineTo(-SHIP_SIZE * (0.7 + flicker * 0.5), 0);
      ctx.lineTo(-SHIP_SIZE * 0.4, SHIP_SIZE * 0.25);
      ctx.strokeStyle = '#ff6600';
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw asteroids
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
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  // Draw bullets
  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

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
}

// ─── Game loop ───
function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
