const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mediasoup = require("mediasoup");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

app.use(
  cors({
    origin: "http://localhost:3001", // Allow the client from this origin
    methods: ["GET", "POST"], // Define allowed HTTP methods
    allowedHeaders: ["Content-Type"], // Allow Content-Type header in requests
  })
);

// Your existing code for socket.io
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3001", // Ensure it's consistent here
    methods: ["GET", "POST"],
  },
});

app.post("/createMeeting", (req, res) => {
  const roomId = uuidv4(); // Generate a unique meeting ID
  peers[roomId] = []; // Initialize the room with no peers
  // console.log(`Meeting created with ID: ${roomId}`);
  res.json({ roomId }); // Send the meeting ID to the client
});

const mediasoupWorkers = [];
let router;

const peers = {};
const users = {};

(async () => {
  try {
    const worker = await mediasoup.createWorker();
    mediasoupWorkers.push(worker);

    router = await worker.createRouter({
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
      ],
    });

    // console.log("Mediasoup worker and router created.");
  } catch (error) {
    console.error("Error initializing Mediasoup worker/router:", error);
  }
})();

io.on("connection", (socket) => {
  users[socket.id] = { id: socket.id, roomId: null };

  socket.on("joinRoom", async (roomId, callback) => {
    // console.log(`${socket.id} is joining room: ${roomId}`);

    users[socket.id].roomId = roomId;

    if (!peers[roomId]) peers[roomId] = [];
    peers[roomId].push(socket.id);

    socket.join(roomId);
    const userList = peers[roomId].map((id) => ({ id }));
    // console.log("user updated list " + JSON.stringify(userList));
    io.to(roomId).emit("updateUserList", userList);

    // Check if router is ready before sending the capabilities
    if (router && router.rtpCapabilities) {
      console.log("Sending router RTP capabilities");
      callback({ routerRtpCapabilities: router.rtpCapabilities });
    } else {
      console.error("Router not initialized yet");
      callback({ error: "Router not ready" });
    }
  });

  // Handle client request to create transport
  socket.on("createTransport", async (callback) => {
    try {
      if (!router) {
        return callback({ error: "Router is not ready" });
      }

      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      socket.transport = transport;

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (error) {
      console.error("Error creating transport:", error);
      callback({ error: "Transport creation failed" });
    }
  });

  socket.on(
    "connectTransport",
    async ({ dtlsParameters }, callback, errback) => {
      // console.log("Client requesting transport connection with dtlsParameters:", dtlsParameters);

      try {
        if (!socket.transport) {
          console.error("No transport available for connection");
          return errback("Transport not available");
        }

        // Connect the transport with the provided dtlsParameters
        await socket.transport.connect({ dtlsParameters });
        // console.log("Transport connected successfully");
        callback(); // Call the callback to indicate success
      } catch (error) {
        console.error("Error connecting transport:", error);
        errback(error); // Call the errback in case of failure
      }
    }
  );

  socket.on("produce", async ({ kind, rtpParameters }, callback) => {
    // console.log("Received 'produce' event with kind:", kind, "and rtpParameters:", rtpParameters);  // Log rtpParameters
    try {
      const producer = await socket.transport.produce({ kind, rtpParameters });
      const roomId = users[socket.id].roomId;

      peers[roomId].producers = peers[roomId].producers || [];
      peers[roomId].producers.push(producer);

      callback({ id: producer.id });
      console.log("producer.id", producer.id);
      console.log("socket.id", socket.id);
      // Notify other participants in the room about the new producer
      socket.broadcast.to(roomId).emit("newProducer", {
        producerId: producer.id,
        userId: socket.id,
      });

      // console.log("Created new producer with ID:", producer.id);  // Log producer creation
    } catch (error) {
      console.error("Error producing media:", error);
      callback({ error: "Production failed" });
    }
  });

  socket.on("getProducers", (callback) => {
    try {
      const roomId = users[socket.id]?.roomId;

      if (!roomId || !peers[roomId]) {
        return callback({ error: "Room not found or no producers available" });
      }

      // Retrieve producers from the peers object for the specific room
      const producers = peers[roomId].producers || [];

      // Map producer details if needed (e.g., IDs only)
      const producerList = producers.map((producer) => ({
        id: producer.id,
        kind: producer.kind,
      }));

      callback({ producers: producerList });
    } catch (error) {
      console.error("Error fetching producers:", error);
      callback({ error: "Failed to fetch producers" });
    }
  });

  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    try {
      console.log("Consume request received:", producerId);
      // const consumer = await socket.transport.consume({
      //   producerId,
      //   rtpCapabilities,
      //   paused: false,
      // });
      const consumer = await socket.transport.consume({
        producerId,
        rtpCapabilities,
        paused: true,
      });
      console.log("consumer", consumer);
      callback({
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });

      // Store consumer for cleanup purposes (if necessary)
      peers[users[socket.id].roomId].consumers =
        peers[users[socket.id].roomId].consumers || [];
      peers[users[socket.id].roomId].consumers.push(consumer);
    } catch (error) {
      console.error("Error consuming mediaggggggggggg:", error);
      callback({ error: "Consume failed" });
    }
  });

  socket.on("disconnect", () => {
    // console.log(`Client disconnected: ${socket.id}`);

    const roomId = users[socket.id]?.roomId;
    if (roomId && peers[roomId]) {
      peers[roomId] = peers[roomId].filter((id) => id !== socket.id);
      const userList = peers[roomId].map((id) => ({ id }));

      io.to(roomId).emit("updateUserList", userList);

      if (peers[roomId].length === 0) {
        delete peers[roomId];
      }
    }

    delete users[socket.id];
  });
});

server.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
