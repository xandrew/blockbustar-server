const express = require('express');
const app = express();
const http = require('http');

const port = process.env.PORT || 3000;

const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

const physicsServer = {};
const lastFreeBlocks = {};
const lastConfigs = {};

const playgrounds = []

const playgroundListeners = {};

var nextRoom = 0;

const playgroundLifeTime = (23 * 60 + 50) * 60 * 1000;

var nextConnectionId = 0;

function removeOldPlaygrounds() {
    const now = Date.now();
    for (let i = playgrounds.length - 1; i >= 0; i--) {
        if (now > playgrounds[i].creationServerTimeMillis + playgroundLifeTime) {
	    console.log('Removing playground: ' + JSON.stringify(playgrounds[i]));
            playgrounds.splice(i, 1);
        }
    }
}

function playgroundListener(socket, clientLocation) {
    function closeEnough(location) {
	const cLat = clientLocation.latitude * Math.PI / 180;
	const cLon = clientLocation.longitude * Math.PI / 180;
	const pLat = location.latitude * Math.PI / 180;
	const pLon = location.longitude * Math.PI / 180;
	const distance = Math.acos(
                Math.sin(cLat)*Math.sin(pLat) +
                Math.cos(cLat)*Math.cos(pLat) * Math.cos(cLon - pLon)
            ) * 6371000;
	const tolerance = 2 * (location.accuracyMeters + clientLocation.accuracyMeters);
	return distance < tolerance;
    }
    return {
	sendPlaygrounds() {
	    const relevantPlaygrounds = [];
	    for (let i = 0; i < playgrounds.length; i++) {
		if (closeEnough(playgrounds[i].location)) {
		    relevantPlaygrounds.push(playgrounds[i]);
		}
	    }
            console.log('Sent playgrounds: ' + JSON.stringify(relevantPlaygrounds));
            socket.emit('playgrounds', JSON.stringify(relevantPlaygrounds));
	},
	closeEnough
    };
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/playground', (req, res) => {
    res.sendFile(__dirname + '/playground.html');
});

io.on('connection', (socket) => {
    const connectionId = nextConnectionId;
    nextConnectionId += 1;
    
    console.log('a user connected: ' + socket.id);

    var room = undefined
    var location = undefined

    function joinRoom(newRoom) {
        leaveRoom();

	delete playgroundListeners[connectionId];
	
        room = newRoom;
        socket.join(room);
        console.log('Socket ' + socket.id + ' joined room: ' + room);
        socket.emit('free blocks update', lastFreeBlocks[room]);
        console.log('Sent free blocks update to new joiner');
        socket.emit('new config', lastConfigs[room]);
        console.log('Sent config to new joiner: ' + lastConfigs[room]);

        if (physicsServer[room] === undefined) {
            console.log('Asking new ' + socket.id + ' to be server');
            socket.emit('need server', lastFreeBlocks[room]);
        }
    }

    function leaveRoom() {
        if (room !== undefined) {
            socket.leave(room);
            if (physicsServer[room] === socket) {
                console.log(socket.id + ' was server for: ' + room);
                physicsServer[room] = undefined;
                io.to(room).emit('need server', lastFreeBlocks[room]);
            }
	    room = undefined;
        }
    }
    
    socket.on('create playground', (playgroundRequestJson) => {
        console.log('New playground requested: ' + playgroundRequestJson);
        const playgroundRequest = JSON.parse(playgroundRequestJson);
        const playgroundMeta = playgroundRequest.playground;
        // TODO: not very thread safe.
        const newRoom = 'room' + nextRoom;
        nextRoom += 1;
        playgroundMeta.room = newRoom;
        playgroundMeta.creationServerTimeMillis = Date.now();
        playgrounds.push(playgroundMeta);
        lastFreeBlocks[newRoom] = JSON.stringify(playgroundRequest.initialState);
        lastConfigs[newRoom] = JSON.stringify(playgroundRequest.initialConfig);
        
        joinRoom(newRoom);

	Object.values(playgroundListeners).forEach(listener => {
	    if (listener.closeEnough(playgroundMeta.location)) {
		listener.sendPlaygrounds();
	    }
	});
    });

    socket.on('get playgrounds', (msg) => {
        removeOldPlaygrounds();

        const request = JSON.parse(msg);

        console.log('Client requested playgrounds from: ' + msg);
	const listener = playgroundListener(socket, request);
	listener.sendPlaygrounds();
	playgroundListeners[connectionId] = listener;
    });

    socket.on('get all playgrounds', (msg) => {
        removeOldPlaygrounds();
        console.log('Client requested all playgrounds.');
        console.log('Sent all playgrounds: ' + JSON.stringify(playgrounds));
        socket.emit('playgrounds', JSON.stringify(playgrounds));
    });

    socket.on('join playground', (playgroundRoom) => {
        joinRoom(playgroundRoom);
    });

    socket.on('leave playground', (playgroundRoom) => {
        leaveRoom();
    });

    socket.on('disconnect', (reason, details) => {
        console.log('user disconnected: ' + socket.id);
        console.log(reason);
        console.log(details);
        if (details !== undefined) {
            console.log(details.message);
            console.log(details.description);
            console.log(details.context);
        }
	delete playgroundListeners[connectionId];
        leaveRoom();
    });

    socket.on('i am server', (_) => {
        console.log('received serving offer from ' + socket.id + ' for room: ' + room);
        if ((room !== undefined) && (physicsServer[room] === undefined)) {
	    physicsServer[room] = socket;
        } else {
            socket.emit('back off')
            console.log(
                'Duplicate or out of room serving offer - asking to back off');
        }
    });

    socket.on('free blocks update', (msg) => {
        if ((room !== undefined) && (socket === physicsServer[room])) {
            lastFreeBlocks[room] = msg
            io.to(room).emit('free blocks update', msg);
        } else {
            console.log(
                'Free blocks update from non-server-of-room ' + socket.id + '- asking to back off');
            socket.emit('back off')
        }
    });

    socket.on('new config', (msg) => {
        if (room !== undefined) {
            lastConfigs[room] = msg
            io.to(room).emit('new config', msg);
            console.log('New config: ' + msg);
        }
    });

    socket.on('user report', (msg) => {
        const report = JSON.parse(msg);

        if (room !== undefined) {
            io.to(room).emit('user state update', JSON.stringify(report.userState));
            if (physicsServer[room]) {
                physicsServer[room].emit('user report', msg);
            }
        }
    });
});

server.listen(port, () => {
  console.log('listening on *:' + port);
});
