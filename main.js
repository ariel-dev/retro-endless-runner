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
const fullscreenBtn = document.getElementById('fullscreenBtn');
// Hide fullscreen button on iOS devices (iPhone/iPad)
if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
  fullscreenBtn.style.display = 'none';
}
const storyScreen = document.getElementById('storyScreen');
const storyNextBtn = document.getElementById('storyNextBtn');
const zombieOverlay = document.getElementById('zombieOverlay');
let debugMode = false;

// --- Chiptune Synth Engine --- //
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let musicPlaying = false;
let musicMuted = false;
let melodyLoopTimeoutId = null; // Use a clearer name for the timeout ID
let musicTempo = 1.8; // Faster island tempo by default

// --- Pitch Shifting State ---
let pitchShiftState = 0; // 0: normal, 1: up, 2: normal, 3: down
let pitchMultiplier = 1.0; // Current frequency multiplier
let fullLoopCounter = 0; // Counts full melody loops completed
const loopsPerPitchShift = 4; // Shift pitch every 4 full loops (4 * 4 bars = 16 bars)
const semitoneUpMultiplier = Math.pow(2, 1/12);
const semitoneDownMultiplier = Math.pow(2, -1/12);
let currentMelodyIndex = 0; // Index within the melody array

// Song definition: [frequency (Hz), duration (ms)]
// C major scale: C5, D5, E5, F5, G5, A5, B5, C6
// Melody notes
const C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00, B5 = 987.77, C6 = 1046.50;
// Bb5 and Ab5 and chromatic steps
const Bb5 = 932.33, Ab5 = 830.61, F5s = 739.99, G5s = 830.61, A5s = 932.33;
// 808 Bass notes
const C2 = 65.41, D2 = 73.42, E2 = 82.41, G2 = 98.00, A2 = 110.00, C3 = 130.81;
// [bass, melody, duration] (if either is 0, it's a rest)
const melody = [
  // Bar 1
  [C2, C5, 90],[0,0,60],[G2, G5, 90],[0,0,60],[C2, C5, 90],[0,0,60],[G2, G5, 90],[0,0,60],
  // Bar 2
  [E2, E5, 90],[0,0,60],[A2, A5, 90],[0,0,60],[E2, E5, 90],[0,0,60],[A2, A5, 90],[0,0,60],
  // Bar 3
  [G2, G5, 90],[0,0,60],[C3, C6, 90],[0,0,60],[G2, G5, 90],[0,0,60],[C3, C6, 90],[0,0,60],
  // Bar 4
  [E2, E5, 90],[0,0,60],[G2, G5, 90],[0,0,60],[C2, C5, 90],[0,0,60],[E2, E5, 90],[0,0,60],
  // Repeat (loop)
];

// --- Pitch Shifting Logic ---
// Checks if enough full loops have passed and updates the global pitch state/multiplier.
function updatePitchMultiplierIfNeeded() {
    // This is called ONLY when a full melody loop completes (index wraps to 0).
    if (fullLoopCounter >= loopsPerPitchShift) {
        fullLoopCounter = 0; // Reset the loop counter

        // Advance the pitch state (0 -> 1 -> 2 -> 3 -> 0)
        pitchShiftState = (pitchShiftState + 1) % 4;

        // Update the global multiplier based on the new state.
        // This new multiplier will be used starting from the next note played.
        switch(pitchShiftState) {
            case 0: pitchMultiplier = 1.0; break;
            case 1: pitchMultiplier = semitoneUpMultiplier; break;
            case 2: pitchMultiplier = 1.0; break;
            case 3: pitchMultiplier = semitoneDownMultiplier; break;
        }
        // console.log(`Pitch Shift! State: ${pitchShiftState}, New Multiplier: ${pitchMultiplier.toFixed(4)}`);
    }
}

function playTone(freq, duration) {
  if (!audioCtx || musicMuted || freq === 0) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  // 808-style bass for low notes (≤150Hz)
  if (freq <= 150) {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 2, audioCtx.currentTime); // Start an octave up
    osc.frequency.linearRampToValueAtTime(freq, audioCtx.currentTime + 0.04); // Drop to bass
    gain.gain.value = 0.18;
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration / 700); // Long decay
  } else {
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
  }

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
  // Resume context if suspended (mobile browsers require user gesture)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(err => console.warn('AudioContext resume failed:', err));
  }
  if (melodyLoopTimeoutId) clearTimeout(melodyLoopTimeoutId); // Clear previous timeout

  // Reset state variables when the loop starts
  currentMelodyIndex = 0;
  fullLoopCounter = 0;
  pitchShiftState = 0;
  pitchMultiplier = 1.0;

  musicPlaying = true;

  // Inner function to schedule and play the next note
  function scheduleNextNote() {
    if (!musicPlaying) return; // Exit if music has been stopped

    // 1. Get current note details
    const [bassFreq, melodyFreq, baseDur] = melody[currentMelodyIndex];

    // 2. Apply the CURRENT pitch multiplier
    const multiplier = pitchMultiplier; // Use the multiplier determined previously
    const shiftedBass = bassFreq ? bassFreq * multiplier : 0;
    const shiftedMelody = melodyFreq ? melodyFreq * multiplier : 0;

    // 3. Calculate duration based on game tempo
    const dur = Math.max(40, Math.round(baseDur / musicTempo));

    // 4. Play the (potentially shifted) notes
    if (shiftedBass) playTone(shiftedBass, dur);
    if (shiftedMelody) playTone(shiftedMelody, dur);

    // 5. Advance the melody index for the next note
    currentMelodyIndex = (currentMelodyIndex + 1) % melody.length;

    // 6. Check if a full loop was just completed
    if (currentMelodyIndex === 0) {
      fullLoopCounter++; // Increment the full loop counter
      updatePitchMultiplierIfNeeded(); // Check and potentially update the multiplier for the next loop
    }

    // 7. Schedule the next call to this function
    melodyLoopTimeoutId = setTimeout(scheduleNextNote, dur);
  }

  // Start the scheduling loop
  scheduleNextNote();
}

