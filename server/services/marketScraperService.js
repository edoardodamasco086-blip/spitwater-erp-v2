const logger = require('../config/logger');
const axios = require('axios');

/**
 * Calculates a basic accuracy score (0-100) based on query matching.
 * Stricter logic to avoid generic matches like paint.
 */
function calculateAccuracy(query, title) {
  if (!title || !query) return 0;
  const t = title.toLowerCase();
  const q = query.toLowerCase();

  // Exact substring match (great for part numbers)
  if (t.includes(q)) return 100;

  // Normalized exact match (handles separators like dashes)
  const normalizedQ = q.replace(/[^a-z0-9]/g, '');
  const normalizedT = t.replace(/[^a-z0-9]/g, '');
  if (normalizedT.includes(normalizedQ)) return 95;

  // Prefix match (useful for part numbers with suffixes)
  if (q.length > 5 && !q.includes(' ')) {
    const part = q.substring(0, 6);
    if (t.includes(part)) return 80;
  }

  // Word-overlap scoring (for product name queries)
  const queryWords = q.split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length >= 2) {
    const matched = queryWords.filter(w => t.includes(w)).length;
    const ratio   = matched / queryWords.length;
    if (ratio >= 0.6) return Math.round(60 + ratio * 40); // 84–100
    if (ratio >= 0.4) return 70;
  }

  return 30;
}

async function scrapeMarketDataForProduct(product, query) {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return [];

  // Part-number queries (no spaces) trust the search engine's own relevance —
  // don't re-filter by title matching since the code won't appear in the title.
  const isPartNumber = !query.includes(' ');
  const minAccuracy  = isPartNumber ? 0 : 70;

  logger.info(`[Scraper] Searching for ${isPartNumber ? 'part number' : 'name'} query: "${query}"`);

  try {
    const results = [];

    // 1. Google Shopping
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google_shopping',
        q: query,
        google_domain: 'google.com.au',
        hl: 'en', gl: 'au', location: 'Australia', api_key: apiKey
      }
    });

    (response.data.shopping_results || []).slice(0, 10).forEach(res => {
      const accuracy = isPartNumber ? 85 : calculateAccuracy(query, res.title);
      if (accuracy >= minAccuracy) {
        results.push({
          website_source: res.source || extractDomain(res.link),
          url: res.link,
          price: findPriceInObject(res),
          description: res.title,
          accuracy_score: accuracy,
          search_query: query
        });
      }
    });

    // 2. Organic Search
    const organicResponse = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google',
        q: query,
        google_domain: 'google.com.au',
        hl: 'en', gl: 'au', location: 'Australia', api_key: apiKey, num: 20
      }
    });

    (organicResponse.data.organic_results || []).forEach(res => {
      const accuracy = isPartNumber ? 80 : calculateAccuracy(query, res.title);
      if (accuracy >= minAccuracy && !results.find(r => r.url === res.link)) {
        results.push({
          website_source: extractDomain(res.link),
          url: res.link,
          price: findPriceInObject(res),
          description: res.title,
          accuracy_score: accuracy,
          search_query: query
        });
      }
    });

    // 3. Dedicated eBay Search
    try {
      const ebayResponse = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'ebay',
          _nkw: query,
          ebay_domain: 'ebay.com.au',
          api_key: apiKey
        }
      });

      (ebayResponse.data.search_results || []).slice(0, 5).forEach(res => {
        const accuracy = isPartNumber ? 80 : calculateAccuracy(query, res.title);
        if (accuracy >= minAccuracy) {
          results.push({
            website_source: 'ebay.com.au',
            url: res.link,
            price: findPriceInObject(res),
            description: res.title,
            accuracy_score: accuracy,
            search_query: query
          });
        }
      });
    } catch (e) {}

    return results;
  } catch (err) {
    logger.error(`[Scraper] SerpApi failed: ${err.message}`);
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
 * Deeply searches an object for any price-like strings
 */
function findPriceInObject(obj) {
  if (!obj) return null;
  
  if (typeof obj === 'string') return extractPrice(obj);
  if (typeof obj === 'number' && obj > 0 && obj < 1000000) return obj;

  if (typeof obj === 'object') {
    // 1. Check known price fields
    const priceFields = ['price', 'extracted_price', 'value', 'amount'];
    for (const field of priceFields) {
      if (obj[field] !== undefined) {
        if (typeof obj[field] === 'number') return obj[field];
        const found = extractPrice(String(obj[field]));
        if (found !== null) return found;
      }
    }

    // 2. Check rich snippets (including nested extensions)
    const richSnippet = obj.rich_snippet || obj.rich_snippets;
    if (richSnippet) {
      // Check shopping specific
      if (richSnippet.shopping?.price) return extractPrice(richSnippet.shopping.price);
      
      // Check bottom extensions (e.g. Sparesbox uses this)
      if (richSnippet.bottom?.detected_extensions?.price) return richSnippet.bottom.detected_extensions.price;
      if (richSnippet.bottom?.extensions) {
        for (const ext of richSnippet.bottom.extensions) {
          const found = extractPrice(ext);
          if (found !== null) return found;
        }
      }
    }

    // 3. Check detected_extensions directly (if at top level)
    if (obj.detected_extensions?.price) return obj.detected_extensions.price;

    // 4. Recursive fallback for any other fields (safe search)
    const fallbackFields = ['snippet', 'title', 'source'];
    for (const field of fallbackFields) {
      if (obj[field]) {
        const found = extractPrice(String(obj[field]));
        if (found !== null) return found;
      }
    }
  }
  return null;
}

/**
 * Attempts to find a price (e.g. $45.00, $45) in a string.
 * REQUIRES a currency symbol to avoid false positives.
 */
function extractPrice(text) {
  if (!text || typeof text !== 'string') return null;
  
  const cleanText = text.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  
  // Strict regex: MUST have a currency symbol
  const regexes = [
    /(?:\$|AUD|AU\$|USD)\s?([0-9,]+\.[0-9]{2})/, // $79.95
    /(?:\$|AUD|AU\$|USD)\s?([0-9,]+)/            // $79
  ];
  
  for (const regex of regexes) {
    const match = cleanText.match(regex);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0 && val < 1000000) return val;
    }
  }
  
  return null;
}

module.exports = {
  scrapeMarketDataForProduct
};
