const express = require('express');
const router = express.Router();
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

// إدارة الجلسات النشطة
const sessions = new Map();

// التحقق من المصادقة
const authMiddleware = require('../middleware/auth');

// تحديد حد الطلبات
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 100, // حد أقصى 100 طلب
    message: { error: 'تم تجاوز حد الطلبات المسموح به. حاول مرة أخرى بعد 15 دقيقة' }
});

// إنشاء جلسة جديدة
router.post('/session/create', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        
        // التحقق من عدم وجود جلسة نشطة
        if (sessions.has(userId)) {
            return res.status(400).json({ error: 'لديك جلسة نشطة بالفعل' });
        }

        // إنشاء مجلد للمستخدم
        const userSessionPath = path.join(__dirname, '../sessions', userId);
        if (!fs.existsSync(userSessionPath)) {
            fs.mkdirSync(userSessionPath, { recursive: true });
        }

        // إنشاء عميل جديد
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: userId }),
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        // معالجة حدث QR code
        client.on('qr', async (qr) => {
            try {
                const qrCode = await qrcode.toDataURL(qr);
                sessions.get(userId).qr = qrCode;
            } catch (error) {
                console.error('خطأ في إنشاء QR code:', error);
            }
        });

        // معالجة حدث الجاهزية
        client.on('ready', () => {
            sessions.get(userId).status = 'ready';
            console.log(`جلسة المستخدم ${userId} جاهزة`);
        });

        // معالجة حدث الاتصال
        client.on('authenticated', () => {
            sessions.get(userId).status = 'authenticated';
            console.log(`تم مصادقة المستخدم ${userId}`);
        });

        // معالجة حدث قطع الاتصال
        client.on('disconnected', () => {
            sessions.get(userId).status = 'disconnected';
            console.log(`تم قطع اتصال المستخدم ${userId}`);
        });

        // تخزين معلومات الجلسة
        sessions.set(userId, {
            client,
            status: 'initializing',
            qr: null,
            created: new Date()
        });

        // بدء العميل
        await client.initialize();

        res.json({ message: 'تم إنشاء الجلسة بنجاح' });
    } catch (error) {
        console.error('خطأ في إنشاء الجلسة:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إنشاء الجلسة' });
    }
});

// إرسال رسالة نصية
router.post('/message/send', [authMiddleware, apiLimiter], async (req, res) => {
    try {
        const { phone, message } = req.body;
        const userId = req.user.uid;

        if (!phone || !message) {
            return res.status(400).json({ error: 'رقم الهاتف والرسالة مطلوبان' });
        }

        const session = sessions.get(userId);
        if (!session || session.status !== 'ready') {
            return res.status(400).json({ error: 'لا توجد جلسة نشطة' });
        }

        // تنسيق رقم الهاتف
        const formattedPhone = phone.replace(/\D/g, '');
        const chatId = `${formattedPhone}@c.us`;

        // إرسال الرسالة
        const response = await session.client.sendMessage(chatId, message);
        
        res.json({
            message: 'تم إرسال الرسالة بنجاح',
            messageId: response.id._serialized
        });
    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إرسال الرسالة' });
    }
});

// إرسال صورة
router.post('/message/send-media', [authMiddleware, apiLimiter], async (req, res) => {
    try {
        const { phone, mediaUrl, caption } = req.body;
        const userId = req.user.uid;

        if (!phone || !mediaUrl) {
            return res.status(400).json({ error: 'رقم الهاتف ورابط الوسائط مطلوبان' });
        }

        const session = sessions.get(userId);
        if (!session || session.status !== 'ready') {
            return res.status(400).json({ error: 'لا توجد جلسة نشطة' });
        }

        // تحميل الوسائط
        const media = await MessageMedia.fromUrl(mediaUrl);
        
        // تنسيق رقم الهاتف
        const formattedPhone = phone.replace(/\D/g, '');
        const chatId = `${formattedPhone}@c.us`;

        // إرسال الوسائط
        const response = await session.client.sendMessage(chatId, media, { caption });
        
        res.json({
            message: 'تم إرسال الوسائط بنجاح',
            messageId: response.id._serialized
        });
    } catch (error) {
        console.error('خطأ في إرسال الوسائط:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إرسال الوسائط' });
    }
});

// إرسال موقع
router.post('/message/send-location', [authMiddleware, apiLimiter], async (req, res) => {
    try {
        const { phone, latitude, longitude, description } = req.body;
        const userId = req.user.uid;

        if (!phone || !latitude || !longitude) {
            return res.status(400).json({ error: 'رقم الهاتف والإحداثيات مطلوبة' });
        }

        const session = sessions.get(userId);
        if (!session || session.status !== 'ready') {
            return res.status(400).json({ error: 'لا توجد جلسة نشطة' });
        }

        // تنسيق رقم الهاتف
        const formattedPhone = phone.replace(/\D/g, '');
        const chatId = `${formattedPhone}@c.us`;

        // إرسال الموقع
        const response = await session.client.sendMessage(chatId, {
            location: { latitude, longitude, description }
        });
        
        res.json({
            message: 'تم إرسال الموقع بنجاح',
            messageId: response.id._serialized
        });
    } catch (error) {
        console.error('خطأ في إرسال الموقع:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إرسال الموقع' });
    }
});

// الحصول على حالة الرسالة
router.get('/message/status/:messageId', authMiddleware, async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user.uid;

        const session = sessions.get(userId);
        if (!session || session.status !== 'ready') {
            return res.status(400).json({ error: 'لا توجد جلسة نشطة' });
        }

        const message = await session.client.getMessageById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'الرسالة غير موجودة' });
        }

        res.json({
            status: message.ack,
            timestamp: message.timestamp
        });
    } catch (error) {
        console.error('خطأ في جلب حالة الرسالة:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب حالة الرسالة' });
    }
});

// إغلاق الجلسة
router.post('/session/close', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const session = sessions.get(userId);

        if (!session) {
            return res.status(400).json({ error: 'لا توجد جلسة نشطة' });
        }

        await session.client.destroy();
        sessions.delete(userId);

        res.json({ message: 'تم إغلاق الجلسة بنجاح' });
    } catch (error) {
        console.error('خطأ في إغلاق الجلسة:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إغلاق الجلسة' });
    }
});

// الحصول على حالة الجلسة
router.get('/session/status', authMiddleware, (req, res) => {
    try {
        const userId = req.user.uid;
        const session = sessions.get(userId);

        if (!session) {
            return res.json({ status: 'disconnected' });
        }

        res.json({
            status: session.status,
            qr: session.qr,
            created: session.created
        });
    } catch (error) {
        console.error('خطأ في جلب حالة الجلسة:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب حالة الجلسة' });
    }
});

module.exports = router; 