function stopMelodyLoop() {
  musicPlaying = false;
  if (melodyLoopTimeoutId) clearTimeout(melodyLoopTimeoutId);
  melodyLoopTimeoutId = null;
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

// Plane event system
let planeActive = false;
let planeType = 0; // 0: prop, 1: small jet, 2: airliner, 3: fighter
let planeX = 0, planeY = 0, planeSpeed = 0;
let nextPlaneScore = 400;
let planeCount = 0; // NEW: Track how many planes have appeared
const PLANE_TYPES = [
  { name: 'prop', speed: 3, width: 60, height: 18, color: '#b22222', y: 80 },
  { name: 'smalljet', speed: 6, width: 48, height: 16, color: '#1e90ff', y: 70 },
  { name: 'airliner', speed: 9, width: 80, height: 24, color: '#e0e0e0', y: 60 },
  { name: 'fighter', speed: 15, width: 36, height: 12, color: '#444', y: 50 }
];

// Help speech configuration
const helpPhrases = [
  'Help down here!',
  'I need help!',
  'Zombies ahead!',
  'Hold on!!',
  'Watch out!',
  'Look out!',
  'Help!',
  'Please!'
];
let speechVisible = false;
let currentHelpPhrase = '';
let speechTimerId = null;

function resetGame() {
  console.debug('resetGame: resetting game state');
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
  console.debug('resetGame: speed set to', speed);
  gravity = 1.1;
  jumpPower = -15;
  minObstacleGap = calcMinObstacleGap(speed, gravity, jumpPower); // Dynamic gap
  obstacleGapCounter = minObstacleGap;
  jumpBuffer = 0;
  musicTempo = 1;

  // Plane system reset
  planeActive = false;
  planeType = 0;
  nextPlaneScore = 200; // Match starting value for immediate plane spawn
  planeCount = 0; // Reset plane count

  // Reset biome state
  currentBiome = 0;
  biomeTransition = 0;
  initBackgroundElements();
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

// Background scenery configuration
const BIOMES = [
  {
    name: 'forest',
    groundColor: '#3b2d1d',
    skyColor: '#4a7ab3',
    elements: [
      { type: 'cloud', color: '#ffffff', heights: [450, 500], frequency: 0.1, layer: 'back' }, // Add clouds
      { type: 'tree', color: '#0e2a0e', heights: [280, 320, 380], frequency: 0.4, layer: 'back' },
      { type: 'tree', color: '#133613', heights: [200, 240, 280], frequency: 0.35, layer: 'mid' },
      { type: 'tree', color: '#1a421a', heights: [120, 160, 200], frequency: 0.3, layer: 'front' }
    ]
  },
  {
    name: 'mountains',
    groundColor: '#4d4d4d',
    skyColor: '#6b88a5',
    elements: [
      { type: 'cloud', color: '#f0f0f0', heights: [500, 550], frequency: 0.15, layer: 'back' }, // Add clouds
      { type: 'mountain', color: '#333333', heights: [350, 400, 450], frequency: 0.25, layer: 'back' },
      { type: 'mountain', color: '#404040', heights: [250, 300, 350], frequency: 0.3, layer: 'mid' },
      { type: 'mountain', color: '#4d4d4d', heights: [150, 200, 250], frequency: 0.35, layer: 'front' }
    ]
  },
  {
    name: 'city',
    groundColor: '#2d2d2d',
    skyColor: '#4d576b', // Darker city sky
    elements: [
      // No clouds in default city biome
      { type: 'building', color: '#1a1a1a', heights: [380, 420, 460, 500], frequency: 0.35, layer: 'back' },
      { type: 'building', color: '#262626', heights: [280, 320, 360, 400], frequency: 0.4, layer: 'mid' },
      { type: 'building', color: '#333333', heights: [180, 220, 260, 300], frequency: 0.45, layer: 'front' }
    ]
  },
  {
    name: 'desert',
    groundColor: '#b3945f',
    skyColor: '#7ab3d9', // Bright desert sky
    elements: [
      { type: 'cloud', color: '#ffffff', heights: [480, 530], frequency: 0.05, layer: 'back' }, // Sparse clouds
      { type: 'mountain', color: '#997a47', heights: [300, 350, 400], frequency: 0.25, layer: 'back' }, // Desert mountains
      { type: 'dune', color: '#a38654', heights: [200, 250, 300], frequency: 0.35, layer: 'mid' },
      { type: 'cactus', color: '#1a3311', heights: [100, 150, 200], frequency: 0.3, layer: 'front' }
    ]
  },
  {
    name: 'island',
    groundColor: '#e6c366', // Sandy beach color
    skyColor: '#4da6ff', // Bright tropical sky
    elements: [
      { type: 'cloud', color: '#ffffff', heights: [450, 520], frequency: 0.2, layer: 'back' }, // More clouds
      { type: 'mountain', color: '#404040', heights: [320, 360, 400], frequency: 0.25, layer: 'back' }, // Volcanic-like island mountain
      { type: 'palm', color: '#0e2a0e', heights: [220, 260, 300], frequency: 0.35, layer: 'mid' },
      { type: 'rock', color: '#595959', heights: [120, 160, 200], frequency: 0.4, layer: 'front' } // Beach rocks
    ]
  }
];

let currentBiome = 0;
let biomeTransition = 0; // 0 to 1
let backgroundElements = [];
let nextBiomeElements = [];
let scrollX = 0;

const BACKGROUND_WRAP_WIDTH_FACTOR = 2.5; // Increase wrap range slightly

function generateBiomeElements(biomeIndex, xOffset = 0) {
  const biome = BIOMES[biomeIndex];
  const elements = [];
  let currentX = xOffset;
  const targetWidth = GAME_WIDTH * BACKGROUND_WRAP_WIDTH_FACTOR;

  // Generate elements across the wider range
  while (currentX < xOffset + targetWidth) {
    biome.elements.forEach(elType => {
      if (Math.random() < elType.frequency) {
        const heightIndex = Math.floor(Math.random() * elType.heights.length);
        const height = elType.heights[heightIndex];
        const heightVariation = (Math.random() - 0.5) * height * 0.15;
        elements.push({
          x: currentX,
          height: height + heightVariation,
          type: elType.type,
          color: elType.color,
          layer: elType.layer,
          opacity: 0 // Start faded for transition
        });
        // Add biome-unique details for visual interest
        if (biome.name === 'mountains') {
          // Add clouds
          for (let i = 0; i < 3; i++) {
            elements.push({
              x: Math.random() * GAME_WIDTH * 2,
              height: 40 + Math.random() * 30,
              type: 'cloud',
              color: '#e0e6ed',
              layer: 'back',
              opacity: 0
            });
          }
        }
        if (biome.name === 'forest') {
          // Add birds
          for (let i = 0; i < 2; i++) {
            elements.push({
              x: Math.random() * GAME_WIDTH * 2,
              height: 20,
              type: 'bird',
              color: '#222',
              layer: 'mid',
              opacity: 0
            });
          }
        }
        if (biome.name === 'island') {
          // Add boats
          for (let i = 0; i < 2; i++) {
            elements.push({
              x: Math.random() * GAME_WIDTH * 2,
              height: 16,
              type: 'boat',
              color: '#a0522d',
              layer: 'front',
              opacity: 0
            });
          }
        }
        if (biome.name === 'city') {
          // Add antennas
          for (let i = 0; i < 2; i++) {
            elements.push({
              x: Math.random() * GAME_WIDTH * 2,
              height: 40 + Math.random() * 40,
              type: 'antenna',
              color: '#888',
              layer: 'back',
              opacity: 0
            });
          }
        }
        if (biome.name === 'desert') {
          // Add rocks
          for (let i = 0; i < 3; i++) {
            elements.push({
              x: Math.random() * GAME_WIDTH * 2,
              height: 15 + Math.random() * 10,
              type: 'rock',
              color: '#8b6f3a',
              layer: 'front',
              opacity: 0
            });
          }
        }
      }
    });
    currentX += 260; // Wider spacing for less busy scenes
  }
  return elements;
}

function initBackgroundElements() {
  const nextBiomeIndex = (currentBiome + 1) % BIOMES.length;
  backgroundElements = generateBiomeElements(currentBiome);
  nextBiomeElements = generateBiomeElements(nextBiomeIndex, GAME_WIDTH); // Start off-screen
  scrollX = 0;
}

// Draw special plane event
function drawPlane() {
  const pt = PLANE_TYPES[(planeType - 1 + PLANE_TYPES.length) % PLANE_TYPES.length];
  ctx.save();
  ctx.translate(planeX, planeY);
  ctx.globalAlpha = 1.0;

  // Fuselage (tapered rectangle)
  ctx.fillStyle = pt.color;
  ctx.beginPath();
  ctx.moveTo(-pt.width * 0.5, -pt.height * 0.5); // Top left
  ctx.lineTo(pt.width * 0.4, -pt.height * 0.3); // Top right (tapered)
  ctx.lineTo(pt.width * 0.5, 0);               // Nose tip
  ctx.lineTo(pt.width * 0.4, pt.height * 0.3);  // Bottom right (tapered)
  ctx.lineTo(-pt.width * 0.5, pt.height * 0.5); // Bottom left
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#222';
  ctx.stroke();

  // Swept Wings
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(-pt.width * 0.1, 0);                // Wing root
  ctx.lineTo(-pt.width * 0.3, -pt.height * 1.5); // Upper wing tip (swept back)
  ctx.lineTo(-pt.width * 0.4, -pt.height * 1.4); // Upper wing trailing edge
  ctx.lineTo(-pt.width * 0.15, 0);               // Wing root trailing edge
  ctx.lineTo(-pt.width * 0.4, pt.height * 1.4);  // Lower wing trailing edge
  ctx.lineTo(-pt.width * 0.3, pt.height * 1.5);  // Lower wing tip (swept back)
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tail Fin (Vertical Stabilizer)
  ctx.beginPath();
  ctx.moveTo(-pt.width * 0.4, 0);                // Tail root
  ctx.lineTo(-pt.width * 0.6, -pt.height * 0.8); // Tail top (swept back)
  ctx.lineTo(-pt.width * 0.55, 0);               // Tail root trailing edge
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Tail Wings (Horizontal Stabilizers)
  ctx.beginPath();
  ctx.moveTo(-pt.width * 0.45, 0);
  ctx.lineTo(-pt.width * 0.65, -pt.height * 0.5);
  ctx.lineTo(-pt.width * 0.6, 0);
  ctx.lineTo(-pt.width * 0.65, pt.height * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cockpit
  ctx.fillStyle = '#ADD8E6'; // Light blue cockpit
  ctx.beginPath();
  ctx.moveTo(pt.width * 0.3, -pt.height * 0.2);
  ctx.lineTo(pt.width * 0.5, 0); // Nose tip
  ctx.lineTo(pt.width * 0.3, pt.height * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Type-specific details
  if (pt.name === 'prop') {
    // Propeller (simpler spinning effect)
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    const propAngle = (performance.now() / 50) * Math.PI * 2; // Rotation
    ctx.beginPath();
    ctx.moveTo(pt.width * 0.55, 0);
    ctx.lineTo(pt.width * 0.55 + Math.cos(propAngle) * 10, Math.sin(propAngle) * 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pt.width * 0.55, 0);
    ctx.lineTo(pt.width * 0.55 + Math.cos(propAngle + Math.PI) * 10, Math.sin(propAngle + Math.PI) * 10);
    ctx.stroke();
  } else if (pt.name === 'smalljet' || pt.name === 'fighter') {
    // Engine exhaust
    ctx.fillStyle = pt.name === 'fighter' ? '#ff4500' : '#f60'; // Orange/Red
    ctx.beginPath();
    ctx.ellipse(-pt.width * 0.55, 0, 8 + Math.random() * 4, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (pt.name === 'airliner') {
    // Engines under wings
    ctx.fillStyle = '#777';
    ctx.fillRect(-pt.width * 0.25, pt.height * 0.5, pt.width * 0.15, pt.height * 0.4); // Engine 1
    ctx.fillRect(-pt.width * 0.25, -pt.height * 0.9, pt.width * 0.15, pt.height * 0.4); // Engine 2
  }

  ctx.restore();
}

function drawBackgroundElement(element, offsetX, alpha = 1) {
  // Optional: Initial fade-in for newly generated elements
  // We add a flag to ensure this only happens once per element generation
  if (!element.initialOpacityApplied) {
      if (element.internalOpacity === undefined) element.internalOpacity = 0; // Initialize if needed
      if (element.internalOpacity < 1) {
          element.internalOpacity += 0.05; // Slower initial fade
          if (element.internalOpacity >= 1) {
              element.internalOpacity = 1;
              element.initialOpacityApplied = true; // Mark as fully faded in
          }
      }
  } else {
      element.internalOpacity = 1; // Ensure it stays opaque after initial fade
  }

  const horizonY = GAME_HEIGHT - 180; // Match horizon line

  // Calculate the screen x position using the wider wrap range
  const layerSpeed = element.layer === 'back' ? 0.3 :
                     element.layer === 'mid' ? 0.5 : 0.7;
  const wrapWidth = GAME_WIDTH * BACKGROUND_WRAP_WIDTH_FACTOR;
  const base_x = element.x + (offsetX * layerSpeed);
  const x = ((base_x % wrapWidth + wrapWidth) % wrapWidth);

  // Estimate element width (rough estimate is fine for culling)
  let estimatedWidth = 60; // Default width
  switch(element.type) {
      case 'tree': estimatedWidth = 50; break;
      case 'mountain': estimatedWidth = 180; break; // Increased width
      case 'building': estimatedWidth = 40; break;
      case 'dune': estimatedWidth = 100; break;
      case 'cactus': estimatedWidth = 30; break; // Based on arm span
      case 'palm': estimatedWidth = 60; break; // Based on fronds
      case 'rock': estimatedWidth = 50; break;
      case 'cloud': estimatedWidth = 75; break; // Based on puffs
      // Add other types if needed
  }

  const halfWidth = estimatedWidth / 2;

  // --- Draw Element Function --- (nested to avoid repetition)
  function drawElementAt(drawX) {
      // Culling Check for this specific draw position
      const cullBuffer = estimatedWidth * 0.5; // Keep a moderate buffer
      if (drawX + halfWidth < -cullBuffer || drawX - halfWidth > GAME_WIDTH + cullBuffer) {
          return; // Don't draw if completely off-screen for this instance
      }

      // Calculate layer-based properties
      const layerOpacity = element.layer === 'back' ? 0.6 :
                          element.layer === 'mid' ? 0.7 : 0.9;
      const baseY = horizonY;
      const heightOffset = element.layer === 'back' ? element.height * 1.1 :
                          element.layer === 'mid' ? element.height * 1.0 :
                          element.height * 0.9;

      ctx.globalAlpha = element.internalOpacity * layerOpacity * alpha;
      if (ctx.globalAlpha <= 0) return; // Don't draw if invisible

      ctx.fillStyle = element.color;

      // --- Element specific drawing logic --- 
      switch(element.type) {
          case 'tree':
              const trunkWidth = 8;
              const trunkHeight = heightOffset * 0.2;
              const trunkY = baseY - trunkHeight;
              const trunkColor = shadeColor(BIOMES[currentBiome].groundColor, -60); // Darker brown
              ctx.fillStyle = trunkColor;
              ctx.fillRect(drawX - trunkWidth / 2, trunkY, trunkWidth, trunkHeight);
              ctx.fillStyle = element.color;
              ctx.beginPath();
              ctx.moveTo(drawX, baseY - heightOffset); // Peak
              ctx.lineTo(drawX + 25, trunkY); // Wider base
              ctx.lineTo(drawX - 25, trunkY); // Wider base
              ctx.closePath(); // Close path for fill
              ctx.fill();
              break;
          case 'mountain':
              ctx.fillStyle = element.color;
              const mountainBaseWidth = 90; // Increased base width
              ctx.beginPath();
              ctx.moveTo(drawX, baseY - heightOffset); // Peak
              ctx.lineTo(drawX + mountainBaseWidth * 0.2, baseY - heightOffset * 0.7); ctx.lineTo(drawX + mountainBaseWidth * 0.3, baseY - heightOffset * 0.8);
              ctx.lineTo(drawX + mountainBaseWidth * 0.6, baseY - heightOffset * 0.3); ctx.lineTo(drawX + mountainBaseWidth, baseY); ctx.lineTo(drawX - mountainBaseWidth, baseY);
              ctx.lineTo(drawX - mountainBaseWidth * 0.5, baseY - heightOffset * 0.5); ctx.lineTo(drawX - mountainBaseWidth * 0.3, baseY - heightOffset * 0.6);
              ctx.closePath(); ctx.fill();
              // Snow cap
              const snowHeight = heightOffset * 0.4; // Size of snow cap
              ctx.fillStyle = '#FFFFFF';
              const baseAlpha = element.internalOpacity * layerOpacity * alpha;
              ctx.globalAlpha = baseAlpha * 0.8;
              if (ctx.globalAlpha > 0) {
                  ctx.beginPath();
                  ctx.moveTo(drawX, baseY - heightOffset); ctx.lineTo(drawX + mountainBaseWidth * 0.2, baseY - heightOffset * 0.7);
                  ctx.lineTo(drawX + mountainBaseWidth * 0.3 * 0.8, baseY - heightOffset * 0.75); ctx.lineTo(drawX - mountainBaseWidth * 0.3 * 0.8, baseY - heightOffset * 0.7);
                  ctx.lineTo(drawX - mountainBaseWidth * 0.5 * 0.9, baseY - heightOffset * 0.6);
                  ctx.closePath(); ctx.fill();
              }
              ctx.globalAlpha = baseAlpha; // Restore alpha
              break;
           // ... Add other element types similarly ...
          case 'building':
              const buildingWidth = 40;
              ctx.fillStyle = element.color;
              ctx.fillRect(drawX - buildingWidth / 2, baseY - heightOffset, buildingWidth, heightOffset);
              ctx.fillStyle = shadeColor(element.color, -20);
              ctx.fillRect(drawX - buildingWidth / 2 - 2, baseY - heightOffset - 5, buildingWidth + 4, 5);
              ctx.fillStyle = '#ffdb4d'; 
              const windowSize = 4, windowGap = 8;
              const numFloors = Math.floor((heightOffset - 10) / windowGap);
              const numWindowsAcross = Math.floor((buildingWidth - 10) / windowGap);
              for (let floor = 0; floor < numFloors; floor++) {
                  for (let win = 0; win < numWindowsAcross; win++) {
                      if (Math.random() > 0.3) {
                          ctx.fillRect(drawX - buildingWidth / 2 + 5 + win * windowGap, baseY - 10 - floor * windowGap, windowSize, windowSize);
                      }
                  }
              }
              break;
          case 'dune':
              ctx.fillStyle = element.color;
              ctx.beginPath();
              ctx.moveTo(drawX - 50, baseY);
              ctx.quadraticCurveTo(drawX, baseY - heightOffset * 1.2, drawX + 50, baseY);
              ctx.closePath();
              ctx.fill();
              break;
          case 'cactus':
              ctx.fillStyle = element.color;
              const cactusWidth = 8, armHeightRatio = 0.6, armOffsetY = heightOffset * 0.3;
              ctx.fillRect(drawX - cactusWidth / 2, baseY - heightOffset, cactusWidth, heightOffset);
              ctx.fillRect(drawX - cactusWidth * 2.5, baseY - heightOffset * armHeightRatio + armOffsetY, cactusWidth * 2, cactusWidth);
              ctx.fillRect(drawX - cactusWidth * 1.5 - cactusWidth / 2, baseY - heightOffset * armHeightRatio + armOffsetY, cactusWidth, heightOffset * armHeightRatio - armOffsetY);
              ctx.fillRect(drawX + cactusWidth * 0.5, baseY - heightOffset * armHeightRatio, cactusWidth * 2, cactusWidth);
              ctx.fillRect(drawX + cactusWidth * 1.5 - cactusWidth / 2, baseY - heightOffset * armHeightRatio, cactusWidth, heightOffset * armHeightRatio);
              break;
          case 'palm':
              const palmTrunkWidth = 6, palmTrunkHeight = heightOffset;
              const palmTrunkColor = '#7a5c3d';
              ctx.fillStyle = palmTrunkColor;
              ctx.fillRect(drawX - palmTrunkWidth / 2, baseY - palmTrunkHeight, palmTrunkWidth, palmTrunkHeight);
              ctx.fillStyle = element.color;
              const frondLength = 30, numFronds = 5;
              for (let i = 0; i < numFronds; i++) {
                  const angle = (Math.PI / numFronds) * i - Math.PI / 2.5;
                  ctx.beginPath();
                  ctx.moveTo(drawX, baseY - palmTrunkHeight);
                  ctx.lineTo(drawX + Math.cos(angle) * frondLength, baseY - palmTrunkHeight + Math.sin(angle) * frondLength);
                  ctx.lineTo(drawX + Math.cos(angle + 0.2) * frondLength * 0.8, baseY - palmTrunkHeight + Math.sin(angle + 0.2) * frondLength * 0.8);
                  ctx.closePath(); ctx.fill();
              }
              break;
          case 'rock':
              ctx.fillStyle = element.color;
              ctx.beginPath();
              ctx.moveTo(drawX - 20, baseY); ctx.lineTo(drawX - 15, baseY - heightOffset * 0.6);
              ctx.lineTo(drawX + 5, baseY - heightOffset); ctx.lineTo(drawX + 18, baseY - heightOffset * 0.5);
              ctx.lineTo(drawX + 25, baseY); ctx.closePath(); ctx.fill();
              break;
          case 'cloud':
              ctx.fillStyle = element.color;
              const cloudBaseY = element.height; const puffSize = 25;
              ctx.beginPath();
              ctx.ellipse(drawX, cloudBaseY, puffSize * 1.5, puffSize * 0.8, 0, 0, Math.PI * 2);
              ctx.ellipse(drawX - puffSize * 0.8, cloudBaseY + 5, puffSize * 1.2, puffSize * 0.6, 0, 0, Math.PI * 2);
              ctx.ellipse(drawX + puffSize * 0.9, cloudBaseY + 3, puffSize * 1.3, puffSize * 0.7, 0, 0, Math.PI * 2);
              ctx.ellipse(drawX + puffSize * 0.1, cloudBaseY - puffSize * 0.3, puffSize, puffSize * 0.5, 0, 0, Math.PI * 2);
              ctx.closePath(); ctx.fill();
              break;
      }
  }

  // Draw the element at its primary calculated position
  drawElementAt(x);

  // If the element is close to the left edge (potentially wrapping), draw it again on the right side
  if (x < halfWidth) {
      drawElementAt(x + wrapWidth);
  }
  // If the element is close to the right edge (potentially wrapping), draw it again on the left side
  else if (x > wrapWidth - halfWidth) {
       drawElementAt(x - wrapWidth);
  }
}

function drawBackground() {
  // Calculate next biome
  const nextBiomeIndex = (currentBiome + 1) % BIOMES.length;
  
  // Update scroll position with parallax effect
  scrollX -= speed * 0.5; // Much slower for background parallax
  
  const horizonY = GAME_HEIGHT - 180; // Higher horizon line
  
  // Draw sky gradient from top to horizon
  const currentSky = BIOMES[currentBiome].skyColor;
  const nextSky = BIOMES[nextBiomeIndex].skyColor;
  const skyColor = lerpColor(currentSky, nextSky, biomeTransition);
  
  // Create sky gradient
  const skyGradient = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGradient.addColorStop(0, shadeColor(skyColor, 30)); // Lightest at the very top
  skyGradient.addColorStop(0.5, skyColor);                // Middle color
  skyGradient.addColorStop(1, shadeColor(skyColor, -30)); // Darker towards horizon
  
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, GAME_WIDTH, horizonY);
  
  // Draw ground gradient from horizon to bottom
  const currentGround = BIOMES[currentBiome].groundColor;
  const nextGround = BIOMES[nextBiomeIndex].groundColor;
  const groundColor = lerpColor(currentGround, nextGround, biomeTransition);
  
  // Create gradient for ground
  const groundGradient = ctx.createLinearGradient(0, horizonY, 0, GAME_HEIGHT);
  groundGradient.addColorStop(0, shadeColor(groundColor, -40)); // Darkest at horizon
  groundGradient.addColorStop(0.3, shadeColor(groundColor, -20)); // Transition
  groundGradient.addColorStop(1, groundColor); // Normal at bottom
  
  ctx.fillStyle = groundGradient;
  ctx.fillRect(0, horizonY, GAME_WIDTH, GAME_HEIGHT - horizonY);

  // Add subtle ground texture
  ctx.strokeStyle = shadeColor(groundColor, -15); // Slightly darker lines
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.1; // Make lines very subtle
  ctx.beginPath();
  for (let y = horizonY + 5; y < GAME_HEIGHT; y += 5) {
    ctx.moveTo(0, y);
    ctx.lineTo(GAME_WIDTH, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1; // Reset alpha

  // Reset global alpha for elements
  ctx.globalAlpha = 1;

  // Draw elements in layers (back to front)
  ['back', 'mid', 'front'].forEach(layer => {
    // Draw elements from the current biome (fading out)
    if (biomeTransition < 1) { // Only draw if not fully transitioned
      const currentLayerElements = backgroundElements.filter(e => e.layer === layer);
      currentLayerElements.forEach(element => {
        drawBackgroundElement(element, scrollX, 1 - biomeTransition); // Pass fade-out alpha
      });
    }

    // Draw elements from the next biome (fading in)
    if (biomeTransition > 0) { // Only draw if transition has started
      const nextLayerElements = nextBiomeElements.filter(e => e.layer === layer);
      nextLayerElements.forEach(element => {
        drawBackgroundElement(element, scrollX, biomeTransition); // Pass fade-in alpha
      });
    }
  });

  // Reset global alpha
  ctx.globalAlpha = 1;

  // Much slower biome transitions
  biomeTransition += 0.0002 * speed;

  // Check for biome change
  if (biomeTransition >= 1) {
    currentBiome = (currentBiome + 1) % BIOMES.length;
    biomeTransition = 0;

    // Shift elements and generate new next biome
    backgroundElements = nextBiomeElements.map(e => ({...e, initialOpacityApplied: false })); // Reset flag for potential initial fade-in
    const nextNextBiomeIndex = (currentBiome + 1) % BIOMES.length;
    // Use GAME_WIDTH as offset so new elements start appearing from the right
    nextBiomeElements = generateBiomeElements(nextNextBiomeIndex, GAME_WIDTH);
  }
}

function drawPlayer() {
  let currentPose = 'run1'; // Default pose

  if (!player.onGround) {
      // Jump animation with different phases based on vertical velocity
      if (player.vy < -5) {
          currentPose = 'jump_up'; // Rising
      } else if (player.vy > 5) {
          currentPose = 'jump_down'; // Falling
      } else {
          currentPose = 'jump_mid'; // Peak of jump
      }
  } else {
      // Enhanced 4-frame running animation
      const animationSpeed = 6; // Slightly faster animation
      const frame = Math.floor(gameFrameCounter / animationSpeed) % 4;
      currentPose = 'run' + (frame + 1);
  }

  // Draw the horse rider at the player's position (x, y is bottom-left)
  // We might need to adjust x offset slightly if the drawn width is different from player.width
  drawHorseRider(player.x, player.y, currentPose);
}

function drawObstacles() {
  obstacles.forEach(ob => {
    // Save context for transformations
    ctx.save();
    
    // Animation parameters
    const animSpeed = 0.1;
    const wobble = Math.sin(gameFrameCounter * animSpeed) * 2;
    const headBob = Math.cos(gameFrameCounter * animSpeed) * 1.5;
    
    // Zombie dimensions
    const width = ob.w;
    const height = ob.h;
    const centerX = ob.x + width/2;
    const baseY = ob.y + height;
    
    // Translate to bottom center of zombie for easier positioning
    ctx.translate(centerX, baseY);
    
    // BODY
    // Create gradient for zombie body
    const bodyGradient = ctx.createLinearGradient(-width/2, -height, width/2, 0);
    bodyGradient.addColorStop(0, '#4a6c1a'); // Darker green
    bodyGradient.addColorStop(0.6, '#6b8e23'); // Olive green
    bodyGradient.addColorStop(1, '#556b2f'); // Darker at bottom
    
    // Torso (slightly tilted)
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.moveTo(-width/2, -height * 0.4); // Left shoulder
    ctx.lineTo(width/2, -height * 0.45 + wobble); // Right shoulder (wobbling)
    ctx.lineTo(width/2 - width * 0.1, -height * 0.05); // Right hip
    ctx.lineTo(-width/2 + width * 0.1, 0); // Left hip
    ctx.closePath();
    ctx.fill();
    
    // Torn clothes/rags
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 2;
    
    // Ragged shirt lines
    for (let i = 0; i < 3; i++) {
      const y = -height * (0.3 - i * 0.08);
      const wobbleOffset = Math.sin(gameFrameCounter * animSpeed + i) * 1.5;
      
      ctx.beginPath();
      ctx.moveTo(-width/2 + width * 0.1, y);
      ctx.lineTo(width/2 - width * 0.1 + wobbleOffset, y);
      ctx.stroke();
    }
    
    // HEAD
    // Head with bobbing animation
    const headWidth = width * 0.7;
    const headHeight = height * 0.3;
    const headX = 0;
    const headY = -height * 0.6 + headBob;
    
    // Head base
    ctx.fillStyle = '#5d7b1e';
    ctx.beginPath();
    ctx.ellipse(headX, headY, headWidth/2, headHeight/2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // FACE FEATURES
    // Eyes - glowing and uneven
    const eyeSize = Math.min(width, height) / 6;
    const leftEyeX = -headWidth/4;
    const rightEyeX = headWidth/4;
    const eyeY = headY - headHeight/8;
    
    // Eye sockets - darker green
    ctx.fillStyle = '#3a5012';
    ctx.beginPath();
    ctx.ellipse(leftEyeX, eyeY, eyeSize * 0.8, eyeSize * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(rightEyeX, eyeY, eyeSize * 0.8, eyeSize * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyeballs - with glow effect
    const eyeGlow = ctx.createRadialGradient(
      leftEyeX, eyeY, 0,
      leftEyeX, eyeY, eyeSize * 0.7
    );
    eyeGlow.addColorStop(0, '#ffff00'); // Bright yellow center
    eyeGlow.addColorStop(0.7, '#ff9900'); // Orange
    eyeGlow.addColorStop(1, '#aa5500'); // Dark orange edge
    
    ctx.fillStyle = eyeGlow;
    ctx.beginPath();
    ctx.ellipse(leftEyeX, eyeY, eyeSize/2, eyeSize/3, 0, 0, Math.PI * 2);
    ctx.fill();
    
    const eyeGlow2 = ctx.createRadialGradient(
      rightEyeX, eyeY, 0,
      rightEyeX, eyeY, eyeSize * 0.7
    );
    eyeGlow2.addColorStop(0, '#ffff00');
    eyeGlow2.addColorStop(0.7, '#ff9900');
    eyeGlow2.addColorStop(1, '#aa5500');
    
    ctx.fillStyle = eyeGlow2;
    ctx.beginPath();
    ctx.ellipse(rightEyeX, eyeY, eyeSize/2, eyeSize/3, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupils - black with slight movement
    const pupilOffset = Math.sin(gameFrameCounter * animSpeed * 2) * (eyeSize/6);
    const pupilSize = eyeSize/4;
    
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(leftEyeX + pupilOffset, eyeY, pupilSize, pupilSize, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(rightEyeX + pupilOffset, eyeY, pupilSize, pupilSize, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Mouth - jagged and bloody
    const mouthY = headY + headHeight/4;
    const mouthWidth = headWidth * 0.6;
    
    // Blood dripping from mouth
    const bloodGradient = ctx.createLinearGradient(0, mouthY, 0, mouthY + eyeSize);
    bloodGradient.addColorStop(0, '#8b0000'); // Dark red
    bloodGradient.addColorStop(1, '#ff0000'); // Brighter red
    
    // Jagged mouth with blood
    ctx.fillStyle = bloodGradient;
    ctx.beginPath();
    ctx.moveTo(-mouthWidth/2, mouthY);
    
    // Create jagged teeth effect
    const teethCount = 6;
    const teethWidth = mouthWidth / teethCount;
    
    for (let i = 0; i < teethCount; i++) {
      const toothX = -mouthWidth/2 + i * teethWidth;
      const toothHeight = Math.sin(i + gameFrameCounter * animSpeed) * 3 + 5;
      
      ctx.lineTo(toothX, mouthY);
      ctx.lineTo(toothX + teethWidth/2, mouthY + toothHeight);
      ctx.lineTo(toothX + teethWidth, mouthY);
    }
    
    // Bottom of mouth and dripping blood
    ctx.lineTo(mouthWidth/2, mouthY);
    ctx.lineTo(mouthWidth/3, mouthY + eyeSize);
    ctx.lineTo(0, mouthY + eyeSize * 0.7);
    ctx.lineTo(-mouthWidth/3, mouthY + eyeSize);
    ctx.closePath();
    ctx.fill();
    
    // ARMS
    // Dangling, uneven arms
    ctx.strokeStyle = '#5d7b1e';
    ctx.lineWidth = width/5;
    ctx.lineCap = 'round';
    
    // Left arm with animation
    const leftArmAngle = Math.sin(gameFrameCounter * animSpeed) * 0.2 - 0.1;
    const leftArmLength = height * 0.4;
    
    ctx.beginPath();
    ctx.moveTo(-width/2, -height * 0.35);
    ctx.lineTo(
      -width/2 - Math.sin(leftArmAngle) * leftArmLength,
      -height * 0.35 + Math.cos(leftArmAngle) * leftArmLength
    );
    ctx.stroke();
    
    // Right arm with different animation
    const rightArmAngle = Math.sin(gameFrameCounter * animSpeed + 1) * 0.2 + 0.1;
    const rightArmLength = height * 0.45;
    
    ctx.beginPath();
    ctx.moveTo(width/2, -height * 0.4);
    ctx.lineTo(
      width/2 + Math.sin(rightArmAngle) * rightArmLength,
      -height * 0.4 + Math.cos(rightArmAngle) * rightArmLength
    );
    ctx.stroke();
    
    // LEGS
    // Shambling, uneven legs
    ctx.lineWidth = width/4;
    
    // Left leg with animation
    const leftLegAngle = Math.sin(gameFrameCounter * animSpeed + 2) * 0.1 - 0.05;
    const leftLegLength = height * 0.3;
    
    ctx.beginPath();
    ctx.moveTo(-width/4, -height * 0.05);
    ctx.lineTo(
      -width/4 - Math.sin(leftLegAngle) * leftLegLength,
      -height * 0.05 + Math.cos(leftLegAngle) * leftLegLength
    );
    ctx.stroke();
    
    // Right leg with different animation
    const rightLegAngle = Math.sin(gameFrameCounter * animSpeed + 3) * 0.1 + 0.05;
    const rightLegLength = height * 0.25;
    
    ctx.beginPath();
    ctx.moveTo(width/4, -height * 0.05);
    ctx.lineTo(
      width/4 + Math.sin(rightLegAngle) * rightLegLength,
      -height * 0.05 + Math.cos(rightLegAngle) * rightLegLength
    );
    ctx.stroke();
    
    // Reset context transformations
    ctx.restore();
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
  // Plane event trigger
  if (!planeActive && score >= nextPlaneScore) {
    planeActive = true;
    const pt = PLANE_TYPES[planeType % PLANE_TYPES.length];
    planeX = pt.width * 1.2; // Start just inside the left edge
    planeY = pt.y;
    planeSpeed = Math.max(2, pt.speed * 0.6); // Slow, fixed speed for visibility
    planeType++;
    console.log('[PLANE] Spawned:', pt.name, 'at', planeX, planeY, 'score:', score);
    planeCount++;
    // Trigger a random help phrase visibly for 3s
    if (speechTimerId) clearTimeout(speechTimerId);
    currentHelpPhrase = helpPhrases[Math.floor(Math.random() * helpPhrases.length)];
    speechVisible = true;
    speechTimerId = setTimeout(() => { speechVisible = false; }, 3000);
    nextPlaneScore += 400;
  }

  // Plane movement
  if (planeActive) {
    const pt2 = PLANE_TYPES[(planeType - 1 + PLANE_TYPES.length) % PLANE_TYPES.length];
    planeX += planeSpeed;
    if (planeX > GAME_WIDTH - pt2.width * 0.5) {
      planeActive = false;
    }
  }

  // Music tempo increases slower than speed (2x tempo at 4x speed)
  musicTempo = Math.sqrt(speed / 4);

  // Player physics
  player.vy += gravity;
  player.y += player.vy;
  // Check if player hits the ground level (same as obstacles)
  const groundLevel = GAME_HEIGHT - 24;
  if (player.y >= groundLevel) {
    player.y = groundLevel; // Set player bottom exactly to ground level
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

  // Check for collisions
  for (let ob of obstacles) {
    // Player bounds (using player object properties)
    const playerLeft = player.x;
    const playerRight = player.x + player.w;
    const playerTop = player.y - player.h; // player.y is bottom edge
    const playerBottom = player.y;

    // Obstacle bounds
    const obstacleLeft = ob.x;
    const obstacleRight = ob.x + ob.w;
    const obstacleTop = ob.y;
    const obstacleBottom = ob.y + ob.h;

    // AABB Collision check
    if (
      playerLeft < obstacleRight &&
      playerRight > obstacleLeft &&
      playerTop < obstacleBottom &&
      playerBottom > obstacleTop
    ) {
      // Collision detected!
      endGame(); 
      return; // Stop further updates this frame
    }
  }

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

  // Increase score and speed
  score++;
  if (score > 0 && score % 150 === 0) {
    speed += 0.5;
    console.debug('updateGame: speed increased to', speed);
  }
  speed = Math.max(4, speed); // Clamp speed to prevent going below initial value
}

// FPS calculation
let lastFrameTime = performance.now();
let fps = 60;
let gameFrameCounter = 0; // Declare the frame counter here

function renderGame() {
  // FPS calculation
  const now = performance.now();
  fps = Math.round(1000 / (now - lastFrameTime));
  lastFrameTime = now;

  drawBackground();
  // Draw plane over background
  if (planeActive) {
    drawPlane();
  }
  drawPlayer();
  // Player shouts when plane is overhead
  if (speechVisible) {
    drawSpeechBubble(player.x + player.w * 4, player.y - player.h - 40, currentHelpPhrase);
  }
  drawObstacles();
  drawScore();

  // Debug overlay
  if (debugMode) {
    debugOverlay.innerHTML = `
      <b>DEBUG INFO</b><br>
      FPS: <span style="color:#ffd700">${fps}</span><br>
      Speed: <span style="color:#ffd700">${speed.toFixed(2)}</span><br>
      Music Tempo: <span style="color:#ffd700">${musicTempo.toFixed(2)}</span><br>
      Planes: <span style='color:#ffd700'>${planeCount}</span>
    `;
    debugOverlay.style.display = 'block';
  } else {
    debugOverlay.style.display = 'none';
  }
}

function gameLoop() {
  gameFrameCounter++; // Increment animation frame counter
  if (!running) return;
  updateGame();
  renderGame();
  requestAnimationFrame(gameLoop);
}

function startGame() {
  // Try locking screen orientation to landscape on supported mobile browsers
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(err => console.warn('Orientation lock failed:', err));
  }
  resetGame();
  // Ensure game speed resets even if resetGame was missed
  speed = 4;
  console.debug('startGame: speed explicitly set to', speed);
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
  restartBtn.onclick = function() {
    startGame();
    gameOverScreen.style.display = 'none';
  };
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

// Fullscreen toggle
fullscreenBtn.onclick = () => {
  const container = document.getElementById('game-container');
  if (!document.fullscreenElement) {
    container.requestFullscreen().catch(err => console.warn('Fullscreen failed:', err));
  } else {
    document.exitFullscreen();
  }
  fullscreenBtn.blur();
};

// Controls
window.addEventListener('keydown', e => {
  // Jump when game is running
  if ((e.code === 'Space' || e.code === 'ArrowUp') && running) {
    if (player.onGround) player.vy = jumpPower;
    else jumpBuffer = JUMP_BUFFER_TIME;
    return;
  }
  
  // Enter starts the story only if neither overlay is visible
  if (!running && e.code === 'Enter' && startScreen.style.display === 'flex') {
    showStory();
  }
});
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (running) {
    if (player.onGround) {
      player.vy = jumpPower;
    } else {
      jumpBuffer = JUMP_BUFFER_TIME;
    }
  } else {
    showStory();
  }
});

// Set mute button icon on load
muteBtn.textContent = musicMuted ? '🔇' : '🔊';

function showStory() {
  startScreen.style.display = 'none';
  storyScreen.style.display = 'flex';
}
storyNextBtn.onclick = () => {
  storyScreen.style.display = 'none';
  zombieOverlay.style.display = 'flex';
  setTimeout(() => {
    zombieOverlay.style.display = 'none';
    startGame();
  }, 1500);
};
startBtn.onclick = showStory;
restartBtn.onclick = function() {
  startGame();
  gameOverScreen.style.display = 'none';
};

// Helper function to interpolate between colors
function lerpColor(color1, color2, amount) {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);

  const r = Math.floor(c1.r + (c2.r - c1.r) * amount);
  const g = Math.floor(c1.g + (c2.g - c1.g) * amount);
  const b = Math.floor(c1.b + (c2.b - c1.b) * amount);

  return `rgb(${r},${g},${b})`;
}

// Helper function to convert hex to rgb
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : {r:0,g:0,b:0};
}

// Helper function to darken/lighten a color
function shadeColor(color, percent) {
  const rgb = hexToRgb(color);
  if (!rgb) return color;

  const amount = percent > 0 ? 255 - percent : percent;
  rgb.r = Math.max(0, Math.min(255, rgb.r + amount));
  rgb.g = Math.max(0, Math.min(255, rgb.g + amount));
  rgb.b = Math.max(0, Math.min(255, rgb.b + amount));

  return `#${(1 << 24 | rgb.r << 16 | rgb.g << 8 | rgb.b).toString(16).slice(1)}`;
}

// Draw a speech bubble with text at (x,y)
function drawSpeechBubble(x, y, text) {
  const padding = 4;
  const fontSize = 14;
  ctx.font = `${fontSize}px monospace`;
  const textWidth = ctx.measureText(text).width;
  const bw = textWidth + padding*2;
  const bh = fontSize + padding*2;
  const rx = x - bw/2;
  const ry = y - bh;
  // Bubble rectangle
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.fillRect(rx, ry, bw, bh);
  ctx.strokeRect(rx, ry, bw, bh);
  // Tail
  ctx.beginPath();
  ctx.moveTo(x - 5, y - bh + bh);
  ctx.lineTo(x, y);
  ctx.lineTo(x + 5, y - bh + bh);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Text
  ctx.fillStyle = '#000';
  ctx.fillText(text, rx + padding, ry + padding + fontSize*0.8);
}

// --- Horse Rider Drawing Functions ---
function drawHorseRider(x, y, pose) {
    // x, y is the bottom-left corner position
    const scale = 0.6; // Adjust overall size
    const riderHeight = 35 * scale;
    const horseBodyHeight = 30 * scale;
    const horseBodyWidth = 50 * scale;
    const horseLegLength = 25 * scale;
    const headSize = 12 * scale;
    const neckLength = 15 * scale;

    const totalHeight = horseBodyHeight + horseLegLength;
    const riderBottomY = y - totalHeight;
    const horseTopY = y - horseLegLength;
    const horseBottomY = y;
    
    // Slight bounce effect based on animation frame
    const bounceOffset = pose.includes('run') ? Math.sin(gameFrameCounter * 0.2) * 2 : 0;

    ctx.save();
    ctx.translate(x, y + bounceOffset);

    // HORSE BODY - with gradient for more depth
    const horseGradient = ctx.createLinearGradient(0, -totalHeight, 0, -totalHeight + horseBodyHeight);
    horseGradient.addColorStop(0, '#8B4513'); // Darker at top
    horseGradient.addColorStop(0.5, '#CD853F'); // Lighter in middle
    horseGradient.addColorStop(1, '#A0522D'); // Medium at bottom
    ctx.fillStyle = horseGradient;
    
    // Rounded body shape instead of rectangle
    ctx.beginPath();
    ctx.moveTo(0, -totalHeight + horseBodyHeight/2);
    ctx.lineTo(horseBodyWidth * 0.1, -totalHeight);
    ctx.lineTo(horseBodyWidth * 0.9, -totalHeight);
    ctx.lineTo(horseBodyWidth, -totalHeight + horseBodyHeight/2);
    ctx.lineTo(horseBodyWidth * 0.9, -totalHeight + horseBodyHeight);
    ctx.lineTo(horseBodyWidth * 0.1, -totalHeight + horseBodyHeight);
    ctx.closePath();
    ctx.fill();

    // SADDLE
    ctx.fillStyle = '#4A2511';
    ctx.beginPath();
    ctx.ellipse(horseBodyWidth * 0.4, -totalHeight + horseBodyHeight * 0.3, horseBodyWidth * 0.2, horseBodyHeight * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Saddle straps
    ctx.strokeStyle = '#2E1A08';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(horseBodyWidth * 0.3, -totalHeight + horseBodyHeight * 0.1);
    ctx.lineTo(horseBodyWidth * 0.3, -totalHeight + horseBodyHeight * 0.9);
    ctx.moveTo(horseBodyWidth * 0.5, -totalHeight + horseBodyHeight * 0.1);
    ctx.lineTo(horseBodyWidth * 0.5, -totalHeight + horseBodyHeight * 0.9);
    ctx.stroke();

    // RIDER with more detail
    // Rider body
    ctx.fillStyle = '#3A3A3A';
    ctx.beginPath();
    ctx.ellipse(horseBodyWidth * 0.4, -totalHeight - riderHeight * 0.5, 6 * scale, riderHeight * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Rider arms - position based on pose
    ctx.strokeStyle = '#3A3A3A';
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    
    if (pose.includes('jump')) {
        // Arms up when jumping
        ctx.moveTo(horseBodyWidth * 0.4, -totalHeight - riderHeight * 0.6);
        ctx.lineTo(horseBodyWidth * 0.6, -totalHeight - riderHeight * 0.9);
    } else {
        // Arms forward when running
        ctx.moveTo(horseBodyWidth * 0.4, -totalHeight - riderHeight * 0.6);
        ctx.lineTo(horseBodyWidth * 0.6, -totalHeight - riderHeight * 0.4);
    }
    ctx.stroke();
    
    // Rider head with hat
    ctx.fillStyle = '#2E2E2E';
    ctx.beginPath();
    ctx.arc(horseBodyWidth * 0.4, -totalHeight - riderHeight * 0.9, headSize * 0.6, 0, Math.PI * 2);
    ctx.fill();
    
    // Cowboy hat
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.ellipse(horseBodyWidth * 0.4, -totalHeight - riderHeight * 0.95, headSize * 0.8, headSize * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6B3E2A';
    ctx.beginPath();
    ctx.arc(horseBodyWidth * 0.4, -totalHeight - riderHeight * 1.05, headSize * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // HORSE HEAD & NECK with more detail
    // Neck with gradient
    const neckGradient = ctx.createLinearGradient(
        horseBodyWidth, -totalHeight + 5*scale,
        horseBodyWidth + neckLength, -totalHeight - neckLength + 10*scale
    );
    neckGradient.addColorStop(0, '#8B4513');
    neckGradient.addColorStop(1, '#CD853F');
    
    ctx.fillStyle = neckGradient;
    ctx.beginPath();
    ctx.moveTo(horseBodyWidth, -totalHeight + 5*scale); // Neck base
    ctx.quadraticCurveTo(
        horseBodyWidth + neckLength * 0.5, -totalHeight - neckLength * 0.3,
        horseBodyWidth + neckLength, -totalHeight - neckLength + 10*scale
    ); // Curved neck
    ctx.lineTo(horseBodyWidth + neckLength + 5*scale, -totalHeight - neckLength + 5*scale); // Head connection
    ctx.lineTo(horseBodyWidth + 5*scale, -totalHeight); // Back to body
    ctx.closePath();
    ctx.fill();
    
    // Head with more detail
    ctx.fillStyle = '#CD853F';
    ctx.beginPath();
    ctx.ellipse(
        horseBodyWidth + neckLength + headSize * 0.5, 
        -totalHeight - neckLength + headSize * 0.5,
        headSize, headSize * 0.6, 0, 0, Math.PI * 2
    );
    ctx.fill();
    
    // Eye
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(
        horseBodyWidth + neckLength + headSize * 0.7,
        -totalHeight - neckLength + headSize * 0.4,
        headSize * 0.1, headSize * 0.15, 0, 0, Math.PI * 2
    );
    ctx.fill();
    
    // Mane
    ctx.fillStyle = '#5E2C04';
    for (let i = 0; i < 5; i++) {
        const maneX = horseBodyWidth + neckLength * 0.2 + i * (neckLength * 0.15);
        const maneY = -totalHeight - neckLength * 0.2 + i * (neckLength * 0.15);
        const maneSize = (headSize * 0.3) * (1 - i * 0.1);
        
        ctx.beginPath();
        ctx.moveTo(maneX, maneY);
        ctx.lineTo(maneX - maneSize, maneY - maneSize * 1.5);
        ctx.lineTo(maneX + maneSize * 0.5, maneY - maneSize * 0.5);
        ctx.closePath();
        ctx.fill();
    }

    // HORSE LEGS with more detail and animation
    // Use thinner legs with hooves
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 5 * scale;
    
    const legX1 = horseBodyWidth * 0.25; // Front legs
    const legX2 = horseBodyWidth * 0.75; // Back legs
    const legTopY = -horseLegLength;
    
    // Draw legs based on pose
    ctx.beginPath();
    
    if (pose === 'jump_up') {
        // Jump up pose - legs tucked forward
        drawLeg(legX1, legTopY, legX1 + 15*scale, legTopY + horseLegLength * 0.7);
        drawLeg(legX1 + 8*scale, legTopY, legX1 + 20*scale, legTopY + horseLegLength * 0.6);
        drawLeg(legX2, legTopY, legX2 + 10*scale, legTopY + horseLegLength * 0.8);
        drawLeg(legX2 - 8*scale, legTopY, legX2 + 5*scale, legTopY + horseLegLength * 0.7);
    } 
    else if (pose === 'jump_mid') {
        // Mid-jump pose - legs spread out
        drawLeg(legX1, legTopY, legX1 + 10*scale, legTopY + horseLegLength * 0.6);
        drawLeg(legX1 + 8*scale, legTopY, legX1 + 15*scale, legTopY + horseLegLength * 0.5);
        drawLeg(legX2, legTopY, legX2 - 10*scale, legTopY + horseLegLength * 0.6);
        drawLeg(legX2 - 8*scale, legTopY, legX2 - 15*scale, legTopY + horseLegLength * 0.5);
    }
    else if (pose === 'jump_down') {
        // Landing pose - legs extended down
        drawLeg(legX1, legTopY, legX1, legTopY + horseLegLength);
        drawLeg(legX1 + 8*scale, legTopY, legX1 + 8*scale, legTopY + horseLegLength);
        drawLeg(legX2, legTopY, legX2, legTopY + horseLegLength);
        drawLeg(legX2 - 8*scale, legTopY, legX2 - 8*scale, legTopY + horseLegLength);
    }
    else if (pose === 'run1') {
        // Running pose 1
        drawLeg(legX1, legTopY, legX1 + 12*scale, 0);
        drawLeg(legX1 + 8*scale, legTopY, legX1 - 5*scale, 0);
        drawLeg(legX2, legTopY, legX2 - 12*scale, 0);
        drawLeg(legX2 - 8*scale, legTopY, legX2 + 5*scale, 0);
    }
    else if (pose === 'run2') {
        // Running pose 2
        drawLeg(legX1, legTopY, legX1, 0);
        drawLeg(legX1 + 8*scale, legTopY, legX1 + 8*scale, 0);
        drawLeg(legX2, legTopY, legX2, 0);
        drawLeg(legX2 - 8*scale, legTopY, legX2 - 8*scale, 0);
    }
    else if (pose === 'run3') {
        // Running pose 3
        drawLeg(legX1, legTopY, legX1 - 12*scale, 0);
        drawLeg(legX1 + 8*scale, legTopY, legX1 + 15*scale, 0);
        drawLeg(legX2, legTopY, legX2 + 12*scale, 0);
        drawLeg(legX2 - 8*scale, legTopY, legX2 - 15*scale, 0);
    }
    else if (pose === 'run4') {
        // Running pose 4
        drawLeg(legX1, legTopY, legX1, 0);
        drawLeg(legX1 + 8*scale, legTopY, legX1 + 8*scale, 0);
        drawLeg(legX2, legTopY, legX2, 0);
        drawLeg(legX2 - 8*scale, legTopY, legX2 - 8*scale, 0);
    }
    
    // Helper function to draw a leg with a hoof
    function drawLeg(startX, startY, endX, endY) {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        
        // Draw hoof
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(endX, endY, 3 * scale, 0, Math.PI * 2);
        ctx.fill();
    }

    // TAIL with animation
    const tailWag = Math.sin(gameFrameCounter * 0.1) * 5;
    const tailLength = 20 * scale;
    
    ctx.beginPath();
    ctx.moveTo(0, -totalHeight + 5*scale);
    
    // Curved animated tail
    ctx.bezierCurveTo(
        -5*scale, -totalHeight + 10*scale,
        -10*scale + tailWag, -totalHeight + 15*scale,
        -15*scale + tailWag, -totalHeight + 25*scale
    );
    
    ctx.lineWidth = 4*scale;
    ctx.strokeStyle = '#5E2C04';
    ctx.stroke();
    
    // Tail end with multiple strands
    const tailEndX = -15*scale + tailWag;
    const tailEndY = -totalHeight + 25*scale;
    
    ctx.lineWidth = 2*scale;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        const angle = (i / 4) * Math.PI - Math.PI/2 + Math.sin(gameFrameCounter * 0.1) * 0.2;
        const length = 8*scale;
        ctx.moveTo(tailEndX, tailEndY);
        ctx.lineTo(
            tailEndX + Math.cos(angle) * length,
            tailEndY + Math.sin(angle) * length
        );
    }
    ctx.stroke();

    ctx.restore();
}
// --- End Horse Rider Drawing Functions ---
