const { poolConnect, pool, sql } = require('./config/db');
const { scrapeMarketDataForProduct } = require('./services/marketScraperService');
const logger = require('./config/logger');
require('dotenv').config();

async function refreshForProduct(productId, orgId) {
  await poolConnect;
  
  // 1. Delete today's existing records
  await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('product_id', sql.Int, productId)
    .query(`
      DELETE FROM product_competitor_data 
      WHERE org_id = @org_id 
        AND product_id = @product_id 
        AND CAST(scraped_at AS DATE) = CAST(GETDATE() AS DATE)
    `);

  // 2. Get product details
  const productRes = await pool.request()
    .input('org_id', sql.Int, orgId)
    .input('id', sql.Int, productId)
    .query(`
      SELECT p.id, p.product_code, 
             ps.supplier_part_number
      FROM products p
      LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.org_id = p.org_id
      WHERE p.id=@id AND p.org_id=@org_id
    `);
    
  if (!productRes.recordset.length) {
    console.error('Product not found.');
    return;
  }
  
  const sku = productRes.recordset[0].product_code;
  const queries = new Set();
  if (sku) queries.add(sku);
  productRes.recordset.forEach(row => {
    if (row.supplier_part_number) queries.add(row.supplier_part_number);
  });
  
  const allCompetitors = [];
  
  console.log(`[Script] Starting exact query scrape for ${queries.size} queries.`);
  
  for (const queryStr of queries) {
    try {
      const results = await scrapeMarketDataForProduct({}, queryStr);
      allCompetitors.push(...results);
    } catch (err) {
      console.error(`Error for query "${queryStr}": ${err.message}`);
    }
  }
  
  console.log(`[Script] Found ${allCompetitors.length} total results. Saving to DB...`);
  
  for (const comp of allCompetitors) {
    await pool.request()
      .input('org_id', sql.Int, orgId)
      .input('product_id', sql.Int, productId)
      .input('website_source', sql.VarChar(255), comp.website_source)
      .input('url', sql.NVarChar(2000), comp.url)
      .input('price', sql.Decimal(18,2), comp.price || null)
      .input('description', sql.NVarChar(sql.MAX), comp.description || null)
      .input('accuracy_score', sql.Int, comp.accuracy_score)
      .input('search_query', sql.NVarChar(100), comp.search_query)
      .query(`
        INSERT INTO product_competitor_data
        (org_id, product_id, website_source, url, price, description, accuracy_score, search_query)
        VALUES
        (@org_id, @product_id, @website_source, @url, @price, @description, @accuracy_score, @search_query)
      `);
  }
  
  console.log(`Successfully refreshed data for product ${productId}.`);
  process.exit(0);
}

refreshForProduct(1, 1);
