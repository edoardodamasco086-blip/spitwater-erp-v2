'use strict';
// ============================================================
// services/bpEnrichmentService.js
//
// BP AI Enrichment — website-first, Claude-verified pipeline.
//
// When ANTHROPIC_API_KEY is set (recommended):
//   Phase 1: fetch company website → Claude extracts structured fields
//   Phase 2: SerpApi search → Claude verifies results match this company
//
// When ANTHROPIC_API_KEY is NOT set (fallback):
//   Phase 1: fetch company website → regex extracts email/phone,
//            domain-validates email, industry via keyword scan
//   Phase 2: SerpApi search filtered by known domain → regex extraction
//
// All findings are staged in bp_enrichment_proposals for human
// review — nothing is written directly to business_partners.
// ============================================================

const axios = require('axios');

const SERP_API_KEY      = process.env.SERP_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?61[-\s]?|0)[2-9]\d{2}[-\s]?\d{3}[-\s]?\d{3,4}|(\+?61[-\s]?|0)4\d{2}[-\s]?\d{3}[-\s]?\d{3}/g;

const INDUSTRIES = [
  'manufacturing', 'retail', 'wholesale', 'technology', 'construction',
  'mining', 'agriculture', 'transport', 'logistics', 'healthcare',
  'hospitality', 'finance', 'insurance', 'real estate', 'education',
  'energy', 'utilities', 'media', 'legal', 'accounting',
];

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

function stripHtml(raw) {
  return (raw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Regex fallback extraction (no Anthropic) ─────────────────
function regexExtract(text, bp, sourceUrl) {
  const proposals = [];
  const domain = bp.website ? domainOf(bp.website) : null;

  // Email — prefer domain-matching, filter obvious noise
  if (!bp.email) {
    const emails = [...new Set(text.match(EMAIL_RE) || [])]
      .filter(e => !e.includes('example') && !e.includes('test') && !e.includes('sentry'));
    // Prefer email whose domain matches the known website
    const preferred = domain
      ? (emails.find(e => e.endsWith('@' + domain)) || emails[0])
      : emails[0];
    if (preferred) proposals.push({ field_name: 'email', proposed_value: preferred, sourceUrl, confidence: domain && preferred.endsWith('@' + domain) ? 80 : 55 });
  }

  // Phone
  if (!bp.phone) {
    const phones = [...new Set(text.match(PHONE_RE) || [])];
    if (phones[0]) proposals.push({ field_name: 'phone', proposed_value: phones[0].replace(/\s+/g, ' ').trim(), sourceUrl, confidence: 60 });
  }

  // Industry — keyword scan
  if (!bp.industry) {
    const lower = text.toLowerCase();
    const found = INDUSTRIES.find(ind => lower.includes(ind));
    if (found) proposals.push({
      field_name: 'industry',
      proposed_value: found.charAt(0).toUpperCase() + found.slice(1),
      sourceUrl,
      confidence: 45,
    });
  }

  return proposals;
}

// ── Phase 1: fetch website ────────────────────────────────────
async function fetchWebsiteText(website) {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ERPBot/1.0)' },
      maxContentLength: 2 * 1024 * 1024,
    });
    const text = stripHtml(res.data).slice(0, 6000);
    console.log(`[BP Enrich P1] Website fetched OK — ${text.length} chars`);
    return text;
  } catch (e) {
    console.warn(`[BP Enrich P1] Could not fetch website ${website}: ${e.message}`);
    return null;
  }
}

