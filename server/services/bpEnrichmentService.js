'use strict';
// ============================================================
// services/bpEnrichmentService.js
//
// BP AI Enrichment — website-first, Claude-verified pipeline:
//
//  Phase 1 (if website known): fetch the company's own website
//          and extract structured data directly from it.
//          Confidence is high because it's the authoritative source.
//
//  Phase 2: SerpApi search (AU-biased) for any fields still missing.
//          Results are passed to Claude along with all known BP
//          data so Claude can filter out results about the wrong
//          company before anything is proposed.
//
// All findings are staged in bp_enrichment_proposals for human
// review — nothing is written directly to business_partners.
// ============================================================

const axios = require('axios');

const SERP_API_KEY      = process.env.SERP_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const ANTHROPIC_HEADERS = {
  'x-api-key':         ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
  'Content-Type':      'application/json',
};

// ── Helpers ───────────────────────────────────────────────────
function domainOf(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch { return null; }
}

function buildKnownContext(bp) {
  const lines = [];
  if (bp.legal_entity_name) lines.push(`Legal entity name: ${bp.legal_entity_name}`);
  if (bp.trading_name)      lines.push(`Trading name: ${bp.trading_name}`);
  if (bp.abn)               lines.push(`ABN: ${bp.abn}`);
  if (bp.website)           lines.push(`Website: ${bp.website}`);
  if (bp.email)             lines.push(`Email: ${bp.email}`);
  if (bp.phone)             lines.push(`Phone: ${bp.phone}`);
  if (bp.industry)          lines.push(`Industry: ${bp.industry}`);
  if (bp.linkedin_url)      lines.push(`LinkedIn: ${bp.linkedin_url}`);
  return lines.join('\n');
}

// ── Phase 1: fetch known website and extract via Claude ───────
async function extractFromWebsite(bp) {
  if (!ANTHROPIC_API_KEY || !bp.website) return [];

  let html = '';
  try {
    const res = await axios.get(
      bp.website.startsWith('http') ? bp.website : `https://${bp.website}`,
      { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ERPBot/1.0)' } }
    );
    // Strip tags, keep first 6 000 chars so the prompt stays small
    html = (res.data || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 6000);
  } catch (e) {
    console.warn(`[BP Enrich] Could not fetch website ${bp.website}: ${e.message}`);
    return [];
  }

  if (!html.trim()) return [];

  const knownContext = buildKnownContext(bp);
  const prompt = `You are an ERP data assistant. A business partner record has these known values:
${knownContext}

Below is the text content of their official website (${bp.website}).
Extract only fields that are clearly present and belong to THIS specific company.
Return a JSON array of objects with these keys: field_name, proposed_value, confidence (0-100).

Fields you may propose (skip if already known or not found):
- industry: their primary industry/sector
- phone: main office phone number
- email: main contact email (prefer generic like info@, sales@, not personal)
- abn: Australian Business Number if shown
- ai_summary: 2-3 sentence professional summary of what this company does

Rules:
- Only include a field if you are confident it belongs to THIS company
- Do not hallucinate — if not clearly on the page, omit it
- Phone numbers: Australian format preferred
- Return valid JSON only, no markdown fences

Website text:
${html}`;

  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    }, { headers: ANTHROPIC_HEADERS, timeout: 25000 });

    const raw = r.data?.content?.[0]?.text?.trim() || '[]';
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, ''));
    if (!Array.isArray(parsed)) return [];

    // Tag source
    return parsed
      .filter(p => p.field_name && p.proposed_value)
      .map(p => ({
        ...p,
        source_url:     bp.website,
        source_snippet: `Extracted from company website ${bp.website}`,
        confidence:     Math.min(95, Math.max(0, Number(p.confidence) || 70)),
      }));
  } catch (e) {
    console.warn('[BP Enrich] Claude website extraction failed:', e.message);
    return [];
  }
}

// ── Phase 2: SerpApi search + Claude verification ─────────────
async function searchAndVerify(bp, alreadyProposedFields) {
  if (!SERP_API_KEY) return [];

  const searchName = bp.bp_type === 'organization'
    ? (bp.trading_name || bp.legal_entity_name)
    : `${bp.first_name || ''} ${bp.last_name || ''}`.trim();

  if (!searchName) return [];

  const domain = bp.website ? domainOf(bp.website) : null;

  // Build query — if we have a domain, constrain to it for at least one search
  const queries = domain
    ? [
        `site:${domain} contact phone email industry`,
        `"${searchName}" Australia contact phone email industry`,
      ]
    : [
        `"${searchName}" Australia company contact phone email`,
        `"${searchName}" Australia official website LinkedIn`,
      ];

  const allResults = [];
  for (const q of queries) {
    try {
      const res = await axios.get('https://serpapi.com/search', {
        params: { engine: 'google', q, api_key: SERP_API_KEY, num: 5, gl: 'au', hl: 'en', location: 'Australia' },
        timeout: 15000,
      });
      for (const r of (res.data.organic_results || [])) {
        allResults.push({ url: r.link || '', title: r.title || '', snippet: r.snippet || '' });
      }
    } catch (e) {
      console.warn(`[BP Enrich] SerpApi query failed ("${q}"): ${e.message}`);
    }
  }

  if (allResults.length === 0 || !ANTHROPIC_API_KEY) return [];

  // Let Claude cross-reference and verify
  const knownContext = buildKnownContext(bp);
  const resultsText = allResults
    .slice(0, 8)
    .map((r, i) => `[${i + 1}] URL: ${r.url}\nTitle: ${r.title}\nSnippet: ${r.snippet}`)
    .join('\n\n');

  const alreadyDone = alreadyProposedFields.length > 0
    ? `\nSkip these fields (already found): ${alreadyProposedFields.join(', ')}`
    : '';

  const prompt = `You are an ERP data assistant enriching a business partner record.

Known data about this company:
${knownContext}

Search results from Google (some may be about a DIFFERENT company with a similar name):
${resultsText}

Task: Identify which search results genuinely refer to THIS specific company (cross-check against the known website domain, ABN, name, etc.). Then extract missing data only from confirmed-matching results.${alreadyDone}

Fields you may propose (only if confidently from THIS company):
- industry, phone, email, website (if not already known), linkedin_url, ai_summary

Return a JSON array with objects: { field_name, proposed_value, source_url, source_snippet (max 200 chars), confidence (0-100) }
If no result clearly matches this company, return an empty array [].
Return valid JSON only — no markdown, no explanation.`;

  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages:   [{ role: 'user', content: prompt }],
    }, { headers: ANTHROPIC_HEADERS, timeout: 25000 });

    const raw = r.data?.content?.[0]?.text?.trim() || '[]';
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, ''));
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(p => p.field_name && p.proposed_value)
      .map(p => ({
        ...p,
        confidence:     Math.min(90, Math.max(0, Number(p.confidence) || 50)),
        source_snippet: (p.source_snippet || '').slice(0, 500),
      }));
  } catch (e) {
    console.warn('[BP Enrich] Claude search verification failed:', e.message);
    return [];
  }
}

