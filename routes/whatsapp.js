const express = require('express');
const router = express.Router();
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const admin = require('firebase-admin');
const { validateSession } = require('../middleware/auth');

// تخزين الجلسات النشطة في الذاكرة
const activeSessions = new Map();

// إنشاء جلسة جديدة
router.post('/session/create', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.body;
        const userId = req.session.userId;

        // التحقق من ملكية الجهاز
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists || device.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        // التحقق من وجود جلسة محفوظة
        const deviceData = device.data();
        let client;

        if (deviceData.sessionData) {
            // محاولة استعادة الجلسة
            client = new Client({
                session: deviceData.sessionData,
                puppeteer: {
                    args: ['--no-sandbox']
                }
            });
        } else {
            // إنشاء جلسة جديدة
            client = new Client({
                puppeteer: {
                    args: ['--no-sandbox']
                }
            });
        }

        // تعيين معالجات الأحداث
        client.on('qr', async (qrCode) => {
            try {
                const qrDataUrl = await qrcode.toDataURL(qrCode);
                // تحديث حالة الجهاز مع رمز QR
                await deviceRef.update({
                    status: 'pending',
                    qrCode: qrDataUrl,
                    'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                console.error('خطأ في توليد QR:', error);
            }
        });

        client.on('ready', async () => {
            try {
                // حفظ بيانات الجلسة في Firebase
                const sessionData = client.pupPage ? await client.pupPage.evaluate(() => {
                    return localStorage.getItem('WAToken1');
                }) : null;

                await deviceRef.update({
                    status: 'connected',
                    sessionData: sessionData,
                    qrCode: null,
                    lastConnection: admin.firestore.FieldValue.serverTimestamp(),
                    'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                console.error('خطأ في حفظ بيانات الجلسة:', error);
            }
        });

        client.on('disconnected', async () => {
            try {
                await deviceRef.update({
                    status: 'disconnected',
                    qrCode: null,
                    'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                console.error('خطأ في تحديث حالة الانقطاع:', error);
            }
        });

        // تخزين الجلسة في الذاكرة
        activeSessions.set(deviceId, {
            client,
            userId,
            deviceRef
        });

        // بدء تشغيل العميل
        await client.initialize();

        res.json({
            success: true,
            message: 'تم بدء الجلسة بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إنشاء الجلسة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في إنشاء الجلسة'
        });
    }
});

// إغلاق جلسة
router.post('/session/close/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من ملكية الجهاز
        const session = activeSessions.get(deviceId);
        if (!session || session.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بإغلاق هذه الجلسة'
            });
        }

        // حفظ بيانات الجلسة قبل الإغلاق
        const sessionData = session.client.pupPage ? await session.client.pupPage.evaluate(() => {
            return localStorage.getItem('WAToken1');
        }) : null;

        await session.deviceRef.update({
            status: 'disconnected',
            sessionData: sessionData,
            qrCode: null,
            'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
        });

        // إغلاق الجلسة
        await session.client.destroy();
        activeSessions.delete(deviceId);

        res.json({
            success: true,
            message: 'تم إغلاق الجلسة بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إغلاق الجلسة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في إغلاق الجلسة'
        });
    }
});

// الحصول على حالة الجلسة
router.get('/session/status/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists || device.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بالوصول لهذا الجهاز'
            });
        }

        const deviceData = device.data();
        res.json({
            success: true,
            status: deviceData.status,
            qrCode: deviceData.qrCode,
            lastConnection: deviceData.lastConnection
        });

    } catch (error) {
        console.error('خطأ في جلب حالة الجلسة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب حالة الجلسة'
        });
    }
});

module.exports = router; 