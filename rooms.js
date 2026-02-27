const { randomUUID } = require('crypto');
const Game = require('./game');

class Room {
    constructor({ name, bet, password, maxPlayers, icon, owner }) {
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
// toggleReady(playerId) {

//     // ❗ Нельзя ready если игра уже идёт
//     if (this.status === "playing") return;
    
//     const player = this.players.find(p => p.id === playerId);

//     if (!player) return;

//     player.ready = !player.ready;

//     this.broadcastRoomUpdate();
//     // если все ready и минимум 2 игрока
//     if (
//         this.players.length >= 2 &&
//         this.players.every(p => p.ready)
//     ) {
//         this.startGame();
//     }
// }
startGame() {
    this.status = "playing";
    this.game = new Game(this);
}
    addPlayer(player) {

    // ❗ Проверка — уже в комнате?
    const exists = this.players.find(p => p.id === player.id.toString());
    if (exists) {
        throw new Error("Player already in room");
    }

    if (this.players.length >= this.maxPlayers) {
        throw new Error("Room is full");
    }

    this.players.push({
        id: player.id.toString(),
        name: player.nickname,
        balance: player.balance,
        // ready: false,
        ws: player.ws
    });
    
    this.broadcastRoomUpdate();
    // 🔥 Автостарт при 2 игроках
if (this.players.length >= 2 && this.status === "waiting") {
    this.startGame();
}
}

    removePlayer(playerId) {
    this.players = this.players.filter(p => p.id !== playerId);
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
    }

    createRoom(data, owner) {
        const room = new Room({ ...data, owner });
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