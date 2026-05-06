'use strict';
// ============================================================
// utils/password.js — bcrypt helpers
// ============================================================

const bcrypt = require('bcryptjs');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 10;

// Hash a plain-text password — call on registration/password change
async function hashPassword(plainText) {
  return bcrypt.hash(plainText, ROUNDS);
}

// Compare a plain-text attempt against a stored hash — call on login
async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

module.exports = { hashPassword, verifyPassword };
