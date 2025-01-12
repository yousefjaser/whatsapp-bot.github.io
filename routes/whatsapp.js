const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { validateSession } = require('../middleware/auth');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// تخزين حالات الاتصال للمستخدمين
const clientSessions = new Map();

/**
 * الحصول على حالة الاتصال
 */
router.get('/status', validateSession, async (req, res) => {
    console.log('التحقق من حالة اتصال WhatsApp للمستخدم:', req.user.id);
    
    try {
        const status = await getConnectionStatus(req.user.id);
        return res.json({
            success: true,
            status
        });
    } catch (error) {
        console.error('خطأ في جلب حالة الاتصال:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب حالة الاتصال'
        });
    }
});

/**
 * بدء جلسة جديدة
 */
router.post('/session/start', validateSession, async (req, res) => {
    console.log('بدء جلسة WhatsApp جديدة للمستخدم:', req.user.id);
    
    try {
        // التحقق من عدم وجود جلسة نشطة
        const existingStatus = await getConnectionStatus(req.user.id);
        if (existingStatus.connected) {
            return res.status(400).json({
                success: false,
                error: 'يوجد جلسة نشطة بالفعل'
            });
        }

        // إنشاء عميل جديد
        const client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            }
        });

        // تخزين العميل
        clientSessions.set(req.user.id, {
            client,
            status: 'initializing',
            qrCode: null
        });

        // معالجة الأحداث
        setupClientEvents(client, req.user.id);

        // بدء العميل
        await client.initialize();

        return res.json({
            success: true,
            message: 'تم بدء الجلسة بنجاح'
        });

    } catch (error) {
        console.error('خطأ في بدء الجلسة:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في بدء الجلسة'
        });
    }
});

/**
 * إنهاء الجلسة
 */
router.post('/session/end', validateSession, async (req, res) => {
    console.log('إنهاء جلسة WhatsApp للمستخدم:', req.user.id);
    
    try {
        const session = clientSessions.get(req.user.id);
        if (!session) {
            return res.status(400).json({
                success: false,
                error: 'لا توجد جلسة نشطة'
            });
        }

        // إنهاء العميل
        await session.client.destroy();
        clientSessions.delete(req.user.id);

        return res.json({
            success: true,
            message: 'تم إنهاء الجلسة بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إنهاء الجلسة:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في إنهاء الجلسة'
        });
    }
});

/**
 * الحصول على رمز QR
 */
router.get('/qr', validateSession, async (req, res) => {
    console.log('طلب رمز QR للمستخدم:', req.user.id);
    
    try {
        const session = clientSessions.get(req.user.id);
        if (!session || !session.qrCode) {
            return res.status(400).json({
                success: false,
                error: 'رمز QR غير متوفر'
            });
        }

        // تحويل رمز QR إلى صورة
        const qrImage = await qrcode.toDataURL(session.qrCode);

        return res.json({
            success: true,
            qrCode: qrImage
        });

    } catch (error) {
        console.error('خطأ في جلب رمز QR:', error);
        return res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب رمز QR'
        });
    }
});

/**
 * إعداد أحداث العميل
 */
function setupClientEvents(client, userId) {
    client.on('qr', qr => {
        console.log('تم إنشاء رمز QR جديد للمستخدم:', userId);
        const session = clientSessions.get(userId);
        if (session) {
            session.qrCode = qr;
            session.status = 'qr_ready';
        }
    });

    client.on('ready', () => {
        console.log('WhatsApp جاهز للمستخدم:', userId);
        const session = clientSessions.get(userId);
        if (session) {
            session.status = 'connected';
            session.qrCode = null;
        }
        updateUserStatus(userId, 'connected');
    });

    client.on('authenticated', () => {
        console.log('تم المصادقة للمستخدم:', userId);
        const session = clientSessions.get(userId);
        if (session) {
            session.status = 'authenticated';
        }
    });

    client.on('auth_failure', () => {
        console.error('فشل المصادقة للمستخدم:', userId);
        const session = clientSessions.get(userId);
        if (session) {
            session.status = 'auth_failed';
        }
        updateUserStatus(userId, 'auth_failed');
    });

    client.on('disconnected', () => {
        console.log('تم قطع الاتصال للمستخدم:', userId);
        const session = clientSessions.get(userId);
        if (session) {
            session.status = 'disconnected';
        }
        updateUserStatus(userId, 'disconnected');
        clientSessions.delete(userId);
    });
}

/**
 * الحصول على حالة الاتصال
 */
async function getConnectionStatus(userId) {
    const session = clientSessions.get(userId);
    const status = session ? session.status : 'disconnected';
    
    const userDoc = await admin.firestore()
        .collection('users')
        .doc(userId)
        .get();

    return {
        connected: status === 'connected',
        status,
        lastConnection: userDoc.data()?.lastWhatsAppConnection?.toDate(),
        phoneNumber: userDoc.data()?.whatsappPhone
    };
}

/**
 * تحديث حالة المستخدم
 */
async function updateUserStatus(userId, status) {
    try {
        await admin.firestore()
            .collection('users')
            .doc(userId)
            .update({
                whatsappStatus: status,
                lastWhatsAppConnection: admin.firestore.FieldValue.serverTimestamp()
            });
    } catch (error) {
        console.error('خطأ في تحديث حالة المستخدم:', error);
    }
}

module.exports = router; 