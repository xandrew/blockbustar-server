const express = require('express');
const app = express();
const http = require('http');

const port = process.env.PORT || 3000;

const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

const physicsServer = {};
const lastFreeBlocks = {};
const gameState = {};

const playgrounds = []

var nextRoom = 0;

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('a user connected');

    var room = undefined
    var location = undefined

    function joinRoom(newRoom) {
        leaveRoom();
        room = newRoom;
        socket.join(room);
        if (gameState[room] !== undefined) {
            socket.emit('game state update', gameState[room])
        }
        socket.emit('free blocks update', lastFreeBlocks[room])
        if (physicsServer[room] === undefined) {
            console.log('Asking new user to be server');
            socket.emit('need server', '');
        }
    }

    function leaveRoom() {
        if (room !== undefined) {
            socket.leave(room);
            if (physicsServer[room] === socket) {
                console.log('he was server for: ' + room);
                physicsServer[room] = undefined;
                io.to(room).emit('need server', '');
            }
        }
    }
    
    socket.on('create playground', (playgroundRequestJson) => {
        const playgroundRequest = JSON.parse(playgroundMetaJson);
        const playgroundMeta = playgroundRequest.playground;
        // TODO: not very thread safe.
        const newRoom = 'room' + nextRoom;
        nextRoom += 1;
        playgroundMeta.room = newRoom;
        playgrounds.push(playgroundMeta);
        lastFreeBlocks[newRoom] = JSON.stringify(playgroundRequest.initialState);
        joinRoom(newRoom);
        // Should ideally only emit to nearby players. TODO
        io.emit('playgrounds', JSON.stringify(playgrounds));
    });

    socket.on('get playgrounds', (_) => {
        // This should ideally only report close ones. TODO
        console.log('Client requested playgrounds. Sent him JSON: ' + JSON.stringify(playgrounds));
        socket.emit('playgrounds', JSON.stringify(playgrounds));
    });

    socket.on('join playground', (playgroundRoom) => {
        joinRoom(playgroundRoom);
    });

    socket.on('disconnect', (reason, details) => {
        console.log('user disconnected');
        console.log(reason);
        console.log(details);
        if (details !== undefined) {
            console.log(details.message);
            console.log(details.description);
            console.log(details.context);
        }
        leaveRoom()
    });

    socket.on('i am server', (_) => {
        console.log('received serving offer for room: ' + room);
        if ((room !== undefined) && (physicsServer[room] === undefined)) {
	    physicsServer[room] = socket;
        } else {
            socket.emit('back off')
            console.log(
                'Duplicate or out of room serving offer - asking to back off');
        }
    });

    socket.on('delete block', (msg) => {
        if ((room !== undefined) && physicsServer[room]) {
            physicsServer[room].emit('delete block', msg);
        }
    });

    socket.on('add block', (msg) => {
        if ((room !== undefined) && physicsServer[room]) {
            physicsServer[room].emit('add block', msg);
        }
    });

    socket.on('new game', (msg) => {
        if ((room !== undefined) && physicsServer[room]) {
            physicsServer[room].emit('new game', msg);
        }
    });

    socket.on('free blocks update', (msg) => {
        if ((room !== undefined) && (socket === physicsServer[room])) {
            lastFreeBlocks[room] = msg
            io.to(room).emit('free blocks update', msg);
        } else {
            console.log(
                'Free blocks update from non-server-of-room - asking to back off');
            socket.emit('back off')
        }
    });

    socket.on('user state update', (msg) => {
        if (room !== undefined) {
            io.to(room).emit('user state update', msg);
        }
    });

    socket.on('game state update', (msg) => {
        if ((room !== undefined) && (socket === physicsServer[room])) {
            gameState[room] = msg;
            io.to(room).emit('game state update', msg);
        } else {
            console.log(
                'Game state update from non-server-of-room - asking to back off');
            socket.emit('back off')
        }
    });
});

server.listen(port, () => {
  console.log('listening on *:' + port);
});
