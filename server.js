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
  "🐱 قطة",
  "🐶 كلب",
  "🦁 أسد",
  "🐯 نمر",
  "🐰 أرنب",
  "🐼 باندا",
  "🐨 كوالا",
  "🦊 ثعلب",
  "🐵 قرد",
  "🐸 ضفدع",
  "🐘 فيل",
  "🦒 زرافة",
  "🐧 بطريق",
  "🐢 سلحفاة",
  "🦓 حمار وحشي"
];

function generateRoomCode() {
  let code;

  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
  } while (rooms.has(code));

  return code;
}

function getPlayerList(room) {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name
  }));
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("create-room", ({ name }, callback) => {
    if (!name || !name.trim()) {
      return callback({
        success: false,
        message: "اكتب اسمك أولًا"
      });
    }

    const roomCode = generateRoomCode();

    const room = {
      host: socket.id,
      players: [],
      started: false
    };

    rooms.set(roomCode, room);

    const player = {
      id: socket.id,
      name: name.trim()
    };

    room.players.push(player);

    socket.join(roomCode);

    socket.roomCode = roomCode;

    callback({
      success: true,
      roomCode,
      isHost: true
    });

    io.to(roomCode).emit(
      "players:update",
      getPlayerList(room)
    );
  });

  socket.on("join-room", ({ name, roomCode }, callback) => {
    console.log("Join attempt:", name, roomCode);
    if (!name || !name.trim()) {
      return callback({
        success: false,
        message: "اكتب اسمك أولًا"
      });
    }

    const code = String(roomCode).trim();

    const room = rooms.get(code);

    if (!room) {
      return callback({
        success: false,
        message: "الغرفة غير موجودة"
      });
    }

    if (room.started) {
      return callback({
        success: false,
        message: "اللعبة بدأت بالفعل"
      });
    }

    if (room.players.length >= 20) {
      return callback({
        success: false,
        message: "الغرفة ممتلئة"
      });
    }

    const alreadyName = room.players.some(
      (player) =>
        player.name.toLowerCase() === name.trim().toLowerCase()
    );

    if (alreadyName) {
      return callback({
        success: false,
        message: "هذا الاسم مستخدم داخل الغرفة"
      });
    }

    const player = {
      id: socket.id,
      name: name.trim()
    };

    room.players.push(player);

    socket.join(code);

    socket.roomCode = code;

    callback({
      success: true,
      roomCode: code,
      isHost: socket.id === room.host
    });

    io.to(code).emit(
      "players:update",
      getPlayerList(room)
    );
  });

  socket.on("start-game", ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);

    if (!room) {
      return callback({
        success: false,
        message: "الغرفة غير موجودة"
      });
    }

    if (socket.id !== room.host) {
      return callback({
        success: false,
        message: "فقط صاحب الغرفة يستطيع بدء اللعبة"
      });
    }

    if (room.players.length < 3) {
      return callback({
        success: false,
        message: "لازم يكون في 3 لاعبين على الأقل"
      });
    }

    room.started = true;

    const animal =
      animals[Math.floor(Math.random() * animals.length)];

    const outsiderIndex =
      Math.floor(Math.random() * room.players.length);

    room.players.forEach((player, index) => {
      const targetSocket = io.sockets.sockets.get(player.id);

      if (!targetSocket) return;

      if (index === outsiderIndex) {
        targetSocket.emit("game:role", {
          role: "outsider"
        });
      } else {
        targetSocket.emit("game:role", {
          role: "animal",
          animal
        });
      }
    });

    io.to(roomCode).emit("game:started");

    callback({
      success: true
    });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    const roomCode = socket.roomCode;

    if (!roomCode) return;

    const room = rooms.get(roomCode);

    if (!room) return;

    room.players = room.players.filter(
      (player) => player.id !== socket.id
    );

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      return;
    }

    if (room.host === socket.id) {
      room.host = room.players[0].id;
    }

    io.to(roomCode).emit(
      "players:update",
      getPlayerList(room)
    );
  });
});

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`برا السالفة تعمل على المنفذ ${PORT}`);
});
