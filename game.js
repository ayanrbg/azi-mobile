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

    hand.splice(cardIndex, 1);
    this.discardedPlayers.add(playerId);

    if (this.discardedPlayers.size === this.players.length) {
        this.startBiddingPhase();
    }
}
startBiddingPhase() {

    this.phase = "bidding";

    const firstPlayer = this.players[0];

    this.players.forEach(player => {

        if (player.ws.readyState === 1) {

            player.ws.send(JSON.stringify({
                type: "gameUpdate",
                phase: "bidding",
                trump: this.trump,
                pot: this.room.bet * this.players.length,
                currentPlayer: firstPlayer.id,
                tricks: {},
                yourCards: this.hands.get(player.id),
                yourTricks: 0
            }));
        }
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
}

module.exports = Game;