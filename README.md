# Multiplayer Particle Collector Game

A real-time multiplayer particle collection game built with Cloudflare Workers and Durable Objects.

## Features

- **Real-time multiplayer** - See other players' cursors and compete live
- **Particle collection** - Collect particles to earn points
- **Special particles** - Higher value particles worth more points
- **Powerups** - Speed Boost, Magnet, and Double Points
- **Leader system** - Distributed game state management
- **Responsive design** - Works on desktop and mobile

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5 Canvas
- **Backend**: Cloudflare Workers + Durable Objects
- **Real-time**: WebSockets
- **Deployment**: Cloudflare Pages/Workers

## Quick Start

1. Clone the repository
2. Install Wrangler CLI: `npm install -g wrangler`
3. Deploy: `wrangler deploy`
4. Visit your deployed URL to play!

## Game Rules

- Move your cursor to collect particles
- Special particles (larger, glowing) are worth 5-9 points
- Regular particles are worth 1 point
- Powerups provide temporary abilities:
  - ⚡ **Speed Boost**: Faster movement
  - 🧲 **Magnet**: Larger collection radius
  - ✨ **Double Points**: 2x point multiplier
- Games last 2 minutes
- Highest score wins!

## Configuration

Edit `wrangler.toml` to customize:
- Domain routing
- Durable Object bindings
- Environment settings

## License

MIT
