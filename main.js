//window
const { Tray, Menu, app, BrowserWindow } = require('electron')
const path = require('path')
const { ipcMain } = require('electron')
//vmix
const net = require('net');
let vmixAddress = '127.0.0.1';
let vmixPort = 8099;
let dataArray = [];
let lestpgm = [];
let pgm = []
let pwv;
let lestpwv;
let intervalId = null;
//icon
function createTray(win) {
  const iconPath = path.join(__dirname, '/led.png');
  const tray = new Tray(iconPath)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '回復',
      click: () => win.show()
    },
    {
      label: '結束',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ])
  tray.setToolTip('Tally Light Control')
  tray.setContextMenu(contextMenu);
  tray.on('click', () => win.show())
  return tray;
}
//obs
const OBSWebSocket = require('obs-websocket-js');
//atem
const { Atem } = require('atem-connection');
const atem = new Atem();
/* Create new class using library. */
const obs = new OBSWebSocket();
//user data
let user;
const fs = require('fs');
fs.readFile(__dirname + '/data/login_data.json', 'utf-8', (err, data) => {
  if (err) {
    throw err;
  }
  user = JSON.parse(data.toString());
});
//source
let source;
let console_ip;
//webserver
const express = require("express");
const webPORT = 80;
const webapp = express();
const server = webapp.listen(webPORT, () => {
  //console.log("Application started and Listening on port 8080");
});
const SocketServer = require("ws").Server;
const wss = new SocketServer({ server });
webapp.use(express.static(__dirname + "/web/webtally"));
webapp.get("/", (req, res) => {
  res.sendFile(__dirname + "/web/webtally/index.html");
});
//udp
const dgram = require('dgram');
const client = dgram.createSocket('udp4');
const PORT = 8080;
const espAddresses = []; // 儲存esp8266的IP地址的陣列
const timers = {};
let atemip = "192.168.255.255";
let BROADCAST_ADDR = '255.255.255.255'; // 廣播地址
const MESSAGE = Buffer.from(JSON.stringify([{
  "get": "ping"
}]));
function createWindow(w, h, preloadjs, mainpage) {
  const mainWindow = new BrowserWindow({
    width: w,
    height: h,
    //frame: false,          // 標題列不顯示
    //transparent: true,     // 背景透明
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, preloadjs)
    }
  })
  mainWindow.loadFile(mainpage)
  //  mainWindow.webContents.openDevTools()
  return mainWindow;
}
app.whenReady().then(() => {
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  setInterval(() => {
    sendtoweb(JSON.stringify({ get: "tallyip", ip: espAddresses }));
  }, 500); // 每5秒廣播一次
  const win = createWindow(600, 900, 'preload.js', './web/index.html');
  createTray(win);
  ipcMain.on("toMain", (event, args) => {
    let res = JSON.parse(args);
    switch (res.get) {
      case "hide":
        win.hide();
        break;
      case "login":
        let login = getlogin(res.uuid, res.password);
        if (login[0]) {
          win.loadFile("./web/panel/index.html")
        } else {
          sendtoweb(JSON.stringify({ get: "login", password: login[0], name: login[1] }));
        }
        break;
      case "logout":
        win.loadFile("./web/index.html")
        break;
      case "set":
        source = res.source;
        console_ip = res.ip;
        gettallydata();
        break;
      case "broadcastip":
        BROADCAST_ADDR = res.ip;
        break;
      case "tallyip":
        sendtoweb(JSON.stringify({ get: "tallyip", ip: espAddresses }));
        break;
      case "tallylight":
        sendtoweb(JSON.stringify({ get: "tallylight", data: "ok" }));
        sendtally(res.ip, JSON.stringify([{ get: "tallyidset", id: res.data }]))
        break;
      case "findtally":
        sendtoweb(JSON.stringify({ get: "findtally", data: "ok" }));
        sendtally(res.ip, JSON.stringify([{ get: "find" }]))
        break;
      default:
        null
    }
  });
  function sendtoweb(sendData) {
    win.webContents.send("fromMain", sendData);
  }
  function getlogin(uuid, password) {
    for (let i = 0; i < user.length; i++) {
      if (uuid == user[i].uuid) {
        if (password == user[i].password) {
          return [true, user[i].name];
        }
      }
    }
    return [false, null];
  }
  function gettallydata() {
    if (source == "OBS") {
      let sense = []
      let pgmid = 0;
      let pwvid = 0;
      let oldpgmid = 0;
      let oldpwvid = 0;
      let studiomode = false;
      obs.connect('ws://' + console_ip)
        .then(() => {
          sendtoweb(JSON.stringify({ get: "connect", data: true }));
          let gettallytimer = setInterval(() => {
            obs.send('GetSceneList').then((data) => {
              let res = data.scenes
              sense = []
              for (let i = 0; i < res.length; i++) {
                sense.push(res[i].name)
              }
            }).catch((error) => {
              obsclose(gettallytimer2, gettallytimer);
            });
            obs.send('GetStudioModeStatus').then((data) => {
              studiomode = data.studioMode;
            }).catch((error) => {
              obsclose(gettallytimer2, gettallytimer);
            });
            obs.send('GetCurrentScene').then((data) => {
              pgmid = sense.indexOf(data.name) + 1;
            }).catch((error) => {
              obsclose(gettallytimer2, gettallytimer);
            });
            if (studiomode) {
              obs.send('GetPreviewScene').then((data) => {
                pwvid = sense.indexOf(data.name) + 1;
              }).catch((error) => {
                console.error('not in studio mode');
              });
            } else {
              pwvid = 0;
            }
            if (oldpgmid != pgmid || oldpwvid != pwvid) {
              oldpgmid = pgmid;
              oldpwvid = pwvid;
              tally(pgmid, pwvid);
            }
          }, 1);
          let gettallytimer2 = setInterval(() => {
            tally(pgmid, pwvid);
          }, 10);
        })
        .catch((error) => {
          console.error('Failed to connect to OBS WebSocket:', error);
          sendtoweb(JSON.stringify({ get: "connect", data: false }));
          tally(0, 0)
        });
      function obsclose(timer, timer2) {
        sendtoweb(JSON.stringify({ get: "error", data: "OBS斷線，請檢查連線狀況" }));
        tally(0, 0)
        clearInterval(timer);
        clearInterval(timer2);
      }
      atem.disconnect();
      vmixclient.destroy();
    }
    if (source == "VMIX") {
      vmixAddress = console_ip;
      intervalId = setInterval(() => {
        const vmixclient = new net.Socket();
        vmixclient.connect(vmixPort, vmixAddress, function () {
          vmixclient.write('TALLY\r\n');
        });
        vmixclient.on('data', function (data) {
          let data2 = data.toString()
          data2 = data2.replace("VERSION OK 23.0.0.68", "")
          data2 = data2.replace("TALLY OK ", "")
          data2 = data2.replace(/\r?\n|\r/g, '');
          let i = 0;
          dataArray = []
          while (i < data2.length) {
            dataArray.push(Number(data2.slice(i, i + 1)));
            i += 1;
            if (i < data2.length && data2[i] === '0') {
              dataArray.push(0);
              i += 1;
            }
          }
          if (dataArray.length != 0) {
            pgm = [];
            for (let j = 0; j < dataArray.length; j++) {
              if (dataArray[j] == 1) {
                pgm.push(j + 1)
              }
            }
            for (let j = 0; j < dataArray.length; j++) {
              if (dataArray[j] == 2) {
                pwv = j + 1;
              }
            }
            if (pwv === undefined) {
              pwv = 0;
            }
          }
          tallyarray(pgm, pwv)
          vmixclient.destroy();
        });
        vmixclient.on('close', function () {
        });
        vmixclient.on('error', function () {
          sendtoweb(JSON.stringify({ get: "error", data: "VMIX斷線，請檢查連線狀況" }));
          clearInterval(intervalId);
          vmixclient.destroy();
        });
      }, 70);
      obs.disconnect();
      atem.disconnect();
    }
    if (source == "ATEM") {
      let connectedtimer = setInterval(() => {
        sendtoweb(JSON.stringify({ get: "error", data: "ATEMIP錯誤" }));
        atem.disconnect();
        clearInterval(connectedtimer);
      }, 500);
      atem.on('connected', () => {
        clearInterval(connectedtimer);
        console.log('ATEM connected');
        sendtoweb(JSON.stringify({ get: "connect", data: true }));
        tally(0, 0)
      });
      atem.on('disconnected', () => {
        console.log('ATEM disconnected');
        sendtoweb(JSON.stringify({ get: "error", data: "ATEM斷線，請檢查連線狀況" }));
        tally(0, 0)
      });
      atem.on('stateChanged', (state) => {
        tally(state.video.mixEffects[0].programInput, state.video.mixEffects[0].previewInput);
      })
      atem.connect(console_ip);
      obs.disconnect();
      vmixclient.destroy();
    }
  }
})
app.on('window-all-closed', function () {
  sendtally(BROADCAST_ADDR, JSON.stringify([{ get: "tally", pgm: 255, pwv: 255 }]))
  if (process.platform !== 'darwin') app.quit();
})
client.bind(() => {
  client.setBroadcast(true);
});
client.on('listening', () => {
  console.log('Broadcasting messages...');
  setInterval(() => {
    client.send(MESSAGE, PORT, BROADCAST_ADDR, (err) => {
      if (err) {
        console.error(err);
      }
    });
  }, 1000);
});
client.on('error', (err) => {
  console.error(`Error: ${err}`);
});
client.on('message', (msg, rinfo) => {
  if (!espAddresses.includes(rinfo.address)) {
    espAddresses.push(rinfo.address);
  }
  if (!timers[rinfo.address]) {
    timers[rinfo.address] = setTimeout(() => {
      espAddresses.splice(espAddresses.indexOf(rinfo.address), 1);
      delete timers[rinfo.address];
    }, 5000);
  } else {
    clearTimeout(timers[rinfo.address]);
    timers[rinfo.address] = setTimeout(() => {
      espAddresses.splice(espAddresses.indexOf(rinfo.address), 1);
      delete timers[rinfo.address];
    }, 5000);
  }
});
function sendtally(ip, data) {
  let MESSAGE = Buffer.from(data);
  client.send(MESSAGE, PORT, ip, (err) => {
    if (err) {
      console.error(err);
    }
  });
}
function tally(pgm, pwv) {
  webtally(pgm, pwv);
  sendtally(BROADCAST_ADDR, JSON.stringify([{ get: "tally", pgm: [pgm], pwv: pwv }]))
}
function tallyarray(pgm, pwv) {
  webtally(pgm, pwv);
  sendtally(BROADCAST_ADDR, JSON.stringify([{ get: "tally", pgm: pgm, pwv: pwv }]))
}
/////////////////////////websocket/////////////////////////
wss.on("connection", (ws) => {
  ws.on("message", (event) => {
  });
  ws.on("close", () => {
  });
});
function send(sendData) {
  let clients = wss.clients;
  clients.forEach((client) => {
    client.send(sendData);//回去的資料
  });
}
function webtally(pgm, pwv) {
  send(JSON.stringify({ get: "sendtally", pgm: pgm, pwv: pwv }));
}
