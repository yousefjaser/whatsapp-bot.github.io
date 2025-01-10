const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-config.json');
const fs = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('تم الاتصال بـ Firebase بنجاح');
} catch (error) {
    console.error('خطأ في الاتصال بـ Firebase:', error);
}

const db = admin.firestore();
const messagesRef = db.collection('messages');
const apiKeysRef = db.collection('api_keys');

const app = express();
app.use(cookieParser());
const server = http.createServer(app);
const io = new Server(server);

// إعداد مسار ملف المصادقة
const AUTH_FILE_PATH = path.join(__dirname, 'auth_info.json');

// إنشاء عميل WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot"
    }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    }
});

let qrCode = null;
let isConnected = false;

// إضافة متغير لتتبع العملاء المتصلين
const connectedClients = {};

// دالة لحفظ معلومات المصادقة
async function saveAuthInfo(authInfo) {
    try {
        await fs.writeFile(AUTH_FILE_PATH, JSON.stringify(authInfo, null, 2));
        console.log('تم حفظ معلومات المصادقة');
    } catch (error) {
        console.error('خطأ في حفظ معلومات المصادقة:', error);
    }
}

// دالة لقراءة معلومات المصادقة
async function loadAuthInfo() {
    try {
        const data = await fs.readFile(AUTH_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log('لم يتم العثور على ملف المصادقة');
        return null;
    }
}

app.use(express.json());
app.use(express.static('public'));

// دالة للتحقق من صحة مفتاح API
async function validateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ error: 'مفتاح API مطلوب' });
    }

    try {
        const doc = await apiKeysRef.doc(apiKey).get();
        if (!doc.exists || !doc.data().active) {
            return res.status(401).json({ error: 'مفتاح API غير صالح' });
        }
        next();
    } catch (error) {
        console.error('خطأ في التحقق من مفتاح API:', error);
        res.status(500).json({ error: 'خطأ في التحقق من مفتاح API' });
    }
}

// Middleware للتحقق من المصادقة
const authenticateToken = (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '') || 
                     req.cookies?.token || 
                     req.query?.token;
        
        if (!token) {
            console.log('لا يوجد توكن في الطلب');
            return res.status(401).json({ error: 'يجب تسجيل الدخول' });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            console.error('خطأ في التحقق من التوكن:', error);
            return res.status(401).json({ error: 'رمز المصادقة غير صالح' });
        }
    } catch (error) {
        console.error('خطأ في middleware المصادقة:', error);
        return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    }
};

// المسارات الرئيسية
app.get('/', (req, res) => {
    const token = req.cookies?.token;
    if (token) {
        res.redirect('/home');
    } else {
        res.redirect('/login');
    }
});

app.get('/home', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

// إضافة مسارات المصادقة
const authRoutes = require('./auth');
app.use('/api/auth', authRoutes);

// تحديث المسارات لتتطلب المصادقة
app.get('/send', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api-dashboard', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'api-dashboard.html'));
});

// دالة للتحقق من صلاحيات المالك
async function checkOwnerAccess(req, res, next) {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com') {
            res.status(403).json({ error: 'غير مصرح لك بالوصول' });
            return;
        }
        next();
    } catch (error) {
        console.error('خطأ في التحقق من صلاحيات المالك:', error);
        res.status(500).json({ error: 'حدث خطأ في التحقق من الصلاحيات' });
    }
}

// مسار صفحة المالك
app.get('/owner', authenticateToken, checkOwnerAccess, (req, res) => {
    res.sendFile(path.join(__dirname, 'owner.html'));
});

