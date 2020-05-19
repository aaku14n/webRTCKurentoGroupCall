import path from "path";
import url from "url";
import https from "https";
import fs from "fs";

import express from "express";
import kurento from "kurento-client";
import socketIO from "socket.io";
import minimst from "minimist";

import { Session, Register } from "./lib";

let userRegister = new Register();
let rooms = {};

const argv = minimst(process.argv.slice(2), {
  default: {
    as_uri: "https://api.littra.in:4201",
    ws_uri: "ws://kurento.littra.in:8888/kurento"
  }
});
// "http://18.218.103.187:8888/kurento"
let app = express();

let asUrl = url.parse(argv.as_uri);
let port = asUrl.port;
console.log(port);
let server =
  // https.createServer(options, app)
  app.listen(port, () => {
    console.log("Group Call started");
    console.log("Open %s with a WebRTC capable brower.", url.format(asUrl));
  });

/////////////////////////// websocket ///////////////////////////////

let io = socketIO(server).path("/groupcall");
let wsUrl = url.parse(argv.ws_uri).href;

io.on("connection", socket => {
  // error handle
  socket.on("error", err => {
    console.error(`Connection %s error : %s`, socket.id, err);
  });

  // error handle
  socket.on("init", data => {
    if (data.roomId) {
      joinRoom(socket, data, err => {
        if (err) {
          console.log(`join Room error ${err}`);
        }
      });
    }
    return "Success";
  });

  socket.on("disconnect", data => {
    console.log(`Connection : %s disconnect`, data);
  });

  socket.on("msg", message => {
    console.log(`Connection: receive message`);

    switch (message.type) {
      case "init":
        joinRoom(socket, message, err => {
          if (err) {
            console.log(`join Room error ${err}`);
          }
        });
        break;
      case "sdp-offer":
        receiveVideoFrom(socket, message.userId, message.sdp, err => {
          if (err) {
            console.error(err);
          }
        });
        break;
      case "leaveRoom":
        leaveRoom(socket, err => {
          if (err) {
            console.error(err);
          }
        });
        break;
      case "ice":
        addIceCandidate(socket, message, err => {
          if (err) {
            console.error(err);
          }
        });
        break;
      default:
        socket.emit({ id: "error", message: `Invalid message %s. `, message });
    }
  });
});

/**
 *
 * @param {*} socket
 * @param {*} roomId
 */
function joinRoom(socket, message, callback) {
  console.log(message);
  getRoom(message.roomId, (error, room) => {
    if (error) {
      console.log(error);
      callback(error);
      return;
    }
    join(socket, room, message.userId, (err, user) => {
      console.log(`join success : ${user.name}`);
      if (err) {
        callback(err);
        return;
      }
      callback();
    });
  });
}

/**
 * Get room. Creates room if room does not exists
 *
 * @param {string} roomId
 * @param {function} callback
 */
function getRoom(roomId, callback) {
  let room = rooms[roomId];

  if (room == null) {
    console.log(`create new room : ${roomId}`);
    getKurentoClient((error, kurentoClient) => {
      if (error) {
        return callback(error);
      }

      kurentoClient.create("MediaPipeline", (error, pipeline) => {
        if (error) {
          return callback(error);
        }

        room = {
          roomId,
          pipeline: pipeline,
          participants: {},
          kurentoClient: kurentoClient
        };

        rooms[roomId] = room;
        callback(null, room);
      });
    });
  } else {
    console.log(`get existing room : ${roomId}`);
    callback(null, room);
  }
}

/**
 *
 * join call room
 *
 * @param {*} socket
 * @param {*} room
 * @param {*} userName
 * @param {*} callback
 */
