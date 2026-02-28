class Game {

    constructor(room, pool) {
        this.room = room;
        this.pool = pool;
        this.players = room.players.map(p => ({
            id: p.id,
            name: p.name,
            balance: p.balance,
            ws: p.ws
        }));

        this.phase = "dealing";
        this.deck = this.createDeck();
        this.shuffle(this.deck);

        this.trumpCard = this.deck.pop();
        this.trump = this.trumpCard.suit;

        this.hands = new Map();
        this.tricks = {};
        this.biddingStage = 1;
        this.pot = 0; // общий банк игры
        this.dealCards();
        this.currentTrick = [];
        this.leadSuit = null;
        this.currentPlayerIndex = 0; // кто ходит
        this.completedTricks = 0;
    }
//     requestDiscard() {

//     this.discardedPlayers = new Set();

//     this.players.forEach(player => {
//         if (player.ws.readyState === 1) {
//             player.ws.send(JSON.stringify({
//                 type: "requestDiscard"
//             }));
//         }
//     });
// }
// startDecisionPhase() {

//     this.phase = "deciding";
//     this.playersDecisions = new Map();

//     this.players.forEach(player => {
//         if (player.ws.readyState === 1) {
//             player.ws.send(JSON.stringify({
//                 type: "requestPlayDecision",
//                 phase: "deciding",

//                 // 👇 полная карта
//                 trumpCard: this.trumpCard,
//                 trump: this.trumpCard.suit,

//                 pot: this.room.bet * this.players.length,
//                 tricks: {},
//                 yourCards: this.hands.get(player.id),
//                 yourTricks: 0
//             }));
//         }
//     });
// }
// decidePlaying(playerId, play) {

//     if (this.phase !== "deciding") return;
//     this.playersDecisions.set(playerId, play);

//     // ждём пока все ответят
//     if (this.playersDecisions.size !== this.players.length) return;

//     // фильтруем тех кто играет
//     this.players = this.players.filter(p =>
//         this.playersDecisions.get(p.id) === true
//     );

//     // если меньше 2 игроков → отменяем
//     if (this.players.length < 2) {
//         this.room.status = "waiting";
//         return;
//     }

//     this.startDiscardPhase();
// }
startDiscardPhase() {

    this.phase = "discarding";
    this.discardedPlayers = new Set();

    this.activePlayers.forEach(player => {
        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: "requestDiscard",
                phase: "discarding",
                trump: this.trump,
                pot: this.pot,
                tricks: {},
                yourCards: this.hands.get(player.id),
                yourTricks: 0
            }));
        }
    });
}
discardCard(playerId, cardIndex) {

    // ❗ Фаза должна быть discarding
    if (this.phase !== "discarding") return;

    // ❗ Игрок уже сбрасывал карту
    if (this.discardedPlayers.has(playerId)) return;

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
            pot: this.pot,
            tricks: {},
            yourCards: this.hands.get(playerId),
            yourTricks: 0
        }));
    }

    // 🔹 если все сбросили → bidding
    if (this.discardedPlayers.size === this.activePlayers.length) {
        this.startPlayingPhase();
    }
}
startBiddingPhase(isCarryOver = false) {

    this.phase = "bidding";

    this.minRoomBet = 30;
    this.currentBet = 0;

    this.activeBidders = [...this.players];
    this.currentPlayerIndex = 0;

    this.playerContributions = {};
    this.allInPlayers = new Set();

    // ❗ pot НЕ обнуляем при Ази
    if (!isCarryOver) {
        this.pot = 0;
    }

    this.activeBidders.forEach(p => {
        this.playerContributions[p.id] = 0;
    });

    this.broadcastBiddingStateExceptCurrent();
    this.requestBid();
}
async deductChips(playerId, amount) {

    const player = this.activeBidders.find(p => p.id === playerId);
    if (!player) return 0;

    if (amount <= 0) return 0;

    const available = player.balance;
    const actual = Math.min(amount, available);

    player.balance -= actual;
    this.playerContributions[playerId] += actual;
    this.pot += actual;

    if (player.balance === 0) {
        this.allInPlayers.add(playerId);
    }

    try {
        await this.pool.query(
            "UPDATE users SET balance = balance - $1 WHERE id = $2",
            [actual, playerId]
        );
    } catch (err) {
        console.error("Deduct error:", err);
    }

    // 🔥 ВОТ ЭТО ДОБАВЛЯЕМ
    if (player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({
            type: "balanceUpdate",
            balance: player.balance
        }));
    }

    return actual;
}
requestBid() {

    const player = this.activeBidders[this.currentPlayerIndex];
    if (!player) return;

    // 🚨 если игрок уже all-in — пропускаем
    if (this.allInPlayers.has(player.id)) {
        this.nextBidTurn();
        return;
    }

    player.ws.send(JSON.stringify({
        type: "requestBid",
        phase: "bidding",
        stage: this.biddingStage,
        trump: this.trump,
        pot: this.pot,
        currentBet: this.currentBet,
        minRoomBet: this.minRoomBet,
        yourContribution: this.playerContributions[player.id],
        yourBalance: player.balance
    }));
}
async bidAction(playerId, action, amount = null) {

    if (this.phase !== "bidding") return;

    const player = this.activeBidders[this.currentPlayerIndex];
    if (!player || player.id !== playerId) return;

    // PASS
    if (action === "pass") {

        this.broadcastBidPlaced(playerId, "pass", 0);
        this.activeBidders.splice(this.currentPlayerIndex, 1);

        if (this.activeBidders.length === 1) {
            await this.endGame(this.activeBidders[0].id);
            return;
        }

        if (this.currentPlayerIndex >= this.activeBidders.length) {
            this.currentPlayerIndex = 0;
        }

        this.broadcastBiddingStateExceptCurrent();
        this.requestBid();
        return;
    }

    // ПЕРВАЯ СТАВКА
    if (this.currentBet === 0) {

        if (amount < this.minRoomBet || amount > this.minRoomBet * 5) return;

        const actual = await this.deductChips(playerId, amount);
        this.currentBet = this.playerContributions[playerId];
        this.broadcastBidPlaced(
            playerId,
            actual < amount ? "all-in" : "bet",
            actual
        );
        this.nextBidTurn();
        return;
    }

    // CALL
    if (action === "call") {

        const needed = this.currentBet - this.playerContributions[playerId];
        const actual = await this.deductChips(playerId, needed);
        this.broadcastBidPlaced(
            playerId,
            actual < needed ? "all-in" : "call",
            actual
        );
        this.nextBidTurn();
        return;
    }

    // DOUBLE
    if (action === "double") {

        const newBet = this.currentBet * 2;
        const needed = newBet - this.playerContributions[playerId];

        this.currentBet = newBet;
        const actual = await this.deductChips(playerId, needed);
        this.broadcastBidPlaced(
            playerId,
            actual < needed ? "all-in" : "double",
            actual
        );
        this.nextBidTurn();
        return;
    }
}
broadcastBiddingStateExceptCurrent() {

    const currentPlayer = this.activeBidders[this.currentPlayerIndex];
    if (!currentPlayer) return;

    const currentPlayerId = currentPlayer.id;

    this.activeBidders.forEach(player => {

        if (player.id === currentPlayerId) return;
        if (player.ws.readyState !== 1) return;

        player.ws.send(JSON.stringify({
            type: "gameUpdate",
            phase: "bidding",
            trump: this.trump,
            pot: this.pot,
            currentBet: this.currentBet,
            currentPlayer: currentPlayerId,
            yourContribution: this.playerContributions[player.id],
            yourBalance: player.balance
        }));
    });
}
nextBidTurn() {
    // если все игроки all-in → завершаем торги
    if (this.allInPlayers.size === this.activeBidders.length) {
        this.finishBetting();
        return;
    }
    const allMatched = this.activeBidders.every(p => {

        const contribution = this.playerContributions[p.id];

        // если игрок all-in — он считается завершившим
        if (this.allInPlayers.has(p.id)) return true;

        return contribution === this.currentBet;
    });

    if (allMatched && this.currentBet > 0) {
        this.finishBetting();
        return;
    }

    this.currentPlayerIndex++;

    if (this.currentPlayerIndex >= this.activeBidders.length) {
        this.currentPlayerIndex = 0;

        // закончился первый круг
        if (this.biddingStage === 1) {
            this.biddingStage = 2;
            this.revealHandsToPlayers();
        }
    }

    this.broadcastBiddingStateExceptCurrent();
    this.requestBid();
}
revealHandsToPlayers() {

    this.activeBidders.forEach(player => {

        if (player.ws.readyState !== 1) return;

        player.ws.send(JSON.stringify({
            type: "cardsReveal",
            phase: "bidding",
            stage: 2,
            trump: this.trump,
            pot: this.pot,
            currentBet: this.currentBet,
            yourContribution: this.playerContributions[player.id],
            yourBalance: player.balance,
            yourCards: this.hands.get(player.id)
        }));
    });
}
finishBetting() {

    // играть будут только те, кто остались
    this.activePlayers = [...this.activeBidders];

    this.startDiscardPhase();
}
// nextPlayer() {

