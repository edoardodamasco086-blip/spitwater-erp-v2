const axios = require('axios');
require('dotenv').config();

async function testEbay() {
  const query = 'PA26105000';
  const apiKey = process.env.SERP_API_KEY;
  
  console.log('Testing DIRECT eBay search...');
  try {
    const res = await axios.get('https://serpapi.com/search', {
      params: { engine: 'ebay', _nkw: query, ebay_domain: 'ebay.com.au', api_key: apiKey }
    });
    
    const results = res.data.search_results || [];
    console.log('eBay results found:', results.length);
    if (results.length > 0) {
      results.slice(0, 5).forEach(r => {
        console.log(`- Title: ${r.title}`);
        console.log(`  Price: ${JSON.stringify(r.price)}`);
      });
    }
  } catch (err) {
    console.error(err.message);
  }
}

testEbay();
