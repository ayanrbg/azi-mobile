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
const roomManager = require('./rooms.js');

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

wss.on('connection', async (ws, req) => {

    const query = url.parse(req.url, true).query;
    const token = query.token;

    if (!token) {
        ws.send(JSON.stringify({
            type: "authResult",
            success: false
        }));
        return ws.close();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const result = await pool.query(
            "SELECT id, nickname, balance FROM users WHERE id = $1",
            [decoded.id]
        );

        if (result.rows.length === 0) {
            ws.send(JSON.stringify({
                type: "authResult",
                success: false
            }));
            return ws.close();
        }

        const user = result.rows[0];

        ws.user = user;
        ws.isAuthenticated = true;

        ws.send(JSON.stringify({
            type: "authResult",
            success: true,
            user: {
                id: user.id.toString(),
                name: user.nickname,
                balance: user.balance
            }
        }));

        console.log("User connected:", user.nickname);

    } catch (err) {
        ws.send(JSON.stringify({
            type: "authResult",
            success: false
        }));
        ws.close();
    }
    ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (!ws.isAuthenticated) return;

    // =========================
    // GET ROOMS
    // =========================
    if (data.type === "getRooms") {
        ws.send(JSON.stringify({
            type: "roomsList",
            rooms: roomManager.getAllRooms()
        }));
    }
    if (data.type === "createRoom") {

    const { name, bet, password, maxPlayers, icon } = data.data;

    if (!name || !bet || !maxPlayers || !icon) {
        return ws.send(JSON.stringify({
            type: "error",
            message: "Invalid room data"
        }));
    }

    const room = roomManager.createRoom(
        { name, bet, password, maxPlayers, icon },
        ws.user
    );

    ws.currentRoom = room.id;

    room.addPlayer({
        ...ws.user,
        ws
    });

    ws.send(JSON.stringify({
        type: "roomCreated",
        roomId: room.id
    }));
    
    ws.send(JSON.stringify({
        type: "joinedRoom",
        room: room.getFullData()
    }));
}
if (data.type === "joinRoom") {

    const { roomId, password } = data.data;

    const room = roomManager.getRoom(roomId);

    if (!room) {
        return ws.send(JSON.stringify({
            type: "error",
            message: "Room not found"
        }));
    }

    if (room.password && room.password !== password) {
        return ws.send(JSON.stringify({
            type: "error",
            message: "Wrong password"
        }));
    }

    try {
        room.addPlayer({
            ...ws.user,
            ws
        });

        ws.currentRoom = room.id;

        ws.send(JSON.stringify({
            type: "joinedRoom",
            room: room.getFullData()
        }));

    } catch (err) {
        ws.send(JSON.stringify({
            type: "error",
            message: err.message
        }));
    }
}
if (data.type === "leaveRoom") {

    if (!ws.currentRoom) return;

    const room = roomManager.getRoom(ws.currentRoom);

    if (!room) {
        ws.currentRoom = null;
        return;
    }

    room.removePlayer(ws.user.id.toString());

    // если комната пустая — удалить
    if (room.players.length === 0) {
        roomManager.removeRoom(room.id);
    }

    ws.currentRoom = null;

    ws.send(JSON.stringify({
        type: "leftRoom"
    }));
}
if (data.type === "ready") {

    if (!ws.currentRoom) return;

    const room = roomManager.getRoom(ws.currentRoom);
    if (!room) return;

    room.toggleReady(ws.user.id.toString());
}
});
ws.on('close', () => {

    if (!ws.currentRoom) return;

    const room = roomManager.getRoom(ws.currentRoom);
    if (!room) return;

    room.removePlayer(ws.user.id.toString());

    if (room.players.length === 0) {
        roomManager.removeRoom(room.id);
    }
});
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});