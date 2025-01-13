const express = require('express');
const router = express.Router();
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const logger = require('../utils/logger');
const firebase = require('../utils/firebase');

// تخزين جلسات WhatsApp
const clientSessions = new Map();

// الحصول على حالة الاتصال
router.get('/status/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من وجود الجهاز
        const device = await firebase.getDevice(deviceId);
        if (!device) {
            return res.json({ success: false, error: 'الجهاز غير موجود' });
        }

        // التحقق من ملكية الجهاز
        if (device.userId !== userId) {
            return res.json({ success: false, error: 'غير مصرح بالوصول لهذا الجهاز' });
        }

        // الحصول على حالة الجلسة
        const session = clientSessions.get(deviceId);
        if (!session) {
            return res.json({ 
                success: true, 
                status: 'disconnected',
                message: 'الجهاز غير متصل'
            });
        }

        // إرجاع الحالة مع رمز QR إذا كان متوفراً
        return res.json({
            success: true,
            status: session.status,
            message: session.message,
            qr: session.qr
        });

    } catch (error) {
        logger.error('خطأ في الحصول على حالة الجهاز:', error);
        return res.json({ success: false, error: 'حدث خطأ في الحصول على حالة الجهاز' });
    }
});

// بدء جلسة جديدة
router.post('/session/start/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من وجود الجهاز
        const device = await firebase.getDevice(deviceId);
        if (!device) {
            return res.json({ success: false, error: 'الجهاز غير موجود' });
        }

        // التحقق من ملكية الجهاز
        if (device.userId !== userId) {
            return res.json({ success: false, error: 'غير مصرح بالوصول لهذا الجهاز' });
        }

        // إنهاء الجلسة القديمة إذا وجدت
        const existingSession = clientSessions.get(deviceId);
        if (existingSession) {
            logger.info(`إنهاء الجلسة القديمة للجهاز ${deviceId}`);
            await existingSession.client.destroy();
            clientSessions.delete(deviceId);
        }

        // إنشاء عميل جديد
        const client = new Client({
            puppeteer: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            }
        });

        // تهيئة الجلسة
        const session = {
            client,
            status: 'initializing',
            message: 'جاري تهيئة الجلسة...',
            qr: null
        };

        // إعداد معالجات الأحداث
        setupClientEvents(client, deviceId, userId, session);

        // حفظ الجلسة
        clientSessions.set(deviceId, session);

        // بدء تشغيل العميل
        await client.initialize();

        return res.json({ success: true });

    } catch (error) {
        logger.error('خطأ في بدء الجلسة:', error);
        return res.json({ success: false, error: 'حدث خطأ في بدء الجلسة' });
    }
});

// إنهاء الجلسة
router.post('/session/end/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من وجود الجهاز
        const device = await firebase.getDevice(deviceId);
        if (!device) {
            return res.json({ success: false, error: 'الجهاز غير موجود' });
        }

        // التحقق من ملكية الجهاز
        if (device.userId !== userId) {
            return res.json({ success: false, error: 'غير مصرح بالوصول لهذا الجهاز' });
        }

        // إنهاء الجلسة إذا وجدت
        const session = clientSessions.get(deviceId);
        if (session) {
            await session.client.destroy();
            clientSessions.delete(deviceId);
            
            // تحديث حالة الجهاز في قاعدة البيانات
            await firebase.updateDeviceStatus(deviceId, 'disconnected');
            
            logger.info(`تم إنهاء الجلسة للجهاز ${deviceId}`);
        }

        return res.json({ success: true });

    } catch (error) {
        logger.error('خطأ في إنهاء الجلسة:', error);
        return res.json({ success: false, error: 'حدث خطأ في إنهاء الجلسة' });
    }
});

// إعداد معالجات الأحداث للعميل
function setupClientEvents(client, deviceId, userId, session) {
    // عند إنشاء رمز QR
    client.on('qr', async (qr) => {
        try {
            // تحويل رمز QR إلى صورة
            const qrImage = await qrcode.toDataURL(qr);
            
            // تحديث حالة الجلسة
            session.status = 'qr_ready';
            session.message = 'جاري انتظار مسح رمز QR...';
            session.qr = qrImage;

            // تحديث حالة الجهاز في قاعدة البيانات
            await firebase.updateDeviceStatus(deviceId, 'qr_ready');
            
            logger.info(`تم إنشاء رمز QR جديد للجهاز ${deviceId}`);
        } catch (error) {
            logger.error('خطأ في معالجة رمز QR:', error);
        }
    });

    // عند جاهزية العميل
    client.on('ready', async () => {
        try {
            // تحديث حالة الجلسة
            session.status = 'connected';
            session.message = 'تم الاتصال بنجاح';
            session.qr = null;

            // تحديث حالة الجهاز في قاعدة البيانات
            await firebase.updateDeviceStatus(deviceId, 'connected');
            
            logger.info(`تم اتصال الجهاز ${deviceId} بنجاح`);
        } catch (error) {
            logger.error('خطأ في معالجة حدث الجاهزية:', error);
        }
    });

    // عند نجاح المصادقة
    client.on('authenticated', async () => {
        try {
            // تحديث حالة الجلسة
            session.status = 'authenticated';
            session.message = 'تم المصادقة بنجاح';
            session.qr = null;

            // تحديث حالة الجهاز في قاعدة البيانات
            await firebase.updateDeviceStatus(deviceId, 'authenticated');
            
            logger.info(`تم مصادقة الجهاز ${deviceId} بنجاح`);
        } catch (error) {
            logger.error('خطأ في معالجة حدث المصادقة:', error);
        }
    });

    // عند فشل المصادقة
    client.on('auth_failure', async (msg) => {
        try {
            // تحديث حالة الجلسة
            session.status = 'error';
            session.message = 'فشل في المصادقة: ' + msg;
            session.qr = null;

            // تحديث حالة الجهاز في قاعدة البيانات
            await firebase.updateDeviceStatus(deviceId, 'error');
            
            logger.error(`فشل في مصادقة الجهاز ${deviceId}: ${msg}`);
        } catch (error) {
            logger.error('خطأ في معالجة فشل المصادقة:', error);
        }
    });

    // عند قطع الاتصال
    client.on('disconnected', async (reason) => {
        try {
            // تحديث حالة الجلسة
            session.status = 'disconnected';
            session.message = 'تم قطع الاتصال: ' + reason;
            session.qr = null;

            // تحديث حالة الجهاز في قاعدة البيانات
            await firebase.updateDeviceStatus(deviceId, 'disconnected');
            
            // إزالة الجلسة
            clientSessions.delete(deviceId);
            
            logger.info(`تم قطع اتصال الجهاز ${deviceId}: ${reason}`);
        } catch (error) {
            logger.error('خطأ في معالجة قطع الاتصال:', error);
        }
    });
}

module.exports = router; 