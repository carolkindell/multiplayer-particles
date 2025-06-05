// Get elements
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const participantsEl = document.getElementById('participants');
const scoresListEl = document.getElementById('scores-list');
const timerEl = document.getElementById('timer');
const countdownOverlayEl = document.getElementById('countdown-overlay');
const gameOverEl = document.getElementById('game-over');
const gameOverScoresEl = document.getElementById('game-over-scores');
const restartButtonEl = document.getElementById('restart-button');
const powerupNotificationEl = document.getElementById('powerup-notification');

// Set canvas to full window size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Game state
const GAME_DURATION = 120; // 2 minutes in seconds
let gameActive = false;
let gameTimer = GAME_DURATION;
let countdownTime = 3;
let playerScore = 0;
let playerName = "Player" + Math.floor(Math.random() * 1000);
let scores = new Map();
let activePowerup = null;
let powerupTimeRemaining = 0;

// Track mouse position
let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;
let lastSentX = mouseX;
let lastSentY = mouseY;

// Local particle system
const particles = [];
const INITIAL_PARTICLE_COUNT = 50;
const MAX_PARTICLE_COUNT = 100;
const colors = ["#FF4081","#536DFE","#FF9800","#4CAF50","#9C27B0","#00BCD4","#F44336","#FFEB3B","#009688","#E91E63","#2196F3","#8BC34A","#03A9F4","#FF5722"];
const SPECIAL_PARTICLE_CHANCE = 0.15; // 15% chance for special particles
const POWERUP_TYPES = [
    { name: "Speed Boost", color: "#FFD700", duration: 10 }, // 10 seconds
    { name: "Magnet", color: "#9C27B0", duration: 8 }, // 8 seconds
    { name: "Double Points", color: "#00BCD4", duration: 12 } // 12 seconds
];
const POWERUP_SPAWN_CHANCE = 0.007; // 0.7% chance each second

// Shared state flags
let isLeader = false;  // Whether this client is the designated leader
let lastParticleUpdate = 0;
const PARTICLE_SYNC_INTERVAL = 500; // Send updates every 500ms

// Keep track of which client is the leader
let leaderSessionId = null;

// Pre-calculated connection distance threshold
const CONNECTION_DISTANCE_THRESHOLD = 100;
const CONNECTION_DISTANCE_THRESHOLD_SQ = CONNECTION_DISTANCE_THRESHOLD * CONNECTION_DISTANCE_THRESHOLD;

// Create offscreen canvas for better performance
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d');
offscreenCanvas.width = canvas.width;
offscreenCanvas.height = canvas.height;

// Cursors of other participants
const otherCursors = new Map();

// WebSocket and session variables
let ws;
let sessionId;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Generate random cursor color for this user
const myColor = colors[Math.floor(Math.random() * colors.length)];

// Throttle WebSocket sends
let lastSendTime = 0;
const SEND_THROTTLE = 50; // ms

// Initialize game by showing countdown
function startCountdown() {
    countdownOverlayEl.textContent = countdownTime;
    
    const countdownInterval = setInterval(() => {
        countdownTime--;
        
        if (countdownTime <= 0) {
            clearInterval(countdownInterval);
            countdownOverlayEl.style.display = 'none';
            startGame();
        } else {
            countdownOverlayEl.textContent = countdownTime;
        }
    }, 1000);
}