//     this.currentPlayerIndex++;

//     if (this.currentPlayerIndex >= this.activePlayers.length) {
//         this.currentPlayerIndex = 0;
//     }

//     this.requestBid();
// }
startPlayingPhase() {

    this.phase = "playing";

    this.currentTrick = [];
    this.leadSuit = null;
    this.completedTricks = 0;

    this.currentPlayerIndex = 0;

    // ❗ Всем кроме текущего — gameUpdate
    this.broadcastPlayingStateExceptCurrent();

    // ❗ Текущему — только requestMove
    this.requestMove();
}
broadcastPlayingStateExceptCurrent() {

    const currentPlayerId = this.activePlayers[this.currentPlayerIndex].id;

    this.activePlayers.forEach(player => {

        // ❗ текущему игроку НИЧЕГО не отправляем
        if (player.id === currentPlayerId) return;

        if (player.ws.readyState !== 1) return;

        player.ws.send(JSON.stringify({
            type: "gameUpdate",
            phase: "playing",
            trump: this.trump,
            trumpCard: this.trumpCard,
            pot: this.pot,
            currentBet: this.currentBet,
            currentPlayer: currentPlayerId,
            tricks: this.tricks,
            yourCards: this.hands.get(player.id),
            yourTricks: this.tricks[player.id] || 0,
            currentTrick: this.currentTrick,
            leadSuit: this.leadSuit
        }));
    });
}
broadcastPlayingState() {

    this.players.forEach(player => {

        if (player.ws.readyState === 1) {

            player.ws.send(JSON.stringify({
                type: "gameUpdate",
                phase: "playing",
                trump: this.trump,
                pot: this.pot,
                currentPlayer: this.activePlayers[this.currentPlayerIndex].id,
                tricks: this.tricks,
                yourCards: this.hands.get(player.id),
                yourTricks: this.tricks[player.id] || 0,
                currentTrick: this.currentTrick,
                leadSuit: this.leadSuit
            }));
        }
    });
}
requestMove() {

    const player = this.activePlayers[this.currentPlayerIndex];
    if (!player) return;

    const validCards = this.getValidCards(player.id);

    player.ws.send(JSON.stringify({
        type: "requestMove",

        phase: this.phase,

        trump: this.trump,
        trumpCard: this.trumpCard,

        pot: this.pot,
        currentBet: this.currentBet,

        currentPlayer: this.activePlayers[this.currentPlayerIndex].id,

        tricks: this.tricks,

        yourCards: this.hands.get(player.id),
        yourTricks: this.tricks[player.id] || 0,

        currentTrick: this.currentTrick,

        leadSuit: this.leadSuit,

        validCards: validCards
    }));
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
getValidCards(playerId) {

    const hand = this.hands.get(playerId);

    if (!this.leadSuit) {
        return hand.map((_, index) => index);
    }

    const sameSuitIndexes = hand
        .map((card, index) => card.suit === this.leadSuit ? index : -1)
        .filter(index => index !== -1);

    if (sameSuitIndexes.length > 0) {
        return sameSuitIndexes;
    }

    return hand.map((_, index) => index);
}
playCard(playerId, cardIndex) {

    if (this.phase !== "playing") return;

    const player = this.activePlayers[this.currentPlayerIndex];
    if (!player || player.id !== playerId) return;

    const hand = this.hands.get(playerId);
    if (!hand) return;

    const validCards = this.getValidCards(playerId);
    if (!validCards.includes(cardIndex)) return;

    const card = hand.splice(cardIndex, 1)[0];

    if (!this.leadSuit) {
        this.leadSuit = card.suit;
    }

    this.currentTrick.push({
        playerId,
        card
    });

    this.broadcastCardPlayed(playerId, card);

    // если все сходили
    if (this.currentTrick.length === this.activePlayers.length) {
        this.finishTrick();
        return;
    }

    this.nextTurn();
}
nextTurn() {

    this.currentPlayerIndex++;

    if (this.currentPlayerIndex >= this.activePlayers.length) {
        this.currentPlayerIndex = 0;
    }

    // ❗ Всем кроме текущего — gameUpdate
    this.broadcastPlayingStateExceptCurrent();

    // ❗ Текущему — только requestMove
    this.requestMove();
}
broadcastCardPlayed(playerId, card) {

    this.players.forEach(player => {
        player.ws.send(JSON.stringify({
            type: "cardPlayed",
            playerId,
            card,
            currentTrick: this.currentTrick,
            leadSuit: this.leadSuit
        }));
    });
}
finishTrick() {

    const winner = this.determineTrickWinner();

    this.tricks[winner]++;

    this.completedTricks++;

    this.players.forEach(player => {
        player.ws.send(JSON.stringify({
            type: "trickComplete",
            winner,
            tricks: this.tricks
        }));
    });

    // если кто-то взял 2 взятки — победа
    if (this.tricks[winner] === 2) {
        this.endGame(winner);
        return;
    }

    // если 3 раунда и никто не взял 2 — Ази
    if (this.completedTricks === 3) {
        this.handleAzi();
        return;
    }

    // новый раунд
    this.currentPlayerIndex = this.activePlayers.findIndex(p => p.id === winner);
    this.currentTrick = [];
    this.leadSuit = null;

    this.broadcastPlayingStateExceptCurrent();
    this.requestMove();
}
determineTrickWinner() {

    let winningCard = this.currentTrick[0];
    let winnerId = winningCard.playerId;

    for (let i = 1; i < this.currentTrick.length; i++) {

        const current = this.currentTrick[i];

        const isTrump = current.card.suit === this.trump;
        const winningIsTrump = winningCard.card.suit === this.trump;

        if (isTrump && !winningIsTrump) {
            winningCard = current;
            winnerId = current.playerId;
            continue;
        }

        if (current.card.suit === winningCard.card.suit) {

            if (this.getCardRankValue(current.card.rank) >
                this.getCardRankValue(winningCard.card.rank)) {

                winningCard = current;
                winnerId = current.playerId;
            }
        }
    }

    return winnerId;
}
getCardRankValue(rank) {

    const order = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    return order.indexOf(rank);
}
async endGame(winnerId) {

    this.phase = "finished";
    const pot = this.pot;

    try {
        await this.pool.query(
            "UPDATE users SET balance = balance + $1 WHERE id = $2",
            [pot, winnerId]
        );
    } catch (err) {
        console.error("Balance update error:", err);
        return;
    }

    const winner = this.players.find(p => p.id === winnerId);

    if (winner) {
        winner.balance += pot;

        if (winner.ws?.user) {
            winner.ws.user.balance += pot;
        }
    }

    this.players.forEach(player => {
        player.ws.send(JSON.stringify({
            type: "gameWinner",
            winner: winnerId,
            pot,
            winnerBalance: winner?.balance
        }));
    });

    setTimeout(() => {
    this.restartRound();
}, 1000);
}
restartRound() {

    // пересобираем игроков из комнаты
    this.players = this.room.players.map(p => ({
        id: p.id,
        name: p.name,
        balance: p.balance,
        ws: p.ws
    }));

    if (this.players.length < 2) {
        this.room.status = "waiting";
        this.room.game = null;
        return;
    }

    // новая колода
    this.deck = this.createDeck();
    this.shuffle(this.deck);

    this.trumpCard = this.deck.pop();
    this.trump = this.trumpCard.suit;

    // сброс состояния
    this.hands = new Map();
    this.tricks = {};
    this.currentTrick = [];
    this.leadSuit = null;
    this.completedTricks = 0;
    this.biddingStage = 1;

    // pot обнуляется для новой игры
    this.pot = 0;

    // раздаём заново
    this.dealCards();
}
handleAzi() {

    this.phase = "azi_waiting";

    // фиксируем игроков ничьи
    this.aziPlayers = [...this.activePlayers];

    const entryCost = Math.floor(this.pot / this.aziPlayers.length);

    this.players.forEach(player => {

        if (player.ws.readyState !== 1) return;

        const isAziPlayer = this.aziPlayers.find(p => p.id === player.id);

        if (isAziPlayer) {
            player.ws.send(JSON.stringify({
                type: "aziHold",
                pot: this.pot
            }));
        } else {
            player.ws.send(JSON.stringify({
                type: "aziJoinRequest",
                entryCost,
                pot: this.pot
            }));
        }
    });
}
async aziJoinAction(playerId, action) {

    if (this.phase !== "azi_waiting") return;

    // уже участвует
    if (this.aziPlayers.find(p => p.id === playerId)) return;

    const entryCost = Math.floor(this.pot / this.aziPlayers.length);
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    if (action === "pass") return;

    const actual = await this.deductFromBalance(player, entryCost);

    if (actual <= 0) return;

    this.pot += actual;

    this.aziPlayers.push(player);

    this.broadcastAziJoin(playerId, actual);

    // 🔥 если игроков стало >= 2 — стартуем
    if (this.aziPlayers.length >= 2) {
        this.finishAziJoin();
    }
}
broadcastAziJoin(playerId, amount) {

    this.players.forEach(player => {

        if (player.ws.readyState !== 1) return;

        player.ws.send(JSON.stringify({
            type: "aziPlayerJoined",
            playerId,
            amount,
            pot: this.pot
        }));
    });
}
async deductFromBalance(player, amount) {

    const actual = Math.min(amount, player.balance);

    player.balance -= actual;

    await this.pool.query(
        "UPDATE users SET balance = balance - $1 WHERE id = $2",
        [actual, player.id]
    );

    if (player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({
            type: "balanceUpdate",
            balance: player.balance
        }));
    }

    return actual;
}
finishAziJoin() {

    this.activePlayers = [...this.aziPlayers];

    this.deck = this.createDeck();
    this.shuffle(this.deck);

    this.trumpCard = this.deck.pop();
    this.trump = this.trumpCard.suit;

    this.hands = new Map();
    this.tricks = {};
    this.currentTrick = [];
    this.leadSuit = null;
    this.completedTricks = 0;

    this.dealCards();

    // 🔥 продолжаем игру за тот же pot
    this.startBiddingPhase(true);
}
resetGame() {

    // новая колода
    this.deck = this.createDeck();
    this.shuffle(this.deck);

    this.trumpCard = this.deck.pop();
    this.trump = this.trumpCard.suit;

    // сброс состояния
    this.hands = new Map();
    this.tricks = {};
    this.currentTrick = [];
    this.leadSuit = null;
    this.completedTricks = 0;

    // все игроки снова активны
    this.players = this.room.players.map(p => ({
        id: p.id,
        name: p.name,
        balance: p.balance,
        ws: p.ws
    }));

    this.activePlayers = [...this.players];

    // раздаём заново
    this.dealCards();

    // снова deciding
    // this.startDecisionPhase();
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

        // this.sendGameUpdate();
        this.sendGameStarted();
    }
