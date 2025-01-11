const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

// تعيين مسار Chrome
process.env.CHROME_BIN = process.env.CHROME_BIN || '/usr/bin/google-chrome';

if (!process.env.FIREBASE_CONFIG) {
    console.error('خطأ: متغير FIREBASE_CONFIG غير موجود');
    process.exit(1);
}

let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
} catch (error) {
    console.error('خطأ في تحليل FIREBASE_CONFIG:', error);
    process.exit(1);
}

// تهيئة Firebase قبل استيراد مدير الأجهزة
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
console.log('تم الاتصال بـ Firebase بنجاح');

// استيراد مدير الأجهزة بعد تهيئة Firebase
const deviceManager = require('./devices');

const db = admin.firestore();
const messagesRef = db.collection('messages');
const apiKeysRef = db.collection('api_keys');

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(cors());

// إضافة الملفات الثابتة
app.use(express.static('public', {
    index: false  // منع استخدام index.html كصفحة افتراضية
}));

// middleware للتحقق من تسجيل الدخول
function requireAuth(req, res, next) {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.redirect('/login.html');
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        // حذف الكوكيز غير الصالحة
        res.clearCookie('token');
        res.redirect('/login.html');
    }
}

// توجيه الصفحة الرئيسية (صفحة الترحيب)
app.get('/', (req, res) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (token) {
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            return res.redirect('/home.html');
        } catch (error) {
            // إذف الكوكيز غير الصالحة
            res.clearCookie('token');
            return res.sendFile(path.join(__dirname, 'public', 'welcome.html'));
        }
    }
    res.sendFile(path.join(__dirname, 'public', 'welcome.html'));
});

// توجيه صفحة الإرسال (تتطلب تسجيل دخول)
app.get('/send', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'send.html'));
});

// توجيه صفحة لوحة التحكم (تتطلب تسجيل دخول)
app.get('/home', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// توجيه صفحة API (تتطلب تسجيل دخول)
app.get('/api-dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'api-dashboard.html'));
});

// توجيه صفحة التوثيق (تتطلب تسجيل دخول)
app.get('/docs', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// صفحات المصادقة (لا تتطلب تسجيل دخول)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get('/verify-email', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'verify-email.html'));
});

const server = http.createServer(app);
const io = new Server(server);

// تكوين Socket.IO مع التحقق من المصادقة
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('يجب تسجيل الدخول'));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (error) {
        next(new Error('رمز المصادقة غير صالح'));
    }
});