// Start the game
function startGame() {
    gameActive = true;
    gameTimer = GAME_DURATION;
    playerScore = 0;
    
    // Reset scores
    scores.clear();
    scores.set(sessionId, { score: 0, name: playerName, color: myColor });
    updateScoreboard();
    
    // Start game timer
    const timerInterval = setInterval(() => {
        if (!gameActive) {
            clearInterval(timerInterval);
            return;
        }
        
        gameTimer--;
        
        // Update timer display
        const minutes = Math.floor(gameTimer / 60);
        const seconds = gameTimer % 60;
        timerEl.textContent = `Time: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
        
        // Check for powerup spawning (leader only)
        if (isLeader && Math.random() < POWERUP_SPAWN_CHANCE) {
            spawnPowerup();
        }
        
        // Update active powerup timer
        if (activePowerup) {
            powerupTimeRemaining--;
            if (powerupTimeRemaining <= 0) {
                deactivatePowerup();
            }
        }
        
        if (gameTimer <= 0) {
            endGame();
            clearInterval(timerInterval);
        }
    }, 1000);
    
    // If we're the leader, initialize particles
    if (isLeader) {
        initParticles();
        sendParticleState();
    }
    
    // Broadcast our initial score
    sendScoreUpdate(playerScore);
}

// End the game
function endGame() {
    gameActive = false;
    
    // Display game over screen
    const sortedScores = Array.from(scores.entries())
        .sort((a, b) => b[1].score - a[1].score);
    
    let scoresHTML = '<ol>';
    sortedScores.forEach(([id, data]) => {
        const isCurrentPlayer = id === sessionId;
        scoresHTML += `<li style="color: ${data.color}; font-weight: ${isCurrentPlayer ? 'bold' : 'normal'}">
            ${data.name}: ${data.score} points
        </li>`;
    });
    scoresHTML += '</ol>';
    
    gameOverScoresEl.innerHTML = scoresHTML;
    gameOverEl.style.display = 'flex';
    
    // If we're the leader, clean up particles
    if (isLeader) {
        particles.length = 0;
        sendParticleState();
    }
}

// Restart the game
restartButtonEl.addEventListener('click', () => {
    gameOverEl.style.display = 'none';
    countdownTime = 3;
    startCountdown();
});

// Initialize particles
function initParticles() {
    particles.length = 0;  // Clear existing particles
    
    for (let i = 0; i < INITIAL_PARTICLE_COUNT; i++) {
        spawnParticle();
    }
}

// Spawn a new particle
function spawnParticle() {
    const isSpecial = Math.random() < SPECIAL_PARTICLE_CHANCE;
    
    particles.push({
        id: Date.now() + Math.random(),  // Generate unique ID
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: isSpecial ? 6 + Math.random() * 4 : 3 + Math.random() * 2,
        speedX: (Math.random() * 2 - 1) * (isSpecial ? 1.5 : 1),
        speedY: (Math.random() * 2 - 1) * (isSpecial ? 1.5 : 1),
        color: colors[Math.floor(Math.random() * colors.length)],
        isSpecial: isSpecial,
        value: isSpecial ? Math.floor(Math.random() * 5) + 5 : 1
    });
}

// Spawn a powerup
function spawnPowerup() {
    const powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    
    particles.push({
        id: Date.now() + Math.random(),
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: 10 + Math.random() * 5,
        speedX: (Math.random() * 1.5 - 0.75),
        speedY: (Math.random() * 1.5 - 0.75),
        color: powerupType.color,
        isPowerup: true,
        powerupType: powerupType.name,
        duration: powerupType.duration,
        pulseSize: 0,
        pulseDirection: 1
    });
    
    sendParticleState();
}

// Activate powerup
function activatePowerup(powerupType, duration) {
    // Deactivate any existing powerup
    if (activePowerup) {
        deactivatePowerup();
    }
    
    activePowerup = powerupType;
    powerupTimeRemaining = duration;
    
    // Show notification
    powerupNotificationEl.textContent = `${powerupType} activated!`;
    powerupNotificationEl.style.display = 'block';
    powerupNotificationEl.style.animation = 'none';
    void powerupNotificationEl.offsetWidth; // Trigger reflow
    powerupNotificationEl.style.animation = 'fade-in-out 2s forwards';
    
    // Send powerup activation to other clients
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'powerupActivated',
            sessionId: sessionId,
            powerupType: powerupType,
            duration: duration
        }));
    }
}

// Deactivate powerup
function deactivatePowerup() {
    if (!activePowerup) return;
    
    // Show notification
    powerupNotificationEl.textContent = `${activePowerup} ended`;
    powerupNotificationEl.style.display = 'block';
    powerupNotificationEl.style.animation = 'none';
    void powerupNotificationEl.offsetWidth; // Trigger reflow
    powerupNotificationEl.style.animation = 'fade-in-out 2s forwards';
    
    activePowerup = null;
    powerupTimeRemaining = 0;
    
    // Send powerup deactivation to other clients
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'powerupDeactivated',
            sessionId: sessionId
        }));
    }
}

// Check if player collects a particle
function checkParticleCollection() {
    if (!gameActive) return;
    
    const collectionRadius = activePowerup === "Magnet" ? 50 : 20;
    
    for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        const dx = mouseX - particle.x;
        const dy = mouseY - particle.y;
        const distSq = dx * dx + dy * dy;
        
        if (distSq < collectionRadius * collectionRadius) {
            // Collect the particle
            if (particle.isPowerup) {
                activatePowerup(particle.powerupType, particle.duration);
            } else {
                // Calculate points based on particle value and active powerups
                const pointsGained = activePowerup === "Double Points" ? particle.value * 2 : particle.value;
                playerScore += pointsGained;
                
                // Create points popup
                createPointsPopup(particle.x, particle.y, pointsGained);
                
                // Update and send score
                sendScoreUpdate(playerScore);
            }
            
            // If this client is the leader, remove the particle and spawn a new one
            if (isLeader) {
                particles.splice(i, 1);
                
                // Spawn a new particle if we're under the maximum
                if (particles.length < MAX_PARTICLE_COUNT) {
                    setTimeout(() => {
                        spawnParticle();
                        sendParticleState();
                    }, Math.random() * 1000 + 500);
                }
                
                sendParticleState();
            }
            
            // Send collection event
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'particleCollected',
                    particleId: particle.id,
                    sessionId: sessionId
                }));
            }
        }
    }
}

// Create a points popup animation
function createPointsPopup(x, y, points) {
    const popup = document.createElement('div');
    popup.className = 'points-popup';
    popup.textContent = `+${points}`;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    
    document.body.appendChild(popup);
    
    // Remove after animation completes
    setTimeout(() => {
        document.body.removeChild(popup);
    }, 1000);
}

// Send score update to other players
function sendScoreUpdate(score) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'scoreUpdate',
            score: score,
            sessionId: sessionId,
            name: playerName,
            color: myColor
        }));
    }
    
    // Update local scores
    scores.set(sessionId, { score, name: playerName, color: myColor });
    updateScoreboard();
}

// Update scoreboard display
function updateScoreboard() {
    // Sort scores highest first
    const sortedScores = Array.from(scores.entries())
        .sort((a, b) => b[1].score - a[1].score);
    
    // Clear scoreboard
    scoresListEl.innerHTML = '';
    
    // Add each score
    sortedScores.forEach(([id, data]) => {
        const scoreItem = document.createElement('li');
        scoreItem.style.color = data.color;
        scoreItem.textContent = `${data.name}: ${data.score}`;
        
        if (id === sessionId) {
            scoreItem.style.fontWeight = 'bold';
        }
        
        scoresListEl.appendChild(scoreItem);
    });
}

// Update status display with leader badge
function updateStatusDisplay() {
    let statusText = `Connected (Session: ${sessionId.slice(0, 6)}...)`;
    
    if (isLeader) {
        statusEl.innerHTML = `${statusText} <span class="leader-badge">LEADER</span>`;
    } else {
        statusEl.textContent = statusText;
    }
}

// Update particles based on all cursor positions
function updateParticles() {
    // Get all cursor positions including local mouse
    const cursors = Array.from(otherCursors.values()).map(cursor => ({
        x: parseInt(cursor.style.left),
        y: parseInt(cursor.style.top)
    }));
    
    // Add local cursor
    cursors.push({ x: mouseX, y: mouseY });
    
    particles.forEach(particle => {
        // Update pulse animation for powerups
        if (particle.isPowerup) {
            if (particle.pulseDirection > 0) {
                particle.pulseSize += 0.1;
                if (particle.pulseSize >= 1) particle.pulseDirection = -1;
            } else {
                particle.pulseSize -= 0.1;
                if (particle.pulseSize <= 0) particle.pulseDirection = 1;
            }
        }
        
        // Natural particle movement
        particle.speedX *= 0.99;
        particle.speedY *= 0.99;
        
        // Apply cursor influence if there are cursors
        if (cursors.length > 0) {
            // Find closest cursors for this particle
            const closestCursors = findClosestCursors(cursors, particle, 3);
            
            closestCursors.forEach(cursor => {
                // Calculate direction to cursor
                const dx = cursor.x - particle.x;
                const dy = cursor.y - particle.y;
                const distanceSq = dx * dx + dy * dy;
                const distance = Math.sqrt(distanceSq);
                
                // Create a gentle ripple effect when the mouse passes by
                // Only affect particles within a certain range
                if (distance < 150) {
                    // Calculate influence based on distance 
                    // Maximum at ~75px, then decreasing to 0 at 150px
                    const influence = Math.sin((Math.PI * distance) / 150) * 0.2;
                    
                    // Create a perpendicular force vector to make particles move aside
                    // rather than being attracted directly
                    const perpX = -dy / distance * influence;
                    const perpY = dx / distance * influence;
                    
                    // Apply the subtle movement force
                    particle.speedX += perpX;
                    particle.speedY += perpY;
                    
                    // Add a tiny bit of randomness for more natural movement
                    particle.speedX += (Math.random() - 0.5) * 0.05;
                    particle.speedY += (Math.random() - 0.5) * 0.05;
                }
            });
        }
        
        // Special behavior for magnet powerup
        if (activePowerup === "Magnet" && !particle.isPowerup) {
            const dx = mouseX - particle.x;
            const dy = mouseY - particle.y;
            const distSq = dx * dx + dy * dy;
            
            if (distSq < 150 * 150) {
                const distance = Math.sqrt(distSq);
                const attractionForce = 0.5 * (1 - (distance / 150));
                
                particle.speedX += (dx / distance) * attractionForce;
                particle.speedY += (dy / distance) * attractionForce;
            }
        }
        
        // Apply speed boost to player's movement when active
        const speedMultiplier = activePowerup === "Speed Boost" ? 2 : 1;
        
        // Update position
        particle.x += particle.speedX;
        particle.y += particle.speedY;
        
        // Wrap around edges
        if (particle.x < 0) particle.x = canvas.width;
        if (particle.x > canvas.width) particle.x = 0;
        if (particle.y < 0) particle.y = canvas.height;
        if (particle.y > canvas.height) particle.y = 0;
    });
    
    // Check for particle collection
    checkParticleCollection();
    
    // If we're the leader, periodically send particle state to keep all clients in sync
    if (isLeader) {
        const now = Date.now();
        if (now - lastParticleUpdate > PARTICLE_SYNC_INTERVAL) {
            sendParticleState();
            lastParticleUpdate = now;
        }
    }
}

// Send current particle state to all clients for synchronization
function sendParticleState() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Send minimal information for efficiency
        const minimalParticles = particles.map(p => ({
            id: p.id,
            x: Math.round(p.x),
            y: Math.round(p.y),
            s: p.size,
            vx: p.speedX,
            vy: p.speedY,
            c: p.color,
            sp: p.isSpecial || false,
            v: p.value || 1,
            pp: p.isPowerup || false,
            pt: p.powerupType || null,
            d: p.duration || 0,
            ps: p.pulseSize || 0,
            pd: p.pulseDirection || 1
        }));
        
        ws.send(JSON.stringify({
            type: 'particleState',
            particles: minimalParticles
        }));
    }
}

// Find closest cursors to a particle
function findClosestCursors(cursors, particle, limit) {
    // If we have fewer cursors than the limit, return all of them
    if (cursors.length <= limit) return cursors;
    
    // Calculate distances
    const withDistances = cursors.map(cursor => {
        const dx = cursor.x - particle.x;
        const dy = cursor.y - particle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return { cursor, distance };
    });
    
    // Sort by distance and take the closest 'limit' cursors
    return withDistances
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map(item => item.cursor);
}

// Connect to WebSocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const roomId = new URLSearchParams(window.location.search).get('roomId') || 'default';
    
    // For testing, replace with your actual WebSocket URL
    const wsUrl = `${protocol}//${window.location.host}/room?roomId=${roomId}`;
    console.log('Connecting to WebSocket URL:', wsUrl);
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        statusEl.textContent = 'Connected';
        reconnectAttempts = 0;
        
        // Send initial position
        sendMousePosition(mouseX, mouseY);
        
        // Start countdown to game start
        startCountdown();
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
            case 'connected':
                sessionId = message.sessionId;
                isLeader = message.isLeader;
                
                if (isLeader) {
                    leaderSessionId = sessionId;
                    console.log('This client is the leader for game simulation');
                }
                
                // Update status display with leader badge if needed
                updateStatusDisplay();
                
                // Also inform others that we're the leader (if we are)
                if (isLeader && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'leaderUpdate',
                        sessionId: sessionId,
                        isLeader: true
                    }));
                }
                break;
                
            case 'position':
                updateCursor(message.sessionId, message.x, message.y, message.color);
                updateParticipantCount();
                break;
                
            case 'positions':
                for (const [id, position] of Object.entries(message.positions)) {
                    if (id !== sessionId) {
                        updateCursor(id, position.x, position.y, position.color);
                    }
                }
                updateParticipantCount();
                break;
                
            case 'leave':
                removeCursor(message.sessionId);
                updateParticipantCount();
                
                // If the leader left, we might need to become the new leader
                if (message.sessionId === leaderSessionId && otherCursors.size === 0) {
                    isLeader = true;
                    leaderSessionId = sessionId;
                    updateStatusDisplay();
                    
                    console.log('Taking over as leader for game simulation');
                    
                    if (gameActive && particles.length === 0) {
                        initParticles();
                    }
                    
                    sendParticleState();
                    
                    // Inform others about leadership change
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'leaderUpdate',
                            sessionId: sessionId,
                            isLeader: true
                        }));
                    }
                }
                break;
            
            case 'particleState':
                // Only update if we're not the leader
                if (!isLeader) {
                    updateParticlesFromSync(message.particles);
                }
                break;
                
            case 'leaderUpdate':
                // Update our knowledge of who is the leader
                leaderSessionId = message.sessionId;
                
                // If this is about another client, update their cursor
                if (message.sessionId !== sessionId && otherCursors.has(message.sessionId)) {
                    const cursor = otherCursors.get(message.sessionId);
                    
                    if (message.isLeader) {
                        cursor.classList.add('leader-cursor');
                    } else {
                        cursor.classList.remove('leader-cursor');
                    }
                }
                break;
                
            case 'particleCollected':
                // If we're the leader and this is another player collecting a particle
                if (isLeader && message.sessionId !== sessionId) {
                    const particleIndex = particles.findIndex(p => p.id === message.particleId);
                    if (particleIndex !== -1) {
                        particles.splice(particleIndex, 1);
                        
                        // Spawn a new particle if we're under the maximum
                        if (particles.length < MAX_PARTICLE_COUNT) {
                            setTimeout(() => {
                                spawnParticle();
                                sendParticleState();
                            }, Math.random() * 1000 + 500);
                        }
                        
                        sendParticleState();
                    }
                }
                break;
                
            case 'scoreUpdate':
                // Update the scoreboard with the new score
                scores.set(message.sessionId, {
                    score: message.score,
                    name: message.name,
                    color: message.color
                });
                updateScoreboard();
                break;
                
            case 'powerupActivated':
                // Update the player's cursor to show they have a powerup
                if (message.sessionId !== sessionId && otherCursors.has(message.sessionId)) {
                    const cursor = otherCursors.get(message.sessionId);
                    cursor.style.boxShadow = `0 0 15px ${message.powerupType === "Speed Boost" ? "#FFD700" : 
                                            message.powerupType === "Magnet" ? "#9C27B0" : 
                                            message.powerupType === "Double Points" ? "#00BCD4" : "white"}`;
                }
                break;
                
            case 'powerupDeactivated':
                // Remove powerup effect from player's cursor
                if (message.sessionId !== sessionId && otherCursors.has(message.sessionId)) {
                    const cursor = otherCursors.get(message.sessionId);
                    cursor.style.boxShadow = 'none';
                }
                break;
        }
    };
    
    ws.onclose = () => {
        statusEl.textContent = 'Disconnected. Reconnecting...';
        
        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
            const timeout = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
            reconnectAttempts++;
            
            setTimeout(connectWebSocket, timeout);
        } else {
            statusEl.textContent = 'Failed to reconnect. Please refresh the page.';
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        statusEl.textContent = 'Connection error';
    };
}