// API لإضافة مسؤول جديد
app.post('/api/owner/admins', authenticateToken, checkOwnerAccess, async (req, res) => {
    try {
        const { email } = req.body;
        const user = await admin.auth().getUserByEmail(email);
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        
        await admin.firestore().collection('logs').add({
            type: 'info',
            message: `تمت إضافة ${email} كمسؤول جديد`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في إضافة مسؤول:', error);
        res.status(500).json({ error: 'حدث خطأ في إضافة المسؤول' });
    }
});

// API لإزالة مسؤول
app.delete('/api/owner/admins/:uid', authenticateToken, checkOwnerAccess, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.params.uid);
        await admin.auth().setCustomUserClaims(user.uid, { admin: false });
        
        await admin.firestore().collection('logs').add({
            type: 'warning',
            message: `تمت إزالة ${user.email} من المسؤولين`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في إزالة المسؤول:', error);
        res.status(500).json({ error: 'حدث خطأ في إزالة المسؤول' });
    }
});

// تعديل مسار صفحة المسؤول للتحقق من الصلاحيات
app.get('/admin', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        
        // التحقق إذا كان المستخدم هو المالك أو مسؤول
        if (user.email === 'yousefjaser2020@gmail.com' || 
            (user.customClaims && user.customClaims.admin)) {
            res.sendFile(path.join(__dirname, 'admin.html'));
            return;
        }
        
        res.redirect('/home');
    } catch (error) {
        console.error('خطأ في التحقق من صلاحيات المسؤول:', error);
        res.redirect('/home');
    }
});

// مسارات المصادقة
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'reset-password.html'));
});

app.get('/verify-email', (req, res) => {
    res.sendFile(path.join(__dirname, 'verify-email.html'));
});

app.get('/api/status', (req, res) => {
    res.json({
        isConnected: isConnected,
        qrCode: qrCode
    });
});

// مسار الإحصئيات
app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const messagesSnapshot = await admin.firestore().collection('messages')
            .where('userId', '==', req.user.uid)
            .get();
            
        const apiKeysSnapshot = await admin.firestore().collection('apiKeys')
            .where('userId', '==', req.user.uid)
            .where('active', '==', true)
            .get();
        
        res.json({
            messageCount: messagesSnapshot.size,
            apiKeyCount: apiKeysSnapshot.size,
            status: req.user.uid in connectedClients ? 'متصل' : 'غير متصل'
        });
    } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
        res.status(500).json({ error: 'حدث خطأ في جلب الإحصائيات' });
    }
});

// مسار صفحة التوثيق
app.get('/docs', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'docs.html'));
});

// API لإنشاء مفتاح جديد
app.post('/api/keys', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid; // الحصول على معرف المستخدم من التوكن
        const apiKey = Math.random().toString(36).substring(2) + Date.now().toString(36);
        
        await apiKeysRef.doc(apiKey).set({
            userId: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            active: true
        });
        
        res.json({ apiKey });
    } catch (error) {
        console.error('خطأ في إنشاء المفتاح:', error);
        res.status(500).json({ error: 'خطأ في إنشاء المفتاح' });
    }
});

// API لجلب مفاتيح المستخدم
app.get('/api/keys', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const snapshot = await apiKeysRef.where('userId', '==', userId).get();
        
        const keys = [];
        snapshot.forEach(doc => {
            keys.push({
                key: doc.id,
                ...doc.data()
            });
        });
        
        res.json({ keys });
    } catch (error) {
        console.error('خطأ في جلب المفاتيح:', error);
        res.status(500).json({ error: 'خطأ في جلب المفاتيح' });
    }
});

