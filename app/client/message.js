function initMessage(messageCallback){
    var RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription;
    var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    var RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate;

    var wsUri = "ws://localhost:8090/";
    var signalingChannel = createSignalingChannel(wsUri, CALLER_ID);
    var servers = {iceServers: [{urls: "stun:stun.1.google.com:19302"}]};

    var PeerConections = {};
    var PeersToConnect = [];

    function addNewPeerToSelect(source) {
        var opt = document.createElement('option');
        opt.value = source;
        opt.innerHTML = source;
        document.getElementById("conectedPeers").appendChild(opt);
    }

    signalingChannel.onPeerList = function(peers) {
        var opt, i,
            selectElement = document.getElementById("conectedPeers");
        for(i = 0; i < peers.length; i++) {
            addNewPeerToSelect(peers[i]);
        }
        PeersToConnect = PeersToConnect.concat(peers);
        connectToNextPeer();
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
        if (PeersToConnect.length > 0) {
            var nextPeer = PeersToConnect.shift();
            PeerConections[nextPeer] = startCommunication(nextPeer);
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
            connectToNextPeer();
        };

        _commChannel.onmessage = function(message){
            messageCallback(message.data);
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
          PeerConections[peerId] = pc;
          receiveChannel.onmessage = function(event){
            messageCallback(event.data);
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