// Update particles from leader's sync message
function updateParticlesFromSync(syncedParticles) {
    // Initialize particles if this is the first update
    if (particles.length === 0) {
        syncedParticles.forEach(p => {
            particles.push({
                id: p.id,
                x: p.x,
                y: p.y,
                size: p.s,
                speedX: p.vx,
                speedY: p.vy,
                color: p.c,
                isSpecial: p.sp || false,
                value: p.v || 1,
                isPowerup: p.pp || false,
                powerupType: p.pt || null,
                duration: p.d || 0,
                pulseSize: p.ps || 0,
                pulseDirection: p.pd || 1
            });
        });
    } else {
        // Create a map of existing particles by ID for faster lookups
        const particleMap = new Map();
        particles.forEach(p => particleMap.set(p.id, p));
        
        // Create a set of synced particle IDs to track which ones to keep
        const syncedIds = new Set(syncedParticles.map(p => p.id));
        
        // Remove particles that no longer exist in the synced state
        for (let i = particles.length - 1; i >= 0; i--) {
            if (!syncedIds.has(particles[i].id)) {
                particles.splice(i, 1);
            }
        }
        
        // Update existing particles and add new ones
        syncedParticles.forEach(p => {
            const existingParticle = particleMap.get(p.id);
            
            if (existingParticle) {
                // Apply smoother interpolation by taking weighted average
                // Use a higher weight for the server position to prevent jitter
                existingParticle.x = existingParticle.x * 0.2 + p.x * 0.8;
                existingParticle.y = existingParticle.y * 0.2 + p.y * 0.8;
                
                // Update velocity directly to maintain consistency
                existingParticle.speedX = p.vx;
                existingParticle.speedY = p.vy;
                
                // Update other properties
                if (p.s !== undefined) existingParticle.size = p.s;
                if (p.c !== undefined) existingParticle.color = p.c;
                if (p.sp !== undefined) existingParticle.isSpecial = p.sp;
                if (p.v !== undefined) existingParticle.value = p.v;
                if (p.pp !== undefined) existingParticle.isPowerup = p.pp;
                if (p.pt !== undefined) existingParticle.powerupType = p.pt;
                if (p.d !== undefined) existingParticle.duration = p.d;
                if (p.ps !== undefined) existingParticle.pulseSize = p.ps;
                if (p.pd !== undefined) existingParticle.pulseDirection = p.pd;
            } else {
                // Add new particles that don't exist locally
                particles.push({
                    id: p.id,
                    x: p.x,
                    y: p.y,
                    size: p.s,
                    speedX: p.vx,
                    speedY: p.vy,
                    color: p.c,
                    isSpecial: p.sp || false,
                    value: p.v || 1,
                    isPowerup: p.pp || false,
                    powerupType: p.pt || null,
                    duration: p.d || 0,
                    pulseSize: p.ps || 0,
                    pulseDirection: p.pd || 1
                });
            }
        });
    }
}

