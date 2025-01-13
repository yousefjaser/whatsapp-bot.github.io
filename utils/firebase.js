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

// حفظ جهاز جديد
async function saveDevice(deviceId, deviceData) {
    try {
        await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .set(deviceData);
        
        return deviceId;
    } catch (error) {
        logger.error('خطأ في حفظ الجهاز', { error: error.message, deviceId });
        throw error;
    }
}

// جلب جهاز واحد
async function getDevice(deviceId) {
    try {
        const doc = await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .get();

        if (!doc.exists) {
            return null;
        }

        return { deviceId: doc.id, ...doc.data() };
    } catch (error) {
        logger.error('خطأ في جلب الجهاز', { error: error.message, deviceId });
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

// جلب أجهزة المستخدم
async function getUserDevices(userId) {
    try {
        const snapshot = await admin.firestore()
            .collection('devices')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

        return snapshot.docs.map(doc => ({
            deviceId: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate()
        }));
    } catch (error) {
        logger.error('خطأ في جلب أجهزة المستخدم', { error: error.message, userId });
        throw error;
    }
}

// حذف جهاز
async function deleteDevice(deviceId) {
    try {
        await admin.firestore()
            .collection('devices')
            .doc(deviceId)
            .delete();
    } catch (error) {
        logger.error('خطأ في حذف الجهاز', { error: error.message, deviceId });
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
    getUserMessages,
    deleteDevice
}; 