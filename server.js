const express = require('express');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: 'nemtudom',
  database: 'Assassin-game',
  port: 5432,
});


const session = require('express-session');

app.use(session({
  secret: 'hahgjkfdh',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hour
}));


// Middleware to parse form data
app.use(express.urlencoded({ extended: true })); // for HTML forms
app.use(express.json());                         // for fetch/axios


app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/register.html');
});



// Regisztráció
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO users (username, password, profile_picture_path,games_played, games_won, kills) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [username, password, "/pictures/marci.jpg", 0, 0, 0]
    );

    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

//Login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );


    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    if (user.password !== password) {
      return res.status(401).json({ error: 'Wrong password' });
    }

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
    res.status(500).json({ error: 'Database error' });
  }
});


app.get('/profile.html', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  res.sendFile(__dirname + '/public/profile.html');
});


app.get('/profile-data', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  res.json(req.session.user);
});


app.listen(3000, () => console.log('Server running on port 3000'));