/// Create or update cursor for other participant
function updateCursor(id, x, y, color) {
    if (!otherCursors.has(id)) {
        // Create new cursor element
        const cursorEl = document.createElement('div');
        cursorEl.className = 'cursor';
        cursorEl.style.backgroundColor = color;
        
        // Add an inner dot
        cursorEl.innerHTML = `
            <div style="
                position: absolute;
                top: 50%;
                left: 50%;
                width: 6px;
                height: 6px;
                background-color: white;
                border-radius: 50%;
                transform: translate(-50%, -50%);
            "></div>
        `;
        
        // Add leader class if this cursor belongs to the leader
        if (id === leaderSessionId) {
            cursorEl.classList.add('leader-cursor');
        }
        
        document.body.appendChild(cursorEl);
        otherCursors.set(id, cursorEl);
    }
    
    // Update cursor position
    const cursor = otherCursors.get(id);
    cursor.style.left = x + 'px';
    cursor.style.top = y + 'px';
}

// Remove cursor when participant leaves
function removeCursor(id) {
    if (otherCursors.has(id)) {
        const cursor = otherCursors.get(id);
        document.body.removeChild(cursor);
        otherCursors.delete(id);
    }
}

// Update participant count display
function updateParticipantCount() {
    const count = otherCursors.size + 1; // Including the current user
    participantsEl.textContent = `Participants: ${count}`;
}

