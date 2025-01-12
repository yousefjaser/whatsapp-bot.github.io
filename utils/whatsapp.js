const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const logger = require('./logger');

// تخزين جلسات WhatsApp
const sessions = new Map();

/**
 * إنشاء عميل WhatsApp جديد
 * @param {string} userId - معرف المستخدم
 * @param {string} deviceId - معرف الجهاز
 * @returns {Promise<Client>}
 */
async function createClient(userId, deviceId) {
    try {
        // التحقق من وجود جلسة نشطة
        const existingSession = sessions.get(deviceId);
        if (existingSession) {
            return existingSession.client;
        }

        // إنشاء عميل جديد
        const client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            }
        });

        // تخزين معلومات الجلسة
        sessions.set(deviceId, {
            client,
            userId,
            status: 'initializing',
            qr: null,
            lastActive: new Date()
        });

        // تسجيل الحدث
        await logger.device('تم إنشاء عميل WhatsApp جديد', { deviceId }, userId);

        return client;

    } catch (error) {
        console.error('خطأ في إنشاء عميل WhatsApp:', error);
        throw error;
    }
}

/**
 * الحصول على حالة الاتصال
 * @param {string} deviceId - معرف الجهاز
 * @returns {Object} حالة الاتصال
 */
function getConnectionStatus(deviceId) {
    const session = sessions.get(deviceId);
    if (!session) {
        return {
            connected: false,
            status: 'disconnected'
        };
    }

    return {
        connected: session.status === 'connected',
        status: session.status,
        qr: session.qr,
        lastActive: session.lastActive
    };
}

/**
 * إعداد أحداث العميل
 * @param {Client} client - عميل WhatsApp
 * @param {string} deviceId - معرف الجهاز
 * @param {string} userId - معرف المستخدم
 */
function setupClientEvents(client, deviceId, userId) {
    // عند إنشاء رمز QR
    client.on('qr', async (qr) => {
        try {
            // تحويل رمز QR إلى صورة
            const qrImage = await qrcode.toDataURL(qr);
            
            // تحديث معلومات الجلسة
            const session = sessions.get(deviceId);
            if (session) {
                session.status = 'qr_ready';
                session.qr = qrImage;
                session.lastActive = new Date();
            }

            // تسجيل الحدث
            await logger.device('تم إنشاء رمز QR جديد', { deviceId }, userId);

        } catch (error) {
            console.error('خطأ في معالجة رمز QR:', error);
        }
    });

    // عند جاهزية العميل
    client.on('ready', async () => {
        try {
            // تحديث معلومات الجلسة
            const session = sessions.get(deviceId);
            if (session) {
                session.status = 'connected';
                session.qr = null;
                session.lastActive = new Date();
            }

            // تسجيل الحدث
            await logger.device('تم الاتصال بنجاح', { deviceId }, userId);

        } catch (error) {
            console.error('خطأ في معالجة حدث الجاهزية:', error);
        }
    });

    // عند قطع الاتصال
    client.on('disconnected', async (reason) => {
        try {
            // تحديث معلومات الجلسة
            const session = sessions.get(deviceId);
            if (session) {
                session.status = 'disconnected';
                session.qr = null;
                session.lastActive = new Date();
            }

            // تسجيل الحدث
            await logger.device('تم قطع الاتصال', { deviceId, reason }, userId);

        } catch (error) {
            console.error('خطأ في معالجة قطع الاتصال:', error);
        }
    });

    // عند حدوث خطأ
    client.on('auth_failure', async (error) => {
        try {
            // تحديث معلومات الجلسة
            const session = sessions.get(deviceId);
            if (session) {
                session.status = 'auth_failure';
                session.qr = null;
                session.lastActive = new Date();
            }

            // تسجيل الحدث
            await logger.error('فشل المصادقة مع WhatsApp', { deviceId, error }, userId);

        } catch (error) {
            console.error('خطأ في معالجة فشل المصادقة:', error);
        }
    });
}

/**
 * إرسال رسالة
 * @param {string} deviceId - معرف الجهاز
 * @param {string} to - رقم المستلم
 * @param {string} content - محتوى الرسالة
 * @param {string} type - نوع الرسالة
 * @returns {Promise<Object>}
 */
async function sendMessage(deviceId, to, content, type = 'text') {
    try {
        const session = sessions.get(deviceId);
        if (!session || session.status !== 'connected') {
            throw new Error('الجهاز غير متصل');
        }

        let message;
        switch (type) {
            case 'text':
                message = await session.client.sendMessage(to, content);
                break;
            
            case 'image':
                message = await session.client.sendMessage(to, {
                    url: content
                });
                break;
            
            default:
                throw new Error('نوع الرسالة غير مدعوم');
        }

        return {
            success: true,
            messageId: message.id._serialized,
            timestamp: message.timestamp
        };

    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        throw error;
    }
}

/**
 * إنهاء جلسة
 * @param {string} deviceId - معرف الجهاز
 */
async function destroySession(deviceId) {
    try {
        const session = sessions.get(deviceId);
        if (session) {
            // إنهاء العميل
            if (session.client) {
                await session.client.destroy();
            }
            
            // حذف الجلسة
            sessions.delete(deviceId);

            // تسجيل الحدث
            await logger.device('تم إنهاء الجلسة', { deviceId }, session.userId);
        }

    } catch (error) {
        console.error('خطأ في إنهاء الجلسة:', error);
        throw error;
    }
}

/**
 * تصدير الدوال
 */
module.exports = {
    createClient,
    getConnectionStatus,
    setupClientEvents,
    sendMessage,
    destroySession
}; 