// إعداد مستمعي الأحداث لـ Socket.IO
io.on('connection', async (socket) => {
    console.log('مستخدم جديد متصل');
    
    // تهيئة أجهزة المستخدم
    await deviceManager.initializeDevices(socket.user.uid);

    // إرسال قائمة الأجهزة للمستخدم
    const devices = await deviceManager.getDevices(socket.user.uid);
    socket.emit('devicesList', devices);

    // معالجة إضافة جهاز جديد
    socket.on('addDevice', async (data) => {
        try {
            const device = await deviceManager.createDevice(socket.user.uid, data.name);
            socket.emit('deviceAdded', device);
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    // معالجة قطع اتصال جهاز
    socket.on('disconnectDevice', async (deviceId) => {
        try {
            await deviceManager.disconnectDevice(deviceId);
            socket.emit('deviceDisconnected', deviceId);
        } catch (error) {
            socket.emit('error', error.message);
        }
    });

    // معالجة إرسال رسالة
    socket.on('sendMessage', async (data) => {
        try {
            const { deviceId, name, countryCode, phone, message } = data;
            const fullPhone = `${countryCode}${phone}`;
            
            const response = await deviceManager.sendMessage(deviceId, fullPhone, message);
            
            // حفظ الرسالة في قاعدة البيانات
            await messagesRef.add({
                userId: socket.user.uid,
                deviceId,
                name,
                phone: fullPhone,
                message,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                messageId: response.id._serialized
            });

            socket.emit('messageSent', 'تم إرسال الرسالة بنجاح!');
        } catch (error) {
            socket.emit('messageSent', `خطأ: ${error.message}`);
        }
    });
});

// إعداد مستمعي الأحداث لمدير الأجهزة
deviceManager.setEventEmitter(io);

// API Routes
app.get('/api/devices', validateToken, async (req, res) => {
    try {
        const devices = await deviceManager.getDevices(req.user.uid);
        res.json(devices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/devices', validateToken, async (req, res) => {
    try {
        const device = await deviceManager.createDevice(req.user.uid, req.body.name);
        res.json(device);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/devices/:deviceId/disconnect', validateToken, async (req, res) => {
    try {
        await deviceManager.disconnectDevice(req.params.deviceId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Middleware للتحقق من التوكن
function validateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'رمز المصادقة غير صالح' });
    }
}

// مسارات المصادقة
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // التحقق من المستخدم باستخدام Firebase Admin
        const userRecord = await admin.auth().getUserByEmail(email);
        
        // إنشاء توكن جديد
        const token = jwt.sign(
            { 
                uid: userRecord.uid,
                email: userRecord.email,
                role: userRecord.customClaims?.role || 'user'
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // إرسال التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/'
        });

        res.json({ 
            success: true,
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName
            },
            token,
            redirect: '/home.html'
        });
    } catch (error) {
        console.error('خطأ في تسجيل الدخول:', error);
        res.status(401).json({ 
            success: false,
            error: 'فشل تسجيل الدخول. تأكد من صحة البريد الإلكتروني وكلمة المرور.' 
        });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        
        // إنشاء مستخدم جديد في Firebase
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: name
        });

        // إنشاء توكن جديد
        const token = jwt.sign(
            { 
                uid: userRecord.uid,
                email: userRecord.email,
                role: 'user'
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // إرسال التوكن في الكوكيز
        res.cookie('token', token, {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/'
        });

        res.json({ 
            success: true,
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: name
            },
            token,
            redirect: '/home.html'
        });
    } catch (error) {
        console.error('خطأ في إنشاء الحساب:', error);
        res.status(400).json({ 
            success: false,
            error: 'فشل إنشاء الحساب. ' + error.message 
        });
    }
});

// مسار للحصول على معلومات المستخدم
app.get('/api/auth/user', validateToken, async (req, res) => {
    try {
        const userRecord = await admin.auth().getUser(req.user.uid);
        res.json({
            uid: userRecord.uid,
            email: userRecord.email,
            name: userRecord.displayName,
            role: req.user.role
        });
    } catch (error) {
        console.error('خطأ في جلب معلومات المستخدم:', error);
        res.status(401).json({ 
            success: false,
            error: 'فشل في جلب معلومات المستخدم' 
        });
    }
});

// التحقق من مفتاح API
async function validateApiKey(req, res, next) {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(401).json({ error: 'مفتاح API مطلوب' });
        }

        const apiKeyDoc = await apiKeysRef.doc(apiKey).get();
        if (!apiKeyDoc.exists) {
            return res.status(401).json({ error: 'مفتاح API غير صالح' });
        }

        const apiKeyData = apiKeyDoc.data();
        if (!apiKeyData.isActive) {
            return res.status(401).json({ error: 'مفتاح API غير نشط' });
        }

        req.apiKey = apiKey;
        req.userId = apiKeyData.userId;
        req.deviceId = apiKeyData.deviceId;
        next();
    } catch (error) {
        console.error('خطأ في التحقق من مفتاح API:', error);
        res.status(500).json({ error: 'خطأ في التحقق من مفتاح API' });
    }
}

