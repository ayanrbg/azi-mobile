const { v4: uuidv4 } = require('uuid');

class Room {
    constructor({ name, bet, password, maxPlayers, icon, owner }) {
        this.id = uuidv4();
        this.name = name;
        this.bet = bet; // baseBet
        this.password = password || null;
        this.maxPlayers = maxPlayers;
        this.icon = icon;

        this.players = [];
        this.status = "waiting"; // waiting | playing

        this.owner = owner;
    }

    addPlayer(player) {
        if (this.players.length >= this.maxPlayers) {
            throw new Error("Room is full");
        }

        this.players.push({
            id: player.id.toString(),
            name: player.nickname,
            balance: player.balance,
            ready: false,
            ws: player.ws
        });
    }

    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
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