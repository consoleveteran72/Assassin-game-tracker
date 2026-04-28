/**
 * Assassin Game Tracker - Backend Core
 * 
 * Architecture:
 * - Express.js handles routing and session management.
 * - PostgreSQL stores users, games, and participants.
 * - HTMX partials (/partial/...) allow the frontend to update bits of the page
 *   by sending raw HTML instead of JSON.
 */

const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const session = require("express-session");
const multer = require("multer");

const app = express();

/**
 * PostgreSQL connection pool.
 * Manages multiple persistent connections to the database for efficiency.
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://postgres:nemtudom@localhost:5432/Assassin-game",
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

/**
 * Session middleware.
 * Sets a 'connect.sid' cookie in the browser to track logged-in users.
 * req.session.user stores our custom user data.
 */
app.use(
    session({
        secret: process.env.SESSION_SECRET || "hahgjkfdh",
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 1000 * 60 * 60 }, // 1 hour session lifetime
    }),
);

// Middleware to parse incoming request bodies (forms and JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files (HTML, CSS, Client-side JS) from the 'public' folder
app.use(express.static("public"));

const saltRounds = 8; // Computational cost for bcrypt hashing

/**
 * Authentication Guard Middleware.
 * Stops execution and returns 401 if user session is missing.
 */
const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    res.status(401).send("Unauthorized");
};

/**
 * Entry point. Serves the main application file.
 */
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/public/index.html");
});

/**
 * User Registration.
 * 1. Hashes password for security.
 * 2. Inserts user into DB.
 * 3. Automatically logs them in by setting req.session.user.
 */
app.post("/register", async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        const result = await pool.query(
            "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username, profile_picture_path, games_played, games_won, kills",
            [username, hashedPassword],
        );
        const user = result.rows[0];
        req.session.user = {
            id: user.id,
            username: user.username,
            profile_picture_path: user.profile_picture_path,
            games_played: user.games_played,
            games_won: user.games_won,
            kills: user.kills,
        };
        res.json({ success: true, user: user.username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Username already exists or database error" });
    }
});

/**
 * User Login.
 * Compares provided password with the stored hash using bcrypt.compare.
 */
app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: "User not found" });
        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Wrong password" });
        req.session.user = {
            id: user.id,
            username: user.username,
            profile_picture_path: user.profile_picture_path,
            games_played: user.games_played,
            games_won: user.games_won,
            kills: user.kills,
        };
        res.json({ success: true, user: user.username });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

/**
 * Logout.
 * Destroys server-side session and clears the browser cookie.
 */
