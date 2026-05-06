'use strict';
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { sql, poolConnect, pool } = require('../config/db');

// List of GET endpoints to test
const ENDPOINTS = [
  '/api/health',
  '/api/auth/me',
  '/api/users',
  '/api/contacts',
  '/api/products',
  '/api/currency',
  '/api/price-lists',
  '/api/settings/org'
];

async function runSmokeTest() {
  console.log('=== API Smoke Test ===');
  try {
    await poolConnect;
    
    // 1. Get an admin user
    const userRes = await pool.request().query(`
      SELECT TOP 1 u.id, u.email, u.full_name, om.org_id, om.role
      FROM users u
      JOIN org_members om ON u.id = om.user_id
      WHERE om.role = 'super_admin' OR om.role = 'admin'
    `);
    
    if (userRes.recordset.length === 0) {
      console.log('❌ No admin user found in database. Run seed-admin.js first.');
      process.exit(1);
    }
    
    const user = userRes.recordset[0];
    console.log(`✅ Found Admin: ${user.email} (Org: ${user.org_id})`);
    
    // 2. Generate a fresh token manually
    const token = jwt.sign({
      userId: user.id,
      orgId:  user.org_id,
      email:  user.email,
      role:   user.role,
      name:   user.full_name,
    }, process.env.JWT_SECRET, { expiresIn: '1h' });
    
    console.log('✅ Generated valid JWT Token for testing.\n');
    
    // 3. Ping endpoints
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    let passed = 0;
    
    for (const endpoint of ENDPOINTS) {
      process.stdout.write(`Testing GET ${endpoint.padEnd(25)} ... `);
      
      const res = await fetch(baseUrl + endpoint, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const isJson = res.headers.get('content-type')?.includes('application/json');
      const text = await res.text();
      
      if (res.ok) {
        console.log('✅ 200 OK');
        passed++;
      } else {
        console.log(`❌ ${res.status}`);
        let errMsg = text;
        if (isJson) {
           try { errMsg = JSON.parse(text).error || text; } catch(e) {}
        }
        console.log(`   Error: ${errMsg.substring(0, 100)}`);
      }
    }
    
    console.log(`\n=== Results: ${passed}/${ENDPOINTS.length} Passed ===`);
    if (passed === ENDPOINTS.length) {
      console.log('🎉 Everything looks solid!');
    }
    
  } catch (err) {
    console.error('\n❌ Test execution failed:', err.message);
  } finally {
    process.exit(0);
  }
}

// Check if server is running before trying
fetch(`http://localhost:${process.env.PORT || 3000}/api/health`)
  .then(() => runSmokeTest())
  .catch((err) => {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.log('❌ The server is not running.');
      console.log('Please start the server first using: npm run dev');
    } else {
      console.error(err);
    }
  });
