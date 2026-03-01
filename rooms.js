const { randomUUID } = require('crypto');
const Game = require('./game');

class Room {
    constructor({ name, bet, password, maxPlayers, icon, owner, pool}) {
        this.pool = pool;
        this.id = randomUUID();
        this.name = name;
        this.bet = bet; // baseBet
        this.password = password || null;
        this.maxPlayers = maxPlayers;
        this.icon = icon;

        this.players = [];
        this.status = "waiting"; // waiting | playing

        this.owner = owner;
        this.game = null;
    }
broadcastRoomUpdate() {
    const data = {
        type: "roomUpdate",
        room: this.getFullData()
    };

    this.players.forEach(p => {
        if (p.ws && p.ws.readyState === 1) {
            p.ws.send(JSON.stringify(data));
        }
    });
}
startGame() {
    this.status = "playing";
    this.game = new Game(this, this.pool);
}
addPlayer(player) {

    const exists = this.players.find(p => p.id === player.id.toString());

    if (exists) {
        // просто обновляем ws
        exists.ws = player.ws;
        return;
    }

    if (this.players.length >= this.maxPlayers) {
        throw new Error("Room is full");
    }

    this.players.push({
        id: player.id.toString(),
        name: player.nickname,
        balance: player.balance,
        ws: player.ws
    });

    this.broadcastRoomUpdate();
    // 🔥 Если игра уже идёт — отправляем состояние новому игроку
    if (this.status === "playing" && this.game) {
        // отправляем gameStarted
    player.ws.send(JSON.stringify({
        type: "gameStarted",
        phase: this.game.phase,
        trumpCard: this.game.trumpCard,
        players: Object.fromEntries(
            this.game.players.map(p => [p.id, 4])
        )
    }));

    // и текущее состояние игры
    this.game.sendCurrentStateToPlayer(player);
    }
}

    removePlayer(playerId) {

    this.players = this.players.filter(p => p.id !== playerId);

    // 🔥 если игра идёт — сообщаем игре
    if (this.game) {
        this.game.handlePlayerLeave(playerId);
    }

    this.broadcastRoomUpdate();
}

    getPublicData() {
        return {
            id: this.id,
            name: this.name,
            bet: this.bet,
            hasPassword: !!this.password,
            players: this.players.length,
            maxPlayers: this.maxPlayers,
            icon: this.icon,
            status: this.status
        };
    }

    getFullData() {
        return {
            id: this.id,
            name: this.name,
            bet: this.bet,
            maxPlayers: this.maxPlayers,
            icon: this.icon,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                ready: p.ready,
                balance: p.balance
            }))
        };
    }
}

class RoomManager {
    constructor() {
        this.rooms = new Map();
        this.pool = null;
    }
    setPool(pool) {
        this.pool = pool;
    }
    createRoom(data, owner) {
        const room = new Room({ ...data, owner, pool: this.pool});
        this.rooms.set(room.id, room);
        return room;
    }

    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    getAllRooms() {
        return Array.from(this.rooms.values()).map(r => r.getPublicData());
    }

    removeRoom(roomId) {
        this.rooms.delete(roomId);
    }
}

module.exports = new RoomManager();