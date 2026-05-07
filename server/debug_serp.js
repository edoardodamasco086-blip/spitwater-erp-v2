const axios = require('axios');
require('dotenv').config();

async function test() {
  const query = 'PA26105000';
  const apiKey = process.env.SERP_API_KEY;
  
  console.log('Testing Shopping results...');
  const shop = await axios.get('https://serpapi.com/search', {
    params: { engine: 'google_shopping', q: query, google_domain: 'google.com.au', hl: 'en', gl: 'au', location: 'Australia', api_key: apiKey }
  });
  console.log('Shopping found:', shop.data.shopping_results?.length || 0);
  if (shop.data.shopping_results) {
    shop.data.shopping_results.slice(0, 3).forEach(r => console.log(`- ${r.source}: ${r.price} (${(r.link || r.product_link || '').substring(0, 50)}...)`));
  }

  console.log('\nTesting Organic results...');
  const organic = await axios.get('https://serpapi.com/search', {
    params: { engine: 'google', q: query, google_domain: 'google.com.au', hl: 'en', gl: 'au', location: 'Australia', api_key: apiKey }
  });
  console.log('Organic found:', organic.data.organic_results?.length || 0);
  if (organic.data.organic_results) {
    organic.data.organic_results.forEach(r => {
      if (r.link.includes('ebay') || r.link.includes('sparesbox')) {
        console.log(`Match: ${r.link}`);
        console.log(`Snippet: ${r.snippet}`);
        console.log(`Rich Snippet: ${JSON.stringify(r.rich_snippet)}`);
      }
    });
  }
}

test();