app.post("/logout", (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

/**
 * Profile Data API.
 * Returns fresh user stats for the Profile tab.
 */
app.get("/profile-data", isAuthenticated, async (req, res) => {
    const result = await pool.query("SELECT username, profile_picture_path, games_played, games_won, kills FROM users WHERE id = $1", [req.session.user.id]);
    res.json(result.rows[0]);
});

/**
 * Helper: Render Ongoing Games List.
 * Generates HTML snippets for HTMX to inject into the Home page.
 */
async function renderOngoingGames(userId, simple = false) {
    const result = await pool.query(`
        SELECT g.*, gp.is_alive, 
        (SELECT COUNT(*) FROM game_participants WHERE game_id = g.id) as player_count
        FROM games g 
        JOIN game_participants gp ON g.id = gp.game_id 
        WHERE gp.user_id = $1
    `, [userId]);
    
    let html = "";
    for (const game of result.rows) {
        html += `
            <div class="game-card">
                <h3>Code: ${game.invite_code}</h3>
                <p>Status: ${game.status.toUpperCase()}</p>
                <p>Players: ${game.player_count}</p>
                <a href="game.html?id=${game.id}" class="button-link">Go to Game</a>
            </div>
        `;
    }
    return html || "<p>No active games.</p>";
}

/**
 * HTMX Partial: Simple Game List.
 * Called by the home page every 5 seconds (polling).
 */
app.get("/partial/games/ongoing-simple", isAuthenticated, async (req, res) => {
    res.send(await renderOngoingGames(req.session.user.id, true));
});

/**
 * HTMX Partial: Active Game Details.
 * Returns a full dashboard for a specific active game, including target info and kill button.
 */
app.get("/partial/games/active-details/:id", isAuthenticated, async (req, res) => {
    const gameId = req.params.id;
    const userId = req.session.user.id;
    const gameRes = await pool.query("SELECT * FROM games WHERE id = $1", [gameId]);
    if (gameRes.rows.length === 0) return res.send("<p>Game not found.</p>");
    const game = gameRes.rows[0];
    
    // Join users with participants to get names + statuses
    const playerRes = await pool.query(`
        SELECT gp.*, u.username, u.profile_picture_path,
        (SELECT username FROM users WHERE id = gp.target_id) as target_username,
        (SELECT profile_picture_path FROM users WHERE id = gp.target_id) as target_pfp
        FROM game_participants gp 
        JOIN users u ON gp.user_id = u.id 
        WHERE gp.game_id = $1
    `, [gameId]);
    
    const me = playerRes.rows.find(p => p.user_id === userId);
    if (!me) return res.send("<p>You are not in this game.</p>");
    
    let html = `
        <div class="active-game-view">
            <h2>Game ${game.invite_code} (${game.status.toUpperCase()})</h2>
            <div class="my-status">
                <p>Your Status: <strong>${me.is_alive ? 'ALIVE' : 'DEAD'}</strong></p>
                ${me.is_alive && game.status === 'active' ? `
                    <p>Target:</p>
                    <div style="display: flex; align-items: center; justify-content: center; gap: 15px; margin: 1rem 0;">
                        <img src="${me.target_pfp}" style="width:60px; height:60px; border-radius:50%; object-fit:cover; border: 3px solid var(--danger);">
                        <span class="target-name" style="margin: 0;">${me.target_username}</span>
                    </div>
                    <button hx-post="/games/kill" hx-vals='{"game_id": ${gameId}}' hx-target="#game-container" style="margin-bottom: 10px;">Kill Target</button>
                ` : ''}
                ${game.status === 'lobby' && game.host_id === userId ? `
                    <button hx-post="/games/start" hx-vals='{"game_id": ${gameId}}' hx-target="#game-container" style="margin-bottom: 10px;">Start Game</button>
                ` : ''}
                <button hx-post="/games/leave" hx-vals='{"game_id": ${gameId}}' hx-target="#game-container">Leave Game</button>
            </div>
            <h3>Players:</h3>
            <ul class="player-list">
    `;
    for (const p of playerRes.rows) {
        html += `
            <li>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <img src="${p.profile_picture_path}" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">
                    <span>${p.username}</span>
                </div>
                <span>${p.is_alive ? 'Alive' : 'Dead'}</span>
            </li>`;
    }
    html += `</ul></div>`;
    res.send(html);
});

/**
 * Game Creation.
 * Generates a random 6-character code and inserts host into participants.
 */
app.post("/games/create", isAuthenticated, async (req, res) => {
    const { is_public, player_limit } = req.body;
    const invite_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    try {
        const result = await pool.query(
            "INSERT INTO games (host_id, invite_code, is_public, player_limit) VALUES ($1, $2, $3, $4) RETURNING id",
            [req.session.user.id, invite_code, is_public === "true", player_limit || null],
        );
        const gameId = result.rows[0].id;
        await pool.query("INSERT INTO game_participants (game_id, user_id) VALUES ($1, $2)", [gameId, req.session.user.id]);
        res.send(await renderOngoingGames(req.session.user.id, true));
    } catch (err) {
        console.error(err);
        res.status(500).send("Create failed");
    }
});

/**
 * Join Game.
 * Adds user to game_participants if game is in 'lobby' state and not full.
 */
app.post("/games/join", isAuthenticated, async (req, res) => {
    const { invite_code } = req.body;
    try {
        const gameResult = await pool.query("SELECT * FROM games WHERE invite_code = $1 AND status = 'lobby'", [invite_code]);
        if (gameResult.rows.length === 0) return res.status(404).send("Not found");
        const game = gameResult.rows[0];
        const participants = await pool.query("SELECT COUNT(*) FROM game_participants WHERE game_id = $1", [game.id]);
        if (game.player_limit && parseInt(participants.rows[0].count) >= game.player_limit) return res.status(400).send("Full");
        await pool.query("INSERT INTO game_participants (game_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [game.id, req.session.user.id]);
        
        // Auto-start if max players reached
        if (game.player_limit && parseInt(participants.rows[0].count) + 1 >= game.player_limit) await startGame(game.id);
        
        res.send(await renderOngoingGames(req.session.user.id, true));
    } catch (err) {
        console.error(err);
        res.status(500).send("Join failed");
    }
});

/**
 * Start Game (Host only).
 * Triggers the target assignment logic and sets status to 'active'.
 */
app.post("/games/start", isAuthenticated, async (req, res) => {
    const { game_id } = req.body;
    try {
        const game = await pool.query("SELECT host_id FROM games WHERE id = $1", [game_id]);
        if (game.rows[0].host_id !== req.session.user.id) return res.status(403).send("Host only");
        await startGame(game_id);
        res.redirect(`/partial/games/active-details/${game_id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Start failed");
    }
});

/**
 * Target Assignment Logic.
 * 1. Shuffles player list.
 * 2. Links them in a circular chain (A->B, B->C, C->A).
 */
async function startGame(gameId) {
    const players = await pool.query("SELECT user_id FROM game_participants WHERE game_id = $1", [gameId]);
    const playerIds = players.rows.map(r => r.user_id);
    if (playerIds.length < 2) return;
    
    // Fisher-Yates Shuffle
    for (let i = playerIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }
    
    // Circular Loop
    for (let i = 0; i < playerIds.length; i++) {
        const killerId = playerIds[i];
        const targetId = playerIds[(i + 1) % playerIds.length];
        await pool.query("UPDATE game_participants SET target_id = $1 WHERE game_id = $2 AND user_id = $3", [targetId, gameId, killerId]);
    }
    await pool.query("UPDATE games SET status = 'active' WHERE id = $1", [gameId]);
    await pool.query("UPDATE users SET games_played = games_played + 1 WHERE id = ANY($1)", [playerIds]);
}

/**
 * Kill Action.
 * 1. Validates killer is alive.
 * 2. Marks victim as dead.
 * 3. Killer inherits victim's target.
 * 4. Checks if killer is last survivor (Win detection).
 */
app.post("/games/kill", isAuthenticated, async (req, res) => {
    const { game_id } = req.body;
    try {
        const p = await pool.query("SELECT target_id, is_alive FROM game_participants WHERE game_id = $1 AND user_id = $2", [game_id, req.session.user.id]);
        if (!p.rows[0].is_alive) return res.status(403).send("Dead");
        
        const targetId = p.rows[0].target_id;
        const target = await pool.query("SELECT target_id FROM game_participants WHERE game_id = $1 AND user_id = $2", [game_id, targetId]);
        const nextTargetId = target.rows[0].target_id;
        
        // Perform kill
        await pool.query("UPDATE game_participants SET is_alive = false, target_id = NULL WHERE game_id = $1 AND user_id = $2", [game_id, targetId]);
        // Chain target
        await pool.query("UPDATE game_participants SET target_id = $1 WHERE game_id = $2 AND user_id = $3", [nextTargetId, game_id, req.session.user.id]);
        // Track stats
        await pool.query("UPDATE users SET kills = kills + 1 WHERE id = $1", [req.session.user.id]);
        
        // Winner Check
        const alive = await pool.query("SELECT user_id FROM game_participants WHERE game_id = $1 AND is_alive = true", [game_id]);
        if (alive.rows.length === 1) {
            const winnerId = alive.rows[0].user_id;
            await pool.query("UPDATE users SET games_won = games_won + 1 WHERE id = $1", [winnerId]);
            await pool.query("DELETE FROM games WHERE id = $1", [game_id]); // Cleanup room
            return res.send("<p>Game over! You win!</p>");
        }
        res.redirect(`/partial/games/active-details/${game_id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Kill failed");
    }
});

/**
 * Leave Game.
 * If active: Transfers target to the killer before leaving.
 * If room becomes empty or one survivor remains: Deletes the game room.
 */
app.post("/games/leave", isAuthenticated, async (req, res) => {
    const { game_id } = req.body;
    try {
        const p = await pool.query("SELECT is_alive, target_id FROM game_participants WHERE game_id = $1 AND user_id = $2", [game_id, req.session.user.id]);
        if (p.rows.length === 0) return res.status(404).send("Not in game");
        
        const gameRes = await pool.query("SELECT status FROM games WHERE id = $1", [game_id]);
        if (gameRes.rows.length === 0) return res.status(404).send("Game not found");
        const game = gameRes.rows[0];
        
        // Transfer target if leaver was part of a chain
        if (game.status === 'active' && p.rows[0].is_alive) {
            const killer = await pool.query("SELECT user_id FROM game_participants WHERE game_id = $1 AND target_id = $2", [game_id, req.session.user.id]);
            if (killer.rows.length > 0) {
                const killerId = killer.rows[0].user_id;
                const victimTargetId = p.rows[0].target_id;
                await pool.query("UPDATE game_participants SET target_id = $1 WHERE game_id = $2 AND user_id = $3", [victimTargetId, game_id, killerId]);
            }
        }
        
        await pool.query("DELETE FROM game_participants WHERE game_id = $1 AND user_id = $2", [game_id, req.session.user.id]);
        
        // Room Cleanup
        const participants = await pool.query("SELECT user_id, is_alive FROM game_participants WHERE game_id = $1", [game_id]);
        if (participants.rows.length === 0) {
            await pool.query("DELETE FROM games WHERE id = $1", [game_id]);
            return res.send("<p>Left game. Room closed.</p>");
        } else if (game.status === 'active') {
            const alive = participants.rows.filter(r => r.is_alive);
            if (alive.length === 1) {
                const winnerId = alive[0].user_id;
                await pool.query("UPDATE users SET games_won = games_won + 1 WHERE id = $1", [winnerId]);
                await pool.query("DELETE FROM games WHERE id = $1", [game_id]);
                return res.send("<p>Left game. Game over.</p>");
            }
        }
        res.send("<p>Left game.</p>");
    } catch (err) {
        console.error(err);
        res.status(500).send("Leave failed");
    }
});

/**
 * HTMX Partial: Joinable Public Games.
 * Shows games with is_public = true where user is not yet a participant.
 */
app.get("/partial/games/joinable", isAuthenticated, async (req, res) => {
    const result = await pool.query(`
        SELECT g.*, (SELECT COUNT(*) FROM game_participants WHERE game_id = g.id) as current_players
        FROM games g
        WHERE g.is_public = true AND g.status = 'lobby'
        AND NOT EXISTS (SELECT 1 FROM game_participants WHERE game_id = g.id AND user_id = $1)
    `, [req.session.user.id]);
    let html = "";
    for (const game of result.rows) {
        html += `
            <div class="game-card">
                <h3>Public Game: ${game.invite_code}</h3>
                <p>Players: ${game.current_players} / ${game.player_limit || '∞'}</p>
                <button hx-post="/games/join" hx-vals='{"invite_code": "${game.invite_code}"}' hx-target="#ongoing-games">Join</button>
            </div>
        `;
    }
    res.send(html || "<p>No joinable games found.</p>");
});

// Multer Config for Profile Pic Uploads
const storage = multer.diskStorage({
    destination: "public/pictures/",
    filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
    },
});
const upload = multer({ storage });

/**
 * Profile Edit.
 * Updates username and/or profile picture path in the DB.
 */
app.post("/profile/edit", isAuthenticated, upload.single("picture"), async (req, res) => {
    const newUsername = req.body.username || req.session.user.username;
    const newPicturePath = req.file ? "/pictures/" + req.file.filename : req.session.user.profile_picture_path;
    try {
        await pool.query("UPDATE users SET username = $1, profile_picture_path = $2 WHERE id = $3", [newUsername, newPicturePath, req.session.user.id]);
        req.session.user.username = newUsername;
        req.session.user.profile_picture_path = newPicturePath;
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

/**
 * Change Password.
 * 1. Verifies old password.
 * 2. Hashes and updates new password.
 */
app.post("/profile/change-password", isAuthenticated, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const result = await pool.query("SELECT password FROM users WHERE id = $1", [req.session.user.id]);
        const user = result.rows[0];
        const match = await bcrypt.compare(oldPassword, user.password);
        if (!match) return res.status(401).json({ error: "Incorrect old password" });

        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        await pool.query("UPDATE users SET password = $1 WHERE id = $2", [hashedPassword, req.session.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Database error" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
