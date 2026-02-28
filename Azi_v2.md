# AZI version 2

# Подключение 

http://localhost:3002/register
http://localhost:3002/login
## Авторизация
```json
POST /register
{
  "nickname": "player2",
  "email": "player2@mail.com",
  "password": "123456"
}
```
ЛОГИН
```json
{
  "login": "player1",
  "password": "123456"
}
```
```json
{
  "login": "player1@mail.com",
  "password": "123456"
}
```
### После авторизации
Выдается токен JWT 
```json
{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwibmlja25hbWUiOiJwbGF5ZXIyIiwiaWF0IjoxNzcxODU3MzkyLCJleHAiOjE3NzI0NjIxOTJ9.tdEyAFWzbcpRUsdkncJO6VyUrXXisPakmXFZzElv9bA"
}
```

### Подключение к серверу WebSocket
```json
ws://localhost:3002?token=
```
Сервер присылает auth_result
```json
{
  "type": "authResult",
  "success": true,
  "user": {
    "id": "user_id",
    "name": "username",
    "balance": 1000
  }
}
```
ИЛИ 
```json
{
  "type": "authResult",
  "success": false
}
```
## Комнаты

### Получение списка комнат
ОТ КЛИЕНТА
```json
{
  "type": "getRooms"
}
```
ОТ СЕРВЕРА
```json
{
  "type": "roomsList",
  "rooms": [
    {
      "id": "uuid",
      "name": "Room 1",
      "bet": 100,
      "hasPassword": false,
      "players": 1,
      "maxPlayers": 4,
      "icon": "H",
      "status": "waiting"
    }
  ]
}
```

### Создание комнаты
ОТ КЛИЕНТА
```json
{
  "type": "createRoom",
  "data": {
    "name": "Test Room",
    "bet": 100,
    "password": "",
    "maxPlayers": 4,
    "icon": "H"
  }
}
```
ОТ СЕРВЕРА
```json
{
  "type": "roomCreated",
  "roomId": "uuid_here"
}
```

### Подключение к комнате
ОТ КЛИЕНТА
```json
{
  "type": "joinRoom",
  "data": {
    "roomId": "uuid_here",
    "password": ""
  }
}
```
ОТ СЕРВЕРА
```json
{
  "type": "joinedRoom",
  "room": {
    "id": "uuid",
    "name": "Test Room",
    "bet": 100,
    "maxPlayers": 4,
    "icon": "H",
    "players": [
      {
        "id": "1",
        "name": "username",
        "ready": false,
        "balance": 1000
      }
    ]
  }
}
```
### Выход из конматы
ОТ КЛИЕНТА
```json
{
  "type": "leaveRoom"
}
```

## Игра
### Готовность к игре

```json
{
  "type": "ready"
}
```
ОТ СЕРВЕР 
```json
{
  "type": "roomUpdate" // ready
}
```
### Раздача карт и решение на игру
ОТ СЕРВЕРА
```json
{
  "type": "requestPlayDecision",
  "phase": "deciding"
}
```

ОТ КЛИЕНТА
```json
{
  "type": "decidePlaying",
  "data": {
    "play": true
  }
}
```

### Запрос на удаление карты
ОТ СЕРВЕРА
```json
{
  "type": "requestDiscard"
}
```

ОТ КЛИЕНТА
```json
{
  "type": "discardCard",
  "data": {
    "cardIndex": 0 // 0 1 2 3  (4 карты)
  }
}
```

ОТ СЕРВЕРА
```json
{
    "type": "gameUpdate",
    "phase": "bidding"
}
```

## Ставки
### Начало ставок

ОТ СЕРВЕРА

```json
{
  "type": "requestBid"
}
```
ОТ КЛИЕНТА
```json
{
  "type": "bidAction",
  "data": {
    "action": "raise" //pass
  }
}
```
## Игра

### Запрос хода картой
ОТ СЕРВЕРА
```json
{
  "type": "requestMove",
  "validCards": [0, 2]
}
```
ОТ КЛИЕНТА 
```json
{
  "type": "playCard",
  "data": {
    "cardIndex": 0
  }
}
```
