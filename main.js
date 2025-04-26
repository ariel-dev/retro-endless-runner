// Retro Endless Runner Game
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const finalScore = document.getElementById('finalScore');
const muteBtn = document.getElementById('muteBtn');
const debugBtn = document.getElementById('debugBtn');
const debugOverlay = document.getElementById('debugOverlay');
let debugMode = false;


// --- Chiptune Synth Engine --- //
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let musicPlaying = false;
let musicMuted = false;
let melodyInterval = null;
let musicTempo = 1; // 1 = normal, >1 = faster

// Song definition: [frequency (Hz), duration (ms)]
// C major scale: C5, D5, E5, F5, G5, A5, B5, C6
const C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00, B5 = 987.77, C6 = 1046.50;
// A simple, longer, and more melodic 8-bit loop (16 bars, ~8 seconds)
const melody = [
  // Phrase 1
  [C5,180],[E5,180],[G5,180],[E5,180],[F5,180],[A5,180],[G5,180],[E5,180],[0,80],
  // Phrase 2
  [D5,180],[F5,180],[A5,180],[F5,180],[G5,180],[B5,180],[A5,180],[F5,180],[0,80],
  // Bridge
  [E5,180],[G5,180],[C6,180],[B5,180],[A5,180],[G5,180],[F5,180],[E5,180],[0,80],
  // Turnaround
  [C5,180],[E5,180],[G5,180],[F5,180],[E5,180],[D5,180],[C5,360],[0,160],
  // Repeat with variation
  [C5,180],[E5,180],[G5,180],[E5,180],[F5,180],[A5,180],[G5,180],[E5,180],[0,80],
  [D5,180],[F5,180],[A5,180],[F5,180],[G5,180],[B5,180],[A5,180],[F5,180],[0,80],
  [E5,180],[G5,180],[C6,180],[B5,180],[A5,180],[G5,180],[F5,180],[E5,180],[0,80],
  [C5,180],[E5,180],[G5,180],[F5,180],[E5,180],[D5,180],[C5,720],[0,320],
];
let melodyPos = 0;

function playTone(freq, duration) {
  if (!audioCtx || musicMuted || freq === 0) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.value = 0.08;
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  setTimeout(() => {
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.04);
    osc.stop(audioCtx.currentTime + 0.05);
  }, duration - 40);
  setTimeout(() => {
    osc.disconnect();
    gain.disconnect();
  }, duration + 20);
}

function startMelodyLoop() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (melodyInterval) clearInterval(melodyInterval);
  melodyPos = 0;
  musicPlaying = true;
  function nextNote() {
    if (!musicPlaying) return;
    const [freq, baseDur] = melody[melodyPos];
    // Shorten note duration as tempo increases
    const dur = Math.max(40, Math.round(baseDur / musicTempo));
    playTone(freq, dur);
    melodyPos = (melodyPos + 1) % melody.length;
    melodyInterval = setTimeout(nextNote, dur);
  }
  nextNote();
}

function stopMelodyLoop() {
  musicPlaying = false;
  if (melodyInterval) clearTimeout(melodyInterval);
  melodyInterval = null;
}

function toggleMute() {
  musicMuted = !musicMuted;
  muteBtn.textContent = musicMuted ? 'SOUND OFF' : 'SOUND ON';
  muteBtn.blur(); // Remove focus from button
}


const GAME_WIDTH = canvas.width;
const GAME_HEIGHT = canvas.height;

// Game state
let running = false;
let player, obstacles, score, speed, gravity, jumpPower, minObstacleGap, obstacleGapCounter;
let jumpBuffer = 0;
const JUMP_BUFFER_TIME = 6; // frames (about 100ms at 60fps)

function resetGame() {
  player = {
    x: 40,
    y: GAME_HEIGHT - 48,
    w: 24,
    h: 24,
    vy: 0,
    onGround: true
  };
  obstacles = [];
  score = 0;
  speed = 4;
  gravity = 1.1;
  jumpPower = -15;
  minObstacleGap = calcMinObstacleGap(speed, gravity, jumpPower); // Dynamic gap
  obstacleGapCounter = minObstacleGap;
  jumpBuffer = 0;
  musicTempo = 1;
}

// Calculate the minimum safe gap based on jump physics and speed
function calcMinObstacleGap(speed, gravity, jumpPower) {
  // Time in air: t = (-2 * jumpPower) / gravity
  const jumpTime = Math.abs((2 * jumpPower) / gravity);
  // Horizontal distance covered while in air
  const jumpDistance = speed * jumpTime;
  // Add a buffer for reaction time (e.g. 30px)
  return Math.max(100, Math.floor(jumpDistance + 30));
}

function drawBackground() {
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  // Ground
  ctx.fillStyle = '#444';
  ctx.fillRect(0, GAME_HEIGHT - 24, GAME_WIDTH, 24);
  // Sky stripes
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#333' : '#222';
    ctx.fillRect(0, i * 40, GAME_WIDTH, 20);
  }
}

