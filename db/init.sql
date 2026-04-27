-- Drop tables if they exist
DROP TABLE IF EXISTS game_participants;
DROP TABLE IF EXISTS games;
DROP TABLE IF EXISTS users;

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- Will store bcrypt hash
    profile_picture_path TEXT DEFAULT '/pictures/default_pfp.png',
    games_played INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0
);

-- Games table
CREATE TABLE games (
    id SERIAL PRIMARY KEY,
    host_id INTEGER REFERENCES users(id),
    invite_code VARCHAR(10) UNIQUE NOT NULL,
    is_public BOOLEAN DEFAULT TRUE,
    player_limit INTEGER,
    status VARCHAR(20) DEFAULT 'lobby' -- lobby, active, finished
);

-- Game participants table
CREATE TABLE game_participants (
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    target_id INTEGER REFERENCES users(id),
    is_alive BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (game_id, user_id)
);
