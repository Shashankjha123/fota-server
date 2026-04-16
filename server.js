const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// APK storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });

// Device storage
let devices = {};

// Latest APK info
let latestAPK = {
    version: "1.0",
    apk_url: "",
    package_name: "com.osel.player"
};

const DEVICE_IP = '192.168.41.1:5555';
const ADB = 'D:\\Platform-tools\\adb.exe';

// Upload APK
app.post('/upload', upload.single('apk'), (req, res) => {
    if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
    latestAPK.apk_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.originalname}`;
    res.json({ success: true, message: 'APK uploaded!', filename: req.file.originalname });
});

// Serve uploaded APKs
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Get APK list
app.get('/apklist', (req, res) => {
    if (!fs.existsSync('uploads')) return res.json({ files: [] });
    const files = fs.readdirSync('uploads').filter(f => f.endsWith('.apk'));
    res.json({ files });
});

// Install APK via ADB (local network)
app.post('/install', (req, res) => {
    const { filename } = req.body;
    const apkPath = path.join(__dirname, 'uploads', filename);
    if (!fs.existsSync(apkPath)) return res.json({ success: false, message: 'APK not found' });

    const commands = `"${ADB}" connect ${DEVICE_IP} && "${ADB}" -s ${DEVICE_IP} root && "${ADB}" connect ${DEVICE_IP} && "${ADB}" -s ${DEVICE_IP} shell pm uninstall com.osel.player & "${ADB}" -s ${DEVICE_IP} shell pm uninstall com.limitless.soft_pdu & "${ADB}" -s ${DEVICE_IP} install "${apkPath}" && "${ADB}" -s ${DEVICE_IP} shell am start -n com.osel.player/.presenter.SplashActivity`;

    exec(commands, (error, stdout, stderr) => {
        if (error) return res.json({ success: false, message: error.message, log: stdout });
        res.json({ success: true, message: 'Build installed!', log: stdout });
    });
});

// Register device with TID
app.post('/register', (req, res) => {
    const { tid } = req.body;
    if (!tid) return res.json({ success: false });
    devices[tid] = {
        tid,
        lastSeen: new Date().toISOString(),
        status: 'online',
        pendingUpdate: null
    };
    res.json({ success: true, message: 'Device registered' });
});

// TB40 checks for update by TID
app.get('/checkupdate/:tid', (req, res) => {
    const { tid } = req.params;
    if (devices[tid]) {
        devices[tid].lastSeen = new Date().toISOString();
        devices[tid].status = 'online';
    } else {
        devices[tid] = {
            tid,
            lastSeen: new Date().toISOString(),
            status: 'online',
            pendingUpdate: null
        };
    }
    const pending = devices[tid].pendingUpdate;
    if (pending) {
        devices[tid].pendingUpdate = null;
        return res.json({ update: true, ...pending });
    }
    res.json({ update: false });
});

// Get all devices
app.get('/devices', (req, res) => {
    res.json({ devices: Object.values(devices) });
});

// Push update to specific TID
app.post('/targetupdate', (req, res) => {
    const { tid, version, apk_url, package_name } = req.body;
    if (!tid) return res.json({ success: false, message: 'No TID provided' });
    if (!devices[tid]) return res.json({ success: false, message: 'Device not found' });
    devices[tid].pendingUpdate = { version, apk_url, package_name };
    res.json({ success: true, message: `Update queued for ${tid}` });
});

// Update latest APK info
app.post('/setlatest', (req, res) => {
    const { version, apk_url, package_name } = req.body;
    latestAPK = { version, apk_url, package_name };
    res.json({ success: true, message: 'Latest APK info updated' });
});
app.get('/getplayers', async (req, res) => {
    const crypto = require('crypto');
    const AK = '7a12c6e0446646c6b69264715ba020ef';
    const AS = '18830e0054934529a0883535662ede31';
    const Nonce = 'abc12345';
    const CurTime = String(Math.floor(Date.now() / 1000));
    const CheckSum = crypto.createHash('sha256')
        .update(AS + Nonce + CurTime)
        .digest('hex');

    const response = await fetch(
        'https://openapi-in.vnnox.com/v2/player/list?count=20&start=0',
        {
            method: 'GET',
            headers: {
                'AppKey': AK,
                'Nonce': Nonce,
                'CurTime': CurTime,
                'CheckSum': CheckSum,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );
    const data = await response.json();
    res.json(data);
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('FOTA Server running on port ' + PORT);
});