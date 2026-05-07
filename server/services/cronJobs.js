const cron = require('node-cron');
const logger = require('../config/logger');
const { pool, sql } = require('../config/db');
const { scrapeMarketDataForProduct } = require('./marketScraperService');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let isRunning = false;

// Run every day at 2:00 AM
cron.schedule('0 2 * * *', async () => {
  if (isRunning) {
    logger.warn('[CRON] Market scrape already running — skipping this invocation.');
    return;
  }
  isRunning = true;
  logger.info('[CRON] Starting daily AI Market Scrape...');

  try {
    const rows = await pool.request().query(`
      SELECT p.id, p.org_id, p.product_code, 
             (SELECT TOP 1 name FROM product_categories WHERE id=p.category_id) as brand,
             ps.supplier_part_number
      FROM products p
      LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.org_id = p.org_id AND ps.is_active = 1
      WHERE p.is_active = 1
    `);
    
    // Group by product id to handle multiple suppliers
    const productGroups = {};
    rows.recordset.forEach(row => {
      if (!productGroups[row.id]) {
        productGroups[row.id] = {
          id: row.id,
          org_id: row.org_id,
          brand: row.brand,
          sku: row.product_code,
          queries: new Set()
        };
        if (row.product_code) productGroups[row.id].queries.add(row.product_code);
      }
      if (row.supplier_part_number) productGroups[row.id].queries.add(row.supplier_part_number);
    });
    
    const products = Object.values(productGroups);
    logger.info(`[CRON] Processing ${products.length} unique products.`);
    
    for (const product of products) {
      try {
        for (const queryStr of product.queries) {
          const competitors = await scrapeMarketDataForProduct({ brand: product.brand }, queryStr);

          for (const comp of competitors) {
            await pool.request()
              .input('org_id',          sql.Int,              product.org_id)
              .input('product_id',      sql.Int,              product.id)
              .input('website_source',  sql.VarChar(255),     comp.website_source)
              .input('url',             sql.NVarChar(2000),   comp.url)
              .input('price',           sql.Decimal(18,2),    comp.price || null)
              .input('description',     sql.NVarChar(sql.MAX), comp.description || null)
              .input('accuracy_score',  sql.Int,              comp.accuracy_score)
              .input('search_query',    sql.NVarChar(100),    comp.search_query)
              .query(`
                INSERT INTO product_competitor_data
                (org_id, product_id, website_source, url, price, description, accuracy_score, search_query)
                VALUES
                (@org_id, @product_id, @website_source, @url, @price, @description, @accuracy_score, @search_query)
              `);
          }
          // Respect SerpApi rate limits — 1 second between requests
          await sleep(1000);
        }
      } catch (err) {
        logger.error(`[CRON] Error scraping product ${product.id}: ${err.message}`);
      }
    }

    logger.info('[CRON] Daily AI Market Scrape completed.');
  } catch (err) {
    logger.error(`[CRON] Failed to run market scrape job: ${err.message}`);
  } finally {
    isRunning = false;
  }
});
