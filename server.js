const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// 🔐 كلمة سر المالك لإنشاء الغرف
const OWNER_PIN = "a********@#";

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

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
    isMuted: player.isMuted || false
  }));
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("create-room", ({ name, pin }, callback) => {
    if (!name || !name.trim()) {
      return callback({ success: false, message: "اكتب اسمك أولًا" });
    }

    if (pin !== OWNER_PIN) {
      return callback({ success: false, message: "❌ عذراً، فقط المالك يستطيع إنشاء غرف جديدة!" });
    }

    const roomCode = generateRoomCode();
    const room = { host: socket.id, players: [], started: false };
    rooms.set(roomCode, room);

    const player = { id: socket.id, name: name.trim(), isMuted: false };
    room.players.push(player);

    socket.join(roomCode);
    socket.roomCode = roomCode;

    callback({ success: true, roomCode, isHost: true });
    io.to(roomCode).emit("players:update", getPlayerList(room));
  });

  socket.on("join-room", ({ name, roomCode }, callback) => {
    if (!name || !name.trim()) {
      return callback({ success: false, message: "اكتب اسمك أولًا" });
    }

    const code = String(roomCode).trim();
    const room = rooms.get(code);

    if (!room) return callback({ success: false, message: "الغرفة غير موجودة" });
    if (room.started) return callback({ success: false, message: "اللعبة بدأت بالفعل" });
    if (room.players.length >= 7) {
      return callback({ success: false, message: "الغرفة ممتلئة (الحد الأقصى 7 لاعبين)" });
    }

    const alreadyName = room.players.some(
      (p) => p.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (alreadyName) return callback({ success: false, message: "هذا الاسم مستخدم داخل الغرفة" });

    const player = { id: socket.id, name: name.trim(), isMuted: false };
    room.players.push(player);

    socket.join(code);
    socket.roomCode = code;

    callback({ success: true, roomCode: code, isHost: socket.id === room.host });
    io.to(code).emit("players:update", getPlayerList(room));
  });

  socket.on("start-game", ({ roomCode }, callback) => {
    const room = rooms.get(roomCode);

    if (!room) return callback({ success: false, message: "الغرفة غير موجودة" });
    if (socket.id !== room.host) {
      return callback({ success: false, message: "فقط صاحب الغرفة يستطيع بدء اللعبة" });
    }

    if (room.players.length < 3) {
      return callback({ success: false, message: "لازم يكون في 3 لاعبين على الأقل" });
    }

    if (room.players.length > 7) {
      return callback({ success: false, message: "الحد الأقصى للعب هو 7 لاعبين فقط" });
    }

    room.started = true;
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const outsiderIndex = Math.floor(Math.random() * room.players.length);

    room.players.forEach((player, index) => {
      const targetSocket = io.sockets.sockets.get(player.id);
      if (!targetSocket) return;

      if (index === outsiderIndex) {
        targetSocket.emit("game:role", { role: "outsider" });
      } else {
        targetSocket.emit("game:role", { role: "animal", animal });
      }
    });

    io.to(roomCode).emit("game:started");
    callback({ success: true });
  });

  // التحكم بالكتم والسماح (خاص بالمالك)
  socket.on("toggle-mute", ({ roomCode, targetId, muteState }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    if (socket.id !== room.host) return; // للتحقق أن المرسل هو المالك

    const player = room.players.find((p) => p.id === targetId);
    if (player) {
      player.isMuted = muteState;
      io.to(roomCode).emit("players:update", getPlayerList(room));
    }
  });

  // حدث الشات مع فحص الكتم وتمرير senderId لتمييز رسائل كل لاعب
  socket.on("send-message", ({ roomCode, message }, callback) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    if (player.isMuted) {
      if (typeof callback === "function") {
        return callback({ success: false, message: "❌ أنت مكتوم حالياً من قبل المالك!" });
      }
      return;
    }

    io.to(roomCode).emit("chat:message", {
      senderId: socket.id, // تم تضمين معرّف المرسل هنا لتمييز الرسائل
      sender: player.name,
      message: message.trim()
    });

    if (typeof callback === "function") {
      callback({ success: true });
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      return;
    }

    if (room.host === socket.id) {
      room.host = room.players[0].id;
    }

    io.to(roomCode).emit("players:update", getPlayerList(room));
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`برا السالفة تعمل على المنفذ ${PORT}`);
});
