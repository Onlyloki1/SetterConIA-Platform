const admin = require('firebase-admin');

let firebaseAdmin = null;

function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    console.log('FIREBASE_SERVICE_ACCOUNT not set — Firebase Admin disabled');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    firebaseAdmin = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin SDK initialized');
    return firebaseAdmin;
  } catch (err) {
    console.error('Firebase Admin init error:', err.message);
    return null;
  }
}

async function createFirebaseBot(email, password, messageLimit, days) {
  const app = getFirebaseAdmin();
  if (!app) return { success: false, error: 'Firebase Admin not configured' };

  try {
    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email.toLowerCase().trim(),
      password: password,
    });
    const uid = userRecord.uid;

    // Create Firestore document
    const db = admin.firestore();
    const now = new Date();
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (days || 120));
    const todayStr = now.toISOString().split('T')[0];

    await db.collection('users').doc(uid).set({
      email: email.toLowerCase().trim(),
      name: '',
      plan: 'custom',
      messageLimit: messageLimit || 300,
      messagesSent: 0,
      lastResetDate: admin.firestore.Timestamp.fromDate(now),
      isActive: true,
      expiryDate: admin.firestore.Timestamp.fromDate(expiry),
      notes: 'Creado automaticamente al aprobar cliente',
      createdAt: admin.firestore.Timestamp.fromDate(now),
      createdBy: 'admin-auto',
      password: password,
    });

    // Create dailyStats
    await db.collection('users').doc(uid).collection('dailyStats').doc(todayStr).set({
      globalMessageCount: 0,
      date: todayStr,
      userId: uid,
      userEmail: email.toLowerCase().trim(),
      messageLimit: messageLimit || 300,
    });

    console.log('Firebase bot created:', email, 'uid:', uid);
    return { success: true, uid, email, password };
  } catch (err) {
    console.error('Firebase bot creation error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { createFirebaseBot };