// Throttled mouse position sending
function sendMousePosition(x, y) {
    const now = Date.now();
    
    // Only send if enough time has passed or position changed significantly
    if (ws && ws.readyState === WebSocket.OPEN && 
        (now - lastSendTime > SEND_THROTTLE || 
         Math.abs(x - lastSentX) > 10 || 
         Math.abs(y - lastSentY) > 10)) {
        
        ws.send(JSON.stringify({
            type: 'mousemove',
            x: x,
            y: y,
            color: myColor,
            isLeader: isLeader // Include leader status in position updates
        }));
        
        lastSendTime = now;
        lastSentX = x;
        lastSentY = y;
    }
}

// Build spatial partitioning grid for more efficient connection drawing
function buildSpatialGrid(particles) {
    const cellSize = CONNECTION_DISTANCE_THRESHOLD;
    const grid = {};
    
    particles.forEach(particle => {
        // Calculate grid cell for this particle
        const cellX = Math.floor(particle.x / cellSize);
        const cellY = Math.floor(particle.y / cellSize);
        const cellId = `${cellX},${cellY}`;
        
        // Add particle to its cell
        if (!grid[cellId]) {
            grid[cellId] = [];
        }
        grid[cellId].push(particle);
    });
    
    return grid;
}

// Draw connections using spatial grid
function drawParticleConnections(particle, grid) {
    const cellSize = CONNECTION_DISTANCE_THRESHOLD;
    const cellX = Math.floor(particle.x / cellSize);
    const cellY = Math.floor(particle.y / cellSize);
    
    // Check the current cell and 8 neighboring cells
    for (let xOffset = -1; xOffset <= 1; xOffset++) {
        for (let yOffset = -1; yOffset <= 1; yOffset++) {
            const checkCellId = `${cellX + xOffset},${cellY + yOffset}`;
            
            if (grid[checkCellId]) {
                grid[checkCellId].forEach(otherParticle => {
                    // Skip same particle
                    if (particle.id === otherParticle.id) return;
                    
                    // Skip connections between powerups
                    if (particle.isPowerup && otherParticle.isPowerup) return;
                    
                    // Calculate distance with faster square distance check
                    const dx = particle.x - otherParticle.x;
                    const dy = particle.y - otherParticle.y;
                    const distanceSq = dx * dx + dy * dy;
                    
                    if (distanceSq < CONNECTION_DISTANCE_THRESHOLD_SQ) {
                        const opacity = 1 - (Math.sqrt(distanceSq) / CONNECTION_DISTANCE_THRESHOLD);
                        ctx.beginPath();
                        ctx.strokeStyle = particle.isPowerup ? particle.color : particle.color;
                        ctx.lineWidth = particle.isPowerup || otherParticle.isPowerup ? 0.5 : 0.2;
                        ctx.globalAlpha = opacity;
                        ctx.moveTo(particle.x, particle.y);
                        ctx.lineTo(otherParticle.x, otherParticle.y);
                        ctx.stroke();
                        ctx.globalAlpha = 1;
                    }
                });
            }
        }
    }
}

