class Game {

    constructor(room) {
        this.room = room;
        this.players = room.players;

        this.phase = "dealing";
        this.deck = this.createDeck();
        this.shuffle(this.deck);

        this.trumpCard = this.deck.pop();
        this.trump = this.trumpCard.suit;

        this.hands = new Map();
        this.tricks = {};

        this.dealCards();
        this.phase = "discard";
        this.startDecisionPhase();
    }
    requestDiscard() {

    this.discardedPlayers = new Set();

    this.players.forEach(player => {
        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: "requestDiscard"
            }));
        }
    });
}
startDecisionPhase() {

    this.phase = "deciding";
    this.playersDecisions = new Map();

    this.players.forEach(player => {
        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: "requestPlayDecision",
                phase: "deciding",
                trump: this.trump,
                pot: this.room.bet * this.players.length,
                tricks: {},
                yourCards: this.hands.get(player.id),
                yourTricks: 0
            }));
        }
    });
}
decidePlaying(playerId, play) {

    this.playersDecisions.set(playerId, play);

    // ждём пока все ответят
    if (this.playersDecisions.size !== this.players.length) return;

    // фильтруем тех кто играет
    this.players = this.players.filter(p =>
        this.playersDecisions.get(p.id) === true
    );

    // если меньше 2 игроков → отменяем
    if (this.players.length < 2) {
        this.room.status = "waiting";
        return;
    }

    this.startDiscardPhase();
}
startDiscardPhase() {

    this.phase = "discarding";
    this.discardedPlayers = new Set();

    this.players.forEach(player => {
        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: "requestDiscard",
                phase: "discarding",
                trump: this.trump,
                pot: this.room.bet * this.players.length,
                tricks: {},
                yourCards: this.hands.get(player.id),
                yourTricks: 0
            }));
        }
    });
}
discardCard(playerId, cardIndex) {

    const hand = this.hands.get(playerId);
    if (!hand) return;

    if (cardIndex < 0 || cardIndex >= hand.length) return;

    // удаляем карту
    hand.splice(cardIndex, 1);

    this.discardedPlayers.add(playerId);

    // 🔹 СРАЗУ отправляем обновление ТОЛЬКО этому игроку
    const player = this.players.find(p => p.id === playerId);

    if (player && player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({
            type: "gameUpdate",
            phase: "discarding",
            trump: this.trump,
            pot: this.room.bet * this.players.length,
            tricks: {},
            yourCards: this.hands.get(playerId),
            yourTricks: 0
        }));
    }

    // 🔹 если все сбросили → bidding
    if (this.discardedPlayers.size === this.players.length) {
        this.startBiddingPhase();
    }
}
startBiddingPhase() {

    this.phase = "bidding";

    this.baseBet = this.room.bet;
    this.currentBet = this.baseBet;

    this.activePlayers = [...this.players];
    this.currentPlayerIndex = 0;

    this.playerBids = {};
    this.activePlayers.forEach(p => {
        this.playerBids[p.id] = 0;
    });

    this.turnCount = 0;

    if (this.activePlayers.length === 2) {
        this.minTurns = 3;
    } else {
        this.minTurns = this.activePlayers.length;
    }

    this.lastRaiser = null;

    // ✅ ВОТ ЭТО ДОБАВИТЬ
    this.broadcastBiddingState();

    // ✅ А потом уже запрос первому
    this.requestBid();
}
requestBid() {

    const player = this.activePlayers[this.currentPlayerIndex];

    if (!player) return;

    player.ws.send(JSON.stringify({
        type: "requestBid",
        phase: "bidding",
        trump: this.trump,
        pot: this.currentBet * this.activePlayers.length,
        currentBet: this.currentBet,
        baseBet: this.baseBet,
        minRaise: Math.floor(this.currentBet * 1.5),
        currentPlayer: player.id,
        yourCards: this.hands.get(player.id),
        yourTricks: 0,
        playerBids: this.playerBids
    }));
}
bidAction(playerId, action, amount = null) {

    const player = this.activePlayers[this.currentPlayerIndex];
    if (!player || player.id !== playerId) return;
    this.turnCount++;    
    if (action === "raise") {

        let newBet;

        if (amount && amount > this.currentBet) {
            newBet = amount;
        } else {
            newBet = Math.floor(this.currentBet * 1.5);
        }

        if (newBet <= this.currentBet) return;

        this.currentBet = newBet;
        this.playerBids[playerId] = newBet;

        this.lastRaiser = playerId;
        this.roundStartIndex = this.currentPlayerIndex;

        this.nextPlayer();
        this.broadcastBiddingState();
        return;
    }

    if (action === "pass") {

        this.activePlayers.splice(this.currentPlayerIndex, 1);

        // если остался 1 игрок — конец торгов
        if (this.activePlayers.length === 1) {
            this.startPlayingPhase();
            return;
        }

        if (this.currentPlayerIndex >= this.activePlayers.length) {
            this.currentPlayerIndex = 0;
        }
        this.broadcastBiddingState();
        this.requestBid();
        return;
    }
}
nextPlayer() {

    // если остался один — он выиграл торги
    if (this.activePlayers.length === 1) {
        this.startPlayingPhase();
        return;
    }

    this.currentPlayerIndex++;

    if (this.currentPlayerIndex >= this.activePlayers.length) {
        this.currentPlayerIndex = 0;
    }

    const currentPlayer = this.activePlayers[this.currentPlayerIndex];

    // ✅ Условие окончания торгов
    if (
        this.turnCount >= this.minTurns &&
        this.lastRaiser &&
        currentPlayer.id === this.lastRaiser
    ) {
        this.startPlayingPhase();
        return;
    }

    this.requestBid();
}
startPlayingPhase() {

    this.phase = "playing";

    this.players.forEach(player => {
        player.ws.send(JSON.stringify({
            type: "gameUpdate",
            phase: "playing",
            trump: this.trump,
            pot: this.currentBet,
            currentPlayer: this.activePlayers[0].id,
            tricks: this.tricks,
            yourCards: this.hands.get(player.id),
            yourTricks: this.tricks[player.id] || 0
        }));
    });
}
createDeck() {
    const suits = ["H", "D", "C", "S"];
    const ranks = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];

    const deck = [];

    suits.forEach(suit => {
        ranks.forEach(rank => {
            deck.push({
                suit,
                rank,
                code: rank + suit
            });
        });
    });

    return deck;
}

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    dealCards() {

        this.players.forEach(player => {

            const hand = [];

            for (let i = 0; i < 4; i++) {
                hand.push(this.deck.pop());
            }

            this.hands.set(player.id, hand);
            this.tricks[player.id] = 0;
        });

        this.sendGameUpdate();
    }

    sendGameUpdate() {

        this.players.forEach(player => {

            if (player.ws.readyState === 1) {

                player.ws.send(JSON.stringify({
                    type: "gameUpdate",
                    phase: this.phase,
                    trump: this.trump,
                    trumpCard: this.trumpCard,
                    yourCards: this.hands.get(player.id),
                    tricks: this.tricks
                }));
            }
        });
    }
    broadcastBiddingState() {

    this.players.forEach(player => {

        if (player.ws.readyState === 1) {

            player.ws.send(JSON.stringify({
                type: "gameUpdate",
                phase: "bidding",
                trump: this.trump,
                pot: this.currentBet * this.activePlayers.length,
                currentBet: this.currentBet,
                baseBet: this.baseBet,
                currentPlayer: this.activePlayers[this.currentPlayerIndex]?.id,
                tricks: this.tricks,
                yourCards: this.hands.get(player.id),
                yourTricks: this.tricks[player.id] || 0,
                playerBids: this.playerBids
            }));
        }
    });
}
}

module.exports = Game;