// Phase 1 with Claude
async function extractFromWebsiteWithClaude(text, bp) {
  const knownContext = buildKnownContext(bp);
  const prompt = `You are an ERP data assistant. A business partner record has these known values:
${knownContext}

Below is the text content scraped from their official website (${bp.website}).
Extract only fields that are clearly present and belong to THIS specific company.
Return a JSON array of objects: { field_name, proposed_value, confidence (0-100) }

Fields you may propose (skip if the value is already in "known values" above, or not found):
- industry: their primary industry/sector (one word or short phrase)
- phone: main office phone number (Australian format)
- email: main contact email (prefer generic like info@, sales@)
- abn: Australian Business Number if shown on the page
- ai_summary: 2-3 sentence professional summary of what this company does

Rules:
- Do not include fields already listed in known values
- Do not hallucinate — if not clearly on the page, omit it
- Return ONLY a valid JSON array, no markdown, no explanation

Website text:
${text}`;

  const r = await axios.post('https://api.anthropic.com/v1/messages', {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  }, {
    headers: {
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    timeout: 25000,
  });

  const raw = r.data?.content?.[0]?.text?.trim() || '[]';
  console.log(`[BP Enrich P1] Claude raw: ${raw.slice(0, 300)}`);
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) return [];
  console.log(`[BP Enrich P1] Claude found: ${parsed.map(p => p.field_name).join(', ') || 'none'}`);
  return parsed.filter(p => p.field_name && p.proposed_value).map(p => ({
    field_name:     p.field_name,
    proposed_value: String(p.proposed_value),
    source_url:     bp.website,
    source_snippet: `Extracted from company website ${bp.website}`,
    confidence:     Math.min(95, Math.max(0, Number(p.confidence) || 70)),
  }));
}

// ── Phase 2: SerpApi search ───────────────────────────────────
async function runSerpSearch(searchName, bp) {
  if (!SERP_API_KEY) return [];
  const domain = bp.website ? domainOf(bp.website) : null;

  // Domain-constrained query only makes sense if the site is indexed
  const queries = domain
    ? [`"${searchName}" Australia contact phone email industry`]
    : [
        `"${searchName}" Australia company contact email phone`,
        `"${searchName}" Australia official website LinkedIn`,
      ];

  const allResults = [];
  for (const q of queries) {
    try {
      const res = await axios.get('https://serpapi.com/search', {
        params: { engine: 'google', q, api_key: SERP_API_KEY, num: 8, gl: 'au', hl: 'en', location: 'Australia' },
        timeout: 15000,
      });
      const hits = res.data.organic_results || [];
      console.log(`[BP Enrich P2] SerpApi "${q}" → ${hits.length} results`);
      for (const r of hits) allResults.push({ url: r.link || '', title: r.title || '', snippet: r.snippet || '' });
    } catch (e) {
      console.warn(`[BP Enrich P2] SerpApi failed ("${q}"): ${e.message}`);
    }
  }
  return allResults;
}

// Phase 2 with Claude verification
async function verifyWithClaude(allResults, bp, alreadyProposedFields) {
  const knownContext = buildKnownContext(bp);
  const resultsText = allResults.slice(0, 8)
    .map((r, i) => `[${i + 1}] URL: ${r.url}\nTitle: ${r.title}\nSnippet: ${r.snippet}`)
    .join('\n\n');
  const skipNote = alreadyProposedFields.length
    ? `\nSkip these fields (already found in Phase 1): ${alreadyProposedFields.join(', ')}`
    : '';

  const prompt = `You are an ERP data assistant enriching a business partner record.

Known data about this company:
${knownContext}

Search results (some may be about a DIFFERENT company with a similar name):
${resultsText}

Task: Identify which results genuinely refer to THIS company (cross-check against known website domain, name, ABN). Extract missing data ONLY from confirmed-matching results.${skipNote}

Fields to propose: industry, phone, email, website (if unknown), linkedin_url, ai_summary

Return a JSON array: [{ field_name, proposed_value, source_url, source_snippet (max 200 chars), confidence (0-100) }]
If no result clearly matches this company, return [].
Return ONLY valid JSON — no markdown, no explanation.`;

  const r = await axios.post('https://api.anthropic.com/v1/messages', {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages:   [{ role: 'user', content: prompt }],
  }, {
    headers: {
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    timeout: 25000,
  });

  const raw = r.data?.content?.[0]?.text?.trim() || '[]';
  console.log(`[BP Enrich P2] Claude raw: ${raw.slice(0, 300)}`);
  const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) return [];
  console.log(`[BP Enrich P2] Claude verified: ${parsed.map(p => p.field_name).join(', ') || 'none'}`);
  return parsed.filter(p => p.field_name && p.proposed_value).map(p => ({
    ...p,
    proposed_value: String(p.proposed_value),
    confidence:     Math.min(90, Math.max(0, Number(p.confidence) || 50)),
    source_snippet: (p.source_snippet || '').slice(0, 500),
  }));
}

