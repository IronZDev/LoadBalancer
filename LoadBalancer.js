const express = require("express");
const range = require("range-inclusive");
const axios = require('axios');
const CLI = require('clui')
const clc = require('cli-color');

let port = 8001;

const app = express();
global.fileStatus = {
    WAITING: 'waiting',
    SENDING: 'sending'
}
global.clientList = [];
global.serverList = range(5000, 5004);
serverList = serverList.map(x => {return {port: x, busy: false, currentClient: null, currentFile: null}});
app.use(express.json());
app.use(express.urlencoded({extended: false}));

function calculatePriority() {
    clientList.forEach(client => {
        const timeWaiting = (new Date().getTime() - client.timeJoined - client.timeConsumed)/1000;
        const mbsBalance = client.mbsUploaded - client.mbsWaiting;
        // console.log(client.filesList);
        client.mbsWaiting = client.filesList[0].size;
        client.priority = 0.7 * timeWaiting + 0.3 * mbsBalance;
    });
    clientList.sort((a, b) => (a.priority > b.priority) ? -1 : ((b.priority > a.priority) ? 1 : 0));
    printState();
}

function sendFiles() {
    const freeServers = serverList.filter(server => server.busy === false);
    console.log(freeServers);
    for (let server of freeServers) {
        if (!server.busy && clientList.length !== 0) {
            let clientToUpload, fileToUpload, endOfFiles;
            // Look for a file with a highest priority
            let fileIndex = 0;
            while (!endOfFiles && !clientToUpload) {
                endOfFiles = true;
                for (let client of clientList) {
                    if (fileIndex < client.filesList.length) {
                        endOfFiles = false;
                        if (client.filesList[fileIndex].status === fileStatus.WAITING) {
                            client.filesList[fileIndex].status = fileStatus.SENDING;
                            clientToUpload = client;
                            fileToUpload = client.filesList[fileIndex];
                        }
                    }
                }
                fileIndex++;
            }
            if (!fileToUpload || !clientToUpload) {
                console.log("Nothing to send!")
            } else {
                server.busy = true;
                server.currentFile = fileToUpload.fileName;
                server.currentClient = clientToUpload.name;
                printState();
                axios.post(`http://localhost:${server.port}/upload`, fileToUpload)
                    .then(res => {
                        server.busy = false;
                        server.loadType = null;
                        const fileUploaded = clientList[0].filesList.shift();
                        console.log(fileUploaded)
                        if (clientList[0].filesList.length === 0) {
                            clientList.shift();
                        } else {
                            clientList[0].timeConsumed += res.time;
                            clientList[0].mbsUploaded += fileUploaded.size;
                        }
                        calculatePriority();
                        server.busy = false;
                        sendFiles();
                    })
                    .catch(err => console.log(err));
            }
        }
    }
}

function addFiles(request) {
    let client = clientList.find(client => client.name === request.clientName);
    if (client) {
        client.filesList.push(request.file);
    } else {
        clientList.push({
            name: request.clientName,
            filesList: [request.file],
            timeJoined: request.timeJoined,
            timeConsumed: 0,
            mbsUploaded: 0,
            mbsWaiting: 0,
            priority: 0,
        });
    }
    calculatePriority();
    sendFiles();
}

app.post('/upload', async (req, res) => {
    const request = {};
    request.clientName = req.body.client;
    request.file = {fileName: req.body.filename, size: req.body.size, status: global.fileStatus.WAITING};
    request.timeJoined = new Date().getTime();
    request.timeConsumed = 0;
    request.mbsUploaded = 0;
    request.mbsWaiting = 0;
    request.priority = 0;
    addFiles(request);
    return res.status(201).json({message: 'Ok!'});
});

app.listen(port, () => console.log(`Server listening on port ${port}!`));
printState();

function printState() {
    console.clear();
    const Line          = CLI.Line,
        LineBuffer    = CLI.LineBuffer;
    const outputBuffer = new LineBuffer({
        x: 0,
        y: 0,
        width: 'console',
        height: 'console'
    });
    const title = new Line(outputBuffer)
        .column('Load Balancer', 20, [clc.green.bold])
        .fill()
        .store();

    // Server bar
    const header = new Line(outputBuffer);
    const currentState = new Line(outputBuffer);
    const currentFile = new Line(outputBuffer);
    const currentClient = new Line(outputBuffer);
    for (let i=0; i < serverList.length; i++) {
        header.column(`SERVER ${i+1}`, 20, [clc.cyan.bold])
        currentState.column(serverList[i].busy ? 'BUSY' : 'FREE', 20, [serverList[i].busy ? clc.red : clc.green]);
        currentFile.column(serverList[i].busy ? serverList[i].currentFile : ' ', 20, [clc.yellow]);
        currentClient.column(serverList[i].busy ? serverList[i].currentClient : ' ', 20, [clc.yellow]);
    }
    header.fill().store();
    currentState.fill().store();
    currentFile.fill().store();
    currentClient.fill().store();

    // Client bar
    const clientName = new Line(outputBuffer);

    for (let i=0; i < clientList.length; i++) {
        clientName.column(clientList[i].name, 20, [clc.cyan.bold]);
    }
    clientName.fill().store();
    // Show first 5 files

    let fileLine;
    for (let columnRow = 0; columnRow < 5; columnRow++) {
        fileLine = new Line(outputBuffer);
        for (let client of clientList) {
            const filteredFiles = client.filesList.filter(x => x.status === fileStatus.WAITING);
            fileLine.column(filteredFiles[columnRow] && filteredFiles[columnRow].status === fileStatus.WAITING ? filteredFiles[columnRow].fileName : ' ', 20, [clc.white]);
            fileLine.fill().store();
        }
    }
    fileLine = new Line(outputBuffer);
    for (let client of clientList) {
        const filteredFiles = client.filesList.filter(x => x.status === fileStatus.WAITING);
        fileLine.column(filteredFiles.length > 5 ? '...' : ' ', 20, [clc.white]);
    }
    fileLine.fill().store();

    outputBuffer.output();
}