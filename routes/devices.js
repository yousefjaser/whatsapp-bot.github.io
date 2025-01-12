const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { validateSession } = require('../middleware/auth');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// تخزين مؤقت لرموز QR
const qrCodes = new Map();

// تخزين مؤقت للعملاء
const clients = new Map();

// تخزين مؤقت لمعلومات البروفايل
const profileInfo = new Map();

// دالة مساعدة لمعالجة الأخطاء
async function handleDeviceError(deviceRef, error) {
    try {
        await deviceRef.update({
            status: 'error',
            'metadata.lastError': error.message || 'خطأ غير معروف',
            'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        console.error('خطأ في تحديث حالة الخطأ:', err);
    }
}

// إضافة جهاز جديد
router.post('/add', validateSession, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'يجب توفير اسم صحيح للجهاز'
            });
        }

        const userId = req.session.userId;
        
        // التحقق من عدد الأجهزة النشطة للمستخدم
        const activeDevices = await admin.firestore()
            .collection('devices')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get();

        if (activeDevices.size >= 5) {
            return res.status(400).json({
                success: false,
                error: 'لا يمكن إضافة أكثر من 5 أجهزة نشطة'
            });
        }

        // إنشاء وثيقة جديدة في مجموعة الأجهزة
        const deviceRef = await admin.firestore().collection('devices').add({
            name: name.trim(),
            userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'initializing',
            lastConnection: null,
            isActive: true,
            sessionData: null,
            metadata: {
                browser: req.headers['user-agent'],
                ip: req.ip,
                lastUpdate: admin.firestore.FieldValue.serverTimestamp()
            }
        });

        // إعدادات Puppeteer المحسنة
        const client = new Client({
            puppeteer: {
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--window-size=1280,720',
                    '--disable-web-security',
                    '--allow-running-insecure-content'
                ],
                defaultViewport: {
                    width: 1280,
                    height: 720
                },
                timeout: 120000,
                executablePath: process.env.CHROME_BIN || undefined
            },
            qrMaxRetries: 10,
            authTimeoutMs: 120000,
            restartOnAuthFail: true
        });

        // تخزين العميل في الذاكرة المؤقتة
        clients.set(deviceRef.id, client);

        // الاستماع لحدث QR
        client.on('qr', async (qr) => {
            try {
                console.log('تم استلام رمز QR جديد للجهاز:', deviceRef.id);
                
                // تحويل نص QR إلى صورة base64
                const qrImage = await qrcode.toDataURL(qr);
                
                // تخزين رمز QR في الذاكرة المؤقتة
                qrCodes.set(deviceRef.id, qrImage);
                
                // تحديث حالة الجهاز
                await deviceRef.update({
                    status: 'awaiting_scan',
                    'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp(),
                    'metadata.qrRetries': admin.firestore.FieldValue.increment(1)
                });
            } catch (error) {
                console.error('خطأ في إنشاء رمز QR للجهاز:', deviceRef.id, error);
                await handleDeviceError(deviceRef, error);
            }
        });

        // الاستماع لحدث الخطأ
        client.on('auth_failure', async (error) => {
            console.error('فشل المصادقة للجهاز:', deviceRef.id, error);
            await handleDeviceError(deviceRef, error);
        });

        // الاستماع لحدث قطع الاتصال
        client.on('disconnected', async (reason) => {
            console.log('تم قطع الاتصال للجهاز:', deviceRef.id, reason);
            try {
                await deviceRef.update({
                    status: 'disconnected',
                    'metadata.lastError': reason,
                    'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
                });
                
                // إزالة رمز QR والعميل من الذاكرة
                qrCodes.delete(deviceRef.id);
                const oldClient = clients.get(deviceRef.id);
                if (oldClient) {
                    await oldClient.destroy();
                    clients.delete(deviceRef.id);
                }
            } catch (error) {
                console.error('خطأ في معالجة قطع الاتصال:', error);
            }
        });

        // الاستماع لحدث الاتصال
        client.on('ready', async () => {
            try {
                console.log('تم الاتصال بنجاح للجهاز:', deviceRef.id);
                
                // تحديث حالة الجهاز
                await deviceRef.update({
                    status: 'connected',
                    lastConnection: admin.firestore.FieldValue.serverTimestamp(),
                    'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp(),
                    'metadata.connectedAt': admin.firestore.FieldValue.serverTimestamp()
                });

                // إزالة رمز QR من الذاكرة المؤقتة
                qrCodes.delete(deviceRef.id);

            } catch (error) {
                console.error('خطأ في تحديث حالة الاتصال:', error);
                await handleDeviceError(deviceRef, error);
            }
        });

        // الاستماع لحدث المصادقة
        client.on('authenticated', async () => {
            try {
                console.log('تم المصادقة بنجاح للجهاز:', deviceRef.id);
                
                // الحصول على معلومات البروفايل
                const info = await client.getWid();
                const phoneNumber = info.user;
                const profilePic = await client.getProfilePicUrl(info._serialized);
                
                // حفظ معلومات البروفايل
                const profileData = {
                    phoneNumber,
                    profilePic,
                    timestamp: new Date()
                };
                profileInfo.set(deviceRef.id, profileData);

                // تحديث حالة الجهاز
                await deviceRef.update({
                    status: 'authenticated',
                    phoneNumber,
                    profilePic,
                    'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp(),
                    'metadata.authenticatedAt': admin.firestore.FieldValue.serverTimestamp()
                });

            } catch (error) {
                console.error('خطأ في حفظ معلومات البروفايل:', error);
                await handleDeviceError(deviceRef, error);
            }
        });

        // محاولة بدء العميل
        try {
            console.log('بدء تهيئة العميل للجهاز:', deviceRef.id);
            await client.initialize();
            
            res.json({
                success: true,
                deviceId: deviceRef.id,
                message: 'تم إضافة الجهاز بنجاح'
            });
        } catch (error) {
            console.error('خطأ في تهيئة العميل:', error);
            await handleDeviceError(deviceRef, error);
            
            res.status(500).json({
                success: false,
                error: 'حدث خطأ في تهيئة الجهاز'
            });
        }

    } catch (error) {
        console.error('خطأ في إضافة جهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في إضافة الجهاز'
        });
    }
});

