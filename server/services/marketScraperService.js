const logger = require('../config/logger');
const axios = require('axios');

/**
 * Scrapes real market data using SerpApi.
 * Searches Google for the product and returns structured results.
 */
async function scrapeMarketDataForProduct(product, query) {
  const apiKey = process.env.SERP_API_KEY;
  
  if (!apiKey) {
    logger.warn('[Scraper] No SERP_API_KEY found in .env. Falling back to empty results.');
    return [];
  }

  logger.info(`[Scraper] Performing REAL search for EXACT query: "${query}"`);

  try {
    const results = [];
    
    // 1. Try Google Shopping first for clean price data
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google_shopping',
        q: query, // ONLY the SKU/Part Number
        google_domain: 'google.com.au',
        hl: 'en',
        gl: 'au',
        location: 'Australia',
        api_key: apiKey
      }
    });

    const shoppingResults = response.data.shopping_results || [];
    shoppingResults.slice(0, 15).forEach(res => {
      if (res.link) {
        results.push({
          website_source: res.source || extractDomain(res.link),
          url: res.link,
          price: typeof res.price === 'string' ? parseFloat(res.price.replace(/[^0-9.]/g, '')) : (res.price || null),
          description: res.title,
          accuracy_score: calculateAccuracy(query, res.title),
          search_query: query
        });
      }
    });

    // 2. Try Organic Search for direct dealer sites that might not be in Shopping
    const organicResponse = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google',
        q: query, // ONLY the SKU/Part Number
        google_domain: 'google.com.au',
        hl: 'en',
        gl: 'au',
        location: 'Australia',
        api_key: apiKey,
        num: 20 // Get more results to find specific dealers
      }
    });
    
    const organicResults = organicResponse.data.organic_results || [];
    organicResults.forEach(res => {
      if (res.link) {
        // Only add if not already in shopping results
        if (!results.find(r => r.url === res.link)) {
          results.push({
            website_source: extractDomain(res.link),
            url: res.link,
            price: res.rich_snippet?.shopping?.price ? parseFloat(res.rich_snippet.shopping.price.replace(/[^0-9.]/g, '')) : extractPrice(res.snippet || res.title),
            description: res.title,
            accuracy_score: calculateAccuracy(query, res.title),
            search_query: query
          });
        }
      }
    });

    return results;
  } catch (err) {
    logger.error(`[Scraper] SerpApi request failed: ${err.message}`);
    return [];
  }
}



/**
 * Extracts the domain name from a URL
 */
function extractDomain(url) {
  try {
    const domain = new URL(url).hostname;
    return domain.replace('www.', '');
  } catch {
    return 'unknown source';
  }
}

/**
 * Attempts to find a price (e.g. $45.00) in a string
 */
function extractPrice(text) {
  if (!text) return null;
  const match = text.match(/\$\s?([0-9,]+\.[0-9]{2})/);
  if (match) return parseFloat(match[1].replace(',', ''));
  return null;
}

/**
 * Calculates a basic accuracy score (0-100) based on query matching
 */
function calculateAccuracy(query, title) {
  if (!title || !query) return 0;
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  
  if (t.includes(q)) return 100;
  
  // Fuzzy match: if part of the query is found
  if (q.length > 4 && t.includes(q.substring(0, 5))) return 70;
  
  return 50; // Minimum for appearing in results
}

module.exports = {
  scrapeMarketDataForProduct
};