// Phase 2 regex fallback — filter snippets by domain match
function regexFallbackFromSearch(allResults, bp) {
  const domain = bp.website ? domainOf(bp.website) : null;
  const proposals = [];

  for (const { url, snippet } of allResults) {
    // If we have a known domain, only trust results from that domain
    if (domain && url && !url.includes(domain) && !snippet.toLowerCase().includes(domain)) continue;

    const extracted = regexExtract(snippet, bp, url);
    for (const p of extracted) {
      if (!proposals.find(existing => existing.field_name === p.field_name)) {
        proposals.push({ ...p, source_url: url, source_snippet: snippet.slice(0, 300) });
      }
    }
    if (proposals.length >= 3) break;
  }

  // If no domain-matched results and no domain known, try first 3 results
  if (proposals.length === 0 && !domain) {
    for (const { url, snippet } of allResults.slice(0, 3)) {
      const extracted = regexExtract(snippet, bp, url);
      for (const p of extracted) {
        if (!proposals.find(existing => existing.field_name === p.field_name)) {
          proposals.push({ ...p, source_url: url, source_snippet: snippet.slice(0, 300) });
        }
      }
    }
  }

  console.log(`[BP Enrich P2] Regex fallback found: ${proposals.map(p => p.field_name).join(', ') || 'none'}`);
  return proposals;
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
    console.warn('[BP Enrich] Neither SERP_API_KEY nor ANTHROPIC_API_KEY set — skipping');
    return;
  }

  if (!ANTHROPIC_API_KEY) {
    console.warn('[BP Enrich] ANTHROPIC_API_KEY not set — using regex fallback (lower quality). Set it in .env for AI-verified proposals.');
  }

  console.log(`[BP Enrich] Starting enrichment for bp.id=${bp.id} "${searchName}"...`);

  const allProposals = [];

  // ── Phase 1: website extraction ───────────────────────────
  if (bp.website) {
    console.log(`[BP Enrich] Phase 1: extracting from ${bp.website}`);
    const text = await fetchWebsiteText(bp.website);
    if (text) {
      try {
        if (ANTHROPIC_API_KEY) {
          const p1 = await extractFromWebsiteWithClaude(text, bp);
          allProposals.push(...p1);
        } else {
          const p1 = regexExtract(text, bp, bp.website);
          allProposals.push(...p1);
        }
      } catch (e) {
        console.warn('[BP Enrich P1] Extraction error:', e.message);
      }
    }
    console.log(`[BP Enrich] Phase 1: found ${allProposals.length} field(s)`);
  }

  // ── Phase 2: search for remaining fields ──────────────────
  console.log(`[BP Enrich] Phase 2: web search for remaining fields`);
  const foundFields = new Set(allProposals.map(p => p.field_name));
  const searchResults = await runSerpSearch(searchName, bp);

  if (searchResults.length > 0) {
    try {
      const p2 = ANTHROPIC_API_KEY
        ? await verifyWithClaude(searchResults, bp, [...foundFields])
        : regexFallbackFromSearch(searchResults, bp);
      // Don't overwrite Phase 1 results with Phase 2 results
      for (const p of p2) {
        if (!foundFields.has(p.field_name)) allProposals.push(p);
      }
    } catch (e) {
      console.warn('[BP Enrich P2] Error:', e.message);
    }
  }
  console.log(`[BP Enrich] Phase 2: total proposals so far: ${allProposals.length}`);

  // ── Deduplicate against already-pending proposals ─────────
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
