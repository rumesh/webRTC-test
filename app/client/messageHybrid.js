function initMessage(messageCallback){
    var RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
    var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    var RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;

    var wsUri = "ws://localhost:8090/";
    var signalingChannel = createSignalingChannel(wsUri, CALLER_ID);
    var servers = {iceServers: [{urls: "stun:stun.1.google.com:19302"}]};

    var PeerConections = {};
    var PeersToConnect = [];
    var FirstPeer = null;
    var FirstPeerConnected = false;

    function addNewPeerToSelect(source) {
        var opt = document.createElement('option');
        opt.value = source;
        opt.innerHTML = source;
        document.getElementById("conectedPeers").appendChild(opt);
    }

    signalingChannel.onFirstPeer = function(peer)  {
        FirstPeer = peer;
        // when data channel open will call connectToNextPeer to get peerlist
        PeerConections[peer] = startCommunication(peer);

        addNewPeerToSelect(peer);
    };

    signalingChannel.onOffer = function (offer, source) {
        var peerConnection;
        if (PeerConections[source]) {
            peerConnection = PeerConections[source];
        } else {
            peerConnection = createPeerConnection(source);
            addNewPeerToSelect(source);
            PeerConections[source] = peerConnection;
        }
        peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        peerConnection.createAnswer(function(answer){
            peerConnection.setLocalDescription(answer);
            signalingChannel.sendAnswer(answer, source);
        }, function (e){
            console.error(e);
        });
    };

    function connectToNextPeer() {
        if (FirstPeerConnected === false) {
            var channel = getCommChannel(FirstPeer);
            FirstPeerConnected = true;
            if (channel) {
                channel.send(JSON.stringify({
                    type: 'request',
                    request: 'peerList'
                }));
            }
        } else if (PeersToConnect.length > 0) {
            var nextPeer = PeersToConnect.shift();

            PeerConections[nextPeer] = startCommunicationViaPeer(FirstPeer, nextPeer);
        }
    }

    function channelMessageHandler(message, peer) {
        try {
            var data = JSON.parse(message.data);
            if (data.type) {
                switch (data.type) {
                    case "ICECandidate":
                        onICECandidate(data.ICECandidate, data.destination, data.source);
                        break;
                    case "offer":
                        onOffer(data.offer, data.destination, peer);
                        break;
                    case "answer":
                        onAnswer(data.answer, data.destination, peer);
                        break;
                    case 'request':
                        if (data.request === 'peerList') {
                            var peerListToSend = Object.keys(PeerConections);
                            sendToPeer(peer, {
                                type: 'response',
                                request: 'peerList',
                                body: peerListToSend
                            });
                        }
                        break;
                    case 'response':
                        if (data.request === 'peerList') {
                            var i,
                                newPeersToConnect = [],
                                peers = data.body;
                            for(i = 0; i < peers.length; i++) {
                                // do not try to connect self
                                if (peers[i] !== CALLER_ID) {
                                    addNewPeerToSelect(peers[i]);
                                    newPeersToConnect.push(peers[i]);
                                }
                            }
                            PeersToConnect = PeersToConnect.concat(newPeersToConnect);
                            connectToNextPeer();
                        }
                        break;
                    default:
                        throw new Error("invalid message type");
                }
            } else {
                messageCallback(data.msg);
            }
        } catch(e) {
            console.error("Incorrect message format", message.data);
            return null;
        }
    }

    function sendToPeer(destination, message) {
        var channel = getCommChannel(destination);
        if (channel) {
            channel.send(JSON.stringify(message));
        } else {
            console.error("cannot send message", message, "to", destination);
        }
    }

    function onOffer(offer, destination, source){
        if (destination === CALLER_ID) {
            if (PeerConections[source]) {
                var peerConnection = PeerConections[source];
            } else {
                var peerConnection = createPeerConnection(source);
                addNewPeerToSelect(source);
                PeerConections[source] = peerConnection;
            }
            peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            peerConnection.createAnswer(function(answer){
                peerConnection.setLocalDescription(answer);
                sendToPeer(source, {
                    type: 'answer',
                    answer: answer,
                    source: destination,
                    destination: source
                });
            }, function (e){
                console.error(e);
            });
        } else {
            sendToPeer(destination, {
                type: 'offer',
                offer: offer,
                source: source,
                destination: destination
            });
        }
    }

    function onAnswer(answer, destination, source){
        if (destination === CALLER_ID) {
            PeerConections[source].setRemoteDescription(new RTCSessionDescription(answer));
        } else {
            sendToPeer(destination, {
                type: 'answer',
                offer: answer,
                source: source,
                destination: destination
            });
        }
    }

    function onICECandidate(ICECandidate, destination, source){
        if (destination === CALLER_ID) {
            if (PeerConections[source]) {
                var peerConnection = PeerConections[source];
            } else {
                var peerConnection = createPeerConnection(source);
                addNewPeerToSelect(source);
                PeerConections[source] = peerConnection;
            }
            peerConnection.addIceCandidate(new RTCIceCandidate(ICECandidate));
        } else {
            sendToPeer(destination, {
                type: 'ICECandidate',
                ICECandidate: ICECandidate,
                source: source,
                destination: destination
            });
        }
    }

    function startCommunication(peerId) {
        var pc = new RTCPeerConnection(servers, {
            optional: [{
                DtlsSrtpKeyAgreement: true
            }]
        });

        signalingChannel.onAnswer = function (answer, source) {
            pc.setRemoteDescription(new RTCSessionDescription(answer));
        };

        signalingChannel.onICECandidate = function (ICECandidate, source) {
            pc.addIceCandidate(new RTCIceCandidate(ICECandidate));
        };

        pc.onicecandidate = function (evt) {
            if(evt.candidate){ // empty candidate (wirth evt.candidate === null) are often generated
                signalingChannel.sendICECandidate(evt.candidate, peerId);
            }
        };

        //:warning the dataChannel must be opened BEFORE creating the offer.
        var _commChannel = pc.createDataChannel('communication', {
            reliable: false
        });

        pc.createOffer(function(offer){
            pc.setLocalDescription(offer);
            signalingChannel.sendOffer(offer, peerId);
        }, function (e){
            console.error(e);
        });

        pc.commChannel = _commChannel;

        _commChannel.onclose = function(evt) {
            console.log("dataChannel closed");
        };

        _commChannel.onerror = function(evt) {
            console.error("dataChannel error");
        };

        _commChannel.onopen = function(){
            // check if need to connect to another peer
            console.log("comm open");
            connectToNextPeer();
        };

        _commChannel.onmessage = function(message) {
            channelMessageHandler(message, peerId);
        };

        return pc;
    }

    function startCommunicationViaPeer(hostPeer, peerId) {
        var pc = new RTCPeerConnection(servers, {
            optional: [{
                DtlsSrtpKeyAgreement: true
            }]
        });

        pc.onicecandidate = function (evt) {
            if(evt.candidate){ // empty candidate (wirth evt.candidate === null) are often generated
                sendToPeer(hostPeer, {
                    type: 'ICECandidate',
                    ICECandidate: evt.candidate,
                    source: CALLER_ID,
                    destination: peerId
                });
                // signalingChannel.sendICECandidate(evt.candidate, peerId);

            }
        };

        //:warning the dataChannel must be opened BEFORE creating the offer.
        var _commChannel = pc.createDataChannel('communication', {
            reliable: false
        });

        pc.createOffer(function(offer) {
            pc.setLocalDescription(offer);
            sendToPeer(hostPeer, {
                type: 'offer',
                offer: offer,
                source: CALLER_ID,
                destination: peerId
            });
        }, function (e){
            console.error(e);
        });

        pc.commChannel = _commChannel;

        _commChannel.onclose = function(evt) {
            console.log("dataChannel closed");
        };

        _commChannel.onerror = function(evt) {
            console.error("dataChannel error");
        };

        _commChannel.onopen = function(){
            // check if need to connect to another peer
            connectToNextPeer();
        };

        _commChannel.onmessage = function(message) {
            channelMessageHandler(message, peerId);
        };

        return pc;
    }

    function createPeerConnection(peerId){
        var pc = new RTCPeerConnection(servers, {
            optional: [{
                DtlsSrtpKeyAgreement: true
            }]
        });

        pc.onicecandidate = function (evt) {
            if(evt.candidate){ // empty candidate (wirth evt.candidate === null) are often generated
                signalingChannel.sendICECandidate(evt.candidate, peerId);
            }
        };

        signalingChannel.onICECandidate = function (ICECandidate, source) {
            pc.addIceCandidate(new RTCIceCandidate(ICECandidate));
        };

        pc.ondatachannel = function(event) {
          var receiveChannel = event.channel;
          pc.commChannel = receiveChannel;
          // if not already in peerlist add it
          if (!PeerConections[peerId]) {
              addNewPeerToSelect(peerId);
          }
          PeerConections[peerId] = pc;
          receiveChannel.onmessage = function(event) {
              channelMessageHandler(event, peerId);
          };
        };

        return pc;
    }

    window.getCommChannel = function(selectedChannel) {
        if (PeerConections[selectedChannel]) {
            return PeerConections[selectedChannel].commChannel;
        } else {
            return startCommunication(selectedChannel).commChannel;
        }
    };

    window.startCommunication = startCommunication;
}
