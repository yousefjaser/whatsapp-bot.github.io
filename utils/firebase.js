const admin = require('firebase-admin');
const logger = require('./logger');

let initialized = false;

function initializeFirebase() {
    if (initialized) {
        return;
    }

    try {
        // تهيئة Firebase Admin
        admin.initializeApp({
            credential: process.env.FIREBASE_CONFIG 
                ? admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG))
                : admin.credential.applicationDefault(),
            projectId: process.env.FIREBASE_PROJECT_ID || 'whatsappbot-b9a4c',
            databaseURL: process.env.FIREBASE_DATABASE_URL || `https://whatsappbot-b9a4c.firebaseio.com`
        });

        initialized = true;
        logger.info('تم تهيئة Firebase Admin بنجاح');
    } catch (error) {
        logger.error('خطأ في تهيئة Firebase Admin:', error);
        throw error;
    }
}

// الحصول على معلومات المستخدم
async function getUser(userId) {
    try {
        const userDoc = await admin.firestore().collection('users').doc(userId).get();
        return userDoc.exists ? { id: userDoc.id, ...userDoc.data() } : null;
    } catch (error) {
        logger.error('خطأ في جلب معلومات المستخدم:', error);
        throw error;
    }
}

// تحديث معلومات المستخدم
async function updateUser(userId, data) {
    try {
        await admin.firestore().collection('users').doc(userId).update({
            ...data,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        logger.error('خطأ في تحديث معلومات المستخدم:', error);
        throw error;
    }
}

// حفظ الجهاز
async function saveDevice(deviceData) {
    try {
        const deviceRef = await admin.firestore().collection('devices').add({
            ...deviceData,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return deviceRef.id;
    } catch (error) {
        logger.error('خطأ في حفظ الجهاز:', error);
        throw error;
    }
}

// الحصول على معلومات الجهاز
async function getDevice(deviceId) {
    try {
        const deviceDoc = await admin.firestore().collection('devices').doc(deviceId).get();
        return deviceDoc.exists ? { id: deviceDoc.id, ...deviceDoc.data() } : null;
    } catch (error) {
        logger.error('خطأ في جلب معلومات الجهاز:', error);
        throw error;
    }
}

// تحديث حالة الجهاز
async function updateDeviceStatus(deviceId, status) {
    try {
        await admin.firestore().collection('devices').doc(deviceId).update({
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        logger.error('خطأ في تحديث حالة الجهاز:', error);
        throw error;
    }
}

// الحصول على أجهزة المستخدم
async function getUserDevices(userId, options = {}) {
    try {
        let query = admin.firestore().collection('devices')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc');

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        logger.error('خطأ في جلب أجهزة المستخدم:', error);
        throw error;
    }
}

// حفظ رسالة
async function saveMessage(messageData) {
    try {
        const messageRef = await admin.firestore().collection('messages').add({
            ...messageData,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return messageRef.id;
    } catch (error) {
        logger.error('خطأ في حفظ الرسالة:', error);
        throw error;
    }
}

// الحصول على رسائل المستخدم
async function getUserMessages(userId, options = {}) {
    try {
        let query = admin.firestore().collection('messages')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc');

        if (options.deviceId) {
            query = query.where('deviceId', '==', options.deviceId);
        }

        if (options.limit) {
            query = query.limit(options.limit);
        }

        const snapshot = await query.get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        logger.error('خطأ في جلب رسائل المستخدم:', error);
        throw error;
    }
}

module.exports = {
    initializeFirebase,
    getUser,
    updateUser,
    saveDevice,
    getDevice,
    updateDeviceStatus,
    getUserDevices,
    saveMessage,
    getUserMessages
}; 