// الحصول على رمز QR
router.get('/qr/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
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

        // الحصول على رمز QR من التخزين المؤقت
        const qrCode = qrCodes.get(deviceId);
        
        if (!qrCode) {
            return res.status(404).json({
                success: false,
                error: 'رمز QR غير متوفر حالياً'
            });
        }

        res.json({
            success: true,
            qrCode
        });

    } catch (error) {
        console.error('خطأ في جلب رمز QR:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب رمز QR'
        });
    }
});

// تحديث حالة الجهاز وبيانات الجلسة
router.post('/update-session/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { sessionData, status } = req.body;
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

        // تحديث بيانات الجهاز
        await deviceRef.update({
            sessionData: sessionData || admin.firestore.FieldValue.delete(),
            status: status || 'disconnected',
            lastConnection: status === 'connected' ? admin.firestore.FieldValue.serverTimestamp() : null,
            'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'تم تحديث حالة الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في تحديث حالة الجهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في تحديث حالة الجهاز'
        });
    }
});

// حذف جهاز
router.delete('/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
        const userId = req.session.userId;

        // التحقق من ملكية الجهاز
        const deviceRef = admin.firestore().collection('devices').doc(deviceId);
        const device = await deviceRef.get();

        if (!device.exists || device.data().userId !== userId) {
            return res.status(403).json({
                success: false,
                error: 'غير مصرح بحذف هذا الجهاز'
            });
        }

        // تحديث الجهاز كغير نشط بدلاً من حذفه
        await deviceRef.update({
            isActive: false,
            status: 'disconnected',
            sessionData: admin.firestore.FieldValue.delete(),
            'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp(),
            'metadata.deletedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'تم حذف الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في حذف الجهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في حذف الجهاز'
        });
    }
});

// الحصول على قائمة الأجهزة النشطة
router.get('/', validateSession, async (req, res) => {
    try {
        const userId = req.session.userId;

        // تعديل الاستعلام لتجنب الحاجة إلى فهرس مركب
        const devicesSnapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get();

        const devices = [];
        devicesSnapshot.forEach(doc => {
            const device = doc.data();
            devices.push({
                id: doc.id,
                name: device.name,
                status: device.status,
                lastConnection: device.lastConnection,
                connected: device.status === 'connected',
                sessionData: device.sessionData
            });
        });

        // ترتيب النتائج بعد استرجاعها
        devices.sort((a, b) => {
            const dateA = a.lastConnection ? new Date(a.lastConnection.seconds * 1000) : new Date(0);
            const dateB = b.lastConnection ? new Date(b.lastConnection.seconds * 1000) : new Date(0);
            return dateB - dateA;
        });

        res.json({
            success: true,
            devices
        });

    } catch (error) {
        console.error('خطأ في جلب قائمة الأجهزة:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب قائمة الأجهزة'
        });
    }
});

// استعادة جلسة جهاز
router.get('/session/:deviceId', validateSession, async (req, res) => {
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
        
        if (!deviceData.sessionData) {
            return res.status(404).json({
                success: false,
                error: 'لا توجد جلسة محفوظة لهذا الجهاز'
            });
        }

        res.json({
            success: true,
            sessionData: deviceData.sessionData
        });

    } catch (error) {
        console.error('خطأ في استعادة جلسة الجهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في استعادة جلسة الجهاز'
        });
    }
});

// فصل جهاز
router.post('/:deviceId/disconnect', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
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

        // الحصول على العميل من الذاكرة المؤقتة
        const client = clients.get(deviceId);
        if (client) {
            try {
                await client.destroy();
            } catch (error) {
                console.error('خطأ في تدمير العميل:', error);
            }
            clients.delete(deviceId);
        }

        // تحديث حالة الجهاز في Firestore
        await deviceRef.update({
            status: 'disconnected',
            sessionData: admin.firestore.FieldValue.delete(),
            lastConnection: admin.firestore.FieldValue.serverTimestamp(),
            'metadata.lastUpdate': admin.firestore.FieldValue.serverTimestamp(),
            'metadata.disconnectedAt': admin.firestore.FieldValue.serverTimestamp()
        });

        // إزالة رمز QR من الذاكرة المؤقتة
        qrCodes.delete(deviceId);

        res.json({
            success: true,
            message: 'تم فصل الجهاز بنجاح'
        });

    } catch (error) {
        console.error('خطأ في فصل الجهاز:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في فصل الجهاز'
        });
    }
});

// الحصول على معلومات البروفايل
router.get('/profile/:deviceId', validateSession, async (req, res) => {
    try {
        const { deviceId } = req.params;
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

        const deviceData = device.data();
        const profile = profileInfo.get(deviceId);

        if (!profile && deviceData.status !== 'authenticated') {
            return res.status(404).json({
                success: false,
                error: 'معلومات البروفايل غير متوفرة'
            });
        }

        res.json({
            success: true,
            profile: profile || {
                phoneNumber: deviceData.phoneNumber,
                profilePic: deviceData.profilePic,
                status: deviceData.status
            }
        });

    } catch (error) {
        console.error('خطأ في جلب معلومات البروفايل:', error);
        res.status(500).json({
            success: false,
            error: 'حدث خطأ في جلب معلومات البروفايل'
        });
    }
});

module.exports = router; 