// ── Main export ───────────────────────────────────────────────
async function enrich(bp, orgId, triggeredBy, pool, sql) {
  const searchName = bp.bp_type === 'organization'
    ? (bp.trading_name || bp.legal_entity_name)
    : `${bp.first_name || ''} ${bp.last_name || ''}`.trim();

  if (!searchName) {
    console.warn(`[BP Enrich] bp.id=${bp.id} has no searchable name — skipping`);
    return;
  }

  if (!SERP_API_KEY && !ANTHROPIC_API_KEY) {
    console.warn('[BP Enrich] Neither SERP_API_KEY nor ANTHROPIC_API_KEY set — skipping enrichment');
    return;
  }

  console.log(`[BP Enrich] Starting enrichment for bp.id=${bp.id} "${searchName}"...`);

  const allProposals = [];

  // Phase 1: extract from known website (high-confidence, correct company guaranteed)
  if (bp.website) {
    console.log(`[BP Enrich] Phase 1: extracting from website ${bp.website}`);
    const websiteProposals = await extractFromWebsite(bp);
    allProposals.push(...websiteProposals);
    console.log(`[BP Enrich] Phase 1: found ${websiteProposals.length} field(s)`);
  }

  // Phase 2: search for remaining missing fields
  const foundFields = new Set(allProposals.map(p => p.field_name));
  console.log(`[BP Enrich] Phase 2: web search for remaining fields`);
  const searchProposals = await searchAndVerify(bp, [...foundFields]);
  // Don't overwrite high-confidence website proposals with lower-confidence search results
  for (const sp of searchProposals) {
    if (!foundFields.has(sp.field_name)) allProposals.push(sp);
  }
  console.log(`[BP Enrich] Phase 2: found ${searchProposals.length} additional field(s)`);

  // Deduplicate against already-pending proposals
  const existingRes = await pool.request()
    .input('bp_id', sql.Int, bp.id)
    .query(`SELECT field_name FROM bp_enrichment_proposals WHERE bp_id=@bp_id AND status='pending'`);
  const existingFields = new Set(existingRes.recordset.map(r => r.field_name));

  const currentValueMap = {
    email:       bp.email        || null,
    phone:       bp.phone        || null,
    mobile:      bp.mobile       || null,
    website:     bp.website      || null,
    industry:    bp.industry     || null,
    linkedin_url:bp.linkedin_url || null,
    ai_summary:  bp.ai_summary   || null,
    abn:         bp.abn          || null,
  };

  const newProposals = allProposals.filter(
    p => !existingFields.has(p.field_name) && p.proposed_value
  );

  for (const proposal of newProposals) {
    await pool.request()
      .input('org_id',         sql.Int,               orgId)
      .input('bp_id',          sql.Int,               bp.id)
      .input('field_name',     sql.VarChar(100),      proposal.field_name)
      .input('proposed_value', sql.NVarChar(sql.MAX), proposal.proposed_value)
      .input('current_value',  sql.NVarChar(sql.MAX), currentValueMap[proposal.field_name] ?? null)
      .input('source_url',     sql.NVarChar(1000),    proposal.source_url    || null)
      .input('source_snippet', sql.NVarChar(2000),    proposal.source_snippet|| null)
      .input('confidence',     sql.Decimal(5,2),      proposal.confidence    || null)
      .input('triggered_by',   sql.Int,               triggeredBy            || null)
      .query(`
        INSERT INTO bp_enrichment_proposals
          (org_id, bp_id, field_name, proposed_value, current_value,
           source_url, source_snippet, confidence, triggered_by, created_at)
        VALUES
          (@org_id, @bp_id, @field_name, @proposed_value, @current_value,
           @source_url, @source_snippet, @confidence, @triggered_by, GETDATE())
      `);
  }

  await pool.request()
    .input('bp_id', sql.Int, bp.id)
    .query('UPDATE business_partners SET ai_enriched_at=GETDATE(), updated_at=GETDATE() WHERE id=@bp_id');

  console.log(`[BP Enrich] bp.id=${bp.id} "${searchName}": ${newProposals.length} proposal(s) created`);
}

module.exports = { enrich };
