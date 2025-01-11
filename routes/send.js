const express = require('express');
const router = express.Router();
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const authMiddleware = require('../middleware/auth');

// تخزين الجلسات النشطة
const sessions = new Map();

// إعدادات puppeteer
const puppeteerOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080'
    ],
    executablePath: process.env.CHROME_BIN || null,
    headless: 'new'
};

// التحقق من حالة الجلسة
router.get('/session/status/:userId', authMiddleware, async (req, res) => {
    try {
        const userId = req.params.userId;
        const session = sessions.get(userId);
        
        if (!session) {
            return res.json({ status: 'NOT_FOUND', message: 'لم يتم العثور على جلسة' });
        }
        
        return res.json({ 
            status: session.status,
            message: session.status === 'CONNECTED' ? 'متصل' : 'غير متصل'
        });
    } catch (error) {
        console.error('خطأ في التحقق من حالة الجلسة:', error);
        res.status(500).json({ error: 'حدث خطأ في التحقق من حالة الجلسة' });
    }
});

// إنشاء جلسة جديدة
router.post('/session/create', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        
        // التحقق من وجود جلسة نشطة
        if (sessions.has(userId)) {
            const existingSession = sessions.get(userId);
            if (existingSession.status === 'CONNECTED') {
                return res.status(400).json({ error: 'لديك جلسة نشطة بالفعل' });
            }
            // إغلاق الجلسة القديمة إذا كانت موجودة
            await existingSession.client.destroy();
            sessions.delete(userId);
        }

        // إنشاء عميل جديد
        const client = new Client({
            puppeteer: puppeteerOptions,
            qrMaxRetries: 3
        });

        // تخزين معلومات الجلسة
        sessions.set(userId, {
            client,
            status: 'INITIALIZING',
            qr: null
        });

        // معالجة حدث QR
        client.on('qr', async (qr) => {
            try {
                const qrImage = await qrcode.toDataURL(qr);
                const session = sessions.get(userId);
                if (session) {
                    session.qr = qrImage;
                    session.status = 'WAITING_FOR_SCAN';
                }
            } catch (error) {
                console.error('خطأ في إنشاء QR:', error);
            }
        });

        // معالجة حدث الاتصال
        client.on('ready', () => {
            const session = sessions.get(userId);
            if (session) {
                session.status = 'CONNECTED';
                session.qr = null;
            }
        });

        // معالجة حدث قطع الاتصال
        client.on('disconnected', async () => {
            const session = sessions.get(userId);
            if (session) {
                session.status = 'DISCONNECTED';
                await client.destroy();
                sessions.delete(userId);
            }
        });

        // بدء تهيئة العميل
        await client.initialize();

        res.json({ message: 'تم بدء إنشاء الجلسة' });
    } catch (error) {
        console.error('خطأ في إنشاء الجلسة:', error);
        res.status(500).json({ error: 'حدث خطأ في إنشاء الجلسة' });
    }
});

// الحصول على QR code
router.get('/session/qr/:userId', authMiddleware, (req, res) => {
    try {
        const userId = req.params.userId;
        const session = sessions.get(userId);
        
        if (!session || !session.qr) {
            return res.status(404).json({ error: 'لم يتم العثور على QR code' });
        }
        
        res.json({ qr: session.qr });
    } catch (error) {
        console.error('خطأ في جلب QR code:', error);
        res.status(500).json({ error: 'حدث خطأ في جلب QR code' });
    }
});

// إرسال رسالة
router.post('/message', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ error: 'يجب توفير رقم الهاتف والرسالة' });
        }

        const session = sessions.get(userId);
        if (!session || session.status !== 'CONNECTED') {
            return res.status(400).json({ error: 'يجب إنشاء جلسة واتصال أولاً' });
        }

        const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        await session.client.sendMessage(chatId, message);
        
        res.json({ message: 'تم إرسال الرسالة بنجاح' });
    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).json({ error: 'حدث خطأ في إرسال الرسالة' });
    }
});

// إغلاق الجلسة
router.post('/session/close', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.uid;
        const session = sessions.get(userId);
        
        if (session) {
            await session.client.destroy();
            sessions.delete(userId);
            res.json({ message: 'تم إغلاق الجلسة بنجاح' });
        } else {
            res.status(404).json({ error: 'لم يتم العثور على جلسة نشطة' });
        }
    } catch (error) {
        console.error('خطأ في إغلاق الجلسة:', error);
        res.status(500).json({ error: 'حدث خطأ في إغلاق الجلسة' });
    }
});

module.exports = router; 