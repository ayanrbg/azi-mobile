require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const url = require('url');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3002;
const SECRET = process.env.JWT_SECRET;

/* =========================
   1️⃣  HTTP авторизация
========================= */

// временная авторизация (потом подключишь БД)
const bcrypt = require('bcrypt');

app.post('/register', async (req, res) => {
    const { nickname, email, password } = req.body;

    if (!nickname || !email || !password) {
        return res.status(400).json({ error: 'Missing data' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (nickname, email, password)
             VALUES ($1, $2, $3)
             RETURNING id, nickname`,
            [nickname, email, hashedPassword]
        );

        const user = result.rows[0];

        // 🔐 создаём токен сразу
        const token = jwt.sign(
            { id: user.id, nickname: user.nickname },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token });

    } catch (err) {

        if (err.code === '23505') {
            return res.status(400).json({ error: 'Nickname or email already exists' });
        }

        console.error("REGISTER ERROR:", err);
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/login', async (req, res) => {
    const { login, password } = req.body;

    if (!login || !password) {
        return res.status(400).json({ error: 'Missing data' });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM users
             WHERE nickname = $1 OR email = $1`,
            [login]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, nickname: user.nickname },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({ token });

    } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: 'Server error' });
}
});

/* =========================
   2️⃣  WebSocket сервер
========================= */

function verifyToken(token) {
    try {
        return jwt.verify(token, SECRET);
    } catch (err) {
        return null;
    }
}

wss.on('connection', (ws, req) => {
    const query = url.parse(req.url, true).query;
    const token = query.token;

    const user = verifyToken(token);

    if (!user) {
        ws.close();
        return;
    }

    ws.user = user;

    console.log('User connected:', user.nickname);

    // ⬇️ ВАЖНО
    // Здесь оставляешь СВОЮ старую логику сообщений
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // 👇 вставь свою старую обработку
        console.log('Message:', data);

        // пример ответа
        ws.send(JSON.stringify({
            type: "pong",
            message: "server response preserved"
        }));
    });

    ws.on('close', () => {
        console.log('User disconnected:', user.nickname);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});