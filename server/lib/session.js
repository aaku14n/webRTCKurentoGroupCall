"use strict";

/**
 *  User session
 */
export default class Session {
  /**
   * constructor
   *
   * @param {*} socket
   * @param {*} userId
   * @param {*} roomId
   */
  constructor(socket, userId, roomId) {
    this.id = socket.id;
    this.socket = socket;

    this.userId = userId;
    this.roomId = roomId;

    this.outgoingMedia = null;
    this.incomingMedia = {};

    this.iceCandidateQueue = {};
    this.hubPort = null;
  }

  /**
   * ice candidate for this user
   * @param {object} data
   * @param {object} candidate
   */
  addIceCandidate(data, candidate) {
    // self
    console.log(data, this.userId);
    if (data.userId === this.userId) {
      // have outgoing media.
      if (this.outgoingMedia) {
        console.log(` add candidate to self : %s`, data.userId);
        this.outgoingMedia.addIceCandidate(candidate);
      } else {
        // save candidate to ice queue.
        console.error(
          ` still does not have outgoing endpoint for ${data.userId}`
        );
        this.iceCandidateQueue[data.userId].push({
          data: data,
          candidate: candidate
        });
      }
    } else {
      // others
      let webRtc = this.incomingMedia[data.userId];
      if (webRtc) {
        console.log(`%s add candidate to from %s`, this.id, data.userId);
        webRtc.addIceCandidate(candidate);
      } else {
        console.error(
          `${this.id} still does not have endpoint for ${data.userId}`
        );
        if (!this.iceCandidateQueue[data.userId]) {
          this.iceCandidateQueue[data.userId] = [];
        }
        this.iceCandidateQueue[data.userId].push({
          data: data,
          candidate: candidate
        });
      }
    }
  }

  /**
   *
   * @param {*} data
   */
  sendMessage(data) {
    if (this.socket) {
      this.socket.emit("message", data);
    } else {
      console.error("socket is null");
    }
  }

  /**
   *
   * setOutgoingMedia
   *
   * @param {*} outgoingMedia
   */
  setOutgoingMedia(outgoingMedia) {
    this.outgoingMedia = outgoingMedia;
  }

  /**
   *
   * @param {*} hubPort
   */
  setHubPort(hubPort) {
    this.hubPort = hubPort;
  }
}
