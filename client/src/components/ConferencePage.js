import { Transport } from "mediasoup-client/lib/types";
import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
const mediaSoupClient = require("mediasoup-client");
const SERVER_URL = "http://localhost:3000"; // Make sure this matches the server's URL
const socket = io(SERVER_URL);
let device;
const ConferencePage = ({ roomId }) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [rtpCapabilities, setRtpCapabilities] = useState(null);
  // const [producerTransport,setProducerTransport]=useState(null)
  const videoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  
  let producerTransport;
  let consumerTransport;
  let producer;
  let consumer;
  let params = {
    // mediasoup params
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S1T3",
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  };
  useEffect(() => {
    // Listen for connection success
    socket.on("connection-success", ({ socketId }) => {
      console.log("Connected to server with socket ID:", socketId);
    });

    // Clean up listener on unmount
    return () => {
      socket.off("connection-success");
    };
  }, []);
  const createDevice = async () => {
    try {
      device = new mediaSoupClient.Device();
      await device.load({
        routerRtpCapabilities: rtpCapabilities,
      });
      // setRtpCapabilities(rtpCapabilities);
      console.log("rtp rtpCapabilities", rtpCapabilities);
    } catch (error) {
      console.log(error);
    }
  };

  const startVideoStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      // Assign the stream to the video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      setIsStreaming(true);
    } catch (error) {
      console.error("Error accessing user media:", error);
      alert("Unable to access webcam or microphone.");
    }
  };
  const getRtpCapabilities = () => {
    socket.emit("getRtpCapabilities", (data) => {
      console.log(`Router rtp Capabilitis...${data.rtpCapabilities}`);
      setRtpCapabilities(data.rtpCapabilities);
    });
  };
  const createSendTransport = () => {
    socket.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log("params", params);
      producerTransport = device.createSendTransport(params);
      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errorback) => {
          try {
            await socket.emit("transport-connect", {
              // TransportId:producerTransport.id,
              dtlsParameters: dtlsParameters,
            });
            callback();
          } catch (error) {
            errorback(error);
          }
        }
      );
      producerTransport.on(
        "produce",
        async (parameters, callback, errorback) => {
          console.log(parameters);
          try {
            await socket.emit(
              "tranport-produce",
              {
                // TransportId:producerTransport.id,
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
              },
              ({ id }) => {
                callback({ id });
              }
            );
          } catch (error) {
            errorback(error);
          }
        }
      );
    });
  };
  // const connectSendTransport =async ()=>{
  //   console.log("params",params)
  //   producer = await producerTransport.produce(params)
  //   console.log(producer)
  //   producer.on('trackended',()=>{
  //     console.log('track ended')
  //   })
  //   producer.on('transportclose',()=>{
  //     console.log('transport ended')
  //   })
  // }

  const connectSendTransport = async () => {
    try {
      console.log("params", params);
      const stream = videoRef.current.srcObject;
      if (!stream) {
        console.error("No media stream found.");
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!videoTrack) {
        console.error("No video track found.");
        return;
      }

      producer = await producerTransport.produce({
        track: videoTrack, // Attach video track
        ...params, // Pass other parameters like encodings and codecOptions
      });

      console.log("Producer created:", producer);

      producer.on("trackended", () => {
        console.log("Track ended");
      });

      producer.on("transportclose", () => {
        console.log("Transport closed");
      });
    } catch (error) {
      console.error("Error connecting send transport:", error);
    }
  };
  const createRecvTransport = async () => {
    await socket.emit(
      "createWebRtcTransport",
      { sender: false },
      ({ params }) => {
        if (params.error) {
          console.log(params.error);
          return;
        }
        console.log(params);
        consumerTransport = device.createRecvTransport(params);
        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errorback) => {
            try {
              await socket.emit("transport-recv-connect", {
                // TransportId:consumerTransport.id,
                dtlsParameters,
              });
              callback();
            } catch (error) {
              errorback(error);
            }
          }
        );
      }
    );
  };
  // const connectRecvTransport = async () => {
  //   await socket.emit(
  //     "consume",
  //     {
  //       rtpCapabilities: device.rtpCapabilities,
  //     },
  //     async ({ params }) => {
  //       if (params.error) {
  //         console.log("Connect comsume");
  //         return;
  //       }
  //       console.log(params);
  //       consumer = await consumerTransport.consume({
  //         id: params.id,
  //         producerId: params.producerId,
  //         kind: params.kind,
  //         rtpParameters: params.rtpParameters,
  //       });
  //       const { track } = params;
  //       if (remoteVideoRef.current) {
  //         remoteVideoRef.current.srcObject = new MediaStream([track]);
  //       }
  //       socket.emit('consumer-resume')
  //     }
  //   );
  // };
  const connectRecvTransport = async () => {
    socket.emit(
      "consume",
      {
        rtpCapabilities: device.rtpCapabilities,
      },
      async ({ params }) => {
        if (params.error) {
          console.error("Error consuming:", params.error);
          return;
        }
  
        console.log("Consumer params:", params);
  
        try {
          // Create a consumer
          consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          });
  
          console.log("Consumer created:", consumer);
  
          // Get the track from the consumer
          const { track } = consumer;
  
          if (remoteVideoRef.current) {
            // Set the track to the remote video element
            remoteVideoRef.current.srcObject = new MediaStream([track]);
          }
  
          // Notify the server to resume the consumer
          socket.emit("consumer-resume", { consumerId: consumer.id });
        } catch (error) {
          console.error("Error consuming track:", error);
        }
      }
    );
  };
  
  return (
    <div>
      <h1>Conference Page</h1>
      {/* Button to start the video stream */}
      {!isStreaming && (
        <button onClick={startVideoStream}>Start Video Stream</button>
      )}
      <button onClick={getRtpCapabilities}>getRtpCapabilities</button>
      <button onClick={createDevice}>createDevice</button>
      <button onClick={createSendTransport}>createSendTransport</button>
      <button onClick={connectSendTransport}>connectSendTransport</button>
      <button onClick={createRecvTransport}>createRecvTransport</button>
      <button onClick={connectRecvTransport}>connectRecvTransport</button>
      {/* Video element to display the local video stream */}
      <div>
        <video
          ref={videoRef}
          style={{ width: "640px", height: "360px", border: "1px solid black" }}
          autoPlay
          playsInline
          muted // Muted to prevent echo from local stream
        />
      </div>
      {/* Remote Video */}
      <div>
        <h2>Remote Stream</h2>
        <video
          ref={remoteVideoRef}
          style={{ width: "640px", height: "360px", border: "1px solid black" }}
          autoPlay
          playsInline
        />
      </div>
    </div>
  );
};

export default ConferencePage;
