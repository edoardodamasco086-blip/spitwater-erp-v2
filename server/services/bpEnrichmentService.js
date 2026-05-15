'use strict';
// ============================================================
// services/bpEnrichmentService.js
//
// BP AI Enrichment Service
// Uses SerpApi for web search, optionally Anthropic for synthesis.
// Stores findings as bp_enrichment_proposals rows (pending human
// review before any data is written to business_partners).
// ============================================================

const axios = require('axios');

const SERP_API_KEY     = process.env.SERP_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Regex helpers ─────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?61|0)[2-9]\d{8}|(\+?61|0)4\d{8}/g;

const INDUSTRIES = [
  'manufacturing', 'retail', 'wholesale', 'technology', 'construction',
  'mining', 'agriculture', 'transport', 'logistics', 'healthcare',
  'hospitality', 'finance', 'insurance', 'real estate',
];

// ── Main export ───────────────────────────────────────────────
/**
 * @param {object}  bp           - business_partners row
 * @param {number}  orgId
 * @param {number}  triggeredBy  - userId who triggered enrichment
 * @param {object}  pool         - mssql connection pool
 * @param {object}  sql          - mssql sql object
 */
async function enrich(bp, orgId, triggeredBy, pool, sql) {
  if (!SERP_API_KEY) {
    console.warn('[BP Enrich] SERP_API_KEY not set — skipping enrichment');
    return;
  }

  const searchName = bp.bp_type === 'organization'
    ? (bp.trading_name || bp.legal_entity_name)
    : `${bp.first_name || ''} ${bp.last_name || ''}`.trim();

  if (!searchName) {
    console.warn(`[BP Enrich] bp.id=${bp.id} has no searchable name — skipping`);
    return;
  }

  const proposals = [];

  try {
    // ── Search 1: contact details ──────────────────────────────
    const res1 = await axios.get('https://serpapi.com/search', {
      params: {
        engine:  'google',
        q:       `${searchName} ${bp.bp_type === 'organization' ? 'company' : ''} Australia contact email phone`.trim(),
        api_key: SERP_API_KEY,
        num:     5,
      },
      timeout: 15000,
    });

    const snippets1 = (res1.data.organic_results || []).map(r => ({
      url:     r.link     || '',
      snippet: r.snippet  || '',
      title:   r.title    || '',
    }));

    for (const { url, snippet } of snippets1) {
      const emails = [...new Set(snippet.match(EMAIL_RE) || [])].filter(
        e => !e.includes('example') && !e.includes('test')
      );
      const phones = [...new Set(snippet.match(PHONE_RE) || [])];

      if (emails.length && !bp.email) {
        proposals.push({
          field_name:     'email',
          proposed_value: emails[0],
          source_url:     url,
          source_snippet: snippet.slice(0, 500),
          confidence:     70,
        });
      }
      if (phones.length && !bp.phone) {
        proposals.push({
          field_name:     'phone',
          proposed_value: phones[0],
          source_url:     url,
          source_snippet: snippet.slice(0, 500),
          confidence:     65,
        });
      }
    }

    // ── Search 2: website, LinkedIn, industry (orgs only) ─────
    if (bp.bp_type === 'organization') {
      const res2 = await axios.get('https://serpapi.com/search', {
        params: {
          engine:  'google',
          q:       `${searchName} official website LinkedIn Australia`,
          api_key: SERP_API_KEY,
          num:     5,
        },
        timeout: 15000,
      });

      const results2 = res2.data.organic_results || [];

      // Website
      if (!bp.website) {
        const siteResult = results2.find(r =>
          r.link &&
          !r.link.includes('linkedin') &&
          !r.link.includes('google') &&
          !r.link.includes('yelp')
        );
        if (siteResult) {
          proposals.push({
            field_name:     'website',
            proposed_value: siteResult.link,
            source_url:     siteResult.link,
            source_snippet: (siteResult.snippet || '').slice(0, 300),
            confidence:     60,
          });
        }
      }

      // LinkedIn
      if (!bp.linkedin_url) {
        const liResult = results2.find(r => r.link && r.link.includes('linkedin.com/company'));
        if (liResult) {
          proposals.push({
            field_name:     'linkedin_url',
            proposed_value: liResult.link,
            source_url:     liResult.link,
            source_snippet: (liResult.snippet || '').slice(0, 300),
            confidence:     80,
          });
        }
      }

      // Industry
      if (!bp.industry) {
        const allSnippets = results2.map(r => r.snippet || '').join(' ').toLowerCase();
        const foundIndustry = INDUSTRIES.find(ind => allSnippets.includes(ind));
        if (foundIndustry) {
          proposals.push({
            field_name:     'industry',
            proposed_value: foundIndustry.charAt(0).toUpperCase() + foundIndustry.slice(1),
            source_url:     results2[0]?.link || null,
            source_snippet: allSnippets.slice(0, 300),
            confidence:     50,
          });
        }
      }

      // AI summary via Anthropic (optional)
      if (ANTHROPIC_API_KEY && results2.length > 0) {
        try {
          const summarySnippets = results2.slice(0, 3)
            .map(r => `Title: ${r.title}\nSnippet: ${r.snippet || ''}`)
            .join('\n\n');

          const anthropicRes = await axios.post('https://api.anthropic.com/v1/messages', {
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 300,
            messages: [{
              role:    'user',
              content: `Based on these search results about the company "${searchName}", write a concise 2-3 sentence business summary for an ERP system. Focus on what they do, their industry, and their likely scale. Be factual and professional. Search results:\n\n${summarySnippets}`,
            }],
          }, {
            headers: {
              'x-api-key':         ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Type':      'application/json',
            },
            timeout: 20000,
          });

          const summary = anthropicRes.data?.content?.[0]?.text?.trim();
          if (summary) {
            proposals.push({
              field_name:     'ai_summary',
              proposed_value: summary,
              source_url:     null,
              source_snippet: null,
              confidence:     75,
            });
          }
        } catch (e) {
          // AI summary is optional — silently skip if it fails
          console.warn('[BP Enrich] Anthropic summary failed:', e.message);
        }
      }
    }

    // ── Deduplicate: skip fields already pending review ────────
    const existingRes = await pool.request()
      .input('bp_id', sql.Int, bp.id)
      .query(`SELECT field_name FROM bp_enrichment_proposals WHERE bp_id=@bp_id AND status='pending'`);
    const existingFields = new Set(existingRes.recordset.map(r => r.field_name));

    const newProposals = proposals.filter(
      p => !existingFields.has(p.field_name) && p.proposed_value
    );

    // ── Insert proposals ───────────────────────────────────────
    const currentValueMap = {
      email:       bp.email        || null,
      phone:       bp.phone        || null,
      mobile:      bp.mobile       || null,
      website:     bp.website      || null,
      industry:    bp.industry     || null,
      linkedin_url:bp.linkedin_url || null,
      ai_summary:  bp.ai_summary   || null,
    };

    for (const proposal of newProposals) {
      await pool.request()
        .input('org_id',         sql.Int,              orgId)
        .input('bp_id',          sql.Int,              bp.id)
        .input('field_name',     sql.VarChar(100),     proposal.field_name)
        .input('proposed_value', sql.NVarChar(sql.MAX),proposal.proposed_value)
        .input('current_value',  sql.NVarChar(sql.MAX),currentValueMap[proposal.field_name] ?? null)
        .input('source_url',     sql.NVarChar(1000),   proposal.source_url    || null)
        .input('source_snippet', sql.NVarChar(2000),   proposal.source_snippet|| null)
        .input('confidence',     sql.Decimal(5,2),     proposal.confidence    || null)
        .input('triggered_by',   sql.Int,              triggeredBy            || null)
        .query(`
          INSERT INTO bp_enrichment_proposals
            (org_id, bp_id, field_name, proposed_value, current_value,
             source_url, source_snippet, confidence, triggered_by, created_at)
          VALUES
            (@org_id, @bp_id, @field_name, @proposed_value, @current_value,
             @source_url, @source_snippet, @confidence, @triggered_by, GETDATE())
        `);
    }

    // ── Update enrichment timestamp on BP ─────────────────────
    await pool.request()
      .input('bp_id', sql.Int, bp.id)
      .query('UPDATE business_partners SET ai_enriched_at=GETDATE(), updated_at=GETDATE() WHERE id=@bp_id');

    console.log(`[BP Enrich] bp.id=${bp.id} "${searchName}": ${newProposals.length} proposal(s) created`);

  } catch (err) {
    console.error('[BP Enrich] Error during enrichment:', err.message);
  }
}

module.exports = { enrich };
