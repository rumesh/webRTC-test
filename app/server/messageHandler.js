var  connectedPeers = {};
function onMessage(ws, message){
    var type = message.type;
    switch (type) {
        case "ICECandidate":
            onICECandidate(message.ICECandidate, message.destination, ws.id);
            break;
        case "offer":
            onOffer(message.offer, message.destination, ws.id);
            break;
        case "answer":
            onAnswer(message.answer, message.destination, ws.id);
            break;
        case "init":
            onInit(ws, message.init);
            break;
        case "initHybrid":
            onInitHybrid(ws, message.init);
            break;
        default:
            throw new Error("invalid message type");
    }
}

function onInit(ws, id){
    console.log("init from peer:", id);
    ws.id = id;
    sendPeersList(ws, Object.keys(connectedPeers));
    connectedPeers[id] = ws;
}

function onInitHybrid(ws, id){
    console.log("init from peer:", id);
    ws.id = id;
    sendRandomPeer(ws, Object.keys(connectedPeers));
    connectedPeers[id] = ws;
}

function sendPeersList(destination, peers) {
    destination.send(JSON.stringify({
        type:'peerList',
        peers: peers
    }));
}

function sendRandomPeer(destination, peers) {
    if (peers.length > 0) {
        var random = Math.random();
        console.log("random", random);
        console.log("peers length", peers.length);
        var randomIndex = Math.floor(random * peers.length);
        console.log("randomIndex:", randomIndex);
        destination.send(JSON.stringify({
            type:'firstPeer',
            peer: peers[randomIndex]
        }));
    }
}

function onOffer(offer, destination, source){
    console.log("offer from peer:", source, "to peer", destination);
    connectedPeers[destination].send(JSON.stringify({
        type:'offer',
        offer:offer,
        source:source,
    }));
}

function onAnswer(answer, destination, source){
    console.log("answer from peer:", source, "to peer", destination);
    connectedPeers[destination].send(JSON.stringify({
        type: 'answer',
        answer: answer,
        source: source,
    }));
}

function onICECandidate(ICECandidate, destination, source){
    console.log("ICECandidate from peer:", source, "to peer", destination);
    connectedPeers[destination].send(JSON.stringify({
        type: 'ICECandidate',
        ICECandidate: ICECandidate,
        source: source,
    }));
}

module.exports = onMessage;

//exporting for unit tests only
module.exports._connectedPeers = connectedPeers;
