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