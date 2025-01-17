import React, { useState, useEffect } from "react";
import io from "socket.io-client";
import { Device } from "mediasoup-client";

const SERVER_URL = "http://localhost:3000";

const ConferencePage = ({ roomId }) => {
  const [socket, setSocket] = useState(null);
  const [device, setDevice] = useState(null);
  const [routerRtpCapabilities, setRouterRtpCapabilities] = useState(null);
  const [sendTransport, setSendTransport] = useState(null);
  const [userList, setUserList] = useState([]);
  const [recvTransport, setRecvTransport] = useState(null);
  const [currentProducerId, setCurrentProducerId] = useState(null);
  // const [recvTransport, setRecvTransport] = useState(null);
  // let recvTransport = null;
  useEffect(() => {
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);
    console.log("Client rooms: ", newSocket.rooms);
    newSocket.on("connect", () => {
      console.log("Connected to server:", newSocket.id);

      newSocket.emit("joinRoom", roomId, (response) => {
        if (response.error) {
          console.error("Error joining room:", response.error);
          return;
        }
        console.log(
          "Router RTP Capabilities received:",
          response.routerRtpCapabilities
        );
        setRouterRtpCapabilities(response.routerRtpCapabilities);
      });
    });

    newSocket.on("updateUserList", (newUserList) => {
      console.log("Received Updated User List:", newUserList);
      setUserList(newUserList);
    });
    debugger;
    newSocket.on("newProducer", async ({ producerId, userId }) => {
      debugger
      console.log(`New producer detected: ${producerId} from user ${userId}`);
      setCurrentProducerId(producerId);
      await createRecvTransport();
      await consumeMedia(producerId);
    });

    return () => newSocket.close();
  }, [roomId]);

  const initDevice = async () => {
    if (!routerRtpCapabilities) {
      console.warn("Router RTP Capabilities not available");
      return;
    }

    try {
      const mediasoupDevice = new Device();
      await mediasoupDevice.load({ routerRtpCapabilities });
      setDevice(mediasoupDevice);
      console.log("Mediasoup Device Initialized");
    } catch (error) {
      console.error("Error initializing Mediasoup device:", error);
    }
  };

  const createSendTransport = () => {
    if (!device) {
      console.warn("Device not initialized");
      return;
    }

    socket.emit("createTransport", (transportOptions) => {
      if (!transportOptions || transportOptions.error) {
        console.error(
          "Error creating transport:",
          transportOptions?.error || "No options received"
        );
        return;
      }

      const transport = device.createSendTransport(transportOptions);

      transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        socket.emit("connectTransport", { dtlsParameters }, (err) => {
          if (err) {
            console.error("Transport connect error:", err);
            return errback(err);
          }
          callback();
        });
      });

      transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
        socket.emit("produce", { kind, rtpParameters }, ({ id, error }) => {
          if (error) {
            console.error("Produce error:", error);
            return errback(error);
          }
          callback({ id });
        });
      });

      setSendTransport(transport);
      console.log("Send Transport Created");
    });
  };

  const produceMedia = async () => {
    if (!sendTransport) {
      console.warn("Send Transport not available");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      console.log("Video Track:", videoTrack);
      console.log("Track Ready State:", videoTrack.readyState); // Should be "live"
      console.log("Track Muted:", videoTrack.muted); // Should be false

      if (videoTrack) {
        const videoElement = document.createElement("video");
        videoElement.srcObject = stream;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        document.body.appendChild(videoElement);
      }

      // Produce video track
      if (!videoTrack || !audioTrack) {
        console.error("Video or audio track is missing. Exiting function.");
        return;
      }

      console.log("Tracks obtained. Producing video...");
      const videoProducer = await sendTransport.produce({ track: videoTrack });
      console.log("Video Producer created:", videoProducer.id);
      console.log("Video Producer created:", videoProducer.id);

      const audioProducer = await sendTransport.produce({
        track: audioTrack,
      });

      const producerId = videoProducer.id; // Obtain the producerId from the producer

      await createRecvTransport();
      await consumeMedia(producerId); // Pass the producerId to consume the media
      // Produce audio track

      console.log("Audio Producer created:", audioProducer.id);
    } catch (error) {
      console.error("Error producing media:", error);
    }
  };

  const createRecvTransport = async () => {
    if (!device) {
      console.error("Device is not initialized");
      return;
    }

    if (!socket) {
      console.error("Socket is not initialized");
      return;
    }

    try {
      const transportOptions = await new Promise((resolve) =>
        socket.emit("createTransport", resolve)
      );

      const transport = device.createRecvTransport(transportOptions);

      transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        console.log("Connecting recvTransport...");
        socket.emit("connectTransport", { dtlsParameters }, (err) => {
          if (err) {
            errback(err);
          } else {
            callback();
          }
        });
      });

      setRecvTransport(transport); // Save the transport in state
      console.log("Receive transport created:", transport);
    } catch (error) {
      console.error("Error creating recvTransport:", error);
    }
  };

  const consumeMedia = async (producerId) => {
    if (!recvTransport) {
      console.error("Receive transport is not initialized");
      return;
    }

    try {
      // Prevent multiple calls with the same producerId
      console.log("Consuming media for producerId:", producerId);
      debugger
      const { id, kind, rtpParameters, error } = await new Promise((resolve) =>
        socket.emit(
          "consume",
          { producerId, rtpCapabilities: device.rtpCapabilities },
          resolve
        )
      );

      if (error) {
        console.error("Error consuming media:", error);
        return;
      }

      const consumer = await recvTransport.consume({
        id,
        producerId,
        kind,
        rtpParameters,
      });

      // Resume consumer
      await consumer.resume();
      console.log("Media consumption successful for producer:", consumer.id);
    } catch (error) {
      console.error("Error consuming media:", error);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Room: {roomId}</h1>
      <button onClick={initDevice} disabled={!routerRtpCapabilities}>
        Initialize Device
      </button>
      <button onClick={createSendTransport} disabled={!device}>
        Create Send Transport
      </button>
      <button onClick={produceMedia} disabled={!sendTransport}>
        Start Producing Media
      </button>
      <button onClick={createRecvTransport} disabled={!device}>
        receive Send Transport
      </button>
      <button
        onClick={() => {
          if (currentProducerId) {
            consumeMedia(currentProducerId);
          } else {
            console.warn("No producerId available to consume");
          }
        }}
      >
        Start Receiving Media
      </button>
      <div style={{ padding: "20px" }}>
        <h1>Room: {roomId}</h1>
        <h3>Participants:</h3>
        <ul>
          {userList.map((user) => (
            <li key={user.id}>{user.id === socket?.id ? "You" : user.id}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default ConferencePage;
