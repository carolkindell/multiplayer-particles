// Durable Object class for particle game
export class ParticleRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    // Store last known positions to send to new connections
    this.positions = new Map();
    // Store player scores
    this.scores = new Map();
  }
  
  // Handle new WebSocket connections
  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === "/websocket") {
      // Accept the WebSocket connection
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 400 });
      }
      
      const [client, server] = Object.values(new WebSocketPair());
      await this.handleSession(server);
      
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }
    
    return new Response("Not found", { status: 404 });
  }
  
  // Handle WebSocket session
  async handleSession(webSocket) {
    webSocket.accept();
    
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, webSocket);
    
    // Send the current participants to the new connection
    const existingPositions = JSON.stringify({
      type: "positions",
      positions: Object.fromEntries(this.positions)
    });
    webSocket.send(existingPositions);
    
    // Send current scores to the new connection
    if (this.scores.size > 0) {
      const scoresData = JSON.stringify({
        type: "scoreUpdate",
        scores: Object.fromEntries(this.scores)
      });
      webSocket.send(scoresData);
    }
    
    // Set up event handlers
    webSocket.addEventListener("message", async (msg) => {
      try {
        const data = JSON.parse(msg.data);
        
        if (data.type === "mousemove") {
          // Store the cursor position
          this.positions.set(sessionId, {
            x: data.x,
            y: data.y,
            color: data.color || "#FFFFFF"
          });
          
          // Broadcast cursor position to other clients
          this.broadcast(sessionId, {
            type: "position",
            sessionId: sessionId,
            x: data.x,
            y: data.y,
            color: data.color || "#FFFFFF"
          });
        }
        // Handle particle state sync from leader
        else if (data.type === "particleState") {
          // Pass through the particle state to all clients
          this.broadcast(sessionId, data);
        }
        // Handle particle collection events
        else if (data.type === "particleCollected") {
          // Broadcast the collection event to all other clients
          this.broadcast(sessionId, data);
        }
        // Handle score updates
        else if (data.type === "scoreUpdate") {
          // Store the score
          this.scores.set(sessionId, {
            score: data.score,
            name: data.name,
            color: data.color
          });
          
          // Broadcast to all clients
          this.broadcast(sessionId, data);
        }
        // Handle powerup activation
        else if (data.type === "powerupActivated") {
          // Broadcast to all clients
          this.broadcast(sessionId, data);
        }
        // Handle powerup deactivation
        else if (data.type === "powerupDeactivated") {
          // Broadcast to all clients
          this.broadcast(sessionId, data);
        }
        // Handle leader updates
        else if (data.type === "leaderUpdate") {
          // Broadcast to all clients
          this.broadcast(sessionId, data);
        }
      } catch (err) {
        console.error("Error handling WebSocket message", err);
      }
    });
    
    webSocket.addEventListener("close", () => {
      this.sessions.delete(sessionId);
      this.positions.delete(sessionId);
      this.scores.delete(sessionId);
      
      this.broadcast(sessionId, {
        type: "leave",
        sessionId: sessionId
      });
    });
    
    webSocket.send(JSON.stringify({
      type: "connected",
      sessionId: sessionId,
      isLeader: this.sessions.size === 1 // First client is the leader
    }));
  }
  
  // Broadcast message to all connected clients except the sender
  broadcast(senderSessionId, message) {
    const messageStr = typeof message === "string" ? message : JSON.stringify(message);
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (sessionId !== senderSessionId) {
        try {
          session.send(messageStr);
        } catch (err) {
          console.error(`Error sending to session ${sessionId}:`, err);
          this.sessions.delete(sessionId);
        }
      }
    }
  }
  
  // Broadcast to all connected clients including the sender
  broadcastToAll(message) {
    const messageStr = typeof message === "string" ? message : JSON.stringify(message);
    
    for (const session of this.sessions.values()) {
      try {
        session.send(messageStr);
      } catch (err) {
        console.error(`Error sending to session:`, err);
      }
    }
  }
}

// Main worker entry point
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      
      if (request.method === "OPTIONS") {
        return handleCors();
      }
  
      if (url.pathname === "/room") {
        const roomId = url.searchParams.get("roomId") || "default";
        const roomObject = env.PARTICLE_ROOM.get(env.PARTICLE_ROOM.idFromName(roomId));
        
        const newUrl = new URL(url);
        newUrl.pathname = "/websocket";
        
        return roomObject.fetch(new Request(newUrl, request));
      }
      
      return new Response(JSON.stringify({
        error: "Not found",
        availableEndpoints: ["/", "/room"]
      }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders()
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: error.message || "Internal server error"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...getCorsHeaders()
        }
      });
    }
  }
};

function handleCors() {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders()
  });
}

function getCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}