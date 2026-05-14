import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { contactsApi } from '../../api/contacts';

const AUD = v => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v || 0);
const PCT = v => v ? `${v}%` : '—';
const DATE_STR = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });

function volLabel(vb) {
  if (vb.min_qty != null && vb.max_qty != null) return `${vb.min_qty}–${vb.max_qty - 1} units`;
  if (vb.min_qty != null) return `≥ ${vb.min_qty} units`;
  return `< ${vb.max_qty} units`;
}

export default function CustomerPriceSheet({ contact, priceListId, onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    setLoading(true); setErr('');
    const params = priceListId ? { price_list_id: priceListId } : {};
    contactsApi.priceSheet(contact.id, params)
      .then(r => setData(r.data.data))
      .catch(() => setErr('Failed to load price sheet.'))
      .finally(() => setLoading(false));
  }, [contact.id, priceListId]);

  function toggleExpand(id) {
    setExpanded(e => ({ ...e, [id]: !e[id] }));
  }

  function exportXLS() {
    if (!data) return;
    const rows = [
      [`Price Sheet — ${data.customer.full_name}`],
      [`Price List: ${data.priceList?.name || 'Retail RRP'}`, `Date: ${DATE_STR}`],
      [],
      ['Code', 'Product', 'Category', 'Base (RRP)', 'Cust Disc%', 'Unit Price (ex GST)', `GST (${data.taxRate}%)`, 'Unit Price (inc GST)'],
    ];
    for (const p of data.products) {
      rows.push([
        p.product_code || '',
        p.name,
        p.category_name || '',
        p.basePrice,
        p.customerDiscountPct ? `${p.customerDiscountPct}%` : '—',
        p.unitPrice,
        `${data.taxRate}%`,
        p.unitPriceIncGst,
      ]);
      for (const vb of p.volumeBreaks || []) {
        rows.push([
          '', `  Volume: ${volLabel(vb)}`, '',
          '', `+${vb.volumeDiscountPct}% vol`,
          vb.unitPrice, `${data.taxRate}%`, vb.unitPriceIncGst,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Price Sheet');
    XLSX.writeFile(wb, `price-sheet-${data.customer.full_name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function printPDF() {
    if (!data) return;
    const html = buildPrintHTML(data);
    const win  = window.open('', '_blank', 'width=900,height=700');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'var(--bg, #f0f4f9)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px',
        background: 'var(--card, #fff)',
        borderBottom: '1px solid var(--border, #e2e8f0)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '5px 10px', cursor: 'pointer', fontSize: 13, color: 'var(--text-sub)',
            fontFamily: 'inherit',
          }}>← Back</button>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Price Sheet — {contact.full_name}</div>
            {data?.priceList && (
              <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 2 }}>
                <span style={{ background: 'rgba(47,127,232,0.1)', color: 'var(--accent,#2f7fe8)', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>
                  {data.priceList.name}
                </span>
                {' '}· {DATE_STR}
                {data.customer.gst_registered
                  ? <span style={{ marginLeft: 8, color: '#2ECC8A', fontWeight: 600 }}>GST registered</span>
                  : <span style={{ marginLeft: 8, color: '#E89B2F', fontWeight: 600 }}>No GST</span>}
              </div>
            )}
          </div>
        </div>
        {data && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={exportXLS} style={actionBtn('#2ECC8A')}>⬇ Export XLS</button>
            <button onClick={printPDF}  style={actionBtn('#2F7FE8')}>🖨 Print / PDF</button>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {loading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-sub)' }}>Loading price sheet…</div>}
        {err     && <div style={{ color: 'var(--red)', padding: 24 }}>{err}</div>}

        {data && (
          <>
            <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-sub)' }}>
              {data.products.length} products · {data.taxRate}% GST {data.customer.gst_registered ? 'applies' : '(not registered — GST not charged)'}
            </div>
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(240,244,249,0.8)', borderBottom: '1px solid var(--border)' }}>
                    <Th align="left">Code</Th>
                    <Th align="left">Product</Th>
                    <Th align="left">Category</Th>
                    <Th align="right">Base (RRP)</Th>
                    <Th align="right">Cust Disc%</Th>
                    <Th align="right">Unit Price (ex GST)</Th>
                    <Th align="right">GST ({data.taxRate}%)</Th>
                    <Th align="right">Unit Price (inc GST)</Th>
                    <Th align="center" style={{ width: 32 }}></Th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map(p => (
                    <React.Fragment key={p.id}>
                      <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(47,127,232,0.03)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--card)'}>
                        <Td mono style={{ color: 'var(--text-sub)' }}>{p.product_code || '—'}</Td>
                        <Td style={{ fontWeight: 500 }}>{p.name}</Td>
                        <Td style={{ color: 'var(--text-sub)' }}>{p.category_name || '—'}</Td>
                        <Td align="right">{AUD(p.basePrice)}</Td>
                        <Td align="right" style={{ color: p.customerDiscountPct ? '#2ECC8A' : 'var(--text-sub)' }}>
                          {p.customerDiscountPct ? `−${p.customerDiscountPct}%` : '—'}
                        </Td>
                        <Td align="right" style={{ fontWeight: 600 }}>{AUD(p.unitPrice)}</Td>
                        <Td align="right" style={{ color: 'var(--text-sub)' }}>{AUD(p.unitPrice * p.taxRate / 100)}</Td>
                        <Td align="right" style={{ fontWeight: 700 }}>{AUD(p.unitPriceIncGst)}</Td>
                        <Td align="center">
                          {p.volumeBreaks?.length > 0 && (
                            <button onClick={() => toggleExpand(p.id)} style={{
                              background: 'none', border: 'none', cursor: 'pointer', fontSize: 11,
                              color: 'var(--accent)', padding: '2px 5px', borderRadius: 4,
                              fontFamily: 'inherit',
                            }}>
                              {expanded[p.id] ? '▲' : `▼ ${p.volumeBreaks.length}`}
                            </button>
                          )}
                        </Td>
                      </tr>
                      {expanded[p.id] && p.volumeBreaks.map((vb, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(46,204,138,0.04)' }}>
                          <Td></Td>
                          <Td colspan={2} style={{ fontSize: 12, color: 'var(--text-sub)', paddingLeft: 28, fontStyle: 'italic' }}>
                            Volume: {volLabel(vb)}
                          </Td>
                          <Td></Td>
                          <Td align="right" style={{ fontSize: 12, color: '#2ECC8A' }}>+{vb.volumeDiscountPct}% vol</Td>
                          <Td align="right" style={{ fontWeight: 600, fontSize: 12 }}>{AUD(vb.unitPrice)}</Td>
                          <Td align="right" style={{ color: 'var(--text-sub)', fontSize: 12 }}>{AUD(vb.unitPrice * data.taxRate / 100)}</Td>
                          <Td align="right" style={{ fontWeight: 700, fontSize: 12 }}>{AUD(vb.unitPriceIncGst)}</Td>
                          <Td></Td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Th({ children, align = 'left', style = {} }) {
  return (
    <th style={{ padding: '10px 14px', textAlign: align, fontSize: 11, fontWeight: 600,
      textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-sub)', ...style }}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', mono, colspan, style = {} }) {
  return (
    <td colSpan={colspan} style={{ padding: '9px 14px', textAlign: align,
      fontFamily: mono ? 'DM Mono, monospace' : 'inherit', fontSize: 13, ...style }}>
      {children}
    </td>
  );
}

function actionBtn(color) {
  return {
    background: color, color: '#fff', border: 'none', borderRadius: 7,
    padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    fontFamily: 'inherit',
  };
}

function buildPrintHTML(data) {
  const rows = data.products.flatMap(p => {
    const main = `
      <tr>
        <td class="mono">${p.product_code || ''}</td>
        <td><strong>${p.name}</strong></td>
        <td>${p.category_name || ''}</td>
        <td class="r">${AUD(p.basePrice)}</td>
        <td class="r">${p.customerDiscountPct ? `−${p.customerDiscountPct}%` : '—'}</td>
        <td class="r b">${AUD(p.unitPrice)}</td>
        <td class="r dim">${AUD(p.unitPrice * data.taxRate / 100)}</td>
        <td class="r bb">${AUD(p.unitPriceIncGst)}</td>
      </tr>`;
    const vbs = (p.volumeBreaks || []).map(vb => `
      <tr class="vb">
        <td></td>
        <td colspan="2" class="dim italic">  Volume: ${volLabel(vb)}</td>
        <td></td>
        <td class="r green">+${vb.volumeDiscountPct}% vol</td>
        <td class="r b">${AUD(vb.unitPrice)}</td>
        <td class="r dim">${AUD(vb.unitPrice * data.taxRate / 100)}</td>
        <td class="r bb">${AUD(vb.unitPriceIncGst)}</td>
      </tr>`).join('');
    return main + vbs;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Price Sheet — ${data.customer.full_name}</title>
  <style>
    body { font-family: -apple-system, Arial, sans-serif; font-size: 12px; color: #1a202c; margin: 0; padding: 20px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .sub { font-size: 12px; color: #718096; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f7fafc; border-bottom: 2px solid #e2e8f0; padding: 7px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #718096; text-align: left; }
    td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }
    .r { text-align: right; }
    .b { font-weight: 600; }
    .bb { font-weight: 700; }
    .dim { color: #718096; }
    .green { color: #276749; }
    .italic { font-style: italic; }
    .mono { font-family: monospace; font-size: 11px; }
    .vb td { background: #f0fff4; font-size: 11px; }
    @media print { body { padding: 10px; } }
  </style></head><body>
  <h1>Price Sheet — ${data.customer.full_name}</h1>
  <div class="sub">Price List: <strong>${data.priceList?.name || 'Retail RRP'}</strong>
    &nbsp;·&nbsp; Date: ${DATE_STR}
    &nbsp;·&nbsp; GST: ${data.taxRate}% ${data.customer.gst_registered ? '(registered)' : '(not registered)'}
  </div>
  <table>
    <thead><tr>
      <th>Code</th><th>Product</th><th>Category</th>
      <th class="r">Base (RRP)</th><th class="r">Cust Disc%</th>
      <th class="r">Unit Price (ex GST)</th><th class="r">GST</th><th class="r">Unit Price (inc GST)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:16px;font-size:11px;color:#718096;">
    Generated ${DATE_STR} · Prices subject to change without notice
  </div>
  </body></html>`;
}