// Throttled mouse move event handler
let isMouseMoveThrottled = false;
document.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    
    if (!isMouseMoveThrottled) {
        isMouseMoveThrottled = true;
        
        // Send position update
        sendMousePosition(mouseX, mouseY);
        
        // Reset throttle after a delay
        setTimeout(() => {
            isMouseMoveThrottled = false;
            // Send latest position
            sendMousePosition(mouseX, mouseY);
        }, 16);  // ~60fps
    }
});

// Throttled touch move event handler
let isTouchMoveThrottled = false;
document.addEventListener('touchmove', (event) => {
    event.preventDefault();
    mouseX = event.touches[0].clientX;
    mouseY = event.touches[0].clientY;
    
    if (!isTouchMoveThrottled) {
        isTouchMoveThrottled = true;
        
        // Send position update
        sendMousePosition(mouseX, mouseY);
        
        // Reset throttle after a delay
        setTimeout(() => {
            isTouchMoveThrottled = false;
            // Send latest position
            sendMousePosition(mouseX, mouseY);
        }, 16);  // ~60fps
    }
});

// Debounce resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Store the current dimensions before resizing
        const oldWidth = canvas.width;
        const oldHeight = canvas.height;
        
        // Update canvas dimensions
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        // Also resize offscreen canvas
        offscreenCanvas.width = canvas.width;
        offscreenCanvas.height = canvas.height;
        
        // Adjust particle positions to keep them within the new bounds
        if (particles.length > 0) {
            particles.forEach(particle => {
                // Scale the positions proportionally
                if (oldWidth > 0 && oldHeight > 0) {
                    // Calculate the position as a percentage of the old dimensions
                    const widthRatio = canvas.width / oldWidth;
                    const heightRatio = canvas.height / oldHeight;
                    
                    // Apply the scaling to keep relative positions
                    particle.x = Math.min(Math.max(particle.x * widthRatio, 0), canvas.width);
                    particle.y = Math.min(Math.max(particle.y * heightRatio, 0), canvas.height);
                } else {
                    // Fallback: just ensure particles are within bounds
                    particle.x = Math.min(Math.max(particle.x, 0), canvas.width);
                    particle.y = Math.min(Math.max(particle.y, 0), canvas.height);
                }
            });
            
            // If we're the leader, send the updated particle state
            if (isLeader) {
                sendParticleState();
            }
        }
    }, 250);
});