// API Routes
app.post('/api/messages', validateApiKey, async (req, res) => {
    try {
        const { phone, countryCode, message } = req.body;
        
        if (!phone || !countryCode || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const number = `${countryCode}${phone}@c.us`;
        const messageId = await client.sendMessage(number, message);
        
        const docRef = await db.collection('messages').add({
            phone: number,
            message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            messageId: messageId.id,
            status: 'sent'
        });

        res.json({
            success: true,
            messageId: messageId.id,
            docId: docRef.id
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.delete('/api/messages/:messageId', validateApiKey, async (req, res) => {
    try {
        const { messageId } = req.params;
        
        const messagesRef = db.collection('messages');
        const snapshot = await messagesRef.where('messageId', '==', messageId).get();
        
        if (snapshot.empty) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const doc = snapshot.docs[0];
        await client.deleteMessage(doc.data().phone, [messageId]);
        await doc.ref.delete();

        res.json({
            success: true,
            message: 'Message deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

app.put('/api/messages/:messageId', validateApiKey, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { newMessage } = req.body;
        
        if (!newMessage) {
            return res.status(400).json({ error: 'New message is required' });
        }

        const messagesRef = db.collection('messages');
        const snapshot = await messagesRef.where('messageId', '==', messageId).get();
        
        if (snapshot.empty) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const doc = snapshot.docs[0];
        const oldMessage = doc.data();
        
        const newMessageResult = await client.sendMessage(oldMessage.phone, newMessage);
        await client.deleteMessage(oldMessage.phone, [messageId]);
        
        await doc.ref.update({
            message: newMessage,
            messageId: newMessageResult.id,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            oldMessageId: messageId,
            newMessageId: newMessageResult.id
        });
    } catch (error) {
        console.error('Error updating message:', error);
        res.status(500).json({ error: 'Failed to update message' });
    }
});

app.get('/api/messages', validateApiKey, async (req, res) => {
    try {
        const messagesRef = db.collection('messages');
        const snapshot = await messagesRef.orderBy('timestamp', 'desc').limit(100).get();
        
        const messages = [];
        snapshot.forEach(doc => {
            messages.push({
                id: doc.id,
                ...doc.data()
            });
        });

        res.json({ messages });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

//إضافة دالة لحذف مجلد
async function deleteFolder(folderPath) {
    try {
        await fs.rm(folderPath, { recursive: true, force: true });
        console.log('تم حذف المجلد:', folderPath);
    } catch (error) {
        console.error('خطأ في حذف المجلد:', error);
    }
}

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

// Socket.IO حدث إرسال الرسالة
io.on('connection', (socket) => {
    console.log('مستخدم جديد متصل');
    
    socket.emit('updateUI', {
        connected: isConnected,
        qrCode: qrCode,
        showMessageForm: isConnected
    });

    if (isConnected) {
        socket.emit('connected');
    } else if (qrCode) {
        socket.emit('qr', qrCode);
    }

    socket.on('refreshQR', async () => {
        console.log('طلب تحديث QR code');
        try {
            await client.destroy();
            await fs.unlink(AUTH_FILE_PATH).catch(() => {});
            await deleteFolder(path.join(__dirname, '.wwebjs_auth'));
            await deleteFolder(path.join(__dirname, '.wwebjs_cache'));
            
            qrCode = null;
            isConnected = false;
            
            setTimeout(async () => {
                try {
                    await client.initialize();
                    console.log('تمت إعادة تهيئة العميل');
                } catch (error) {
                    console.error('خطأ في إعادة التهيئة:', error);
                    socket.emit('error', 'فشل في تحديث QR code');
                }
            }, 1000);
        } catch (error) {
            console.error('خطأ في تحديث QR:', error);
            socket.emit('error', 'فشل في تحديث QR code');
        }
    });

    socket.on('sendMessage', async (data) => {
        if (!isConnected) {
            socket.emit('messageSent', 'خطأ: البوت غير متصل');
            return;
        }

        try {
            console.log('بيانات الرسالة المستلمة:', data);
            
            const cleanPhone = data.phone.replace(/[^\d]/g, '');
            const number = data.countryCode + cleanPhone + '@c.us';
            
            console.log('رقم الهاتف المعالج:', number);

            const isRegistered = await client.isRegisteredUser(number);
            console.log('هل الرقم مسجل:', isRegistered);

            if (!isRegistered) {
                throw new Error('الرقم غير مسجل في واتساب');
            }

            const response = await client.sendMessage(number, data.message);
            console.log('تم إرسال الرسالة:', response);

            await messagesRef.add({
                name: data.name,
                phone: number,
                message: data.message,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                messageId: response.id._serialized
            });

            socket.emit('messageSent', 'تم إرسال الرسالة بنجاح!');
        } catch (error) {
            console.error('خطأ في إرسال الرسالة:', error);
            socket.emit('messageSent', `خطأ: ${error.message}`);
        }
    });
});

client.on('qr', async (qr) => {
    console.log('تم إنشاء رمز QR جديد');
    try {
        qrCode = await qrcode.toDataURL(qr, {
            margin: 3,
            scale: 8,
            errorCorrectionLevel: 'H'
        });
        isConnected = false;
    } catch (err) {
        console.error('خطأ في إنشاء QR:', err);
    }
});

client.on('ready', () => {
    console.log('تم الاتصال بنجاح!');
    qrCode = null;
    isConnected = true;
    io.emit('connected', 'تم الاتصال بنجاح!');
    io.emit('updateUI', {
        connected: true,
        qrCode: null,
        showMessageForm: true
    });
});

client.on('authenticated', () => {
    console.log('تم التحقق من الهوية');
    qrCode = null;
    isConnected = true;
    io.emit('authenticated', 'تم التحقق من الهوية بنجاح!');
    io.emit('ready', 'تم الاتصال بنجاح');
    io.emit('updateUI', {
        connected: true,
        qrCode: null,
        showMessageForm: true
    });
});

client.on('disconnected', (reason) => {
    console.log('انقطع الاتصال:', reason);
    qrCode = null;
    isConnected = false;
    io.emit('disconnected');
    io.emit('updateUI', {
        connected: false,
        qrCode: null,
        showMessageForm: false
    });
});

// تهيئة العميل بدء التشغيل
client.initialize()
    .then(() => {
        console.log('تم تهيئة العميل بنجاح');
        isConnected = false;
    })
    .catch(err => {
        console.error('خطأ في التهيئة:', err);
        isConnected = false;
    });

// إضافة مسار جديد لطلب QR code
app.post('/api/request-qr', authenticateToken, async (req, res) => {
    console.log('تم استلام طلب QR جديد');
    
    if (isConnected) {
        console.log('العميل متصل بالفعل');
        return res.json({ status: 'connected' });
    }

    try {
        console.log('بدء عملية إعادة التهيئة...');
        
        // تدمير العميل الحالي
        await client.destroy();
        console.log('تم تدمير العميل القديم');
        
        // حذف ملفات المصادقة
        await Promise.all([
            deleteFolder(path.join(__dirname, '.wwebjs_auth')),
            deleteFolder(path.join(__dirname, '.wwebjs_cache'))
        ]).catch(err => console.error('خطأ في حذف المجلدات:', err));
        
        console.log('تم حذف ملفات المصادقة');
        
        // إعادة تعيين المتغيرات
        qrCode = null;
        isConnected = false;
        
        // إنشاء وعد لانتظار رمز QR
        const qrPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('انتهت مهلة انتظار رمز QR'));
            }, 20000); // زيادة وقت الانتظار إلى 20 ثانية

            client.once('qr', async (qr) => {
                clearTimeout(timeout);
                try {
                    const qrImage = await qrcode.toDataURL(qr, {
                        margin: 3,
                        scale: 8,
                        errorCorrectionLevel: 'H'
                    });
                    resolve(qrImage);
                } catch (err) {
                    reject(err);
                }
            });

            // إضافة مستمع للأخطاء
            client.once('auth_failure', (err) => {
                clearTimeout(timeout);
                reject(new Error('فشل في المصادقة: ' + err.message));
            });
        });

        console.log('بدء تهيئة العميل الجديد...');
        await client.initialize();

        console.log('انتظار رمز QR...');
        const qrResult = await qrPromise;
        
        if (!qrResult) {
            throw new Error('فشل في إنشاء رمز QR');
        }

        console.log('تم إنشاء رمز QR بنجاح');
        res.json({ qrCode: qrResult });
        
    } catch (error) {
        console.error('خطأ في عملية طلب QR:', error);
        
        // محاولة إعادة تهيئة العميل في حالة الفشل
        try {
            await client.initialize();
        } catch (initError) {
            console.error('فشل في إعادة تهيئة العميل:', initError);
        }
        
        res.status(500).json({ 
            error: 'فشل في إنشاء رمز QR',
            details: error.message 
        });
    }
});

// API لحذف مفتاح
app.delete('/api/keys/:key', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const keyDoc = await apiKeysRef.doc(req.params.key).get();
        
        if (!keyDoc.exists) {
            return res.status(404).json({ error: 'المفتاح غير موجود' });
        }

        if (keyDoc.data().userId !== userId) {
            return res.status(403).json({ error: 'غير مصرح لك بحذف هذا المفتاح' });
        }

        await apiKeysRef.doc(req.params.key).delete();
        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في حذف المفتاح:', error);
        res.status(500).json({ error: 'خطأ في حذف المفتاح' });
    }
});

// API لجلب إحصائيات المدير
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            res.status(403).json({ error: 'غير مصرح لك بالوصول' });
            return;
        }

        const usersSnapshot = await admin.firestore().collection('users').get();
        const messagesSnapshot = await admin.firestore().collection('messages').get();
        const apiKeysSnapshot = await admin.firestore().collection('apiKeys').get();
        
        res.json({
            totalUsers: usersSnapshot.size,
            totalMessages: messagesSnapshot.size,
            totalApiKeys: apiKeysSnapshot.size,
            activeConnections: Object.keys(connectedClients).length
        });
    } catch (error) {
        console.error('خطأ في جلب إحصائيات المدير:', error);
        res.status(500).json({ error: 'خطأ في جلب الإحصائيات' });
    }
});

// واجهات برمجية للمسؤولين
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            res.status(403).json({ error: 'غير مصرح لك بالوصول' });
            return;
        }

        const usersSnapshot = await admin.firestore().collection('users').get();
        const messagesSnapshot = await admin.firestore().collection('messages').get();
        const apiKeysSnapshot = await admin.firestore().collection('apiKeys').get();
        
        res.json({
            totalUsers: usersSnapshot.size,
            totalMessages: messagesSnapshot.size,
            totalApiKeys: apiKeysSnapshot.size,
            activeConnections: Object.keys(connectedClients).length
        });
    } catch (error) {
        console.error('خطأ في جلب إحصائيات المسؤول:', error);
        res.status(500).json({ error: 'حدث خطأ في جلب الإحصائيات' });
    }
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            return res.status(403).json({ error: 'غير مصرح لك بالوصول' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const startAfter = (page - 1) * limit;

        // جلب قائمة المستخدمين من Firebase Auth مباشرة
        const listUsersResult = await admin.auth().listUsers(limit, startAfter === 0 ? undefined : startAfter.toString());
        
        const users = await Promise.all(listUsersResult.users.map(async (authUser) => {
            try {
                const userDoc = await admin.firestore().collection('users').doc(authUser.uid).get();
                const userData = userDoc.exists ? userDoc.data() : {};
                
                return {
                    id: authUser.uid,
                    email: authUser.email,
                    createdAt: userData.createdAt?.toDate() || authUser.metadata.creationTime,
                    lastLogin: authUser.metadata.lastSignInTime,
                    ip: userData.lastIp || 'غير معروف',
                    active: !authUser.disabled,
                    isAdmin: authUser.customClaims?.admin || false
                };
            } catch (error) {
                console.error(`خطأ في جلب بيانات المستخدم ${authUser.uid}:`, error);
                return null;
            }
        }));

        // تصفية المستخدمين الفارغين
        const filteredUsers = users.filter(user => user !== null);

        res.json({
            items: filteredUsers,
            total: listUsersResult.pageToken ? -1 : filteredUsers.length, // إذا كان هناك المزيد من النتائج
            hasMore: !!listUsersResult.pageToken
        });
    } catch (error) {
        console.error('خطأ في جلب بيانات المستخدمين:', error);
        res.status(500).json({ 
            error: 'حدث خطأ في جلب بيانات المستخدمين',
            details: error.message 
        });
    }
});

