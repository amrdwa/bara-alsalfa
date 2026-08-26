const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 30000,
  pingInterval: 10000
});

const PORT = process.env.PORT || 3000;
const OWNER_PIN = "a********@#";

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
// كائن لتخزين مؤقتات الانتظار عند قطع اتصال اللاعبين
const roomCleanups = new Map();

const animals = [
  "🐱 قطة", "🐶 كلب", "🦁 أسد", "🐯 نمر", "🐰 أرنب", "🐼 باندا", "🐨 كوالا",
  "🦊 ثعلب", "🐵 قرد", "🐸 ضفدع", "🐘 فيل", "🦒 زرافة", "🐧 بطريق", "🐢 سلحفاة",
  "🦓 حمار وحشي", "🦅 صقر", "🐦 عصفور", "🐊 تمساح", "🦅 نسر", "🦉 بومة",
  "🐺 ذئب", "🦏 خرتيت", "🦛 فرس النهر", "🦘 كنجر", "🐪 جمل", "🐴 حصان",
  "🐬 دلفين", "🦈 قرش", "🦚 طاووس"
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
    name: player.name,
    score: player.score || 0,
    isMuted: player.isMuted || false,
    ready: player.ready || false,
    isConnected: player.isConnected !== false
  }));
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name, pin }, callback) => {
    if (!name || !name.trim()) return callback({ success: false, message: "اكتب اسمك أولًا" });
    if (pin !== OWNER_PIN) return callback({ success: false, message: "❌ فقط المالك يستطيع إنشاء غرف جديدة!" });

    const roomCode = generateRoomCode();
    const room = { 
      host: socket.id, 
      hostName: name.trim(),
      players: [], 
      spectators: [], 
      started: false,
      votes: new Map(),
      currentAnimal: null,
      outsiderId: null
    };
    rooms.set(roomCode, room);

    const player = { id: socket.id, name: name.trim(), score: 0, isMuted: false, ready: false, isConnected: true };
    room.players.push(player);

    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = name.trim();

    callback({ success: true, roomCode, isHost: true });
    io.to(roomCode).emit("players:update", getPlayerList(room));
  });

  socket.on("join-room", ({ name, roomCode }, callback) => {
    if (!name || !name.trim()) return callback({ success: false, message: "اكتب اسمك أولًا" });

    const code = String(roomCode).trim();
    const room = rooms.get(code);

    if (!room) return callback({ success: false, message: "الغرفة غير موجودة" });
    if (room.started) return callback({ success: false, message: "اللعبة بدأت بالفعل" });
    if (room.players.length >= 7) return callback({ success: false, message: "الغرفة ممتلئة (حد أقصى 7)" });

    const alreadyName = room.players.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (alreadyName) return callback({ success: false, message: "هذا الاسم مستخدم داخل الغرفة" });

    const player = { id: socket.id, name: name.trim(), score: 0, isMuted: false, ready: false, isConnected: true };
    room.players.push(player);

    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name.trim();

    callback({ success: true, roomCode: code, isHost: socket.id === room.host });
    io.to(code).emit("players:update", getPlayerList(room));
  });

  socket.on("spectate-room", ({ roomCode }, callback) => {
    const code = String(roomCode).trim();
    const room = rooms.get(code);
    if (!room) return callback({ success: false, message: "الغرفة غير موجودة" });

    socket.join(code);
    socket.roomCode = code;
    socket.isSpectator = true;

    if (!room.spectators) room.spectators = [];
    room.spectators.push(socket.id);

    callback({ success: true, roomCode: code });
    socket.emit("players:update", getPlayerList(room));
  });

  socket.on("start-game", ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.host) return callback({ success: false, message: "غير مسموح" });
    if (room.players.length < 3) return callback({ success: false, message: "يلزم 3 لاعبين على الأقل" });

    room.started = true;
    room.votes.clear();
    room.players.forEach(p => p.ready = false);
    
    room.currentAnimal = animals[Math.floor(Math.random() * animals.length)];
    const outsiderIndex = Math.floor(Math.random() * room.players.length);
    room.outsiderId = room.players[outsiderIndex].id;

    room.players.forEach((player, index) => {
      const targetSocket = io.sockets.sockets.get(player.id);
      if (!targetSocket) return;

      if (index === outsiderIndex) {
        targetSocket.emit("game:role", { role: "outsider" });
      } else {
        targetSocket.emit("game:role", { role: "animal", animal: room.currentAnimal });
      }
    });

    io.to(roomCode).emit("game:started");
    callback({ success: true });
  });

  socket.on("start-voting-phase", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.host) return;

    room.votes.clear();
    io.to(roomCode).emit("vote:start");
  });

  socket.on("submit-vote", ({ roomCode, targetId }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.isSpectator) return;

    const voter = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId);

    if (voter && target) {
      room.votes.set(socket.id, { voterName: voter.name, targetId: target.id, targetName: target.name });

      const votesList = Array.from(room.votes.values());
      io.to(roomCode).emit("vote:update-live", votesList);

      if (room.votes.size === room.players.length) {
        const outsiderPlayer = room.players.find(p => p.id === room.outsiderId);
        
        let otherAnimals = animals.filter(a => a !== room.currentAnimal);
        otherAnimals.sort(() => 0.5 - Math.random());
        let choices = [room.currentAnimal, ...otherAnimals.slice(0, 4)];
        choices.sort(() => 0.5 - Math.random());

        io.to(roomCode).emit("vote:completed", {
          outsiderName: outsiderPlayer ? outsiderPlayer.name : "مجهول",
          outsiderId: room.outsiderId,
          choices: choices
        });
      }
    }
  });

  socket.on("guess-animal", ({ roomCode, chosenAnimal }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.outsiderId) return;

    const isCorrect = (chosenAnimal === room.currentAnimal);

    const roundSummary = room.players.map(p => {
      let earned = 0;

      if (p.id === room.outsiderId) {
        if (isCorrect) earned = 100;
      } else {
        const userVote = room.votes.get(p.id);
        if (userVote && userVote.targetId === room.outsiderId) {
          earned = 100;
        }
      }

      p.score = (p.score || 0) + earned;

      return {
        id: p.id,
        name: p.name,
        earnedScore: earned,
        totalScore: p.score
      };
    });

    io.to(roomCode).emit("guess:result", {
      chosenAnimal,
      correctAnimal: room.currentAnimal,
      isCorrect,
      roundSummary
    });
  });

  socket.on("player-ready", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = true;
      io.to(roomCode).emit("players:update", getPlayerList(room));
    }
  });

  socket.on("toggle-mute", ({ roomCode, targetId, muteState }) => {
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.host) return;

    const player = room.players.find((p) => p.id === targetId);
    if (player) {
      player.isMuted = muteState;
      io.to(roomCode).emit("players:update", getPlayerList(room));
    }
  });

  socket.on("send-message", ({ roomCode, message }, callback) => {
    const room = rooms.get(roomCode);
    if (!room || socket.isSpectator) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.isMuted) return;

    io.to(roomCode).emit("chat:message", {
      senderId: socket.id,
      sender: player.name,
      message: message.trim()
    });

    if (typeof callback === "function") callback({ success: true });
  });

  // منطق المغادرة المؤقتة لتفادي إغلاق الغرفة أثناء التبديل بين التطبيقات
  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    if (socket.isSpectator) {
      room.spectators = (room.spectators || []).filter((id) => id !== socket.id);
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (player) {
      player.isConnected = false;
      io.to(roomCode).emit("players:update", getPlayerList(room));
    }

    // الانتظار 45 ثانية قبل حذف اللاعب أو إغلاق الغرفة
    const timerId = setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) return;

      currentRoom.players = currentRoom.players.filter((p) => p.id !== socket.id);

      if (currentRoom.players.length === 0 && (!currentRoom.spectators || currentRoom.spectators.length === 0)) {
        rooms.delete(roomCode);
      } else {
        if (currentRoom.host === socket.id && currentRoom.players.length > 0) {
          currentRoom.host = currentRoom.players[0].id;
        }
        io.to(roomCode).emit("players:update", getPlayerList(currentRoom));
      }
      roomCleanups.delete(socket.id);
    }, 45000);

    roomCleanups.set(socket.id, timerId);
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`برا السالفة تعمل على المنفذ ${PORT}`);
});
