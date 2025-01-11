const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');
const db = admin.firestore();
const devicesRef = db.collection('devices');

class DeviceManager {
    constructor() {
        this.devices = new Map();
        this.io = null;
    }

    setEventEmitter(io) {
        this.io = io;
    }

    // دالة لتنظيف الجلسات القديمة
    async cleanOldSessions(deviceId) {
        try {
            const sessionPath = path.join(process.cwd(), '.wwebjs_auth', `session-${deviceId}`);
            await fs.rm(sessionPath, { recursive: true, force: true });
            console.log(`تم تنظيف الجلسة القديمة للجهاز ${deviceId}`);
        } catch (error) {
            console.error(`خطأ في تنظيف الجلسة القديمة للجهاز ${deviceId}:`, error);
        }
    }

    async initializeDevices(userId) {
        try {
            const snapshot = await devicesRef.where('userId', '==', userId).get();
            for (const doc of snapshot.docs) {
                await this.initializeDevice(doc.id, doc.data());
            }
        } catch (error) {
            console.error('خطأ في تهيئة الأجهزة:', error);
        }
    }

    async initializeDevice(deviceId, deviceData) {
        try {
            // تنظيف الجلسة القديمة قبل البدء
            await this.cleanOldSessions(deviceId);

            // إعدادات Puppeteer المحسنة
            const clientOptions = {
                puppeteer: {
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--disable-gpu',
                        '--disable-extensions',
                        '--disable-software-rasterizer',
                        '--ignore-certificate-errors',
                        '--window-size=1280,720',
                        '--disable-web-security',
                        '--allow-running-insecure-content',
                        '--disable-features=IsolateOrigins,site-per-process'
                    ],
                    headless: 'new',
                    defaultViewport: {
                        width: 1280,
                        height: 720
                    },
                    timeout: 60000,
                    executablePath: process.env.CHROME_BIN || undefined,
                    userDataDir: path.join(process.cwd(), '.wwebjs_auth', `session-${deviceId}`),
                    ignoreDefaultArgs: ['--enable-automation']
                },
                authStrategy: new (require('whatsapp-web.js')).LocalAuth({
                    clientId: deviceId,
                    dataPath: path.join(process.cwd(), '.wwebjs_auth')
                })
            };

            const client = new Client(clientOptions);

            client.on('qr', async (qr) => {
                try {
                    console.log(`جاري إنشاء QR للجهاز ${deviceId}`);
                    const qrDataUrl = await qrcode.toDataURL(qr);
                    
                    // إرسال QR للعميل
                    this.io?.emit(`qr_${deviceId}`, qrDataUrl);
                    this.io?.emit('qr', deviceId, qrDataUrl);
                    
                    // تحديث حالة الجهاز في قاعدة البيانات
                    await devicesRef.doc(deviceId).update({
                        qrCode: qrDataUrl,
                        status: 'pending',
                        lastQRUpdate: admin.firestore.FieldValue.serverTimestamp()
                    });
                } catch (error) {
                    console.error('خطأ في إنشاء QR:', error);
                    this.io?.emit('error', 'فشل في إنشاء رمز QR');
                }
            });

            client.on('ready', async () => {
                try {
                    console.log(`الجهاز ${deviceId} جاهز`);
                    this.io?.emit(`status_${deviceId}`, 'connected');
                    this.io?.emit('deviceConnected', deviceId);
                    
                    await devicesRef.doc(deviceId).update({
                        status: 'connected',
                        qrCode: null,
                        lastConnection: admin.firestore.FieldValue.serverTimestamp()
                    });
                } catch (error) {
                    console.error('خطأ في تحديث حالة الجهاز:', error);
                }
            });

            client.on('disconnected', async (reason) => {
                try {
                    console.log(`الجهاز ${deviceId} غير متصل:`, reason);
                    this.io?.emit(`status_${deviceId}`, 'disconnected');
                    
                    await devicesRef.doc(deviceId).update({
                        status: 'disconnected',
                        qrCode: null,
                        lastDisconnection: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // تنظيف الجلسة عند قطع الاتصال
                    await this.cleanOldSessions(deviceId);
                    this.devices.delete(deviceId);
                } catch (error) {
                    console.error('خطأ في تحديث حالة الجهاز:', error);
                }
            });

            console.log(`بدء تهيئة الجهاز ${deviceId}`);
            await client.initialize();
            this.devices.set(deviceId, client);
            return client;
        } catch (error) {
            console.error(`خطأ في تهيئة الجهاز ${deviceId}:`, error);
            this.io?.emit('error', 'فشل في تهيئة الجهاز');
            
            // تنظيف الجلسة في حالة الفشل
            await this.cleanOldSessions(deviceId);
            throw new Error('فشل في تهيئة الجهاز');
        }
    }

    async createDevice(userId, name) {
        try {
            // إنشاء وثيقة جديدة في Firestore
            const deviceRef = await devicesRef.add({
                userId,
                name,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const deviceId = deviceRef.id;
            const deviceData = { userId, name };

            // تهيئة العميل
            await this.initializeDevice(deviceId, deviceData);

            return {
                id: deviceId,
                ...deviceData,
                status: 'pending'
            };
        } catch (error) {
            console.error('خطأ في إنشاء الجهاز:', error);
            throw error;
        }
    }

    async getDevices(userId) {
        try {
            const snapshot = await devicesRef.where('userId', '==', userId).get();
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('خطأ في جلب الأجهزة:', error);
            throw error;
        }
    }

    async disconnectDevice(deviceId) {
        try {
            const client = this.devices.get(deviceId);
            if (client) {
                await client.destroy();
                this.devices.delete(deviceId);
            }

            // تنظيف الجلسة عند قطع الاتصال
            await this.cleanOldSessions(deviceId);

            await devicesRef.doc(deviceId).update({
                status: 'disconnected',
                qrCode: null,
                lastDisconnection: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('خطأ في قطع اتصال الجهاز:', error);
            throw error;
        }
    }

    async sendMessage(deviceId, phone, message) {
        try {
            const client = this.devices.get(deviceId);
            if (!client) {
                throw new Error('الجهاز غير متصل');
            }

            // التحقق من وجود الرقم على واتساب
            const isRegistered = await client.isRegisteredUser(phone);
            if (!isRegistered) {
                throw new Error('الرقم غير مسجل في واتساب');
            }

            // إرسال الرسالة
            const response = await client.sendMessage(`${phone}@c.us`, message);
            return response;
        } catch (error) {
            console.error('خطأ في إرسال الرسالة:', error);
            throw error;
        }
    }
}

module.exports = new DeviceManager(); 