app.get('/api/admin/messages', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            res.status(403).json({ error: 'غير مصرح لك بالوصول' });
            return;
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const startAfter = (page - 1) * limit;

        const messagesSnapshot = await admin.firestore().collection('messages')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .offset(startAfter)
            .get();

        const messages = [];
        for (const doc of messagesSnapshot.docs) {
            const messageData = doc.data();
            let senderEmail = 'غير معروف';
            
            if (messageData.userId) {
                try {
                    const userRecord = await admin.auth().getUser(messageData.userId);
                    senderEmail = userRecord.email;
                } catch (error) {
                    console.error('خطأ في جلب بيانات المرسل:', error);
                }
            }
            
            messages.push({
                id: doc.id,
                sender: senderEmail,
                number: messageData.phone,
                message: messageData.message,
                date: messageData.timestamp?.toDate(),
                status: messageData.status || 'غير معروف'
            });
        }

        const totalMessages = (await admin.firestore().collection('messages').count().get()).data().count;

        res.json({
            items: messages,
            total: totalMessages
        });
    } catch (error) {
        console.error('خطأ في جلب الرسائل:', error);
        res.status(500).json({ error: 'حدث خطأ في جلب الرسائل' });
    }
});

app.get('/api/admin/keys', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            return res.status(403).json({ error: 'غير مصرح لك بالوصول' });
        }

        const keysSnapshot = await admin.firestore().collection('api_keys')
            .orderBy('createdAt', 'desc')
            .get();

        const keys = [];
        for (const doc of keysSnapshot.docs) {
            const keyData = doc.data();
            try {
                const userInfo = await admin.auth().getUser(keyData.userId);
                keys.push({
                    id: doc.id,
                    key: doc.id,
                    user: userInfo.email,
                    createdAt: keyData.createdAt?.toDate(),
                    lastUsed: keyData.lastUsed?.toDate() || null,
                    active: keyData.active || false
                });
            } catch (error) {
                console.error(`خطأ في جلب معلومات المستخدم للمفتاح ${doc.id}:`, error);
            }
        }

        res.json({
            items: keys,
            total: keys.length
        });
    } catch (error) {
        console.error('خطأ في جلب مفاتيح API:', error);
        res.status(500).json({ 
            error: 'حدث خطأ في جلب مفاتيح API',
            details: error.message 
        });
    }
});