// Animation loop with time-based updates
let lastFrameTime = 0;
const targetFPS = 60;
const frameInterval = 1000 / targetFPS;

function animate(timestamp) {
    // Calculate time since last frame
    const elapsed = timestamp - lastFrameTime;
    
    // Only render if enough time has passed
    if (elapsed > frameInterval) {
        lastFrameTime = timestamp - (elapsed % frameInterval);
        
        // Update particle physics if we have particles
        if (particles.length > 0) {
            updateParticles();
        }
        
        // Efficient background clearing with trail effect
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw user's cursor
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 10, 0, Math.PI * 2);
        ctx.fillStyle = myColor;
        ctx.fill();
        
        // Add a glow effect if user has an active powerup
        if (activePowerup) {
            const powerupColor = activePowerup === "Speed Boost" ? "#FFD700" : 
                              activePowerup === "Magnet" ? "#9C27B0" : 
                              activePowerup === "Double Points" ? "#00BCD4" : 
                              myColor;
                              
            ctx.beginPath();
            ctx.arc(mouseX, mouseY, 15, 0, Math.PI * 2);
            ctx.strokeStyle = powerupColor;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw a second ring showing the collection radius for magnet
            if (activePowerup === "Magnet") {
                ctx.beginPath();
                ctx.arc(mouseX, mouseY, 50, 0, Math.PI * 2);
                ctx.strokeStyle = "#9C27B0";
                ctx.lineWidth = 1;
                ctx.setLineDash([5, 5]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        
        // Draw leader indicator around local cursor if we're the leader
        if (isLeader) {
            ctx.beginPath();
            ctx.arc(mouseX, mouseY, 20, 0, Math.PI * 2);
            ctx.strokeStyle = '#FFD700'; // Gold color
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        
        // Only process particles if we have them
        if (particles.length > 0) {
            // Use spatial partitioning for connections
            const grid = buildSpatialGrid(particles);
            
            // Draw particles and connections efficiently
            particles.forEach(particle => {
                // Draw particle
                ctx.beginPath();
                
                if (particle.isPowerup) {
                    // Draw powerup with pulse effect
                    const pulseSize = particle.size + (particle.pulseSize * 5);
                    
                    // Draw outer glow
                    ctx.arc(particle.x, particle.y, pulseSize, 0, Math.PI * 2);
                    const gradient = ctx.createRadialGradient(
                        particle.x, particle.y, particle.size,
                        particle.x, particle.y, pulseSize
                    );
                    gradient.addColorStop(0, particle.color);
                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fill();
                    
                    // Draw powerup
                    ctx.beginPath();
                    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                    ctx.fillStyle = particle.color;
                    ctx.fill();
                    
                    // Draw inner pattern to indicate powerup type
                    ctx.beginPath();
                    if (particle.powerupType === "Speed Boost") {
                        // Draw lightning bolt
                        ctx.fillStyle = "#FFFFFF";
                        ctx.moveTo(particle.x - particle.size/3, particle.y - particle.size/2);
                        ctx.lineTo(particle.x + particle.size/6, particle.y - particle.size/6);
                        ctx.lineTo(particle.x - particle.size/6, particle.y);
                        ctx.lineTo(particle.x + particle.size/3, particle.y + particle.size/2);
                        ctx.fill();
                    } else if (particle.powerupType === "Magnet") {
                        // Draw magnet shape
                        ctx.fillStyle = "#FFFFFF";
                        ctx.arc(particle.x, particle.y, particle.size/2, 0, Math.PI * 2);
                        ctx.fill();
                    } else if (particle.powerupType === "Double Points") {
                        // Draw x2 text
                        ctx.fillStyle = "#FFFFFF";
                        ctx.font = `bold ${particle.size}px Arial`;
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("x2", particle.x, particle.y);
                    }
                } else {
                    // Draw regular or special particle
                    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                    ctx.fillStyle = particle.color;
                    ctx.fill();
                    
                    // Add a glow effect for special particles
                    if (particle.isSpecial) {
                        ctx.beginPath();
                        ctx.arc(particle.x, particle.y, particle.size + 3, 0, Math.PI * 2);
                        const gradient = ctx.createRadialGradient(
                            particle.x, particle.y, particle.size,
                            particle.x, particle.y, particle.size + 3
                        );
                        gradient.addColorStop(0, particle.color);
                        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                        ctx.fillStyle = gradient;
                        ctx.fill();
                    }
                }
                
                // Find and draw connections using spatial grid
                drawParticleConnections(particle, grid);
            });
        }
    }
    
    // Continue animation
    requestAnimationFrame(animate);
}

// Connect to WebSocket when page loads
connectWebSocket();

// Start animation
requestAnimationFrame(animate);