sendGameStarted() {

    const playersDictionary = {};

    this.players.forEach(player => {
        playersDictionary[player.id] = 4;
    });

    this.players.forEach(player => {

        if (player.ws.readyState !== 1) return;

        player.ws.send(JSON.stringify({
            type: "gameStarted",
            phase: "dealing",
            trumpCard: this.trumpCard,
            players: playersDictionary
        }));
    });

    // 🔥 ВАЖНО — запускаем торги
    this.startBiddingPhase();
}
broadcastBidPlaced(playerId, action, amount) {

    const totalContribution = this.playerContributions[playerId] || 0;

    this.players.forEach(player => {

        if (player.ws.readyState !== 1) return;

        player.ws.send(JSON.stringify({
            type: "bidPlaced",
            playerId,
            action,
            amount,
            totalContribution,
            currentBet: this.currentBet,
            pot: this.pot,
            stage: this.biddingStage
        }));
    });
}
async handlePlayerLeave(playerId) {

    // удаляем из общего списка игроков
    this.players = this.players.filter(p => p.id !== playerId);

    // удаляем из активных торгов
    if (this.activeBidders) {
        this.activeBidders = this.activeBidders.filter(p => p.id !== playerId);
    }

    // удаляем из активных играющих
    if (this.activePlayers) {
        this.activePlayers = this.activePlayers.filter(p => p.id !== playerId);
    }

    // если остался один игрок — он победитель
    if (this.players.length === 1) {
        const winnerId = this.players[0].id;
        await this.endGame(winnerId);
        this.room.status = "waiting";
        this.room.game = null;
        return;
    }

    // если игра в фазе торгов
    if (this.phase === "bidding") {

        // если остался один активный участник торгов — он победил
        if (this.activeBidders.length === 1) {
            await this.endGame(this.activeBidders[0].id);
            this.room.status = "waiting";
            this.room.game = null;
            return;
        }

        // корректируем индекс хода
        if (this.currentPlayerIndex >= this.activeBidders.length) {
            this.currentPlayerIndex = 0;
        }

        this.broadcastBiddingStateExceptCurrent();
        this.requestBid();
        return;
    }

    // если игра в фазе playing
    if (this.phase === "playing") {

        if (this.activePlayers.length === 1) {
            await this.endGame(this.activePlayers[0].id);
            this.room.status = "waiting";
            this.room.game = null;
            return;
        }

        if (this.currentPlayerIndex >= this.activePlayers.length) {
            this.currentPlayerIndex = 0;
        }

        this.broadcastPlayingStateExceptCurrent();
        this.requestMove();
        return;
    }
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
//     broadcastBiddingState() {

//     this.players.forEach(player => {

//         if (player.ws.readyState === 1) {

//             player.ws.send(JSON.stringify({
//                 type: "gameUpdate",
//                 phase: "bidding",
//                 trump: this.trump,
//                 pot: this.pot,
//                 currentBet: this.currentBet,
//                 baseBet: this.baseBet,
//                 currentPlayer: this.activePlayers[this.currentPlayerIndex]?.id,
//                 tricks: this.tricks,
//                 yourCards: this.hands.get(player.id),
//                 yourTricks: this.tricks[player.id] || 0,
//                 playerBids: this.playerBids
//             }));
//         }
//     });
// }
}

module.exports = Game;