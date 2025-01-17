const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mediasoup = require("mediasoup");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const { listeners } = require("process");

const app = express();
const server = http.createServer(app);

// CORS Configuration
app.use(
  cors({
    origin: "http://localhost:3001", // Client URL
    methods: ["GET", "POST"],
  })
);

const connections = socketIo(server, {
  cors: {
    origin: "http://localhost:3001", // Client URL
    methods: ["GET", "POST"],
  },
});

app.post("/createMeeting", (req, res) => {
  const roomId = uuidv4();
  peers[roomId] = [];
  res.json({ roomId });
});

let worker;
let router;
let consumerTransport;
let producerTransport;
let consumer;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];

// Create Worker
const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  console.log(`worker pid ${worker.pid}`);

  worker.on("died", () => {
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

// Initialize Worker
const initializeWorker = async () => {
  worker = await createWorker();
};
initializeWorker();

// Media Codecs
const mediaCodecs = [
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
];

// Socket Connection
connections.on("connection", async (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Check if the worker is initialized
  if (!worker) {
    console.error("Worker is not initialized yet.");
    socket.emit("error", { message: "Media worker is not ready yet." });
    return;
  }

  try {
    // Create a router for each connection if it doesn't exist

    if (!router) {
      router = await worker.createRouter({ mediaCodecs });
      console.log("Router created successfully");
    }
    socket.on("getRtpCapabilities", (callback) => {
      const rtpCapabilities = router.rtpCapabilities;
      console.log("rtpCapabilities", rtpCapabilities);
      callback({ rtpCapabilities });
    });
    // Emit connection success
    socket.emit("connection-success", {
      socketId: socket.id,
    });
    socket.on("disconnect", () => {
      console.log("peer disconnected");
    });
    socket.on("createWebRtcTransport", async ({ sender }, callback) => {
      console.log(`Is this a sender request?${sender}`);
      if (sender) producerTransport = await createWebRtcTransport(callback);
      else consumerTransport = await createWebRtcTransport(callback);
    });
    socket.on("transport-connect", async ({ dtlsParameters }) => {
      console.log("DTLS PARAMS... ", { dtlsParameters });

      await producerTransport.connect({ dtlsParameters });
    });
    socket.on(
      "tranport-produce",
      async ({ kind, rtpParameters, appdata }, callback) => {
        producer = await producerTransport.produce({
          kind,
          rtpParameters,
        });
        console.log("producer ID", producer.id, producer.kind);
        producer.on("transportclose", () => {
          console.log("transport for this producer closed");
          producer.close();
        });
        callback({
          id: producer.id,
        });
      }
    );
    socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
      console.log(`DTLS PARAMS:${dtlsParameters}`);
      await consumerTransport.connect({ dtlsParameters });
    });
    socket.on("consume", async ({ rtpCapabilities }, callback) => {
      try {
        if (
          router.canConsume({
            producerId: producer.id,
            rtpCapabilities,
          })
        ) {
          consumer = await consumerTransport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: true,
          });
          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });
          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
          });

          const params = {
            id: consumer.id,
            producerId: producer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          };
          callback({params})
        }
      } catch (error) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    });
    socket.on('consumer-resume',async()=>{
      console.log('consumer resume')
      await consumer.resume();
    })
    // const createWebRtcTransport = async () => {
    //   try {
    //     const webRtcTransport_options = {
    //       listenIps: [
    //         {
    //           ip: "127.0.0.1", // Localhost for testing, change to public IP in production
    //           announcedIp: null, // Use this if you're running behind NAT (e.g., set to public IP)
    //         },
    //       ],
    //       enableUdp: true,
    //       enableTcp: true,
    //       preferUdp: true,
    //     };

    //     let transport = await router.createWebRtcTransport(
    //       webRtcTransport_options
    //     );
    //     transport.on("dtlsstatechange", (dtlsState) => {
    //       if (dtlsState === "closed") {
    //         transport.close();
    //       }
    //     });
    //     transport.on("close", () => {
    //       console.log("transport closed");
    //     });
    //     callback({
    //       params: {
    //         id: transport.id,
    //         iceParameters: transport.iceParameters,
    //         iceCandidates: transport.iceCandidates,
    //         dtlsParameters: transport.dtlsParameters,
    //       },
    //     });
    //     return transport
    //   } catch (error) {
    //     console.log(error);
    //   }
    // };
    const createWebRtcTransport = async (callback) => {
      try {
        const webRtcTransport_options = {
          listenIps: [
            {
              ip: "127.0.0.1", // Localhost for testing, change to public IP in production
              announcedIp: null, // Use this if you're running behind NAT (e.g., set to public IP)
            },
          ],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        };

        let transport = await router.createWebRtcTransport(
          webRtcTransport_options
        );

        transport.on("dtlsstatechange", (dtlsState) => {
          if (dtlsState === "closed") {
            transport.close();
          }
        });

        transport.on("close", () => {
          console.log("transport closed");
        });

        // Use the callback function to send transport parameters
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });

        return transport;
      } catch (error) {
        console.log(error);
      }
    };
  } catch (error) {
    console.error("Error creating router:", error);
    socket.emit("error", { message: "Error creating router." });
  }
});

// Start Server
server.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
