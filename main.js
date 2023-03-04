//windows
const { Tray, Menu, app, BrowserWindow } = require('electron')
const path = require('path')
const { ipcMain } = require('electron')
//icon
function createTray(win) {

  const iconPath = path.join(__dirname, './led.png');
  const tray = new Tray(iconPath)
  const contextMenu = Menu.buildFromTemplate([

    {
      label: '回復',
      click: () => win.show() // 隱藏 桌面貓咪
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

/* Create new class using library. */
const obs = new OBSWebSocket();
//user data
let user;
const fs = require('fs');
fs.readFile('./data/login_data.json', 'utf-8', (err, data) => {
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
  console.log("Application started and Listening on port 8080");
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
let BROADCAST_ADDR = '192.168.137.255'; // 廣播地址
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
  //mainWindow.webContents.openDevTools()
  return mainWindow;
}

app.whenReady().then(() => {

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()

  })


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
        console.log(login);
        if (login[0]) {
          win.loadFile("./web/panel/index.html")
          // win.setSize(1600, 900);
        } else {
          sendtoweb(JSON.stringify({ get: "login", password: login[0], name: login[1] }));
        }
        break;
      case "logout":
        win.loadFile("./web/index.html")
        //win.setSize(600, 900);
        break;
      case "set":
        source = res.source;
        console_ip = res.ip;
        gettallydata();
        break;
      case "atemip":
        sendtoweb(JSON.stringify({ get: "atemip", data: "ok" }));
        //atemip = res.ip;
        //BROADCAST_ADDR = getlocal(atemip);
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
        console.log("get data error");

    }
  });
  // win.webContents.send("fromMain", responseObj);
  function sendtoweb(sendData) {
    win.webContents.send("fromMain", sendData);
  }
  function getlogin(uuid, password) {
    //console.log(uuid)
    // console.log(password)
    for (let i = 0; i < user.length; i++) {
      if (uuid == user[i].uuid) {
        if (password == user[i].password) {
          //console.log("ok");
          // console.log(user[i].name)
          return [true, user[i].name];
        }
      }
    }
    // console.log("no");
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
          console.log('Connected to OBS WebSocket');
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
              oldpwvid = pwvid
              //webtally(pgmid, pwvid);
              tally(pgmid, pwvid);
            }

          }, 1);
          let gettallytimer2 = setInterval(() => {
            //webtally(pgmid, pwvid);
            tally(pgmid, pwvid);
          }, 10);
        })
        .catch((error) => {
          console.error('Failed to connect to OBS WebSocket:', error);
          sendtoweb(JSON.stringify({ get: "connect", data: false }));
        });
      function obsclose(timer, timer2) {
        //console.log('已斷開 OBS 連線');
        sendtoweb(JSON.stringify({ get: "error", data: "OBS斷線，請檢查連線狀況" }));
        clearInterval(timer);
        clearInterval(timer2);
      }


    }
    if (source == "VMIX") {
      sendtoweb(JSON.stringify({ get: "error", data: "VMIXTally即將推出敬請期待" }));
      obs.disconnect();
    }
    if (source == "ATEM") {
      sendtoweb(JSON.stringify({ get: "error", data: "ATEMTally即將推出敬請期待" }));
      obs.disconnect();
    }
  }
})

app.on('window-all-closed', function () {
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
      } else {
        //console.log('Broadcast message sent');
        //console.log(espAddresses)
      }
    });
  }, 1000); // 每5秒廣播一次
});

client.on('error', (err) => {
  console.error(`Error: ${err}`);
});

client.on('message', (msg, rinfo) => {
  // console.log(`Received message from ${rinfo.address}:${rinfo.port}: ${msg}`);
  if (!espAddresses.includes(rinfo.address)) {
    espAddresses.push(rinfo.address); // 將新的IP地址加入到陣列中
    console.log(`found new esp8266: ${rinfo.address}`);
  }

  if (!timers[rinfo.address]) {
    timers[rinfo.address] = setTimeout(() => {
      // 刪除IP地址
      espAddresses.splice(espAddresses.indexOf(rinfo.address), 1);
      delete timers[rinfo.address];
      console.log(`ESP8266 ${rinfo.address} removed due to inactivity`);

    }, 5000); // 設定定時器時間為25秒
  } else {
    clearTimeout(timers[rinfo.address]);
    timers[rinfo.address] = setTimeout(() => {
      espAddresses.splice(espAddresses.indexOf(rinfo.address), 1);
      delete timers[rinfo.address];
      console.log(`ESP8266 ${rinfo.address} removed due to inactivity`);

    }, 5000); // 設定定時器時間為25秒
  }

});
function sendtally(ip, data) {
  let MESSAGE = Buffer.from(data);
  client.send(MESSAGE, PORT, ip, (err) => {
    if (err) {
      console.error(err);
    } else {
      // console.log('Broadcast message sent');
      // console.log(data)
    }
  });
}
function tally(pgm, pwv) {
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