function join(socket, room, userId, callback) {
  // add user to session
  let userSession = new Session(socket, userId, room.roomId);

  // register
  console.log("=================================");
  console.log(userSession);
  userRegister.register(userSession);

  room.pipeline.create("WebRtcEndpoint", (error, outgoingMedia) => {
    if (error) {
      console.error("no participant in room");
      if (Object.keys(room.participants).length === 0) {
        room.pipeline.release();
      }
      return callback(error);
    }

    // else
    outgoingMedia.setMaxVideoRecvBandwidth(300);
    outgoingMedia.setMinVideoRecvBandwidth(100);
    userSession.setOutgoingMedia(outgoingMedia);

    // add ice candidate the get sent before endpoint is established
    // socket.id : room iceCandidate Queue
    let iceCandidateQueue = userSession.iceCandidateQueue[userSession.userId];
    if (iceCandidateQueue) {
      while (iceCandidateQueue.length) {
        let message = iceCandidateQueue.shift();
        console.error(
          `user: ${userSession.id} collect candidate for outgoing media`
        );
        userSession.outgoingMedia.addIceCandidate(message.candidate);
      }
    }

    // ICE
    // listener
    userSession.outgoingMedia.on("OnIceCandidate", event => {
      // ka ka ka ka ka
      // console.log(`generate outgoing candidate ${userSession.id}`);
      let candidate = kurento.register.complexTypes.IceCandidate(
        event.candidate
      );

      userSession.sendMessage({
        id: "iceCandidate",
        userId: userSession.userId,
        candidate: candidate
      });
    });
    // register user to room
    room.participants[userSession.userId] = userSession;

    // notify other user that new user is joing
    let usersInRoom = room.participants;

    for (let i in usersInRoom) {
      if (usersInRoom[i].userId != userSession.userId) {
        usersInRoom[i].sendMessage({
          id: "newParticipantArrived",
          userId: userSession.userId
        });
      }
    }

    // send list of current user in the room to current participant
    let existingUsers = [];
    for (let i in usersInRoom) {
      if (usersInRoom[i].userId != userSession.userId) {
        existingUsers.push({ id: usersInRoom[i].userId });
      }
    }
    console.log(existingUsers);
    // if (existingUsers.length == 0) {
    //   existingUsers = [{ id: userSession.userId }];
    // }
    userSession.sendMessage({
      id: "existingParticipants",
      data: existingUsers,
      roomId: room.roomId
    });

    // room.composite.createHubPort((error, hubPort) => {
    //   if (error) {
    //     return callback(error);
    //   }
    //   userSession.setHubPort(hubPort);

    //   userSession.outgoingMedia.connect(userSession.hubPort);
    //   //userSession.hubPort.connect(userSession.outz);

    //   callback(null, userSession);
    // });
  });
}

// receive video from sender
function receiveVideoFrom(socket, senderId, sdpOffer, callback) {
  let userSession = userRegister.getById(socket.id);
  let sender = userRegister.getByName(senderId);
  console.log("here we showing uswers detils");
  console.log(sender, senderId);
  getEndpointForUser(userSession, sender, (error, endpoint) => {
    if (error || !endpoint) {
      callback(error);
    }

    endpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
      console.log(`process offer from ${senderId} to ${userSession.id}`);
      if (error) {
        return callback(error);
      }
      let data = {
        id: "receiveVideoAnswer",
        userId: sender.userId,
        sdpAnswer: sdpAnswer
      };
      userSession.sendMessage(data);

      endpoint.gatherCandidates(error => {
        if (error) {
          return callback(error);
        }
      });

      return callback(null, sdpAnswer);
    });
  });
}

/**
 *
 */
function leaveRoom(socket, callback) {
  var userSession = userRegister.getById(socket.id);

  if (!userSession) {
    return;
  }

  var room = rooms[userSession.roomId];

  if (!room) {
    return;
  }

  console.log(
    "notify all user that " +
      userSession.id +
      " is leaving the room " +
      room.roomId
  );
  var usersInRoom = room.participants;
  delete usersInRoom[userSession.userId];
  userSession.outgoingMedia.release();

  // release incoming media for the leaving user
  for (var i in userSession.incomingMedia) {
    userSession.incomingMedia[i].release();
    delete userSession.incomingMedia[i];
  }

  var data = {
    id: "participantLeft",
    userId: userSession.userId
  };
  for (var i in usersInRoom) {
    var user = usersInRoom[i];
    // release viewer from this
    user.incomingMedia[userSession.userId].release();
    delete user.incomingMedia[userSession.userId];

    // notify all user in the room
    user.sendMessage(data);
  }

  // Release pipeline and delete room when room is empty
  if (Object.keys(room.participants).length == 0) {
    room.pipeline.release();
    delete rooms[userSession.roomId];
  }
  delete userSession.roomId;

  callback();
}

