const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

var physicsServer = undefined;
var lastFreeBlocks = '[]';
var anchorId = undefined
var gameState = undefined;

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {

    console.log('a user connected');
    if (anchorId !== undefined) {
        socket.emit('anchor id update', anchorId);
    }

    if (gameState !== undefined) {
        socket.emit('game state update', gameState)
    }

    socket.emit('free blocks update', lastFreeBlocks)
    
    if (physicsServer == undefined) {
        console.log('Asking new user to be server');
        socket.emit('need server', '');
    }


    socket.on('disconnect', () => {
        console.log('user disconnected');
        if (socket === physicsServer) {
            console.log('he was server...');
            physicsServer = undefined
            io.emit('need server', '');
        }
    });
    socket.on('chat message', (msg) => {
        console.log('message: ' + msg);
        io.emit('chat message', msg);
    });
    socket.on('hello', (msg) => {
	io.emit('chat message', 'Android has joined us with: ' + msg);
    });
    
    socket.on('i am server', (_) => {
        console.log('received serving offer');
        if (physicsServer === undefined) {
	    physicsServer = socket;
        } else {
            socket.emit('back off')
            console.log('Duplicate serving offer - asking to back off')
        }
    });

    socket.on('i am client', (msg) => {
        console.log('Client joined: ' + msg)
        socket.join('clients');
    });

    socket.on('delete block', (msg) => {
        if (physicsServer) {
            physicsServer.emit('delete block', msg);
        }
    });

    socket.on('add block', (msg) => {
        if (physicsServer) {
            physicsServer.emit('add block', msg);
        }
    });

    socket.on('new game', (msg) => {
        if (physicsServer) {
            physicsServer.emit('new game', msg);
        }
    });

    socket.on('free blocks update', (msg) => {
        if (socket === physicsServer) {
            lastFreeBlocks = msg
            io.to('clients').emit('free blocks update', msg);
        } else {
            console.log('Free blocks update from non-server - asking to back off')
            socket.emit('back off')
        }
    });

    socket.on('user state update', (msg) => {
        io.to('clients').emit('user state update', msg);
    });

    socket.on('game state update', (msg) => {
        gameState = msg
        io.to('clients').emit('game state update', msg);
    });

    socket.on('anchor id update', (msg) => {
        console.log('Anchor id update: ' + msg)
        anchorId = msg
        io.to('clients').emit('anchor id update', msg);
    });
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
