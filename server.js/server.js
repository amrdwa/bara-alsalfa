const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

const animals = [
  "قط",
  "كلب",
  "أسد",
  "نمر",
  "فيل",
  "زرافة",
  "حصان",
  "أرنب",
  "دب",
  "قرد",
  "بطريق",
  "دجاجة",
  "بقرة",
  "خروف",
  "ذئب"
];

function createRoom() {
  let code;

  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));

  rooms.set(code, {
    players: [],
    started: false,
    animal: null,
    outsiderId: null
  });

  return code;
}

function getRoomPlayers(room) {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name
  }));
}

function sendPlayers(roomCode) {
  const room = rooms.get(roomCode);

  if (!room) return;

  io.to(roomCode).emit("players:update", getRoomPlayers(room));
}

function leaveRoom(socket) {
  const roomCode = socket.data.roomCode;

  if (!roomCode) return;

  const room = rooms.get(roomCode);

  if (!room) return;

  room.players = room.players.filter(
    (player) => player.id !== socket.id
  );

  socket.leave(roomCode);
  socket.data.roomCode = null;

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    return;
  }

  sendPlayers(roomCode);
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("create-room", ({ name }, callback) => {
    name = String(name || "").trim();

    if (!name) {
      return callback({
        success: false,
        message: "اكتب اسمك أولًا"
      });
    }

    if (socket.data.roomCode) {
      leaveRoom(socket);
    }

    const roomCode = createRoom();
    const room = rooms.get(roomCode);

    room.players.push({
      id: socket.id,
      name
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    callback({
      success: true,
      roomCode,
      isHost: true
    });

    sendPlayers(roomCode);
  });

  socket.on("join-room", ({ name, roomCode }, callback) => {
    name = String(name || "").trim();
    roomCode = String(roomCode || "").trim();

    if (!name) {
      return callback({
        success: false,
        message: "اكتب اسمك أولًا"
      });
    }

    if (!rooms.has(roomCode)) {
      return callback({
        success: false,
        message: "الغرفة غير موجودة"
      });
    }

    const room = rooms.get(roomCode);

    if (room.started) {
      return callback({
        success: false,
        message: "الجولة بدأت بالفعل"
      });
    }

    if (room.players.length >= 10) {
      return callback({
        success: false,
        message: "الغرفة ممتلئة"
      });
    }

    if (
      room.players.some(
        (player) =>
          player.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      return callback({
        success: false,
        message: "هذا الاسم مستخدم داخل الغرفة"
      });
    }

    if (socket.data.roomCode) {
      leaveRoom(socket);
    }

    room.players.push({
      id: socket.id,
      name
    });

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    callback({
      success: true,
      roomCode,
      isHost: room.players.length === 1
    });

    sendPlayers(roomCode);
  });

  socket.on("start-game", ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);

    if (!room) {
      return callback({
        success: false,
        message: "الغرفة غير موجودة"
      });
    }

    if (room.players.length < 3) {
      return callback({
        success: false,
        message: "لازم يكون في 3 لاعبين على الأقل"
      });
    }

    if (room.started) {
      return callback({
        success: false,
        message: "الجولة بدأت بالفعل"
      });
    }

    room.started = true;

    room.animal =
      animals[Math.floor(Math.random() * animals.length)];

    const outsiderIndex = Math.floor(
      Math.random() * room.players.length
    );

    room.outsiderId = room.players[outsiderIndex].id;

    for (const player of room.players) {
      const isOutsider =
        player.id === room.outsiderId;

      io.to(player.id).emit("game:role", {
        role: isOutsider ? "outsider" : "player",
        animal: isOutsider ? null : room.animal
      });
    }

    io.to(roomCode).emit("game:started");

    callback({
      success: true
    });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    leaveRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`برا السالفة running on port ${PORT}`);
});