/**
 * getKurento Client
 *
 * @param {function} callback
 */
function getKurentoClient(callback) {
  kurento(wsUrl, (error, kurentoClient) => {
    if (error) {
      let message = `Could not find media server at address ${wsUrl}`;

      return callback(`${message} . Exiting with error ${error}`);
    }
    callback(null, kurentoClient);
  });
}

/**
 * Add ICE candidate, required for WebRTC calls
 *
 * @param {*} socket
 * @param {*} message
 * @param {*} callback
 */
function addIceCandidate(socket, message, callback) {
  let user = userRegister.getById(socket.id);
  console.log(message);
  if (user != null) {
    // assign type to IceCandidate
    let candidate = kurento.register.complexTypes.IceCandidate(message.ice);
    user.addIceCandidate(message, candidate);
    callback();
  } else {
    console.error(`ice candidate with no user receive : ${message.userI}`);
    callback(new Error("addIceCandidate failed."));
  }
}

/**
 *
 * @param {*} userSession
 * @param {*} sender
 * @param {*} callback
 */
function getEndpointForUser(userSession = {}, sender = {}, callback) {
  if (userSession.userId === sender.userId) {
    return callback(null, userSession.outgoingMedia);
  }

  let incoming = userSession.incomingMedia[sender.userId];

  if (incoming == null) {
    console.log(
      `user : ${userSession.userId} create endpoint to receive video from : ${sender.userId}`
    );

    // getRoom
    getRoom(userSession.roomId, (error, room) => {
      if (error) {
        return callback(error);
      }
      // 　create WebRtcEndpoint for sender user
      room.pipeline.create("WebRtcEndpoint", (error, incomingMedia) => {
        if (error) {
          if (Object.keys(room.participants).length === 0) {
            room.pipeline.release();
          }
          return callback(error);
        }

        console.log(`user: ${userSession.id} successfully create pipeline`);
        incomingMedia.setMaxVideoRecvBandwidth(300);
        incomingMedia.setMinVideoRecvBandwidth(100);
        userSession.incomingMedia[sender.userId] = incomingMedia;

        // add ice candidate the get sent before endpoints is establlished
        let iceCandidateQueue = userSession.iceCandidateQueue[sender.userId];
        if (iceCandidateQueue) {
          while (iceCandidateQueue.length) {
            let message = iceCandidateQueue.shift();
            console.log(
              `user: ${userSession.userId} collect candidate for ${message.data.userId}`
            );
            incomingMedia.addIceCandidate(message.candidate);
          }
        }

        incomingMedia.on("OnIceCandidate", event => {
          // ka ka ka ka ka
          // console.log(`generate incoming media candidate: ${userSession.id} from ${sender.userId}`);
          let candidate = kurento.register.complexTypes.IceCandidate(
            event.candidate
          );
          userSession.sendMessage({
            id: "iceCandidate",
            userId: sender.userId,
            candidate: candidate
          });
        });

        sender.outgoingMedia.connect(incomingMedia, erro => {
          if (erro) {
            callback(erro);
          }
          callback(null, incomingMedia);
        });
        // sender.hubPort.connect(incomingMedia);
      });
    });
  } else {
    console.log(
      `user: ${userSession.id} get existing endpoint to receive video from: ${sender.id}`
    );
    sender.outgoingMedia.connect(incoming, error => {
      if (error) {
        callback(error);
      }
      callback(null, incoming);
    });
  }
}

app.use(express.static(path.join(__dirname, "static")));