app.get('/api/admin/logs', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            return res.status(403).json({ error: 'غير مصرح لك بالوصول' });
        }

        const logsRef = admin.firestore().collection('logs');
        
        // التحقق من وجود سجلات وإضافة سجل افتراضي إذا لم تكن هناك سجلات
        const logsCount = (await logsRef.count().get()).data().count;
        if (logsCount === 0) {
            await logsRef.add({
                type: 'system',
                message: 'بدء تشغيل نظام السجلات',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                userId: req.user.uid,
                ip: req.ip || 'غير معروف',
                details: {
                    action: 'system_start',
                    status: 'success'
                }
            });
        }

        // جلب السجلات مع الترتيب حسب التاريخ
        const logsSnapshot = await logsRef
            .orderBy('timestamp', 'desc')
            .get();

        const logs = await Promise.all(logsSnapshot.docs.map(async (doc) => {
            const logData = doc.data();
            let userData = { email: 'غير معروف' };

            if (logData.userId) {
                try {
                    const userRecord = await admin.auth().getUser(logData.userId);
                    userData = {
                        email: userRecord.email,
                        displayName: userRecord.displayName || userRecord.email
                    };
                } catch (error) {
                    console.error(`خطأ في جلب معلومات المستخدم للسجل ${doc.id}:`, error);
                }
            }

            // تنسيق التاريخ بشكل صحيح
            const timestamp = logData.timestamp?.toDate();
            const formattedDate = timestamp ? new Intl.DateTimeFormat('ar-SA', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            }).format(timestamp) : 'تاريخ غير معروف';

            // تنسيق نوع السجل
            const typeMap = {
                'info': 'معلومات',
                'warning': 'تحذير',
                'error': 'خطأ',
                'system': 'نظام',
                'auth': 'مصادقة',
                'action': 'إجراء'
            };

            // تنسيق عنوان IP
            const formattedIp = logData.ip === '::1' ? 'localhost' : (logData.ip || 'غير معروف');

            return {
                id: doc.id,
                type: typeMap[logData.type] || logData.type || 'معلومات',
                message: logData.message || 'لا توجد رسالة',
                timestamp: timestamp,
                formattedDate: formattedDate,
                user: userData.email,
                ip: formattedIp,
                details: logData.details || {},
                status: logData.status || 'مكتمل'
            };
        }));

        // ترتيب السجلات حسب التاريخ
        logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        console.log(`تم جلب ${logs.length} سجل بنجاح`);

        res.json({
            items: logs,
            total: logs.length,
            metadata: {
                types: [
                    { key: 'info', label: 'معلومات' },
                    { key: 'warning', label: 'تحذير' },
                    { key: 'error', label: 'خطأ' },
                    { key: 'system', label: 'نظام' },
                    { key: 'auth', label: 'مصادقة' },
                    { key: 'action', label: 'إجراء' }
                ],
                lastUpdate: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('خطأ في جلب السجلات:', error);
        res.status(500).json({ 
            error: 'حدث خطأ في جلب السجلات',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// إجراءات المسؤول
app.post('/api/admin/users/:userId/toggle', authenticateToken, async (req, res) => {
    try {
        const customClaims = (await admin.auth().getUser(req.user.uid)).customClaims;
        if (!customClaims || !customClaims.admin) {
            res.status(403).json({ error: 'غير مصرح لك بالوصول' });
            return;
        }

        const userId = req.params.userId;
        const user = await admin.auth().getUser(userId);
        
        await admin.auth().updateUser(userId, {
            disabled: !user.disabled
        });

        // تسجيل الإجراء
        await admin.firestore().collection('logs').add({
            type: 'info',
            message: `تم تغيير حالة المستخدم ${user.email} إلى ${user.disabled ? 'نشط' : 'غير نشط'}`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip
        });

        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في تغيير حالة المستخدم:', error);
        res.status(500).json({ error: 'حدث خطأ في تغيير حالة المستخدم' });
    }
});

app.delete('/api/admin/users/:userId', authenticateToken, async (req, res) => {
    try {
        const customClaims = (await admin.auth().getUser(req.user.uid)).customClaims;
        if (!customClaims || !customClaims.admin) {
            res.status(403).json({ error: 'غير مصرح لك بالوصول' });
            return;
        }

        const userId = req.params.userId;
        const user = await admin.auth().getUser(userId);
        
        // حذف المستخدم من Firebase Auth
        await admin.auth().deleteUser(userId);
        
        // حذف بيانات المستخدم من Firestore
        await admin.firestore().collection('users').doc(userId).delete();
        
        // حذف مفاتيح API الخاصة بالمستخدم
        const apiKeysSnapshot = await admin.firestore().collection('apiKeys')
            .where('userId', '==', userId)
            .get();
        
        const batch = admin.firestore().batch();
        apiKeysSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        // تسجيل الإجراء
        await admin.firestore().collection('logs').add({
            type: 'warning',
            message: `تم حذف المستخدم ${user.email}`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip
        });

        res.json({ success: true });
    } catch (error) {
        console.error('خطأ في حذف المستخدم:', error);
        res.status(500).json({ error: 'حدث خطأ في حذف المستخدم' });
    }
});

app.delete('/api/admin/messages/:messageId', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            return res.status(403).json({ error: 'غير مصرح لك بالوصول' });
        }

        const messageId = req.params.messageId;
        const messageRef = admin.firestore().collection('messages').doc(messageId);
        const message = await messageRef.get();
        
        if (!message.exists) {
            return res.status(404).json({ error: 'الرسالة غير موجودة' });
        }

        const messageData = message.data();
        await messageRef.delete();

        // تسجيل الإجراء
        await admin.firestore().collection('logs').add({
            type: 'warning',
            message: `تم حذف رسالة`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip || 'غير معروف',
            details: {
                action: 'delete_message',
                messageId: messageId,
                phone: messageData.phone,
                status: 'success'
            }
        });

        res.json({ 
            success: true,
            message: 'تم حذف الرسالة بنجاح'
        });
    } catch (error) {
        console.error('خطأ في حذف الرسالة:', error);
        res.status(500).json({ 
            error: 'حدث خطأ في حذف الرسالة',
            details: error.message 
        });
    }
});

app.post('/api/admin/keys/:keyId/toggle', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            return res.status(403).json({ error: 'غير مصرح لك بالوصول' });
        }

        const keyId = req.params.keyId;
        const keyRef = admin.firestore().collection('api_keys').doc(keyId);
        const key = await keyRef.get();
        
        if (!key.exists) {
            return res.status(404).json({ error: 'المفتاح غير موجود' });
        }

        const newStatus = !key.data().active;
        await keyRef.update({
            active: newStatus,
            lastModified: admin.firestore.FieldValue.serverTimestamp()
        });

        // تسجيل الإجراء
        await admin.firestore().collection('logs').add({
            type: 'info',
            message: `تم تغيير حالة مفتاح API إلى ${newStatus ? 'نشط' : 'غير نشط'}`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip || 'غير معروف',
            details: {
                action: 'toggle_api_key',
                keyId: keyId,
                newStatus: newStatus,
                status: 'success'
            }
        });

        res.json({ 
            success: true,
            message: `تم تغيير حالة المفتاح إلى ${newStatus ? 'نشط' : 'غير نشط'}`
        });
    } catch (error) {
        console.error('خطأ في تغيير حالة المفتاح:', error);
        res.status(500).json({ 
            error: 'حدث خطأ في تغيير حالة المفتاح',
            details: error.message 
        });
    }
});