// إرسال رسالة عبر API
app.post('/api/send', validateApiKey, async (req, res) => {
    try {
        const { phone, message, name } = req.body;
        
        // التحقق من البيانات المطلوبة
        if (!phone || !message) {
            return res.status(400).json({ 
                error: 'رقم الهاتف والرسالة مطلوبان',
                code: 'MISSING_REQUIRED_FIELDS'
            });
        }

        // التحقق من تنسيق رقم الهاتف
        if (!/^\d{10,15}$/.test(phone)) {
            return res.status(400).json({ 
                error: 'رقم الهاتف غير صالح',
                code: 'INVALID_PHONE_NUMBER'
            });
        }

        // التحقق من طول الرسالة
        if (message.length > 4096) {
            return res.status(400).json({ 
                error: 'الرسالة طويلة جداً. الحد الأقصى هو 4096 حرف',
                code: 'MESSAGE_TOO_LONG'
            });
        }

        // التحقق من حالة الجهاز
        const deviceDoc = await devicesRef.doc(req.deviceId).get();
        if (!deviceDoc.exists) {
            return res.status(404).json({ 
                error: 'الجهاز غير موجود',
                code: 'DEVICE_NOT_FOUND'
            });
        }

        const deviceData = deviceDoc.data();
        if (deviceData.status !== 'connected') {
            return res.status(400).json({ 
                error: 'الجهاز غير متصل',
                code: 'DEVICE_NOT_CONNECTED'
            });
        }

        // إرسال الرسالة
        const response = await deviceManager.sendMessage(req.deviceId, phone, message);
        
        // تحديث آخر استخدام لمفتاح API
        await apiKeysRef.doc(req.apiKey).update({
            lastUsed: admin.firestore.FieldValue.serverTimestamp(),
            messageCount: admin.firestore.FieldValue.increment(1)
        });

        // حفظ الرسالة في قاعدة البيانات
        const messageDoc = await messagesRef.add({
            userId: req.userId,
            deviceId: req.deviceId,
            apiKey: req.apiKey,
            name: name || null,
            phone,
            message,
            status: 'sent',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            messageId: response.id._serialized
        });

        res.json({ 
            success: true,
            messageId: response.id._serialized,
            message: {
                id: messageDoc.id,
                status: 'sent',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        
        let statusCode = 500;
        let errorMessage = 'خطأ في إرسال الرسالة';
        let errorCode = 'INTERNAL_SERVER_ERROR';

        if (error.message.includes('not connected')) {
            statusCode = 400;
            errorMessage = 'الجهاز غير متصل';
            errorCode = 'DEVICE_NOT_CONNECTED';
        } else if (error.message.includes('not registered')) {
            statusCode = 400;
            errorMessage = 'رقم الهاتف غير مسجل في واتساب';
            errorCode = 'PHONE_NOT_REGISTERED';
        }

        res.status(statusCode).json({ 
            error: errorMessage,
            code: errorCode,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// إنشاء مفتاح API جديد
app.post('/api/keys', validateToken, async (req, res) => {
    try {
        const { deviceId, name } = req.body;
        
        if (!deviceId || !name) {
            return res.status(400).json({ 
                error: 'معرف الجهاز والاسم مطلوبان',
                code: 'MISSING_REQUIRED_FIELDS'
            });
        }

        // التحقق من وجود الجهاز وملكيته
        const deviceDoc = await devicesRef.doc(deviceId).get();
        if (!deviceDoc.exists || deviceDoc.data().userId !== req.user.uid) {
            return res.status(404).json({ 
                error: 'الجهاز غير موجود',
                code: 'DEVICE_NOT_FOUND'
            });
        }

        // التحقق من عدد المفاتيح الحالية
        const existingKeys = await apiKeysRef
            .where('userId', '==', req.user.uid)
            .where('deviceId', '==', deviceId)
            .get();

        if (existingKeys.size >= 5) {
            return res.status(400).json({ 
                error: 'تم الوصول للحد الأقصى من المفاتيح لهذا الجهاز (5 مفاتيح)',
                code: 'MAX_KEYS_REACHED'
            });
        }

        // إنشاء مفتاح API عشوائي
        const apiKey = require('crypto').randomBytes(32).toString('hex');
        
        // حفظ مفتاح API في Firestore
        await apiKeysRef.doc(apiKey).set({
            userId: req.user.uid,
            deviceId,
            name,
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUsed: null,
            messageCount: 0
        });

        res.json({ 
            success: true,
            apiKey,
            deviceId,
            name
        });
    } catch (error) {
        console.error('خطأ في إنشاء مفتاح API:', error);
        res.status(500).json({ 
            error: 'خطأ في إنشاء مفتاح API',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
});

// جلب مفاتيح API للمستخدم
app.get('/api/keys', validateToken, async (req, res) => {
    try {
        const snapshot = await apiKeysRef.where('userId', '==', req.user.uid).get();
        const keys = snapshot.docs.map(doc => ({
            key: doc.id,
            ...doc.data()
        }));
        res.json(keys);
    } catch (error) {
        console.error('خطأ في جلب مفاتيح API:', error);
        res.status(500).json({ error: 'خطأ في جلب مفاتيح API' });
    }
});

// حذف مفتاح API
app.delete('/api/keys/:key', validateToken, async (req, res) => {
    try {
        const keyDoc = await apiKeysRef.doc(req.params.key).get();
        if (!keyDoc.exists || keyDoc.data().userId !== req.user.uid) {
            return res.status(404).json({ error: 'مفتاح API غير موجود' });
        }

        await apiKeysRef.doc(req.params.key).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في حذف مفتاح API:', error);
        res.status(500).json({ error: 'خطأ في حذف مفتاح API' });
    }
});

// تشغيل الخادم
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
