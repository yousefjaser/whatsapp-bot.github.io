const admin = require('firebase-admin');
const logger = require('./logger');

let initialized = false;

function initializeFirebase() {
    if (!initialized) {
        try {
            // التحقق من وجود متغيرات البيئة المطلوبة
            if (!process.env.FIREBASE_CONFIG) {
                throw new Error('FIREBASE_CONFIG غير محدد في متغيرات البيئة');
            }

            // تحويل النص إلى كائن JSON
            const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

            // تهيئة Firebase Admin
            admin.initializeApp({
                credential: admin.credential.cert(firebaseConfig),
                databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${firebaseConfig.project_id}.firebaseio.com`
            });

            initialized = true;
            logger.info('تم تهيئة Firebase Admin بنجاح', { 
                projectId: firebaseConfig.project_id 
            });
        } catch (error) {
            logger.error('خطأ في تهيئة Firebase Admin', { 
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                }
            });
            throw error;
        }
    }
}

/**
 * حفظ جهاز في قاعدة البيانات
 */
async function saveDevice(deviceId, deviceData) {
    try {
        await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .set(deviceData);
        
        return deviceId;
    } catch (error) {
        logger.error('خطأ في حفظ الجهاز', { error, deviceId });
        throw error;
    }
}

/**
 * الحصول على جهاز من قاعدة البيانات
 */
async function getDevice(deviceId) {
    try {
        const doc = await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .get();

        if (!doc.exists) {
            return null;
        }

        const data = doc.data();
        return {
            ...data,
            createdAt: data.createdAt?.toDate(),
            updatedAt: data.updatedAt?.toDate()
        };
    } catch (error) {
        logger.error('خطأ في جلب الجهاز', { error, deviceId });
        throw error;
    }
}

/**
 * الحصول على أجهزة المستخدم
 */
async function getUserDevices(userId) {
    try {
        logger.info('جلب أجهزة المستخدم', { userId });
        
        const snapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

        const devices = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            devices.push({
                ...data,
                createdAt: data.createdAt?.toDate(),
                updatedAt: data.updatedAt?.toDate()
            });
        });

        logger.info('تم جلب الأجهزة بنجاح', { 
            userId, 
            devicesCount: devices.length 
        });

        return devices;
    } catch (error) {
        // إذا كان الخطأ بسبب عدم وجود مؤشر
        if (error.code === 'failed-precondition') {
            logger.warn('مطلوب إنشاء مؤشر للاستعلام', { 
                error,
                collectionPath: 'devices',
                fields: ['userId', 'createdAt'] 
            });
            
            // محاولة جلب الأجهزة بدون ترتيب
            const snapshot = await admin.firestore()
                .collection('devices')
                .where('userId', '==', userId)
                .get();

            const devices = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                devices.push({
                    ...data,
                    createdAt: data.createdAt?.toDate(),
                    updatedAt: data.updatedAt?.toDate()
                });
            });

            return devices;
        }

        logger.error('خطأ في جلب أجهزة المستخدم', { error, userId });
        throw error;
    }
}

module.exports = {
    initializeFirebase,
    saveDevice,
    getDevice,
    getUserDevices
}; 