function drawPlayer() {
  // Retro pixel character (simple rectangle)
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(player.x, player.y, player.w, player.h);
  // Eyes
  ctx.fillStyle = '#222';
  ctx.fillRect(player.x + 16, player.y + 8, 4, 4);
}

function drawObstacles() {
  ctx.fillStyle = '#e74c3c';
  obstacles.forEach(ob => {
    ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
  });
}

function drawScore() {
  ctx.font = '16px monospace';
  ctx.fillStyle = '#fff';
  ctx.fillText('SCORE: ' + score, 16, 28);
}

function spawnObstacle() {
  const height = 24 + Math.floor(Math.random() * 24);
  obstacles.push({
    x: GAME_WIDTH,
    y: GAME_HEIGHT - 24 - height,
    w: 20,
    h: height
  });
  obstacleGapCounter = 0;
}

function updateGame() {
  // Music tempo increases slower than speed (2x tempo at 4x speed)
  musicTempo = Math.sqrt(speed / 4);

  // Player physics
  player.vy += gravity;
  player.y += player.vy;
  if (player.y >= GAME_HEIGHT - 48) {
    player.y = GAME_HEIGHT - 48;
    player.vy = 0;
    if (!player.onGround && jumpBuffer > 0) {
      // Buffer jump: if jump was pressed just before landing, jump now
      player.vy = jumpPower;
      jumpBuffer = 0;
      player.onGround = false;
    } else {
      player.onGround = true;
    }
  } else {
    player.onGround = false;
  }

  // Decrease jump buffer
  if (jumpBuffer > 0) jumpBuffer--;

  // Move obstacles
  for (let ob of obstacles) {
    ob.x -= speed;
  }
  // Remove off-screen obstacles
  obstacles = obstacles.filter(ob => ob.x + ob.w > 0);

  // Dynamically update minObstacleGap for current speed
  minObstacleGap = calcMinObstacleGap(speed, gravity, jumpPower);
  // Control obstacle spawning with minimum gap
  if (obstacleGapCounter < minObstacleGap) {
    obstacleGapCounter += speed;
  } else {
    // More obstacles at lower speeds
    let baseProb = (speed < 8) ? 0.045 : 0.025;
    if (Math.random() < baseProb + speed * 0.002) {
      // Check last obstacle position
      if (
        obstacles.length === 0 ||
        (GAME_WIDTH - (obstacles[obstacles.length - 1].x + obstacles[obstacles.length - 1].w)) >= minObstacleGap
      ) {
        spawnObstacle();
      }
    }
  }

  // Collision detection
  for (let ob of obstacles) {
    if (
      player.x < ob.x + ob.w &&
      player.x + player.w > ob.x &&
      player.y < ob.y + ob.h &&
      player.y + player.h > ob.y
    ) {
      endGame();
      return;
    }
  }

  // Increase score and speed
  score++;
  if (score % 150 === 0) speed += 0.5;
}

// FPS calculation
let lastFrameTime = performance.now();
let fps = 60;

function renderGame() {
  // FPS calculation
  const now = performance.now();
  fps = Math.round(1000 / (now - lastFrameTime));
  lastFrameTime = now;

  drawBackground();
  drawPlayer();
  drawObstacles();
  drawScore();

  // Debug overlay
  if (debugMode) {
    debugOverlay.innerHTML = `
      <b>DEBUG INFO</b><br>
      FPS: <span style="color:#ffd700">${fps}</span><br>
      Speed: <span style="color:#ffd700">${speed.toFixed(2)}</span><br>
      Music Tempo: <span style="color:#ffd700">${musicTempo.toFixed(2)}</span>
    `;
    debugOverlay.style.display = 'block';
  } else {
    debugOverlay.style.display = 'none';
  }
}


function gameLoop() {
  if (!running) return;
  updateGame();
  renderGame();
  requestAnimationFrame(gameLoop);
}

function startGame() {
  resetGame();
  running = true;
  startScreen.style.display = 'none';
  gameOverScreen.style.display = 'none';
  // Always restart the melody loop to sync with game speed
  stopMelodyLoop();
  if (!musicMuted) {
    startMelodyLoop();
  }
  gameLoop();
}

function endGame() {
  running = false;
  finalScore.textContent = `Your Score: ${score}`;
  gameOverScreen.style.display = 'flex';
  stopMelodyLoop();
}

// Music mute/unmute
muteBtn.onclick = function() {
  toggleMute();
  muteBtn.blur(); // Remove focus from button
};

// Debug toggle
debugBtn.onclick = () => {
  debugMode = !debugMode;
  debugOverlay.style.display = debugMode ? 'block' : 'none';
  debugBtn.blur(); // Remove focus from button
};

// Controls
window.addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'ArrowUp') && running) {
    if (player.onGround) {
      player.vy = jumpPower;
    } else {
      jumpBuffer = JUMP_BUFFER_TIME;
    }
  }
  if (e.code === 'Enter' && !running) {
    startGame();
  }
});
startBtn.onclick = startGame;
restartBtn.onclick = startGame;

// Initial render
renderGame();

// Set mute button icon on load
muteBtn.textContent = musicMuted ? '🔇' : '🔊';
