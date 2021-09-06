// server.js
// where your node app starts

// we've started you off with Express (https://expressjs.com/)
// but feel free to use whatever libraries or frameworks you'd like through `package.json`.
const express = require("express");
const app = express();
const fs = require('fs');
const bodyParser = require("body-parser");
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const httpPort = process.env.PORT || 5656;
const httpsPort = process.env.PORT_HTTPS || 5657;
const isLinux = process.platform === "linux";
const cacheDir = __dirname + "/pics";
try {
    fs.mkdirSync(cacheDir);
} catch (e) {}
let haveAVX = true;

if (isLinux) {
    const cpuinfo = String(fs.readFileSync("/proc/cpuinfo"));
    haveAVX = cpuinfo.includes("avx");
}

if (!haveAVX) {
    console.log(cpuinfo);
    console.log("AVX instruction set not detected, if you believe it is a mistake please delete this line");
    const err = new Error("No AVX");
    throw err;
}

let nsfwModel = {}
if (haveAVX) {
    nsfwModel = require("./src/NSFWModel");
    nsfwModel.init().then(() => {
        cache = [];
    });
}
const jsonParser = bodyParser.json();
const urlencodedParser = bodyParser.urlencoded({
    extended: true
})
const rawParser = bodyParser.raw({
    type: '*/*',
    limit: '8mb'
});
app.head("/", (request, response) => {
    response.status(200);
});
// make all the files in 'public' available
app.use(express.static("public"));
app.use(function(req, res, next) {
    if (!process.env.NODE_NSFW_KEY) {
        next();
    } else if (!req.headers.authorization && !!process.env.NODE_NSFW_KEY) {
        console.log("No auth");
        return res.status(403).json({
            error: "No Authorization Provided"
        });
    } else if (req.headers.authorization !== process.env.NODE_NSFW_KEY) {
        console.log("invalid auth");
        return res.status(403).json({
            error: "Invalid Authorization"
        });
    } else {
        next();
    }
});
app.get("/", (request, response) => {
    response.sendFile(__dirname + "/views/index.html");
});
let cache = []; //todo use proper database lmao
let discordVideo = [".gif", ".mp4", ".webm"];

async function classify(url, req, res) {
    console.log(req.url + ":" + url);
    const hash = url;
    try {
        if (!cache[hash]) {
            cache[hash] = await nsfwModel.classify(url);
        }
        res.json(cache[hash]);
    } catch (err) {
        res.status(500);
        res.send("wtf");
        console.log(err);
    }
}
app.get("/api/json/test", (req, res) => {
    s = {}
    s.yes = "yes";
    res.json(s);
});
app.get("/api/json/graphical", (req, res) => {
    res.json(nsfwModel.report);
});
app.post("/api/json/graphical/classification/hash", rawParser, async (req, res) => {
    const key = req.body.toString("hex");
    if (!!cache[key]) {
        return res.json(cache[key]).status(200);
    }
    return res.send("nope: " + key).status(404);
})


app.post("/api/json/graphical/classification", rawParser, async (req, res) => {
    if (req.body.length < 8) {
        return res.json({
            error: "less than 8 byte, sus"
        }).status(406);
    }
    const sha256 = crypto.createHash('sha256');
    sha256.update(req.body);
    const hex = sha256.digest("hex").toString();
    if (!!cache[hex]) {
        return res.json(cache[hex]).status(200);
    }
    if(process.env.CACHE_IMAGE_HASH_FILE)
    fs.writeFileSync(cacheDir + "/" + hex + ".png", req.body, {
        flag: 'w'
    });
    const dig = nsfwModel.digest(req.body);
    cache[hex] = dig; //regardless
    if (!dig.error) {
        return res.json(dig).status(201);
    }
    console.log("Error Processing, Hash: " + hex);
    res.json(dig).status(406);
})

app.get("/api/json/graphical/classification/*", async (req, res) => {
    let url = req.url.replace("/api/json/graphical/classification/", "");
    if (!url) return;
    let body = {};
    let allowed = true;
    body.error = "Not allowed/Discord media only or ended with media extension";
    code = 406;
    if (url.startsWith("https://cdn.discordapp.com/") || url.startsWith("https://media.discordapp.net/")) {
        for (const ext of discordVideo) {
            if (url.endsWith(ext)) {
                allowed = false;
                if (url.startsWith("https://cdn.discordapp.com/") || url.startsWith("https://media.discordapp.net/")) {
                    url = url + "?format=png";
                    url = url.replace(
                        "https://cdn.discordapp.com/",
                        "https://media.discordapp.net/"
                    );
                    allowed = true;
                    break;
                }
            }
        }


    } else {

        if (
            !(url.endsWith(".png") || url.endsWith(".jpeg") || url.endsWith(".bmg") || url.endsWith(".jpg") || url.endsWith(".gif"))
        ) {
            stat = 415;
            body.error = "Only allow https://cdn.discordapp.com/ or png, jpeg, bmg, jpg, gif";
            allowed = false;
        }

    }

    if (!allowed) {
        res.status(stat).json(body);
        return;
    }
    await classify(url, req, res);
});

app.get("*", function(req, res) {
    res.status(404);

    // respond with json
    if (req.accepts("json")) {
        res.json({
            error: "Not found"
        });
        return;
    }

    // default to plain-text. send()
    res.type("txt").send("Not found");
});
// listen for requests :)
/*fuck you unlisten listener
const listener = app.listen(process.env.PORT || 5656, () => {
    console.log("Your app is listening on port " + listener.address().port);
});
*/
const httpServer = http.createServer(app);
httpServer.listen(httpPort, () => {
    console.log("Http server listing on port : " + httpPort)
});
if (fs.existsSync(__dirname + '/certsFiles/certificate.crt')) {
    try {

        const credentials = {};
        credentials.cert = fs.readFileSync(__dirname + '/certsFiles/private.key');
        credentials.key = fs.readFileSync(__dirname + '/certsFiles/certificate.crt');
        if (fs.existsSync(__dirname + '/certsFiles/ca_bundle.crt')) {
            credentials.ca = fs.readFileSync(__dirname + '/certsFiles/ca_bundle.crt');
        }
        const httpsServer = https.createServer(credentials, app);
        httpsServer.listen( httpsPort, () => {
            console.log("Https server listing on port : " + httpsPort)
        });
    } catch (e) {
        console.log("Can't start Https server");
        console.log(e);
    }
}