app.delete('/api/admin/keys/:keyId', authenticateToken, async (req, res) => {
    try {
        const user = await admin.auth().getUser(req.user.uid);
        if (user.email !== 'yousefjaser2020@gmail.com' && (!user.customClaims || !user.customClaims.admin)) {
            return res.status(403).json({ error: 'غير مصرح لك بالوصول' });
        }

        const keyId = req.params.keyId;
        const keyRef = admin.firestore().collection('api_keys').doc(keyId);
        const key = await keyRef.get();
        
        if (!key.exists) {
            return res.status(404).json({ error: 'المفتاح غير موجود' });
        }

        await keyRef.delete();

        // تسجيل الإجراء
        await admin.firestore().collection('logs').add({
            type: 'warning',
            message: `تم حذف مفتاح API ${keyId}`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip || 'غير معروف',
            details: {
                action: 'delete_api_key',
                keyId: keyId,
                status: 'success'
            }
        });

        console.log(`تم حذف المفتاح ${keyId} بنجاح`);
        res.json({ 
            success: true,
            message: 'تم حذف المفتاح بنجاح'
        });
    } catch (error) {
        console.error('خطأ في حذف المفتاح:', error);
        
        // تسجيل الخطأ
        await admin.firestore().collection('logs').add({
            type: 'error',
            message: `فشل في حذف مفتاح API ${req.params.keyId}`,
            userId: req.user.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip || 'غير معروف',
            details: {
                action: 'delete_api_key',
                keyId: req.params.keyId,
                error: error.message,
                status: 'failed'
            }
        });

        res.status(500).json({ 
            error: 'حدث خطأ في حذف المفتاح',
            details: error.message 
        });
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`الخادم يعمل على المنفذ ${PORT}`);
});

// الكود الأصلي للـ API
